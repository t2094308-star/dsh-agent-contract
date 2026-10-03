/*
 * dsh-agent-contract 的 client 侧（web 面板）入口喵 —— M3 交付物 1 / 3 喵。
 *
 * **这是一个经典脚本，不是 ESM module**喵：
 * 宿主默认用 `<script src=...>`（无 type=module）加载 client bundle，
 * 所以本文件顶层**不得出现 `import` / `export` 语句**，只能走
 * `window.__ModuleLoader__.load({ id, factory })` 的 CJS factory 形态喵。
 *
 * 数据源（M3 收口 = B 方案）喵：面板**只用宿主现成通道**取数 ——
 * `ctx.remote.session.list`（血缘 + 运行态）+ 逐会话 `ctx.remote.session.projections`
 * （拿子智能体的 label/mode 与模型选择）。**不引入 typert、不自造 IPC**喵。
 *
 * 能现算的：谱系树 / 层级 / 状态 / 角色与配色 / 过滤 / 契约徽章 / 异源徽章喵。
 * 算不出的（**数据源待接**）：三档、进度两枚徽章与 docs/tasks 计数 —— 它们要台账数据，
 * 而台账发布成 remote 需要 typert（已决定不做），故一律显示 `unknown` 并显式标注喵。
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-contract',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    // ---------------------------------------------------------------- 常量表
    /** 角色配色表喵：五类角色各一色，**对抗审查用专属色**（DESIGN §5.6 功能点 2）喵。 */
    const ROLE_COLORS = {
      主代理: '#8b5cf6',
      researcher: '#2f81f7',
      implementer: '#3fb950',
      reviewer: '#d29922',
      adversary: '#f85149', // 对抗审查专属红 —— 与审查橙、实现绿肉眼可区分
      librarian: '#39c5cf',
      成员: '#8b949e', // 未知角色（拿不到 label 时）
    }

    const STATUS_COLORS = {
      running: '#3fb950',
      idle: '#d29922',
      completed: '#8b949e',
      failed: '#f85149',
      released: '#6e7681',
      retired: '#6e7681',
      unknown: '#6e7681',
    }

    const MODE_LABELS = { 'one-shot': '前台', continuable: '后台', unknown: '未知' }

    /** 状态一律显示中文（面板文案只用简体中文）喵。 */
    const STATUS_LABELS = {
      running: '运行中',
      idle: '空闲',
      completed: '已完成',
      failed: '失败',
      released: '已释放',
      // FIX-99：常驻实例让位后的状态（记录保留、面板看得见）喵
      retired: '已退役',
      unknown: '未知',
    }

    /**
     * 角色中文名喵。与 host 侧 `src/contract/roles.js` 的 `title` 保持一致
     * ——client 是经典脚本、不能 import，所以这份表由测试**交叉比对**保证不漂移喵。
     */
    const ROLE_LABELS = {
      主代理: '主代理',
      researcher: '研究员',
      implementer: '实现者',
      reviewer: '审查者',
      adversary: '对抗审查者',
      librarian: '图书管理员',
    }

    const roleLabel = (role) => (role && ROLE_LABELS[role]) || '成员'

    /** 角色色 → 半透明底色（拓扑卡片用）喵。 */
    function roleTint(role, alpha) {
      const hex = String(roleColor(role)).replace('#', '')
      const value = Number.parseInt(hex, 16)
      const r = (value >> 16) & 255
      const g = (value >> 8) & 255
      const b = value & 255
      return `rgba(${r}, ${g}, ${b}, ${typeof alpha === 'number' ? alpha : 0.16})`
    }

    /**
     * 面板自身的 UI 状态（视图 / 图例展开）喵。
     * 两条持久化：① **模块级**兜底——同一页内组件 remount（跳转会话后常见）不丢；
     * ② 官方 `betterSidebar.updateTab(tabId, { meta })`（`meta` 随布局持久化、重载后原样恢复）喵。
     */
    // `auditOpen`：审计清单默认收起（摘要条常驻可见，点它展开）喵（FIX-21）喵
    // `todoOpen`：待办区默认**展开**（列表下方那片空白正好用起来）；`todoExpanded`：原文是否已展开全部喵
    // `viewChosen`：用户是否**亲手**选过视图 —— 没选过才吃设置页的「默认视图」喵（FIX-52）
    const panelUiState = { view: 'list', viewChosen: false, legendOpen: false, auditOpen: false, todoOpen: true, todoExpanded: false, queueOpen: true }

    /** 面板 UI 状态的持久化键喵（localStorage 是我们的主存，tab.meta 是备援）喵。 */
    const UI_STATE_KEY = 'agent-contract:panel-ui'

