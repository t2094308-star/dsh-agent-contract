/**
 * 每角色一条委派通道喵。
 *
 * 为每个角色注册一个 `contract_delegate_<roleId>` 工具：工具内部现场装配契约（槽位已填），
 * 再把 persona / toolFilter / agentOptions / maxDepth 作为 start-time 参数交给 `ctx.subagents`喵。
 *
 * 为什么不直接挂 `@deepseek-ai/dsh-tool-subagent` 实例：它的 persona 是静态串、
 * 工具描述是宿主硬编码英文，既填不了 [层数]/[总Agent数] 这类运行时槽位，
 * 也写不了「产出契约 / 禁止事项」喵。详见 DESIGN.md §5.3 的实现说明喵。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildContract, contractFingerprint, renderContinuationSlice } from '../contract/assemble.js'
import { listRoles } from '../contract/roles.js'
import { mergeModelRoutes } from '../contract/routes.js'
import { memberName } from '../ledger/naming.js'
import { joinUnderRoot } from '../project.js'
import { memberRecord, retireMember, taskRecord } from '../ledger/store.js'
import { missingStructure } from '../project/adaptive.js'
import { baselineHintFor, touchesFiles } from '../project/git.js'
import { modelSourceText, resolveEffectiveModel } from './effective-model.js'
// FIX-99 ④：全局共享文件清单（常驻馆员会写它们；跨会话并存时要串行 / 先声明占用）喵
import { globalSharedFilesText } from '../librarian/globals.js'
// FIX-104：续派只发任务切片 —— 变化段用规范段（与契约/体检同源）喵
import { docSpecLines, resolvedPathsLines } from '../ledger/docarea.js'
// FIX-108/109：审计摘要与待推送池（与 audit_scan / 面板**同一份实现**）喵
import { renderAuditDigest, routeOfItem } from '../audit/digest.js'
import { loadPushState } from '../audit/push.js'
import { runPanelAudit } from '../panel/refresh.js'
// FIX-99：判'既有常驻实例的 owner 会话是否已归档'（FIX-90 的归一化归档集合）+ 拿 owner 会话的宿主来源喵
import { archivedSessionsOf, isArchivedSession, normalizeArchivedSet, parentSessionOf, sessionParentIndexOf } from '../audit/archived.js'

/**
 * FIX-79 ③：常驻单例的**排队可见**喵 —— 进程内计数"它手上还压着几条"喵。
 *
 * 派单时若它正忙 → +1 并在回执里报"前面还有 N 条"；宿主报 `subagent/end` 时 -1 喵。
 * 宿主对"忙碌目标"本来就会在**步边界**接收消息（`sendMessage` 的语义），所以这里只做**可见性**，
 * **不丢弃任何一条**（静默丢弃是被明确禁止的）喵。
 */
const residentQueue = new Map()
const residentChildRole = new Map()
function queueOf(roleId) { return residentQueue.get(roleId) || 0 }
function pushResidentQueue(roleId) { const next = queueOf(roleId) + 1; residentQueue.set(roleId, next); return next }
function popResidentQueue(roleId) { const next = Math.max(0, queueOf(roleId) - 1); residentQueue.set(roleId, next); return next }

/** 取该智能体在谱系中的层数（顶层为 0）喵。 */
function depthOf(agent) {
  const header = agent && agent.session && agent.session.header
  const depth = header ? Number(header.delegationDepth) : 0
  return Number.isFinite(depth) && depth >= 0 ? depth : 0
}

/**
 * 数当前根会话下的总 Agent 数（含主代理）喵。
 * 任何一环不可用都返回 null，由调用方退化处理——台账要等 M2 才有，这里不能因此让委派失败喵。
 */
async function countAgents(ctx, agent, signal) {
  try {
    const sessions = ctx.get ? ctx.get('sessions') : undefined
    const subagents = ctx.subagents
    if (!sessions || typeof sessions.get !== 'function') return null
    if (!subagents || typeof subagents.listDescendants !== 'function') return null
    let rootId = agent.id
    const seen = new Set()
    while (rootId && !seen.has(rootId)) {
      seen.add(rootId)
      const session = sessions.get(rootId)
      const parentId = session && session.header ? session.header.parentSession : undefined
      if (!parentId) break
      rootId = parentId
    }
    const list = await subagents.listDescendants(rootId, signal)
    return Array.isArray(list) ? list.length + 1 : null
  } catch {
    return null
  }
}

/**
 * 反查一个智能体**自己**的成员名喵（= 我们派活时写进 catalog 的 label `<任务号>-<角色>`）喵。
 * 顶层会话（没有父会话）拿不到，返回 null喵。
 */
export async function agentLabel(ctx, agent, signal) {
  const header = agent && agent.session ? agent.session.header : undefined
  const grandparentId = header ? header.parentSession : undefined
  if (!grandparentId) return null
  if (!ctx.subagents || typeof ctx.subagents.listChildren !== 'function') return null
  try {
    const siblings = await ctx.subagents.listChildren(grandparentId, signal)
    const row = Array.isArray(siblings) ? siblings.find((item) => item && item.id === agent.id) : undefined
    return row && row.label ? String(row.label) : null
  } catch {
    return null
  }
}

/**
 * 解析「上级」的可读身份喵。
 *
 * 契约里 [上级] 是要给子智能体看的身份，绝不能塞裸 session id喵。
 * 口径：顶层调用方 = 主代理；否则用 catalog 里的 label（`<任务号>-<角色>`）喵。
 * 拿不到目录时退化为「子智能体（层 N）」——仍然可读，且不泄露内部 id喵。
 */
export async function parentIdentity(ctx, parent, signal) {
  const depth = depthOf(parent)
  if (depth === 0) return '主代理'
  return (await agentLabel(ctx, parent, signal)) || `子智能体（层 ${depth}）`
}

export function routeOptions(config, role) {
  const routes = mergeModelRoutes(config)
  const route = routes[role.id]
  if (!route) return undefined
  if (typeof route === 'string') return { model: route }
  if (typeof route === 'object' && route !== null) {
    const options = {}
    for (const key of ['provider', 'model', 'reasoningEffort', 'maxTokens']) {
      if (route[key] !== undefined && route[key] !== null && route[key] !== '') options[key] = route[key]
    }
    return Object.keys(options).length ? options : undefined
  }
  return undefined
}

