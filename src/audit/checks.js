/**
 * 审计检查项实现喵（DESIGN §5.7 / M4 交付物 1）喵。
 *
 * **铁律：审计只报不拦**喵 ——
 * 本模块**绝不写文件、绝不抛错阻断流程**；判定为"该修"的只写进结果，交给馆员去修喵。
 * 唯一的例外是**配置错误**：未知的 `audit.checks` 项必须当场报错，否则"配置写错却以为在查"喵。
 */
import { existsSync } from 'node:fs'
import { analyzeFrontMatter, classifyLength, countChars, parseFrontMatter } from '../ledger/docmeta.js'
import { listMarkdown, listMarkdownDeep, readFileIfPresent } from '../ledger/fs.js'
import { readFile, readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { findMisfiled } from '../ledger/placement.js'
import { buildContract } from '../contract/assemble.js'
import { findUnfilledSlots } from '../contract/mandate.js'
import { isOpenTask, OPEN_TASK_STATUSES } from '../ledger/state.js'
// FIX-64 / FIX-68：任务文件 = 子代理的作业登记卡（字段校验 + 占用冲突）喵
import { isActiveStatus, normalizeOccupancyPath, occupancyConflicts, parseTaskCard } from '../ledger/taskcard.js'
// FIX-99 ④：全局共享文件清单（跨会话并存的常驻实例会写同一批）喵
import { globalSharedFiles } from '../librarian/globals.js'
// FIX-103 ④：类别索引的缺口判据 + 与 doc_census **同一份**普查数据喵
import { kindIndexGaps } from '../librarian/indexes.js'
import { documentCensus } from '../ledger/census.js'
// FIX-70：渐进式披露的两条审计判据喵
import { dirtyRelatedPaths, missingProgressiveLink } from '../ledger/progressive.js'
// FIX-69：格式类判据（类型后缀与目录是否一致 / 非 .md / ^ 前缀）与临时目录提示喵
import { scanDocAreas, tempDirHint } from '../ledger/docarea.js'
import { KIND_SUFFIXES, kindFromFileName } from '../ledger/naming.js'
import { archivedViaChain, normalizeArchivedSet } from './archived.js'
// FIX-85：产出形态来自**角色元数据表**（唯一来源，与面板/编排共用）喵
import { deliverableKindsOf, isBookkeepingRole } from '../contract/roles.js'
import { joinUnderRoot } from '../project.js'

/** 每项检查的默认严重度（红=必须处理，黄=该处理）喵。 */
export const CHECK_LEVELS = {
  missing_doc: 'red',
  ghost_run: 'red',
  orphan_task: 'red',
  over_budget: 'yellow',
  unfilled_slot: 'yellow',
  stale_progress: 'yellow',
  cross_vendor: 'yellow',
  unreleased_run: 'yellow',
  doc_misfiled: 'yellow',
  doc_meta_missing: 'yellow',
  doc_tags_stale: 'yellow',
  archive_suggest: 'yellow',
  // FIX-68：并发占用冲突（**声明层面**；写写冲突那条按 red 报，见实现里的 level 覆盖）喵
  occupancy_conflict: 'yellow',
  // FIX-70：渐进式披露 —— 缺指向 L1 的下钻指针 / relatedFiles 里有脏路径喵
  // FIX-69：格式类 —— 类型后缀与目录不符 / 类目录里有非 .md / 文件名还带 ^ 前缀喵
  doc_kind_mismatch: 'yellow',
  stray_non_md: 'yellow',
  // FIX-71：记录与磁盘不一致 —— 两条都**只报不删**（台账可重建；删除不可逆）喵
  task_file_missing: 'red',
  doc_file_missing: 'yellow',
  // FIX-77：legacy 档的「待归档」标注（缺 ⇒ 黄）喵
  legacy_archive_pending: 'yellow',
  // FIX-85 ③：簿记类角色干过活却**没留痕**（它的完成判据是留痕）喵
  bookkeeping_untraced: 'yellow',
  legacy_caret: 'yellow',
  // FIX-100 ①：绕过契约派出去的子代理（会话树里有、台账里没有）—— 警告制报黄喵
  uncontracted_dispatch: 'yellow',
  // FIX-103 ④：类别非空但缺索引 / 索引与磁盘不符 ⇒ 黄（建议跑一轮索引重建）喵
  missing_kind_index: 'yellow',
  // FIX-105 ⑥：有头但内容键全空的"全 null 头"（真机积了 126+ 处）⇒ 黄，建议清掉（留痕归台账）喵
  null_frontmatter: 'yellow',
  // FIX-110 ④：**正文标题行**以 ^ 开头（真机 39 篇）⇒ 黄，跑一轮治理去前缀喵
  body_caret_title: 'yellow',
  missing_progressive_link: 'yellow',
  dirty_related_path: 'yellow',
}

/** 全部检查项 id（config 里写别的名字必须报错）喵。 */
export const CHECK_IDS = Object.keys(CHECK_LEVELS)

/**
 * **观察项**喵（FIX-30）喵：只记录、不告警喵。
 *
 * 与检查项的区别（三点都要守住）喵：
 * ① **不进 `audit.checks` 开关**（观察是"顺带看一眼"，不该逼每份配置都去列它）；
 * ② `level: 'info'`，**不计入红黄计数、不影响 level**（所以全绿仍是绿）；
 * ③ 不配建议动作（`SUGGESTIONS` 只说"该怎么办"，观察项没有"该办"的事）喵。
 */
export const OBSERVATION_LEVEL = 'info'

/** 观察项 id 列表喵（与检查项刻意分开，免得有人把它们当告警）喵。 */
export const OBSERVATION_IDS = ['doc_overwritten', 'cross_vendor_undecidable', 'task_card_incomplete']

/**
 * 观察项实现喵：**同一路径被覆盖过几次**（同名重发）——仅记录，不告警喵。
 *
 * 数据源是台账里 `doc.overwriteCount` / `lastBackupPath`（由 `doc_emit` / `bugfix_note` 写入，FIX-30）喵。
 */
const OBSERVATION_IMPLEMENTATIONS = {
  doc_overwritten: ({ store }) => store.listDocs()
    .filter((doc) => Number(doc.overwriteCount) > 0)
    .map((doc) => ({
      target: doc.path,
      detail: `同名重发覆盖过 ${doc.overwriteCount} 次`
        + (doc.lastBackupPath ? `；最近一次旧版备份：${doc.lastBackupPath}` : '') ,
    })),

  /**
   * **异源判定缺数据**喵（FIX-59）喵：`cross_vendor` 的判据是"两边都有模型名且相同"，
   * 缺任一侧时它**什么都不报** —— 而"没报"极易被读成"合格"（真机就是这样：
   * 6 条成员 `model` 全 null ⇒ 这条审计在真机上完全是哑的）喵。
   *
   * 所以把"哑"本身变成一个**可见的事实**：只有**确实派过对抗审查**（存在 adversary 成员）时才提示，
   * 且用 `level: 'info'` 记录（不告警、不计红黄），措辞明确是"无法判定"，绝不写成"通过"喵。
   */
  /**
   * FIX-64：**作业登记卡缺必备字段**喵。
   *
   * 任务文件是子代理**自己的作业登记卡**（上级 / 占用文件或资源 / 状态 / 阶段产出 / 异常）。
   * 交付时该齐；缺了就记一行 —— `level: 'info'`（"该补一下"，不是"出事了"），不告警、不计红黄喵。
   * 卡**根本不存在**时也给一行（派单时不必存在、交付时该有）喵。
   */
  task_card_incomplete: async ({ project, readTaskFile = readFile }) => {
    if (!project || !project.tasksDir) return []
    return loadTaskCardHints({ project, read: readTaskFile })
  },

  cross_vendor_undecidable: ({ store }) => {
    const members = store.listMembers()
    const implementers = members.filter((member) => member.role === 'implementer')
    const rows = []
    for (const adversary of members.filter((member) => member.role === 'adversary')) {
      const own = modelOfMember(adversary)
      const peers = comparableImplementers(members, adversary)
      const known = peers.filter((peer) => modelOfMember(peer))
      const names = peers.map((peer) => peer.name).join('、') || '(无)'
      if (!peers.length) {
        rows.push({
          target: adversary.name,
          detail: '无法判定（缺模型数据）：找不到可比的实现者记录（同任务下没有 implementer），'
            + '"异源"既不能算成立也不能算不成立',
        })
        continue
      }
      if (!own && !known.length) {
        rows.push({
          target: adversary.name,
          detail: `无法判定（缺模型数据）：对抗审查与实现者（${names}）的模型都未知 ⇒ 无法比较 ⇒ `
            + '**这一条"没报"不代表合格**（模型未记录，见 FIX-59）',
        })
        continue
      }
      if (!own) {
        rows.push({
          target: adversary.name,
          detail: `无法判定（缺模型数据）：对抗审查自身模型未知（实现者一侧有：`
            + `${known.map((peer) => `${peer.name}=${modelOfMember(peer)}`).join('、')}）`,
        })
        continue
      }
      if (!known.length) {
        rows.push({
          target: adversary.name,
          detail: `无法判定（缺模型数据）：实现者（${names}）的模型都未知（对抗审查一侧是 ${own}）`,
        })
      }
    }
    return rows
  },
}

/** 跑一遍全部观察项，返回 `level: 'info'` 的 items喵（任何一项炸了都不许带塌审计）喵。 */
export async function collectObservations({ store, project, readTaskFile = readFile } = {}) {
  const items = []
  for (const id of OBSERVATION_IDS) {
    try {
      for (const row of await OBSERVATION_IMPLEMENTATIONS[id]({ store, project, readTaskFile })) {
        items.push({ check: id, level: OBSERVATION_LEVEL, target: row.target, detail: row.detail })
      }
    } catch {
      /* 观察项失败就跳过：它本来就只有参考价值，更不该影响审计结论喵 */
    }
  }
  return items
}

/** 进度档字数上限（总纲 §2）喵。 */
const PROGRESS_MAX_CHARS = 400

/** 元数据写入与文件 mtime 的容差，用来吸收写盘时序喵。 */
const MTIME_TOLERANCE_MS = 2000

/** 归档建议默认阈值：档龄超过这么多天且任务已结 → 建议归档喵。 */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 90

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)

