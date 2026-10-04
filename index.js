import Schema from '@deepseek-ai/schemastery'
// FIX-96 ②（用户约束）：**跑审计 + 重写快照**的**唯一实现**（工具 / 启动自愈 / 面板「强制刷新」三处同源）喵
import { refreshPanel } from './src/panel/refresh.js'
import { registerChannels } from './src/delegation/channels.js'
import { projectKeyOfName } from './src/ledger/keys.js'
import { createLedger } from './src/ledger/store.js'
import { annotateWorkspaceSnapshots, attachPanelSync } from './src/panel/snapshot-sync.js'
import { registerTodoRoute } from './src/panel/todo-route.js'
import { resolveProject } from './src/project.js'
import { createProjectResolver, deriveProjectName } from './src/project/adaptive.js'
import { createProjectRegistry } from './src/project/registry.js'
import { registerTools } from './src/tools.js'

export const name = 'agent-contract'

export const inject = ['tools', 'subagents', 'storageDomain']

export const Config = Schema.object({
  // 项目实例（通用化：任何项目都靠这段配置描述）
  project: Schema.object({
    name: Schema.string().default(''),
    root: Schema.string().default(''),
    // 项目简介：作为契约「任务切面」的一段；通用引擎不猜项目文档在哪，由配置显式提供喵
    brief: Schema.string().default(''),
  }),
  // 目录约定（相对 project.root 或绝对路径）
  paths: Schema.object({
    tasksDir: Schema.string().default('任务'),
    progressDir: Schema.string().default('[Agent进度]'),
    deliverablesDir: Schema.string().default('docs/子agent'),
    docsDirs: Schema.array(Schema.string()).default([]),
    // 归档分片目录（M4 定策略；M2.5 起作为配置项与审计范围的一部分）喵
    archiveDir: Schema.string().default(''),
    // FIX-69：临时文件的统一去处（**非类别目录、审计排除**；空 = 默认 ）喵
    tempDir: Schema.string().default(''),
    // FIX-80：新建文件的行尾（lf / crlf；默认 lf —— 新建档用 CRLF 会制造后续假差异）喵
    newFileEol: Schema.union(['lf', 'crlf']).default('lf'),
    // 类别 → 目录：文档「每类一个文件夹，禁止混放」，审计/馆员据此判是否放错喵
    docKinds: Schema.dict(Schema.string()).default({}),
  }),
  // 委派通道（provider 与可选深度上限；深度不填则沿用宿主配置）
  delegation: Schema.object({
    provider: Schema.string().default('spawn'),
    maxDepth: Schema.number(),
    // FIX-63：严格角色闸门 —— 打开后**主代理直调馆员作业面直接被拒**（默认只警告，与全局警告制一致）喵
    strictRoleGate: Schema.boolean().default(false),
  }),
  // 角色覆盖（同 id 逐字段覆盖内置角色卡；也可新增自定义角色）
  roles: Schema.array(Schema.object({
    id: Schema.string().required(),
    title: Schema.string(),
    mode: Schema.union(['one-shot', 'continuable']),
    modelRoute: Schema.string(),
    tools: Schema.array(Schema.string()),
    budgetChars: Schema.number(),
    deliverable: Schema.string(),
    forbidden: Schema.string(),
    persona: Schema.string(),
  })).default([]),
  // 角色 → 模型路由（路由名或 { provider, model, reasoningEffort }；密钥走 dsh 凭据，禁止写进配置）
  /**
   * 模型路由喵（**volatile：由设置页管理**，裁决 B，2026-10-03）喵。
   *
   * 宿主只允许写 `schema.meta.volatile` 的字段（`@deepseek-ai/dsh-settings` 的 `isVolatilePath()`）；
   * 而 volatile 字段**不参与配置文件解析**（实测：值会被投影成 `{}`，二次解析会 ValidationError）⇒
   * 路由的**默认值必须搬进 schema**（下面这个 `.default()`），`cordis.patch.yml` 里那份降级成"示例"喵。
   * **空对象/缺键 = 继承默认**：用户把 `modelRoutes` 写成 `{}` 时，adversary 仍应拿到这里的默认值，
   * 这条由 `channels.js` 的 `DEFAULT_MODEL_ROUTES` 兜底并断言守护（真异源不许静默失效）喵。
   */
  modelRoutes: Schema.dict(Schema.any()).default({ adversary: 'glm-5.3-flash' }).volatile(),
  // 注入与产出的预算（软上限 + 硬上限；超软限 warnOverSoftPct 以内仅提醒）
  budgets: Schema.object({
    softLimit: Schema.number().default(6000),
    hardLimit: Schema.number().default(9000),
    warnOverSoftPct: Schema.number().default(30),
    // FIX-75：**真正要限的是任务切片**（主代理口述给子代理的补充指令）—— 软 1000 / 硬 2000 字喵
    briefSoft: Schema.number().default(1000),
    briefHard: Schema.number().default(2000),
    // 总纲本体逐字迁移后本身就接近千字，因此它单独有更宽的软/硬限喵
    mandateSoft: Schema.number().default(1500),
    mandateHard: Schema.number().default(2400),
    // mandate 片段永不裁剪（传递性要求逐字完整下发）；超限只警告，该例外优先于其它片段喵
    mandateNoClip: Schema.boolean().default(true),
  }),
  // 审计检查项开关（警告制，不拦截）
  audit: Schema.object({
    checks: Schema.array(Schema.string()).default([]),
    // archive_suggest 的档龄阈值（天）：档龄超它且任务已结 → 只建议归档喵
    archiveAfterDays: Schema.number().default(90),
    // FIX-109 ⑤：**审计新增条目的自动推送**（增量 → 推给能修的角色；默认开，可关）喵
    pushIncrement: Schema.boolean().default(true),
    // 推送冷却（毫秒）：同一批新增在这么短时间里不重复推（默认 5 分钟）喵
    pushCooldownMs: Schema.number().default(300000),
  }),
  /**
   * git 集成喵（FIX-62 只提示 / FIX-67 可选提交）喵。
   *
   * **默认全关**：`autoCommit: false` ⇒ 插件只做**只读探测**（数未提交改动）并提示"建议先提交一次基线"，
   * 绝不代用户提交；打开后才走带护栏的自动提交（只 add 本次动到的路径 / 范围外改动即中止 / 永不 push）喵。
   */
  git: Schema.object({
    autoCommit: Schema.boolean().default(false),
    autoTag: Schema.boolean().default(false),
  }),
  // 面板（FIX-29 起；FIX-52 起这些开关也能在**设置页**改 —— 配置文件里的值是默认层，设置页写的是覆盖层）喵
  panel: Schema.object({
    // 路径类：**不可运行时变更**（改路径要重建数据）⇒ 老老实实留在配置文件里，设置页也不给写喵
    todoFile: Schema.string().default(''),
    /**
     * 面板开关（**volatile：由设置页管理**，裁决 B）喵：宿主只允许写标了 `.volatile()` 的字段，
     * 没标就抛 `Config field "…" is not volatile`（客户端只看到 `set()` 返回 false、原因被吞 —— 真机"开关点不动"）✗。
     * 代价照单全收：volatile 字段**不吃配置文件**（值会被投影掉），所以它们的默认值以**这里**为准，
     * `cordis.patch.yml` 里对应的键只作示例、改了不生效喵。
     */
    hideDoneOneShot: Schema.boolean().default(true).volatile(),
    autoRefresh: Schema.boolean().default(true).volatile(),
    // FIX-65：默认轮询 20s → **5s**（一次只重读快照，成本可忽略；下限 5s 由设置页滑块兜住）喵
    pollSeconds: Schema.number().default(5).volatile(),
    defaultView: Schema.union(['list', 'topology']).default('list').volatile(),
    badgeLabels: Schema.boolean().default(true).volatile(),
  }),
})