/** 视图切换标签喵。 */
    const VIEW_LABELS = { list: '列表', topology: '拓扑图' }

    /** 徽章取值符号喵。`na` = 不适用（如主代理没有契约注入）喵。 */
    /** 徽章状态的中文描述（tooltip 里说清楚，弥补只有颜色区分）喵。 */
    const BADGE_STATE_LABELS = { ok: '正常', warn: '警告', missing: '缺失', unknown: '未知', na: '不适用' }

    /**
     * 徽章取值 → **符号 + 颜色**喵（FIX-20）喵。
     *
     * 用户反馈「只能靠颜色分辨，白/绿就只有两个状态」——所以每枚徽章必须**带符号**：
     * 去色（灰度）打印或色觉障碍下，`✓ ⚠ ✗ ? —` 仍然两两可分；颜色退化成**辅助**信息喵。
     * 文案不在这里重复写：直接用 `BADGE_STATE_LABELS`，一处口径喵。
     */
    const BADGE_VIEW = {
      ok: { symbol: '✓', color: '#3fb950' },
      warn: { symbol: '⚠', color: '#d29922' },
      missing: { symbol: '✗', color: '#f85149' },
      unknown: { symbol: '?', color: '#6e7681' },
      na: { symbol: '—', color: '#6e7681' },
    }

    /** 一枚徽章的可读文本：`✓ 正常` / `✗ 缺失` / `? 未知` 喵（符号保证灰度下也分得开）喵。 */
    function badgeText(value) {
      const view = BADGE_VIEW[value] || BADGE_VIEW.unknown
      const label = BADGE_STATE_LABELS[value] || BADGE_STATE_LABELS.unknown
      return `${view.symbol} ${label}`
    }

    /**
     * 徽章格子的**紧凑形态**喵（FIX-20 起，FIX-28 定型）喵。
     *
     * 格子只有 40px 定宽，放不下 `契约✓正常`；而只写 `✓正常` 用户又看不出**哪枚**是哪个徽章
     * （实测原话：「只能看到一堆正常，但看不到什么正常」）喵。
     * 所以格子里是 **`徽章名 + 符号`**（`契约✓`，1~2 字标签 + 符号，本就够窄），
     * 状态词进 tooltip、符号含义进底部图例 —— 不看 tooltip 也能念出「契约正常、三档缺失」喵。
     */
    function badgeCell(key, value, withLabel = true) {
      const view = BADGE_VIEW[value] || BADGE_VIEW.unknown
      // FIX-52：设置页可以关掉文字标签（格子只剩符号，tooltip 里照样有全称）喵
      return withLabel === false ? view.symbol : `${key}${view.symbol}`
    }

    /** 五枚徽章在列表/卡片里的**固定顺序**（列头与图例都按它念）喵。 */
    const BADGE_KEYS = ['契约', '三档', '进度', '预算', '异源']

    /**
     * 审计摘要条文案喵（FIX-21）喵：`审计：红 3 / 黄 26`。
     * 快照没到（placeholder）时明说"尚无结论"（**不写 0 红 0 黄**——那等于谎报全绿），
     * 并给出下一步（FIX-91 ②：占位不许是空白；具体"为什么"由紧随其后的一行提示说）喵。
     */
    function auditSummaryText(audit) {
      if (!audit || audit.placeholder) return '审计：尚无结论（点「↻ 刷新」或让主代理跑一次 audit_scan）'
      const red = Number(audit.red) || 0
      const yellow = Number(audit.yellow) || 0
      if (!red && !yellow) return '审计：全绿（0 红 / 0 黄）'
      return `审计：红 ${red} / 黄 ${yellow}`
    }

    /**
     * 审计清单行喵（FIX-21）喵：每条必须有 **路径 + 原因 + 建议** 三件套喵。
     *
     * 返回**结构化**行 `{ level, text }`（不再把 `[红]/[黄]` 拼进文本）——
     * 等级交给**整行着色**表达，红/黄计数另有摘要条，文本里就不用再重复一遍前缀喵。
     */
    function auditLines(audit) {
      const items = audit && Array.isArray(audit.items) ? audit.items : []
      return items.map((item) => {
        const level = item && item.level === 'red' ? 'red' : 'yellow'
        const check = item && item.check ? item.check : '未知项'
        const target = item && item.target ? item.target : '(无路径)'
        const detail = item && item.detail ? item.detail : '(无原因)'
        const suggestion = item && item.suggestion ? item.suggestion : '由馆员核实后处理'
        // FIX-30：能定位到成员的行带 sessionId → 该行可点、点了跳会话喵
        const sessionId = item && item.sessionId ? String(item.sessionId) : null
        return { level, sessionId, text: `${target}｜${check}｜原因：${detail}｜建议：${suggestion}` }
      })
    }

    /** 审计等级 → 整行颜色喵（与徽章配色同源：红 #f85149 / 黄 #d29922）喵。 */
    const AUDIT_LEVEL_COLORS = { red: '#f85149', yellow: '#d29922' }

    /** 审计等级 → 中文词（进 tooltip，颜色之外仍留一条可读线索）喵。 */
    const AUDIT_LEVEL_LABELS = { red: '红项（必须处理）', yellow: '黄项（建议处理）' }

    /**
     * 审计摘要条的**范围说明**喵（FIX-37）喵：快照按项目根定位、同工作区内所有会话共享同一份，
     * 用户实测"新对话里的审计与另一对话一模一样"→ 容易以为是串了；写明"项目级"即可澄清喵。
     */
    const AUDIT_SCOPE_NOTE = '审计为项目级，同工作区内共享'

    /**
     * FIX-91 ②：占位（尚无审计结论）时显示器上要给的**兜底**提示喵。
     * 正常情况下 host 会随快照下发 `audit.action`（措辞与 README 同源）；这条只在旧快照没带时兜底喵。
     * FIX-95 ③：**把唯一可靠的动作说在最前面**（跑一次 `audit_scan` / 派一次活），「↻ 刷新」只作次选 ——
     * 用户口径原话是"他不知道必须有动作才写，而占位文案又让他期待重启就能恢复"喵。
     * FIX-96 ⑥：人自己那条路（面板「强制刷新」）与"求主代理"**并列**说 —— 两条都真能救回来喵
     */
    const AUDIT_PLACEHOLDER_HINT = '尚无审计结论 —— **下一步二选一：① 点面板上的「强制刷新」（= 跑一次审计并重写面板数据）'
      + '② 让主代理跑一次 `audit_scan`（或派一次活）**；「↻ 刷新」只重读文件、救不回陈旧的快照，是次选。'
      + '面板数据是**有动作时**才重算的；**重启**只在"快照由旧版插件写入"时自动补写一次，不会重算结论喵'

    /**
     * FIX-96：**强制刷新** = 跑一次审计 + 重写面板数据（等同主代理跑 `audit_scan`）喵。
     *
     * 为什么要有它（真机痛点）：原来只有一个「↻ 刷新」，那**只是重读同一个文件** ——
     * 快照本身陈旧/是占位时，点多少次都救不回来，用户只能去求主代理跑一次审计。
     * 人应该有**一条自己能走的路**：这条会真的重算审计并改写磁盘上的快照喵。
     *
     * 两个按钮的分工必须一眼分得清（FIX-96 ⑤）：
     * - 「↻ 刷新」= **只重读**（不动数据）
     * - 「强制刷新」= **跑审计 + 重写**（会改磁盘上的快照）
     */
    const REFRESH_LABEL = '↻ 刷新'
    const REFRESH_HINT = '只重读（不动数据）：重新读取会话血缘与派生快照。快照本身陈旧/是占位时救不回来 —— 那种情况用「强制刷新」喵'
    const FORCE_LABEL = '强制刷新'
    const FORCE_HINT = '= 跑一次审计并重写面板数据（等同主代理跑 `audit_scan`，**会改磁盘上的快照**）喵'
    /** 防连点：两次强制刷新之间的最小间隔（毫秒）喵。 */
    const FORCE_MIN_GAP_MS = 3000
    const FORCE_RUNNING_TEXT = '正在跑…'
    /** 进行中的一行说明（按钮禁用时用户要知道它在干嘛）喵。 */
    const FORCE_RUNNING_NOTE = '正在跑审计并重写面板数据…（跑完会自动重读）'

    /**
     * 节流判据（**纯函数**，便于断言；不在渲染里算）喵。
     * @returns `{ allowed, waitSeconds }`：不允许时给出还要等几秒喵。
     */
    function forceThrottle(prevAt, nowMs, gap = FORCE_MIN_GAP_MS) {
      const waited = Number.isFinite(prevAt) && prevAt > 0 ? nowMs - prevAt : Infinity
      if (waited >= gap) return { allowed: true, waitSeconds: 0 }
      return { allowed: false, waitSeconds: Math.max(1, Math.ceil((gap - waited) / 1000)) }
    }

    /**
     * 成功回执文案（**纯函数**）喵：宿主把审计结果回带过来，这里压成一句人话喵。
     * 与宿主侧 `refreshReceiptText()` 同一份口径（"审计完成：红 N / 黄 M；面板数据已重写"）喵。
     */
    function forceResultText(value) {
      const red = Number(value && value.red) || 0
      const yellow = Number(value && value.yellow) || 0
      return `审计完成：红 ${red} / 黄 ${yellow}；面板数据已重写`
    }

    /** 进行中/失败/成功三态的一行提示文案（纯函数）喵。 */
    function forceNoteText(note) {
      if (!note) return ''
      if (note.kind === 'running') return FORCE_RUNNING_NOTE
      return String(note.text || '')
    }

    /**
     * 五枚徽章的**中文全称与含义**喵（用户看不到说明就不知道 `契约?` 是什么）喵。
     * 用于图例与每一枚的 tooltip 喵。
     */
    const BADGE_INFO = {
      契约: '是否给该子智能体注入了契约（派活时注入）',
      三档: '该任务是否凑齐三档文档（L1/L2/L3）',
      进度: '该任务有没有 [Agent进度] 文件',
      预算: '契约/文档是否超预算',
      异源: '对抗审查是否用了与实现者不同的模型',
    }

    /** 徽章数据源没打通时的统一起头喵。 */
    const PENDING_SOURCE_NOTE = '三档 / 进度 / 预算徽章：数据源待接'
    /**
     * FIX-14：**「没读」与「读了没有」必须分开**喵。
     * 曾经 `rootCwd` 为空时直接 return，却把结果写成"对方未写出派生快照"——
     * 文件其实写好了，是**我们没去读**，文案把锅甩给了 host 并带偏排查喵。
     *
     * FIX-16：快照侧文案统一带上**步骤名**「读取派生快照失败」，与血缘侧的
     * 「读取会话血缘失败」互不混淆——归因必须指名是哪一步炸的喵。
     */
    const SNAPSHOT_STEP = '读取派生快照失败'
    const SNAPSHOT_NOTE_NO_ROOT = `${PENDING_SOURCE_NOTE}（${SNAPSHOT_STEP}：未能定位项目根（血缘为空）→ 未尝试读取 .agent-contract/panel.json）`
    const SNAPSHOT_NOTE_MISSING = (tried) => `${PENDING_SOURCE_NOTE}（${SNAPSHOT_STEP}：已尝试读取但文件不存在：${tried.join(' / ') || '(无候选路径)'}）`

    /** 空态三分类的文案（FIX-12 / §9-20）：提成常量，断言才能精确命中喵。 */
    const EMPTY_STATES = {
      loading: '契约面板：正在读取会话血缘…',
      failed: '契约面板：加载失败（读不到会话血缘）。',
      sourceEmpty: '契约面板：数据源为空（宿主未返回会话列表）。',
      filteredOut: '契约面板：过滤后无可见节点。',
      showAll: '显示全部',
      restoreDefault: '恢复默认过滤',
    }

    /** 派生快照的 schema 版本：**版本不认识就降级 unknown**，绝不猜字段喵。 */
    /**
     * 派生快照的 schema 版本：**版本不认识就降级 unknown**，绝不猜字段喵。
     * v2（FIX-17/21）：membersById 主索引 + audit.items 清单喵。
     */
    const PANEL_SNAPSHOT_SCHEMA_VERSION = 2

    /**
     * 本 client bundle 的插件版本喵（FIX-36）喵。
     *
     * client 是经典脚本、读不到 `package.json`，所以这里**硬编码**；套件里有一条断言
     * 把它与 `package.json` 的 version 逐字比对 —— 发版忘了改会当场红，不会静默漂移喵。
     */
    const CLIENT_PLUGIN_VERSION = '0.27.0'

    /** 快照里**必须有**的字段喵（FIX-36）喵：缺任一即判"陈旧"，不得把缺失渲染成 `0`/空列表喵。 */
    const PANEL_REQUIRED_FIELDS = ['audit', 'counts', 'members', 'membersById', 'paths', 'todos']

    /** 「陈旧快照」的提示文案喵：说清**为什么**、以及**怎么办**（触发一次审计即可重建）喵。 */
    const STALE_SNAPSHOT_NOTE = `${PENDING_SOURCE_NOTE}（快照陈旧：字段缺失或写入方版本过旧，触发一次审计即可重建；也可点「↻ 刷新」立刻重读）`

    /**
     * FIX-97 ①：**版本漂移**（进程里跑的 ≠ 磁盘上的）时说人话喵。
     * 快照同时带 `pluginVersion`（写入时现读磁盘）与 `runtimeVersion`（写它的**进程**加载时读到的）——
     * 两者不一致 = "升级了但没完整重启" ⇒ 光刷新窗口没用，必须重启应用喵。
     */
    function versionDriftNote(panel) {
      if (!panel || !panel.pluginVersion || !panel.runtimeVersion) return null
      if (String(panel.pluginVersion) === String(panel.runtimeVersion)) return null
      return `版本漂移：写入快照的进程跑的是 ${panel.runtimeVersion}，磁盘上已是 ${panel.pluginVersion}`
        + ' ⇒ 请**完整重启应用**（只刷新窗口/页面不算）'
    }

    /**
     * 面板快照的**轮询间隔**喵（FIX-38 起；FIX-47 收到 20s；**FIX-65 再收到 5s**）喵。
     *
     * 用户实测：「面板自动刷新很慢」——20 秒拍长下，宿主动作后最坏 ≈22 秒才看见喵。
     * 一次只重读**快照文件**（几 KB），5 秒一次的成本可以忽略 ⇒ 收到 5s；下限仍是 ≥5000ms（不越界）喵。
     * 真实生效值来自设置页（`pollSeconds`，默认 5 秒；关掉自动刷新即 0 = 不轮询）喵。
     */
    const PANEL_POLL_MS = 5_000

    /**
     * 每**几次**轮询做一次**整轮重载**（血缘 + 快照）喵（FIX-47；**FIX-65 定为 30 秒**）喵。
     *
     * 为什么需要：成员树（含"成员 N"计数）来自**会话血缘**，而常规轮询刻意只重读快照 ⇒
     * 实测"待办更新了、成员数没更新"（FIX-39 验收时踩到）喵。
     * 整轮重载要重拉 `remote.session.list` + 逐会话投影（最多 20 个请求），所以**低频**：
     * 5 秒拍长下每 **6** 拍 = **30 秒**一次（原来 3 拍 × 20s = 60s，太慢），成员树最坏 ≈30 秒跟上；
     * 用户点「↻ 刷新」或页面重新可见则立即喵。
     */
    const PANEL_FULL_RELOAD_EVERY = 6

    /**
     * 轮询节拍喵：返回这一拍该走「整轮重载」还是「只重读快照」喵（纯函数，便于断言）喵。
     * @param tick - 第几拍（从 1 开始）喵。
     */
    function nextPollMode(tick, every = PANEL_FULL_RELOAD_EVERY) {
      const size = Number(every) > 0 ? Math.floor(Number(every)) : 1
      const count = Number(tick) > 0 ? Math.floor(Number(tick)) : 0
      if (count === 0) return 'snapshot'
      return count % size === 0 ? 'full' : 'snapshot'
    }

    /** 该不该轮询喵：页面隐藏时别白烧 IO（拿不到 document 的环境按"该轮询"处理）喵。 */
    function shouldPoll(doc) {
      return !(doc && doc.hidden === true)
    }

    /**
     * **只重读派生快照**的刷新器喵（FIX-38）喵：复用 `loadPanel()` 留下的血缘（`lineage`），
     * 不再重拉 `remote.session.list` —— 快照才是"宿主动作之后会变"的那一份（审计/待办/徽章）喵。
     * @returns 新的面板快照；没有血缘可复用就返回 null喵。
     */
    async function refreshPanelSnapshot(ctx, scope, lineage) {
      if (!lineage || !Array.isArray(lineage.candidates)) return null
      const result = await loadPanelSnapshot(ctx, scope, lineage.candidates)
      return snapshotFromSessions(lineage.items, lineage.infos, lineage.scopeSessionId, result)
    }

    /**
     * 版本号比较喵（只比数字段，非数字段记 0；`(unknown)` 当作最低）喵。
     * @returns 负数 = a 更旧；0 = 相同；正数 = a 更新喵。
     */
    function compareVersions(a, b) {
      const parts = (value) => String(value || '')
        .split(/[.\-+]/)
        .map((piece) => {
          const number = Number.parseInt(piece, 10)
          return Number.isFinite(number) ? number : 0
        })
      const left = parts(a)
      const right = parts(b)
      const size = Math.max(left.length, right.length)
      for (let index = 0; index < size; index += 1) {
        const diff = (left[index] || 0) - (right[index] || 0)
        if (diff !== 0) return diff
      }
      return 0
    }

    /**
     * 判定一份派生快照是否**陈旧**喵（FIX-36）喵。
     *
     * 实测：`schemaVersion` 相同但**顶层键少**（旧版插件写的快照没有 `todos` / `paths`）→
     * 面板把"字段缺失"当成"待办 0 条"，**静默误导**（真值是 83 条）喵。所以三条都查：
     * ① `schemaVersion` 不匹配；② 关键字段缺失；③ 写入方插件版本**旧于**本 client。
     * @returns `{ stale, reason }`；`reason` 是给人看的短句（进 notes）喵。
     */
    function panelStaleness(panel) {
      if (!panel || typeof panel !== 'object') return { stale: true, reason: '快照不可读' }
      if (panel.schemaVersion !== PANEL_SNAPSHOT_SCHEMA_VERSION) {
        return { stale: true, reason: `schemaVersion 不匹配（期望 ${PANEL_SNAPSHOT_SCHEMA_VERSION}）` }
      }
      const missing = PANEL_REQUIRED_FIELDS.filter((key) => panel[key] === undefined || panel[key] === null)
      if (missing.length) return { stale: true, reason: `字段缺失：${missing.join('、')}` }
      // 版本：缺 `pluginVersion` 本身就是"旧版写的"（旧快照没有这个键）喵
      const writer = panel.pluginVersion
      if (!writer) return { stale: true, reason: '快照未带写入方版本（旧版插件写的）' }
      if (compareVersions(writer, CLIENT_PLUGIN_VERSION) < 0) {
        return { stale: true, reason: `快照由旧版插件（${writer}）写入，当前 ${CLIENT_PLUGIN_VERSION}` }
      }
      return { stale: false, reason: null }
    }

    /**
     * FIX-24：同名成员退化告警的**统一文案**喵。
     *
     * 它原先只挂在五枚徽章各自的 tooltip 上，而卡片/名字的 tooltip 是 session UUID ——
     * 用户悬停卡片只看得到 UUID，**根本发现不了告警**（实测：3 个同名节点里 2 个走了退化路径）喵。
     * 所以：卡片与名字的 tooltip 都要带上它，节点旁再给一个 ⚠ 角标（灰度下也看得见）喵。
     */
    const FALLBACK_WARN = '⚠ 同名成员可能串徽章（该节点按成员名匹配，见 FIX-17）'

    /** 卡片/名字的 tooltip：会话 id 与退化告警并列喵。 */
    function nodeTooltip(node) {
      const id = (node && node.sessionId) || ''
      return node && node.badgeFallback ? `${id}\n${FALLBACK_WARN}`.trim() : id
    }

    /** 退化节点的角标文本（不是退化就给空串，不占位）喵。 */
    function fallbackMark(node) {
      return node && node.badgeFallback ? '⚠' : ''
    }
    const PANEL_SNAPSHOT_REL = '.agent-contract/panel.json'

    /** 按 root 的分隔符风格拼路径（避免 Windows 上出混合分隔符）喵。 */
    function joinRoot(root, rel) {
      const base = String(root || '').replace(/[\\/]+$/, '')
      if (!base) return null
      const sep = base.includes('\\') ? '\\' : '/'
      return `${base}${sep}${rel.replace(/\//g, sep)}`
    }

    /** 统一的错误文案提取（归因分步用）喵。 */
    function messageOf(error) {
      return String(error && error.message ? error.message : error)
    }

    /**
     * 解包 gateway remote 的返回喵（**本轮实锤的第二个真凶**）喵。
     *
     * 每个 remote 方法都 resolve 成**信封** ——
     * `RemoteResult<T> = { ok: true, value: T } | { ok: false, error }`
     * （见 `packages/typert/protocol/src/types.ts:76`），**不是裸值**喵。
     * 官方用法同样是解包后再取：`if (result.ok) … result.value.items`
     * （`packages/api/session-controller/src/client/sessions/manager.ts:403`）喵。
     * 曾经直接读 `result.items` → 永远 undefined → 面板恒定"数据源为空"喵。
     * 裸值 / 裸数组也一并接受，免得宿主改封装就脆掉喵。
     */
    function unwrapRemote(result) {
      if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
        return result.ok === true ? { ok: true, value: result.value } : { ok: false, error: result.error }
      }
      return { ok: true, value: result }
    }

    /** 把 remote 的 error 分支渲染成人话喵。 */
    function remoteErrorText(error) {
      if (!error || typeof error !== 'object') return String(error)
      const code = error.code ? String(error.code) : '(无 code)'
      const message = error.message ? `：${String(error.message)}` : ''
      return `${code}${message}`
    }

    // ---------------------------------------------------------------- 纯映射逻辑（可单测）
    /** 成员名 `<任务号>-<角色>` 反解（以最后一个 `-` 为界，与 host 侧 naming.js 同口径）喵。 */
    function parseMemberName(name) {
      const value = String(name ?? '')
      const index = value.lastIndexOf('-')
      if (index <= 0 || index === value.length - 1) return null
      return { taskId: value.slice(0, index), role: value.slice(index + 1) }
    }

    const shortId = (id) => String(id ?? '').slice(0, 8)

    /** 从 `sessionId` 沿 parentSessionId 上溯到最顶层祖先喵。 */
    function topAncestor(byId, sessionId) {
      let current = sessionId
      const seen = new Set()
      while (byId.has(current) && !seen.has(current)) {
        seen.add(current)
        const parent = byId.get(current).parentSessionId
        if (!parent || !byId.has(parent)) break
        current = parent
      }
      return current
    }

    /**
     * 求「以谁为根」喵（**FIX-12**）喵。
     *
     * 关键回退：`items` 里**找不到当前会话**时，绝不原样返回 scope id —— 那会让
     * `subtreeOf()` 的 `byId.has(rootId)` 为假、返回空树，面板就成了「成员 0」喵。
     * 回退顺序：① scope 的祖先链（能找到就用最顶层）② `items` 里的顶层根
     * （没有父、或父不在 items 里）③ 最后兜底把每条都当根（不要求 scope 在 items 里）喵。
     */
    function rootsOf(items, sessionId) {
      const rows = (items || []).filter((row) => row && row.sessionId)
      if (!rows.length) return []
      const byId = new Map(rows.map((row) => [row.sessionId, row]))
      if (sessionId && byId.has(sessionId)) return [topAncestor(byId, sessionId)]
      const topLevel = rows
        .filter((row) => !row.parentSessionId || !byId.has(row.parentSessionId))
        .map((row) => row.sessionId)
      return topLevel.length ? topLevel : rows.map((row) => row.sessionId)
    }

    /** 兼容入口：取第一个根（没有根时返回传入的 id，保持旧签名行为）喵。 */
    function rootOf(items, sessionId) {
      const roots = rootsOf(items, sessionId)
      return roots.length ? roots[0] : sessionId
    }

    /** 组织成树：只保留 rootId 子树里的行，按 parentSessionId 挂链喵。 */
    function subtreeOf(items, rootId) {
      const rows = (items || []).filter((row) => row && row.sessionId)
      const byId = new Map(rows.map((row) => [row.sessionId, row]))
      const childrenOf = new Map()
      for (const row of rows) {
        const parent = row.parentSessionId
        if (!parent || !byId.has(parent)) continue
        if (!childrenOf.has(parent)) childrenOf.set(parent, [])
        childrenOf.get(parent).push(row)
      }
      const build = (id, layer) => {
        const row = byId.get(id)
        if (!row) return null
        const children = (childrenOf.get(id) || [])
          .map((child) => build(child.sessionId, layer + 1))
          .filter(Boolean)
        return { row, layer, children }
      }
      return byId.has(rootId) ? [build(rootId, 0)].filter(Boolean) : []
    }

    /**
     * 状态推导喵。
     * `running` 是权威；不跑但还持有活 Agent ⇒ idle（常驻后台）；都不满足 ⇒ 已结束/已释放喵。
     */
    /**
     * 宿主状态词 → 面板状态词的**别名表**喵（FIX-20）喵。
     * 只认表里有的：不认识的词一律不猜（宁可继续走 running/agentAvailable 近似）喵。
     */
    const STATUS_ALIASES = {
      running: 'running',
      active: 'running',
      idle: 'idle',
      open: 'idle',
      completed: 'completed',
      complete: 'completed',
      done: 'completed',
      failed: 'failed',
      failure: 'failed',
      error: 'failed',
      errored: 'failed',
      released: 'released',
      disposed: 'released',
      closed: 'released',
    }

    /**
     * 状态派生喵（FIX-20：五态都要有可见表达）喵。
     *
     * 顺序刻意是「宿主显式状态 → 运行中 → 空闲 → 已完成」喵：
     * `failed` / `released` 这类**只有宿主知道**（客户端从 running/agentAvailable 推不出来），
     * 所以宿主给了状态词就以它为准；没给才退回原来的两布尔近似（不改旧行为）喵。
     */
    function deriveStatus(row) {
      if (!row) return 'unknown'
      const declared = typeof row.status === 'string' ? STATUS_ALIASES[row.status.toLowerCase()] : null
      if (declared) return declared
      if (row.running === true) return 'running'
      if (row.agentAvailable === true) return 'idle'
      return 'completed'
    }

    /**
     * 模式判定喵（**FIX-7 / DESIGN §9-18**）喵。
     *
     * **禁止**再用 `agentAvailable` 近似：已结算的后台成员 `agentAvailable=false`，
     * 会被近似成 `one-shot`，再被默认过滤 `hideDoneOneShot` 整片吃掉（实测事故）喵。
     * 权威来源是 `subagentCatalog` 投影（与宿主 UI 显示"可继续/一次性"同源）；
     * 投影缺失就保留 `unknown` —— **unknown 默认可见**，宁多显示不静默隐藏喵。
     */
    function deriveMode(row, info) {
      if (info && (info.mode === 'one-shot' || info.mode === 'continuable')) return info.mode
      if (!row) return 'unknown'
      // 主代理会话本身就是常驻的，这不是"对子智能体模式的近似"喵
      if (row.origin !== 'subagent') return 'continuable'
      return 'unknown'
    }

    /**
     * 异源徽章喵（**可推导的那两枚之一**）喵。
     * 只对 adversary 判定：模型与参照模型相同 ⇒ 非真异源 ✗；不同 ⇒ ✓；信息不足 ⇒ unknown喵。
     * 参照模型取该节点的上级；M4 接真审计后改为与 implementer 对比喵。
     */
    function crossVendorBadge(role, ownModel, referenceModel) {
      if (role !== 'adversary') return 'unknown'
      if (!ownModel || !referenceModel) return 'unknown'
      return ownModel === referenceModel ? 'missing' : 'ok'
    }

    /** 由一行会话 + 可选投影信息派生一个面板节点喵。 */
    function deriveNode(row, layer, info) {
      const isSub = row.origin === 'subagent'
      const label = info && typeof info.label === 'string' && info.label ? info.label : null
      const parsed = label ? parseMemberName(label) : null
      const role = parsed ? parsed.role : (isSub ? null : '主代理')
      return {
        sessionId: row.sessionId,
        taskId: parsed ? parsed.taskId : null,
        name: label || (isSub ? `子智能体 ${shortId(row.sessionId)}` : '主代理'),
        role,
        mode: deriveMode(row, info),
        layer,
        status: deriveStatus(row),
        modelRoute: info && info.model ? info.model : null,
        latestDeliverable: null,
        lastActiveAt: Number.isFinite(row.updatedAt) ? new Date(row.updatedAt).toISOString() : null,
        badges: {
          // 契约：被派出的子智能体必然注入过契约；主代理不适用喵
          contract: isSub ? 'ok' : 'unknown',
          docs: 'unknown',
          progress: 'unknown',
          budget: 'unknown',
          crossVendor: 'unknown',
        },
        children: [],
      }
    }

    /**
     * 挂上异源徽章喵。
     * 参照模型按 DESIGN §5.7 的口径取**同批 implementer 的模型**（更贴 cross_vendor 的原意），
     * 没有 implementer 时退回上级模型；两者都没有就保持 unknown 喵。
     */
    function attachCrossVendor(nodes, inheritedReference) {
      // 参照模型要在**同一层**里找：adversary 与 implementer 通常是兄弟节点喵
      const siblingImplementer = (nodes || []).find((node) => node.role === 'implementer')
      const reference = (siblingImplementer && siblingImplementer.modelRoute) || inheritedReference
      for (const node of nodes || []) {
        node.badges.crossVendor = crossVendorBadge(node.role, node.modelRoute, reference)
        attachCrossVendor(node.children, node.modelRoute || reference)
      }
    }

    /** 拓扑视口的缩放/平移常量（对齐 better-sidebar 的 tasks-graph）喵。 */
    const ZOOM_MIN = 0.4
    const ZOOM_MAX = 2
    const FIT_MAX_SCALE = 1.3
    const FIT_MARGIN = 24
    const CLICK_TOLERANCE_PX = 4

    /**
     * 恢复视图转换时的校验/夹取喵：非有限数一律判无效（宁可重新自适应），
     * 缩放界外的把 k 夹回 `[ZOOM_MIN, ZOOM_MAX]` 而不是丢弃（用户手调的位置尽量留着）喵。
     * @returns `{ x, y, k }` 或 null喵。
     */
    function clampTf(value) {
      if (!value || typeof value !== 'object') return null
      const k = Number(value.k)
      const x = Number(value.x)
      const y = Number(value.y)
      if (!Number.isFinite(k) || !Number.isFinite(x) || !Number.isFinite(y)) return null
      return { k: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k)), x, y }
    }

    /**
     * 视口自适应喵（纯函数，可单测）喵：把内容框居中装进容器并留边，缩放上限 FIT_MAX_SCALE
     * （免得两个节点的小树被吹得满屏）喵。
     * @returns `{ x, y, k }`喵。
     */
    function fitViewport(contentWidth, contentHeight, viewWidth, viewHeight) {
      const cw = Number(viewWidth) > 0 ? Number(viewWidth) : contentWidth + FIT_MARGIN * 2
      const ch = Number(viewHeight) > 0 ? Number(viewHeight) : contentHeight + FIT_MARGIN * 2
      const k = Math.min(
        FIT_MAX_SCALE,
        Math.max(
          ZOOM_MIN,
          Math.min(
            (cw - FIT_MARGIN * 2) / Math.max(1, contentWidth),
            (ch - FIT_MARGIN * 2) / Math.max(1, contentHeight),
          ),
        ),
      )
      return { k, x: (cw - contentWidth * k) / 2, y: Math.max(FIT_MARGIN / 2, (ch - contentHeight * k) / 2) }
    }

    /** 扁平化取所有节点喵。 */
    function flattenNodes(nodes, rows = []) {
      for (const node of nodes || []) {
        rows.push(node)
        flattenNodes(node.children, rows)
      }
      return rows
    }

    /**
     * 拓扑布局喵（纯函数，可单测）喵。
     *
     * 整齐树布局：按层定 `y`，叶子从左往右依次排 `x`，父节点**居中于其首末子节点之间**喵。
     * 不引入任何图形库——我们的谱系通常 ≤20 个节点，这样已经够看喵。
     *
     * @returns `{ cards, edges, width, height, cardWidth, cardHeight }`喵。
     */
    function layoutTopology(roots, options) {
      const opts = options || {}
      // 卡片宽 240：FIX-20 起徽章改成「符号 + 中文状态词」（`✓正常`），五枚并排要放得下喵
      const cardWidth = Number(opts.cardWidth) > 0 ? Number(opts.cardWidth) : 240
      const cardHeight = Number(opts.cardHeight) > 0 ? Number(opts.cardHeight) : 92
      const gapX = Number(opts.gapX) > 0 ? Number(opts.gapX) : 14
      const gapY = Number(opts.gapY) > 0 ? Number(opts.gapY) : 56
      const cards = []
      const edges = []
      let cursor = 0
      let maxDepth = 0

      const walk = (node, depth) => {
        maxDepth = Math.max(maxDepth, depth)
        const children = Array.isArray(node.children) ? node.children : []
        let x
        if (!children.length) {
          x = cursor
          cursor += cardWidth + gapX
        } else {
          const xs = children.map((child) => walk(child, depth + 1))
          x = (xs[0] + xs[xs.length - 1]) / 2
        }
        const y = depth * (cardHeight + gapY)
        cards.push({ node, x, y, depth })
        for (const child of children) {
          const target = cards.find((card) => card.node === child)
          if (!target) continue
          edges.push({
            x1: x + cardWidth / 2,
            y1: y + cardHeight,
            x2: target.x + cardWidth / 2,
            y2: target.y,
          })
        }
        return x
      }

      for (const root of roots || []) {
        walk(root, 0)
        cursor += gapX * 2
      }
      return {
        cards,
        edges,
        width: Math.max(cardWidth, cursor - gapX),
        height: (maxDepth + 1) * cardHeight + maxDepth * gapY,
        cardWidth,
        cardHeight,
      }
    }

    /**
     * 把派生快照里的徽章按**成员名**贴回节点喵。
     * 快照缺失或版本不认识时什么都不做——节点保持 unknown（**降级，不猜**）喵。
     */
    /**
     * 把派生快照里的徽章贴到节点上喵。
     *
     * **FIX-17**：优先按 `sessionId` 取（`membersById`），**取不到才退化按 `name`**——
     * 同名多轮成员（`T99-…-reviewer` × 3）按名归并会让所有同名节点共用最后一条的徽章、
     * 旧会话 id 直接丢失（核验报告 FIX-27 实测）喵。
     * 退化命中时给节点打 `badgeFallback` 标记并在 tooltip 里写明，**不许静默串徽章**喵。
     */
    function applyPanelBadges(nodes, panel) {
      const byId = panel && panel.membersById ? panel.membersById : null
      const byName = panel && panel.members ? panel.members : null
      for (const node of nodes || []) {
        let entry = null
        let fellBack = false
        if (node && node.sessionId && byId && byId[node.sessionId]) entry = byId[node.sessionId]
        else if (node && byName && byName[node.name]) { entry = byName[node.name]; fellBack = true }
        if (entry && entry.badges) {
          node.badges = { ...node.badges, ...entry.badges }
          node.hasAudit = true
          node.badgeFallback = fellBack
          // FIX-73 ①：快照里的成员字段要**落到节点上** —— 否则 `deriveMode()` 拿不到 mode，
          // 常驻角色（如图书管理员）在面板上会被显示成"前台/未知"（真机原话："居然是非长期性 agent"）✗ 喵
          node.notCounted = false
          if (entry.mode) node.mode = entry.mode
          // FIX-86 ①：**记录优先** —— 常驻单例的会话标签就是 `librarian`（没有任务号前缀）⇒
          // `parseMemberName()` 解析不出来，只能靠成员记录里的 role 才显示得出"图书管理员"喵
          if (entry.role) node.role = entry.role
          if (Array.isArray(entry.deliverableKinds)) node.deliverableKinds = entry.deliverableKinds
          if (Array.isArray(entry.capabilities)) node.capabilities = entry.capabilities
          if (entry.status) node.status = entry.status
          if (entry.model) node.modelRoute = entry.model
        } else {
          // FIX-73 ②：树里有这个节点、快照里还没有它的成员记录 ⇒ 空窗期，标上让徽章给**可执行解释**喵
          node.notCounted = true
        }
        applyPanelBadges(node.children, panel)
      }
    }

    /**
     * 从派生快照里取出面板要用的 audit 摘要（含清单）喵（FIX-21/27）喵。
     * 拿不到就标 `placeholder` —— 面板据此写"数据源待接"，**绝不写 0 红 0 黄**（那等于谎报全绿）喵。
     */
    function auditFromPanel(panel) {
      if (!panel || !panel.audit) return { red: 0, yellow: 0, green: 0, items: [], placeholder: true }
      return {
        red: panel.audit.red,
        yellow: panel.audit.yellow,
        green: panel.audit.level === 'green' ? 1 : 0,
        level: panel.audit.level || null,
        items: Array.isArray(panel.audit.items) ? panel.audit.items : [],
      }
    }

    /**
     * 由会话行 + 投影信息 + 可选派生快照造出面板快照喵（纯函数，全部可单测）喵。
     * @param items - `remote.session.list` 的 items喵。
     * @param infos - `sessionId → { label, mode, model }` 投影信息表喵。
     * @param scopeSessionId - 当前会话 id（面板以它的最顶层祖先为根）喵。
     * @param panel - `.agent-contract/panel.json` 的内容（拿不到就是 null）喵。
     */
    function snapshotFromSessions(items, infos, scopeSessionId, panelResult) {
      // 兼容两种入参：直接给快照对象，或给 loadPanelSnapshot 的 { panel, notes } 喵
      const box = panelResult && typeof panelResult === 'object' && Object.prototype.hasOwnProperty.call(panelResult, 'panel')
        ? panelResult
        : { panel: panelResult, notes: null }
      // FIX-12：可能有多棵树（scope 不在 items 里时退化为整片森林）喵
      const tree = rootsOf(items, scopeSessionId).flatMap((rootId) => subtreeOf(items, rootId))
      const build = (entry) => {
        const node = deriveNode(entry.row, entry.layer, infos ? infos[entry.row.sessionId] : null)
        node.children = entry.children.map(build)
        return node
      }
      const roots = tree.map(build)
      attachCrossVendor(roots, null)
      // FIX-36：`schemaVersion` 相同但**字段缺失/旧版写的**一样算陈旧 —— 否则"字段没写"会被当成 0 条喵
      const verdict = box.panel ? panelStaleness(box.panel) : null
      const usable = verdict && !verdict.stale ? box.panel : null
      // FIX-96 回归修复：**"路径"可以来自陈旧快照**（见下面 `paths` 处的说明）—— 只有"数据/结论"才必须新鲜喵
      const pathBox = usable || (box.panel && typeof box.panel === 'object' ? box.panel : null)
      applyPanelBadges(roots, usable)
      const members = flattenNodes(roots)
      const byStatus = {}
      for (const node of members) byStatus[node.status] = (byStatus[node.status] || 0) + 1
      const notes = []
      if (!usable) {
        if (Array.isArray(box.notes) && box.notes.length) notes.push(...box.notes)
        if (verdict && verdict.stale) notes.push(`${STALE_SNAPSHOT_NOTE}（${verdict.reason}）`)
        if (!notes.length) notes.push(PENDING_SOURCE_NOTE)
      } else if (Array.isArray(box.notes) && box.notes.length) {
        // 快照新鲜时也把 host 的 notes 带上（FIX-97：里面有"插件自检异常"这类要说给用户的话）喵
        notes.push(...box.notes)
      }
      // FIX-97 ①：版本漂移（进程 ≠ 磁盘）—— 这条要进面板，不能只躺在文件里喵
      const driftNote = box.panel ? versionDriftNote(box.panel) : null
      if (driftNote && !notes.includes(driftNote)) notes.push(driftNote)
      return {
        project: { name: usable && usable.project ? usable.project.name || '' : '', root: '' },
        members,
        roots,
        counts: {
          members: byStatus,
          docs: usable && usable.counts ? usable.counts.docs : 'unknown',
          tasks: usable && usable.counts ? usable.counts.tasks : 'unknown',
        },
        // FIX-21/36：快照陈旧时 `audit` 走 placeholder（写"数据源待接"），**不写 0 红 0 黄**喵
        audit: auditFromPanel(usable),
        source: usable ? 'remote.session + panel.json' : 'remote.session',
        // FIX-36：陈旧 ⇒ `todos: null`（**未知**），与"快照新鲜但确实没有待办"（`[]`）区分开喵
        stale: !usable && Boolean(box.panel),
        staleReason: verdict && verdict.stale ? verdict.reason : null,
        todos: usable ? (Array.isArray(usable.todos) ? usable.todos : []) : null,
        // FIX-96 回归修复：**路径**与"数据/结论"要分开对待 —— 「待办文件在哪」这件事不随 schema 变旧而失效，
        // 而「强制刷新」这条救援路**恰恰**要在快照陈旧/是占位（也就是数据不可信）时能用。
        // 真机实证：快照是 0.17.0 写的 ⇒ 整个 `paths` 被当陈旧一起丢掉 ⇒ 按钮报"拿不到待办文件路径"，
        // **正好在最需要它的时候失灵** ✗。取不到路径的代价只是宿主那条路由会 403（有明确原因），不会写错文件喵
        paths: {
          todoFile: pathBox && pathBox.paths && pathBox.paths.todoFile ? String(pathBox.paths.todoFile) : null,
        },
        // FIX-97 ③：host 写的"**插件自检异常**"（典型：台账领域打不开 ⇒ 同步器没挂上）原样带出去，
        // 面板要在页面上直接说，别让用户只看到"数据不新鲜"却不知道原因喵
        setupError: box.panel && box.panel.setupError ? box.panel.setupError : null,
        // FIX-14：把「没读」与「读了没有」的原因原样带出来喵
        notes,
      }
    }

    // ---------------------------------------------------------------- 取数（薄，全部兜错）
    /**
     * 从投影值包里取一个键喵：**普通对象**（wire 形态）与 Map（内存形态）都吃喵。
     * 曾经只认 `.get()`，而 `SessionProjectionHints.values` 是**普通对象** ✗
     * —— 于是 label / mode 全取不到，节点名退化成「子智能体 <短id>」、角色显示成成员灰喵。
     */
    function projectionValue(values, key) {
      if (!values || typeof values !== 'object') return undefined
      if (typeof values.get === 'function') return values.get(key)
      return values[key]
    }

    /**
     * 取一个会话的投影信息喵。
     * `subagentCatalog` 是**父**会话看到的直接子节点目录（含权威 `mode` 与 `label`），
     * 所以这里把子节点信息一并带出来，由 `mergeInfos` 合并给对应子会话喵（FIX-7）喵。
     */
    function loadInfo(values) {
      try {
        const model = projectionValue(values, 'modelSelection')
        const subagent = projectionValue(values, 'subagent')
        const catalog = projectionValue(values, 'subagentCatalog')
        const children = {}
        for (const entry of Array.isArray(catalog) ? catalog : []) {
          if (!entry || !entry.id) continue
          children[entry.id] = {
            mode: typeof entry.mode === 'string' ? entry.mode : null,
            label: typeof entry.label === 'string' ? entry.label : null,
          }
        }
        return {
          label: subagent && typeof subagent.label === 'string' ? subagent.label : null,
          mode: subagent && typeof subagent.mode === 'string' ? subagent.mode : null,
          model: model && typeof model.model === 'string' ? model.model : null,
          children,
        }
      } catch {
        return null
      }
    }

    /** 把「子节点信息」合并到对应子会话上：自身投影优先，其次父的 catalog喵。 */
    function mergeInfos(items, raw) {
      const merged = {}
      for (const row of items) {
        if (!row || !row.sessionId) continue
        const own = raw[row.sessionId] || {}
        const fromParent = (raw[row.parentSessionId] && raw[row.parentSessionId].children
          && raw[row.parentSessionId].children[row.sessionId]) || {}
        const parentMode = fromParent.mode && fromParent.mode !== 'unknown' ? fromParent.mode : null
        merged[row.sessionId] = {
          label: own.label || fromParent.label || null,
          mode: own.mode || parentMode || null,
          model: own.model || null,
        }
      }
      return merged
    }

    /** 判断一个会话上的投影块并取出**值包**喵：wire 形态是普通对象 `{ values: {...} }`喵。 */
    function projectionsOf(row) {
      const hints = row && row.projections
      if (!hints || typeof hints !== 'object') return null
      return hints.values && typeof hints.values === 'object' ? hints.values : hints
    }

    /**
     * 读派生快照喵（方案 a）：只走宿主现成的 `remote.workspaceFiles.read`，不自造 IPC 喵。
     *
     * FIX-14 的两条纪律喵：
     * ① **候选路径可回退**：根会话 cwd → 当前会话自身的 cwd（拿不到根时仍有机会读到）；
     * ② 结果是 `{ panel, notes }`，**把「没读」与「读了没有」分开报**，绝不把"没尝试读取"写成"对方未写出"喵。
     */
    async function loadPanelSnapshot(ctx, scope, candidates) {
      const workspaceFiles = ctx && ctx.remote && ctx.remote.workspaceFiles
      if (!workspaceFiles || typeof workspaceFiles.read !== 'function') {
        return { panel: null, notes: [`${PENDING_SOURCE_NOTE}（${SNAPSHOT_STEP}：remote.workspaceFiles 未注入，检查 client inject）`] }
      }
      // 官方客户端的调用姿势是 **sessionId 字符串**作第一参（wire 字段 `workspaceFileScopeId`）喵——
      // 曾经把整个 TabComponentProps.scope 对象传进去，网关直接 `boundary validation` 拒掉喵。
      const sessionId = typeof scope === 'string' ? scope : (scope && scope.sessionId)
      const tried = [...new Set((candidates || []).filter(Boolean))]
      if (!sessionId || !tried.length) {
        // 连候选项都没有 ⇒ 我们**根本没读**，不许说成"对方没写"喵
        return { panel: null, notes: [SNAPSHOT_NOTE_NO_ROOT] }
      }
      for (const path of tried) {
        try {
          // 信封解包：`{ ok, value }`，不是裸值喵
          const envelope = unwrapRemote(await workspaceFiles.read(sessionId, path, {}, undefined))
          if (!envelope.ok) {
            return {
              panel: null,
              notes: [`${PENDING_SOURCE_NOTE}（${SNAPSHOT_STEP}：remote 返回 ok=false（${remoteErrorText(envelope.error)}））`],
            }
          }
          const value = envelope.value
          const text = value && typeof value.text === 'string' ? value.text : null
          if (!text) continue
          const parsed = JSON.parse(text)
          if (parsed && parsed.schemaVersion === PANEL_SNAPSHOT_SCHEMA_VERSION) return { panel: parsed, notes: [] }
          return { panel: null, notes: [`${PENDING_SOURCE_NOTE}（${SNAPSHOT_STEP}：schemaVersion 不匹配，期望 ${PANEL_SNAPSHOT_SCHEMA_VERSION}）`] }
        } catch {
          /* 这个候选读不到，换下一个喵 */
        }
      }
      return { panel: null, notes: [SNAPSHOT_NOTE_MISSING(tried)] }
    }

    /**
     * 取面板快照喵：**只走宿主现成 remote**，任何一步失败都降级为空态，绝不抛错喵。
     * 血缘来自 `remote.session.*`；徽章来自工作区内的派生快照 `.agent-contract/panel.json`喵。
     * @param ctx - client cordis 上下文喵。
     * @param scope - 当前会话作用域（`scope.sessionId`）喵。
     */
    async function loadPanel(ctx, scope) {
      // FIX-13：`ctx.remote.<ns>` 只有在本 client 模块导出的 inject 里声明了才可用喵。
      // 这里把「remote 没注入」与「宿主返回空列表」**分开报**，不把看不到数据一律说成"数据源为空"喵。
      const remoteRoot = ctx && ctx.remote
      if (!remoteRoot) return { failed: true, reason: 'remote 未注入（检查 client inject）' }
      const sessionRemote = remoteRoot.session
      if (!sessionRemote || typeof sessionRemote.list !== 'function') {
        return { failed: true, reason: 'remote.session 未注入（检查 client inject）' }
      }
      // 第一步：读**会话血缘**喵。失败即整轮 failed，文案**指名这一步**（FIX-16：不许与快照共用一句 catch）喵
      let items = []
      let infos = {}
      const scopeSessionId = scope && scope.sessionId
      try {
        // 信封解包：`{ ok, value }`，不是裸值喵
        const envelope = unwrapRemote(await sessionRemote.list({}))
        if (!envelope.ok) throw new Error(`remote 返回 ok=false（${remoteErrorText(envelope.error)}）`)
        const value = envelope.value
        items = Array.isArray(value) ? value : ((value && value.items) || [])
        const raw = {}
        let fetched = 0
        for (const row of items) {
          if (!row || !row.sessionId) continue
          let info = loadInfo(projectionsOf(row))
          // 行的 hints 可能省略 label/mode（子智能体那一行尤其常见）→ 单独拉一次该会话的**权威投影**喵。
          // 上限 20 条：面板不为了补名字把宿主打爆喵。
          const needsMore = row.origin === 'subagent' && (!info || !info.mode || !info.label)
          if (needsMore && fetched < 20 && typeof sessionRemote.projections === 'function') {
            try {
              const envelope = unwrapRemote(await sessionRemote.projections({ sessionId: row.sessionId }))
              if (envelope.ok && envelope.value) {
                info = loadInfo(envelope.value.values) || info
                fetched += 1
              }
            } catch {
              /* 单个会话拉不到不影响其它喵 */
            }
          }
          raw[row.sessionId] = info
        }
        infos = mergeInfos(items, raw)
      } catch (error) {
        // FIX-27：血缘失败 **≠** 快照不可读 —— 两条链路彼此独立。这里仍尽力读一次派生快照
        // （血缘没了，候选路径只能退到 scope 自身的 cwd），好让 failed 空态也能显示审计红黄喵。
        let fallback = { panel: null, notes: [] }
        try {
          fallback = await loadPanelSnapshot(ctx, scope, [joinRoot(scope && scope.cwd, PANEL_SNAPSHOT_REL)])
        } catch {
          fallback = { panel: null, notes: [] }
        }
        return {
          failed: true,
          reason: `读取会话血缘失败：${messageOf(error)}`,
          audit: auditFromPanel(fallback.panel),
          notes: fallback.notes,
        }
      }

      // FIX-16：用**注入后**的 ctx（`props.remoteCtx`），不是渲染期的 `props.ctx` 喵
      // 第二步：读**派生快照**喵。失败只降级徽章（不整轮 failed），文案同样指名这一步喵
      // FIX-14 回退：根会话 cwd → 当前会话自身的 cwd（拿不到根时仍有读取机会）喵
      const rootRow0 = items.find((row) => row && row.sessionId === rootsOf(items, scopeSessionId)[0])
      const scopeRow0 = items.find((row) => row && row.sessionId === scopeSessionId)
      const candidates = [
        joinRoot(rootRow0 && rootRow0.cwd, PANEL_SNAPSHOT_REL),
        joinRoot(scopeRow0 && scopeRow0.cwd, PANEL_SNAPSHOT_REL),
      ]
      let snapshotResult
      try {
        snapshotResult = await loadPanelSnapshot(ctx, scope, candidates)
      } catch (error) {
        snapshotResult = { panel: null, notes: [`${PENDING_SOURCE_NOTE}（读取派生快照失败：${messageOf(error)}）`] }
      }
      // FIX-38：把**原始血缘**一并带出去 —— 面板要能事后只重读快照（不必重拉整个血缘）喵
      return {
        ...snapshotFromSessions(items, infos, scopeSessionId, snapshotResult),
        lineage: { items, infos, scopeSessionId, candidates },
      }
    }

    /**
     * 面板视图状态判定喵（纯函数，便于单测）喵。
     *
     * FIX-13 / §9-20：把四种成因**分开**——`loading` / `failed`（附原因）/
     * `emptySource`（远程确实返回了空列表）/ `filteredOut`（有数据但被默认过滤挡住）喵。
     * 把"remote 没注入"说成"数据源为空"曾经把排查方向带偏一整轮喵。
     */
    function panelViewState({ loading, failure, snapshot, prefs }) {
      if (loading) return { kind: 'loading' }
      if (failure) return { kind: 'failed', reason: failure }
      // FIX-51：失败原因必须具体（点出取不到的是哪一步），不许写"未知原因"把人晾在原地喵
      if (!snapshot) return { kind: 'failed', reason: '未取到面板快照（血缘与快照两条路都没拿到，可点「↻ 刷新」重试）' }
      if (!snapshot.members.length) return { kind: 'emptySource' }
      const rows = flattenTree(filterTree(snapshot.roots, prefs))
      if (!rows.length) return { kind: 'filteredOut', total: snapshot.members.length }
      return { kind: 'tree', rows }
    }

    // ---------------------------------------------------------------- 待办区（FIX-29）
    /** 待办原文默认只渲染前 80 行（超长文件不卡），点「展开全部」才全渲染喵。 */
    const TODO_PREVIEW_LINES = 80

    /**
     * 待办**写通道**的路径喵（FIX-41）喵：与宿主 `todo-route.js` 注册的是同一条
     * （`/agent-contract/api/todo`，同源相对 URL）喵。
     */
    const TODO_ROUTE_PATH = '/agent-contract/api/todo'

    /**
     * 文本指纹喵（FNV-1a 32 位，按 UTF-16 code unit）—— **必须与宿主 `todo-route.js` 的 `hashText` 逐位一致**喵。
     * 用途只有一个：把"我渲染的是哪一版"告诉宿主，让它在文件被别人改过时**拒绝覆盖**（并发写保护）喵。
     * 套件里有一条交叉断言拿同一批输入比对两边结果，防实现漂移喵。
     */
    function hashText(text) {
      const source = String(text ?? '')
      let hash = 0x811c9dc5
      for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
      }
      return hash.toString(16).padStart(8, '0')
    }

    /**
     * 指纹输入的**规范化**喵（FIX-42）喵：**必须与宿主 `todo-route.js` 的同名函数逐字一致**喵。
     *
     * 为什么要它：宿主 `remote.workspaceFiles.read` 走的是 harness 的 `cutPage()`，
     * 文件以换行结尾时会**吃掉尾换行**（`if (current.length > 0) complete()` 不 push 尾空行），
     * 而宿主写路由用 node `readFile()` 保留尾换行 ⇒ 不规范化的话，未改动的文件也永远 409 喵。
     */
    function normalizeHashInput(text) {
      return String(text ?? '').replace(/[\r\n]+$/, '')
    }

    /**
     * 调宿主的待办**写通道**喵（FIX-41）喵 —— 这是面板**唯一**的写路径喵。
     *
     * 白名单（只那一个文件）、写前备份、外部改动冲突检测、行级勾选**全部在宿主侧**执行；
     * client 只负责"发起 + 把结果如实显示出来"（⑦ 不许静默）喵。
     * @returns `{ ok: true, value } | { ok: false, error: { code, message } }`喵。
     */
    async function postTodo(payload, fetchImpl) {
      const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null)
      if (!doFetch) {
        return { ok: false, error: { code: 'no-fetch', message: '当前环境没有 fetch，无法写入待办文件' } }
      }
      try {
        const response = await doFetch(TODO_ROUTE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const value = await response.json().catch(() => null)
        if (value && typeof value.ok === 'boolean') return value
        return {
          ok: false,
          error: { code: `http-${response && response.status}`, message: `写通道返回了意外内容（HTTP ${response && response.status}）` },
        }
      } catch (error) {
        return { ok: false, error: { code: 'network', message: messageOf(error) } }
      }
    }

    /**
     * 冲突时把**宿主回带的实际值**整理成一句诊断喵（FIX-45 ①）喵。
     * 只进 tooltip：可见文案仍是"刷新后重试"，诊断信息不占版面也不误导操作喵。
     */
    function todoConflictDetail(result) {
      if (!result || !result.error || result.error.code !== 'stale-file') return ''
      const hash = result.actualHash === undefined || result.actualHash === null ? '(读不到)' : String(result.actualHash)
      const length = result.actualLength === undefined ? '(未知)' : String(result.actualLength)
      return `宿主侧实际值：hash=${hash}，长度=${length}；我送出的 baseHash 与之不符 ⇒ 期间文件被改过喵`
    }

    /** 把写通道的失败翻成人话（面板必须明示，不许静默）喵。 */
    function todoErrorText(error) {
      const code = error && error.code ? String(error.code) : 'unknown'
      const message = error && error.message ? String(error.message) : ''
      if (code === 'stale-file') return '文件已被外部改动 → 已拒绝本次写入，请刷新后重试（点顶部的「↻ 刷新」）'
      if (code === 'path-not-allowed') return `写通道拒绝了该路径（只允许写配置里的待办文件）${message ? `：${message}` : ''}`
      if (code === 'http-404' || code === 'no-fetch') return '宿主未提供待办写通道（webServer 未挂载或版本不支持）→ 编辑功能不可用'
      return `保存失败（${code}）${message ? `：${message}` : ''}`
    }


    // ---------------------------------------------------------------- 设置页（FIX-52）
    /**
     * 设置页的**命名空间**喵：宿主按 profile 里那一行的 **Loader entry id** 寻址表单
     * （`cordis.patch.yml` 里本插件的条目 id 就是它），所以这里写 `agent-contract`喵。
     */
    const SETTINGS_NS = 'agent-contract'

    /** 「调用 JSON」允许改的**顶层键白名单**喵：其它配置（路径 / 审计阈值…）要重建数据，仍留在配置文件里喵。 */
    const SETTINGS_TOP_KEYS = ['modelRoutes', 'panel']

    /** 面板设置项的**类型表**喵（值类型检查与"只认认识的键"都靠它）喵。 */
    const PANEL_SETTING_TYPES = {
      hideDoneOneShot: 'boolean',
      autoRefresh: 'boolean',
      pollSeconds: 'number',
      defaultView: ['list', 'topology'],
      badgeLabels: 'boolean',
    }

    /** 路由值（对象形态）允许的字段喵：与 `channels.js` 的 `routeOptions()` 同口径喵。 */
    const ROUTE_VALUE_FIELDS = { provider: 'string', model: 'string', reasoningEffort: 'string', maxTokens: 'number' }

    /** **密钥红线**喵：这些字段名一律拒收（凭证由宿主/provider 账户持有）喵。 */
    const SECRET_KEY_NAMES = ['apikey', 'key', 'token', 'secret', 'password', 'credential', 'accesskey', 'secretkey']

    /** 字段名归一化后判是否密钥字段（`api_key` / `apiKey` / `API-KEY` 都认）喵。 */
    function isSecretKey(name) {
      const normalized = String(name ?? '').toLowerCase().replace(/[_\-\s]/g, '')
      return SECRET_KEY_NAMES.includes(normalized)
    }

    /** 递归收出所有**密钥字段**的路径（任意深度）喵。 */
    function collectSecretPaths(value, path = '') {
      const found = []
      if (!value || typeof value !== 'object') return found
      for (const [key, item] of Object.entries(value)) {
        const here = path ? `${path}.${key}` : key
        if (isSecretKey(key)) found.push(here)
        found.push(...collectSecretPaths(item, here))
      }
      return found
    }

    /** 值类型是否符合期望（`boolean` / `number` / `string` / 枚举数组）喵。 */
    function matchesSettingType(value, expected) {
      if (Array.isArray(expected)) return expected.includes(value)
      if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
      return typeof value === expected
    }

    /**
     * 校验「调用 JSON」喵（FIX-52 ④）—— **纯函数**，所以每条拒绝路径都能在套件里断言喵。
     *
     * 五道关喵：① JSON 语法 ② 顶层键白名单（`modelRoutes` / `panel`）
     * ③ **密钥红线**（任意深度出现 apiKey/key/token/secret… 一律拒）④ 角色 id 必须是内置角色
     * ⑤ 值类型（路由值 字符串 | 对象；面板项按类型表）喵。
     * @returns `{ ok: true, value }` 或 `{ ok: false, errors: [{ path, message }] }`（**指出错在哪**）喵。
     */
    function validateSettingsJson(text) {
      let parsed
      try {
        parsed = JSON.parse(String(text ?? ''))
      } catch (error) {
        return { ok: false, errors: [{ path: '(整段 JSON)', message: `JSON 语法错误：${messageOf(error)}` }] }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          ok: false,
          errors: [{ path: '(整段 JSON)', message: '顶层必须是一个 JSON 对象，例如 { "modelRoutes": {...}, "panel": {...} }' }],
        }
      }
      const errors = []
      for (const path of collectSecretPaths(parsed)) {
        errors.push({ path, message: '密钥字段不能写在这里：密钥由宿主 / provider 账户持有，不要写进本设置（也绝不会写进配置文件）' })
      }
      for (const key of Object.keys(parsed)) {
        if (!SETTINGS_TOP_KEYS.includes(key)) {
          errors.push({
            path: key,
            message: `只允许改 ${SETTINGS_TOP_KEYS.join(' / ')}；路径、审计阈值这类要重建数据的配置仍请改 cordis.patch.yml`,
          })
        }
      }
      const roleIds = Object.keys(ROLE_LABELS)
      const modelRoutes = parsed.modelRoutes
      if (modelRoutes !== undefined) {
        if (!modelRoutes || typeof modelRoutes !== 'object' || Array.isArray(modelRoutes)) {
          errors.push({ path: 'modelRoutes', message: '必须是对象，形如 { "adversary": {"model":"…"} } 或 { "implementer": "模型名" }' })
        } else {
          for (const [roleId, value] of Object.entries(modelRoutes)) {
            if (!roleIds.includes(roleId)) {
              errors.push({ path: `modelRoutes.${roleId}`, message: `不是内置角色 id；可用：${roleIds.join(' / ')}` })
              continue
            }
            if (typeof value === 'string') {
              if (!value.trim()) errors.push({ path: `modelRoutes.${roleId}`, message: '模型名不能是空串' })
              continue
            }
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              errors.push({
                path: `modelRoutes.${roleId}`,
                message: '值要么是模型名字符串，要么是 { provider, model, reasoningEffort, maxTokens } 对象',
              })
              continue
            }
            for (const [field, item] of Object.entries(value)) {
              if (!(field in ROUTE_VALUE_FIELDS)) {
                errors.push({ path: `modelRoutes.${roleId}.${field}`, message: `未知字段；可用：${Object.keys(ROUTE_VALUE_FIELDS).join(' / ')}` })
                continue
              }
              if (!matchesSettingType(item, ROUTE_VALUE_FIELDS[field])) {
                errors.push({ path: `modelRoutes.${roleId}.${field}`, message: `类型应为 ${ROUTE_VALUE_FIELDS[field]}` })
              }
            }
          }
        }
      }
      const panel = parsed.panel
      if (panel !== undefined) {
        if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
          errors.push({ path: 'panel', message: '必须是对象，形如 { "hideDoneOneShot": true, "pollSeconds": 20 }' })
        } else {
          for (const [key, value] of Object.entries(panel)) {
            if (!(key in PANEL_SETTING_TYPES)) {
              errors.push({ path: `panel.${key}`, message: `未知设置项；可用：${Object.keys(PANEL_SETTING_TYPES).join(' / ')}` })
              continue
            }
            if (!matchesSettingType(value, PANEL_SETTING_TYPES[key])) {
              const expected = Array.isArray(PANEL_SETTING_TYPES[key]) ? PANEL_SETTING_TYPES[key].join(' | ') : PANEL_SETTING_TYPES[key]
              errors.push({ path: `panel.${key}`, message: `类型应为 ${expected}` })
            }
          }
        }
      }
      if (errors.length) return { ok: false, errors }
      return {
        ok: true,
        value: {
          ...(modelRoutes !== undefined ? { modelRoutes } : {}),
          ...(panel !== undefined ? { panel } : {}),
        },
      }
    }

    /** 把当前配置渲染成**可编辑的调用 JSON**（设置页的初始文本）喵。 */
    function settingsJsonText(config) {
      const source = config && typeof config === 'object' ? config : {}
      return JSON.stringify({
        modelRoutes: source.modelRoutes && typeof source.modelRoutes === 'object' ? source.modelRoutes : {},
        panel: panelPrefsFrom(source),
      }, null, 2)
    }

    /** 校验通过的 JSON → 要写进表单的**字段值**（一项一个字段；`set` 的入参是 JSON 形状的值）喵。 */
    function settingsWritesOf(value) {
      const writes = []
      if (value && value.modelRoutes !== undefined) writes.push({ field: 'modelRoutes', value: value.modelRoutes })
      if (value && value.panel !== undefined) writes.push({ field: 'panel', value: value.panel })
      return writes
    }

    /**
     * 从（配置文件 / 设置页的）值里取**面板设置的最终值**喵（FIX-52 ③）喵：
     * 类型不对或缺失就回落到内置默认；`pollSeconds` 夹在 5~300 秒之间（别把宿主打爆，也别慢到没意义）喵。
     */
    function panelPrefsFrom(config) {
      const source = (config && config.panel && typeof config.panel === 'object') ? config.panel : {}
      const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
      const seconds = Number(source.pollSeconds)
      return {
        hideDoneOneShot: bool(source.hideDoneOneShot, true),
        autoRefresh: bool(source.autoRefresh, true),
        pollSeconds: Number.isFinite(seconds) && seconds >= 5 ? Math.min(300, Math.floor(seconds)) : 20,
        defaultView: source.defaultView === 'topology' ? 'topology' : 'list',
        badgeLabels: bool(source.badgeLabels, true),
      }
    }

    // ---------------------------------------------------------------- 待办区（FIX-29/40/41）：常量见上文
    /** 行内 md 子集 → 片段数组（`**粗体**` / `` `代码` `` / `[文字](链接)`）喵。 */
    function parseInline(text) {
      const source = String(text ?? '')
      const segments = []
      const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
      let last = 0
      let match = pattern.exec(source)
      while (match) {
        if (match.index > last) segments.push({ type: 'text', text: source.slice(last, match.index) })
        if (match[2] !== undefined) segments.push({ type: 'bold', text: match[2] })
        else if (match[4] !== undefined) segments.push({ type: 'code', text: match[4] })
        else segments.push({ type: 'link', text: match[6], href: match[7] })
        last = match.index + match[0].length
        match = pattern.exec(source)
      }
      if (last < source.length) segments.push({ type: 'text', text: source.slice(last) })
      return segments
    }

    /**
     * **md 子集**解析喵（FIX-29）喵：标题 / 无序列表 / 复选框 `- [ ]`｜`- [x]` / 行内格式。
     *
     * 自己实现、零依赖零构建 —— 面板只需要"读得懂"待办原文，不需要一整个 md 引擎喵
     * （真需要富渲染时优先复用宿主已暴露的 md 资源，这一版不引第三方库）喵。
     */
    function parseMdSubset(text) {
      const blocks = []
      const rawLines = String(text ?? '').split(/\r?\n/)
      for (let line = 0; line < rawLines.length; line += 1) {
        const current = rawLines[line].trimEnd()
        const heading = /^(#{1,6})\s+(.*)$/.exec(current)
        if (heading) {
          blocks.push({ line, type: 'heading', level: heading[1].length, segments: parseInline(heading[2]) })
          continue
        }
        const check = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/.exec(current)
        if (check) {
          blocks.push({ line, type: 'check', checked: check[1].toLowerCase() === 'x', segments: parseInline(check[2]) })
          continue
        }
        const item = /^\s*[-*]\s+(.*)$/.exec(current)
        if (item) {
          blocks.push({ line, type: 'item', segments: parseInline(item[1]) })
          continue
        }
        if (!current.trim()) {
          blocks.push({ line, type: 'blank' })
          continue
        }
        blocks.push({ line, type: 'text', segments: parseInline(current) })
      }
      return blocks
    }

    /** 按行截断喵：返回 `{ text, truncated, total, shown }`（`expand` 为真就不截）喵。 */
    function truncateLines(text, limit = TODO_PREVIEW_LINES, expand = false) {
      const lines = String(text ?? '').split(/\r?\n/)
      const total = lines.length
      if (expand || total <= limit) return { text: String(text ?? ''), truncated: false, total, shown: total }
      return { text: lines.slice(0, limit).join('\n'), truncated: true, total, shown: limit }
    }

    /**
     * 读待办**原文**喵（FIX-29）喵：只走宿主现成的 `remote.workspaceFiles.read`。
     *
     * **严格只读**：这个入口没有任何写路径（宿主那个服务本身也不暴露写操作）——
     * 面板永远不许改人的待办文件，测试里有"跑前后字节不变"的断言守它喵。
     * @returns `{ text, reason }`：读不到时 `text:null` 且给**原因**（不粗化成"没有待办"）喵。
     */
    async function loadTodoFile(ctx, scope, path) {
      const workspaceFiles = ctx && ctx.remote && ctx.remote.workspaceFiles
      if (!workspaceFiles || typeof workspaceFiles.read !== 'function') {
        return { text: null, reason: 'remote.workspaceFiles 未注入（检查 client inject）' }
      }
      if (!path) return { text: null, reason: '快照未给出待办文件路径（paths.todoFile）' }
      const sessionId = typeof scope === 'string' ? scope : (scope && scope.sessionId)
      if (!sessionId) return { text: null, reason: '拿不到 sessionId，无法读工作区文件' }
      try {
        const envelope = unwrapRemote(await workspaceFiles.read(sessionId, path, {}, undefined))
        if (!envelope.ok) return { text: null, reason: `remote 返回 ok=false（${remoteErrorText(envelope.error)}）` }
        const value = envelope.value
        const text = value && typeof value.text === 'string' ? value.text : null
        return { text, reason: text === null ? '返回内容不是文本（可能未创建）' : null }
      } catch (error) {
        return { text: null, reason: messageOf(error) }
      }
    }

    /**
     * md 子集**块** → React 元素喵（零依赖，样式就地给）喵。
     *
     * FIX-41：`options.onToggle` 存在时，**复选框行**渲染成可点的（`role="checkbox"`）——
     * 点它就调 `onToggle(行号, 当前是否已勾选)`，真正的行级翻转在宿主侧做喵。
     */
    function renderMdBlock(block, key, options = {}) {
      if (block.type === 'blank') return h('div', { key, style: styles.mdBlank })
      const children = (block.segments || []).map((segment, index) => {
        if (segment.type === 'bold') return h('b', { key: index }, segment.text)
        if (segment.type === 'code') return h('code', { key: index, style: styles.inlineCode }, segment.text)
        if (segment.type === 'link') {
          return h('a', { key: index, href: segment.href, target: '_blank', rel: 'noreferrer', style: styles.link }, segment.text)
        }
        return segment.text
      })
      if (block.type === 'heading') {
        return h('div', { key, style: { ...styles.mdHeading, fontSize: block.level <= 2 ? 12 : 11 } }, ...children)
      }
      if (block.type === 'check') {
        const interactive = typeof options.onToggle === 'function'
        return h('div', { key, style: styles.mdItem },
          h('span', {
            style: { ...styles.checkBox, ...(interactive ? { cursor: 'pointer' } : {}) },
            role: interactive ? 'checkbox' : undefined,
            'aria-checked': block.checked ? 'true' : 'false',
            'data-line': block.line,
            title: interactive ? (block.checked ? '点击取消勾选' : '点击勾选') : '',
            onClick: interactive ? () => options.onToggle(block.line, block.checked) : undefined,
          }, block.checked ? '☑' : '☐'), ' ', ...children)
      }
      if (block.type === 'item') return h('div', { key, style: styles.mdItem }, '· ', ...children)
      return h('div', { key }, ...children)
    }
    // ---------------------------------------------------------------- 过滤（3.3）
    /** 过滤开关默认值：**默认隐藏已完成的一次性(one-shot)节点**喵。 */
    function defaultPrefs() {
      return { hideDoneOneShot: true }
    }

    function isHidden(node, prefs) {
      if (!prefs || prefs.hideDoneOneShot !== true) return false
      return node.mode === 'one-shot' && (node.status === 'completed' || node.status === 'released')
    }

    /** 按过滤条件剪枝（父节点被隐藏时子树跟随隐藏）喵。 */
    function filterTree(nodes, prefs) {
      const rows = []
      for (const node of nodes || []) {
        if (isHidden(node, prefs)) continue
        rows.push({ ...node, children: filterTree(node.children, prefs) })
      }
      return rows
    }

    function flattenTree(nodes, depth = 0, rows = []) {
      for (const node of nodes || []) {
        rows.push({ node, depth })
        flattenTree(node.children, depth + 1, rows)
      }
      return rows
    }

    function roleColor(role) {
      if (role && Object.prototype.hasOwnProperty.call(ROLE_COLORS, role)) return ROLE_COLORS[role]
      return ROLE_COLORS['成员']
    }

    function nodeKind(node) {
      if (!node) return '子智能体'
      if (node.role === '主代理') return '主代理'
      // 兼容：没有 role 时按「上级是主代理/没有上级」判断喵
      return (node.parent === null || node.parent === undefined || node.parent === '主代理') ? '主代理' : '子智能体'
    }

    /**
     * 五枚徽章喵：每枚都带**中文全称与含义**（供 tooltip 与图例），取值符号见 `BADGE_VIEW`喵。
     * 主代理没有契约注入、也不按任务归属 → 五枚一律 `na`（显示 `—`），不再一律甩问号让用户猜喵。
     */
    /**
     * 空窗期徽章的解释（FIX-73 ②）喵。
     *
     * 病根（真机）喵：派单 → 成员记录落盘 → 快照重写 之间有个几秒的窗口，这期间四项徽章只会写"待接"，
     * 用户与主代理**都不知道为什么**（既没解释、也没有可执行动作）喵。
     * 现在：节点在会话树里、但快照里还没有它的成员记录 ⇒ 明说"尚未记账（派单后需要几秒）"并给动作，
     * 与"数据源陈旧/未生成"（整份快照的问题）在**措辞上分开**，免得两回事被当成一回事喵。
     */
    const NOT_COUNTED_HINT = '该成员尚未记账（派单后需要几秒；台账已写入、快照重写稍晚）—— 点「↻ 刷新」或等下一拍即可'

    function badgeRow(node) {
      const badges = node && node.badges ? node.badges : {}
      const pending = !(node && node.hasAudit === true)
      const isMain = Boolean(node) && node.role === '主代理'
      const role = node ? node.role : null
      // 空窗期（树里有这个节点、快照里没这条记录）与"快照整体不可读"要分开说喵
      const pendingHint = node && node.notCounted === true ? NOT_COUNTED_HINT : '数据源待接'
      const make = (key, value, notApplicable) => {
        const na = isMain || notApplicable === true
        return {
          key,
          value: na ? 'na' : (value || 'unknown'),
          pending: na ? false : pending,
          pendingHint,
          hint: BADGE_INFO[key],
        }
      }
      // FIX-86 ②：**按角色的产出形态**判"不适用(—)" —— 形态来自快照里的 `deliverableKinds`
      // （与审计共用 `ROLE_META` 那份声明，单一来源）。形态**未知**时保持旧行为（宁显示 unknown 不伪装 na）喵
      const kinds = Array.isArray(node && node.deliverableKinds) ? node.deliverableKinds : null
      const needsThreeTier = !kinds || kinds.includes('three-tier')
      const tracksProgress = !kinds || !kinds.includes('bookkeeping')
      return [
        make('契约', badges.contract),
        // 簿记/审查类角色**本就不产出三档** ⇒ —（不适用），不是 ✗（缺失）喵
        make('三档', badges.docs, !needsThreeTier),
        make('进度', badges.progress, !tracksProgress),
        make('预算', badges.budget),
        // 「异源」只对对抗审查有意义：角色已知且不是 adversary → 显示 —（na），不甩问号；
        // 角色未知时仍保留 unknown，免得把"不知道"伪装成"不适用"喵
        make('异源', badges.crossVendor, Boolean(role) && role !== 'adversary'),
      ]
    }

    /**
     * 跳到某个会话的**对话**喵（M3 §3.1）喵。
     *
     * 用官方客户端 API **`uiWorkspace.openSession(sessionId)`**
     * （官方用法见 `packages/client/ui-chat/src/client/apply.ts:254`、`ui-schedule/src/client/index.ts:137`）喵。
     *
     * **不要**用 better-sidebar 的 `TabComponentProps.onSubagentJump` —— 它不是"打开会话"的 API，
     * 只是给「任务管理」页里那棵树做**定位高亮**（`Sidebar.tsx:640` 把它存进 `subagentJumpRef`），
     * 点了会跳到那个页面而不是该 agent 的对话（实测踩过）喵。
     *
     * 拿不到该服务时返回 false，由调用方退化成"展示/复制 session id"（**不自造路由**）喵。
     */
    /**
     * 本 tab 的**类型 id**喵（= 注册 descriptor 的 `id`）喵。
     * 提成常量是硬要求：跳转后要按它把 tab 补进目标会话域，两处写死迟早漂移喵。
     */
    const TAB_TYPE_ID = 'agent-contract:contract'

    /**
     * 跳转后**在新会话的 tab 域里重新打开本 tab**喵（FIX-39）喵。
     *
     * 为什么需要这一步喵：better-sidebar 的 tab 是**按会话分域**的 ——
     * `openTab(seed, scope)` 的 `scope` 决定这次打开落到哪个会话
     * （见其 `service.ts`：`store.reduceFor(scope.sessionId, reducer)`），
     * 而我们的面板是以 A 会话的 scope 打开的；跳到 B 之后侧栏渲染的是 **B 的 tab 集合**，
     * 里面没有我们 → 面板"消失"（用户读作"侧栏被关掉了，没有保持"）喵。
     * 所以跳转后用 `openTab({ type }, { sessionId: B })` 把它补进 B 的域里
     * —— 同 type 已存在时宿主会走 id 兜底 focus，不会开出第二个喵。
     *
     * 全程**静默**：拿不到服务、或服务版本旧（< 0.12 的 `openTab` 没有 `scope` 参数）都不抛错，
     * 只退化成"跳完侧栏可能切走" —— 跳转本身绝不能因此失败喵。
     *
     * @returns `'open' | 'activate' | false`（区分走了哪条路，便于断言）喵。
     */
    function reopenTabInScope(remoteCtx, sessionId, typeId = TAB_TYPE_ID) {
      if (!sessionId) return false
      try {
        const service = remoteCtx && typeof remoteCtx.get === 'function' ? remoteCtx.get('betterSidebar') : null
        if (!service) return false
        const scope = { sessionId: String(sessionId) }
        if (typeof service.openTab === 'function') {
          service.openTab({ type: typeId }, scope)
          return 'open'
        }
        if (typeof service.activateTab === 'function') {
          service.activateTab(typeId, scope)
          return 'activate'
        }
      } catch {
        /* 静默：这是"锦上添花"的一步，失败不该影响跳转喵 */
      }
      return false
    }

    function openSessionConversation(remoteCtx, sessionId) {
      if (!remoteCtx || typeof remoteCtx.get !== 'function' || !sessionId) return false
      try {
        const workspace = remoteCtx.get('uiWorkspace')
        if (!workspace || typeof workspace.openSession !== 'function') return false
        workspace.openSession(sessionId)
        // FIX-39：跳转会把侧栏切到目标会话的 tab 域 → 把本 tab 补进去，面板才"保持"喵
        reopenTabInScope(remoteCtx, sessionId)
        return true
      } catch {
        return false
      }
    }

    /**
     * 放下浏览器当前选区喵（拿不到就当没事发生，绝不抛错）喵。
     *
     * 为什么要这一步：卡片双击是"跳转会话"，宿主会把会话视图**整块换掉**，
     * 而双击手势顺手产生的那条选区两端还钉在旧节点上，渲染出来就是"整页文字被全选"喵。
     * 传入 window 形状的对象（而不是直接摸全局）是为了能在套件里用假 window 断言喵。
     */
    function dropTextSelection(win) {
      try {
        const selection = win && typeof win.getSelection === 'function' ? win.getSelection() : null
        if (selection && typeof selection.removeAllRanges === 'function') {
          selection.removeAllRanges()
          return true
        }
      } catch {
        /* 清选区失败不该影响跳转喵 */
      }
      return false
    }

    /**
     * 读面板 UI 状态喵（视图 / 图例 / 视图变换）喵。
     *
     * 优先级刻意是 **localStorage > tab.meta > 模块级**喵：
     * `tab.meta` 理论上更"官方"（随布局持久化），但实测**跳转时侧栏布局会重建、meta 没吃到** ✗；
     * localStorage 由我们自己完全掌控，跨 remount、重载、关开 tab 都稳 ✓。三份都读，缺哪个都还有兜底喵。
     */
    function readUiState(tab) {
      let fromStorage = null
      try {
        const raw = window.localStorage ? window.localStorage.getItem(UI_STATE_KEY) : null
        if (raw) fromStorage = JSON.parse(raw)
      } catch {
        fromStorage = null
      }
      const fromMeta = readTabMeta(tab)
      return {
        ...panelUiState,
        ...(fromMeta && typeof fromMeta === 'object' ? fromMeta : {}),
        ...(fromStorage && typeof fromStorage === 'object' ? fromStorage : {}),
      }
    }

    /** 写面板 UI 状态喵：模块级 + localStorage + tab.meta 三写，谁活下来算谁喵。 */
    function persistUiState(remoteCtx, tab, patch) {
      Object.assign(panelUiState, patch)
      const merged = { ...panelUiState }
      try {
        if (window.localStorage) window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(merged))
      } catch {
        /* 隐私模式等禁用存储时忽略喵 */
      }
      writeTabMeta(remoteCtx, tab && tab.id, { ...readTabMeta(tab), ...merged })
      return merged
    }

    /** 读 tab 自身持久化的 UI 状态（`tab.meta`）喵。 */
    function readTabMeta(tab) {
      const meta = tab && tab.meta
      return meta && typeof meta === 'object' ? meta : {}
    }

    /** 写 tab 自身持久化的 UI 状态喵：官方 `betterSidebar.updateTab(tabId, { meta })`，随布局持久化喵。 */
    function writeTabMeta(remoteCtx, tabId, meta) {
      try {
        const service = remoteCtx && typeof remoteCtx.get === 'function' ? remoteCtx.get('betterSidebar') : null
        if (service && typeof service.updateTab === 'function' && tabId) service.updateTab(tabId, { meta })
      } catch {
        /* 拿不到就当没持久化，不影响使用喵 */
      }
    }

    // ---------------------------------------------------------------- React 视图
    const styles = {
      // 注意：**不要**给 wrap 写 alignSelf —— 宿主 `.paneTab` 是 `display:flex; flex-direction:column`，
      // 列向 flex 里 alignSelf 管的是**横向**（交叉轴），写 flex-start 会把我们的宽度缩成内容宽 ✗。
      // 面板下方的空白是宿主 tab 面板（`.paneTab{flex:1}`）的剩余高度，不是我们的元素，也无从折叠喵。
      // 让面板自己成为一个**可滚动区**（flex:1 + minHeight:0 + overflowY）：树长时在我们的框内滚，
      // 而不是把宿主的 pane 顶出滚动条喵。注意这里只用 flex/minHeight，**不用 alignSelf**（见上）喵。
      wrap: { padding: '8px 10px', font: '12px/1.6 system-ui, sans-serif', color: 'inherit', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
      row: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' },
      // FIX-28：列头常驻（sticky）——半透明底 + 轻微模糊，免得滚动时下层文字透上来看不清喵
      headRow: {
        display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 11,
        position: 'sticky', top: 0, zIndex: 1,
        background: 'rgba(128,128,128,.12)', backdropFilter: 'blur(3px)',
        borderBottom: '1px solid rgba(128,128,128,.3)',
      },
      // FIX-28：符号含义常驻一行（不看 tooltip 也能念出 `契约✓` 是什么状态）喵

      // 两个区块（A 大方向待办 / B agent 执行队列）喵（FIX-40）：样式共用，但各自独立折叠与空态喵
      block: { marginTop: 6, borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: 4 },
      blockHead: { fontSize: 11.5, fontWeight: 600, userSelect: 'none' },
      blockHeadRow: { display: 'flex', alignItems: 'center', gap: 6 },
      blockBody: { marginTop: 4, maxHeight: 240, overflowY: 'auto', fontSize: 11 },
      // FIX-41 ⑦：保存成功/失败/冲突的明示状态（颜色由调用处给）喵
      todoStatus: { marginTop: 3, fontSize: 10.5, wordBreak: 'break-all' },
      editor: {
        width: '100%', boxSizing: 'border-box', font: '11px/1.5 monospace', color: 'inherit',
        background: 'rgba(128,128,128,.08)', border: '1px solid rgba(128,128,128,.45)', borderRadius: 4, padding: 4,
      },
      todoItem: { marginTop: 2, wordBreak: 'break-all' },
      todoKind: { opacity: 0.7, marginRight: 4 },
      todoPath: { opacity: 0.55, fontSize: 10, wordBreak: 'break-all' },
      // 设置页分区喵（FIX-52）
      settingsWrap: { padding: '4px 0', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 },
      settingGroup: { fontWeight: 600, marginTop: 6, opacity: 0.85 },
      settingRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      settingHint: { fontSize: 11, opacity: 0.6, wordBreak: 'break-all' },
      settingNumber: { width: 80 },
      // md 子集渲染（零依赖）喵
      mdHeading: { fontWeight: 700, marginTop: 6 },
      mdItem: { marginTop: 1, paddingLeft: 2 },
      mdBlank: { height: 4 },
      checkBox: { marginRight: 2, opacity: 0.8 },
      inlineCode: { padding: '0 3px', borderRadius: 3, background: 'rgba(128,128,128,.18)', fontFamily: 'monospace', fontSize: 10.5 },
      link: { color: '#58a6ff', textDecoration: 'underline' },
      dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
      name: { fontWeight: 600, cursor: 'pointer' },
      tag: { fontSize: 11, padding: '0 4px', borderRadius: 3, border: '1px solid currentColor', opacity: 0.85 },
      badge: { fontSize: 11, marginLeft: 2 },
      note: { opacity: 0.65, marginTop: 8, borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: 6 },
      jumpNote: { marginTop: 6, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(210,153,34,.6)', color: '#d29922', wordBreak: 'break-all' },
      // 树形指引喵：连接符 / 左侧参考线 / 子节点计数
      guide: { opacity: 0.4, marginRight: 2, fontFamily: 'monospace' },
      childRow: { borderLeft: '1px solid rgba(128,128,128,.28)' },
      count: { opacity: 0.55, fontSize: 11 },
      // 定宽列：角色/状态/模式/层数/子计数/徽章各占固定宽度，标签才不会参差不齐喵
      col: { display: 'inline-block', textAlign: 'center', flex: '0 0 auto' },
      nameCell: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      // 视图切换喵
      switch: { marginLeft: 'auto', display: 'inline-flex', gap: 4 },
      tabBtn: { padding: '1px 8px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      tabActive: { borderColor: 'currentColor', fontWeight: 700 },
      // 拓扑图喵
      // 视口：**不给滚动条**，平移/缩放全靠 transform（小树没溢出时滚动条拖不动，实测坑）喵
      topoViewport: {
        position: 'relative', overflow: 'hidden', marginTop: 6, borderRadius: 6,
        // 吃掉面板剩余高度：宿主 pane 那段空白就变成画布本身（不是靠注入样式去动宿主的 DOM）喵
        flex: '1 1 auto', minHeight: 180,
        cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        border: '1px solid rgba(128,128,128,.3)', background: 'rgba(128,128,128,.06)',
      },
      // 不可选中的样式片段喵：给"点了就干活"的元素直接套上，免得手势顺带把人家的文字选走喵。
      // 为什么不能只靠视口的 `userSelect: 'none'` 继承 —— 继承**弱于任何直接命中的规则**，
      // 宿主样式表里只要有一条直接命中我们 span/div 的 `user-select`，继承就会被压掉喵。
      noSelect: { userSelect: 'none', WebkitUserSelect: 'none' },
      topoCanvas: { position: 'absolute', left: 0, top: 0 },
      topoControls: { position: 'absolute', right: 8, top: 8, display: 'flex', gap: 4, zIndex: 2 },
      topoEdges: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
      card: { position: 'absolute', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.45)', background: 'rgba(128,128,128,.08)', overflow: 'hidden' },
      cardTitle: { fontSize: 11, opacity: 0.75 },
      cardBadges: { fontSize: 10, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      legendHead: { cursor: 'pointer', opacity: 0.85, userSelect: 'none' },
      cardName: { fontSize: 12, fontWeight: 600, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      cardMeta: { fontSize: 11, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' },
      // 图例喵：五枚徽章各是什么，直接写在面板里，免得用户猜
      legend: { marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(128,128,128,.3)', fontSize: 10.5, lineHeight: '1.55' },
      legendItem: { display: 'block' },
      // FIX-24：同名退化角标 —— 悬停卡片只看得到 UUID 时，这枚 ⚠ 是唯一能看见的线索喵
      warnMark: { color: '#d29922', fontWeight: 700, marginLeft: 3 },
      // 审计摘要条喵（FIX-21）：红黄计数常驻可见，点一下展开逐条清单
      audit: { marginTop: 6, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(128,128,128,.35)', background: 'rgba(128,128,128,.06)' },
      auditHead: { fontSize: 11.5, fontWeight: 600 },
      // FIX-37：范围说明那行（比正文再淡一档，别抢红黄计数的视线）喵
      auditScope: { fontSize: 10, opacity: 0.6, marginTop: 1 },
      // FIX-61：结构缺失提示 —— 一行、可执行、只在真缺时出现（FIX-45 的"不占版面"仍然守）喵
      projectHint: { fontSize: 10.5, marginTop: 3, padding: '2px 6px', borderLeft: '3px solid currentColor', opacity: 0.85 },
      auditList: { marginTop: 4, maxHeight: 180, overflowY: 'auto' },
      auditItem: { fontSize: 10.5, opacity: 0.95, wordBreak: 'break-all', marginTop: 2 },
      header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
      button: { marginLeft: 6, padding: '1px 8px', fontSize: 11, borderRadius: 4, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' },
    }

    /**
     * 列表**列头**喵（FIX-28）喵。
     *
     * sticky 常驻：滚动时仍能对上列；徽章那一段把五枚的名字**按顺序**写出来 ——
     * 格子里只有 `契约✓`，列头负责说清「哪五枚」喵。
     */
    function ListHeader() {
      const head = (width) => ({ ...styles.col, width, opacity: 0.7 })
      return h('div', { style: styles.headRow },
        h('span', { style: styles.dot }),
        h('span', { style: { ...styles.nameCell, opacity: 0.7 } }, '名称'),
        h('span', { style: head(72) }, '角色'),
        h('span', { style: head(64) }, '状态'),
        h('span', { style: head(48) }, '模式'),
        // 5 格 × 40 + 4 个 gap(6) = 224，与 NodeRow 的徽章段同宽（对齐才对得上）喵
        h('span', { style: { ...head(224), textAlign: 'left' } }, `徽章（${BADGE_KEYS.join('/')}）`),
      )
    }

    function NodeRow(props) {
      const { node, depth, onJump } = props
      const color = roleColor(node.role)
      const statusColor = STATUS_COLORS[node.status] || STATUS_COLORS.unknown
      const children = Array.isArray(node.children) ? node.children.length : 0
      const jump = () => {
        if (typeof onJump === 'function' && node.sessionId) onJump(node.sessionId)
      }
      return h('div', {
        // 树形指引：子节点缩进 + 连接符 + 左侧参考线，主代理加粗 —— 否则一层多子节点看起来就是平铺喵
        style: { ...styles.row, paddingLeft: depth * 16, ...(depth > 0 ? styles.childRow : {}) },
        // FIX-24/用户口径：tooltip 里 id 与退化告警并列；「层 / 子」两栏删掉后，
        // 这两条信息并入 tooltip（层级看缩进、子节点数在这里）—— 信息不丢，只是不占列喵
        title: [nodeTooltip(node), `层 L${node.layer}`, children ? `子节点 ${children} 个` : ''].filter(Boolean).join('\n'),
      },
      depth > 0 ? h('span', { style: styles.guide }, '└') : null,
      h('span', { style: { ...styles.dot, background: color } }),
      h('span', {
        style: { ...styles.name, ...styles.nameCell, fontWeight: depth === 0 ? 700 : 600 },
        onClick: jump,
        role: 'button',
        tabIndex: 0,
      }, node.name),
      fallbackMark(node) ? h('span', { style: styles.warnMark, title: FALLBACK_WARN }, '⚠') : null,
      // 定宽列：角色 72 / 状态 64 / 模式 48 / 层数 32 / 子计数 44 / 五枚徽章各 40 —— 对齐了才不显得散喵
      h('span', { style: { ...styles.col, width: 72 } },
        h('span', { style: { ...styles.tag, color } }, roleLabel(node.role))),
      h('span', { style: { ...styles.col, width: 64 } },
        // FIX-84 ④：用户归档掉的会话 —— 状态列直接写「已归档」（别混进"活动"观感）喵
        h('span', { style: { ...styles.tag, color: statusColor } }, node.archived ? '已归档' : (STATUS_LABELS[node.status] || node.status))),
      h('span', { style: { ...styles.col, width: 48 } },
        h('span', { style: styles.tag }, MODE_LABELS[node.mode] || node.mode)),
      ...badgeRow(node).map((item) => {
        const view = BADGE_VIEW[item.value] || BADGE_VIEW.unknown
        return h('span', {
          key: item.key,
          style: { ...styles.col, width: 40, ...styles.badge, color: view.color, opacity: item.pending ? 0.55 : 1 },
          // FIX-20/28：渲染**徽章名 + 符号**（`契约✓`），不再只靠颜色、也不再只剩符号；
          // 状态词进 tooltip、符号含义进底部图例喵
          title: `${item.key}：${item.hint}｜当前 ${item.pending ? (item.pendingHint || '数据源待接') : badgeText(item.value)}`
            + (node.badgeFallback ? '｜⚠ 该节点靠成员名匹配徽章（同名成员可能串，见 FIX-17）' : ''),
        }, item.pending ? '·待接' : badgeCell(item.key, item.value, props.badgeLabels !== false))
      }),
      )
    }

    /**
     * 拓扑视图喵：**transform 平移 + 滚轮缩放**（不是靠滚动条 —— 小树压根没溢出，滚动自然"拖不动"）喵。
     *
     * 两个从官方 `TasksGraph.tsx` 学来的硬要点喵：
     * ① 滚轮监听必须 **非 passive**（`{ passive: false }`），否则 `preventDefault()` 无效、页面跟着滚；
     * ② 拖动监听挂在 `window` 上，**不要** `setPointerCapture` —— 它会重定向 click，
     *    悄悄把卡片自己的"点击跳转"干掉；并且只在**背景**起手（按到卡片就交给卡片）喵。
     */
    function TopologyView(props) {
      const layout = layoutTopology(props.roots)
      const containerRef = React.useRef(null)
      const [tf, setTf] = React.useState({ x: FIT_MARGIN, y: FIT_MARGIN, k: 1 })
      const tfRef = React.useRef(tf)
      tfRef.current = tf
      const persistTimer = React.useRef(null)
      // 视口高度由 flex 决定（吃掉面板剩余高度）；viewportHeight 只作为**量不到时的兜底**喵
      const viewportHeight = Math.max(180, layout.height + 48)
      /**
       * 跳转前先把选区放下喵：双击卡片会切换会话，选区两端会横跨换掉的 DOM，
       * 看上去就是"整页文字被全选"（用户实测反馈）喵。逻辑在 dropTextSelection 里，便于套件断言喵。
       */
      const dropSelection = () => {
        dropTextSelection(typeof window !== 'undefined' ? window : null)
      }
      const jumpTo = (sessionId) => {
        dropSelection()
        if (typeof props.onJump === 'function') props.onJump(sessionId)
      }

      /**
       * 视图变换落盘（**防抖 250ms**）喵：滚轮与拖动会连发很多次事件，
       * 每次都写 `tab.meta` 会把宿主打爆，所以只在手势尾部写一次喵。
       */
      const schedulePersist = React.useCallback((value) => {
        if (persistTimer.current) clearTimeout(persistTimer.current)
        persistTimer.current = setTimeout(() => {
          if (typeof props.onViewport === 'function') props.onViewport({ tf: value })
        }, 250)
      }, [props])

      /** 统一出口：写 ref → setState → 落盘喵（ref 先写，连续手势才不丢帧）喵。 */
      const applyTf = React.useCallback((next) => {
        tfRef.current = next
        setTf(next)
        schedulePersist(next)
      }, [schedulePersist])

      const fit = React.useCallback(() => {
        const el = containerRef.current
        const viewWidth = el && el.clientWidth ? el.clientWidth : layout.width + FIT_MARGIN * 2
        // 视口高度现在由 flex 决定，所以要量真实高度（量不到才退回估算值）喵
        const viewHeight = el && el.clientHeight ? el.clientHeight : viewportHeight
        applyTf(fitViewport(layout.width, layout.height, viewWidth, viewHeight))
      }, [applyTf, layout.width, layout.height, viewportHeight])

      // 挂载：**先恢复上次的视图**（跳转 / 切 tab 回来不该被重置），没有存档才自适应喵
      React.useEffect(() => {
        const saved = clampTf(readUiState(props.tab).tf)
        if (saved) {
          tfRef.current = saved
          setTf(saved)
          return
        }
        fit()
        // 只在挂载时跑一次：之后用户的手势说了算喵
      }, [])

      // 滚轮缩放：非 passive，缩放锚点跟随光标喵
      React.useEffect(() => {
        const el = containerRef.current
        if (!el || typeof el.addEventListener !== 'function') return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 }
          const px = event.clientX - rect.left
          const py = event.clientY - rect.top
          const current = tfRef.current
          // deltaMode：0=像素 1=行 2=页 —— 行滚动要先归一化，否则缩放慢 16 倍喵
          const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? 100 : 1)
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.k * Math.exp(-event.deltaY * unit * 0.0014)))
          if (next === current.k) return
          const ratio = next / current.k
          applyTf({ k: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio })
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => { el.removeEventListener('wheel', onWheel) }
      }, [applyTf])

      const onPointerDown = (event) => {
        if (event.button !== 0) return
        const target = event.target
        if (target && typeof target.closest === 'function'
          && (target.closest('[data-graph-node]') || target.closest('[data-graph-controls]'))) return
        const startX = event.clientX
        const startY = event.clientY
        const start = { ...tfRef.current }
        let travel = 0
        const onMove = (move) => {
          travel = Math.max(travel, Math.hypot(move.clientX - startX, move.clientY - startY))
          if (travel < CLICK_TOLERANCE_PX) return // 小于容差仍算点击，不抢卡片的手势喵
          const next = { ...start, x: start.x + (move.clientX - startX), y: start.y + (move.clientY - startY) }
          tfRef.current = next
          setTf(next)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          // 真的拖动了才落盘（小于容差的算点击，不改视图）喵
          if (travel >= CLICK_TOLERANCE_PX) schedulePersist(tfRef.current)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }

      const zoomBy = (factor) => {
        const el = containerRef.current
        const current = tfRef.current
        const mx = el && el.clientWidth ? el.clientWidth / 2 : layout.width / 2
        const my = el && el.clientHeight ? el.clientHeight / 2 : viewportHeight / 2
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.k * factor))
        if (next === current.k) return
        const ratio = next / current.k
        applyTf({ k: next, x: mx - (mx - current.x) * ratio, y: my - (my - current.y) * ratio })
      }

      return h('div', {
        ref: containerRef,
        style: styles.topoViewport,
        onPointerDown,
        onDoubleClick: (event) => {
          const target = event.target
          if (target && typeof target.closest === 'function'
            && (target.closest('[data-graph-node]') || target.closest('[data-graph-controls]'))) return
          fit()
        },
      },
      h('div', {
        style: {
          ...styles.topoCanvas,
          width: layout.width,
          height: layout.height,
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})`,
          transformOrigin: '0 0',
        },
      },
      h('svg', { width: layout.width, height: layout.height, style: styles.topoEdges },
        ...layout.edges.map((edge, index) => h('path', {
          key: index,
          d: `M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + 22}, ${edge.x2} ${edge.y2 - 22}, ${edge.x2} ${edge.y2}`,
          fill: 'none',
          stroke: 'rgba(128,128,128,.55)',
          strokeWidth: 1,
        }))),
      ...layout.cards.map((card) => h('div', {
        key: card.node.sessionId || card.node.name,
        'data-graph-node': '',
        style: {
          ...styles.card,
          ...styles.noSelect,
          left: card.x,
          top: card.y,
          width: layout.cardWidth,
          height: layout.cardHeight,
          cursor: 'pointer',
          // 底色按角色决定喵
          background: roleTint(card.node.role),
          borderColor: roleColor(card.node.role),
          borderLeftWidth: 3,
        },
        title: nodeTooltip(card.node),
        // 跳转手势改到**整张卡片**：双击任意区域即可（不再只有名字可点）喵。
        // stopPropagation 是必须的——否则会冒泡到背景的"双击自适应" ✗
        onDoubleClick: (event) => {
          event.stopPropagation()
          jumpTo(card.node.sessionId)
        },
        // 双击的第二下 mousedown 会启动浏览器的"选词"手势喵：跳转后宿主把会话视图整块换掉，
        // 那条选区的两端节点就此横跨一片 DOM，看起来就是"整页文字被全选"（实测反馈）喵。
        // preventDefault 是唯一与 CSS 无关的拦法——它掐掉的是选区的**起点**，
        // 且不拦 click / dblclick（Chrome 已核对：默认行为被取消后 click 照常派发）喵。
        onMouseDown: (event) => { if (event && event.preventDefault) event.preventDefault() },
      },
      h('div', { style: { ...styles.cardTitle, ...styles.noSelect } },
        `${roleLabel(card.node.role)} · ${STATUS_LABELS[card.node.status] || card.node.status || ''}`),
      h('div', {
        style: { ...styles.cardName, ...styles.noSelect },
        // 名字上的单击作为快捷方式保留喵
        onClick: () => jumpTo(card.node.sessionId),
      }, card.node.name, fallbackMark(card.node) ? h('span', { style: styles.warnMark, title: FALLBACK_WARN }, '⚠') : null),
      h('div', { style: { ...styles.cardMeta, ...styles.noSelect } },
        h('span', { style: styles.tag }, MODE_LABELS[card.node.mode] || card.node.mode),
        h('span', { style: { opacity: 0.7 } }, `L${card.node.layer}`)),
      h('div', { style: { ...styles.cardBadges, ...styles.noSelect } },
        ...badgeRow(card.node).map((item) => {
          const badge = BADGE_VIEW[item.value] || BADGE_VIEW.unknown
          return h('span', {
            key: item.key,
            style: { ...styles.noSelect, color: badge.color, marginRight: 5, opacity: item.pending ? 0.55 : 1 },
            // FIX-28：卡片上写「徽章名 + 符号」（`契约✓`）—— 200→240px 够放五枚喵
            title: `${item.key}：${item.hint}｜当前 ${item.pending ? (item.pendingHint || '数据源待接') : badgeText(item.value)}`
              + (card.node.badgeFallback ? '｜⚠ 该节点靠成员名匹配徽章（同名成员可能串，见 FIX-17）' : ''),
          }, item.pending ? '·待接' : badgeCell(item.key, item.value, props.badgeLabels !== false))
        })),
      )),
      ),
      // 缩放控制簇喵：不靠滚轮也能用（`data-graph-controls` 让拖动忽略它）喵
      h('div', { 'data-graph-controls': '', style: styles.topoControls },
        h('button', { style: styles.tabBtn, onClick: () => zoomBy(1 / 1.2), title: '缩小' }, '−'),
        h('button', { style: styles.tabBtn, onClick: fit, title: '自适应（也可双击背景）' }, `${Math.round(tf.k * 100)}%`),
        h('button', { style: styles.tabBtn, onClick: () => zoomBy(1.2), title: '放大' }, '＋')),
      )
    }

    function ContractTab(props) {
      // 3.3 读回是 best-effort：宿主把开关值持久化在 pluginSettings[本 tab id] 下，
      // 但 TabComponentProps 没有公开读取面，所以这里先看 tab.meta.prefs 再退回默认值喵
      // FIX-52：设置页的值（`configForms`）是**权威**；没有它才退回内置默认喵
      const [settingsTick, setSettingsTick] = React.useState(0)
      React.useEffect(() => {
        const forms = props.forms
        if (!forms || typeof forms.subscribe !== 'function') return undefined
        return forms.subscribe(() => setSettingsTick((n) => n + 1))
      }, [props.forms])
      const settings = React.useMemo(
        () => panelPrefsFrom(readFormValue(props.forms)),
        [props.forms, settingsTick],
      )
      const prefs = props.prefs || { hideDoneOneShot: settings.hideDoneOneShot }
      const [snapshot, setSnapshot] = React.useState(props.snapshot || null)
      const [failure, setFailure] = React.useState(null)
      const [loading, setLoading] = React.useState(!props.snapshot)
      // FIX-7：过滤开关读回链路不可用时的**自救入口**——组件内部 override，不依赖 prefs 喵
      const [showAll, setShowAll] = React.useState(false)
      // 视图切换：列表（树）/ 拓扑图喵。初值优先取 tab.meta（重载后恢复），再退模块级兜底（同页 remount 不丢）喵
      const uiState = readUiState(props.tab)
      // FIX-52：用户没选过视图时用设置页里的「默认视图」喵（选过就尊重用户的选择）
      const [view, setView] = React.useState(
        uiState.viewChosen === true
          ? (uiState.view === 'topology' ? 'topology' : 'list')
          : (settings.defaultView === 'topology' ? 'topology' : 'list'),
      )
      // 图例可折叠喵：默认收起，用户可展开（展开状态同样持久化）
      const [legendOpen, setLegendOpen] = React.useState(uiState.legendOpen === true)
      // FIX-21：审计摘要条常驻可见，点它展开清单（展开状态同样持久化）喵
      const [auditOpen, setAuditOpen] = React.useState(uiState.auditOpen === true)
      // FIX-29：待办区（派生态清单 + 可选的待办原文，md 子集渲染）喵
      const [todoOpen, setTodoOpen] = React.useState(uiState.todoOpen !== false)
      const [todoExpanded, setTodoExpanded] = React.useState(uiState.todoExpanded === true)
      const [todoText, setTodoText] = React.useState(null)
      const [todoReason, setTodoReason] = React.useState(null)
      // FIX-40：B 区（agent 执行队列）自己的折叠位与 A 区互不干扰喵
      const [queueOpen, setQueueOpen] = React.useState(uiState.queueOpen !== false)
      // FIX-41：A 区可写 —— 编辑态、草稿、以及"保存成功/失败/冲突"的明示状态喵
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [todoStatus, setTodoStatus] = React.useState(null)
      const [savingTodo, setSavingTodo] = React.useState(false)
      // FIX-45：`todoHash` 是**宿主对同一份文本**算出来的权威指纹（读取与哈希同源）；
      // `todoWritable` = 写通道可用（拿不到就只读显示，绝不拿"另一份读法"的指纹去比）喵
      const [todoHash, setTodoHash] = React.useState(null)
      const [todoWritable, setTodoWritable] = React.useState(false)
      const persistUi = (patch) => persistUiState(props.remoteCtx, props.tab, patch)
      // M3 §3.1：跳不动时**展示 + 复制 session id**，并在 tab 里给一句提示（不自造路由）喵
      const [jumpNote, setJumpNote] = React.useState(null)
      const handleJump = (sessionId) => {
        if (openSessionConversation(props.remoteCtx, sessionId)) return
        setJumpNote(`无法自动跳转到该会话，请手动打开这个 id（已尝试复制）：${sessionId}`)
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(sessionId)
          }
        } catch {
          /* 剪贴板不可用就只展示喵 */
        }
      }
      const effectivePrefs = showAll ? { hideDoneOneShot: false } : prefs

      /**
       * 把一次 `loadPanel()` 的结果落到 state 上喵（挂载、手动刷新、轮询**共用这一份**口径）喵。
       * FIX-13：`{ failed, reason }` 是「取数失败」，与「宿主返回空列表」是两回事喵。
       */
      const applyLoaded = (value) => {
        if (value && value.failed) {
          setFailure(value.reason || '取数失败（宿主未给出原因，可点「↻ 刷新」重试）')
          // FIX-27：失败时也把快照里那份 audit 留下（只留审计，不装作有血缘）喵
          setSnapshot(value.audit ? { audit: value.audit, members: [], roots: [], notes: value.notes || [] } : null)
        } else {
          setFailure(null)
          setSnapshot(value)
        }
        // FIX-38：记住血量（血缘 + 候选路径），轮询才能"只重读快照"而不重拉会话列表喵
        if (value && value.lineage) lineageRef.current = value.lineage
      }

      // FIX-38：轮询与手动刷新用 —— `lineageRef` 存血缘 + 候选路径，`pollRef` 存"只重读快照"的回调喵
      const lineageRef = React.useRef(null)
      const pollRef = React.useRef(async () => {})
      const [refreshing, setRefreshing] = React.useState(false)
      // FIX-96：强制刷新（跑审计 + 重写面板数据）的三件状态喵：进行中 / 上次触发时刻（节流） / 一行提示
      const [forcing, setForcing] = React.useState(false)
      const [forceNote, setForceNote] = React.useState(null)
      const forceAtRef = React.useRef(0)

      /**
       * FIX-96：**强制刷新** —— 人自己走的那条路（= 主代理跑一次 `audit_scan`）喵。
       *
       * 走的是**待办写路由**的同一条 POST（`action: 'force-refresh'`）：栅栏与白名单沿用那一套
       * （仍然只认已登记项目的待办路径，没有新增暴露面），宿主侧的实现与 `audit_scan` **同源**喵。
       * 三条纪律：进行中**禁用**按钮 + 防连点（最小间隔） + 失败**必须可见**（绝不静默）喵。
       */
      const forceRefresh = async () => {
        if (forcing) return
        const nowMs = Date.now()
        const gate = forceThrottle(forceAtRef.current, nowMs)
        if (!gate.allowed) {
          setForceNote({ kind: 'error', text: `刚跑过，${gate.waitSeconds} 秒后可再点（防连点）` })
          return
        }
        const todoPath = (snapshot && snapshot.paths && snapshot.paths.todoFile) || null
        if (!todoPath) {
          setForceNote({
            kind: 'error',
            text: '拿不到待办文件路径 ⇒ 这条写通道用不了（先让主代理跑一次 `audit_scan`，之后这里就能用了）',
          })
          return
        }
        setForcing(true)
        forceAtRef.current = nowMs
        setForceNote({ kind: 'running', text: FORCE_RUNNING_NOTE })
        const result = await postTodo({ path: todoPath, action: 'force-refresh' })
        if (result && result.ok && result.value) {
          setForceNote({ kind: 'ok', text: forceResultText(result.value) })
          // 成功即**立刻重读**（不必等下一拍轮询）—— 快照已经变了喵
          void loadAll()
        } else {
          setForceNote({ kind: 'error', text: `强制刷新失败：${todoErrorText(result && result.error)}` })
        }
        setForcing(false)
      }

      /** 整轮重载（血缘 + 快照）喵：手动「↻ 刷新」用，挂载时也走它喵。 */
      const loadAll = async () => {
        setRefreshing(true)
        try {
          applyLoaded(await loadPanel(props.remoteCtx, props.scope))
        } catch (error) {
          setFailure(messageOf(error))
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }
      // 轮询走"**只重读快照**"这条路：一次几 KB，不重拉 session 列表与投影（那才是贵的）喵
      pollRef.current = async () => {
        const lineage = lineageRef.current
        if (!lineage) return
        try {
          const next = await refreshPanelSnapshot(props.remoteCtx, props.scope, lineage)
          if (next) applyLoaded(next)
        } catch {
          /* 轮询失败不推翻现有视图：下一次到点再试，用户也可点「↻ 刷新」喵 */
        }
      }

      React.useEffect(() => {
        if (props.snapshot) return undefined
        let alive = true
        // FIX-16：用**注入后**的 ctx（`props.remoteCtx`），不是渲染期的 `props.ctx` 喵
        loadPanel(props.remoteCtx, props.scope).then((value) => {
          if (!alive) return
          applyLoaded(value)
          setLoading(false)
        }).catch((error) => {
          if (!alive) return
          setFailure(String(error && error.message ? error.message : error))
          setLoading(false)
        })
        return () => { alive = false }
      }, [])

      /**
       * FIX-38：**快照轮询**喵 —— 面板原先只在挂载时读一次，宿主重建 `panel.json` 后不刷新，
       * 用户只能"重开 tab"碰运气（前身即 FIX-36 的"派生 0 条"）喵。这里只重读**快照**（便宜），
       * 页面隐藏时跳过（别白烧 IO）；卸载即 clearInterval，不留定时器喵。
       */
      // FIX-52：轮询间隔与开关都来自设置页（5~300 秒；关掉自动刷新即 0 = 不轮询）喵
      const pollIntervalMs = settings.autoRefresh ? Math.max(5, settings.pollSeconds) * 1000 : 0
      React.useEffect(() => {
        if (props.snapshot || !pollIntervalMs) return undefined
        let tick = 0
        const doc = typeof document !== 'undefined' ? document : null
        const pollOnce = () => {
          if (!shouldPoll(doc)) return
          tick += 1
          // FIX-47：常规只重读快照（便宜）；每 PANEL_FULL_RELOAD_EVERY 拍做一次整轮重载，
          // 让成员树/成员数也能跟上（实测"待办更新了、成员数没更新"就是这个缺口）喵
          if (nextPollMode(tick) === 'full') { void loadAll() } else { void pollRef.current() }
        }
        const timer = setInterval(pollOnce, pollIntervalMs)
        /**
         * FIX-65：**页面重新可见时立刻刷一次**喵。
         *
         * 病根：隐藏期间轮询暂停（FIX-38 的"别白烧 IO"），而切回来**没有**任何补偿 ⇒
         * 用户看到的是"切回来还得再等最多一拍"（原来 20 秒）＝体感"很久都不动"喵。
         * 现在：`visibilitychange` 里判"变可见"就立刻 poll 一次（仍然是便宜的只重读快照）喵。
         */
        const onVisibility = () => { if (doc && !doc.hidden) pollOnce() }
        if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility)
        return () => {
          clearInterval(timer)
          if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility)
        }
      }, [pollIntervalMs, props.snapshot])

      // A 区（大方向待办）的**原文**来自配置里那个待办文件；路径由快照给出（client 拿不到项目根）喵
      const todoPath = snapshot && snapshot.paths ? snapshot.paths.todoFile : null
      /**
       * 读待办原文喵（FIX-45 治本）喵：**先走宿主写路由的 `read` 动作** ——
       * 这样"面板看到的文本"与"冲突校验用的文本"是**同一次读**，从结构上消灭"两侧读法不同"喵。
       * 路由不可用（宿主没挂 webServer / 版本旧）时退化为**只读显示**（走只读 remote），
       * 并明确标出"编辑不可用"，绝不拿另一份读法的指纹去发起写入喵。
       */
      const reloadTodo = React.useCallback(async () => {
        if (!todoPath) return null
        const viaRoute = await postTodo({ path: todoPath, action: 'read' })
        if (viaRoute.ok && viaRoute.value) {
          setTodoText(viaRoute.value.text)
          setTodoReason(viaRoute.value.text === null ? '待办文件还没创建（保存一次即可）' : null)
          setTodoHash(viaRoute.value.hash ?? null)
          setTodoWritable(true)
          return viaRoute.value
        }
        const fallback = await loadTodoFile(props.remoteCtx, props.scope, todoPath)
        setTodoText(fallback.text)
        setTodoReason(fallback.reason || todoErrorText(viaRoute.error))
        setTodoHash(null)
        setTodoWritable(false)
        return fallback
      }, [todoPath, props.remoteCtx, props.scope])

      React.useEffect(() => {
        if (!todoPath) {
          // FIX-51 ②：**没去读**也要说清原因，禁止兜底成"未知原因"喵
          setTodoReason('快照未提供待办文件路径（快照陈旧或未生成；点「↻ 刷新」或触发一次审计即可重建）')
          setTodoWritable(false)
          return undefined
        }
        let alive = true
        reloadTodo().catch((error) => {
          if (!alive) return
          setTodoText(null)
          setTodoReason(messageOf(error))
        })
        return () => { alive = false }
      }, [todoPath, reloadTodo])

      /** 写通道的公共前半段：带 baseHash（我渲染的是哪一版）发起写入，并把结果翻成人话喵。 */
      const sendTodoWrite = async (payload) => {
        if (!todoPath || savingTodo) return null
        if (!todoWritable) {
          setTodoStatus({ kind: 'error', text: '写通道不可用（拿不到宿主下发的权威指纹）→ 本次不发送；点「↻ 刷新」重试' })
          return null
        }
        setSavingTodo(true)
        setTodoStatus(null)
        // FIX-45：用宿主 `read` 动作下发的指纹（同源）；没有它就不发写入（拿别的读法去比必然误报）喵
        const baseHash = todoHash
        const result = await postTodo({ path: todoPath, baseHash, ...payload })
        setSavingTodo(false)
        return result
      }

      /**
       * 勾选 / 取消一条待办喵（FIX-41 ①）喵。
       * **非编辑态**点复选框即可切换；真正的行级翻转由宿主完成（只动那一行三个字符）喵。
       */
      const toggleTodoItem = async (line, checked) => {
        const result = await sendTodoWrite({ action: 'toggle', line })
        if (!result) return
        if (result.ok) {
          await reloadTodo()
          setTodoStatus({ kind: 'ok', text: `已${checked ? '取消勾选' : '勾选'}第 ${line + 1} 行（旧版已备份）` })
          return
        }
        setTodoStatus({
          kind: result.error && result.error.code === 'stale-file' ? 'conflict' : 'error',
          text: todoErrorText(result.error),
          detail: todoConflictDetail(result),
        })
      }

      /** 保存编辑喵（FIX-41 ②）喵：整篇写入同样带 baseHash；冲突时**保留草稿**只提示刷新喵。 */
      const saveTodoDraft = async () => {
        const result = await sendTodoWrite({ action: 'save', content: draft })
        if (!result) return
        if (result.ok) {
          await reloadTodo()
          setEditing(false)
          setTodoStatus({ kind: 'ok', text: '已保存（旧版已备份）' })
          return
        }
        setTodoStatus({
          kind: result.error && result.error.code === 'stale-file' ? 'conflict' : 'error',
          text: todoErrorText(result.error),
          detail: todoConflictDetail(result),
        })
      }

      // 空态四分类（FIX-12 / FIX-13 / §9-20），绝不混喵
      const state = panelViewState({ loading, failure, snapshot, prefs: effectivePrefs })
      /**
       * 审计摘要条 + 可展开清单喵（FIX-21）喵。
       *
       * 为什么必须有它：用户答复「都没看到」——快照里 `audit: {red:3, yellow:26}` 是真值，
       * 但面板只拿它做了徽章，红黄汇总与条目**根本没有入口**。摘要条常驻可见（不靠颜色，写中文数字），
       * 点一下展开逐条「路径 + 原因 + 建议」喵。
       * 数据来自派生快照，**与会话血缘无关**，所以血缘为空时它也照常显示（那正是最需要看审计的时候）喵。
       */
      const renderAuditBar = () => {
        const lines = auditLines(snapshot && snapshot.audit)
        return h('div', { style: styles.audit, 'data-testid': 'agent-contract-audit' },
          h('div', {
            style: { ...styles.auditHead, cursor: lines.length ? 'pointer' : 'default' },
            onClick: () => {
              if (!lines.length) return
              const next = !auditOpen
              setAuditOpen(next)
              persistUi({ auditOpen: next })
            },
            // FIX-43（用户口径）：诊断文字不再占版面 —— 挪进 tooltip，能力不丢、页面干净喵
            title: [
              lines.length ? '点击展开/收起审计清单' : '本条暂无条目',
              // FIX-47（可选）：说清这份审计结论"截至何时"（沿用旧结论时非空）——只有悬停才占位喵
              snapshot && snapshot.audit && snapshot.audit.asOf ? `审计数据截至：${snapshot.audit.asOf}` : '',
              ...((snapshot && snapshot.notes) || []),
            ].filter(Boolean).join('\n'),
          }, `${lines.length ? (auditOpen ? '▾' : '▸') : '·'} ${auditSummaryText(snapshot && snapshot.audit)}`
            + (lines.length ? `（${lines.length} 条，点此${auditOpen ? '收起' : '展开'}）` : '')),
          // FIX-37：一行说清"这是项目级数据"，免得用户以为不同会话之间串了喵
          h('div', { style: styles.auditScope }, AUDIT_SCOPE_NOTE),
          // FIX-91 ②：占位时**给动作**（不许只留空白/只写"待接"）—— 文案由 host 随快照下发，
          // 说清"面板只在有动作时写入、纯重启不会重算"，并给出下一步喵
          snapshot && snapshot.audit && snapshot.audit.placeholder
            ? h('div', {
              style: styles.projectHint,
              'data-testid': 'agent-contract-audit-hint',
              title: snapshot.audit.action || AUDIT_PLACEHOLDER_HINT,
            }, snapshot.audit.action || AUDIT_PLACEHOLDER_HINT)
            : null,
          // FIX-61：结构缺失时给一句**可执行**的提示（"调 project_init"）；结构齐时快照不带该字段 ⇒ 一个像素都不占喵
          snapshot && snapshot.projectHint
            ? h('div', {
              style: styles.projectHint,
              'data-testid': 'agent-contract-project-hint',
              title: snapshot.projectHint,
            }, snapshot.projectHint)
            : null,
          auditOpen
            ? h('div', { style: styles.auditList }, ...lines.map((line, index) => h('div', {
              key: index,
              // FIX-21 修订：整行按等级着色（红/黄），不再在行首拼 `[红]/[黄]` 前缀喵
              style: {
                ...styles.auditItem,
                color: AUDIT_LEVEL_COLORS[line.level] || 'inherit',
                // FIX-30：能定位到会话的行才可点（解不出来就别给"可点"的假象）喵
                ...(line.sessionId ? { cursor: 'pointer', textDecoration: 'underline dotted' } : {}),
              },
              title: `${AUDIT_LEVEL_LABELS[line.level] || ''}${line.sessionId ? '｜点击跳转到该 Agent 的会话' : ''}`,
              // FIX-30：点行跳会话（复用与卡片双击同一条跳转链路）喵
              onClick: line.sessionId ? () => handleJump(line.sessionId) : undefined,
            }, line.text)))
            : null)
      }
      /**
       * **A 区 · 待办任务（大方向）**喵（FIX-40/41）喵。
       *
       * 内容是配置里那个待办文件的**原文**（人维护的路线图/批次计划），**不掺任何机器条目**喵。
       * 它也是面板**唯一的可写目标**：非编辑态点复选框即勾选（行级翻转，其余字节不动），
       * 点「编辑」可改可存 —— 真正的写入由宿主写通道完成（白名单 + 备份 + 冲突检测）喵。
       */
      const renderHumanTodo = () => {
        const preview = truncateLines(todoText || '', TODO_PREVIEW_LINES, todoExpanded)
        const blocks = todoText && todoText.trim() ? parseMdSubset(preview.text) : []
        const statusColor = !todoStatus ? null
          : (todoStatus.kind === 'ok' ? '#3fb950' : (todoStatus.kind === 'conflict' ? '#d29922' : '#f85149'))
        const head = h('span', {
          style: { ...styles.blockHead, cursor: 'pointer' },
          title: '点击展开/收起',
          onClick: () => {
            const next = !todoOpen
            setTodoOpen(next)
            persistUi({ todoOpen: next })
          },
        }, `${todoOpen ? '▾' : '▸'} 待办任务（大方向）`)
        const actions = editing
          ? [
            h('button', {
              key: 'save', style: styles.button, disabled: savingTodo, onClick: () => { void saveTodoDraft() },
            }, savingTodo ? '保存中…' : '保存'),
            h('button', { key: 'cancel', style: styles.button, onClick: () => { setEditing(false); setTodoStatus(null) } }, '取消'),
          ]
          : h('button', {
            key: 'edit',
            disabled: !todoWritable,
            style: { ...styles.button, opacity: todoWritable ? 1 : 0.5 },
            'data-testid': 'agent-contract-todo-edit',
            title: todoWritable ? `编辑待办文件（唯一可写目标：${todoPath || '未配置'}）` : '写通道不可用时不可编辑（点「↻ 刷新」重试）',
            onClick: () => {
              setEditing(true)
              setDraft(todoText || '')
              setTodoStatus(null)
            },
          }, '编辑')
        return h('div', { style: styles.block, 'data-testid': 'agent-contract-human-todo' },
          h('div', { style: styles.blockHeadRow }, head, actions),
          // ⑦ 状态可见：成功 / 失败 / 冲突都显式写出来，绝不静默喵
          todoStatus
            ? h('div', {
              style: { ...styles.todoStatus, color: statusColor },
              'data-testid': 'agent-contract-todo-status',
              // FIX-45 ③：冲突时把宿主回带的实际值放进 tooltip，一次悬停就能定位"两侧读法不同"喵
              title: todoStatus.detail || '',
            }, `${todoStatus.kind === 'ok' ? '✓ ' : (todoStatus.kind === 'conflict' ? '⚠ ' : '✗ ')}${todoStatus.text}`)
            : null,
          todoOpen
            ? h('div', { style: styles.blockBody },
              editing
                ? [
                  h('textarea', {
                    key: 'editor',
                    value: draft,
                    rows: 12,
                    spellCheck: false,
                    style: styles.editor,
                    'data-testid': 'agent-contract-todo-editor',
                    onChange: (event) => setDraft(event.target.value),
                  }),
                  h('div', { key: 'hint', style: styles.note }, `将写入：${todoPath || '(未配置待办文件)'}`),
                ]
                : [
                  todoText === null
                    ? h('div', { key: 'miss', style: styles.note }, `待办原文未读到：${todoReason || '读取时没有拿到内容（可点「↻ 刷新」重试）'}`)
                    : (blocks.length
                      ? h('div', { key: 'md' }, ...blocks.map((block, index) => renderMdBlock(block, `${index}`, {
                        onToggle: savingTodo || !todoWritable ? null : toggleTodoItem,
                      })))
                      : h('div', { key: 'empty', style: styles.note }, '（无待办）')),
                  preview.truncated
                    ? h('button', {
                      key: 'more',
                      style: styles.button,
                      onClick: () => {
                        setTodoExpanded(true)
                        persistUi({ todoExpanded: true })
                      },
                    }, `展开全部（共 ${preview.total} 行，已显示 ${preview.shown}）`)
                    : null,
                ])
            : null)
      }

      /**
       * **B 区 · agent 待办（执行队列）**喵（FIX-40）喵。
       *
       * 未结任务 / 缺失产出 / 审计红黄条目 —— "agent 还没干完的活"，每条可点定位喵。
       * 与 A 区**各自独立**：自己的折叠位、自己的空态文案、**不渲染 md 原文**（那是 A 区的活）喵。
       */
      const renderAgentQueue = () => {
        // FIX-36：`todos === null` = 快照陈旧/缺失 → **未知**，绝不当成"0 条"来显示喵
        const unknown = snapshot.todos === null || snapshot.todos === undefined
        const todos = !unknown && Array.isArray(snapshot.todos) ? snapshot.todos : []
        const kindOf = (item) => (item.kind === 'task' ? '任务' : (item.level === 'red' ? '红' : '黄'))
        return h('div', { style: styles.block, 'data-testid': 'agent-contract-agent-queue' },
          h('div', {
            style: { ...styles.blockHead, cursor: 'pointer' },
            title: '点击展开/收起',
            onClick: () => {
              const next = !queueOpen
              setQueueOpen(next)
              persistUi({ queueOpen: next })
            },
          }, `${queueOpen ? '▾' : '▸'} agent 待办（执行队列）${unknown ? '' : `（${todos.length} 条）`}`),
          queueOpen
            ? h('div', { style: styles.blockBody },
              unknown
                ? h('div', { style: styles.note }, `数据源待接：${snapshot.staleReason || '快照未生成'}`)
                : (todos.length
                  ? todos.map((item, index) => h('div', {
                    key: index,
                    // FIX-30：带 sessionId 的待办行可点 → 跳到该 Agent 的会话（没有 id 的就不装可点）喵
                    style: { ...styles.todoItem, ...(item.sessionId ? { cursor: 'pointer', textDecoration: 'underline dotted' } : {}) },
                    title: item.sessionId ? '点击跳转到该 Agent 的会话' : '',
                    onClick: item.sessionId ? () => handleJump(String(item.sessionId)) : undefined,
                  },
                  h('span', { style: styles.todoKind }, `[${kindOf(item)}]`),
                  h('span', null, item.title || ''),
                  item.path ? h('div', { style: styles.todoPath }, item.path) : null))
                  : h('div', { style: styles.note }, '（执行队列为空）')))
            : null)
      }
      if (state.kind === 'loading') return h('div', { style: styles.wrap }, EMPTY_STATES.loading)
      if (state.kind === 'failed') {
        return h('div', { style: styles.wrap },
          h('div', null, EMPTY_STATES.failed),
          h('div', { style: styles.note }, `原因：${state.reason}`),
          // FIX-27：血缘失败照样给审计入口 —— 快照读得到就显真值，读不到写"数据源待接"喵
          renderAuditBar(),
          h('div', { style: styles.note }, '数据来自宿主 remote.session / remote.workspaceFiles（只读）。'))
      }
      if (state.kind === 'emptySource') {
        // FIX-43（用户口径）：诊断文字不占版面 —— 收进 tooltip（悬停可见），页面上只留一句结论喵
        return h('div', { style: styles.wrap },
          h('div', {
            title: ['数据源为空：宿主返回的会话列表里一个节点都没有。', ...(snapshot.notes || [])].join('\n'),
          }, EMPTY_STATES.sourceEmpty),
          // 血缘为空照样能看审计（快照是另一条数据源），别让用户在这里白等喵
          renderAuditBar())
      }
      const rows = state.kind === 'tree' ? state.rows : []
      return h('div', { style: styles.wrap },
        h('div', { style: styles.header },
          h('strong', null, '契约'),
          h('span', { style: { opacity: 0.7 } }, `成员 ${snapshot.members.length}`),
          // FIX-38：手动整轮刷新 —— 宿主重建快照后不必重开 tab（轮询是兜底，这个是"立刻"）喵
          h('button', {
            onClick: () => { loadAll() },
            style: styles.button,
            title: REFRESH_HINT,
            'data-testid': 'agent-contract-refresh',
          }, refreshing ? '刷新中…' : REFRESH_LABEL),
          // FIX-96：**强制刷新** —— 跑一次审计 + 重写面板数据（人自己走的那条路，等同主代理 audit_scan）喵
          h('button', {
            onClick: () => { void forceRefresh() },
            // 进行中**禁用**（防连点，也让人知道它在跑）喵
            disabled: forcing,
            style: { ...styles.button, ...(forcing ? { opacity: 0.6, cursor: 'default' } : {}) },
            title: FORCE_HINT,
            'data-testid': 'agent-contract-force-refresh',
          }, forcing ? FORCE_RUNNING_TEXT : FORCE_LABEL),
          showAll
            ? h('button', {
              onClick: () => {
                setShowAll(false)
                void writePanelSetting(props.forms, { hideDoneOneShot: true }).then((result) => {
                  if (!result.ok) setTodoStatus({ kind: 'error', text: `过滤开关没能存进设置：${result.reason}` })
                })
              },
            }, EMPTY_STATES.restoreDefault)
            : null,
          // 视图切换喵：列表（树）/ 拓扑图
          h('span', { style: styles.switch },
            h('button', {
              onClick: () => { setView('list'); persistUi({ view: 'list', viewChosen: true }) },
              style: { ...styles.tabBtn, ...(view === 'list' ? styles.tabActive : {}) },
            }, VIEW_LABELS.list),
            h('button', {
              onClick: () => { setView('topology'); persistUi({ view: 'topology', viewChosen: true }) },
              style: { ...styles.tabBtn, ...(view === 'topology' ? styles.tabActive : {}) },
            }, VIEW_LABELS.topology)),
        ),
        renderAuditBar(),
        rows.length
          ? (view === 'topology'
            // 拓扑视图喵：用过滤后的树重新布局
            ? h(TopologyView, { roots: filterTree(snapshot.roots, effectivePrefs), onJump: handleJump, onViewport: persistUi, badgeLabels: settings.badgeLabels })
            : [h(ListHeader, { key: '__list-head' }), ...rows.map((row) => h(NodeRow, {
              key: row.node.sessionId || row.node.name,
              node: row.node,
              depth: row.depth,
              onJump: handleJump,
              // FIX-53：徽章文字标签开关**显式传下去**（模块级组件看不到 ContractTab 的 settings）喵
              badgeLabels: settings.badgeLabels,
            }))])
          : h('div', null,
            h('div', null, EMPTY_STATES.filteredOut),
            h('button', {
              'data-testid': 'agent-contract-show-all',
              // FIX-52 ⑦：面板里的这个开关与设置页**同一份值**（写回设置），所以重启后保持喵
              onClick: () => {
                setShowAll(true)
                void writePanelSetting(props.forms, { hideDoneOneShot: false }).then((result) => {
                  if (!result.ok) setTodoStatus({ kind: 'error', text: `过滤开关没能存进设置：${result.reason}` })
                })
              },
              style: styles.button,
            }, EMPTY_STATES.showAll),
            h('div', { style: styles.note }, '被默认开关「隐藏已完成的一次性节点」挡住了，点上面的按钮立刻显示。')),
        // FIX-97 ③：**插件自检异常**（典型：台账领域打不开 ⇒ 快照不再重写）要在页面直说 ——
        // 这不是"数据陈旧"，而是"插件没正常工作"，藏进 tooltip 等于没说喵
        snapshot && snapshot.setupError
          ? h('div', {
            style: { ...styles.note, color: '#f85149' },
            'data-testid': 'agent-contract-setup-error',
            title: String(snapshot.setupError.message || ''),
          }, `插件自检异常：${snapshot.setupError.message || '(宿主没写出原因；见 notes 与 tooltip)'}`)
          : null,
        jumpNote ? h('div', { style: styles.jumpNote }, jumpNote) : null,
        // FIX-96 ④：强制刷新的一行状态（正在跑 / 成功回执 / **失败原因**）—— 绝不静默喵
        forceNote
          ? h('div', {
            style: { ...styles.note, color: forceNote.kind === 'error' ? '#f85149' : 'inherit' },
            'data-testid': 'agent-contract-force-note',
          }, forceNoteText(forceNote))
          : null,
        // FIX-40：**两块分开** —— A 区给人看的大方向待办（原文、可勾可编），B 区是机器算的执行队列喵
        renderHumanTodo(),
        renderAgentQueue(),
        // 图例喵：可折叠（默认展开）——把五枚徽章各是什么写在面板里，收起后不占地方喵
        h('div', { style: styles.legend },
          h('div', {
            style: styles.legendHead,
            onClick: () => {
              const next = !legendOpen
              setLegendOpen(next)
              persistUi({ legendOpen: next })
            },
          }, `${legendOpen ? '▾' : '▸'} 徽章说明（点击${legendOpen ? '收起' : '展开'}）`),
          legendOpen
            ? [
              ...badgeRow({ role: null, badges: {} }).map((item) => h('span', { key: item.key, style: styles.legendItem },
                h('b', null, item.key), `：${item.hint}`)),
              // FIX-20：取值对照 —— 每枚徽章都写「符号 + 中文状态词」，灰度/去色下靠符号即可分辨喵
              h('span', { key: '__values', style: styles.legendItem },
                h('b', null, '取值'), '：', ['ok', 'warn', 'missing', 'unknown', 'na'].map(badgeText).join(' / '),
                '（顺序固定：契约 / 三档 / 进度 / 预算 / 异源）'),
            ]
            : null),
      )
    }


    // ---------------------------------------------------------------- 设置页分区（FIX-52）
    /** 可选服务探测喵：访问未注入的服务在 cordis 里会**抛错**，所以探测必须包在 try 里喵。 */
    function tryGetService(ctx, name) {
      try {
        return ctx ? ctx[name] : undefined
      } catch {
        return undefined
      }
    }

    /**
     * 读表单**快照全貌**喵（FIX-52 真机补充）：除了值，还要 status / mode / writable / revision ——
     * `status: 'unavailable'` = **这个命名空间没暴露给本客户端**，`mode: 'memory'` = 只活在浏览器进程里，
     * 两者都意味着"写了也存不住"，必须**显式告诉用户**而不是让控件看起来能点却毫无反应喵。
     */
    function readFormSnapshot(forms) {
      try {
        const snapshot = forms && typeof forms.getSnapshot === 'function' ? forms.getSnapshot() : null
        if (!snapshot) return null
        return {
          status: snapshot.status || 'unknown',
          mode: snapshot.mode || 'unknown',
          writable: snapshot.writable === true,
          revision: snapshot.revision === undefined ? null : snapshot.revision,
          value: snapshot.value,
        }
      } catch {
        return null
      }
    }

    /** 读表单当前值喵：`getSnapshot().value` 是宿主把"配置文件层 + 设置页层"合成后的值喵。 */
    function readFormValue(forms) {
      try {
        const snapshot = forms && typeof forms.getSnapshot === 'function' ? forms.getSnapshot() : null
        return (snapshot && snapshot.value) || undefined
      } catch {
        return undefined
      }
    }

    /**
     * 把面板设置写回表单喵（FIX-52 ⑦/⑧）喵：写的是 `panel` **整个对象**（与 JSON 编辑区同一条写路径），
     * 这样"面板内开关"与"设置页 JSON"永远一致，不会各写各的喵。
     */
    async function writePanelSetting(forms, patch) {
      if (!forms || typeof forms.mutate !== 'function') return { ok: false, reason: '宿主表单没有 mutate 面' }
      // 官方形状（`ui-settings/src/client/config-form.ts:114`）：`set(field)` == `mutate([{op:'set', path:[field], value}])`
      // ⇒ **path 是数组**；这里按叶子路径逐项写（面板项 → ['panel', key]）喵
      const ops = Object.entries(patch || {}).map(([key, value]) => ({ op: 'set', path: ['panel', key], value }))
      if (!ops.length) return { ok: true, reason: '' }
      try {
        const accepted = await forms.mutate(ops)
        return accepted === false
          ? { ok: false, reason: '宿主返回 false（未接受这次写入）' }
          : { ok: true, reason: '' }
      } catch (error) {
        // **不许静默**：把宿主的原话带出来（FIX-41 ⑦ / §5 报告纪律）喵
        const code = error && error.code ? String(error.code) : ''
        const message = error && error.message ? String(error.message) : String(error)
        return { ok: false, reason: `${code}${code ? '：' : ''}${message}` }
      }
    }

    /**
     * 设置页分区组件喵（FIX-52 ②③④⑥⑦）喵：开关 + 「调用 JSON」编辑区 + 保存 / 恢复默认 + 错误清单喵。
     * 保存走宿主表单的 `set(field, value)`；恢复默认走 `unset(field)`（回到**配置文件**那一层）喵。
     */
    function ContractSettingsSection(props) {
      const forms = props && props.forms
      const [prefs, setPrefs] = React.useState(() => panelPrefsFrom(readFormValue(forms)))
      const [text, setText] = React.useState(() => settingsJsonText(readFormValue(forms)))
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [store, setStore] = React.useState(() => readFormSnapshot(forms))
      const dirty = React.useRef(false)
      // 只有"拿得到表单 + 宿主说可写 + **不是内存模式**"时才允许改喵。
      // 内存模式（`mode: 'memory'`）下客户端的 `mutate()` 会直接 resolve(false) —— 写了不落盘，
      // 所以那种部署必须禁用控件并说明"改配置请改 cordis.patch.yml"（真机踩过：控件能点、点了没反应）喵
      const canWrite = Boolean(forms) && store !== null && store.writable === true && store.mode !== 'memory'
      const storeNote = !forms
        ? '未拿到设置存储（宿主 configForms 未就绪）—— 控件已禁用'
        : (store === null
          ? '设置存储读取失败 —— 控件已禁用'
          : (store.writable
            ? `设置存储：${store.status} / ${store.mode} / 可写（revision ${store.revision ?? '-'}）`
            : `设置存储**不可写**（status=${store.status} / mode=${store.mode}）—— 控件已禁用：`
              + (store.mode === 'memory'
                ? '本部署的设置只在浏览器进程内（内存模式）⇒ 写了不会持久化；请改 `cordis.patch.yml` 后重启'
                : (store.status === 'unavailable'
                  ? '该命名空间未暴露给本客户端'
                  : '宿主当前不接受写入（可能是只读部署）'))))

      React.useEffect(() => {
        if (!forms || typeof forms.subscribe !== 'function') return undefined
        const sync = () => {
          setStore(readFormSnapshot(forms))
          const value = readFormValue(forms)
          setPrefs(panelPrefsFrom(value))
          // 只在用户没在改的时候重填编辑区，别把人家的草稿冲掉喵
          if (!dirty.current) setText(settingsJsonText(value))
        }
        sync()
        return forms.subscribe(sync)
      }, [forms])

      const applyStatus = (kind, textValue, errors) => setStatus({ kind, text: textValue, errors: errors || [] })

      const saveJson = async () => {
        const verdict = validateSettingsJson(text)
        if (!verdict.ok) {
          applyStatus('error', '没有保存：JSON 有 %d 处问题（见下）'.replace('%d', String(verdict.errors.length)), verdict.errors)
          return
        }
        setBusy(true)
        // FIX-55 ②：**缺键 = 继承**（空对象同理）—— 对这类键发 **unset**（回落到插件默认）而不是把空值写下去，
        // 免得"用户把 modelRoutes 写成 {}"把默认的异源路由抹掉（那是静默失效）喵
        const ops = []
        for (const key of ['modelRoutes', 'panel']) {
          const value = verdict.value[key]
          if (value === undefined || (value && Object.keys(value).length === 0)) {
            ops.push({ op: 'unset', path: [key] })
            continue
          }
          // 叶子路径逐项写：`modelRoutes.<角色>` / `panel.<设置项>`（对象也当作该路径上的 JSON 值）喵
          for (const [leaf, leafValue] of Object.entries(value)) ops.push({ op: 'set', path: [key, leaf], value: leafValue })
        }
        let accepted = true
        let reason = ''
        try {
          if (typeof forms.mutate === 'function') {
            accepted = (await forms.mutate(ops)) !== false
            if (!accepted) reason = '宿主返回 false（未接受这次写入）'
          } else {
            for (const write of settingsWritesOf(verdict.value)) {
              // eslint-disable-next-line no-await-in-loop -- 没有 mutate 面时只能逐项 set 喵
              if ((await forms.set(write.field, write.value)) === false) accepted = false
            }
            if (!accepted) reason = '宿主返回 false（未接受这次写入）'
          }
        } catch (error) {
          accepted = false
          reason = `${error && error.code ? `${error.code}：` : ''}${error && error.message ? error.message : String(error)}`
        }
        setBusy(false)
        dirty.current = false
        if (accepted) applyStatus('ok', '已保存并生效（下次派单即用新路由；面板开关立即反映）')
        else applyStatus('error', '宿主拒绝了本次保存', [{ path: '宿主原话', message: reason || '(没给原因)' }])
      }

      const restoreDefaults = async () => {
        setBusy(true)
        try {
          await forms.unset('modelRoutes')
          await forms.unset('panel')
        } catch {
          /* 忽略：下面统一给状态喵 */
        }
        setBusy(false)
        dirty.current = false
        applyStatus('ok', '已恢复为配置文件（cordis.patch.yml）里的默认值')
      }

      /** 写一项面板设置，并把**结果**写成状态（成功/失败都要说话）喵。 */
      const commitPanelPatch = async (patch, label) => {
        const result = await writePanelSetting(forms, patch)
        if (result.ok) applyStatus('ok', `已保存：${label}（立刻生效）`)
        else applyStatus('error', `宿主拒绝了这次写入：${label}`, [{ path: '宿主原话', message: result.reason || '(没给原因)' }])
      }

      const switchRow = (key, label, hint) => h('label', { style: styles.settingRow, key },
        h('input', {
          type: 'checkbox',
          checked: prefs[key] === true,
          disabled: !canWrite,
          'data-testid': `agent-contract-setting-${key}`,
          onChange: (event) => { void commitPanelPatch({ [key]: event.target.checked }, `${label} = ${event.target.checked}`) },
        }),
        h('span', null, label),
        hint ? h('span', { style: styles.settingHint }, hint) : null)

      return h('div', { style: styles.settingsWrap, 'data-testid': 'agent-contract-settings' },
        // 存储状态**常驻可见**：能写/不能写、以及为什么（真机排查的第一现场）喵
        h('div', {
          style: { ...styles.settingHint, color: canWrite ? 'inherit' : '#d29922' },
          'data-testid': 'agent-contract-settings-store',
        }, storeNote),
        // 当前版本**已知写不进去**（宿主只允许写 volatile 字段，而 volatile 会让配置文件失效 ⇒ 口径待裁决）：
        // 与其让用户点了没反应，不如把"改哪里"直接写在这儿喵
        h('div', {
          style: { ...styles.settingHint, color: '#d29922' },
          'data-testid': 'agent-contract-settings-pending',
        }, '本页管：模型路由（modelRoutes）与五个面板开关；它们由设置页持久化（volatile），'
          + '改完立即生效、重启后保持。路径 / 审计阈值这类要重建数据的配置仍改 cordis.patch.yml。'),
        h('div', { style: styles.settingGroup }, '面板'),
        switchRow('hideDoneOneShot', '隐藏已完成的一次性节点'),
        switchRow('autoRefresh', '面板自动刷新', '关掉后只在手动点「↻ 刷新」时更新'),
        h('label', { style: styles.settingRow },
          h('span', null, '轮询间隔（秒）'),
          h('input', {
            type: 'number', min: 5, max: 300, value: String(prefs.pollSeconds), disabled: !canWrite,
            'data-testid': 'agent-contract-setting-pollSeconds',
            style: styles.settingNumber,
            onChange: (event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) void commitPanelPatch({ pollSeconds: next }, `轮询间隔 = ${next} 秒`)
            },
          }),
          h('span', { style: styles.settingHint }, '5~300 秒；只重读派生快照，很便宜')),
        h('label', { style: styles.settingRow },
          h('span', null, '默认视图'),
          h('select', {
            value: prefs.defaultView,
            disabled: !canWrite,
            'data-testid': 'agent-contract-setting-defaultView',
            style: styles.settingNumber,
            onChange: (event) => { void commitPanelPatch({ defaultView: event.target.value }, `默认视图 = ${event.target.value}`) },
          },
          h('option', { value: 'list' }, '列表'),
          h('option', { value: 'topology' }, '拓扑图'))),
        switchRow('badgeLabels', '徽章显示文字标签', '关掉后格子只留符号（悬停仍可看全）'),

        h('div', { style: styles.settingGroup }, '调用 JSON（模型路由与面板开关）'),
        h('div', { style: styles.settingHint },
          '下面是**生效值**（插件默认 ⊕ 设置页里的覆盖，缺键即继承默认）。只允许改 modelRoutes / panel 两个键；'
          + '模型值可写字符串（模型名）或对象（provider/model/reasoningEffort/maxTokens）。'
          + '密钥不写在这里（由宿主/provider 账户持有）。'),
        h('textarea', {
          value: text,
          rows: 12,
          spellCheck: false,
          style: styles.editor,
          disabled: !canWrite,
          'data-testid': 'agent-contract-settings-json',
          onChange: (event) => { dirty.current = true; setText(event.target.value) },
        }),
        h('div', { style: styles.settingRow },
          h('button', {
            style: styles.button, disabled: busy || !canWrite, 'data-testid': 'agent-contract-settings-save',
            onClick: () => { void saveJson() },
          }, busy ? '保存中…' : '保存'),
          h('button', {
            style: styles.button, disabled: busy || !canWrite, 'data-testid': 'agent-contract-settings-restore',
            onClick: () => { void restoreDefaults() },
          }, '恢复默认（回到配置文件）')),
        status
          ? h('div', {
            style: { ...styles.todoStatus, color: status.kind === 'ok' ? '#3fb950' : '#f85149' },
            'data-testid': 'agent-contract-settings-status',
          },
          `${status.kind === 'ok' ? '✓ ' : '✗ '}${status.text}`,
          ...status.errors.map((item, index) => h('div', { key: index, style: styles.settingHint }, `${item.path}：${item.message}`)))
          : null)
    }

    /**
     * 注册设置页分区喵（FIX-52 ①）喵：用宿主**官方机制**
     * （`ctx.slots.inject('settings.section', () => ctx.slots.register(...))` + `ctx.configForms.get(ns)`），
     * **不自造存储**；宿主没挂这两样服务时不注册（静默降级），不影响插件其余功能喵。
     */
    function registerSettingsSection(ctx) {
      const slots = tryGetService(ctx, 'slots')
      const formsService = tryGetService(ctx, 'configForms')
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return null
      if (!formsService || typeof formsService.get !== 'function') return null
      let unregister = null
      try {
        slots.inject('settings.section', () => {
          unregister = slots.register({
            name: 'settings.section',
            id: SETTINGS_NS,
            order: 120,
            label: () => '多智能体契约',
            inject: () => ({ forms: formsService.get(SETTINGS_NS) }),
          }, ContractSettingsSection)
          return unregister
        })
      } catch {
        return null
      }
      return () => {
        if (typeof unregister === 'function') unregister()
      }
    }

    // ---------------------------------------------------------------- 插件体
    /**
     * FIX-13：**必须显式注入 remote 服务名**喵。
     * `ctx.remote.<ns>` 只在本数组里声明了才可用；`package.json` 的 `dsh.client.inject`
     * 只是「到达顺序提示」，**不是服务注入**——实测踩过：只 inject `betterSidebar` →
     * `ctx.remote` 为 undefined → 面板恒定"数据源为空"喵。
     */
    // FIX-52：`slots` / `configForms` 也必须**显式 inject** 才可访问 —— 与 `remote` 同一条规矩
    //（官方 client 插件都这么写：ui-agent-preset / ui-chat / ui-settings-account 的 inject 里都有这两个）。
    // 只靠 try 探测不够：未注入的服务**直接访问就抛错**，探测会静默跳过 ⇒ 设置页那一栏永远不出现喵。
    const inject = ['betterSidebar', 'remote', 'remote.session', 'remote.workspaceFiles', 'slots', 'configForms']

    function apply(ctx) {
      // FIX-52：设置页分区是**独立能力**（不依赖 betterSidebar），所以先注册；宿主没挂服务就静默降级喵。
      // 注意这里要判 `ctx.effect` 是否存在：套件会拿一个极简 ctx 调 apply（宿主无 client 能力的情形）喵
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const off = registerSettingsSection(ctx)
          return () => {
            if (typeof off === 'function') off()
          }
        })
      }
      if (!ctx || !ctx.betterSidebar) return // 宿主没有 betterSidebar：面板静默降级喵
      // FIX-16：这个 ctx 是**注入后**的（受本模块 `inject` 门控），数据加载一律用它；
      // 绝不能用组件渲染期的 `props.ctx`（它不带 inject）喵
      const injectedCtx = ctx
      // FIX-52：设置页表单（拿不到就是 null —— 面板退回内置默认，编辑区也不显示）喵
      let settingsForms = null
      try {
        const formsService = tryGetService(ctx, 'configForms')
        settingsForms = formsService && typeof formsService.get === 'function' ? formsService.get(SETTINGS_NS) : null
      } catch {
        settingsForms = null
      }
      const descriptor = {
        id: TAB_TYPE_ID,
        title: '契约',
        description: '子智能体契约谱系与合规徽章（只读）',
        order: 120,
        single: true,
        // 3.3 过滤开关：宿主据此渲染开关并持久化到 pluginSettings[本 tab id] 喵
        settings: {
          pluginToggles: [
            {
              key: 'hideDoneOneShot',
              title: '隐藏已完成的一次性节点',
              desc: '默认开启；关掉可看到全部节点',
              type: 'switch',
            },
          ],
        },
        icon: (size) => h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor',
        },
        h('rect', { x: 1.5, y: 1.5, width: 7, height: 7, rx: 1.5 }),
        h('rect', { x: 7.5, y: 7.5, width: 7, height: 7, rx: 1.5, opacity: 0.55 })),
        component: (props) => h(ContractTab, {
          // FIX-52：这里的兜底交给组件内（先看设置页、再退回内置默认）——曾经写死 defaultPrefs() ⇒ 设置页永远被盖住喵
          prefs: (props.tab && props.tab.meta && props.tab.meta.prefs) || null,
          // 设置页表单（宿主 configForms）：面板开关与设置页**同一份值**，改了立刻反映喵
          forms: settingsForms,
          // 宿主若已备好快照就直接用（省一次读取）；没给就由组件自己拉 —— 套件冒烟靠这条注入夹具喵
          snapshot: props.snapshot,
          // FIX-16【critical】：`props.ctx` 是**渲染期子上下文，不带本模块声明的 inject**，
          // 拿它访问 remote 会抛 `cannot get property "remote.workspaceFiles" without inject`
          // （`remote.session` 恰好在宿主侧全局可用而"看起来没事"，所以症状像"注入名单写错"）喵。
          // 正确姿势：用 `apply(ctx)` 里**注入后**的 ctx（闭包变量），`props` 只给 tab 自身 UI 数据喵。
          remoteCtx: injectedCtx,
          scope: props.scope,
        }),
      }
      try {
        ctx.effect(() => ctx.betterSidebar.registerTab(descriptor))
      } catch {
        /* 注册失败不得影响插件与宿主喵 */
      }
    }

    module.exports.apply = apply
    module.exports.inject = inject
    // 测试钩子：client 是经典脚本，Node 侧没法 import，只能靠沙箱求值后从这里取纯函数喵
    module.exports.__internals = {
      PENDING_SOURCE_NOTE, SNAPSHOT_STEP, SNAPSHOT_NOTE_NO_ROOT, SNAPSHOT_NOTE_MISSING, EMPTY_STATES, PANEL_SNAPSHOT_SCHEMA_VERSION, PANEL_SNAPSHOT_REL, joinRoot, unwrapRemote, remoteErrorText, openSessionConversation, loadInfo, projectionValue, projectionsOf, applyPanelBadges, loadPanelSnapshot, loadPanel, panelViewState,
      ROLE_COLORS, ROLE_LABELS, BADGE_VIEW, BADGE_INFO, STATUS_COLORS, STATUS_LABELS, VIEW_LABELS, roleLabel, roleTint, clampTf, readUiState, persistUiState, BADGE_STATE_LABELS, badgeText, badgeCell, auditSummaryText, auditLines, STATUS_ALIASES, fitViewport, ZOOM_MIN, ZOOM_MAX, FIT_MAX_SCALE, panelUiState, readTabMeta, writeTabMeta, layoutTopology,
      parseMemberName, shortId, rootOf, rootsOf, subtreeOf, deriveStatus, deriveMode, mergeInfos, crossVendorBadge,
      deriveNode, attachCrossVendor, flattenNodes, snapshotFromSessions,
      defaultPrefs, isHidden, filterTree, flattenTree, roleColor, nodeKind, badgeRow,
      dropTextSelection, FALLBACK_WARN, nodeTooltip, fallbackMark, auditFromPanel,
      badgeCell, BADGE_KEYS, parseInline, parseMdSubset, truncateLines, loadTodoFile, renderMdBlock, TODO_PREVIEW_LINES,
      AUDIT_LEVEL_COLORS, AUDIT_LEVEL_LABELS, AUDIT_SCOPE_NOTE, AUDIT_PLACEHOLDER_HINT,
      // FIX-96：强制刷新（跑审计 + 重写面板数据）的文案常量与两个纯函数（节流判据 / 回执文案）喵
      FORCE_LABEL, FORCE_HINT, FORCE_MIN_GAP_MS, FORCE_RUNNING_TEXT, REFRESH_LABEL, REFRESH_HINT,
      forceThrottle, forceResultText, forceNoteText, versionDriftNote,
      CLIENT_PLUGIN_VERSION, PANEL_REQUIRED_FIELDS, STALE_SNAPSHOT_NOTE, compareVersions, panelStaleness,
      PANEL_POLL_MS, PANEL_FULL_RELOAD_EVERY, nextPollMode, shouldPoll, refreshPanelSnapshot, TAB_TYPE_ID, reopenTabInScope,
      hashText, normalizeHashInput, postTodo, todoErrorText, todoConflictDetail, TODO_ROUTE_PATH, TODO_PREVIEW_LINES,
      SETTINGS_NS, SETTINGS_TOP_KEYS, PANEL_SETTING_TYPES, readFormSnapshot, ContractSettingsSection, validateSettingsJson, settingsJsonText, settingsWritesOf, panelPrefsFrom, isSecretKey, collectSecretPaths, tryGetService, readFormValue, writePanelSetting, registerSettingsSection,
    }
    return module.exports
  },
})