/** 该任务的档级集合喵。 */
function tiersByTask(store) {
  const map = new Map()
  for (const doc of store.listDocs()) {
    if (!doc || !doc.taskId) continue
    if (!map.has(doc.taskId)) map.set(doc.taskId, new Set())
    if (Number(doc.tier) >= 1 && Number(doc.tier) <= 3) map.get(doc.taskId).add(Number(doc.tier))
  }
  return map
}

/** 安全取成员名里的 taskId喵。 */
function taskIdOfMember(name) {
  const value = String(name ?? '')
  const index = value.lastIndexOf('-')
  return index > 0 ? value.slice(0, index) : null
}

/**
 * 装配每个成员的契约（只读），供 `unfilled_slot` / `over_budget` 用喵。
 * 装配失败（例如 taskId 非法）只跳过该成员，绝不让审计整体失败喵。
 */
export async function collectContracts({ store, project, config }) {
  const rows = []
  const members = store.listMembers()
  // 总 Agent 数按台账成员数 + 主代理估；只是契约里的一个槽位取值，审计不追求精确喵
  const totalAgents = members.length + 1
  for (const member of members) {
    const taskId = taskIdOfMember(member.name)
    if (!taskId || !member.role) continue
    try {
      const contract = await buildContract({
        config, project, roleId: member.role, task: { id: taskId }, parent: member.parent || '主代理',
        layer: member.layer, totalAgents,
      })
      rows.push({
        target: `${member.name}（${taskId}）`,
        text: contract.text,
        segments: contract.segments,
        slotValues: [project.progressDir, project.tasksDir, project.deliverablesDir],
      })
    } catch {
      /* 装配不了就跳过——审计不该因为一条坏成员记录整体失败喵 */
    }
  }
  return rows
}

/** ① missing_doc：已结束的成员，其任务在产出目录找不到任何三档档喵。 */
/**
 * ① missing_doc：**按角色的产出形态**判"该交的没交"（FIX-85）喵。
 *
 * 用户原话：「有些类型的 agent 不需要三档文件，比如 librarian」——真机 `missing_doc` 9 条里
 * **8 条是 librarian**（簿记角色本就不产出三档）⇒ 产出形态是**角色属性**，不是全局一刀切喵。
 * 规则：角色声明里**没有** `three-tier` / `research` / `report` 任一项 ⇒ **一律不报**（宁漏报不误报）；
 * 声明了多项 ⇒ **任一合法形态存在即通过**（researcher 交了研究档就算过）喵。
 */
async function checkMissingDoc({ store, project }) {
  const tiers = tiersByTask(store)
  const items = []
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    if (member.status !== 'completed' && member.status !== 'released') continue
    const kinds = deliverableKindsOf(member.role)
    const needsDoc = kinds.some((kind) => ['three-tier', 'research', 'report'].includes(kind))
    if (!needsDoc) continue // 簿记类（librarian）**无文档要求** ⇒ 不报（完成判据改看留痕）喵
    const taskId = taskIdOfMember(member.name)
    const found = taskId ? tiers.get(taskId) : null
    if (found && found.size > 0) continue
    // FIX-107 ①：统一判据（台账 + **扫全部类别目录** + 按形态认）—— 三档不是唯一合法形态，
    // 研究档 / 报告档这些**不进台账**的类别也得认出来（只查台账会把"交过"判成"没交"）✗ 喵
    const hasAny = await hasAnyDeliverable({ store, project, taskId, role: member.role, kinds })
    if (hasAny) continue
    items.push({
      target: member.name,
      detail: `成员已 ${member.status}，但任务 ${taskId || '(未知)'} 没有任何它该交的产出`
        + `（该角色声明的产出形态：${kinds.join(' / ') || '(未声明)'}）`,
    })
  }
  return items
}

