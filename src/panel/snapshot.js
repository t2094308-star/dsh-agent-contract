/**
 * 面板派生快照喵（M4 交付物 4 / 方案 a）喵。
 *
 * 面板（client 侧）要显示审计徽章，但发布自有 remote 需要 typert（已决定不做）喵。
 * 所以改走**派生快照文件**：
 * - 落点：`<project.root>/.agent-contract/panel.json`（**在工作区内**，client 的 `workspaceFiles.list/changes` 才够得着）
 * - 带 `schemaVersion` 与 `generatedAt`；client 遇到不认识的版本就**降级为 unknown**，绝不猜喵
 * - 这是**派生物**：可重建、不是真相、不进审计/文档体系、随时可删（建议加进 .gitignore）喵
 *
 * host 侧在「审计完成 / 台账变更」后重写它；**面板本身仍然只读**喵。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SUGGESTIONS } from '../audit/report.js'
import { isOpenTask } from '../ledger/state.js'
import { joinUnderRoot } from '../project.js'
import { missingStructure } from '../project/adaptive.js'
// FIX-86：角色形态/能力来自**唯一来源**的角色元数据表喵
import { capabilitiesOf, deliverableKindsOf } from '../contract/roles.js'
// FIX-90：归档判定（归一化 + 父链上溯）沿用审计侧同一份实现 喵
import { archivedViaChain, normalizeArchivedSet } from '../audit/archived.js'
import { loadedVersion, pluginVersion } from '../version.js'

/**
 * 派生快照的 schema 版本：客户端版本不匹配就全体降级 unknown喵。
 * v2（FIX-17/21）：`members` 增加按 `sessionId` 的主索引 `membersById`；`audit` 增加 `items` 清单喵。
 */
export const PANEL_SNAPSHOT_SCHEMA_VERSION = 2

/** 快照相对项目根的路径喵。 */
export const PANEL_SNAPSHOT_REL = '.agent-contract/panel.json'

/** 快照的绝对路径喵。 */
export function panelSnapshotPath(project) {
  return joinUnderRoot(project.root, PANEL_SNAPSHOT_REL)
}

/**
 * 把一条待办/审计目标**反解到它会话**喵（FIX-30）喵：能跳的行必须带 `sessionId`。
 *
 * 三条线索依次试喵：① 目标本身就是成员名（`missing_doc` 的 target 就是成员名）
 * ② 目标是文档路径 → 文档 owner → 成员 ③ 目标是任务号 → 任务 owner → 成员。
 * 解不出来就返回 null —— 宁可**不可点**，也不要点了跳到错的地方喵。
 */
function sessionOfTarget({ store, target, kind }) {
  const memberByName = (name) => {
    if (!name) return null
    const member = store.listMembers().find((row) => row.name === name)
    return member && member.id ? String(member.id) : null
  }
  if (kind === 'task') {
    const task = store.getTask(target)
    return memberByName(task && task.owner)
  }
  if (typeof target === 'string' && target.includes('.md')) {
    const doc = store.getDoc(target) || store.listDocs().find((row) => row.path === target)
    return memberByName(doc && doc.owner)
  }
  return memberByName(target)
}

/**
 * 造**派生态待办清单**喵（FIX-29）喵：未结任务 / 审计红黄 / 缺失产出，每项带 `path` 可定位。
 *
 * 与 `audit_scan` **同源**（直接吃它的 `items`，不另算一套口径）；排序按紧迫度：
 * 红 → 缺失产出 → 其它黄 → 未结任务喵。
 *
 * FIX-30：每条**能定位到成员就把 `sessionId` 带上**（面板据此"点行跳会话"）喵。
 *
 * 这块清单是**派生物**：面板只读、可重建，绝不是"待办的真相"（真相在人的待办文件里）喵。
 */
