/**
 * **审计新增条目的自动推送**喵（FIX-109）喵 —— 增量 + 去重节流 + 按能力路由 + 待推送池喵。
 *
 * 目标（用户原话）：「当审计增加时给馆员**自动推送**那条增加后的审计条目」——
 * 审计的价值在于"有人去修"，而原来只到人眼前、靠上级转述（会漏）✗。
 *
 * 四条纪律喵：
 * ① **增量**：条目指纹 = `check + target + detail`（`fingerprintOfItem`），与"已见集合"比 ⇒ 新增；
 * ② **去重 + 节流**：同一条只推一次（消失后再出现可再推）；一轮多条**合并成一条**推送；冷却期内不重推；
 * ③ **按能力路由**：`AUDIT_ROUTES` 决定推给馆员 / 实现者 / 人 —— 只推给能修的；
 * ④ **没有活跃常驻角色时不许丢**：进**待推送池**（落盘、幂等、可见），下次给该角色派单时**自动带上**喵。
 *
 * 状态文件是**派生物**（`.agent-contract/audit-push.json`，可删可重建）—— 丢了最多多推一次，不会丢事实喵。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { joinUnderRoot } from '../project.js'
import { fingerprintOfItem, newAuditItems, routeOfItem } from './digest.js'

/** 推送状态（已见指纹 + 待推送池）相对项目根的路径喵。 */
export const PUSH_STATE_REL = '.agent-contract/audit-push.json'

/** 默认冷却时间（同一批新增在这么短时间里不重复推）喵。 */
export const PUSH_COOLDOWN_MS = 5 * 60 * 1000

/** 状态文件路径喵。 */
export function pushStatePath(project) {
  return joinUnderRoot(project.root, PUSH_STATE_REL)
}

/** 读状态（读不到/坏 JSON 都当"空的"，绝不抛）喵。 */
export async function loadPushState({ project, read = readFile, readImpl = null } = {}) {
  const reader = readImpl || read
  try {
    const raw = await reader(pushStatePath(project), 'utf8')
    const parsed = JSON.parse(String(raw))
    return {
      seen: Array.isArray(parsed && parsed.seen) ? parsed.seen : [],
      pending: Array.isArray(parsed && parsed.pending) ? parsed.pending : [],
      pushed: Number(parsed && parsed.pushed) || 0,
      lastPushAt: (parsed && parsed.lastPushAt) || null,
      lastPushSummary: (parsed && parsed.lastPushSummary) || null,
    }
  } catch {
    return { seen: [], pending: [], pushed: 0, lastPushAt: null, lastPushSummary: null }
  }
}

/** 写状态（失败只返回原因，绝不影响审计主流程）喵。 */
export async function savePushState({ project, state, write = writeFile } = {}) {
  const path = pushStatePath(project)
  try {
    await mkdir(dirname(path), { recursive: true })
    await write(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    return { path, ok: true }
  } catch (error) {
    return { path, ok: false, error: String((error && error.message) || error) }
  }
}

/**
 * 算一次推送喵（**纯决策**：给定报告 + 状态 ⇒ 要不要推、推给谁、推什么）喵。
 *
 * @param args.report - 本轮审计回执（与 `audit_scan` / 面板**同一份实现**产出）喵。
 * @param args.state - `loadPushState()` 的结果喵。
 * @param args.now - 当前时刻（毫秒；注入便于断言冷却）喵。
 * @param args.enabled - 开关（默认开）喵。
 * @returns `{ push, state, added }`：`push` = `{ role, items, text-less }` 或 null（不推）；`state` = 落盘用新状态喵。
 */
export function planPush({ report = null, state = null, now = Date.now(), enabled = true, cooldownMs = PUSH_COOLDOWN_MS } = {}) {
  const current = state || { seen: [], pending: [], pushed: 0, lastPushAt: null, lastPushSummary: null }
  const { items: added, seen } = newAuditItems({ report, seen: new Set(current.seen) })
  const nextSeen = [...seen]
  if (!enabled) {
    return { push: null, added: [], state: { ...current, seen: nextSeen, disabled: true } }
  }
  if (!added.length) return { push: null, added: [], state: { ...current, seen: nextSeen } }
  // 按能力路由分组：一轮里的多条**合并**成"每个角色一条"（不准一条一条推）喵
  const byRole = new Map()
  for (const item of added) {
    const role = routeOfItem(item)
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(item)
  }
  const lastAt = current.lastPushAt ? Date.parse(current.lastPushAt) : 0
  const cooling = lastAt && (now - lastAt) < cooldownMs
  // 冷却期内不重推：这批直接进**待推送池**（下次派单带上）——不许丢喵
  const pending = [...current.pending]
  for (const [, list] of byRole) {
    for (const item of list) {
      const key = fingerprintOfItem(item)
      if (!pending.some((row) => row.key === key)) {
        pending.push({ key, check: item.check, target: item.target, detail: item.detail, level: item.level, role: routeOfItem(item), at: new Date(now).toISOString() })
      }
    }
  }
  if (cooling) {
    return { push: null, added, state: { ...current, seen: nextSeen, pending, cooling: true } }
  }
  const role = 'librarian'
  const mine = byRole.get(role) || []
  const others = [...byRole.entries()].filter(([key]) => key !== role).flatMap(([, list]) => list)
  if (!mine.length) {
    // 没有归馆员的条目 ⇒ 不推给馆员（只把条目留在池里等人/实现者），也算一次"已见"喵
    return { push: null, added, state: { ...current, seen: nextSeen, pending } }
  }
  return {
    push: {
      role,
      items: mine,
      others,
      text: renderPushText({ items: mine, others }),
      pendingAfter: pending.filter((row) => row.role !== role).length,
    },
    added,
    state: {
      ...current,
      seen: nextSeen,
      pending,
      pushed: (Number(current.pushed) || 0) + 1,
      lastPushAt: new Date(now).toISOString(),
      lastPushSummary: `${mine.length} 条（${mine.map((item) => item.check).join('、')}）`,
    },
  }
}

/** 推送文本喵：一段人话 + 条目（路径 / 原因 / 建议），多条合并成**一条**消息喵。 */
export function renderPushText({ items = [], others = [] } = {}) {
  const lines = [
    '## 【审计新增】有新的待收拾条目（自动推送，合并成一条）',
    '',
  ]
  for (const item of items.slice(0, 12)) {
    lines.push(`- [${item.level === 'red' ? '红' : '黄'}] ${item.target}（${item.check}）`)
    lines.push(`  原因：${item.detail}`)
  }
  if (items.length > 12) lines.push(`- …（另有 ${items.length - 12} 条，跑 \`audit_scan\` 看全量）`)
  if (others.length) lines.push('', `（另有 ${others.length} 条**不归你**的条目：${[...new Set(others.map((item) => item.check))].join('、')}）`)
  lines.push('', '能直接修的按上面的判据修；判不准就上报。规范见契约「文档规范」段喵。')
  return lines.join('\n')
}