/**
 * **该任务到底有没有产出**喵（FIX-107）喵 —— `missing_doc` 与 `ghost_run` **共用**这一个判据喵。
 *
 * 为什么不能只看 `latestDeliverable` / 只看台账：台账只含产出档 / 任务 / 进度（真机口径），
 * 研究 / 审查 / 整合清单 / 坑 / 修改 / 核心数据库这些**不进台账** ⇒ 只查台账会把"交过研究档"误判成"没交" ✗。
 *
 * 判据（三路并查，任一命中即算有产出）喵：
 * ① **角色产出形态豁免**：`bookkeeping`（簿记类）**没有文档产出义务** ⇒ 直接算过；
 * ② **台账**：该 `taskId` 下的文档记录（三档 `tier 1~3`、研究档、报告档按形态认）；
 * ③ **磁盘**：扫**全部类别目录**，按 `<taskId>_` 前缀 + 形态后缀认（`_L1/_L2/_L3` · `_研究` · `_审查` / `_整合清单`）；
 *    `latestDeliverable` 只是**其中一条**线索，不是唯一依据喵。
 *
 * @returns `true` = 有产出（不该报）；`false` = 三路都查不到（该报）喵。
 */
export async function hasAnyDeliverable({ store = null, project = null, taskId = null, role = null, kinds = null } = {}) {
  const forms = Array.isArray(kinds) ? kinds : (role ? deliverableKindsOf(role) : [])
  // ① 簿记类：它的完成判据是**留痕**，不是交档（FIX-85 口径）—— 豁免喵
  if (forms.includes('bookkeeping')) return true
  const id = String(taskId || '').trim()
  if (!id) return false
  const wantThreeTier = !forms.length || forms.includes('three-tier')
  const wantResearch = forms.includes('research')
  const wantReport = forms.includes('report')
  const nameMatches = (base) => {
    const name = String(base || '')
    if (!name.startsWith(`${id}_`)) return false
    if (!forms.length) return true
    if (wantThreeTier && /_L[123]\.md$/i.test(name)) return true
    if (wantResearch && name.includes('_研究')) return true
    if (wantReport && (name.includes('_审查') || name.includes('_整合清单'))) return true
    return false
  }
  // ② 台账（含 `latestDeliverable` 这一条线索）
  const docs = store && typeof store.listDocs === 'function' ? store.listDocs() : []
  const own = docs.filter((doc) => doc && String(doc.taskId || '') === id)
  if (own.some((doc) => Number(doc.tier) >= 1 && Number(doc.tier) <= 3)) return true
  if (own.some((doc) => nameMatches(String(doc.path || '').replace(/\\/g, '/').split('/').pop()))) return true
  const members = store && typeof store.listMembers === 'function' ? store.listMembers() : []
  if (members.some((member) => member && member.latestDeliverable && String(member.latestDeliverable).includes(id))) return true
  // ③ 磁盘：**全部类别目录**（不只 docsDirs —— 类别按 docKinds 认，产出根也要算）喵
  const dirs = [
    ...Object.values((project && project.docKinds) || {}),
    ...((project && project.docsDirs) || []),
    project && project.deliverablesDir,
  ].filter(Boolean)
  for (const dir of [...new Set(dirs)]) {
    let names = []
    try {
      names = await listMarkdownDeep(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const base = String(name).replace(/\\/g, '/').split('/').pop() || ''
      if (nameMatches(base)) return true
    }
  }
  return false
}

/**
 * 该任务下有没有"研究档 / 报告档"这类**非三档**的合法产出喵（保留旧入口，内部走统一判据）喵。
 */
async function hasKindDocForTask({ store, project, taskId, kinds }) {
  return hasAnyDeliverable({ store, project, taskId, kinds })
}

/** ② over_budget：文档超长（三级强警告 / 二一级 oversize）或契约片段超预算喵。 */
function checkOverBudget({ store, contracts }) {
  const items = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy) continue
    const verdict = classifyLength(doc.tier, doc.chars)
    if (verdict.level === 'ok') continue
    items.push({ target: doc.path, detail: verdict.message })
  }
  for (const contract of contracts) {
    for (const segment of contract.segments) {
      if (segment.level === 'ok') continue
      items.push({
        target: contract.target,
        detail: `契约片段 ${segment.id} ${segment.level}：${segment.chars} 字（软 ${segment.soft} / 硬 ${segment.hard}）`,
      })
    }
  }
  return items
}

/** ③ unfilled_slot：契约里残留未替换的槽位（剔除已替换取值，避免真实目录名误报）喵。 */
function checkUnfilledSlot({ contracts }) {
  const items = []
  for (const contract of contracts) {
    const leftover = findUnfilledSlots(contract.text, contract.slotValues)
    if (leftover.length) items.push({ target: contract.target, detail: `契约残留未填槽位：${leftover.join('、')}` })
  }
  return items
}

/** ④ stale_progress：进度档超 400 字，或最后更新早于成员最后活动喵。 */
async function checkStaleProgress({ store, project }) {
  const items = []
  const byTask = new Map()
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    const taskId = taskIdOfMember(member.name)
    if (taskId && !byTask.has(taskId)) byTask.set(taskId, member)
  }
  for (const [taskId, member] of byTask) {
    const file = await readFileIfPresent(joinUnderRoot(project.progressDir, `${taskId}.md`))
    const target = joinUnderRoot(project.progressDir, `${taskId}.md`)
    if (!file) {
      // 没有进度档不在这里报（那是 missing_doc 的口径），只报"有但不对"喵
      continue
    }
    const chars = countChars(file.text)
    if (chars > PROGRESS_MAX_CHARS) {
      items.push({ target, detail: `进度档超长：${chars} > ${PROGRESS_MAX_CHARS} 字` })
    }
    const lastActive = Date.parse(member.lastActiveAt || '')
    // **时间比较必须带容差**（FIX-32，实测回归）喵：
    // `member.lastActiveAt` 是**内存里的毫秒级挂钟**（`memberRecord` 默认 `new Date().toISOString()`），
    // 而 `file.mtime` 来自文件系统、精度可能被**截断**（FAT 2s、某些挂载/网络盘/drvfs 只到秒）——
    // 于是"刚写完的进度档" mtime 反而可能早于 lastActiveAt 几百毫秒 → **假报 stale**；
    // 夹具 T-602（成员先建、进度档后写）正是踩在这条上，端到端跑会随机变红喵。
    // 这与 `doc_tags_stale` 的 `MTIME_TOLERANCE_MS`（第 82 行）是同一套口径，两个同类判据不得一个有容差一个裸比喵。
    if (Number.isFinite(lastActive) && file.mtime + MTIME_TOLERANCE_MS < lastActive) {
      items.push({ target, detail: `进度档最后更新 ${iso(file.mtime)} 早于成员最后活动 ${member.lastActiveAt}（超出 ${MTIME_TOLERANCE_MS}ms 容差）` })
    }
  }
  return items
}