export function buildTodos({ store, project, audit, archivedOwners = null }) {
  const rank = (row) => {
    if (row.level === 'red') return 0
    if (row.kind === 'missing_doc') return 1
    if (row.kind === 'audit') return 2
    return 3
  }
  const rows = []
  for (const task of store.listTasks()) {
    if (!isOpenTask(task)) continue
    // FIX-101：**源自归档对话的任务不进待办**（用户归档 = 这些不用管了）喵
    if (archivedOwners && task.owner && archivedOwners.has(String(task.owner))) continue
    rows.push({
      kind: 'task',
      level: 'yellow',
      title: `未结任务 ${task.taskId}（${task.status || 'unknown'}）${task.deliverable ? `：${task.deliverable}` : ''}`,
      path: joinUnderRoot(project.tasksDir, `${task.taskId}.md`),
      sessionId: sessionOfTarget({ store, target: task.taskId, kind: 'task' }),
    })
  }
  for (const item of (audit && audit.items) || []) {
    const kind = item.check === 'missing_doc' ? 'missing_doc' : 'audit'
    rows.push({
      kind,
      level: item.level,
      check: item.check,
      title: `[${item.check}] ${item.detail}`,
      path: item.target,
      sessionId: sessionOfTarget({ store, target: item.target, kind }),
    })
  }
  return rows.sort((a, b) => rank(a) - rank(b))
}

/**
 * 造一份面板快照喵（纯函数，便于单测）喵。
 *
 * 徽章按**成员名**归并（`members`，退化路径）并另建**按 sessionId 的主索引**（`membersById`）——
 * 面板侧优先按 `sessionId` 取用，取不到才按名退化并告警（FIX-17）喵。
 * 三档/进度这类需要持续观察的项也一并算出来——M4 接真审计后它们不再恒为 unknown喵。
 * 审计**清单**（路径 + 原因 + 建议）随快照下发，面板据此渲染红黄摘要与可展开条目（FIX-21）喵。
 */
