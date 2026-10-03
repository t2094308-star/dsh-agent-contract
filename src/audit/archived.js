/**
 * 「**这个成员属于已归档会话吗**」喵（FIX-90）喵 —— 判据要**归一化 + 按父链上溯**喵。
 *
 * 真机实证（0.17.0 仍 119 条）两处根因喵：
 * ① **sessionId 形态不一致**：宿主 `archivedSessionIds` 是 `session-<uuid>`，而成员记录里的 `id` 是
 *    **裸 `<uuid>`**（子代理会话）⇒ 字符串精确比对**永不命中** ✗；
 * ② **只看成员自己的会话**：用户归档的正是这些成员的**父会话**（顶层 `session-<uuid>`）⇒
 *    "归档父会话"不会自动归档子会话 ✗。
 *
 * 这里的规则喵：① 两侧都按"去 `session-` / 补 `session-`"两种形态试（大小写无关）；
 * ② 沿 `parentSessionId` 往上走（用成员记录串起来），**任一祖先被归档就算已归档**；
 * ③ 有**深度上限**，拿不到父链就退回"只看自身会话"（现状），**绝不报错**喵。
 */

/**
 * 读宿主侧"已归档会话 id"喵（FIX-84）喵：`ctx.workspaceRegistry` 是**可选**服务 ——
 * **拿不到就返回 null**（调用方据此保持今天的行为，静默降级、不报错）喵。
 *
 * 放在这个模块里（而不是各调用点各写一份）：归档判定要与"父链上溯"配套，
 * 审计工具与启动自愈（FIX-91 ④ 的补算审计）必须**同一口径**，不许两处漂移喵。
 */
export function archivedSessionsOf(ctx) {
  try {
    const registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (!registry) return null
    const ids = registry.archivedSessionIds || (registry.state && registry.state.archivedSessionIds) || null
    if (!ids) return null
    return Array.from(ids).map((id) => String(id))
  } catch {
    return null
  }
}

/**
 * 父链的**宿主来源**喵（FIX-90）喵：`sessions.get(id).header.parentSession`。
 *
 * 为什么优先问宿主（而不是只读成员记录里的 `parentSessionId`）：存量成员记录是 0.18.0 之前写的、
 * **没有**那个字段，而宿主的会话头里一直有 ⇒ 靠它才能溯到"用户归档的那个父会话"（真机样本：
 * 5 个已归档父会话 + 11 条子成员，靠记录字段一条都溯不到）喵。
 *
 * @returns `(sessionId) => string|null`（拿不到就 null，绝不抛）喵。
 */
export function parentSessionOf(ctx) {
  return (sessionId) => {
    try {
      const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
      const header = session && session.header ? session.header : null
      return header && header.parentSession ? String(header.parentSession) : null
    } catch {
      return null
    }
  }
}

/**
 * **子会话 → 父会话**索引喵（FIX-101，真机："审计区还在引用源自归档对话的东西"）喵。
 *
 * 为什么不能只用 `sessions.get()`：那是**活会话**（`packages/core/session/src/index.ts:1227`）——
 * 而用户归档掉的对话里的子代理会话**早就不是活的了** ⇒ 父链一走就断 ⇒ 存量成员被当成"没归档"照旧报出来 ✗。
 *
 * 所以改用宿主的**会话持久化**：`sessionPersistence.list()` 返回**所有已落盘会话**的 header
 * （`packages/session/session-persistence/src/index.ts:50/201`，含 `header.parentSession`）——
 * 这才拿得到"那些早就结束的子会话"的父会话。拿不到持久化就退回活会话列表（降级，不报错）喵。
 *
 * @returns `{ size, parentOf }`：`parentOf(sessionId)` → 父会话 id 或 null 喵。
 */
export async function sessionParentIndexOf(ctx) {
  const map = new Map()
  const put = (header) => {
    const id = header && header.id ? String(header.id) : ''
    if (!id) return
    map.set(id, header.parentSession ? String(header.parentSession) : null)
  }
  try {
    const persistence = ctx && typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : null
    if (persistence && typeof persistence.list === 'function') {
      const rows = await persistence.list()
      for (const row of Array.isArray(rows) ? rows : []) put((row && row.header) || row)
    }
  } catch {
    /* 拿不到持久化就退回活会话（下面）喵 */
  }
  if (map.size === 0) {
    try {
      const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      const rows = sessions && typeof sessions.list === 'function' ? sessions.list() : []
      for (const session of Array.isArray(rows) ? rows : []) put((session && session.header) || session)
    } catch {
      /* 两条路都拿不到 ⇒ 空索引（父链走不动，退回"只看自身会话"，与旧行为一致）喵 */
    }
  }
  return { size: map.size, parentOf: (id) => map.get(String(id)) || null }
}