/**
 * 取一个成员的**实际模型名**喵（FIX-59）喵。
 *
 * **只用 `model`，不再拿 `route` 顶替**：`route` 是**路由名**（内置角色卡里 adversary 的路由名就叫
 * `adversary`），把它当模型名比 ⇒ 两边永远不同 ⇒ "异源"看起来永远成立。那不是"合格"，
 * 那是**拿不相干的数据凑出了一个永远通过**（真机实锤：6 条成员 `model` 全 null，这条审计是哑的）喵。
 * 取不到就返回 null，**未知就是未知**，由观察项 `cross_vendor_undecidable` 明说"无法判定"喵。
 */
export function modelOfMember(member) {
  const model = member && member.model
  return typeof model === 'string' && model.trim() ? model.trim() : null
}

/** 同任务下的可比实现者（找不到同任务的才退回全体）喵。 */
function comparableImplementers(members, adversary) {
  const taskId = taskIdOfMember(adversary.name)
  const sameTask = members.filter((member) => member.role === 'implementer'
    && taskId !== null && taskIdOfMember(member.name) === taskId)
  return sameTask.length ? sameTask : members.filter((member) => member.role === 'implementer')
}

/**
 * ⑤ cross_vendor：adversary 的模型与 implementer 相同（= 非真对抗）喵。
 *
 * **判据是"两边都有实际模型名且相同"**（FIX-59）喵：缺任一侧 ⇒ 这里**不报**（无从判定），
 * 但"不报"不等于"合格" —— 缺数据的情形由观察项 `cross_vendor_undecidable` 明写出来喵。
 */
function checkCrossVendor({ store }) {
  const members = store.listMembers()
  const items = []
  for (const adversary of members.filter((member) => member.role === 'adversary')) {
    const own = modelOfMember(adversary)
    if (!own) continue
    for (const peer of comparableImplementers(members, adversary)) {
      const peerModel = modelOfMember(peer)
      if (peerModel && peerModel === own) {
        items.push({
          target: adversary.name,
          // FIX-59：把**两边各自的模型名**都写出来（验收②）——只说"相同"看不出拿什么比的喵
          detail: `对抗审查用的是 ${own}，同任务的实现者 ${peer.name} 用的也是 ${peerModel} ⇒ 非真异源`,
        })
        break
      }
    }
  }
  return items
}

/** ⑥ ghost_run：one-shot 节点跑完却没有落档喵。 */
async function checkGhostRun({ store, project }) {
  const items = []
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    if (member.mode !== 'one-shot') continue
    if (member.status !== 'completed' && member.status !== 'released') continue
    const taskId = taskIdOfMember(member.name)
    /**
     * FIX-107 ②：**不许再拿 `latestDeliverable` 当"没落档"的唯一依据**喵 ——
     * 统一判据 `hasAnyDeliverable()`：① 簿记类豁免 ② 台账（含 latestDeliverable 这条线索）
     * ③ **扫磁盘全部类别目录**（研究档 / 报告档这些**不进台账**的类别也能认出来）喵。
     */
    const has = await hasAnyDeliverable({
      store, project, taskId, role: member.role,
    })
    if (has) continue
    items.push({
      target: member.name,
      detail: `一次性节点已结束但没有落档（跑完即释放，产出已不可追；已查：台账 + 各类别目录${taskId ? `，任务 ${taskId}` : '（任务号判不出）'}）`,
    })
  }
  return items
}

/** ⑦ orphan_task：成员已 released 但任务未结喵。 */
function checkOrphanTask({ store }) {
  const items = []
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    if (member.status !== 'released') continue
    const taskId = taskIdOfMember(member.name)
    if (!taskId) continue
    const task = store.getTask(taskId)
    if (task && isOpenTask(task)) {
      items.push({ target: member.name, detail: `成员已释放，但任务 ${taskId} 仍是 ${task.status}（未结）` })
    }
  }
  return items
}

/** ⑧ unreleased_run：有活动但状态没走到 released（缺释放记录）喵。 */
function checkUnreleasedRun({ store }) {
  const items = []
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    if (member.status !== 'completed' && member.status !== 'failed') continue
    // FIX-79 ⑤：**常驻单例**（名字里没有任务号 + continuable，如 `librarian`）按设计就是长期活着的 ——
    // 它每干完一轮都会是 completed，拿"未释放"去判它是**误报**喵
    if (member.mode === 'continuable' && !taskIdOfMember(member.name)) continue
    items.push({ target: member.name, detail: `成员已 ${member.status} 但没有释放记录（status 未置 released）` })
  }
  return items
}

/** ⑨ doc_misfiled：文档不在规定类目录 / docs 根有散档（**只报不动**，M2.5 已实现，勿回退）喵。 */
async function checkDocMisfiled({ project }) {
  const rows = await findMisfiled({ project })
  return rows.map((row) => ({ target: row.path, detail: row.reason }))
}

/** ⑩ doc_meta_missing：缺 front-matter / 固定小节；legacy 与 tier=0 不参与喵。 */
function checkDocMetaMissing({ store }) {
  const items = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy || Number(doc.tier) === 0) continue
    if (!Array.isArray(doc.missingSections) || doc.missingSections.length === 0) continue
    items.push({ target: doc.path, detail: `缺固定小节：${doc.missingSections.join('、')}` })
  }
  return items
}

/**
 * 「关键词过期」的**唯一判据**喵（FIX-25 起导出去给馆员的 tags 步骤复用，免得两处口径漂移）喵。
 *
 * 判据：文件 mtime 晚于「front-matter 里最后一次元数据写入时间」（`createdAt` 与 `librarianTouchedAt` 取新者）
 * 超过容差 ⇒ 正文被改过而头部没动喵。
 */
export function isTagsStale({ meta, mtime }) {
  const created = Date.parse((meta && meta.createdAt) || '')
  const touched = Date.parse((meta && meta.librarianTouchedAt) || '')
  const lastMeta = Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(touched) ? touched : 0)
  return lastMeta > 0 && Number(mtime) - lastMeta > MTIME_TOLERANCE_MS
}

/**
 * ⑪ doc_tags_stale：正文改过但 keywords 没跟着更新喵。
 * 判据见 `isTagsStale()`；没有 keywords 的档不参与（无从谈"没更新"）喵。
 */
async function checkDocTagsStale({ store }) {
  const items = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy || Number(doc.tier) === 0) continue
    if (!Array.isArray(doc.keywords) || doc.keywords.length === 0) continue
    const file = await readFileIfPresent(doc.path)
    if (!file) continue
    const { meta } = parseFrontMatter(file.text)
    if (!meta) continue
    if (!isTagsStale({ meta, mtime: file.mtime })) continue
    const lastMeta = Math.max(
      Number.isFinite(Date.parse(meta.createdAt || '')) ? Date.parse(meta.createdAt || '') : 0,
      Number.isFinite(Date.parse(meta.librarianTouchedAt || '')) ? Date.parse(meta.librarianTouchedAt || '') : 0,
    )
    items.push({
      target: doc.path,
      detail: `正文在 ${iso(file.mtime)} 被改过，但 keywords 最后一次更新是 ${iso(lastMeta)} —— 复核关键词与同义词`,
    })
  }
  return items
}

