/**
 * 三个领域（members / tasks / docs）的 schema 与声明喵。
 *
 * 走宿主 `ctx.storageDomain` + 已在挂的 json 后端（DESIGN §5.5 存储已定）：
 * 读同步返回内存态，写完成即持久，`domain/changed` 供 M2.5/M3 订阅喵。
 *
 * 两处刻意的实现选择喵：
 * 1. **不 import `@deepseek-ai/dsh-storage-domain` 的 `defineDomain`/`domainTable`**：
 *    它们是纯身份助手（`domainTable(s) === { valueSchema: s }`，`defineDomain` 只做名字/版本校验），
 *    这里用纯对象字面量 + 本地校验重建，省掉一个宿主私有包的解析风险与依赖喵。
 * 2. **领域名加 `agent_contract_` 前缀**：storage-domain 对领域名做全局单开（重名直接 open 失败），
 *    `docs` 这种通用名很容易被别的插件先占用喵。
 */
import { z } from 'zod'

/** storage-domain 的领域/表名约束（`UNIT_NAME_RE`）喵。 */
export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

/** 领域版本号；改 record schema 时递增喵。 */
export const DOMAIN_VERSION = 1

/** 四个领域的前缀名喵（FIX-100 起多了 `escalations`：提权申请留痕）喵。 */
export const DOMAIN_NAMES = {
  members: 'agent_contract_members',
  tasks: 'agent_contract_tasks',
  docs: 'agent_contract_docs',
  escalations: 'agent_contract_escalations',
}

const MemberMode = z.enum(['one-shot', 'continuable', 'unknown'])
// FIX-99 ②：`retired` = 常驻实例被**退役**（换会话时旧的让位、或它已不可续派）——
// 记录**保留**（留痕、面板看得见），但不再算"活跃实例"喵。枚举加值对老记录安全（老值照旧合法）喵
const MemberStatus = z.enum(['running', 'idle', 'completed', 'failed', 'released', 'retired', 'unknown'])
const TaskStatus = z.enum(['open', 'running', 'blocked', 'done', 'cancelled', 'unknown'])

/**
 * 记录必须带 `project` 字段喵（DESIGN §5.5）：
 * `storages/` 按 **profile** 隔离、**不随工作区分区**，多项目并存时全靠该字段隔离与过滤，
 * 所以查询一律先按 `project` 收窄喵。
 */
const ProjectKey = z.string().min(1)

/** 派生失败条目：只有清单非空才唤醒馆员喵。 */
const NeedItem = z.object({ code: z.string().min(1), detail: z.string() })

/** 成员记录喵（key = 成员名 `<任务号>-<角色>`）喵。 */
export const memberSchema = z.object({
  project: ProjectKey,
  id: z.string(),
  name: z.string().min(1),
  role: z.string().min(1),
  mode: MemberMode,
  layer: z.number().int().min(0),
  parent: z.string().nullable(),
  status: MemberStatus,
  model: z.string().nullable(),
  // FIX-90：派单者的会话 id（用来沿父链判"是否属于已归档会话"）喵
  //
  // **回归修复（0.20.0 真机定位）**：这里原来写的是 `z.string().nullable()` —— 而 `.nullable()` **不带默认值**，
  // 缺这个字段就**校验失败**。真机上 0.17.0 时代落盘的 20 条成员记录全都没有这个字段 ⇒
  // 宿主打开领域时逐条 `valueSchema.parse()` ⇒ 抛 `invalid-record` ⇒ `ledger.ready` **reject** ⇒
  // 面板同步器整条链被静默吞掉（快照从此一个字节不写、自愈全停）✗✗
  // 规矩（本文件上面那条注释早就写了）：**加字段一律带默认值**，读到即补 null —— 只有破坏性结构变更才递增版本喵
  parentSessionId: z.string().nullable().default(null),
  // FIX-99 ②：退役留痕（为什么让位 —— "属于别的父会话"/"会话已归档"/"底层是一次性实例"…）喵
  // FIX-104：上次发给它的**契约指纹**（变了才补发契约；不变只发任务切片）喵
  contractFingerprint: z.string().nullable().default(null),
  retiredReason: z.string().nullable().default(null),
  retiredAt: z.string().nullable().default(null),
  route: z.string().nullable(),
  costUsd: z.number().nullable(),
  latestDeliverable: z.string().nullable(),
  lastActiveAt: z.string().nullable(),
  /** 该记录是否由 ledger_rebuild 从磁盘推导（拿不到 session id 时为 true）喵。 */
  derived: z.boolean(),
})

/** 任务记录喵（key = taskId）喵。 */
export const taskSchema = z.object({
  project: ProjectKey,
  taskId: z.string().min(1),
  status: TaskStatus,
  owner: z.string().nullable(),
  occupiedFiles: z.array(z.string()),
  dependsOn: z.array(z.string()),
  deliverable: z.string().nullable(),
  updatedAt: z.string(),
})