export function buildPanelSnapshot({ store, project, audit, now = new Date().toISOString(), archivedOwners = null }) {
  const tiersByTask = new Map()
  for (const doc of store.listDocs()) {
    if (!doc || !doc.taskId) continue
    if (!tiersByTask.has(doc.taskId)) tiersByTask.set(doc.taskId, new Set())
    if (Number(doc.tier) >= 1 && Number(doc.tier) <= 3) tiersByTask.get(doc.taskId).add(Number(doc.tier))
  }
  const items = (audit && audit.items) || []
  const byTarget = new Map()
  for (const item of items) {
    if (!byTarget.has(item.target)) byTarget.set(item.target, [])
    byTarget.get(item.target).push(item)
  }

  const archivedSet = normalizeArchivedSet(project.archivedSessionIds)
  const members = {}
  // FIX-17：按 `sessionId` 建**主索引**喵。同名成员（如多轮 `T99-冒烟测试-reviewer`）按名归并会互相覆盖，
  // 只留最后一条 → 所有同名节点共享同一份徽章、旧会话 id 丢失（核验报告 FIX-27 实测）喵。
  // `members`（按名）保留作**退化路径**，但 client 优先吃 `membersById`，退化时必须给 warning 喵。
  const membersById = {}
  const build = (member, name) => {
    const index = name.lastIndexOf('-')
    const taskId = index > 0 ? name.slice(0, index) : null
    const tiers = taskId ? tiersByTask.get(taskId) : null
    const own = byTarget.get(name) || []
    const taskDocs = taskId ? store.listDocs().filter((doc) => doc.taskId === taskId) : []
    return {
      sessionId: member.id || null,
      name,
      role: member.role || null,
      taskId,
      // FIX-73：**成员投影不能丢字段** —— 客户端 `deriveMode(row, info)` 要看 `info.mode`，
      // 丢了就退化成"前台/未知"，于是"后台（可续派/可唤醒）"的常驻角色（如图书管理员）在面板上
      // 看起来像**非长期性 agent**（真机原话）。这里把面板要用的字段一并投影出去喵
      mode: member.mode || null,
      status: member.status || null,
      model: member.model || null,
      route: member.route || null,
      derived: member.derived === true,
      // FIX-84 ④：用户**归档掉的会话**在面板上打标（别混进"活动"观感）喵
      // FIX-90：**归一化 + 按父链上溯**（归档的常是父会话；两侧 id 形态还不一致）喵
      archived: archivedViaChain({
        member, members: store.listMembers(), archived: archivedSet,
      }).archived,
      // FIX-86：面板按**角色形态**适配（三档/进度/异源 该显示"不适用"而不是 ✗）——
      // 形态来自 `ROLE_META`（与审计**同一份声明**，单一来源 —— 面板与审计不许各判一套）喵
      deliverableKinds: deliverableKindsOf(member.role),
      capabilities: capabilitiesOf(member.role),
      lastActiveAt: member.lastActiveAt || null,
      badges: {
        // 契约徽章：台账里有该成员记录即视为注入过契约（derived 的是从磁盘推导出来的，不算）
        contract: member.derived ? 'unknown' : 'ok',
        // 三档：该任务是否凑齐 L1/L2/L3
        docs: tiers && tiers.size >= 3 ? 'ok' : (tiers && tiers.size > 0 ? 'warn' : 'missing'),
        // 进度：该任务有没有进度档
        progress: store.getTask(taskId) || taskDocs.length ? 'ok' : 'unknown',
        // 预算：该成员或他的档是否被审计判超限
        budget: own.some((item) => item.check === 'over_budget') ? 'warn' : 'ok',
        // 异源：审计的 cross_vendor 判定（命中即非真异源）喵。
        // **FIX-59**：光看"没命中"就报 ok 是**"没报=合格"的谬误**（真机上这条检查长期是哑的，
        // 于是所有对抗审查都显示 ✓ 合格）——命中观察项 `cross_vendor_undecidable` 时必须给
        // `unknown`（"无法判定"），**只有真判过且没判出同源**才是 ok 喵
        crossVendor: member.role === 'adversary'
          ? (own.some((item) => item.check === 'cross_vendor')
            ? 'missing'
            : (own.some((item) => item.check === 'cross_vendor_undecidable') ? 'unknown' : 'ok'))
          : 'unknown',
      },
    }
  }
  for (const member of store.listMembers()) {
    const name = String(member.name || '')
    const entry = build(member, name)
    members[name] = entry
    if (member.id) membersById[String(member.id)] = entry
  }

  return {
    schemaVersion: PANEL_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    // FIX-36：写入方**插件版本** —— 面板据此识别"陈旧快照"（字段缺了 / 旧版写的都别当成 0）喵
    pluginVersion: pluginVersion(),
    // FIX-97 ①：**进程里正在跑的版本**（= 模块加载时读到的那个）—— 与 pluginVersion（现读磁盘）一比就知道
    // 有没有"升级了但进程没重启"；面板据此明说「请完整重启应用」喵
    runtimeVersion: loadedVersion(),
    project: { name: project.name || '', root: project.root },
    // FIX-39：**没有审计数据就明写 placeholder**（面板显示"数据源待接"）——
    // 非审计触发的重写会沿用上一份的 audit 块并标 `asOf`，绝不用 `0 红 0 黄` 冒充"全绿"喵
    audit: audit
      ? {
        level: audit.level || 'green',
        red: (audit.counts ? audit.counts.red : 0) || 0,
        yellow: (audit.counts ? audit.counts.yellow : 0) || 0,
        // 这份审计结论"截至何时"（沿用旧结论时非空）喵
        asOf: audit.asOf || null,
        items: items.map((item) => ({
          check: item.check,
          level: item.level,
          target: item.target,
          detail: item.detail,
          // 建议动作与 humanReport 同源，避免两处口径漂移喵
          suggestion: SUGGESTIONS[item.check] || '由馆员核实后处理',
          // FIX-30：能定位到成员的行带上会话 id —— 面板据此"点行跳会话"喵
          sessionId: sessionOfTarget({ store, target: item.target, kind: item.check === 'missing_doc' ? 'missing_doc' : 'audit' }),
        })),
      }
      : {
        level: 'unknown', red: null, yellow: null, asOf: null, placeholder: true, items: [],
        // FIX-91 ② / FIX-95 ③ / FIX-96 ⑥：占位**不许是空白**，且要把"人自己那条路"与"求主代理"并列给出 ——
        // 文案抽成常量（`PANEL_PLACEHOLDER_ACTION`）：正常快照与"插件自检异常时的降级快照"必须同一句喵
        action: PANEL_PLACEHOLDER_ACTION,
      },
    counts: {
      members: store.listMembers().length,
      tasks: store.listTasks().length,
      docs: store.listDocs().length,
    },
    // FIX-29：待办清单（派生态）+ 待办原文的绝对路径（client 拿不到项目根，只能由 host 告诉它）喵
    todos: buildTodos({ store, project, audit, archivedOwners }),
    paths: { todoFile: (project.panel && project.panel.todoFile) || null },
    // FIX-82：自适应推导的说明（"布局已重探"/"重探失败"）也带出去 —— 面板 tooltip 直接显示喵
    notes: Array.isArray(project.notes) ? project.notes : [],
    // FIX-61：结构缺失时给面板一句"尚未初始化 + 调 project_init"（结构齐 ⇒ null，不占版面）喵
    projectHint: (missingStructure({ project }) || {}).hint || null,
    members,
    membersById,
  }
}