/** ⑫ archive_suggest：档龄超阈值且所属任务已结 → **只建议**归档喵。 */
function checkArchiveSuggest({ store, config, now }) {
  const afterDays = Number(config && config.audit && config.audit.archiveAfterDays) > 0
    ? Number(config.audit.archiveAfterDays)
    : DEFAULT_ARCHIVE_AFTER_DAYS
  const cutoff = now - afterDays * 24 * 60 * 60 * 1000
  const items = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy) continue
    const stamp = Date.parse(doc.updatedAt || '')
    if (!Number.isFinite(stamp) || stamp > cutoff) continue
    const task = doc.taskId ? store.getTask(doc.taskId) : null
    const settled = !task || !OPEN_TASK_STATUSES.includes(task.status)
    if (!settled) continue
    items.push({
      target: doc.path,
      detail: `档龄超过 ${afterDays} 天且所属任务已结，建议移入 archive/<分片>/（分片策略见 DESIGN §5.5）`,
    })
  }
  return items
}

/** 检查项 id → 实现喵。 */
export const CHECK_IMPLEMENTATIONS = {
  missing_doc: checkMissingDoc,
  over_budget: checkOverBudget,
  unfilled_slot: checkUnfilledSlot,
  stale_progress: checkStaleProgress,
  cross_vendor: checkCrossVendor,
  occupancy_conflict: checkOccupancyConflict,
  doc_kind_mismatch: checkDocKindMismatch,
  stray_non_md: checkStrayNonMd,
  task_file_missing: checkTaskFileMissing,
  doc_file_missing: checkDocFileMissing,
  legacy_caret: checkLegacyCaret,
  uncontracted_dispatch: checkUncontractedDispatch,
  missing_kind_index: checkMissingKindIndex,
  null_frontmatter: checkNullFrontmatter,
  body_caret_title: checkBodyCaretTitle,
  legacy_archive_pending: checkLegacyArchivePending,
  bookkeeping_untraced: checkBookkeepingUntraced,
  missing_progressive_link: checkMissingProgressiveLink,
  dirty_related_path: checkDirtyRelatedPath,
  ghost_run: checkGhostRun,
  orphan_task: checkOrphanTask,
  unreleased_run: checkUnreleasedRun,
  doc_misfiled: checkDocMisfiled,
  doc_meta_missing: checkDocMetaMissing,
  doc_tags_stale: checkDocTagsStale,
  archive_suggest: checkArchiveSuggest,
}

/** ⑬ occupancy_conflict：两个**活跃**任务声明写同一路径（FIX-68）喵。 */
async function checkOccupancyConflict({ project, read = readFile, store = null }) {
  const cards = await loadTaskCards({ project, read })
  const rows = occupancyConflicts(cards).map((row) => ({
    target: `${row.a} ↔ ${row.b}`,
    detail: row.detail,
    // 写写冲突是真会互相覆盖 ⇒ 按 red 报（检查默认是 yellow，这里逐条覆盖）喵
    level: row.level,
  }))
  // FIX-99 ④：**同一角色多个活跃常驻实例**（跨会话）也算占用冲突 —— 宿主不给我们共享实例，
  // 那它们写的就是同一批全局文件（坑库索引 / 核心数据库 / 派生态索引 / 归档目录）⇒ 可能互相覆盖喵
  for (const row of residentOverlaps({ store, project })) rows.push(row)
  return rows
}

/**
 * 同一角色在本项目里有**多个活跃常驻实例**时，报一条占用冲突喵（FIX-99 ④）喵。
 *
 * 判据：`mode: continuable` + 状态不是"已收尾"（completed/released/retired/failed）+ 非 ledger 推导出来的记录，
 * 按 `role` 归并 ⇒ 超过 1 个就是跨会话并存喵。
 *
 * @returns `[{ target, detail, level }]`喵。
 */
export function residentOverlaps({ store = null, project = null } = {}) {
  if (!store || typeof store.listMembers !== 'function') return []
  const byRole = new Map()
  for (const member of store.listMembers()) {
    if (!member || member.derived === true) continue
    if (String(member.mode || '') !== 'continuable') continue
    const status = String(member.status || '')
    if (['completed', 'released', 'retired', 'failed', 'unknown'].includes(status)) continue
    const role = String(member.role || '')
    if (!role) continue
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(member)
  }
  const globals = project ? globalSharedFiles(project).map((row) => row.key).join(' / ') : ''
  const rows = []
  for (const [role, members] of byRole) {
    if (members.length < 2) continue
    rows.push({
      target: `常驻实例 ${role} × ${members.length}`,
      detail: `同一角色「${role}」在本项目有 ${members.length} 个**活跃常驻实例**（${members.map((m) => m.name).join('、')}）`
        + `—— 宿主不允许跨会话共享实例（跨会话投递会被拒），所以它们是各会话各一个；`
        + `它们写的是**同一批全局文件**${globals ? `（${globals}）` : ''} ⇒ 并发写会互相覆盖。`
        + '建议：**串行**派（让馆员排队）或先在作业登记卡的「占用文件或资源」段声明占用',
      // 跨会话并存本身不是错误（宿主逼的），但**同时写**会覆盖 ⇒ 按黄报，让主代理去串行喵
      level: 'yellow',
    })
  }
  return rows
}

/**
 * 提权申请是否覆盖某个"绕过契约派出去"的子会话喵（FIX-100 ②）喵。
 *
 * 覆盖规则（**写进工具描述与建议文案，别让人猜**）喵：
 * ① 提权记录要有 `sessionId`（提权者 = **派单方**会话），且等于该子会话的父会话；
 * ② `scope: 'task'` 时还要 `taskId` 对得上；
 * ③ 子会话必须**建在提权之后**（提权管不了它之前已经派出去的）；
 * ④ `until` 过期即失效；`scope: 'once'` 只覆盖**之后第一个**子会话（由调用方按序消费）喵。
 *
 * @returns 命中的提权记录（没命中返回 null）喵。
 */
export function escalationCovers(escalations = [], { session = null, now = Date.now(), consumed = null } = {}) {
  const created = Date.parse((session && session.createdAt) || '') || 0
  for (const row of escalations) {
    if (!row) continue
    const until = row.until ? Date.parse(row.until) : 0
    if (until && until < now) continue
    if (row.sessionId && String(row.sessionId) !== String((session && session.parentSession) || '')) continue
    if (row.scope === 'task' && row.taskId) {
      const label = String((session && session.label) || (session && session.id) || '')
      if (!label.includes(String(row.taskId))) continue
    }
    const at = Date.parse(row.createdAt || '') || 0
    if (at && created && created < at) continue
    if (row.scope === 'once' && consumed && consumed.has(String(row.createdAt))) continue
    return row
  }
  return null
}