/** 文档记录喵（key = 绝对路径）喵。 */
export const docSchema = z.object({
  project: ProjectKey,
  path: z.string().min(1),
  /** 1 / 2 / 3；0 表示无法判定档级的存量旧档喵。 */
  tier: z.number().int().min(0).max(3),
  owner: z.string().nullable(),
  taskId: z.string().nullable(),
  title: z.string().nullable(),
  chars: z.number().int().min(0),
  keywords: z.array(z.string()),
  relatedFiles: z.array(z.string()),
  /** 缺失的固定小节名（M4 的 doc_meta_missing 审计直接读它）喵。 */
  missingSections: z.array(z.string()),
  /** 存量旧档：不参与 doc_meta_missing 审计，也不纳入新命名规范喵。 */
  legacy: z.boolean(),
  /** 派生器判不出、需要馆员兜底的条目；**非空才唤醒馆员**喵。 */
  needsLibrarian: z.array(NeedItem),
  updatedAt: z.string(),
  /**
   * FIX-30：该档被**覆盖**过几次（同名重发），以及最近一次旧版的备份路径喵。
   *
   * 之所以走"加带默认值的可选字段"而不动 `DOMAIN_VERSION` 喵：改版本号有让宿主**另开一个领域**、
   * 把现有 records（含 `members` 的 sessionId 身份，见 §9-31）留在旧版本里的风险；
   * 加带默认值的字段对旧记录**向后兼容**（读到即补 0/null），所以只有**破坏性**结构变更才递增版本喵。
   */
  overwriteCount: z.number().int().min(0).default(0),
  lastBackupPath: z.string().nullable().default(null),
})

/**
 * **提权申请**记录喵（FIX-100 ②）喵 —— 用户口径："派出普通智能体（那 5 个角色之外的）先提权申请"。
 *
 * 它不是"许可凭证"（插件管不了宿主的派单工具），而是**留痕 + 审计判据**：
 * 审计差出"会话树里有、台账里没有"的子代理时，会查**作用域内有没有提权记录** ——
 * 有 ⇒ 标「已提权」（最多 info），没有 ⇒ 报黄 `uncontracted_dispatch` 喵。
 */
export const escalationSchema = z.object({
  project: ProjectKey,
  /** 提权者会话 id（哪条链上要绕过契约）喵。 */
  sessionId: z.string().nullable().default(null),
  /** 理由（**必填**：写清"为什么必须绕过契约"）喵。 */
  reason: z.string().min(1),
  /** 作用域：本次（这一次派单）/ 本任务 / 本会话（默认）喵。 */
  scope: z.enum(['once', 'task', 'session']).default('session'),
  /** 任务号（`scope: task` 时按它匹配）喵。 */
  taskId: z.string().nullable().default(null),
  /** 期限（ISO 时间；过期即失效）喵。 */
  until: z.string().nullable().default(null),
  createdAt: z.string(),
})

/** 表名 → schema 喵。 */
export const TABLE_SCHEMAS = {
  members: memberSchema,
  tasks: taskSchema,
  docs: docSchema,
  escalations: escalationSchema,
}

/**
 * 构造一个领域声明喵。
 * 等价于宿主 `defineDomain({ name, version, tables: { <t>: domainTable(schema) } })`，
 * 并在此复刻它的启动期校验（名字合法、版本为非负整数）喵。
 */
export function domainSpec(key) {
  const name = DOMAIN_NAMES[key]
  const schema = TABLE_SCHEMAS[key]
  if (!UNIT_NAME_RE.test(name)) throw new Error(`agent-contract: 领域名 '${name}' 不合法`)
  if (!UNIT_NAME_RE.test(key)) throw new Error(`agent-contract: 表名 '${key}' 不合法`)
  if (!Number.isInteger(DOMAIN_VERSION) || DOMAIN_VERSION < 0) {
    throw new Error(`agent-contract: 领域版本必须是自然数，收到 ${DOMAIN_VERSION}`)
  }
  return {
    name,
    version: DOMAIN_VERSION,
    // per-record：单条记录独立成文档，一条坏记录不会带塌整个领域（DESIGN §5.5 范例同款）喵
    layout: 'per-record',
    // 保险丝（0.20.0 真机定位后加的）喵：万一将来又出现"某条老记录不合新 schema"，
    // 宿主会把这**一条**记录挪到备份并跳过（并打 error 日志），**而不是让整个领域打不开** ——
    // 台账本身就是"可从磁盘重建的派生物"，为它黑掉整个插件是最坏的取舍（这次就是这么炸的）✗
    invalidRecords: 'backup-and-skip',
    tables: { [key]: { valueSchema: schema } },
  }
}

/** 三个领域的声明表喵。 */
export const DOMAIN_SPECS = {
  members: domainSpec('members'),
  tasks: domainSpec('tasks'),
  docs: domainSpec('docs'),
  // FIX-100：提权申请（第四个领域；老库没有它时宿主会当空表开出来）喵
  escalations: domainSpec('escalations'),
}
