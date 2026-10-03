/**
 * 成员 / 任务的状态机喵。
 *
 * 刻意做得很小：只回答「这个迁移合不合法」，不管存储与副作用喵。
 * - 成员：running → idle → completed → released；failed 与 completed 都可走向 released（释放即终态）喵。
 * - 任务：open → running → done；blocked 可回 running；cancelled 与 done 是终态喵。
 * - 释放语义来自 DESIGN §5.5：成员置 released 时，其未结任务要触发 orphan_task 警告（警告由 M4 审计给，这里只提供判定）喵。
 */

/** 成员状态取值喵。 */
export const MEMBER_STATUSES = ['running', 'idle', 'completed', 'failed', 'released']

/** 任务状态取值喵。 */
export const TASK_STATUSES = ['open', 'running', 'blocked', 'done', 'cancelled']

const MEMBER_TRANSITIONS = {
  running: ['idle', 'completed', 'failed', 'released'],
  idle: ['running', 'completed', 'failed', 'released'],
  completed: ['released'],
  failed: ['released'],
  released: [],
}

const TASK_TRANSITIONS = {
  open: ['running', 'cancelled'],
  running: ['blocked', 'done', 'cancelled'],
  blocked: ['running', 'cancelled'],
  done: [],
  cancelled: [],
}

/** 未结任务状态（用于 orphan_task 判定）喵。 */
export const OPEN_TASK_STATUSES = ['open', 'running', 'blocked']

/** 状态是否已进入终态喵。 */
export function isTerminal(kind, status) {
  const table = kind === 'member' ? MEMBER_TRANSITIONS : TASK_TRANSITIONS
  const next = table[status]
  return Array.isArray(next) && next.length === 0
}

/**
 * 判定一次状态迁移是否合法喵。
 * 同状态视为合法（幂等写入，便于重建与重放）喵。
 */
export function canTransition(kind, from, to) {
  const table = kind === 'member' ? MEMBER_TRANSITIONS : TASK_TRANSITIONS
  if (!(from in table)) return false
  if (from === to) return true
  return table[from].includes(to)
}

/**
 * 断言一次状态迁移合法喵。
 * @throws 非法迁移时抛错（早失败，避免台账进入自相矛盾的状态）喵。
 */
export function assertTransition(kind, from, to) {
  if (!canTransition(kind, from, to)) {
    throw new Error(`agent-contract: 非法的 ${kind} 状态迁移 ${from} → ${to}`)
  }
  return to
}

/** 成员是否已释放（释放后不应再被派活）喵。 */
export function isReleased(member) {
  return Boolean(member) && member.status === 'released'
}

/** 任务是否未结喵。 */
export function isOpenTask(task) {
  return Boolean(task) && OPEN_TASK_STATUSES.includes(task.status)
}