/**
 * **`uncontracted_dispatch`**：会话树里有、台账里没有 ⇒ 绕过契约派出去的喵（FIX-100 ①）喵。
 *
 * 用户口径：「派出普通智能体（那 5 个之外的）**先提权申请**」—— 契约工具一旦不可用，主代理很容易改用
 * 宿主的普通派单绕过契约，而那条路**完全不留痕**：台账查不到、审计报不出、面板看不见 ✗。
 * 作用域内**有提权记录** ⇒ 标「已提权」（最多 info，不告警）；没有 ⇒ 报黄并给建议喵。
 */
function checkUncontractedDispatch({ store, sessions = null, archivedSessionIds = null, parentOf = null, now = Date.now() }) {
  const rows = Array.isArray(sessions) ? sessions : []
  if (!rows.length) return []
  const members = store.listMembers()
  const contracted = new Set(members.filter((member) => member && member.id).map((member) => String(member.id)))
  const escalations = typeof store.listEscalations === 'function' ? store.listEscalations() : []
  const consumed = new Set()
  const items = []
  for (const session of rows) {
    const id = String((session && session.id) || '')
    if (!id) continue
    if (contracted.has(id)) continue
    // 用户归档掉的会话 = 明确说"这些不用管了" ⇒ 与其它检查同口径跳过喵
    if (isArchivedMember({ id, name: id }, archivedSessionIds, members, parentOf)) continue
    const hit = escalationCovers(escalations, { session, now, consumed })
    if (hit) {
      if (String(hit.scope) === 'once') consumed.add(String(hit.createdAt))
      items.push({
        target: id,
        level: 'info',
        detail: `**已提权**：提权记录 ${hit.createdAt}（作用域 ${hit.scope}${hit.taskId ? ` / ${hit.taskId}` : ''}）：${hit.reason}`,
      })
      continue
    }
    items.push({
      target: id,
      detail: `会话树里有这个子代理会话（父会话 ${session.parentSession || '(未知)'}，建于 ${session.createdAt || '(未知时间)'}），`
        + '但台账里**没有它的契约派单记录** ⇒ 多半是绕过契约（宿主的普通派单）派出去的。'
        + '请走契约派单（`contract_delegate_*`）；**确需绕过请先调 `contract_request_escalation` 说明理由**',
    })
  }
  return items
}

/**
 * **`missing_kind_index`**：类别非空但没索引 / 索引条目数与磁盘不符喵（FIX-103 ④）喵。
 *
 * 数据源与 `doc_census`、各类索引**同一份**（`documentCensus()`）—— 三处不许各扫一遍盘喵。
 */
async function checkMissingKindIndex({ project, read = readFile, census = null }) {
  const data = census || await documentCensus({ project, read })
  const gaps = await kindIndexGaps({ project, census: data, read })
  return gaps.map((row) => ({ target: row.path, detail: `${row.kind}：${row.reason}`, level: CHECK_LEVELS.missing_kind_index }))
}

/**
 * **`null_frontmatter`**：有 front-matter 但**内容键全空**（只剩留痕）⇒ 黄喵（FIX-105 ⑥）喵。
 *
 * 为什么要有这条：真机上这种"全 null 头"积到 **126+ 处**却长期没人发现 —— 写侧修好之后，
 * 存量得**看得见**才清得掉；清掉之后再跑一轮治理**不许再产生**（写侧已有断言守着）喵。
 * 建议：用 `librarian_sweep`（收尾会自动清，dryRun 先给"将清 N 处"）喵。
 */
