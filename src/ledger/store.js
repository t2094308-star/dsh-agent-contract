/**
 * 台账 store：三个领域的 CRUD + 内存联查喵。
 *
 * 读路径全部走领域的内存态（同步），写路径 await 领域写入链路（durable 后才改内存）喵。
 * 这里不放业务判断——状态机在 `state.js`，命名在 `naming.js`，重建在 `rebuild.js`喵。
 */
import { DOMAIN_SPECS } from './domains.js'
import { attachIndexSync, createIndexSync, createSearchIndex } from './index-sync.js'
import { keyOf, projectKeyOf, projectSlugOf } from './keys.js'
import { parseMemberName } from './naming.js'

/** 领域 key 列表，顺序即 open 顺序喵。 */
// FIX-100：第四个领域 = 提权申请留痕（审计据此判已提权）喵
export const DOMAIN_KEYS = ['members', 'tasks', 'docs', 'escalations']

/** 打开三个领域喵。任一失败则回滚已开的，避免半开状态漏在 facility 里喵。 */
export async function openDomains(storageDomain) {
  const opened = {}
  try {
    for (const key of DOMAIN_KEYS) {
      opened[key] = await storageDomain.open(DOMAIN_SPECS[key])
    }
  } catch (error) {
    await Promise.all(Object.values(opened).map((domain) => domain.close().catch(() => {})))
    throw error
  }
  return opened
}

/** 造一条成员记录喵（缺省值集中在这里，省得每个调用点各写一遍）喵。 */
export function memberRecord(input) {
  return {
    id: input.id || '',
    name: input.name,
    role: input.role,
    mode: input.mode || 'unknown',
    layer: input.layer ?? 0,
    parent: input.parent ?? null,
    status: input.status || 'running',
    model: input.model ?? null,
    route: input.route ?? null,
    costUsd: input.costUsd ?? null,
    latestDeliverable: input.latestDeliverable ?? null,
    lastActiveAt: input.lastActiveAt || new Date().toISOString(),
    derived: input.derived ?? false,
    // FIX-90：父会话 id（判归档要沿父链上溯）喵
    parentSessionId: input.parentSessionId ?? null,
    // FIX-99：退役留痕（旧常驻实例让位时写它，记录本身**不删**）喵
    // FIX-104：契约指纹（续派时判要不要补发契约）喵
    contractFingerprint: input.contractFingerprint ?? null,
    retiredReason: input.retiredReason ?? null,
    retiredAt: input.retiredAt ?? null,
  }
}

/**
 * 把一条既有成员记录标成**退役**喵（FIX-99 ②）喵 —— 保留记录与留痕，只改状态与原因喵。
 *
 * @param existing - 既有记录喵。
 * @param reason - 为什么让它退役（进面板与审计，别让人猜）喵。
 * @returns 可直接 `putMember` 的新记录喵。
 */
export function retireMember(existing, reason, now = () => new Date().toISOString()) {
  return memberRecord({
    ...existing,
    status: 'retired',
    retiredReason: String(reason || '常驻实例让位（新建了本会话的实例）'),
    retiredAt: now(),
  })
}

/**
 * 成员记录的**逻辑键**喵（FIX-17）喵。
 *
 * 有 sessionId 就用它（同名多轮成员各占一条，旧会话 id 不丢）；
 * 没有（`ledger_rebuild` 从文档 owner 推出来的派生成员）才退回成员名——
 * 派生成员本来就是"按名字认人"，一条就够喵。
 */
export function memberKeyOf(record) {
  const id = String((record && record.id) || '').trim()
  if (id) return id
  return String((record && record.name) || '')
}

