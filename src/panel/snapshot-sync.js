/**
 * 面板快照的**自动同步**喵（FIX-39）喵。
 *
 * 病根：快照原先只在两处重写 —— `audit_scan` 与 `ledger_rebuild` ⇒ 形成
 * 「**想看待办得先跑一次审计**」的别扭因果（用户实测：面板一直显陈旧，唯一出路是让主代理跑审计）喵。
 * 现在：**任何**台账变更（派子智能体写 member/task 记录、`doc_emit` 落档、`progress_upsert`…）
 * 都经 `domain/changed` 触达这里，**节流**后重写快照 —— 审计回归为"数据来源之一"喵。
 *
 * 两条纪律喵：
 * ① **及时但不频繁**：首个事件起一个 `flushMs` 的窗口，窗口内的事件合并成**一次**写入；
 *    事件攒到 `maxEvents` 就立刻写（突发大批量不憋着）喵。
 * ② **不许谎报审计**：非审计触发的重写**沿用上一份快照里的 audit 块**（并标 `asOf` 说明它截至何时）；
 *    没有可沿用的一律写 `placeholder`（面板显示"数据源待接"），**绝不用 `0 红 0 黄` 冒充"全绿"**喵。
 *
 * 与 `index-sync` 的分工：这里只管"快照什么时候重写"，索引那边管搜索读模型；两者共用"节流"的思路喵。
 */
import { readFile } from 'node:fs/promises'
import { DOMAIN_NAMES } from '../ledger/domains.js'
import { annotatePanelSnapshot, panelSnapshotPath, writePanelSnapshot } from './snapshot.js'
// FIX-95：启动自愈要扫**宿主已登记的工作区**（不依赖会话活动）喵
import { resolveAdaptiveProject, workspaceRootsOf } from '../project/adaptive.js'
import { pluginVersion } from '../version.js'

/** 快照节流默认：2 秒窗口 / 攒够 16 个事件立刻写喵。 */
export const PANEL_SYNC_DEFAULTS = { flushMs: 2000, maxEvents: 16 }

