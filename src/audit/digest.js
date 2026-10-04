/**
 * **审计摘要 / 增量**喵（FIX-108 / FIX-109）喵 —— 一份实现，三处共用（契约 · 推送 · 面板/工具）喵。
 *
 * 为什么必须单一来源（用户硬要求）喵：同一件事实原来有两套判据 —— 面板看 `audit.items`、
 * 工具看 `humanReport`、而契约**什么都不带** ⇒ "审计 → 治理"断链（馆员根本不知道现在要收拾什么，
 * 只能靠上级在 brief 里抄）✗。这里把"摘要文本"与"新增条目"都收敛到这一份喵。
 */
import { SUGGESTIONS } from './report.js'

/**
 * **检查项 → 责任角色**（FIX-109 ③ 按能力路由）喵 —— 只推给"能修的那一方"喵。
 * `librarian` = 簿记类工具能直接收拾的；`implementer` = 要改正文/重写的；`human` = 得人来裁定的喵。
 */
export const AUDIT_ROUTES = {
  doc_misfiled: 'librarian',
  doc_kind_mismatch: 'librarian',
  legacy_caret: 'librarian',
  stray_non_md: 'librarian',
  missing_kind_index: 'librarian',
  null_frontmatter: 'librarian',
  doc_meta_missing: 'librarian',
  doc_tags_stale: 'librarian',
  missing_progressive_link: 'librarian',
  dirty_related_path: 'librarian',
  archive_suggest: 'librarian',
  occupancy_conflict: 'librarian',
  over_budget: 'implementer',
  stale_progress: 'implementer',
  missing_doc: 'implementer',
}

/** 一条审计条目的**指纹**喵（内容不变即同一条）—— `check + target + detail` 喵。 */
export function fingerprintOfItem(item) {
  return `${item && item.check}|${item && item.target}|${item && item.detail}`
}

/** 该条该由谁收拾喵（没登记 ⇒ `human`：只推给人）喵。 */
export function routeOfItem(item) {
  return AUDIT_ROUTES[item && item.check] || 'human'
}

/**
 * 与"上次已见集合"比对，算出**新增**条目喵（FIX-109 ①）喵。
 * @returns `{ items, seen }`：`items` = 本轮新增；`seen` = 合并后的已见集合（含本轮全部）喵。
 */
export function newAuditItems({ report = null, seen = null } = {}) {
  const rows = (report && Array.isArray(report.items) ? report.items : [])
    .filter((item) => item && (item.level === 'red' || item.level === 'yellow'))
  const before = seen instanceof Set ? seen : new Set(seen || [])
  const items = []
  const next = new Set()
  for (const item of rows) {
    const key = fingerprintOfItem(item)
    next.add(key)
    if (!before.has(key)) items.push(item)
  }
  return { items, seen: next }
}

/** 只保留**与本任务相关**的条目（按 taskId / 路径含 taskId 过滤）喵 —— 给非馆员角色用，避免噪音喵。 */
export function itemsForTask(report = null, taskId = null, extraPaths = []) {
  const id = String(taskId || '').trim()
  if (!id) return []
  const paths = (Array.isArray(extraPaths) ? extraPaths : []).map((path) => String(path))
  return (report && Array.isArray(report.items) ? report.items : []).filter((item) => {
    if (!item) return false
    const target = String(item.target || '')
    if (target.includes(id)) return true
    return paths.some((path) => path && target === path)
  })
}

/**
 * 渲染**审计摘要文本**喵（FIX-108 ③）喵 —— 契约里给的就是这一段；馆员看全量、其它角色看与本任务相关的喵。
 *
 * @param args.report - `auditScan()` 的回执（**同一份实现**产出，别自己再算一遍）喵。
 * @param args.taskId - 非空时只带与该任务相关的条目（给了 `scope: 'task'`）喵。
 * @param args.pending - 待推送池里属于该角色的条目（FIX-109 ④：没有活跃馆员时不丢，派单时带上）喵。
 */
export function renderAuditDigest({ report = null, taskId = null, pending = [], role = null } = {}) {
  const all = (report && Array.isArray(report.items) ? report.items : [])
    .filter((item) => item && (item.level === 'red' || item.level === 'yellow'))
  const scoped = taskId ? itemsForTask(report, taskId) : all
  const red = scoped.filter((item) => item.level === 'red').length
  const yellow = scoped.length - red
  const mine = role ? scoped.filter((item) => routeOfItem(item) === role) : scoped
  const lines = []
  if (!report) {
    lines.push('审计摘要：**尚无结论**（本轮没跑到审计）—— 需要时调 `audit_scan` 复跑喵。')
    return { text: lines.join('\n'), items: [], red: 0, yellow: 0 }
  }
  lines.push(`### 审计摘要（与 \`audit_scan\` / 面板**同一份实现**）`)
  lines.push('')
  lines.push(taskId
    ? `与本任务（${taskId}）相关的条目：红 ${red} / 黄 ${yellow}`
    : `当前待处理：红 ${red} / 黄 ${yellow}（全项目）`)
  if (mine.length) {
    lines.push('')
    lines.push(role === 'librarian' ? '**这些是你（图书管理员）要收拾的**：' : `其中归你这一路的：`)
    for (const item of mine.slice(0, 12)) {
      lines.push(`- [${item.level === 'red' ? '红' : '黄'}] ${item.target}`)
      lines.push(`  原因：${item.detail}`)
      lines.push(`  建议：${SUGGESTIONS[item.check] || '由馆员核实后处理'}`)
    }
    if (mine.length > 12) lines.push(`- …（另有 ${mine.length - 12} 条，跑 \`audit_scan\` 看全量）`)
  } else {
    lines.push('（没有归你的条目；要复跑就调 `audit_scan`）')
  }
  if (Array.isArray(pending) && pending.length) {
    lines.push('')
    lines.push(`**待推送池（上一轮没送到你手上的新增条目，共 ${pending.length} 条）**：`)
    for (const row of pending.slice(0, 8)) lines.push(`- [${row.check}] ${row.target}`)
  }
  lines.push('')
  lines.push('规范与路径看本契约的「文档规范」段；不必读插件源码喵。')
  return { text: lines.join('\n'), items: mine, red, yellow }
}