/**
 * 配置能不能独立成一份"项目视图"喵（FIX-58）喵。
 *
 * 自适应的根跟着工作区走，所以**没配 `project.root` 是合法状态**（零配置）——
 * 这时返回 null，插件照常启动，项目在每次工具调用时按会话现推喵。
 * 配了（显式锁定）就先登记一份：面板快照与待办写路由在**还没有任何工具调用**时也有得用喵。
 */
function bootstrapProject(config) {
  try {
    const project = resolveProject(config)
    const name = project.name || deriveProjectName(project.root)
    // 0.21.0 回归修复：项目视图自带 `key`（拿不到 key 的调用方就取不到该项目的 store，见 adaptive.js 同名注释）喵
    const key = projectKeyOfName(name)
    return { key, project: { ...project, name, key } }
  } catch {
    return null
  }
}

export function apply(ctx, config) {
  // FIX-58：项目登记簿（会话推出来的项目按 `storeFor` 分域）——面板同步与待办路由按它反查喵
  const projects = createProjectRegistry()
  const bootstrap = bootstrapProject(config)
  if (bootstrap) projects.remember(bootstrap.key, bootstrap.project)
  // 台账（三领域）在插件的生命周期里开着，卸载时关掉喵。
  // 领域只开一次；**项目键每次调用按会话现推**（一个实例服务多个项目，记录各归各域）喵
  const ledger = createLedger(ctx, bootstrap ? bootstrap.key : 'default')
  ctx.effect(() => () => ledger.close())
  // FIX-11：两条注册路径共记一份清单，contract_status 才能打印完整的「运行版工具清单」喵
  const toolNames = []
  /**
   * FIX-95 ②：**启动自愈的留痕**喵 —— 自愈（重写旧版写的面板快照）不许静默：
   * 进程内记一份结果，`contract_status` 会把它打出来（"重启为什么没恢复"这类问题一眼可查）喵。
   */
  const startupHeal = { report: null, error: null }
  /**
   * FIX-96 ②（用户约束）：**三处同源**的那一个实现 ——"跑审计 + 重写面板快照（含更新写入方版本标记）"喵。
   * 调用方：① 主代理的 `audit_scan` 工具（tools.js 里调同一个 `refreshPanel`）
   * ② 启动自愈时"没有可沿用的结论就补算一次"（FIX-91 ④ / FIX-95）③ 面板「强制刷新」按钮（经待办写路由）喵。
   * 谁都不许另写一套审计口径 —— 本项目已经因为"两处各判一套"返工过好几轮喵。
   */
  const refreshForPanel = ({ store, project }) => refreshPanel({ ctx, config, store, project })
  // FIX-58：工具与委派通道**共用同一个**项目解析器（两边对"现在服务哪个项目"必须同口径）喵
  const projectFor = createProjectResolver({ ctx, config, ledger, projects })
  registerTools(ctx, config, ledger, toolNames, projects, projectFor, startupHeal)
  registerChannels(ctx, config, ledger, toolNames, projectFor)

  // FIX-39 / FIX-58：面板快照**不再只由审计驱动**，也不再只服务一个项目 ——
  // 任何台账变更（派子智能体 / 落档 / 进度…）都经 `domain/changed` 触达这里，
  // 按事件自带的 `project` 章认领归属，**节流地**重写那个项目自己的快照喵
  ctx.effect(() => {
    let cancelled = false
    let dispose = null
    Promise.resolve(ledger.ready)
      .then(async () => {
        if (cancelled) return
        // 零配置时（没配 project.root）启动这一刻还没有"会话"这回事 —— 但宿主若只登记了**一个**工作区，
        // 就先用它把面板点亮（解析器会走"唯一工作区"那条；`ensure: false` ⇒ **只读探测、不建目录**）喵
        let boot = bootstrap
        if (!boot) {
          try {
            const resolved = await projectFor({ agent: null }, { ensure: false })
            boot = resolved.key ? { key: resolved.key, project: resolved.project } : null
          } catch {
            boot = null
          }
        }
        if (cancelled) return
        // FIX-59 回归修复：把**解析器**也交给同步器 —— 零配置 + 多个工作区时启动推不出根，
        // 但宿主一来会话（`session/created`）就知道该服务哪个项目，同步器据此立刻点亮那份快照喵
        const panel = attachPanelSync({
          ctx, ledger, projects, bootstrap: boot, resolver: projectFor, refresh: refreshForPanel, healLog: startupHeal,
        })
        dispose = panel.dispose
        // FIX-95 ①：**不依赖会话活动**的启动自愈 —— 扫宿主已登记的工作区，把"旧版插件写的快照"重写掉。
        // 真机病根：多工作区 + 零配置时启动推不出"当前项目"，自愈只挂在 `session/created` 上
        // ⇒ 用户重启后没开工就一次都不触发（`panel.json` 一个字节没动）✗。这里补上那个触发点喵
        if (typeof panel.healAll === 'function') {
          void panel.healAll().catch((error) => {
            if (startupHeal) startupHeal.error = String(error && error.message ? error.message : error)
          })
        }
      })
      .catch((error) => {
        /**
         * 面板同步器没挂上 ⇒ 快照从此不再重写（面板永远停在上一次写入的那一刻）喵。
         *
         * **这里绝不许静默**（0.20.0 真机教训）喵：真机上 0.17.0 时代的一条老记录不合新 schema
         * ⇒ 宿主打开领域时抛 `invalid-record` ⇒ `ledger.ready` reject ⇒ 这条链被这个空 catch 吞掉，
         * 于是"面板不更新"变成了一个**查不到原因的黑洞**（连自愈都没跑，用户只能看到旧数据）✗。
         * 现在把原因记进 `startupHeal`：`contract_status` 回执会把它打出来喵
         */
        if (startupHeal) {
          startupHeal.report = null
          startupHeal.error = `面板同步器未挂上（快照不会自动重写、自愈也没跑）：`
            + `${error && error.message ? error.message : String(error)}`
        }
        // 顺手也打一条宿主日志（`ctx.logger` 在精简 ctx / 测试桩里可能没有 ⇒ 容错）喵
        try {
          if (ctx && ctx.logger && typeof ctx.logger.error === 'function') {
            ctx.logger.error(`agent-contract: 面板同步器未挂上 —— ${error && error.message ? error.message : error}`)
          }
        } catch {
          /* 日志不是主流程，拿不到就算了（回执那条才是主通道）喵 */
        }
        // FIX-97 ③：**把原因写进面板看得见的地方**（每个工作区的快照 notes + setupError）——
        // 面板只读文件，不写进去用户就只能看到"数据不新鲜"，看不到"为什么" ✗
        void annotateWorkspaceSnapshots({ ctx, config, error })
          .then(({ entries }) => {
            if (!startupHeal) return
            const failed = entries.filter((row) => row.action === 'failed')
            startupHeal.annotated = entries.filter((row) => row.action === 'annotated').length
            if (failed.length) {
              startupHeal.error = `${startupHeal.error}（另外：有 ${failed.length} 个工作区的快照没能写上原因：${failed[0].error || '未知'}）`
            }
          })
          .catch(() => { /* 连写原因都失败就没辙了，回执那条已经带了原始原因喵 */ })
      })
    return () => {
      cancelled = true
      if (typeof dispose === 'function') dispose()
    }
  })

  // FIX-41 / FIX-58：待办文件的**写通道**（面板唯一可写目标）喵。
  // 白名单从"配置里那一个"扩到"**已登记项目各自声明的那个**"（仍然不是任意路径）喵。
  // `webServer` 是可选依赖 → 用 `ctx.inject` 按需拿（直接访问未注入的服务会抛错）；
  // 精简 ctx（无 `inject`）或宿主没挂 webServer 时**静默降级**：面板上编辑功能显示为不可用喵
  if (ctx && typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      const off = registerTodoRoute(scope, {
        getProjects: () => projects.list(),
        // FIX-96：面板「强制刷新」= 跑一次审计 + 重写快照（与主代理的 `audit_scan` 同一个实现）喵
        refresh: refreshForPanel,
        storeFor: (project) => (project && project.key ? ledger.storeFor(project.key) : null),
        getProject: () => {
          if (bootstrap) return bootstrap.project
          // 一个项目都没登记时也别炸：返回 null，路由据此报 403（不是 500）喵
          try {
            return resolveProject(config)
          } catch {
            return null
          }
        },
      })
      scope.effect(() => () => {
        if (typeof off === 'function') off()
      })
    })
  }
}