/** 拼接子智能体最终回复里的文本块喵。 */
function outputText(result) {
  const blocks = (result && result.output) || []
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** 前台 run 的结算：先取结果，再无条件释放；两者互不掩盖（对齐宿主 tool-subagent 的语义）喵。 */
async function settleForeground(run) {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') throw execution.reason
  const result = execution.value
  if (result && result.stopReason && result.stopReason !== 'completed') {
    const partial = outputText(result)
    throw new Error(
      `子智能体未正常结束（${result.stopReason}）`
      + (result.diagnostic ? `\n诊断：${result.diagnostic}` : '')
      + (partial ? `\n结束前的部分产出：\n${partial}` : ''),
    )
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return { text: outputText(result), runId: run.id }
}

/** 工具描述必须写明：该通道的角色、产出契约、禁止事项（DESIGN §5.3）喵。 */
function describeChannel(role, roleCount) {
  const modeText = role.mode === 'continuable'
    ? (role.singleton === true
      // FIX-79：常驻单例的语义要写在**描述开头**（agent 通常只读开头）喵
      ? '该角色是**常驻单例**：一个会话服务所有任务（首次调用=创建，之后=向同一会话**续派**，不会新建实例）。'
        + '它动的全是全局共享文件（索引 / 核心数据库 / 交叉引用 / 归档），所以**串行排队**才是安全的。'
        // FIX-93 ②：常驻单例**不存在**"第二个实例" —— 前台代跑也只是它的记账（不新建成员、不改它的会话）喵
        + '注意：它**只有一个**固定成员名（就是角色名），任何调用方式都不会多出第二个它。'
        // FIX-94 ②：常驻路径不阻塞返回 ⇒ "要结果"的正确姿势要写在描述里（宿主 sendMessage 只回投递确认）喵
        + '它**无法同步取结果**（宿主只回投递确认）：要结果请用"**派完读产出档**"——回执里会写明这轮落在哪个产出档/进度档、以及怎么确认它做完了。'
      : '该通道为后台常驻子智能体：立即返回 childId，可用 send_message 继续派活。')
    : '该通道为前台一次性子智能体：跑完即释放，完成后不可再派活。'
  return [
    `把一个任务委派给「${role.title}」子智能体（角色 id：${role.id}）。`,
    '调用前无需自己拼提示词：本工具会现场装配完整契约（总纲本体 + 角色卡 + 任务切面 + 文档切片 + 状态槽 + 能力配置）作为子智能体的初始提示词。',
    modeText,
    // FIX-78：`run_in_background` 的**代价**必须写在描述里（真机就是没写这个代价，
    // 主代理为了让馆员"出预演"而传了 false，把常驻角色降级成了一次性 ✗）喵
    // FIX-94 ③：常驻单例**忽略**这个参数 —— 这句紧跟其后，且**只挂在常驻角色**的通道上
    //（挂到所有角色上会让"按任务实例"的角色读到一条与它无关的规则）喵
    '关于 `run_in_background`：**默认（不传）= 后台常驻**，不阻塞返回，成果通过产出档/回执获取，'
      + '之后**可以继续给它派活**；传 `false` = 本次**等待结果**，但会变成**一次性**（跑完即释放，'
      + '**之后不能再派活**）—— 需要"拿到结果还要继续用同一个它"时，别传 false，改用下面的两段式。'
      + (role.singleton === true
        ? '**对常驻单例角色无效（会被忽略）**：常驻角色始终走常驻路径（同一会话），要结果请用"派完读产出档"。'
        : ''),
    '**要结果又要续派的两段式**：① 后台派（常驻）→ 让它把预演/结论**写进产出档**（L3/L2/L1）或回执里；'
      + '② 主代理读产出档拿到预演 → 用户确认后**向同一个它续派**（同一角色的下一次调用即是续派，不会新建实例）。',
    '',
    `产出契约：${role.deliverable}`,
    `禁止事项：${role.forbidden}`,
    '',
    `当前可用角色共 ${roleCount} 个；请只传任务号与必要补充指令，不要替子智能体做调研或写结论。`,
  ].join('\n')
}

/**
 * 工具白名单下发喵（**DESIGN §9-22【critical】**）喵。
 *
 * **默认 fail-open：声明的名字原样下发，不做存在性剔除**喵。
 * 为什么：曾经拿 `ctx.tools.schemas()` 当"宿主工具目录"求交集 —— 但在**本插件自己的上下文里**，
 * 它只枚举到本插件注册的工具，于是 `read/write/edit/glob/grep/pwsh/todo_write` 全被判"未注册"而剔除，
 * 子智能体只剩 `doc_emit`/`progress_upsert` → **"能派活、不能干活"**，比 start 硬失败更危险（静默降级）喵。
 *
 * 所以规则是喵：
 * ① 一律 fail-open；终端工具名已由 `listRoles()` 按平台解析成单个正确名字，**不靠剔除**喵；
 * ② 只有拿到**权威**宿主工具目录（须写明来源）时才允许**告警**；**永远不剔除**喵；
 * ③ `ctx.tools.schemas()` **禁止**再当宿主目录用（它只覆盖本插件注册面）喵。
 *
 * @param role - 角色定义（tools 已按平台解析）喵。
 * @param authoritativeDirectory - 权威宿主工具目录（`Set<string>`）。**当前没有任何可信来源**，
 *   调用点一律传 `undefined` ⇒ fail-open；将来宿主提供目录 API 时才从这里接入喵。
 */
export function resolveToolFilter(role, authoritativeDirectory) {
  const allow = [...new Set(Array.isArray(role.tools) ? role.tools : [])]
  if (!allow.length) return null
  if (!authoritativeDirectory || authoritativeDirectory.size === 0) return { allow }
  const missing = allow.filter((name) => !authoritativeDirectory.has(name))
  // 即便有权威目录也**只告警不剔除**：剔错过一次，代价是整条通道静默残废喵
  return missing.length ? { allow, missing } : { allow }
}

/**
 * 把一次委派写进台账（成员 + 任务）喵。
 * 台账是可重建的缓存：写不进去绝不能让委派本身失败，所以整段吞错喵。
 */
/**
 * 把一次委派写进台账（成员 + 任务）喵。
 * 台账是可重建的缓存：写不进去**绝不能让委派本身失败**（仍然吞错），但**不许静默** ——
 * FIX-73 ③：返回记账结果，调用方把「记账延后」写进回执（真机上"记账失败/延后"没人知道是最恼人的）喵。
 * @returns `{ ok, reason }`喵。
 */
/**
 * 派单者（父）的**会话 id** 喵（FIX-90）喵：记进成员记录，这样用户归档**父会话**时，
 * 它下面那些子成员也能被沿父链判成"已归档"（真机：归档的正是父会话，被扫的是子会话）喵。
 */
function parentSessionIdOf(agent) {
  try {
    const header = agent && agent.session ? agent.session.header : null
    return header && header.id ? String(header.id) : null
  } catch {
    return null
  }
}

/**
 * FIX-94 ②：后台/常驻派单**不阻塞返回** ⇒ 回执必须告诉调用方"这轮结果去哪儿读"喵。
 *
 * **为什么不能同步取结果**（已核宿主的实现，不是猜的）喵：
 * `ctx.subagents.sendMessage(sender, target, content, options)` 的 `options` 只有 `{ signal }`
 * （`packages/subagent/subagent/src/types.ts:70` 的 `SubagentSendMessageOptions`），返回的是**投递确认**
 * （`MessageId`）；宿主自己的 `send_message` 工具描述也写着
 * "Returns delivery confirmation, not the agent's answer." ⇒ **没有"等到这一轮结束"的能力** ✗。
 * 所以按 FIX-94 的备选口径落地：给出**落点** + **怎么确认它做完了**（两段式）喵。
 */
export function backgroundResultHint({ project, taskId, roleId = '', resident = false } = {}) {
  const deliverables = project && project.deliverablesDir ? String(project.deliverablesDir) : null
  const progress = project && project.progressDir ? joinUnderRoot(project.progressDir, `${taskId}.md`) : null
  return [
    '后台派单**不阻塞返回**（宿主 `sendMessage` 只回投递确认，不回答案）⇒ 本轮结果这样取：',
    deliverables ? `① 读它这轮的产出档（落在 ${deliverables}）` : '① 读它这轮的产出档',
    progress ? `② 看进度档 ${progress}` : '② 看它这轮的进度档',
    '③ 跑一次 `audit_scan`（该交没交会直接列出来）',
    // 常驻单例再补一句：别为"等结果"传那个参数（它已被忽略，不会有任何效果）喵
    resident ? `（${roleId || '常驻角色'} 是常驻单例：**忽略** \`run_in_background\`，为"等结果"传它没有意义）` : '',
  ].filter(Boolean).join(' ')
}

/**
 * FIX-100 ④：派单通道**不可用时**把话说全喵 —— 为什么 + 替代路径（真机教训：工具一报错，主代理就会
 * 改用宿主的普通派单**绕过契约**，而那条路完全不留痕 ✗）。四件事一起给：宿主原话 / 三条出路 / 硬规矩喵。
 */
export function delegationFailure(error, role = null) {
  const why = (error && error.message) || String(error)
  const roleId = role && role.id ? role.id : '<角色>'
  return new Error(
    `agent-contract: 委派「${roleId}」失败 —— ${why}`
    + '｜可以这样办：'
    + `① 换一次/稍后重试（宿主偶尔会拒"同会话已在跑"这类状态）；`
    + `② 若是"跨会话 / 单例不可达"，插件已尽量自动新建本会话实例（FIX-99），仍失败就把上面的原话贴出来；`
    + `③ 若整条工具链都在报错，跑一次 \`contract_status\`（看"版本漂移"/"台账领域打不开"）并**完整重启应用**；`
    + `④ **确需绕过契约**改用宿主的普通派单：先调 \`contract_request_escalation\` 说明理由再用 —— `
    + `绕过会被审计报 \`uncontracted_dispatch\`（黄），提权后才不算红黄`,
  )
}

/**
 * 角色 id → **审计路由键**喵（FIX-108/109）喵 —— 与 `AUDIT_ROUTES` 的取值对齐（`librarian` / `implementer` / `human`）喵。
 * 目的：契约里的审计摘要与待推送池都按这个键筛"归你这一路的条目"喵。
 */
export function routeForRole(roleId) {
  const id = String(roleId || '')
  if (id === 'librarian') return 'librarian'
  if (['implementer', 'researcher', 'reviewer'].includes(id)) return 'implementer'
  return 'human'
}

/**
 * 取"这个名字下**还在用**的那条成员记录"喵（FIX-99 ②）喵。
 *
 * 为什么不能直接 `getMember(name)`：成员文档按 **id** 存（FIX-17），而退役记录与在用记录**同名**
 * ⇒ `listMembers().find(名字相等)` 可能先撞上退役的那条 ⇒ 会把"可复用"误判成"已退役"⇒ 每次都新建 ✗ 喵。
 */
export function activeMemberNamed(store, name) {
  if (!store || typeof store.listMembers !== 'function') return null
  const rows = store.listMembers().filter((row) => row && String(row.name || '') === String(name))
  if (!rows.length) return null
  return rows.find((row) => String(row.status || '') !== 'retired') || rows[0]
}

/**
 * FIX-99 ①⑥：**为什么不能复用既有常驻实例**喵 —— 返回原因文案（可复用就 null）喵。
 *
 * 背景（真机：整个项目的馆员一个都用不了）喵：宿主的可续派子会话**只接受它自己的父会话投递**
 * （`packages/subagent/subagent/src/continuation-activation.ts:309/475`：
 * `subagent "<childId>" belongs to another parent session`）⇒ FIX-79 的"一个常驻实例服务所有任务"
 * 在**跨会话**时不可能。旧规则又只看"名字对 + 有会话 id" ⇒ 遇到"底层是一次性实例"也判可复用 ⇒ 派单被拒、
 * 功能直接瘫 ✗。
 *
 * 新判据（**只认**同时满足全部条件的记录）喵：名字对 + `mode: continuable` + 有会话 id +
 * 会话**没有被归档** + 会话**属于本会话**。其余一律视为不可复用 ⇒ **本会话新建**（旧的标 `retired`），
 * **绝不拒绝派单**喵。
 */
export function residentReuseReason({
  role, boundStore = null, existing = null, parentSessionId = null, ownerSessionId = null, archived = null,
} = {}) {
  if (!role || role.singleton !== true) return '角色元数据缺 singleton 标志（不是常驻单例角色）'
  if (!boundStore) return '台账 store 未绑定（项目解析没给出该项目的存储域）'
  // 「台账里没有它的记录」= **首次创建**（正常），不算复用失败 —— 由调用方作为"首次创建"说明出去喵
  if (!existing) return null
  if (!existing.id) return '台账里的常驻记录**没有可用会话**（id 为空：多半是 ledger_rebuild 从磁盘推导出来的）'
  if (String(existing.mode || '') === 'one-shot') {
    return '台账里的同名记录是**一次性实例**（那个会话跑完就释放了，宿主也拒绝再投递给它）'
  }
  if (String(existing.mode || '') !== 'continuable') return `台账里的同名记录模式是 \`${existing.mode || '未知'}\`（不是常驻）`
  if (String(existing.status || '') === 'retired') return '台账里的同名记录已**退役**（retired）'
  // FIX-99 ③：owner 会话已归档 ⇒ 视为**可回收** ⇒ 本会话新建（旧实例退役），不再"被它占着"喵
  if (ownerSessionId && isArchivedSession(archived, ownerSessionId)) {
    return `既有常驻实例属于会话 ${ownerSessionId}（该会话**已归档**：视为可回收）`
  }
  // 归属校验：宿主禁止跨会话投递 ⇒ 知道 owner 且不是本会话就**别去撞墙**，直接新建喵
  if (ownerSessionId && parentSessionId && String(ownerSessionId) !== String(parentSessionId)) {
    return `既有常驻实例属于会话 ${ownerSessionId}（宿主**禁止跨会话投递**）`
  }
  // owner 未知（老记录没记、宿主也拿不到）⇒ 交给"试投递 + 兜底新建"那条路（绝不允许最终被拒）喵
  return null
}

/**
 * FIX-93 ① 的说明文案仍由上面那个判据函数给出（复用失败时逐条写明原因）——
 * 这里不再另立一套判据，免得"复用判据"两处漂移喵。
 */

async function recordDelegation(ledger, entry, storeOrNull) {
  if (!storeOrNull && (!ledger || !ledger.ready)) {
    return { ok: false, reason: '台账未就绪（storageDomain 未注入或领域还没打开）—— 记账延后，等下一轮快照同步补上' }
  }
  try {
    // FIX-58：store 由解析器按**项目键**给出（一个实例服务多个项目）；没给才退回默认项目喵
    const store = storeOrNull || (await ledger.ready)
    // FIX-79：常驻单例的成员名由调用方给出（= 角色名，不带任务号）喵
    const name = entry.name || memberName(entry.taskId, entry.role)
    await store.putMember(memberRecord({
      id: entry.id,
      name,
      role: entry.role,
      mode: entry.mode,
      layer: entry.layer,
      parent: entry.parent,
      status: entry.status,
      model: entry.model ?? null,
      route: entry.route ?? null,
      derived: false,
      // FIX-90：记下**派单者的会话 id** —— 用户归档父会话时，这些子成员也该算"已归档"喵
      parentSessionId: entry.parentSessionId ?? null,
    }))
    const now = new Date().toISOString()
    const task = store.getTask(entry.taskId)
    if (task) await store.putTask({ ...task, owner: task.owner || name, updatedAt: now })
    else await store.putTask(taskRecord({ taskId: entry.taskId, status: 'running', owner: name, updatedAt: now }))
    return { ok: true, reason: '' }
  } catch (error) {
    // 台账异常不影响委派本身，但**要说出来**（返回给调用方，由回执体现）喵
    return { ok: false, reason: `写入台账失败（不影响本次派单）：${error && error.message ? error.message : error}` }
  }
}

/**
 * 注册全部角色的委派通道喵。
 * @param ctx - 插件上下文（需具备 tools 与 subagents 服务）喵。
 * @param config - 插件配置喵。
 * @param ledger - `createLedger()` 的结果（可选；缺失时只记不写）喵。
 */
export function registerChannels(ctx, config, ledger, collected, projectFor) {
  // FIX-79 ③：常驻单例干完一轮 ⇒ 队列 -1（排队计数只做**可见性**，绝不丢消息）喵
  if (ctx && typeof ctx.on === 'function') {
    ctx.on('subagent/end', (info) => {
      const childId = String((info && (info.id || info.sessionId)) || '')
      const roleId = residentChildRole.get(childId)
      if (!roleId) return
      popResidentQueue(roleId)
      residentChildRole.delete(childId)
    })
  }
  const provider = (config.delegation && config.delegation.provider) || 'spawn'
  const roles = listRoles(config)
  const collectedNames = Array.isArray(collected) ? collected : []

  for (const role of roles) {
    const channelToolName = `contract_delegate_${role.id}`
    collectedNames.push(channelToolName)
    ctx.tools.register(defineTool({
      name: channelToolName,
      description: describeChannel(role, roles.length),
      parameters: {
        taskId: { type: 'string', required: true, description: '任务号（对应任务目录下的任务文件名，不含 .md）' },
        brief: { type: 'string', description: '可选：给子智能体的补充指令或范围限定，会拼进契约的任务切面。' },
        run_in_background: { type: 'boolean', description: '可选：仅对后台角色有效。传 false 表示本次改为等待结果再返回。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            kind: { type: 'string', required: true },
            role: { type: 'string', required: true },
            contractChars: { type: 'number', required: true },
            overflow: { type: 'boolean', required: true },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
            childId: { type: 'string' },
            runId: { type: 'string' },
            text: { type: 'string' },
            // FIX-59：生效模型与它的来源（真机验收"记录里 model 非空"看这两行就够）喵
            model: { type: 'string' },
            modelSource: { type: 'string' },
          },
        },
        render: (_args, value) => {
          // DESIGN §9-23：warnings 必须渲染出来——只打印"已派出…"会让"已降级/已裁剪"这类警告完全不可见喵
          const head = value.kind === 'continuable'
            ? `已派出后台子智能体 ${value.childId}（角色 ${value.role}）\n契约 ${value.contractChars} 字${value.overflow ? '，已超预算并裁剪' : ''}`
            : (value.text || `子智能体（角色 ${value.role}）未返回文本`)
          // FIX-59：把"这次跑在哪个模型上"写进回执（拿不到就明说"未知"，由审计观察项跟进）喵
          const modelLine = value.model
            ? `模型：${value.model}（来源 ${modelSourceText(value.modelSource)}）`
            : '模型：未知（宿主没给出模型信息 ⇒ 审计会记一条“无法判定”，见 FIX-59）'
          const warnings = Array.isArray(value.warnings) ? value.warnings : []
          // FIX-61：结构缺失要在派单回执里说一句（主代理据此提醒用户调 project_init）喵
          const body = `${head}\n${modelLine}${value.projectHint ? `\n提示：${value.projectHint}` : ''}`
            // FIX-62：git 基线提示（只提示不代提交）喵
            + (value.gitBaselineHint ? `\n${value.gitBaselineHint}` : '')
            // FIX-78 ②/③ + FIX-79 ②③：把"这次是怎么派的"讲明白（一次性 / 首次创建 / 续派 / 排队）喵
            + (value.oneShot ? '\n本次为**一次性**：跑完即释放，之后不能再给它派活（要"结果+续派"请用两段式，见工具描述）' : '')
            // FIX-104 ④：续派只发**任务切片**（不重复契约）；契约真变了才明说
            + (value.dispatched === 'continued'
              ? `\n本次为**续派**：发给已有的同一个常驻会话（没有新建实例）`
                + (value.sliceChars ? `；**只发任务切片 ${value.sliceChars} 字（未重复契约）**` : '')
                + (value.contractUpdated ? `\n**契约已更新**：${(value.changedSegments || []).join('、')} —— 本轮已把变化段补发进切片` : '')
              : '')
            + (value.dispatched === 'created' && value.resident ? '\n本次**首次创建**常驻单例（之后同一个它服务所有任务）' : '')
            // FIX-93 ①：首次创建 / 未复用的说明（**不许静默**：真机就是静默新建，用户只能靠成员表猜）喵
            + (value.reuseNote ? `\n${value.reuseNote}` : '')
            // FIX-94 ④：常驻角色忽略该参数 —— 调用方传了就必须被告知"已忽略"（否则他会以为自己在等结果）喵
            + (value.backgroundIgnored ? '\n注意：`run_in_background: false` 对常驻角色**无效（已忽略）**—— 常驻角色始终走常驻路径（同一个会话），不会为了"等结果"另起实例' : '')
            // FIX-94 ②：本轮结果去哪儿读（常驻/后台派单都不阻塞返回）喵
            + (value.resultHint ? `\n本轮结果怎么取：${value.resultHint}` : '')
            // FIX-99 ④：全局共享文件（跨会话并发写会互相覆盖 ⇒ 串行或先声明占用）喵
            + (value.globalFiles ? `\n${value.globalFiles}` : '')
            + (value.queueNote ? `\n${value.queueNote}` : '')
          return [{ type: 'text', text: warnings.length ? `${body}\n警告：\n- ${warnings.join('\n- ')}` : body }]
        },
      },
      presentCall: () => ({ card: 'generic', title: `委派给${role.title}`, kind: 'execute' }),
      async execute(args, exec) {
        const parent = exec && exec.agent
        if (!parent) throw new Error('委派需要调用方智能体（exec.agent 为空）')
        const taskId = String((args && args.taskId) || '').trim()
        if (!taskId) throw new Error('委派缺少任务号（taskId）')

        const layer = depthOf(parent) + 1
        const counted = await countAgents(ctx, parent, exec.signal)
        const totalAgents = counted === null ? layer : counted
        const warnings = []
        if (counted === null) warnings.push('无法统计总 Agent 数（会话/谱系服务不可用），已退化为按层数填写')

        const parentLabel = await parentIdentity(ctx, parent, exec.signal)
        // FIX-99：**本会话 id**（= 派单者会话），两条派单路径（后台常驻 / 前台一次性）都要记它 ——
        // 常驻实例只服务它自己的父会话（宿主禁止跨会话投递），所以这个 id 是复用判据的一部分喵
        const selfSessionId = parentSessionIdOf(parent)
        // FIX-58：项目由**调用方会话**现推（换工作区=换项目），契约里的路径槽位必须是该项目自己的喵
        const resolved = typeof projectFor === 'function' ? await projectFor(exec) : null
        // FIX-99 ④ / FIX-101 ②：**全局共享文件**清单 —— 进契约（迁移/索引类任务要知道"哪些文件是全局一份"），
        // 常驻派单的回执里也再带一次（便于主代理串行）喵
        const globalFilesText = resolved ? globalSharedFilesText(resolved.project) : ''
        /**
         * FIX-108 ③：**契约自动带审计摘要**（闭环：馆员看得见要收拾什么）喵 ——
         * 用**同一份实现**（`runPanelAudit` → `renderAuditDigest`）产出，馆员看全量、其它角色只看与本任务相关的喵；
         * FIX-109 ④：把**待推送池**里属于该角色的条目一并带上（没有活跃角色时新增条目不会丢）喵。
         */
        let auditDigest = null
        try {
          if (resolved) {
            const { report } = await runPanelAudit({
              ctx, config, store: resolved.store, project: resolved.project,
            })
            const pushState = await loadPushState({ project: resolved.project })
            const minePending = (pushState.pending || []).filter((row) => row.role === routeForRole(role.id))
            auditDigest = renderAuditDigest({
              report,
              taskId: role.singleton === true ? null : taskId,
              role: routeForRole(role.id),
              pending: minePending,
            })
          }
        } catch (error) {
          // 摘要拿不到**不影响派单**（契约少一段而已）—— 但要留一句，别静默喵
          warnings.push(`审计摘要没拿到（不影响派单）：${(error && error.message) || error}`)
        }
        // FIX-61：结构缺失就在派单回执里也提示一句（主代理不必"记得"去调 project_init）喵
        const structureHint = resolved ? missingStructure({ project: resolved.project }) : null
        // FIX-62：会动文件的角色在派单回执里给一句 git 基线提示（**只提示、不代提交**；非仓库/干净则没有）喵
        const gitHint = resolved && touchesFiles(role.tools) ? await baselineHintFor({ project: resolved.project }) : null
        const contract = await buildContract({
          config,
          ...(resolved ? { project: resolved.project } : {}),
          // FIX-78 ③：把"本次被怎么派"写进契约（子代理自己也该知道自己是常驻还是一次性）喵
          // FIX-94 ①：常驻角色**忽略** `run_in_background` ⇒ 契约里也**不许**写"本次为一次性"喵
          oneShot: role.mode === 'one-shot'
            || (role.singleton !== true && (args && args.run_in_background === false)),
          roleId: role.id,
          task: { id: taskId, brief: args && args.brief },
          parent: parentLabel,
          layer,
          totalAgents,
          // FIX-101 ②③：全局共享文件清单进契约（与回执同一份文本）喵
          globalFilesText,
          // FIX-108 ③：审计摘要（馆员全量 / 其它角色按任务过滤）喵
          auditDigest,
        })
        warnings.push(...contract.warnings)

        // DESIGN §9-22：fail-open —— 声明名原样下发（终端工具名已在 listRoles 里按平台解析成单个）喵
        const toolFilter = resolveToolFilter(role)
        const request = {
          // FIX-79：常驻单例的 label 就是角色名（它服务所有任务，带上某个任务号会误导）喵
          label: role.singleton === true ? role.id : `${taskId}-${role.id}`,
          prompt: [{ type: 'text', text: contract.text }],
          parent,
          signal: exec.signal,
          ...(role.persona ? { persona: role.persona } : {}),
          ...(toolFilter ? { toolFilter } : {}),
        }
        const agentOptions = routeOptions(config, role)
        if (agentOptions) request.agentOptions = agentOptions
        const maxDepth = ctx.subagents.resolveMaxDepth
          ? ctx.subagents.resolveMaxDepth(config.delegation && config.delegation.maxDepth)
          : undefined
        if (maxDepth !== undefined) request.maxDepth = maxDepth

        // FIX-99：判"既有常驻实例的 owner 会话是否已归档"要用**归一化后的**归档集合（FIX-90 同款）；
        // owner 会话优先取成员记录里的 `parentSessionId`，老记录没记就问宿主的会话父子 API 喵
        const archivedSet = normalizeArchivedSet(archivedSessionsOf(ctx))
        const residentParentOf = parentSessionOf(ctx)
        // FIX-94 ①（用户拍板 B）：**常驻单例忽略 `run_in_background`** ——
        // 无论传 `true` / `false` / 不传，一律走常驻路径（首次创建 / 之后续派）喵。
        // 为什么：真机链条是"主代理想拿结果 → 传 false → 落前台分支 → 另起一个会话"，
        // 那个新会话**没有复用常驻的那个** ⇒ 白烧一份上下文（FIX-93 只保住了名字与身份，没保住实例）✗。
        // 参数不该改变**实例模型**；"要结果"改走"派完读产出档"（宿主 `sendMessage` 只回投递确认，不回答案）喵
        const isResident = role.singleton === true
        const wantsBackground = args && args.run_in_background === true
        if (role.mode === 'one-shot' && wantsBackground) {
          throw new Error(`${role.id} 是前台一次性角色，不支持 run_in_background（跑完即释放，无法后台收集）`)
        }
        // 常驻角色一律后台（常驻路径）；其余角色仍按参数决定是否前台等待喵
        const background = isResident || (role.mode === 'continuable' && (args && args.run_in_background) !== false)

        if (background) {
          /**
           * FIX-79：**常驻单例**角色（馆员）的派单语义喵 —— 首次调用 = **创建**；
           * 之后调用 = **向同一会话续派一条消息**（不新建实例）喵。
           *
           * 为什么单例：它动的全是**全局共享文件**（坑库 README / 派生态索引 / 核心数据库 / 交叉引用 / 归档目录）⇒
           * 5 个任务各派一个馆员 = 多进程改同几个文件 = **互相覆盖**（插件自己踩过：`坑/README.md` 被整篇覆盖且无备份）喵。
           */
          const residentName = memberName(taskId, role.id, { singleton: isResident })
          const boundStore = resolved ? resolved.store : null
          const existing = isResident && boundStore ? activeMemberNamed(boundStore, residentName) : null
          // owner 会话：优先成员记录里的（FIX-90 起会写），老记录没记就问宿主的会话父子 API 喵
          // FIX-90 补漏（真机："审计区还会引用源自归档的对话"）：活会话里**没有**归档对话的子会话 ⇒
          // 活会话查不到时再问**会话持久化**（`sessionPersistence.list()`，含已结束的会话）——
          // 这样"owner 是归档会话的老常驻实例"能被**主动**判为可回收，不必先撞一次宿主的拒绝喵
          let ownerSessionId = existing ? String(existing.parentSessionId || '') : ''
          if (isResident && existing && existing.id && !ownerSessionId) {
            try {
              ownerSessionId = String((residentParentOf ? residentParentOf(String(existing.id)) : '') || '')
            } catch {
              ownerSessionId = ''
            }
            if (!ownerSessionId) {
              try {
                ownerSessionId = String((await sessionParentIndexOf(ctx)).parentOf(String(existing.id)) || '')
              } catch {
                ownerSessionId = ''
              }
            }
          }
          const reuseBlocked = isResident
            ? residentReuseReason({
              role, boundStore, existing, parentSessionId: selfSessionId, ownerSessionId, archived: archivedSet,
            })
            : null
          /**
           * FIX-99 ①②⑥：**绝不允许"被拒"**喵 —— 既有实例不可复用（跨会话 / 一次性 / 已退役 / 无会话 id /
           * owner 已归档）时，**本会话新建一个**，并把旧的标 `retired`（记录保留、留痕）喵。
           * 真机病根：新会话被 `belongs to another parent session` 拒、旧会话那条又指向一次性实例 ⇒
           * **一个可用的馆员都没有**，文档整理整条链卡死 ✗。
           */
          let reuseNote = null
          if (isResident && reuseBlocked) {
            warnings.push(`未能复用既有常驻实例（原因：${reuseBlocked}）→ **本次为本会话新建**`
              + `（名字仍固定为 \`${residentName}\`，不拼任务号）`)
            if (existing && boundStore && String(existing.status || '') !== 'retired') {
              // 旧实例**退役但不删**：留痕 + 面板看得见（谁让的位、为什么）喵
              try {
                await boundStore.putMember(retireMember(existing, reuseBlocked))
                warnings.push(`旧常驻实例 \`${existing.id}\` 已标记 **retired**（原因同上；记录保留，不删）`)
              } catch (error) {
                warnings.push(`旧常驻实例退役失败（不影响本次派单）：${error && error.message ? error.message : error}`)
              }
            }
          } else if (isResident && !existing) {
            // 台账里干干净净 ⇒ **首次创建**（正常），照样明说一声：读者不必猜"这是第几个它"喵
            reuseNote = '本次为该常驻角色的**首次创建**（台账里此前没有它的可用记录）—— 从下一次调用起就是**续派**喵'
          }
          if (isResident && !reuseBlocked && existing && existing.id) {
            /**
             * FIX-104 ①：**续派只发任务切片**喵 —— 常驻成员第一次创建时已经带着完整契约（总纲 / 角色卡 /
             * 能力配置 / 文档规范…），再每次重发一遍就是白烧上下文（用户原话："非第一次的提示词中出现了
             * 大量的重复内容，比如角色卡等"）✗。
             * 指纹（插件版本 + 契约格式版本 + 角色 + 项目）变了才补发「契约已更新 + 变化的那一段」喵。
             */
            const fingerprintNow = contractFingerprint({ role, project: resolved ? resolved.project : null })
            const previousFingerprint = existing.contractFingerprint || null
            const slice = renderContinuationSlice({
              taskId,
              brief: (args && args.brief) || '',
              taskFile: resolved ? joinUnderRoot(resolved.project.tasksDir, `${taskId}.md`) : null,
              previousFingerprint,
              fingerprint: fingerprintNow,
              specText: resolved ? [
                ...docSpecLines({ project: resolved.project }),
                ...resolvedPathsLines({ project: resolved.project, globalFiles: globalFilesText }),
              ].join('\n') : '',
              budgets: { soft: contract.briefSoft, hard: contract.briefHard },
            })
            // 续派：往同一会话发一条消息（宿主会在步边界接收；它忙时会排队，不丢）
            const busy = String(existing.status || '') === 'running'
            const depth = busy ? pushResidentQueue(role.id) : queueOf(role.id)
            let sent = { ok: true, messageId: null }
            if (typeof ctx.subagents.sendMessage !== 'function') {
              sent = { ok: false, reason: '宿主没提供 `subagents.sendMessage`（无法续派，退化为本次不派）' }
            } else {
              try {
                sent.messageId = await ctx.subagents.sendMessage(
                  parent, existing.id, [{ type: 'text', text: slice.text }], { signal: exec.signal },
                )
                residentChildRole.set(String(existing.id), role.id)
              } catch (error) {
                sent = { ok: false, reason: `续派被拒：${error && error.message ? error.message : error}` }
              }
            }
            if (!sent.ok) {
              /**
               * FIX-99 ①：**宿主拒了也不算完**喵 —— 不能停在"续派未送达"然后当作已派出（那是假回执），
               * 更不能把整次派单判失败（真机上就是这么让"一个可用的馆员都没有"的）✗。
               * 这里的规矩是：**本会话新建**（下面那段创建路径），并把旧实例标 `retired` 留痕喵。
               */
              if (busy) popResidentQueue(role.id)
              warnings.push(`续派未送达（${sent.reason}）→ 改为**本会话新建**常驻实例（不许把派单判失败）`)
              if (existing.id && boundStore && String(existing.status || '') !== 'retired') {
                try {
                  await boundStore.putMember(retireMember(existing, `续派不可达：${sent.reason}`))
                  warnings.push(`旧常驻实例 \`${existing.id}\` 已标记 **retired**（记录保留，不删）`)
                } catch (error) {
                  warnings.push(`旧常驻实例退役失败（不影响本次派单）：${error && error.message ? error.message : error}`)
                }
              }
              reuseNote = `既有常驻实例不可达（${sent.reason}）⇒ 本次为**本会话新建**`
            } else {
              const effectiveContinued = resolveEffectiveModel({
                ctx, parent, explicitModel: agentOptions && agentOptions.model, childSessionId: existing.id,
              })
              const bookkeeping = await recordDelegation(ledger, {
                id: existing.id,
                taskId,
                role: role.id,
                name: residentName,
                mode: 'continuable',
                layer,
                parent: parentLabel,
                status: 'running',
                model: effectiveContinued.model,
                route: role.modelRoute,
                parentSessionId: selfSessionId,
                // FIX-104：记下本次契约指纹（下次续派据此判"要不要补发契约"）喵
                contractFingerprint: fingerprintNow,
              }, boundStore)
              if (bookkeeping && bookkeeping.ok === false) warnings.push(`记账延后：${bookkeeping.reason}`)
              return {
                kind: 'continuable',
                dispatched: 'continued',
                resident: true,
                // FIX-94 ④：调用方传了 `false` ⇒ 明说"这个参数对常驻角色无效（已忽略）"喵
                ...(args && args.run_in_background === false ? { backgroundIgnored: true } : {}),
                // FIX-94 ②：本轮结果去哪儿读（常驻路径不阻塞返回）喵
                resultHint: backgroundResultHint({
                  project: resolved ? resolved.project : null, taskId, roleId: role.id, resident: isResident,
                }),
                queueAhead: Math.max(0, depth - 1),
                // FIX-104 ④：回执写明"只发切片"与"契约是否更新"（面板/主代理都看得见）喵
                sliceChars: slice.chars,
                contractUpdated: slice.updated,
                changedSegments: slice.changedSegments,
                // FIX-99 ④：全局共享文件（写前先查占用；跨会话并存时串行）喵
                ...(globalFilesText ? { globalFiles: globalFilesText } : {}),
                ...(busy ? { queueNote: `排队中：它正在忙别的任务，这条前面还有 ${Math.max(0, depth - 1)} 条（宿主会在步边界接收，不会丢）` } : {}),
                role: role.id,
                childId: existing.id,
                messageId: sent.messageId || null,
                ...(structureHint ? { projectHint: structureHint.hint } : {}),
                ...(gitHint ? { gitBaselineHint: gitHint } : {}),
                model: effectiveContinued.model,
                modelSource: effectiveContinued.source,
                contractChars: contract.totalChars,
                overflow: contract.overflow,
                warnings,
              }
            }
          }
          // ---- 创建路径（首次 / 不可复用 / 续派被拒兜底）----
          // FIX-99 ②：新建之前先把**同角色的其它活跃常驻**退役 ⇒ 项目内一个角色**最多一个 active** 喵
          if (isResident && boundStore) {
            for (const other of boundStore.listMembers()) {
              if (!other || other.id === existing?.id) continue
              if (String(other.role || '') !== role.id) continue
              if (String(other.mode || '') !== 'continuable') continue
              if (String(other.status || '') === 'retired') continue
              if (!String(other.name || '').startsWith(role.id) && String(other.name || '') !== residentName) continue
              try {
                await boundStore.putMember(retireMember(other, `同一角色已有活跃常驻实例（本会话新建了 \`${residentName}\`）`))
                warnings.push(`旧常驻实例 \`${other.id}\`（${other.name}）已标记 **retired**：一个角色在项目内**最多一个 active**`)
              } catch {
                /* 退役失败不影响派单喵 */
              }
            }
          }
          // FIX-100 ④：**契约工具不可用时要显式说明**（为什么不可用 + 替代路径）—— 别让主代理瞎试到偷偷绕过喵
          let started
          try {
            started = await ctx.subagents.startContinuable({ provider, label: request.label, request, signal: exec.signal })
          } catch (error) {
            throw delegationFailure(error, role)
          }
          if (isResident) {
            residentChildRole.set(String(started.childId), role.id)
            residentQueue.set(role.id, 0)
          }
          // FIX-59：常驻子智能体只回 `{childId, messageId}`，没有模型 —— 按"显式路由 → 子会话 → 父路由 → 部署默认"
          // 把**生效模型**解析出来记账；拿不到就是 null（审计那条观察项会明说"无法判定"）喵
          const effective = resolveEffectiveModel({
            ctx, parent, explicitModel: agentOptions && agentOptions.model, childSessionId: started.childId,
          })
          const bookkeeping = await recordDelegation(ledger, {
            id: started.childId,
            // FIX-79：常驻单例只有**一条**成员记录（名字=角色名、不带任务号）喵
            name: memberName(taskId, role.id, { singleton: isResident }),
            taskId,
            role: role.id,
            mode: 'continuable',
            layer,
            parent: parentLabel,
            status: 'running',
            model: effective.model,
            route: role.modelRoute,
            parentSessionId: selfSessionId,
          }, resolved ? resolved.store : null)
          // FIX-73 ③：记账结果要进回执（真机上记账失败/延后没人知道是最恼人的）—— 但**不影响派单**喵
          if (bookkeeping && bookkeeping.ok === false) warnings.push(`记账延后：${bookkeeping.reason}`)
          return {
            kind: 'continuable',
            // FIX-79 ②：回执要标明**首次创建**还是**续派**喵
            dispatched: 'created',
            ...(isResident ? { resident: true, queueAhead: 0 } : {}),
            // FIX-93 ①：首次创建要明说（不许让读者猜"这是第几个它"）喵
            ...(reuseNote ? { reuseNote } : {}),
            // FIX-99 ④：全局共享文件（写前先查占用；跨会话并存时串行）喵
            ...(globalFilesText ? { globalFiles: globalFilesText } : {}),
            // FIX-94 ④：传了 `false` ⇒ 明说"已忽略"（常驻角色始终走常驻路径）喵
            ...(args && args.run_in_background === false ? { backgroundIgnored: true } : {}),
            // FIX-94 ②：本轮结果去哪儿读喵
            resultHint: backgroundResultHint({
              project: resolved ? resolved.project : null, taskId, roleId: role.id, resident: isResident,
            }),
            role: role.id,
            childId: started.childId,
            // FIX-61：结构缺失随回执一起提示（结构齐则**不带**这个字段）喵
            ...(structureHint ? { projectHint: structureHint.hint } : {}),
            ...(gitHint ? { gitBaselineHint: gitHint } : {}),
            // FIX-59：回执里直接给出模型与来源 —— 真机验收（"派一次实现者，记录里 model 非空"）一眼可查喵
            model: effective.model,
            modelSource: effective.source,
            contractChars: contract.totalChars,
            overflow: contract.overflow,
            warnings,
          }
        }

        const run = await (async () => {
          try {
            return await ctx.subagents.start(provider, request)
          } catch (error) {
            throw delegationFailure(error, role)
          }
        })()
        const settled = await settleForeground(run)
        // FIX-59：`run.localAgent.options` 是宿主**已解析**的结果（父路由 ⊕ 本次覆盖），最贴近事实喵
        const effective = resolveEffectiveModel({
          ctx,
          parent,
          explicitModel: agentOptions && agentOptions.model,
          childAgent: run && run.localAgent,
          childSessionId: settled.runId,
        })
        /**
         * FIX-94 ①：这条分支现在**对常驻单例不可达**（`background = isResident || …`）—— 真机病根正是
         * "主代理为要结果传了 `run_in_background: false` ⇒ 落到这条前台分支 ⇒ 另起一个**没有复用常驻会话**的
         * 实例"（FIX-93 只保住了名字与身份，没保住实例，白烧一份上下文）✗。
         * 现在单例角色一律走常驻路径，这条分支只剩"按任务实例的前台一次性角色"会走到喵。
         */
        const bookkeeping = await recordDelegation(ledger, {
          id: settled.runId,
          taskId,
          role: role.id,
          mode: 'one-shot',
          layer,
          parent: parentLabel,
          status: 'completed',
          model: effective.model,
          route: role.modelRoute,
          parentSessionId: selfSessionId,
        }, resolved ? resolved.store : null)
          // FIX-73 ③：记账结果要进回执（真机上记账失败/延后没人知道是最恼人的）—— 但**不影响派单**喵
          if (bookkeeping && bookkeeping.ok === false) warnings.push(`记账延后：${bookkeeping.reason}`)
        return {
          kind: 'foreground',
          // FIX-78 ②：传 `run_in_background: false`（或前台角色）⇒ 回执必须明示"**本次为一次性**"喵
          oneShot: true,
          // FIX-61：结构缺失随回执一起提示（结构齐则**不带**这个字段）喵
          ...(structureHint ? { projectHint: structureHint.hint } : {}),
          ...(gitHint ? { gitBaselineHint: gitHint } : {}),
          role: role.id,
          runId: settled.runId,
          text: settled.text,
          model: effective.model,
          modelSource: effective.source,
          contractChars: contract.totalChars,
          overflow: contract.overflow,
          warnings,
        }
      },
    }))
  }
}