/**
 * 占位时给面板看的**动作文案**喵（FIX-91 ② / FIX-95 ③ / FIX-96 ⑥）—— host 与"降级快照"共用同一句喵。
 */
export const PANEL_PLACEHOLDER_ACTION = '尚无审计结论 —— **下一步二选一：① 点面板上的「强制刷新」（= 跑一次审计并重写面板数据）'
  + '② 让主代理跑一次 `audit_scan`（或派一次活）**；「↻ 刷新」只重读文件、救不回陈旧的快照，是次选。'
  + '面板数据是**有动作时**才重算的；**重启**只在"快照由旧版插件写入"时自动补写一次，不会重算结论喵'

/**
 * 把"**插件自检异常**"写进快照喵（FIX-97 ③）喵 —— 典型场景：台账领域打不开（老记录不合新 schema）⇒
 * 面板同步器**根本没挂上**，快照从此不再重写。而面板只读文件、拿不到宿主端异常 ⇒
 * 不写进去，用户看到的就只是"数据不新鲜"，**看不到为什么**（真机上"所有契约工具一起废"就是这么个黑洞）✗。
 *
 * 纪律：**只动 `notes` 与 `setupError`，数据字段一律原样保留** —— 台账没了也不许把已有数据抹掉喵。
 * @returns `{ path, ok, error? }`喵。
 */
export async function annotatePanelSnapshot({ project, error, now = new Date().toISOString() }) {
  const path = panelSnapshotPath(project)
  const message = String((error && error.message) || error || '未知原因')
  let previous = null
  try {
    previous = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    previous = null
  }
  const base = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous
    : {
      schemaVersion: PANEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: now,
      pluginVersion: pluginVersion(),
      runtimeVersion: loadedVersion(),
      project: { name: (project && project.name) || '', root: project && project.root },
      counts: {},
      audit: { level: 'unknown', red: null, yellow: null, asOf: null, placeholder: true, items: [], action: PANEL_PLACEHOLDER_ACTION },
      members: {},
      membersById: {},
      todos: null,
      paths: { todoFile: (project && project.panel && project.panel.todoFile) || null },
    }
  const note = `插件自检异常：${message}（快照不会自动重写；请**完整重启应用**，只刷新窗口/页面不算）`
  const notes = (Array.isArray(base.notes) ? base.notes : []).filter((row) => !String(row).startsWith('插件自检异常：'))
  notes.push(note)
  const next = { ...base, notes, setupError: { message, at: now } }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return { path, ok: true }
  } catch (writeError) {
    return { path, ok: false, error: String((writeError && writeError.message) || writeError) }
  }
}

/**
 * 把面板快照落盘喵（**派生写**：失败只警告，绝不影响审计/台账主流程）喵。
 * @returns `{ path, ok, error? }`喵。
 */
export async function writePanelSnapshot({ store, project, audit, now = new Date().toISOString(), archivedOwners = null }) {
  const path = panelSnapshotPath(project)
  try {
    const snapshot = buildPanelSnapshot({ store, project, audit, now, archivedOwners })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return { path, ok: true }
  } catch (error) {
    return { path, ok: false, error: String(error && error.message ? error.message : error) }
  }
}
