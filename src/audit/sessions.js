/**
 * **宿主会话树 → 审计能用的形状**喵（FIX-100 ①）喵。
 *
 * 检测"绕过契约派出去的子代理"只能靠**差集**：会话树里有这个子代理会话，台账里却没有对应的契约派单记录。
 * 数据源是宿主的 **Live Session** 列表（`packages/core/session/src/index.ts:1235` 的 `sessions.list()`，
 * 返回创建序的活会话数组）—— 拿不到就返回**空数组**（该检查自然不报，静默降级，绝不让审计炸）喵。
 */
import { isInsideRoot } from '../project/adaptive.js'

/**
 * 取本项目下、**有父会话**（= 子代理会话）的那些会话喵。
 *
 * @param args.ctx - 插件上下文（`ctx.get('sessions')`）喵。
 * @param args.project - 当前项目视图（用 `root` 过滤别的项目的会话）喵。
 * @returns `[{ id, parentSession, createdAt, cwd }]`（按创建时间升序；拿不到任何信息就 `[]`）喵。
 */
export function childSessionsOf(ctx, project) {
  try {
    const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
    if (!sessions || typeof sessions.list !== 'function') return []
    const rows = sessions.list()
    const root = project && project.root ? String(project.root) : null
    return (Array.isArray(rows) ? rows : [])
      .map((session) => {
        const header = (session && session.header) || {}
        return {
          id: String(header.id || (session && session.id) || ''),
          parentSession: header.parentSession ? String(header.parentSession) : null,
          createdAt: header.createdAt ? new Date(header.createdAt).toISOString() : null,
          cwd: header.cwd ? String(header.cwd) : null,
        }
      })
      // **有父会话**才算子代理（顶层会话不是"派出去的"）喵
      .filter((row) => row.id && row.parentSession)
      // 只认本项目的会话（工作区不同 ⇒ 不是这个项目的账）喵
      .filter((row) => !root || !row.cwd || isInsideRoot(root, row.cwd))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  } catch {
    return []
  }
}
