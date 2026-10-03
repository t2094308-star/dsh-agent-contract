/**
 * 「**跑审计 + 重写面板快照**」的**唯一实现**喵（FIX-96 ②，用户明确约束）喵。
 *
 * 为什么要有这个模块：同一件事今天有**三个**入口 ——
 * ① 主代理的 `audit_scan` 工具（tools.js）② 启动自愈时"没有可沿用的结论就补算一次"（FIX-91 ④ / FIX-95）
 * ③ 面板上的「强制刷新」按钮（FIX-96，人走的那条路）。
 * 三处若各写一套，"面板上的红黄"与"工具回执里的红黄"迟早对不上（本项目已经因为口径漂移返工过几轮）⇒
 * **一律走这里**：算审计（`auditScan`）→ 重写快照（`writePanelSnapshot`，顺带更新写入方版本标记）喵。
 *
 * 边界（照抄 M4 铁律）喵：审计**只报不拦**（不改任何文档、不阻断任何流程）；这里多做的唯一一件事是
 * 重写**派生物**（`panel.json`）—— 它本来就可重建、随时可删，不是真相喵。
 */
import { auditScan } from '../audit/report.js'
import { archivedOwners, archivedSessionsOf, sessionParentIndexOf } from '../audit/archived.js'
// FIX-100 ①：会话树里的子代理（差出'绕过契约派出去的'）喵
import { childSessionsOf } from '../audit/sessions.js'
import { writePanelSnapshot } from './snapshot.js'

/**
 * 跑一次审计（**只算不写**）喵 —— 归档会话与父链口径也在这里统一注入，调用方不必各自拼一遍喵。
 *
 * @param args.ctx - 插件上下文（用来读宿主的"已归档会话"与会话父子关系；拿不到就降级）喵。
 * @param args.config - 插件配置（读 `audit.checks` / `audit.archiveAfterDays`）喵。
 * @returns `auditScan()` 的回执喵。
 */
export async function runPanelAudit({ ctx, config, store, project, now = undefined } = {}) {
  // FIX-101：父链要从**会话持久化**建（活会话里没有"归档对话"的子代理会话）—— 三处同源都走这里喵
  const parents = await sessionParentIndexOf(ctx)
  return auditScan({
    store,
    project,
    config,
    // FIX-84/90：两个**宿主侧事实**（归档会话集合、会话父链）一次读好传下去，口径与工具完全一致喵
    archivedSessionIds: archivedSessionsOf(ctx),
    parentOf: parents.parentOf,
    // FIX-100 ①：会话树里的子代理（用来差出"绕过契约派出去的"）也在这里统一取 —— 三处同源喵
    sessions: childSessionsOf(ctx, project),
    ...(now === undefined ? {} : { now }),
  })
}

/**
 * **跑审计 + 重写面板快照**喵（三处同源的那**一个**实现）喵。
 *
 * @returns `{ report, written }`：`report` 是审计回执（红黄/清单/人话报告），
 *   `written` 是快照写入结果（`{ path, ok, error? }`）喵。
 */
export async function refreshPanel({ ctx, config, store, project, now = undefined } = {}) {
  const report = await runPanelAudit({ ctx, config, store, project, now })
  // FIX-101：**归档对话的东西**在待办（B 区）里也要滤掉 —— 光过滤审计项不够，任务/文档来自那些对话时照旧冒出来喵
  const owners = archivedOwners({
    store,
    archivedSessionIds: archivedSessionsOf(ctx),
    parentOf: (await sessionParentIndexOf(ctx)).parentOf,
  })
  // 顺带更新**写入方版本标记**（`buildPanelSnapshot` 里就带 `pluginVersion`）——
  // 写完之后面板不该再判"快照由旧版插件写入"喵
  const written = await writePanelSnapshot({
    store,
    project,
    audit: report,
    archivedOwners: owners.names,
    ...(now === undefined ? {} : { now }),
  })
  return { report, written }
}

/**
 * 把一次强制刷新的结果压成**一句人话回执**喵（面板与断言共用同一份口径）喵。
 * 失败不在这里包装（失败要有原因，由调用方给）喵。
 */
export function refreshReceiptText(report) {
  const red = Number(report && report.counts ? report.counts.red : 0) || 0
  const yellow = Number(report && report.counts ? report.counts.yellow : 0) || 0
  return `审计完成：红 ${red} / 黄 ${yellow}；面板数据已重写`
}