/** 读上一份快照（读不到/坏 JSON 都返回 null，绝不抛）喵。 */
export async function readSnapshotFile(project) {
  try {
    return JSON.parse(await readFile(panelSnapshotPath(project), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 造一个面板同步器喵。
 *
 * 计时器与写入函数都可注入 —— 这样套件能用假时钟精确驱动"窗口合并"与"攒够即写"，不必真的等喵。
 *
 * @param args.store - 台账 store喵。
 * @param args.project - `resolveProject()` 结果喵。
 * @param args.flushMs - 窗口长度（毫秒）喵。
 * @param args.maxEvents - 攒够多少事件立刻写喵。
 * @param args.write - 写入函数（默认 `writePanelSnapshot`）喵。
 * @param args.readPrevious - 读上一份快照（默认读快照文件）喵。
 * @param args.refresh - **补算审计 + 重写快照**的回调（FIX-91 ④ / FIX-96 ②）喵：自愈时若"上份是占位 /
 *   没有可沿用的结论"就现跑一次（`src/panel/refresh.js` 的 `refreshPanel` —— 与 `audit_scan` 工具、
 *   面板「强制刷新」按钮**同一个实现**）—— 免得升个级/重启一下面板就一直空着。拿不到（或抛错）就退回占位喵。
 * @param args.setTimer/clearTimer - 计时器（默认 `setTimeout` / `clearTimeout`）喵。
 * @param args.now - 注入时钟（给 `asOf` 用）喵。
 * @returns `{ record, flush, stop, stats }`喵。
 */
export function createPanelSync({
  store, project,
  flushMs = PANEL_SYNC_DEFAULTS.flushMs,
  maxEvents = PANEL_SYNC_DEFAULTS.maxEvents,
  write = writePanelSnapshot,
  readPrevious = readSnapshotFile,
  refresh = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => new Date().toISOString(),
  onError = () => {},
} = {}) {
  let pending = 0
  let timer = null
  let writes = 0
  let errors = 0

  /**
   * 沿用上一份快照的 audit 块（拿不到就 null ⇒ 写成 placeholder，绝不谎报全绿）喵。
   *
   * FIX-91：**placeholder 不许被沿用**喵 —— 真机病根：某次重启后先写了一份占位快照，
   * 之后每次"沿用上一份"都把这份占位接着传下去 ⇒ **一次占位 = 永久空**（面板审计区一直空白，
   * 直到有人手动跑一次 `audit_scan`）✗。占位不是"结论"，它没有可沿用性喵。
   */
  const carryAudit = async () => {
    try {
      const previous = await readPrevious(project)
      const audit = previous && previous.audit
      if (!audit || audit.placeholder === true) return null
      if (Array.isArray(audit.items) && audit.red !== null && audit.red !== undefined) {
        return {
          level: audit.level || 'green',
          counts: { red: audit.red, yellow: audit.yellow },
          items: audit.items,
          // 说明这份审计结论"截至何时"——它是上次审计的结果，不是本次重算的喵
          asOf: previous.generatedAt || null,
        }
      }
    } catch {
      /* 读不到就当作没有可沿用的审计结论喵 */
    }
    return null
  }

  /** 立刻落一次快照（把攒着的事件合并进这一次写入）喵。 */
  const flush = async () => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (pending === 0) return null
    const events = pending
    pending = 0
    try {
      const audit = await carryAudit()
      const result = await write({ store, project, audit })
      writes += 1
      return { ...result, events, at: now() }
    } catch (error) {
      errors += 1
      onError(error)
      return null
    }
  }

  /**
   * **启动即自愈**喵（FIX-51）喵：现有快照的写入方版本 ≠ 当前插件版本 ⇒ 立刻重写一次喵。
   *
   * 为什么要它：`record()` 只在"台账记录变化"时触发 ⇒ **每次插件升级后**面板都停在"数据源待接"，
   * 要么等用户碰巧做个动作、要么手动跑一次审计（这个坑已经踩到第三次）喵。升级不该需要人工动作。
   *
   * FIX-91 ④：自愈时若**没有可沿用的审计结论**（首份快照 / 上份是占位），就**现补跑一次审计**喵 ——
   * 否则"自愈出来的快照"只能写占位，面板审计区照样是空的（真机就是这个观感）喵。
   */
  const heal = async ({ currentVersion = pluginVersion() } = {}) => {
    try {
      const previous = await readPrevious(project)
      if (previous && previous.pluginVersion === currentVersion) return { healed: false, version: currentVersion }
      let audit = await carryAudit()
      let audited = false
      if (!audit && typeof refresh === 'function') {
        // FIX-96 ②（用户约束）：补算走**三处同源的那一个实现**（算审计 + 重写快照），
        // 由它自己落盘 ⇒ 这里直接返回，不再重写一遍（免得同一份内容写两次）喵
        try {
          const fresh = await refresh({ store, project })
          const report = fresh && fresh.report ? fresh.report : fresh
          if (report) {
            writes += 1
            return { healed: true, version: currentVersion, audited: true, ...(fresh && fresh.written ? fresh.written : {}) }
          }
        } catch (error) {
          errors += 1
          onError(error)
        }
      }
      const result = await write({ store, project, audit })
      writes += 1
      return { healed: true, version: currentVersion, audited, ...result }
    } catch (error) {
      errors += 1
      onError(error)
      return { healed: false, error: String(error && error.message ? error.message : error) }
    }
  }

  /** 记一次变更：攒够就立刻写，否则开一个窗口等合并喵。 */
  const record = () => {
    pending += 1
    if (pending >= maxEvents) {
      void flush()
      return true
    }
    if (timer === null) timer = setTimer(() => { void flush() }, flushMs)
    return false
  }

  return {
    record,
    flush,
    heal,
    stop: () => {
      if (timer !== null) clearTimer(timer)
      timer = null
    },
    stats: () => ({ writes, errors, pending }),
  }
}

/**
 * 多项目版的同步器喵（FIX-58）喵：一个实例服务多个项目时，**每个项目各有一份快照**
 * （都写在自己根下的 `.agent-contract/panel.json`），所以按项目键分别节流、分别落盘喵。
 *
 * 与单项目版的差别只有一处：`domain/changed` 的事件**带 `project` 章**（每条记录都有），
 * 用它认领归属 —— 认不出来的事件（删除类没带 value）**宁可不动**，也不猜着写进别人家的快照喵。
 *
 * **点亮时机（FIX-59 回归修复）**喵：原先只在"启动时"补一次，而零配置下启动**根本推不出根**
 * （宿主里可能登记了多个工作区，没有会话就无从选择）⇒ 一次都不写，面板永远"数据源待接"，
 * 连"升级后不用人工动作"（FIX-51）都做不到 ✗。
 * 现在改成**认会话**：宿主全局事件 `session/created`（`packages/core/session/src/index.ts:55`，
 * 宿主自己也用 `{ global: true }` 订阅）一来，就按那个会话的 cwd 推出项目根并把它的快照补上 ✓。
 * 子代理会话同样会触发一次，代价是每个会话一次"读快照比版本"（版本一致就不写）喵。
 */
export function createMultiPanelSync({
  ctx, ledger, projects, bootstrap = null, resolver = null, healLog = null,
  // FIX-95：`healAll()` 的报告要带时间戳 ⇒ 这里也把时钟解出来（再显式传给各项目的同步器）喵
  now = () => new Date().toISOString(),
  ...options
} = {}) {
  const syncs = new Map()
  const syncFor = (key) => {
    if (syncs.has(key)) return syncs.get(key)
    const project = projects && typeof projects.get === 'function' ? projects.get(key) : null
    if (!project || !ledger || typeof ledger.storeFor !== 'function') return null
    const sync = createPanelSync({ store: ledger.storeFor(key), project, now, ...options })
    syncs.set(key, sync)
    return sync
  }

  /**
   * 按**一个会话**（或任何带 `session.header.cwd` 的东西）点亮它所属项目的快照喵。
   * 解析失败一律安静返回 null —— 面板自愈不该让任何主流程出问题喵。
   */
  const touch = async (sessionLike) => {
    if (typeof resolver !== 'function') return null
    try {
      // 解析器认的是**工具执行上下文**的形状（`exec.agent.session.header.cwd`）⇒
      // 这里把拿到的会话包成 `{ agent: { session } }`，两条路（会话对象 / 带 session 的东西）都吃喵
      const session = sessionLike && sessionLike.session ? sessionLike.session : sessionLike
      const resolved = await resolver({ agent: { session } }, { ensure: false })
      if (!resolved || !resolved.key) return null
      const sync = syncFor(resolved.key)
      return sync ? await sync.heal() : null
    } catch {
      return null
    }
  }

  // 启动即自愈：配置能独立成项目视图时（显式锁定的那个），一挂上就补一次喵
  if (bootstrap && bootstrap.key) {
    const sync = syncFor(bootstrap.key)
    if (sync) void sync.heal()
  }

  const off = ctx && typeof ctx.on === 'function'
    ? ctx.on('domain/changed', (change) => {
      if (!change || !Object.values(DOMAIN_NAMES).includes(change.domain)) return
      const key = change.value && change.value.project
      if (!key) return
      const sync = syncFor(key)
      if (!sync) return
      // 新项目第一次被触达 ⇒ 顺手补一次自愈，面板一打开就有数据（而不是"数据源待接"）喵
      if (sync.stats().writes === 0) void sync.heal()
      sync.record()
    })
    : null

  // FIX-59 回归修复：**会话出现**是最可靠的"现在服务哪个项目"信号（启动时没有会话可选）喵
  const offSession = ctx && typeof ctx.on === 'function'
    ? ctx.on('session/created', (session) => { void touch(session) }, { global: true })
    : null

  /**
   * **启动自愈：扫全部已登记工作区**喵（FIX-95）喵 —— 不依赖任何会话活动。
   *
   * 为什么单靠 `session/created` 不够（真机实证 2026-10-03 22:43）：多工作区 + 零配置时，
   * 启动这一刻**推不出"当前项目"**（要等会话），用户重启后还没开工 ⇒ 一次都没触发 ⇒
   * `panel.json` 还是旧版插件写的那个（mtime 一个字节没动），面板一直说"快照由旧版插件写入" ✗。
   *
   * 规则喵：
   * - 只重写**已经存在**的快照（`no-snapshot` 的工作区跳过）——启动自愈不该在别人的仓库里凭空造文件；
   * - 版本已是最新 ⇒ `up-to-date`（**不做无谓重写**，保持 FIX-51 的幂等口径）；
   * - 每一档的结果都记进 `healLog`（`failed` 绝不静默，`contract_status` 会把它打出来）喵。
   *
   * @returns `{ roots, entries }`：`entries` 每项 `{ root, action, error? }`喵。
   */
  const healAll = async ({ roots = undefined } = {}) => {
    const list = roots === undefined ? workspaceRootsOf(ctx) : roots
    const entries = []
    if (list === null) {
      entries.push({ root: null, action: 'failed', error: '拿不到宿主的已登记工作区清单（workspaceRegistry 未注入）' })
    } else if (!list.length) {
      entries.push({ root: null, action: 'no-workspace', error: '宿主没有登记任何工作区（先打开一个工作区/仓库）' })
    }
    for (const root of list || []) {
      if (typeof resolver !== 'function') {
        entries.push({ root, action: 'failed', error: '项目解析器不可用' })
        continue
      }
      try {
        // 把该工作区当 cwd 交给解析器 ⇒ 解析出"这个工作区自己的项目视图"（`ensure:false`：只读探测）喵
        const resolved = await resolver({ agent: { session: { header: { cwd: root } } } }, { ensure: false })
        if (!resolved || !resolved.key) {
          entries.push({ root, action: 'failed', error: '未能解析成项目（项目根推导失败）' })
          continue
        }
        const sync = syncFor(resolved.key)
        if (!sync) {
          entries.push({ root, action: 'failed', error: '台账 store 未绑定（该项目暂时不可用）' })
          continue
        }
        // 只自愈**已有快照**的工作区，且把"上一份快照"读出来判版本（读不到即视为没有快照）喵
        const snapshotPath = panelSnapshotPath(resolved.project)
        const previous = await readSnapshotFile(resolved.project)
        if (!previous) {
          entries.push({ root, action: 'no-snapshot', snapshot: snapshotPath })
          continue
        }
        const healed = await sync.heal()
        entries.push({
          root,
          action: healed && healed.healed ? 'healed' : (healed && healed.error ? 'failed' : 'up-to-date'),
          // 落到哪去了也记一笔（自愈"没生效"时，第一个要问的就是"你以为的路径对不对"）喵
          snapshot: snapshotPath,
          ...(healed && healed.error ? { error: healed.error } : {}),
          ...(healed && healed.healed ? { audited: Boolean(healed.audited) } : {}),
        })
      } catch (error) {
        entries.push({ root, action: 'failed', error: String(error && error.message ? error.message : error) })
      }
    }
    const summary = {
      at: now(),
      version: pluginVersion(),
      roots: list ? list.length : 0,
      healed: entries.filter((row) => row.action === 'healed').length,
      upToDate: entries.filter((row) => row.action === 'up-to-date').length,
      skipped: entries.filter((row) => row.action === 'no-snapshot' || row.action === 'no-workspace').length,
      failed: entries.filter((row) => row.action === 'failed').length,
      entries,
    }
    // FIX-95 ②：自愈结果**留痕**（不许静默）——`contract_status` 会把这段打出来喵
    if (healLog && typeof healLog === 'object') {
      healLog.report = summary
      if (summary.failed) {
        const first = entries.find((row) => row.action === 'failed')
        healLog.error = `${first.root || '(全局)'}：${first.error || '未知原因'}`
      } else if (summary.roots === 0) {
        healLog.error = entries[0] ? entries[0].error || '没有可自愈的对象' : '没有可自愈的对象'
      } else {
        healLog.error = null
      }
    }
    return { roots: list || [], entries, summary }
  }

  return {
    syncs,
    syncFor,
    touch,
    healAll,
    healReport: () => (healLog ? healLog.report : null),
    dispose: () => {
      if (typeof off === 'function') off()
      if (typeof offSession === 'function') offSession()
      for (const sync of syncs.values()) sync.stop()
      syncs.clear()
    },
  }
}

/**
 * **台账领域打不开时，把原因写进每个工作区的快照**喵（FIX-97 ③）喵。
 *
 * 为什么不能只靠 `contract_status`：那要先能调工具（而台账坏了时工具链本身也在报错）；
 * 面板读的是**文件**，所以把"为什么面板不再更新"直接写进文件，用户打开面板就能看见喵。
 * 只动 `notes` / `setupError`，数据字段原样保留（见 `annotatePanelSnapshot`）喵。
 *
 * @returns `{ entries }`：每个工作区一条 `{ root, action, error? }`喵。
 */
export async function annotateWorkspaceSnapshots({ ctx, config, error, annotate = annotatePanelSnapshot } = {}) {
  const roots = workspaceRootsOf(ctx)
  const entries = []
  if (!roots || !roots.length) {
    entries.push({ root: null, action: 'skipped', error: roots ? '宿主没登记工作区' : '拿不到工作区清单' })
    return { entries }
  }
  for (const root of roots) {
    try {
      const adaptive = await resolveAdaptiveProject({
        ctx, config, agent: { session: { header: { cwd: root } } }, ensure: false,
      })
      const done = await annotate({ project: adaptive, error })
      entries.push({ root, action: done && done.ok ? 'annotated' : 'failed', ...(done && done.ok ? {} : { error: done && done.error }) })
    } catch (itemError) {
      entries.push({ root, action: 'failed', error: String((itemError && itemError.message) || itemError) })
    }
  }
  return { entries }
}

/**
 * 把同步器挂到宿主事件总线上喵：任何**三个领域**的变更都会（节流地）刷新面板快照喵。
 *
 * 两种形态喵：给了 `ledger` + `projects` 走**多项目**（FIX-58，根跟着工作区走）；
 * 只给 `store` + `project` 走单项目（既有调用点与断言不变）喵。
 *
 * @returns `{ sync, dispose }`（多项目形态是 `{ syncs, syncFor, dispose }`）喵。
 */
export function attachPanelSync({ ctx, store, project, ledger, projects, bootstrap, resolver, healLog = null, ...options }) {
  if (ledger && projects) {
    return createMultiPanelSync({ ctx, ledger, projects, bootstrap, resolver, healLog, ...options })
  }
  const sync = createPanelSync({ store, project, ...options })
  const off = ctx && typeof ctx.on === 'function'
    ? ctx.on('domain/changed', (change) => {
      if (!change || !Object.values(DOMAIN_NAMES).includes(change.domain)) return
      sync.record()
    })
    : null
  // FIX-51：挂上就自愈一次（版本不一致/快照缺失 ⇒ 立刻重写），用户不需要做任何事喵
  void sync.heal()

  return {
    sync,
    dispose: () => {
      if (typeof off === 'function') off()
      sync.stop()
    },
  }
}