/** 造一条**提权申请**记录喵（FIX-100 ②）喵：理由必填；作用域默认"本会话"；期限可空（空 = 不过期）喵。 */
export function escalationRecord(input) {
  return {
    sessionId: input.sessionId ?? null,
    reason: String((input && input.reason) || '').trim() || '(未写理由)',
    scope: input.scope || 'session',
    taskId: input.taskId ?? null,
    until: input.until ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

/**
 * 提权记录的**物理键**喵：`<createdAt>#<sessionId>` —— 按时间有序，同会话多次提权也不撞键喵。
 * （键要过 `^[a-zA-Z0-9_-]+$`，所以把 `:`/`.` 之类替换掉喵。）
 */
export function escalationKeyOf(record) {
  const stamp = String((record && record.createdAt) || '').replace(/[^0-9A-Za-z_-]/g, '')
  const session = String((record && record.sessionId) || 'anon').replace(/[^0-9A-Za-z_-]/g, '')
  return `${stamp || 't'}-${session || 'anon'}`
}

/** 造一条任务记录喵。 */
export function taskRecord(input) {
  return {
    taskId: input.taskId,
    status: input.status || 'open',
    owner: input.owner ?? null,
    occupiedFiles: input.occupiedFiles || [],
    dependsOn: input.dependsOn || [],
    deliverable: input.deliverable ?? null,
    updatedAt: input.updatedAt || new Date().toISOString(),
  }
}

/** 造一条文档记录喵。 */
export function docRecord(input) {
  return {
    path: input.path,
    tier: input.tier ?? 0,
    owner: input.owner ?? null,
    taskId: input.taskId ?? null,
    title: input.title ?? null,
    chars: input.chars ?? 0,
    keywords: input.keywords || [],
    relatedFiles: input.relatedFiles || [],
    missingSections: input.missingSections || [],
    legacy: input.legacy ?? false,
    needsLibrarian: input.needsLibrarian || [],
    updatedAt: input.updatedAt || new Date().toISOString(),
    // FIX-30：覆盖计数与最近一次旧版备份路径（审计的观察项 doc_overwritten 读它）喵
    overwriteCount: input.overwriteCount ?? 0,
    lastBackupPath: input.lastBackupPath ?? null,
  }
}

/**
 * 用已打开的领域造一个 store 喵。
 *
 * **键与隔离**（DESIGN §5.5「存储键规范（勘误）」）喵：
 * - 物理键一律走 `keyOf(projectKey, table, logicalId)` —— 只含 `[a-zA-Z0-9_-]`，
 *   人类可读信息（project / 成员名 / 绝对路径 / taskId）只进值字段喵。
 * - 每条记录盖 `project` 章，读路径先按它收窄，避免跨项目串味喵。
 * - 物理键里已含 projectSlug 与 project 的哈希，所以两个项目用同一个逻辑键也不会互撞喵。
 *
 * @param domains - `openDomains()` 的结果喵。
 * @param projectKey - 项目隔离键（由 `projectKeyOf(config)` 得到）喵。
 */
export function createStore(domains, projectKey = 'default') {
  const kv = (table) => domains[table].table(table)
  const pk = (table, logicalId) => keyOf(projectKey, table, logicalId)
  const withProject = (record) => ({ ...record, project: projectKey })
  const mine = (record) => Boolean(record) && record.project === projectKey

  const list = (table) => [...kv(table).entries()]
    .map(([, value]) => value)
    .filter((record) => mine(record))

  const read = (table, logicalId) => {
    const record = kv(table).get(pk(table, logicalId))
    return mine(record) ? record : undefined
  }

  return {
    domains,
    projectKey,

    // ---- 成员 ----
    // **FIX-17：成员按 sessionId 建键**（无 id 的派生成员退回成员名）喵。
    // 曾经一律按 `name` 建键 → 同名多轮成员（`T99-…-reviewer` × 3，sessionId 各不相同）
    // 在**存储层就被压成一条**，后到者覆盖先到者，旧会话 id 直接丢失（核验报告 FIX-27 实测）喵。
    // 按**成员名**查（扫一遍）：物理键现在可能是 sessionId，只有派生成员才是按名建键喵
    getMember: (name) => list('members').find((member) => member.name === name),
    getMemberById: (id) => read('members', memberKeyOf({ id })),
    putMember: (record) => kv('members').put(pk('members', memberKeyOf(record)), withProject(record)),
    listMembers: () => list('members'),
    // 删除按名兜底：调用方给的是名字（历史上就是这个名字），而物理键可能是 id 喵
    deleteMember: (name) => {
      const found = list('members').find((member) => member.name === name)
      if (found) kv('members').delete(pk('members', memberKeyOf(found)))
      else kv('members').delete(pk('members', name))
    },

    // ---- 任务 ----
    getTask: (taskId) => read('tasks', taskId),
    putTask: (record) => kv('tasks').put(pk('tasks', record.taskId), withProject(record)),
    listTasks: () => list('tasks'),
    deleteTask: (taskId) => kv('tasks').delete(pk('tasks', taskId)),

    // ---- 文档 ----
    getDoc: (path) => read('docs', path),
    putDoc: (record) => kv('docs').put(pk('docs', record.path), withProject(record)),
    listDocs: () => list('docs'),
    deleteDoc: (path) => kv('docs').delete(pk('docs', path)),

    /** 写入是否已经排空（测试与重建用）喵。 */
    sizes: () => ({
      members: list('members').length,
      tasks: list('tasks').length,
      docs: list('docs').length,
      // FIX-100：提权申请也算一条台账记录（面板/体检看得见"最近提权"）喵
      escalations: list('escalations').length,
    }),

    // ---- 提权申请（FIX-100）----
    /** 记一条提权申请喵（物理键 = 时间戳 + 会话，天然按时间有序）喵。 */
    putEscalation: (record) => kv('escalations').put(pk('escalations', escalationKeyOf(record)), withProject(record)),
    listEscalations: () => list('escalations'),

    /**
     * 馆员唤醒队列喵：所有派生失败条目拍平。
     * **只有该清单非空才唤醒馆员**（DESIGN §5.5「派生失败清单」）喵。
     * @returns `[{ path, taskId, code, detail }]`喵。
     */
    needsLibrarianQueue() {
      return list('docs')
        .filter((doc) => Array.isArray(doc.needsLibrarian) && doc.needsLibrarian.length > 0)
        .flatMap((doc) => doc.needsLibrarian.map((item) => ({
          path: doc.path,
          taskId: doc.taskId,
          code: item.code,
          detail: item.detail,
        })))
    },

    /**
     * 内存联查喵：按 taskId 把任务 / 成员 / 文档三边拼在一起，再按 filter 过滤喵。
     * 全部走内存，不发 IO喵。
     * @param filter - `{ taskId, role, tier, status, legacy, missingSections }`，字段可缺省喵。
     */
    query(filter = {}) {
      const members = this.listMembers().filter((member) => {
        if (filter.taskId !== undefined) {
          const parsed = parseMemberName(member.name)
          if (!parsed || parsed.taskId !== filter.taskId) return false
        }
        if (filter.role !== undefined && member.role !== filter.role) return false
        if (filter.status !== undefined && member.status !== filter.status) return false
        return true
      })
      const tasks = this.listTasks().filter((task) => {
        if (filter.taskId !== undefined && task.taskId !== filter.taskId) return false
        if (filter.status !== undefined && task.status !== filter.status) return false
        return true
      })
      const docs = this.listDocs().filter((doc) => {
        if (filter.taskId !== undefined && doc.taskId !== filter.taskId) return false
        if (filter.tier !== undefined && doc.tier !== filter.tier) return false
        if (filter.legacy !== undefined && doc.legacy !== filter.legacy) return false
        if (filter.missingSections === true && doc.missingSections.length === 0) return false
        return true
      })

      // 联查：以 taskId 为轴，把三边收进同一行；member 的 taskId 从成员名反解喵
      const taskIds = new Set([...tasks.map((t) => t.taskId), ...docs.map((d) => d.taskId).filter(Boolean)])
      for (const member of members) {
        const parsed = parseMemberName(member.name)
        if (parsed) taskIds.add(parsed.taskId)
      }
      const joined = [...taskIds].sort().map((taskId) => ({
        taskId,
        task: tasks.find((t) => t.taskId === taskId) || null,
        members: members.filter((member) => {
          const parsed = parseMemberName(member.name)
          return parsed ? parsed.taskId === taskId : false
        }),
        docs: docs.filter((doc) => doc.taskId === taskId),
      }))

      return { tasks, members, docs, joined }
    },
  }
}

/**
 * 项目隔离键喵：取 `project.name` 并 slug 化（例 `Blockdustry` → `blockdustry`）。
 * `storages/` 按 profile 隔离、不随工作区分区，所以这个键是多项目并存的唯一依靠喵。
 * 没配名字时退回 `default`；纯非 ASCII 名字退化为 `p_<hash6>`喵。
 * 实现在 `keys.js`（键生成的唯一入口），这里只做转发喵。
 */
export { projectKeyOf }

/**
 * 打开台账并暴露一个「就绪 Promise」喵。
 *
 * 领域 `open()` 是异步的，而工具注册是同步的 —— 因此 apply 时先拿到句柄，
 * 具体工具在 execute 里 `await ledger.ready` 再读写喵。
 *
 * **FIX-58：一个实例服务多个项目**喵。`storages/` 按 profile 隔离、**不随工作区分区**，
 * 所以多项目并存只能靠"每条记录的 `project` 字段 + 物理键里的 projectSlug"隔离喵。
 * 领域只开一次（同域名单开），**store 按项目键按需生成并缓存**：
 * 根跟着工作区走 ⇒ 换项目只是换一个 `projectKey` ⇒ 记录各归各域、绝不串味喵。
 *
 * @param ctx - 具备 `storageDomain` 服务的上下文喵。
 * @param defaultKey - 默认项目隔离键（`projectKeyOf(config)`；自适应调用点用 `storeFor()` 传入推导键）喵。
 */
export function createLedger(ctx, defaultKey = 'default') {
  const entries = new Map()
  let domains = null

  /** 取（或建）某个项目的入口：store + 它自己的检索索引喵。 */
  const entryFor = (key) => {
    const normalized = projectSlugOf(key)
    const cached = entries.get(normalized)
    if (cached) return cached
    const store = createStore(domains, normalized)
    // 事件驱动做增量、`ledger_rebuild` 做全量兜底（DESIGN §5.5）喵
    const wired = attachIndexSync({ ctx, store, index: createSearchIndex(), sync: createIndexSync() })
    wired.rebuildIndex()
    const entry = { key: normalized, store, index: wired.index, sync: wired.sync, rebuildIndex: wired.rebuildIndex }
    entries.set(normalized, entry)
    return entry
  }

  const ready = openDomains(ctx.storageDomain).then((opened) => {
    domains = opened
    return entryFor(defaultKey).store
  })
  // 没有调用方 await 时，未处理的拒绝会冒到进程级；这里先挂一个兜底喵
  ready.catch(() => {})

  const defaultEntry = () => entryFor(defaultKey)
  const hasDefault = () => entries.has(projectSlugOf(defaultKey))
  return {
    ready,
    projectKey: defaultKey,
    /** 检索索引（doc_search 的 L0 输入）喵 —— 默认项目的那个喵。 */
    index: { // 惰性代理：领域没开完之前调用要退化成空索引，别抛喵
      build: (records) => (hasDefault() ? defaultEntry().index.build(records) : 0),
      upsert: (record) => (hasDefault() ? defaultEntry().index.upsert(record) : 0),
      remove: (path) => (hasDefault() ? defaultEntry().index.remove(path) : false),
      has: (path) => (hasDefault() ? defaultEntry().index.has(path) : false),
      list: () => (hasDefault() ? defaultEntry().index.list() : []),
      size: () => (hasDefault() ? defaultEntry().index.size() : 0),
      snapshot: () => (hasDefault() ? defaultEntry().index.snapshot() : []),
    },
    /** 默认项目的索引节流器（与 `index` 同源：同一个入口里的那两个）喵。 */
    sync: {
      record: (key) => (hasDefault() ? defaultEntry().sync.record(key) : false),
      drain: () => (hasDefault() ? defaultEntry().sync.drain() : []),
      isDue: () => (hasDefault() ? defaultEntry().sync.isDue() : false),
      stats: () => (hasDefault() ? defaultEntry().sync.stats() : { events: 0, flushes: 0, pending: 0 }),
    },
    /** **FIX-58**：取某个项目的 store（同一个领域句柄，不同隔离键）喵。 */
    storeFor: (key) => entryFor(key).store,
    /** 某个项目的检索索引（`doc_search` 在自适应路径上用）喵。 */
    indexFor: (key) => entryFor(key).index,
    /** 全量重建索引——`ledger_rebuild` 之后必须调它，保证两条路径结果一致喵。 */
    rebuildIndex: () => (domains ? defaultEntry().rebuildIndex() : 0),
    /** 同上的按项目版本喵。 */
    rebuildIndexFor: (key) => (domains ? entryFor(key).rebuildIndex() : 0),
    /** 本实例已经见过的项目键（测试/诊断用）喵。 */
    projectKeys: () => [...entries.keys()],
    async close() {
      if (!domains) {
        await ready.catch(() => null)
      }
      await Promise.all(DOMAIN_KEYS.map((key) => (domains && domains[key] ? domains[key].close().catch(() => {}) : null)))
      entries.clear()
      domains = null
    },
  }
}