async function checkNullFrontmatter({ project, read = readFile }) {
  const rows = []
  const dirs = [
    ...Object.values((project && project.docKinds) || {}),
    project && project.tasksDir,
    project && project.progressDir,
  ].filter(Boolean)
  for (const dir of dirs) {
    let names = []
    try {
      names = await listMarkdownDeep(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const path = joinUnderRoot(dir, name)
      try {
        const text = await read(path, 'utf8')
        const info = analyzeFrontMatter(String(text))
        const base = String(path).split(/[\\/]/).pop() || ''
        // FIX-110 ②：**索引类文件不该有 front-matter** —— 它是派生物，带头只会误导阅读与工具喵
        if (info.hasHeader && (base === '索引.md' || base === 'README.md' || base === '派生态索引.md')) {
          rows.push({
            target: path,
            detail: '**派生物索引**却有 front-matter（索引内容由生成器负责，不该带头）—— 建议清掉那段头（留痕归台账）喵',
            level: CHECK_LEVELS.null_frontmatter,
          })
          continue
        }
        // FIX-110 ③ 的口径（**刻意不做成审计项**）：真机坑类 11 篇"主题名"老档是"既没头也没 legacy 标记"的中间态，
        // 但它与 FIX-105 的清理结果**形态完全相同**（清掉全 null 头之后也是"无头"）⇒ 做成审计项会变成永动机：
        // 清完头就报"无头"，催馆员补头，补出空头又被清 ✗✗。
        // 所以口径定为：**无头类别档 = 存量旧档，走 legacy 豁免**（不报），要补头由 `ledger_backfill --auto` 显式发起喵。
        if (info.hasHeader && info.strippable) {
          rows.push({
            target: path,
            detail: `有 front-matter 但**内容键全空**（只剩留痕）—— 这种头毫无意义，还让台账把它当正式文档档看`,
            level: CHECK_LEVELS.null_frontmatter,
          })
        }
      } catch {
        /* 单篇读不到就跳过喵 */
      }
    }
  }
  return rows
}

/**
 * 读任务目录下所有作业登记卡喵（读不到就跳过那一张，绝不让审计整体失败）喵。
 * @returns `[{ taskId, status, occupancies }]`（占用路径已归一化为绝对路径）喵。
 */
async function loadTaskCards({ project, read = readFile } = {}) {
  const dir = project && project.tasksDir
  if (!dir) return []
  let names = []
  try {
    names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const cards = []
  for (const name of names) {
    try {
      const text = await read(joinUnderRoot(dir, name), 'utf8')
      const parsed = parseTaskCard(text)
      cards.push({
        taskId: basename(name).replace(/\.md$/i, ''),
        status: parsed.fields['状态'] || '',
        occupancies: parsed.occupancies.map((row) => ({ ...row, path: normalizeOccupancyPath(project, row.path) })),
      })
    } catch {
      /* 单张卡读不到不影响其余喵 */
    }
  }
  return cards
}

/** FIX-64：缺必备字段（或卡还没建）的提示行喵（观察项用，绝不抛）喵。 */
async function loadTaskCardHints({ project, read = readFile } = {}) {
  const dir = project && project.tasksDir
  if (!dir) return []
  let names = []
  try {
    names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    try {
      const text = await read(joinUnderRoot(dir, name), 'utf8')
      const parsed = parseTaskCard(text)
      if (parsed.missing.length) {
        rows.push({
          target: basename(name).replace(/\.md$/i, ''),
          detail: `作业登记卡缺必备字段：${parsed.missing.join(' / ')} —— 补齐后本条不再出现喵`,
        })
      }
    } catch {
      /* 单张卡读不到不影响其余喵 */
    }
  }
  return rows
}

/** ⑭ missing_progressive_link：概括档缺"指向 L1"的下钻指针（FIX-70）喵。 */
async function checkMissingProgressiveLink({ store }) {
  const items = []
  for (const doc of store.listDocs()) {
    const tier = Number(doc.tier)
    // 三档文档才谈得上渐进式披露；legacy（无头部旧档）不参与（免得历史档刷屏）喵
    if (![1, 2, 3].includes(tier) || doc.legacy) continue
    // ⚠ `readFileIfPresent()` 返回 `{ text, mtime }`（不是字符串）—— 拿 `.text` 才是正文喵
    const found = await readFileIfPresent(doc.path)
    const text = found && typeof found.text === 'string' ? found.text : null
    if (!text) continue
    const { meta } = parseFrontMatter(text)
    if (!missingProgressiveLink({ tier, meta })) continue
    items.push({
      target: doc.path,
      detail: `L${tier} 档缺下钻指针（应写 ${tier === 1 ? '`detailLevel: full`' : '`fullDetail: <L1 绝对路径>`'}）`
        + ' —— 用 `doc_emit` 重发该档会自动补，或让馆员跑一轮治理喵',
    })
  }
  return items
}

/** ⑮ dirty_related_path：`relatedFiles` 里混进了脏路径（FIX-70）喵。 */
async function checkDirtyRelatedPath({ store }) {
  const items = []
  for (const doc of store.listDocs()) {
    for (const row of dirtyRelatedPaths(doc.relatedFiles)) {
      items.push({ target: doc.path, detail: `relatedFiles 里的脏路径「${row.path}」—— ${row.reason}，请改正为可解析的路径喵` })
    }
  }
  return items
}

/** ⑯ doc_kind_mismatch：文件名的**类型后缀**与它所在的**类型目录**不符（FIX-69）喵。 */
async function checkDocKindMismatch({ project, readdirImpl }) {
  const rows = await scanDocAreas({ project, readdirImpl })
  const items = []
  for (const row of rows) {
    if (row.nonMd) continue
    const declared = kindFromFileName(row.name)
    if (!declared || declared === row.kind) continue
    // FIX-72 ③：建议要给出**具体去向**（应放目录 + 正确文件名），别只说"挪一下"喵
    const targetDir = (project.docKinds || {})[declared] || ''
    const targetName = renameToKind(row.name, declared)
    items.push({
      target: row.path,
      detail: `文件名后缀说的是「${declared}」，但它躺在「${row.kind}」目录里`
        + (declared === '审查' || row.kind === '研究' || row.kind === '产出档' ? '（**审查报告落进研究/产出必报**）' : '')
        + (targetDir
          ? ` —— 应放：${targetDir}${declared === '产出档' ? '/L<n>' : ''}/${targetName || '<任务号>_<标题>_' + declared + '.md'}喵`
          : ` —— 项目没有「${declared}」目录，先让主代理调 project_init 建齐喵`),
    })
  }
  return items
}

/** 把一个文件名改成"与目标类型一致"的样子（`X_审查.md` → 目标类型是研究则 `X_研究.md`）喵。 */
function renameToKind(fileName, kind) {
  const name = String(fileName || '').replace(/\.md$/i, '')
  const declared = kindFromFileName(`${name}.md`)
  const suffix = KIND_SUFFIXES[declared]
  if (!suffix) return null
  return `${name.slice(0, name.length - suffix.length)}${KIND_SUFFIXES[kind] || ''}.md`
}

/** ⑰ stray_non_md：类别目录里出现非 `.md`（FIX-69；临时目录不算）喵。 */
async function checkStrayNonMd({ project, readdirImpl }) {
  const rows = await scanDocAreas({ project, readdirImpl })
  return rows.filter((row) => row.nonMd).map((row) => ({
    target: row.path,
    detail: `类别目录「${row.kind}」里出现了非 .md 文件 —— 临时文件请搬到 ${tempDirHint(project)}喵`,
  }))
}

/** ⑱ legacy_caret：文件名仍带 `^` 前缀（归档语义该进元数据 `archived: true`）（FIX-69）喵。 */
async function checkLegacyCaret({ project, readdirImpl }) {
  const rows = await scanDocAreas({ project, readdirImpl })
  const items = rows.filter((row) => row.name.startsWith('^')).map((row) => ({
    target: row.path,
    detail: '文件名还带 `^` 前缀（旧的"归档"写法）—— 归档语义已改为 front-matter 的 `archived: true`；'
      + '让图书管理员跑一轮治理会自动去前缀 + 写元数据（只改名、不改正文）喵',
  }))
  // FIX-110 ①：**归档区也要覆盖** —— 原来只扫类别目录（`scanDocAreas` 刻意不扫 archive）⇒
  // 真机 `archive/2026-10/^T16…`、`^T17…` 两处一直没被报出来 ✗（要么纳入、要么显式豁免，不许静默漏）
  const archiveDir = project && project.archiveDir ? String(project.archiveDir) : null
  if (archiveDir) {
    for (const name of await listMarkdownDeep(archiveDir)) {
      const base = String(name).replace(/\\/g, '/').split('/').pop() || ''
      if (!base.startsWith('^')) continue
      items.push({
        target: joinUnderRoot(archiveDir, name),
        detail: '**归档区**里的文件名还带 `^` 前缀 —— 归档语义在 `archived: true`，文件名不该再带前缀；'
          + '让图书管理员跑一轮治理处理（只改名、不改正文）喵',
      })
    }
  }
  return items
}

/**
 * **`body_caret_title`**：**正文标题行**以 `^` 开头喵（FIX-110 ④，真机 39 篇）喵。
 *
 * 归档前缀被写进正文标题（`## ^T16 …`）—— 归档语义早已在头部 `archived: true`，正文里的 `^` 是历史噪音喵。
 * 报**路径 + 行号 + 标题摘要**，建议跑一轮治理（`librarian_sweep` 的存量清理会去掉它，可预演 + 幂等）喵。
 */
async function checkBodyCaretTitle({ project, store = null, read = readFile, readdirImpl = readdir }) {
  const items = []
  // 自己扫（不 import 馆员模块 —— `duties.js` 静态 import 本模块，动态 import 会成环 ⇒ 探针静默失败过）喵
  const dirs = [
    ...Object.values((project && project.docKinds) || {}),
    ...((project && project.docsDirs) || []),
    project && project.deliverablesDir,
    project && project.tasksDir,
  ].filter(Boolean)
  for (const dir of [...new Set(dirs)]) {
    let names = []
    try {
      names = await listMarkdownDeep(dir, '')
    } catch {
      continue
    }
    for (const name of names) {
      const path = joinUnderRoot(dir, name)
      const base = String(name).replace(/\\/g, '/').split('/').pop() || ''
      // 派生物索引不进这条检查（它们的正文由生成器负责）喵
      if (base === '索引.md' || base === '派生态索引.md') continue
      let text = ''
      try {
        text = String(await read(path, 'utf8'))
      } catch {
        continue
      }
      const info = analyzeFrontMatter(text)
      const body = info.hasHeader ? info.body : text
      const lines = body.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (!/^#{1,6}\s*\^\s*\S/.test(lines[i])) continue
        items.push({
          target: `${path}:${i + 1}`,
          detail: `正文**标题行**以 \`^\` 开头（${String(lines[i]).trim().slice(0, 40)}）—— 归档语义在头部 \`archived: true\`，`
            + '标题里的 `^` 是历史遗留；跑一轮治理会只去掉那个前缀（该行其余一字不动）喵',
        })
      }
    }
  }
  return items
}

/**
 * ⑲ task_file_missing：台账里有**未结**任务记录，但磁盘上没有这个任务文件（FIX-71）喵。
 *
 * 真机样本喵：助手的任务单 `任务/T53_文档归位与规范化.md` 被移出仓库后，主代理**仍然"看到"它**并去读
 * ⇒ `FS_NOT_FOUND`（台账是缓存，文件移走记录不会自己消失）喵。**只报不删** —— 台账可重建，删除不可逆喵。
 * 反例保护：**成员记录不进本检查**（members 有"绝不删除"的不变量：带 sessionId 的实时记录只在 storages）喵。
 */
async function checkTaskFileMissing({ store, project, exists = (path) => existsSync(path) }) {
  const items = []
  for (const task of store.listTasks()) {
    const taskId = String((task && task.taskId) || '').trim()
    if (!taskId || !isOpenTask(task)) continue // 已结的任务不要求文件还在（可能已被归档）喵
    const path = joinUnderRoot(project.tasksDir, `${taskId}.md`)
    if (exists(path)) continue
    items.push({ target: taskId, detail: `台账里有未结任务记录，但磁盘上没有任务文件：${path}` })
  }
  return items
}

/** ⑳ doc_file_missing：文档记录指向的路径在磁盘上不存在（FIX-71；**只报不删**）喵。 */
async function checkDocFileMissing({ store, exists = (path) => existsSync(path) }) {
  const items = []
  for (const doc of store.listDocs()) {
    const path = String((doc && doc.path) || '').trim()
    if (!path || exists(path)) continue
    items.push({ target: path, detail: '台账里有这篇文档的记录，但该文件在磁盘上已不存在' })
  }
  return items
}

/**
 * 「台账 vs 磁盘」这一组检查的 id（FIX-71）喵：人话报告里把它们**排一起**并给一行总建议喵。
 */
export const LEDGER_MISMATCH_CHECKS = ['task_file_missing', 'doc_file_missing']

/**
 * ㉑ legacy_archive_pending：legacy（无头部旧档）缺「待归档」标注（FIX-77 ②）喵。
 *
 * 真机遗留：97 篇 legacy 档缺这个标注（用户明确要求过）—— 标注让"我还没归档、但该归档"变成**字段**，
 * 检索与审计都能按字段办事，而不是靠人记着有哪 97 篇喵。**只报不删**喵。
 */
async function checkLegacyArchivePending({ store, read = readFileIfPresent }) {
  const items = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy !== true) continue
    const found = await read(doc.path)
    const text = found && typeof found.text === 'string' ? found.text : null
    if (text === null) continue
    const { meta } = parseFrontMatter(text)
    if (meta && meta.archivePending === true) continue
    items.push({ target: doc.path, detail: 'legacy 旧档缺「待归档」标注 —— 让馆员跑一轮治理会批量补 `archivePending: true`（只动 front-matter）喵' })
  }
  return items
}

