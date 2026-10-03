/**
 * 面板的只读数据源喵（M3 交付物 2）喵。
 *
 * 纪律喵：
 * - **只读**：不写台账、不改任何文件；读目录只为了看进度文件在不在喵。
 * - **绝不抛错**：空台账、缺字段记录、单条坏记录都必须降级成空值/跳过，
 *   面板崩了比数据不全严重得多喵。
 * - **不实现审计**：`audit` 摘要只是占位（M4 接真实现），这里不做任何审计判定喵。
 */
import { listMarkdown } from '../ledger/fs.js'
import { parseMemberName } from '../ledger/naming.js'

/** 徽章取值喵。`unknown` 表示「M3 阶段算不出来，等 M4」喵。 */
export const BADGE = { ok: 'ok', missing: 'missing', warn: 'warn', unknown: 'unknown' }

/** 成员节点必须有的字段（面板按这份清单渲染；缺的补 null，绝不 undefined）喵。 */
export const MEMBER_FIELDS = [
  'name', 'role', 'mode', 'layer', 'parent', 'status', 'modelRoute', 'latestDeliverable', 'lastActiveAt',
]

/** 安全取字段：任何异常都退化喵。 */
function safe(value, fallback = null) {
  return value === undefined ? fallback : value
}

/** 把一条成员记录规范成面板节点（缺字段补 null）喵。 */
function normalizeMember(raw) {
  const record = raw && typeof raw === 'object' ? raw : {}
  const node = {}
  for (const field of MEMBER_FIELDS) node[field] = null
  node.name = safe(record.name, '(无名成员)')
  node.role = safe(record.role, parseMemberName(record.name)?.role ?? null)
  node.mode = safe(record.mode, 'unknown')
  node.layer = Number.isFinite(record.layer) ? record.layer : 0
  node.parent = safe(record.parent, null)
  node.status = safe(record.status, 'unknown')
  // 台账里叫 route，面板口径叫 modelRoute 喵
  node.modelRoute = safe(record.route, null)
  node.latestDeliverable = safe(record.latestDeliverable, null)
  node.lastActiveAt = safe(record.lastActiveAt, null)
  node.sessionId = safe(record.id, '')
  node.derived = record.derived === true
  node.taskId = parseMemberName(record.name)?.taskId ?? null
  return node
}

/** 计数：`{ key: n }`，key 缺失时归到 `unknown`喵。 */
function tally(records, pick) {
  const counts = {}
  for (const record of records) {
    let key = 'unknown'
    try {
      key = String(pick(record) ?? 'unknown')
    } catch {
      key = 'unknown'
    }
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/**
 * 造一份面板快照喵（同步读台账 + 一次进度目录列举）喵。
 * @param args.store - 台账 store（可为 null / 抛错，内部兜住）喵。
 * @param args.project - `resolveProject()` 结果喵。
 * @returns `{ project, members, roots, counts, audit }`喵。
 */
export async function buildSnapshot({ store, project }) {
  const members = []
  let docs = []
  let tasks = []

  // 逐段兜底：任何一段炸了都不影响别的段喵
  try {
    for (const raw of store.listMembers()) {
      try {
        members.push(normalizeMember(raw))
      } catch {
        /* 单条坏记录跳过，不带塌整棵苗 */
      }
    }
  } catch {
    /* 台账不可用 → members 保持空 */
  }
  try {
    docs = store.listDocs()
  } catch {
    docs = []
  }
  try {
    tasks = store.listTasks()
  } catch {
    tasks = []
  }

  // 进度文件存在性（只读列举）喵
  let progressFiles = []
  try {
    progressFiles = await listMarkdown(project.progressDir)
  } catch {
    progressFiles = []
  }
  const progressSet = new Set(progressFiles.map((name) => name.replace(/\.md$/i, '')))

  // 每任务的三档档级集合（用于「三档」徽章）喵
  const tiersByTask = new Map()
  for (const doc of docs) {
    if (!doc || !doc.taskId) continue
    if (!tiersByTask.has(doc.taskId)) tiersByTask.set(doc.taskId, new Set())
    if (Number(doc.tier) >= 1 && Number(doc.tier) <= 3) tiersByTask.get(doc.taskId).add(Number(doc.tier))
  }

  for (const node of members) {
    const tiers = node.taskId ? tiersByTask.get(node.taskId) : null
    node.badges = {
      // 契约：成员记录来自真实派活（derived 的是从磁盘推导出来的，没有契约注入）
      contract: node.derived ? BADGE.unknown : BADGE.ok,
      // 三档：该任务是否已有三档文档
      docs: tiers && tiers.size >= 3 ? BADGE.ok : (tiers && tiers.size > 0 ? BADGE.warn : BADGE.missing),
      // 进度：progressDir 下有没有该任务的文件
      progress: node.taskId && progressSet.has(node.taskId) ? BADGE.ok : BADGE.missing,
      // 下面两个 M3 阶段算不出来——**不实现 M4 的审计**，只留位喵
      budget: BADGE.unknown,
      crossVendor: BADGE.unknown,
    }
    node.children = []
  }

  // 谱系树：根 = 主代理喵
  const byName = new Map(members.map((node) => [node.name, node]))
  const roots = []
  for (const node of members) {
    const parent = node.parent && node.parent !== '主代理' ? byName.get(node.parent) : null
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  return {
    project: { name: safe(project.name, ''), root: project.root },
    members,
    roots,
    counts: {
      docs: tally(docs, (doc) => Number(doc.tier) >= 1 && Number(doc.tier) <= 3 ? `L${doc.tier}` : 'legacy'),
      tasks: tally(tasks, (task) => task.status),
      members: tally(members, (node) => node.status),
    },
    // 占位：M4 接真审计后由 audit_scan 填真值喵
    audit: { red: 0, yellow: 0, green: 0, placeholder: true },
  }
}