/**
 * **"已归档成员"的名字集合**喵（FIX-101）喵 —— 审计与面板都用它把"源自归档对话"的东西滤掉：
 * 光过滤成员本身不够，**任务 / 文档**（target 是 taskId 或路径）也来自那些对话，会照旧报出来 ✗。
 *
 * @returns `{ names: Set<string>, members: Array<{member, via}> }`喵。
 */
export function archivedOwners({ store = null, archivedSessionIds = null, parentOf = null } = {}) {
  const archived = normalizeArchivedSet(archivedSessionIds)
  const names = new Set()
  const members = []
  if (!store || archived.size === 0 || typeof store.listMembers !== 'function') return { names, members }
  const all = store.listMembers()
  for (const member of all) {
    const hit = archivedViaChain({ member, members: all, archived, parentOf })
    if (!hit.archived) continue
    members.push({ member, via: hit.via })
    if (member && member.name) names.add(String(member.name))
  }
  return { names, members }
}

/** 一个会话 id 的两种形态（去/补 `session-`；大小写无关 ⇒ 统一小写返回）喵。 */
export function sessionIdVariants(id) {
  const raw = String(id ?? '').trim().toLowerCase()
  if (!raw) return []
  const bare = raw.startsWith('session-') ? raw.slice('session-'.length) : raw
  return [bare, `session-${bare}`]
}

/** 把"归档会话 id 列表"归一化成**两种形态都在**的集合（拿不到就空集 = 降级）喵。 */
export function normalizeArchivedSet(value) {
  const out = new Set()
  if (!value) return out
  try {
    for (const id of Array.from(value)) for (const form of sessionIdVariants(id)) out.add(form)
  } catch {
    return out
  }
  return out
}

/** 某个会话 id 是否在归档集合里（两种形态都试）喵。 */
export function isArchivedSession(archived, id) {
  if (!archived || archived.size === 0) return false
  return sessionIdVariants(id).some((form) => archived.has(form))
}

/**
 * 成员是否"属于已归档会话"喵：**自身**上任一形态命中 ⇒ 是；否则沿 `parentSessionId` 上溯喵。
 *
 * @param args.members - 同项目的成员记录（用来沿父链找回上一跳）喵。
 * @param args.maxDepth - 上溯深度上限（默认 8，防环/防病态链）喵。
 * @returns `{ archived, via }`：`via` = 命中的那个会话 id（报告按**父会话**归并显示用）喵。
 */
export function archivedViaChain({ member, members = [], archived = null, maxDepth = 8, parentOf = null } = {}) {
  if (!member || !archived || archived.size === 0) return { archived: false, via: null }
  if (isArchivedSession(archived, member.id)) return { archived: true, via: String(member.id) }
  // 父会话 id：**优先用宿主的会话父子 API**（存量记录没记 `parentSessionId` 时也能上溯）→ 再退回记录字段喵
  const parentIdOf = (row) => {
    if (!row) return null
    if (typeof parentOf === 'function') {
      try {
        const live = parentOf(String(row.id || ''))
        if (live) return String(live)
      } catch {
        /* 宿主拿不到就退回记录字段喵 */
      }
    }
    return row.parentSessionId ? String(row.parentSessionId) : null
  }
  let current = member
  let depth = 0
  const seen = new Set([String(member.id || '')])
  let parentId = parentIdOf(current)
  while (parentId && depth < maxDepth) {
    if (isArchivedSession(archived, parentId)) return { archived: true, via: parentId }
    if (seen.has(parentId)) break
    seen.add(parentId)
    // 上一跳可能也是注册过的成员（多层子代理）⇒ 用成员记录继续往上喵；找不到就停（降级）喵
    current = (members || []).find((row) => row && String(row.id || '') === parentId) || null
    parentId = current ? parentIdOf(current) : null
    depth += 1
  }
  return { archived: false, via: null }
}