/**
 * ㉒ bookkeeping_untraced：簿记类成员的**完成判据是留痕**，不是文档（FIX-85 ③）喵。
 *
 * 馆员的活儿（索引 / 归档 / 改名 / 引用修复）不留三档，但**每一处改动都会写**
 *  /  ⇒ 判据换成：它最近一次作业之后，全库**有没有留下留痕**；
 * 一处都没有 ⇒ 报「簿记无留痕」（这才是该做没做的真信号）喵。
 */
async function checkBookkeepingUntraced({ store, read = readFileIfPresent }) {
  const items = []
  let newestTrace = 0
  for (const doc of store.listDocs()) {
    const found = await read(doc.path)
    if (!found || typeof found.text !== 'string') continue
    const { meta } = parseFrontMatter(found.text)
    const stamp = Date.parse((meta && meta.librarianTouchedAt) || '')
    if (Number.isFinite(stamp) && stamp > newestTrace) newestTrace = stamp
  }
  for (const member of store.listMembers()) {
    // FIX-84 ②：**用户归档掉的会话 = 明确说这些不用管了** ⇒ 相关检查一律跳过（与警告制精神一致）喵
    if (isArchivedMember(member, arguments[0] && arguments[0].archivedSessionIds, store.listMembers(), arguments[0] && arguments[0].parentOf)) continue
    if (!isBookkeepingRole(member.role)) continue
    if (member.status !== 'completed' && member.status !== 'released') continue
    const active = Date.parse(member.lastActiveAt || '')
    if (!Number.isFinite(active)) continue
    if (newestTrace >= active - MTIME_TOLERANCE_MS) continue
    items.push({
      target: member.name,
      detail: '簿记无留痕：它最近一次作业之后，全库没有任何 librarianTouchedAt / librarianChanges '
        + '（簿记类角色的完成判据是留痕，不是文档）喵',
    })
  }
  return items
}

/**
 * 该成员的会话是否**已被用户归档**喵（FIX-84 + FIX-90）喵：归档集为空/拿不到 ⇒ 一律 false（降级）喵。
 */
function isArchivedMember(member, archivedSessionIds, members = [], parentOf = null) {
  // FIX-90：**归一化 + 按父链上溯**（真机：归档的是父会话，被扫的是子会话；两侧 id 形态还不一致）喵
  return archivedViaChain({ member, members, archived: normalizeArchivedSet(archivedSessionIds), parentOf }).archived
}

/**
 * 校验配置里的检查项开关喵。
 * **未知项必须报错**——否则配置写错却以为在查，是最危险的一种"静默"喵。
 */
export function assertKnownChecks(config) {
  const configured = (config && config.audit && Array.isArray(config.audit.checks)) ? config.audit.checks : []
  const unknown = configured.filter((id) => !CHECK_IDS.includes(id))
  if (unknown.length) {
    throw new Error(`agent-contract: 未知的 audit.checks 项 ${unknown.join('、')}（可用项：${CHECK_IDS.join('、')}）`)
  }
  return configured
}
