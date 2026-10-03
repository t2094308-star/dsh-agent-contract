/**
 * 插件注册的工具喵。
 *
 * M0：`contract_status`（配置体检）喵。
 * M2：产出契约三工具 `doc_emit` / `progress_upsert` / `bugfix_note`，以及索引重建 `ledger_rebuild`喵。
 *
 * 共同纪律（DESIGN §5.4）喵：落盘前自动补建目录、返回值必须带**绝对路径**（三级文档要靠它回贴引用）、
 * 超限只警告不拒写喵。
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { agentLabel } from './delegation/channels.js'
// FIX-96 ②（用户约束）：**跑审计 + 重写快照**的**唯一实现** —— 本工具、启动自愈、面板「强制刷新」三处同源喵
import { refreshPanel } from './panel/refresh.js'
import { archiveDocs, autoBackfill, librarianSweep, mergeGlossary, patrol, refreshStaleTags } from './librarian/duties.js'
import { classifyLength, countChars, parseFrontMatter, renderFrontMatter } from './ledger/docmeta.js'
import { readFileIfPresent } from './ledger/fs.js'
// FIX-69：文档区的**硬限制**（落点/文件名/只收 .md）与临时目录判据喵
import { DEFAULT_DOC_KIND, countDiskDocs, docSpecLines, resolveDocArea, tempDirHint } from './ledger/docarea.js'
// FIX-102/103：文档普查（一次扫盘 + 派生器）—— `doc_census` 与各类索引**同源**喵
import { CENSUS_FIELDS, censusRowLine, documentCensus } from './ledger/census.js'
// FIX-103：各类别索引（八类各一份，机器区块由派生器生成；与 doc_census 同一份普查）喵
import { KIND_INDEX_FILE, writeKindIndexes } from './librarian/indexes.js'
// FIX-89：内置流程（可执行步骤序列）与能力对照表喵
import { getFlow, listFlows } from './contract/flows.js'
import { listRoles } from './contract/roles.js'
import { planSummary, renderWritePlan, writeWithBackup } from './librarian/backup.js'
import { deriveDocMeta, loadGlossary } from './ledger/derive.js'
import { findMisfiled } from './ledger/placement.js'
import { writePanelSnapshot } from './panel/snapshot.js'
import { bugfixFileName, docFileName, memberName, parseMemberName, progressFileName } from './ledger/naming.js'
import { rebuildLedger } from './ledger/rebuild.js'
// FIX-100：`escalationRecord` = 提权申请留痕（绕过契约的显式降级通道）喵
import { docRecord, escalationRecord, taskRecord } from './ledger/store.js'
import { joinUnderRoot, scanProject } from './project.js'
import { createProjectResolver, missingStructure, resolveAdaptiveProject } from './project/adaptive.js'
// FIX-62 / FIX-67：git 只读探测（提示基线）与可选自动提交（默认关）喵
import { autoCommit, autoCommitLine, maybeBaselineHint } from './project/git.js'
// FIX-70：渐进式披露（三档之间的元数据指针）与正文速览喵
import { pointersFor, quickView } from './ledger/progressive.js'
// FIX-66：一轮治理的验收报告渲染喵
import { renderVerification } from './librarian/verify.js'
// FIX-76：馆员的通用搬迁能力喵
import { relocateBatch } from './librarian/duties.js'
// FIX-63：馆员作业面的角色闸门（描述归属 + 主代理直调警告 / 严格模式拒绝）喵
import { withRoleGate } from './delegation/role-gate.js'
import { docSearch } from './search/doc_search.js'

/** 进度文件字数上限（总纲 §2：不得超过 400 字）喵。 */
/**
 * FIX-11：运行版插件的版本号喵 —— 实现搬到 `src/version.js`（FIX-36 起快照也要用），
 * 这里**原样转出**保持既有调用点与断言不变喵。
 */
import { loadedVersion, pluginVersion, versionDrift } from './version.js'
export { pluginVersion }

const PROGRESS_MAX_CHARS = 400

/**
 * FIX-67：**可选的**自动提交喵（默认关）喵。
 *
 * 关闭时返回 null —— 一条 git 命令都不发（只读探测归 FIX-62 的提示）喵。
 * 开启时只提交**本次动到的路径**，工作区有范围外改动即中止，永不 push（护栏都在 `git.js` 里）喵。
 */
export async function maybeAutoCommit({ project, config, result, changed, taskId = '', summary = '', run } = {}) {
  const settings = (config && config.git) || {}
  if (!settings.autoCommit) return null
  if (result && result.dryRun) return null
  const paths = changed || sweepChangedPaths(result)
  if (!paths.length) return null
  const bySummary = summary || `一轮治理（移动 ${((result || {}).archive || {}).moved || 0}`
    + ` / 改名 ${((result || {}).naming || {}).moved || 0}`
    + ` / 归档 ${((result || {}).dedupe || {}).duplicates || 0}）`
  return autoCommit({
    root: project.root,
    paths,
    taskId,
    summary: bySummary,
    backupRel: BACKUP_DIR_REL,
    autoTag: Boolean(settings.autoTag),
    ...(run ? { run } : {}),
  })
}

/** 一轮治理里"本次动到的路径"清单喵（改名记新旧两条，git 才认得出 rename）喵。 */
function sweepChangedPaths(result) {
  const r = result || {}
  const rows = []
  for (const file of (r.archive && r.archive.files) || []) rows.push(file.to)
  for (const file of (r.dedupe && r.dedupe.files) || []) rows.push(file.to)
  for (const move of (r.naming && r.naming.files) || []) { rows.push(move.oldPath); rows.push(move.newPath) }
  if (r.core && r.core.path) rows.push(r.core.path)
  if (r.pitfall && r.pitfall.path) rows.push(r.pitfall.path)
  for (const file of (r.tags && r.tags.files) || []) rows.push(file.path)
  return rows.filter(Boolean)
}

/**
 * FIX-70：把新生成的这一档**补进同任务其它档的指针**里喵。
 *
 * 只动 front-matter 的三个指针键（`nextTier` / `fullDetail` / `detailLevel`），**正文一字不动**；
 * 值没变就**不写**（幂等）；要写就走 `writeWithBackup`（覆盖既有文件必须有退路）喵。
 * @returns 被补齐的档路径清单喵。
 */
async function backfillPointers({ project, store, taskId, tier, path }) {
  const updated = []
  const level = Number(tier)
  const target = level === 1 ? 'fullDetail' : (level === 2 ? 'nextTier' : null)
  if (!target) return updated
  for (const sibling of store.listDocs()) {
    if (!sibling || sibling.path === path || sibling.taskId !== taskId) continue
    const siblingTier = Number(sibling.tier)
    if (siblingTier < 1 || siblingTier > 3) continue
    // L1 只被 L2/L3 指向；L2 只被 L3 指向（渐进式披露的终点是 L1）喵
    if (target === 'fullDetail' && !(siblingTier === 2 || siblingTier === 3)) continue
    if (target === 'nextTier' && siblingTier !== 3) continue
    // ⚠ `readFileIfPresent()` 返回的是 `{ text, mtime }`（不是字符串）—— 直接当文本解析会静默跳过 ✗ 喵
    const found = await readFileIfPresent(sibling.path)
    const text = found && typeof found.text === 'string' ? found.text : null
    if (!text) continue
    const { meta, body } = parseFrontMatter(text)
    if (!meta) continue
    if (meta[target] === path) continue
    const written = await writeWithBackup({
      project,
      path: sibling.path,
      text: renderFrontMatter({ ...meta, [target]: path }) + body,
      stampIso: new Date().toISOString(),
    })
    if (written && written.ok) updated.push(sibling.path)
  }
  return updated
}

/** 安全转字符串数组喵。 */
function listOf(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

/**
 * 渲染「失败隔离」记录喵（DESIGN §5.5 勘误）：批量写遇单条失败只跳过并记录，不整批 abort，
 * 所以这些失败必须回显出来，否则会静默丢数据喵。
 */
function failureLines(failures) {
  const rows = Array.isArray(failures) ? failures : []
  if (!rows.length) return ''
  return `\n写入失败 ${rows.length} 条（已跳过，未中断整批）：\n`
    + rows.slice(0, 10).map((item) => `- ${item.target}：${item.error}`).join('\n')
}

/**
 * 渲染索引/派生档的 `+N/-M` 行数差喵（FIX-23 / §9-28）喵。
 *
 * **删行 > 0 时必须把被删内容列出来**：实测一轮治理整篇覆盖了人工 README（34 行 → 20 行），
 * 事后连"删了什么"都说不清 —— 这个回显就是那道防线喵。
 */
function diffLines(label, stat) {
  const removed = (stat && stat.removedLines) || []
  const lines = [`    ${label} diff：+${(stat && stat.added) || 0} / -${(stat && stat.removed) || 0}`]
  for (const text of removed.slice(0, 10)) lines.push(`    被删：${text}`)
  if (removed.length > 10) lines.push(`    被删：…（其余 ${removed.length - 10} 行，旧版见备份）`)
  return lines
}

/** 去掉模型可能自带的 front-matter，避免写出两份喵。 */
function stripFrontMatter(text) {
  const { meta, body } = parseFrontMatter(text)
  return meta === null ? text : body
}

/** 确保目录存在喵。 */
async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

/**
 * 提权申请的摘要喵（FIX-100 ②）喵 —— 体检回执里打「最近提权」，让人一眼看到"谁申请过绕过契约"喵。
 * 读不到（store 没这个方法 / 领域打不开）一律给零值，**绝不让体检失败**喵。
 */
function escalationSummary(store) {
  try {
    const rows = typeof store.listEscalations === 'function' ? store.listEscalations() : []
    const sorted = [...rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    const last = sorted[0] || null
    return {
      count: rows.length,
      last: last ? { createdAt: last.createdAt, scope: last.scope, taskId: last.taskId, until: last.until, reason: last.reason } : null,
    }
  } catch {
    return { count: 0, last: null }
  }
}

function renderStatus(value) {
  const lines = []
  // FIX-11：先打版本与工具清单，核验方一眼就能比对「工作树 vs 运行中宿主」喵
  lines.push(`插件版本: ${value.plugin ? value.plugin.version : '(未提供)'}`)
  // FIX-97 ①：**版本漂移必须显式可见** —— 真机上"所有契约工具一起废"时，用户完全想不到是版本问题 ✗
  if (value.plugin && value.plugin.drift) {
    lines.push(`⚠ **版本漂移**：进程里正在跑的是 ${value.plugin.loaded}，磁盘上已经是 ${value.plugin.disk}`
      + ' ⇒ 请**完整重启应用**（只刷新窗口/页面不算）：当前进程加载的还是旧版插件，'
      + '新旧 schema 混用时台账领域可能直接打不开（那会让所有契约工具一起失效）喵')
  } else if (value.plugin && value.plugin.loaded && value.plugin.loaded !== value.plugin.version) {
    lines.push(`运行版本: ${value.plugin.loaded}（与磁盘 ${value.plugin.version} 不一致）`)
  }
  const toolNames = value.plugin && Array.isArray(value.plugin.tools) ? value.plugin.tools : []
  lines.push(`已注册工具（${toolNames.length}）: ${toolNames.length ? toolNames.join(', ') : '(未提供)'}`)
  lines.push('')
  lines.push(`契约工作流项目: ${value.project.name || '(未命名)'}`)
  lines.push(`项目根: ${value.project.root}`)
  lines.push('')
  lines.push('目录约定:')
  for (const dir of value.scan.dirs) {
    if (dir.exists) {
      lines.push(`- ${dir.label}: ${dir.path} | md ${dir.markdown} / 条目 ${dir.entries} | 最新 ${dir.newest || '(空)'}`)
    } else {
      lines.push(`- ${dir.label}: ${dir.path} | 不存在${dir.error ? ` (${dir.error})` : ''}`)
    }
  }
  lines.push('')
  lines.push(`预算: 软 ${value.project.budgets.softLimit ?? '-'} / 硬 ${value.project.budgets.hardLimit ?? '-'}` +
    ` (超软限 ${value.project.budgets.warnOverSoftPct ?? '-'}% 内仅提醒)`)
  lines.push(`审计项: ${(value.project.audit.checks || []).join(', ') || '(未配置)'}`)
  if (value.project.archiveDir) lines.push(`归档目录: ${value.project.archiveDir}`)
  // FIX-100 ②：**最近提权**（绕过契约的显式申请）要在体检里查得到喵
  if (value.escalations) {
    const last = value.escalations.last
    lines.push(last
      ? `提权申请: 共 ${value.escalations.count} 条 ｜ 最近一条 ${last.createdAt}（作用域 ${last.scope}${last.taskId ? ` / ${last.taskId}` : ''}）：${last.reason}`
      : '提权申请: 无（**所有子代理派单都应走 `contract_delegate_*`**；确需绕过先调 `contract_request_escalation` 说明理由）')
  }
  // FIX-95 ②：**启动自愈的留痕**（重启后旧版写的快照有没有被重写）——失败绝不静默，这里直接打出来喵
  if (value.startup_heal) {
    const heal = value.startup_heal
    if (heal.pending) {
      // FIX-95 ②：带原因时打原因（"面板同步器没挂上"这类不是"再等等就好"）喵
      lines.push(`启动自愈: ${heal.error || heal.note}`)
      if (heal.error) lines.push('  （快照不会自动重写、面板不会自己更新：先修这个再谈其它）')
    } else {
      lines.push(`启动自愈: 扫 ${heal.roots} 个工作区 —— 重写 ${heal.healed} / 已最新 ${heal.upToDate} / 跳过 ${heal.skipped} / 失败 ${heal.failed}`
        + (heal.error ? ` ｜ **失败原因**：${heal.error}` : ''))
      if (heal.failed) {
        lines.push('  （自愈失败 ⇒ 重启不会自动补写面板快照：请让主代理跑一次 `audit_scan`，或派一次活）')
      }
    }
  }
  const kinds = Object.entries(value.project.docKinds || {})
  if (kinds.length) {
    lines.push('文档类别（每类一个文件夹，禁止混放）:')
    for (const [kind, dir] of kinds) lines.push(`- ${kind}: ${dir}`)
  }
  if (value.misfiled && value.misfiled.length) {
    lines.push('')
    lines.push(`放错位置的文档 ${value.misfiled.length} 篇（doc_misfiled，警告制只报不动）:`)
    for (const row of value.misfiled.slice(0, 10)) lines.push(`- [${row.reason}] ${row.path}`)
  }
  // FIX-89 ②：**谁能干什么**（按能力找角色，而不是凭名字猜）—— 来源是 ROLE_META 那张唯一表喵
  if (value.role_capabilities && value.role_capabilities.length) {
    lines.push('')
    lines.push('谁能干什么（按能力找角色）：')
    for (const row of value.role_capabilities) {
      lines.push(`- ${row.role}（${row.title}）：能力 ${row.capabilities.join(' / ') || '(未声明)'}`
        + ` ｜ 产出形态 ${row.deliverableKinds.join(' / ') || '(未声明)'}`)
    }
  }
  // FIX-72：**面向 agent 的文档规范**（一句话一条）—— 有了它，主代理就不必满世界翻源码/设计稿喵
  if (value.doc_spec && value.doc_spec.length) {
    lines.push('')
    for (const row of value.doc_spec) lines.push(row)
  }
  // FIX-72：两套篇数分开标（台账只覆盖一部分类别，混在一起会被误读成"漏档"）喵
  if (value.doc_counts) {
    lines.push('')
    lines.push(`篇数：台账 ${value.doc_counts.ledger} 篇（${value.doc_counts.note}）；`
      + `磁盘 ${value.doc_counts.disk} 篇（各类别目录里递归数的 .md）`)
  }
  if (value.scan.missing.length) {
    lines.push('')
    lines.push(`缺少的目录: ${value.scan.missing.join(' | ')}`)
  }
  // FIX-58：项目自适应说明（命中既有结构 / 将新建什么 / 用了显式配置）—— 用户在回执里就能看到喵
  for (const note of value.project_notes || []) lines.push(`自适应: ${note}`)
  // FIX-61：结构缺失要**主动提示**（用户不必自己记得去调 project_init）喵
  if (value.project_hint) lines.push(`初始化提示: ${value.project_hint}`)
  if (value.ledger) {
    lines.push('')
    lines.push(`台账: 成员 ${value.ledger.members} / 任务 ${value.ledger.tasks} / 文档 ${value.ledger.docs}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 注册全部工具喵。
 * @param ctx - 插件上下文喵。
 * @param pluginConfig - 插件配置喵。
 * @param ledger - `createLedger()` 的结果喵。
 * @param collected - 工具名清单（`contract_status` 打印用）喵。
 * @param projects - 已解析项目的登记簿（FIX-58；面板同步与待办路由按它反查项目）喵。
 */
/** 最近一次自适应推导的说明喵（`contract_status` / `project_init` 会打印它）喵。 */
let lastProjectNotes = []

export function registerTools(ctx, pluginConfig, ledger, collected, projects, sharedResolver, healLog = null) {
  lastProjectNotes = []
  // FIX-11：本函数注册的工具名记进外部清单（与委派通道共用一份），供 contract_status 打印喵
  const registeredToolNames = Array.isArray(collected) ? collected : []
  /**
   * 本次调用**该服务于哪个项目**喵（FIX-58 自适应）喵 —— 与委派通道**共用同一个解析器**，
   * 免得"工具落盘的目录"与"契约里写的目录"对不上（两种口径是更坏的结果）喵。
   */
  const resolver = sharedResolver || createProjectResolver({ ctx, config: pluginConfig, ledger, projects })
  const projectFor = async (exec, options = {}) => {
    const resolved = await resolver(exec, options)
    lastProjectNotes = resolved.notes
    return resolved
  }

  const registerOne = (definition) => {
    registeredToolNames.push(definition.name)
    // FIX-63：馆员作业面套角色闸门（描述附归属句 + 主代理直调附警告 + 严格模式拒绝）喵
    ctx.tools.register(withRoleGate(definition, { config: pluginConfig }))
  }
  registerOne(defineTool({
    name: 'contract_flow',
    description: '查一条**内置流程**的**可执行步骤序列**（派哪个角色 → 产出什么 → 何时停下等用户确认）。'
      + '用途：主代理做"甩手掌柜"—— 照流程派单，不必自己设计步骤，**也不该自己跑批量侦察**'
      + '（盘点 / 数数 / 找标记这类重活派 `researcher`，它与你同模型、更省你的上下文）。'
      + `内置流程：${listFlows().map((flow) => `${flow.name}（${flow.title}）`).join('；')}。`
      + '步骤里标了 `stopForUser` 的地方**必须**停下来等用户拍板，不许一路做完。',
    parameters: {
      name: { type: 'string', required: true, description: '流程名（organize-docs / implement / research）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          flow: { type: 'object', additionalProperties: true, required: true },
          available: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => {
        const lines = [`流程「${value.flow.name}」：${value.flow.title}`]
        value.flow.steps.forEach((step, index) => {
          lines.push(`${index + 1}. ${step.role ? `派 \`${step.role}\`` : '**主代理自己做**'}：${step.action}`)
          lines.push(`   产出：${step.output}${step.stopForUser ? '　⏸ **停下等用户确认**' : ''}`)
        })
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '查内置流程', kind: 'read' }),
    async execute(args) {
      return { flow: getFlow(args && args.name), available: listFlows() }
    },
  }))

  /**
   * FIX-100 ②③：**显式降级通道**（提权申请）喵 —— 硬规矩是"所有子代理派单必须走契约工具"，
   * 但契约工具真不可用时（宿主限制 / 工具报错），主代理不能只能"偷偷绕过"：
   * 先来这里说清理由，**留痕**（台账 + 面板 + `contract_status`），审计随后把作用域内的绕过标注「已提权」喵。
   */
  registerOne(defineTool({
    name: 'contract_request_escalation',
    description: '申请**绕过契约派单**（用宿主的普通派单工具）并留下记录喵。'
      + '**硬规矩**：所有子代理派单都走 `contract_delegate_*`；只有契约工具**不可用**（宿主报错 / 被拒 / 场景不允许）'
      + '或确有必要时，才先调本工具说明理由，再用普通派单 —— 绕过会被审计报 `uncontracted_dispatch`（黄），'
      + '**提权之后**同一作用域内会标「已提权」且不计红黄喵。'
      + '覆盖规则：作用域 `session`（默认，本会话及之后派出的子会话）/ `task`（要传 `taskId`）/ `once`（只覆盖之后第一个）；'
      + '`until` 到期即失效；提权只管**它之后**派出去的（之前的照旧报黄）喵。',
    parameters: {
      reason: { type: 'string', required: true, description: '为什么必须绕过契约（写清宿主限制 / 报错原文），审计与用户都看这条。' },
      scope: { type: 'string', description: '可选：作用域 once / task / session（默认 session）。' },
      taskId: { type: 'string', description: '可选：`scope: task` 时按它匹配。' },
      until: { type: 'string', description: '可选：失效时间（ISO 时间字符串），不传 = 不过期。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          escalation: { type: 'object', additionalProperties: true, required: true },
          receipt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.receipt }],
    },
    presentCall: () => ({ card: 'generic', title: '申请绕过契约（提权）', kind: 'execute' }),
    async execute(args, exec) {
      const reason = String((args && args.reason) || '').trim()
      if (!reason) throw new Error('agent-contract: 提权必须写**理由**（为什么必须绕过契约）')
      const scope = ['once', 'task', 'session'].includes(String((args && args.scope) || '').trim())
        ? String(args.scope).trim()
        : 'session'
      const { project, store } = await projectFor(exec)
      const sessionId = exec && exec.agent && exec.agent.session && exec.agent.session.header
        ? String(exec.agent.session.header.id || '')
        : ''
      const record = escalationRecord({
        sessionId: sessionId || null,
        reason,
        scope,
        taskId: (args && args.taskId) ? String(args.taskId) : null,
        until: (args && args.until) ? String(args.until) : null,
      })
      await store.putEscalation(record)
      const receipt = `已记下提权（作用域 ${scope}${record.taskId ? ` / ${record.taskId}` : ''}${record.until ? ` / 至 ${record.until}` : ''}）`
        + `\n理由：${reason}`
        + '\n审计会把作用域内的"绕过契约派单"标成「已提权」（不计红黄）；**范围外照旧报黄**，绕过时请把理由写进报告喵'
      return { ok: true, escalation: record, receipt }
    },
  }))

  /**
   * FIX-102：**批量取元数据的只读入口**喵 —— 真机实证：馆员为了建索引**连续读了几十篇产出档全文**，
   * 而索引要的字段（路径/档级/任务号/标题/字数/关键词/relatedFiles/legacy/归档/指针）**全都是机读的**，
   * 派生器早算过 ⇒ 这一件工具一次给全量，别再靠"一篇篇读全文"重建一遍喵。
   */
  registerOne(defineTool({
    name: 'doc_census',
    description: '**一次拿到全部档的机读元数据**（只读，零模型调用）：路径 / 类别 / 档级 / 任务号 / 标题 / 字数 / '
      + '关键词 / relatedFiles / legacy / archived / 待办码 / 时间。'
      + '**建索引、核对引用、统计这类活先调它** —— 不要为了这些去一篇篇读全文（真机上有人这么干过，白烧一两个数量级上下文）喵。'
      + '需要正文时再走 `doc_search`（检索）→ 读头部（front-matter + 首屏速览）→ 确实必要才整篇读；'
      + '连续整篇读**超过 5 篇**请先回报"是否需要继续"喵。'
      + '文档规范见契约的「文档规范」段（不必读插件源码）喵。',
    parameters: {
      kind: { type: 'string', description: '可选：只看某一类（研究 / 审查 / 整合清单 / 坑 / 修改 / 核心数据库 / 产出档 / 归档）。' },
      tier: { type: 'number', description: '可选：只看某档级（1 / 2 / 3）。' },
      taskId: { type: 'string', description: '可选：只看某任务号。' },
      legacy: { type: 'boolean', description: '可选：只看 legacy（存量旧档）或只看非 legacy。' },
      limit: { type: 'number', description: '可选：最多返回几行（默认 200，防一次刷屏）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          rows: { type: 'array', required: true, items: { type: 'json' } },
          counts: { type: 'object', additionalProperties: true, required: true },
          scanned: { type: 'number', required: true },
          fields: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = [`文档普查：${value.scanned} 篇（按类别：`
          + `${Object.entries(value.counts).map(([kind, count]) => `${kind} ${count}`).join(' / ') || '（空）'}）`]
        for (const row of value.rows) lines.push(censusRowLine(row))
        if (value.rows.length < value.scanned) lines.push(`（只显示前 ${value.rows.length} 行，可用 kind / tier / taskId 过滤）`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '文档普查（只读）', kind: 'read' }),
    async execute(args, exec) {
      const { project } = await projectFor(exec)
      const census = await documentCensus({ project })
      let rows = census.rows
      const kind = args && args.kind ? String(args.kind).trim() : ''
      if (kind) rows = rows.filter((row) => row.kind === kind)
      if (args && Number.isFinite(Number(args.tier))) rows = rows.filter((row) => Number(row.tier) === Number(args.tier))
      if (args && args.taskId) rows = rows.filter((row) => String(row.taskId || '') === String(args.taskId))
      if (args && typeof args.legacy === 'boolean') rows = rows.filter((row) => row.legacy === args.legacy)
      const limit = Number(args && args.limit) > 0 ? Math.min(500, Math.floor(Number(args.limit))) : 200
      return {
        rows: rows.slice(0, limit),
        counts: census.counts,
        scanned: rows.length,
        fields: [...CENSUS_FIELDS],
      }
    },
  }))

  /**
   * FIX-103：**各类别索引重建**（八类各一份 `<类别目录>/索引.md`）喵 —— 机器区块由派生器生成，
   * **零模型调用**；与 `doc_census` 用同一份普查（单一来源）。默认 dryRun 预演，确认后再落盘喵。
   */
  registerOne(defineTool({
    name: 'librarian_indexes',
    description: '重建**各类别索引**（研究 / 审查 / 整合清单 / 坑 / 修改 / 核心数据库 / 产出档 / 归档 各一份 '
      + `\`${KIND_INDEX_FILE}\`）：机器区块由插件派生器生成（零模型调用），**只在该区块内增删**，区块外一字不动，内容没变就不写。`
      + '默认 `dryRun: true` 只预演（将写哪几份、各多少条）；确认后用 `dryRun: false` 落盘。'
      + '**不需要读正文** —— 索引字段全部来自 `doc_census` 的同一份派生结果（规范见契约「文档规范」段）喵。',
    parameters: {
      dryRun: { type: 'boolean', description: '为 true（默认）只预演不落盘。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          dryRun: { type: 'boolean', required: true },
          files: { type: 'array', required: true, items: { type: 'json' } },
          failed: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => {
        const lines = [value.dryRun ? '索引重建预演（未落盘）：' : '索引重建完成：']
        for (const row of value.files) {
          const mark = row.wrote ? '已写' : (row.wouldWrite ? '将写' : '未变')
          lines.push(`- [${mark}] ${row.kind}：${row.items} 条 → ${row.path}`)
        }
        for (const row of value.failed) lines.push(`- 失败 ${row.kind}：${row.error}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '重建类别索引', kind: 'edit' }),
    async execute(args, exec) {
      const dryRun = !(args && args.dryRun === false)
      const { project } = await projectFor(exec)
      // 与 `doc_census` **同一份**普查（单一来源）喵
      const census = await documentCensus({ project })
      return { dryRun, ...(await writeKindIndexes({ project, census, dryRun })) }
    },
  }))

  registerOne(defineTool({
    name: 'project_init',
    description: '把**当前工作区**认成项目：按候选清单探测既有目录，命中即用；探不到就在项目根内'
      + '新建默认结构（任务 / 进度 / 文档各类目录 / 待办.md）—— **只新建、绝不覆盖任何既有文件**。'
      + '默认 `dryRun: true` 只预览"将建哪些目录"，确认无误后再用 `dryRun: false` 落地。'
      + '推导结果写在 `<项目根>/.agent-contract/project.json`（派生物、随项目走，删掉会自动重探）。'
      + '不需要为每个新仓库改配置：换工作区 = 换项目，记录各归各域。',
    parameters: {
      dryRun: { type: 'boolean', description: '为 true（默认）只预览将建目录清单，不落盘。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          root: { type: 'string', required: true },
          name: { type: 'string', required: true },
          key: { type: 'string', required: true },
          dryRun: { type: 'boolean', required: true },
          created: { type: 'array', required: true, items: { type: 'string' } },
          failed: { type: 'array', required: true, items: { type: 'json' } },
          notes: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = [
          `项目：${value.name}（${value.root}）`,
          `推导来源：${value.source}${value.explicitPaths ? '（目录约定来自显式配置）' : '（自适应探测）'}`,
          value.dryRun
            ? `将新建 ${value.created.length} 项（试算，未落盘）：`
            : `已新建 ${value.created.length} 项：`,
        ]
        for (const path of value.created) lines.push(`- ${path}`)
        if (!value.created.length) lines.push('- （无：结构探测已命中既有目录，未改动任何文件）')
        for (const item of value.failed) lines.push(`- 失败 ${item.target}：${item.error}`)
        for (const note of value.notes) lines.push(`自适应: ${note}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '初始化项目结构', kind: 'execute' }),
    async execute(args, exec) {
      const dryRun = !(args && args.dryRun === false)
      const adaptive = await resolveAdaptiveProject({
        // `forceCreate`：**只有这个工具会建目录**（显式动作、人点头）——显式配置了目录约定的项目也归它管喵
        ctx, config: pluginConfig, agent: exec && exec.agent, dryRun, ensure: true, forceCreate: true,
      })
      lastProjectNotes = adaptive.notes
      return {
        root: adaptive.root,
        name: adaptive.name,
        key: adaptive.key,
        source: adaptive.source,
        explicitPaths: adaptive.explicitPaths,
        dryRun,
        created: adaptive.created,
        skipped: adaptive.skipped,
        failed: adaptive.failed,
        plan: adaptive.plan,
        paths: adaptive.paths,
        notes: adaptive.notes,
      }
    },
  }))

  registerOne(defineTool({
    name: 'contract_status',
    description: '读取「多智能体契约工作流」的项目配置并体检目录（任务登记 / 进度 / 三档产出 / 文档源），'
      + '并打印**文档规范**：每类的目录 + 命名后缀 + 必备头部字段、产出区硬限制、归档字段、临时文件去处、渐进式披露指针、'
      + '以及「下一步姿势」（整理/归档/命名规范这类活怎么派单）。'
      + '用于确认插件配置已生效、各约定目录是否存在与是否可写。只读，不改动任何文件。'
      + '**想了解文档规范读本工具即可 —— 不需要读插件源码，也不需要翻设计稿**。',
    parameters: {
      verbose: { type: 'boolean', description: '为 true 时在结果中附带完整解析后的原始结构。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          project: { type: 'object', additionalProperties: true, required: true },
          scan: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => renderStatus(value),
    },
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const scan = await scanProject(project)
      // FIX-61：结构缺不缺，判据是**文件系统事实**（缺了就在回执里提示"调 project_init"）喵
      const structureHint = missingStructure({ project })
      let ledgerSizes
      try {
        ledgerSizes = store.sizes()
      } catch {
        ledgerSizes = undefined
      }
      // doc_misfiled（DESIGN §5.5）：判据是文件系统事实，与台账无关；只判定与上报，绝不移动任何文件喵
      const misfiled = await findMisfiled({ project })
      // FIX-72：规范条文与「台账 vs 磁盘」两套篇数一起给出去（agent 不必再翻源码）喵
      const docSpec = docSpecLines({ project })
      const diskDocs = await countDiskDocs({ project })
      return {
        ok: true,
        project: args && args.verbose ? project : {
          name: project.name,
          root: project.root,
          docsDirs: project.docsDirs,
          archiveDir: project.archiveDir,
          docKinds: project.docKinds,
          budgets: project.budgets,
          audit: project.audit,
        },
        scan,
        // FIX-11：核验前先比对「工作树 vs 运行中宿主」，不一致即标版本漂移喵
        // FIX-97 ①：**运行版本 vs 磁盘版本**都要报 —— 漂移时用户第一眼就知道该完整重启喵
        plugin: { version: pluginVersion(), loaded: loadedVersion(), ...versionDrift(), tools: registeredToolNames },
        // FIX-58：把「项目自适应」的说明带回执（命中既有结构 / 将新建什么 / 用了显式配置）喵
        project_notes: lastProjectNotes,
        // FIX-72：文档规范 + 两套篇数（台账只含产出档/任务/进度；磁盘含所有类别）喵
        // FIX-89 ②：谁能干什么（角色元数据表的投影；与审计/面板同一来源）喵
        role_capabilities: listRoles(pluginConfig).map((role) => ({
          role: role.id, title: role.title, capabilities: role.capabilities || [], deliverableKinds: role.deliverableKinds || [],
        })),
        doc_spec: docSpec,
        doc_counts: {
          ledger: ledgerSizes ? ledgerSizes.docs : 0,
          disk: diskDocs,
          note: '台账只含「产出档 / 任务 / 进度」，研究/坑/修改/核心数据库等类别不进台账（是否纳入是单独决策）',
        },
        // FIX-61：结构缺失就给一句"尚未初始化 + 调 project_init"（结构齐了就**不带这个字段**，不刷噪音）喵
        ...(structureHint ? { project_hint: structureHint.hint } : {}),
        // FIX-95 ②：**启动自愈的留痕**（重启后快照有没有被重写、失败原因是什么）——"重启为什么没恢复"一眼可查喵
        ...(healLog ? {
          startup_heal: healLog.report
            ? { ...healLog.report, error: healLog.error || null }
            // FIX-95 ②：**没跑成也要给原因**（面板同步器没挂上 / 台账没开起来）—— 不许写成"尚未跑完"就算完喵
            : { pending: true, note: '启动自愈尚未跑完（或本进程还没挂上面板同步器）', error: healLog.error || null },
        } : {}),
        ...(misfiled.length ? { misfiled } : {}),
        ...(ledgerSizes ? { ledger: ledgerSizes } : {}),
        // FIX-100 ②③：**最近提权**带上 —— 审计 / 面板 / 体检三处都要看得到「谁申请过绕过契约」喵
        escalations: escalationSummary(store),
      }
    },
    presentCall() {
      return { card: 'generic', title: '体检契约工作流配置', kind: 'read' }
    },
  }))

  registerOne(defineTool({
    name: 'doc_emit',
    description: '产出一份三档文档并落盘到 [位置]（产出目录），返回绝对路径喵。'
      + '档级：3 = 高度概括（总纲要求 250~300 字，超出只警告不拒写）；2 = 扩充细节；1 = 详细归纳（原则上不超过 3000 字）。'
      + 'front-matter（taskId/role/tier/keywords/relatedFiles/createdAt）由本工具自动写入，不要自己拼 YAML。'
      + '正文请按固定小节组织：## 结论 / ## 依据 / ## 风险与待确认 / ## 下一步 —— 缺失只会警告，但会被审计记名。'
      + 'keywords 请带上同义词（例「分裂炮台 / scatter / 分裂炮」），因为检索靠字面命中。'
      + '三级文档末尾必须附一级/二级文档的绝对路径（先调本工具生成它们，再把路径贴回来）。',
    parameters: {
      // FIX-69：产出档必填；类型档（研究/审查/整合清单…）不需要它喵
      level: { type: 'number', description: '档级：3 / 2 / 1（产出档必填）。' },
      kind: { type: 'string', description: '可选：文档类型（研究 / 审查 / 整合清单 / 坑 / 修改 / 核心数据库），缺省 = 三档产出档。' },
      taskId: { type: 'string', required: true, description: '任务号（与任务文件名一致，不含 .md）。' },
      title: { type: 'string', required: true, description: '文档标题（会作为文件名片段）。' },
      body: { type: 'string', required: true, description: '正文（Markdown，不含 front-matter）。' },
      role: { type: 'string', description: '可选：角色 id（如 researcher）。默认从调用方成员名反解。' },
      keywords: { type: 'array', items: { type: 'string' }, description: '可选：检索关键词（含同义词）。' },
      relatedFiles: { type: 'array', items: { type: 'string' }, description: '可选：相关文件路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string', required: true },
          tier: { type: 'number', required: true },
          chars: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          missingSections: { type: 'array', required: true, items: { type: 'string' } },
          needsLibrarian: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        // FIX-81：三档产出写 `L<n> 级文档`；其它类别写「<类别>档」—— **不许出现"0 级"**
        // （坑/研究/审查/整合清单本来就没有档级，写成"0 级"读起来像掉级或缺陷，真机报告方专门为此发问）喵
        text: `已落盘 ${value.kind && value.kind !== '产出档' ? `${value.kind}档` : `L${value.tier} 级文档`}：${value.path}（${value.chars} 字）`
          + (value.warnings.length ? `\n警告：\n- ${value.warnings.join('\n- ')}` : '')
          // FIX-62：基线提示要看得见（只提示、不代提交）喵
          + (value.gitHint ? `\n${value.gitHint}` : '')
          // FIX-70：还缺哪一档的下钻目标（流程提醒，不是警告）喵
          + (value.progressiveHint ? `\n${value.progressiveHint}` : ''),
      }],
    },
    presentCall: () => ({ card: 'generic', title: '产出三档文档', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      // FIX-69：类型可选（默认三档产出档）；**非产出类型不带档级**（它们不是三档文档，`tier` 记 0）喵
      const docKind = String((args && args.kind) || DEFAULT_DOC_KIND).trim() || DEFAULT_DOC_KIND
      const rawTier = Number(args && args.level)
      if (docKind === DEFAULT_DOC_KIND && ![1, 2, 3].includes(rawTier)) {
        throw new Error(`agent-contract: level 必须是 3 / 2 / 1，收到 ${args && args.level}`)
      }
      const tier = docKind === DEFAULT_DOC_KIND ? rawTier : 0
      const taskId = String((args && args.taskId) || '').trim()
      if (!taskId) throw new Error('agent-contract: doc_emit 需要 taskId')
      const title = String((args && args.title) || '').trim() || `未命名-${tier}级`
      const body = stripFrontMatter(String((args && args.body) || ''))
      if (!body.trim()) throw new Error('agent-contract: doc_emit 需要非空 body')
      // FIX-69：**产出区硬限制** —— 落点与文件名都由插件算，并**校验**（写动作层面拒绝，不是审计提醒）喵
      const area = resolveDocArea({ project, taskId, title, tier, kind: docKind })

      const label = exec && exec.agent ? await agentLabel(ctx, exec.agent, exec.signal) : null
      const labelParts = label ? parseMemberName(label) : null
      const role = (args && args.role) ? String(args.role) : (labelParts ? labelParts.role : null)
      const owner = label || (role && taskId ? memberName(taskId, role) : null)

      // FIX-69：落点由 `resolveDocArea()` 算好（产出档 = <产出根>/L<n>/；其它类型 = 该类型自己的目录）喵
      const path = area.path
      const glossary = await loadGlossary(project)
      // 元数据一律机器派生（零模型调用）：模型给的 keywords/relatedFiles 只作为派生输入之一喵
      const derived = deriveDocMeta({
        fileName: basename(path),
        text: body,
        mtime: Date.now(),
        glossary,
        memberRole: role,
        overrides: {
          taskId,
          tier,
          role,
          keywords: listOf(args && args.keywords),
          relatedFiles: listOf(args && args.relatedFiles),
        },
      })
      const length = classifyLength(tier, derived.chars)
      const warnings = []
      if (length.message) warnings.push(length.message)
      for (const name of derived.missingSections) {
        warnings.push(`缺少固定小节「${name}」（审计会记 doc_meta_missing，建议补上）`)
      }
      for (const item of derived.needsLibrarian) warnings.push(`需馆员兜底 [${item.code}]：${item.detail}`)

      // FIX-69：只补**目标自己那一层**（产出档 = `<产出根>/L<n>/`）——整套结构归 `project_init` 喵
      await ensureDir(dirname(path))
      // FIX-70：**渐进式披露指针** —— 同任务已知的各档路径里算指针（L3→L2+L1、L2→L1、L1 是终点）喵
      const byTier = {}
      for (const sibling of store.listDocs()) {
        if (sibling && sibling.taskId === taskId && Number(sibling.tier) >= 1 && Number(sibling.tier) <= 3) {
          byTier[Number(sibling.tier)] = sibling.path
        }
      }
      byTier[Number(tier)] = path
      const progressive = pointersFor({ tier, byTier })
      // 缺下钻目标**只作回执提示，不进 warnings**（warnings 是"审计会记名"的口径；这条是流程提醒）喵
      const progressiveHint = progressive.missing.length
        ? `渐进式披露：还缺 ${progressive.missing.join('、')} 档 —— 生成后本工具会自动回填指针`
        : ''
      const head = renderFrontMatter({
        taskId,
        role,
        tier,
        keywords: derived.keywords,
        relatedFiles: derived.relatedFiles,
        createdAt: derived.createdAt,
        ...progressive.pointers,
      })
      // FIX-70 ③：正文首屏一段 ≤3 行的**速览**（机器生成，零模型调用）喵
      const bodyWithView = quickView({
        tier, project, pointers: progressive.pointers, brief: (pluginConfig && pluginConfig.project && pluginConfig.project.brief) || '',
      }) + body
      // FIX-30：同名重发 = **覆盖知识资产** → 走备份闸门喵。
      // 目标不存在时 `writeWithBackup` 自动跳过备份（不留无谓副本）；备份失败则**中止覆盖**，
      // 宁可这版不落盘，也不能让人家的上一版没有退路地消失喵。
      const existing = store.getDoc(path)
      const written = await writeWithBackup({
        project, path, text: head + bodyWithView, stampIso: new Date().toISOString(),
      })
      if (!written.ok) {
        throw new Error(`agent-contract: doc_emit 写入已中止（${written.action === 'overwrite' ? '覆盖前备份失败' : '写入失败'}）：${written.error}`)
      }
      // FIX-62：写动作前给一句 git 基线提示（每个项目只提示一次；非仓库/干净则没有）喵
      const gitHint = await maybeBaselineHint({ project })
      const overwrote = written.action === 'overwrite'
      const overwriteCount = overwrote ? Number((existing && existing.overwriteCount) || 0) + 1 : 0
      if (overwrote) {
        warnings.push(`已覆盖同名旧版（第 ${overwriteCount} 次覆盖）；旧版备份：${written.backupPath}`)
      }

      await store.putDoc(docRecord({
        path, tier, taskId, title, owner,
        chars: derived.chars,
        keywords: derived.keywords,
        relatedFiles: derived.relatedFiles,
        missingSections: derived.missingSections,
        legacy: false,
        needsLibrarian: derived.needsLibrarian,
        updatedAt: derived.createdAt,
        overwriteCount,
        lastBackupPath: overwrote ? written.backupPath : null,
      }))
      // FIX-70：把这一档补进同任务其它档的指针（只动 front-matter，正文一字不动；值没变就不写）喵
      const pointersBackfilled = await backfillPointers({ project, store, taskId, tier, path })
      return {
        path,
        tier,
        chars: derived.chars,
        warnings,
        missingSections: derived.missingSections,
        needsLibrarian: derived.needsLibrarian,
        // FIX-30：覆盖要**可见**（主代理看得到"这版换掉了旧版"）喵
        overwrote,
        backupPath: written.backupPath,
        ...(gitHint ? { gitHint } : {}),
        overwriteCount,
        // FIX-70：本档的指针 + 被回填的兄弟档（渐进式披露自动串起来）喵
        pointers: progressive.pointers,
        // FIX-81：回执按**类别**措辞要用它（`产出档` 才谈档级）喵
        kind: area.kind,
        ...(progressiveHint ? { progressiveHint } : {}),
        ...(pointersBackfilled.length ? { pointersBackfilled } : {}),
      }
    },
  }))

  registerOne(defineTool({
    name: 'progress_upsert',
    description: '写入或更新 [Agent进度] 下的进度文件（文件名 = 任务号），返回绝对路径与字数喵。'
      + `总纲要求该文件不得超过 ${PROGRESS_MAX_CHARS} 字——超出只警告不拒写，但请主动精简。`,
    parameters: {
      taskId: { type: 'string', required: true, description: '任务号（进度文件名即任务号）。' },
      body: { type: 'string', required: true, description: '进度正文（Markdown）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string', required: true },
          chars: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已更新进度：${value.path}（${value.chars} 字）`
          + (value.warnings.length ? `\n警告：\n- ${value.warnings.join('\n- ')}` : ''),
      }],
    },
    presentCall: () => ({ card: 'generic', title: '更新进度', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const taskId = String((args && args.taskId) || '').trim()
      if (!taskId) throw new Error('agent-contract: progress_upsert 需要 taskId')
      const body = String((args && args.body) || '')
      const chars = countChars(body)
      const warnings = []
      if (chars > PROGRESS_MAX_CHARS) {
        warnings.push(`进度文件超长：${chars} > ${PROGRESS_MAX_CHARS} 字（总纲硬要求；警告制，不拒写）`)
      }
      await ensureDir(project.progressDir)
      const path = joinUnderRoot(project.progressDir, progressFileName(taskId))
      // FIX-30 **豁免（有意为之，不是漏接）**：进度档是**活态单写者文件**——实时推进、≤400 字、
      // 高频改写，且它自己的历史由**会话记录**承载；每更一次就备份只会堆出几百份无价值副本喵。
      // 故此处保持裸写；doc_emit / bugfix_note（覆盖的是知识资产）则必须走 writeWithBackup 喵。
      // 口径见 DESIGN §9-26「豁免」。
      await writeFile(path, body, 'utf8')

      const now = new Date().toISOString()
      const existing = store.getTask(taskId)
      await store.putTask(existing ? { ...existing, updatedAt: now } : taskRecord({ taskId, status: 'open', updatedAt: now }))
      return { path, chars, warnings }
    },
  }))

  registerOne(defineTool({
    name: 'bugfix_note',
    description: '把一次 Bug 修复总结落盘到 [位置]（产出目录），返回绝对路径喵。'
      + '总纲 §7 要求：修完上级指定或严重的 Bug 后必须留一份修复总结。',
    parameters: {
      title: { type: 'string', required: true, description: '修复标题。' },
      cause: { type: 'string', required: true, description: '成因分析。' },
      fix: { type: 'string', required: true, description: '修复方式。' },
      files: { type: 'array', items: { type: 'string' }, description: '涉及的文件列表。' },
      taskId: { type: 'string', description: '可选：任务号（用于文件名与台账归并）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string', required: true },
          chars: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已落盘修复总结：${value.path}（${value.chars} 字）` + (value.gitHint ? `\n${value.gitHint}` : '') }],
    },
    presentCall: () => ({ card: 'generic', title: '落盘修复总结', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const title = String((args && args.title) || '').trim()
      if (!title) throw new Error('agent-contract: bugfix_note 需要 title')
      const taskId = String((args && args.taskId) || '').trim()
      const files = listOf(args && args.files)
      const body = [
        '## 成因', '', String((args && args.cause) || '(未提供)'), '',
        '## 修复', '', String((args && args.fix) || '(未提供)'), '',
        '## 涉及文件', '', ...(files.length ? files.map((file) => `- ${file}`) : ['(未提供)']), '',
      ].join('\n')

      const label = exec && exec.agent ? await agentLabel(ctx, exec.agent, exec.signal) : null
      const role = label ? (parseMemberName(label) || {}).role || null : null
      const path = joinUnderRoot(project.deliverablesDir, bugfixFileName(taskId, title))
      const chars = countChars(body)
      await ensureDir(project.deliverablesDir)
      // FIX-30：修复总结同样是知识资产，同名重发也是**覆盖** → 走同一道备份闸门喵
      const existing = store.getDoc(path)
      const written = await writeWithBackup({
        project,
        path,
        text: renderFrontMatter({
          taskId: taskId || null,
          role,
          tier: 0,
          keywords: [],
          relatedFiles: files,
          createdAt: new Date().toISOString(),
        }) + body,
        stampIso: new Date().toISOString(),
      })
      if (!written.ok) {
        throw new Error(`agent-contract: bugfix_note 写入已中止（${written.action === 'overwrite' ? '覆盖前备份失败' : '写入失败'}）：${written.error}`)
      }
      // FIX-62：写动作前给一句 git 基线提示（每个项目只提示一次；非仓库/干净则没有）喵
      const gitHint = await maybeBaselineHint({ project })
      const overwrote = written.action === 'overwrite'
      const overwriteCount = overwrote ? Number((existing && existing.overwriteCount) || 0) + 1 : 0

      // tier 0 = 非三档文档，不参与 doc_meta_missing 喵
      await store.putDoc(docRecord({
        path, tier: 0, taskId: taskId || null, title, owner: label, chars,
        relatedFiles: files, missingSections: [], legacy: false,
        overwriteCount,
        lastBackupPath: overwrote ? written.backupPath : null,
      }))
      return {
        path,
        chars,
        warnings: overwrote ? [`已覆盖同名旧版（第 ${overwriteCount} 次覆盖）；旧版备份：${written.backupPath}`] : [],
        overwrote,
        backupPath: written.backupPath,
        ...(gitHint ? { gitHint } : {}),
        overwriteCount,
      }
    },
  }))

  registerOne(defineTool({
    name: 'ledger_rebuild',
    description: '扫描磁盘（任务目录 / 进度目录 / 产出目录）重建台账索引喵。'
      + '台账只是可从零重建的缓存，磁盘文档才是真相——换后端、丢数据、跨机器后调它即可恢复。'
      + '会删除文件已不存在的 docs/tasks 记录；members 只增量补齐，不删除（session id 与状态是磁盘上没有的运行时事实）。'
      + '不带 front-matter 的存量旧档会被标为 legacy，不参与 doc_meta_missing 审计。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          summary: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => {
        const s = value.summary
        return [{
          type: 'text',
          text: `台账已重建：文档 ${s.docs.scanned} 篇（删除 ${s.docs.removed}，legacy ${s.docs.legacy}）· `
            + `任务 ${s.tasks.scanned} 条（删除 ${s.tasks.removed}）· 成员新增 ${s.members.added}（共 ${s.members.total}）`
            + (s.needsLibrarian.length
              ? `\n需馆员兜底 ${s.needsLibrarian.length} 条（清单非空，可唤醒馆员）：\n`
                + s.needsLibrarian.slice(0, 20).map((item) => `- [${item.code}] ${item.path}：${item.detail}`).join('\n')
              : '\n派生器未报出任何需人工判断的条目（不必唤醒馆员）')
            + failureLines(s.writeFailures),
        }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '重建台账索引', kind: 'execute' }),
    async execute(_args, exec) {
      const { project, store, key } = await projectFor(exec)
      const summary = await rebuildLedger({ store, project })
      // 全量兜底：索引必须跟台账一起刷新，否则事件路径与 rebuild 路径会漂移喵
      // FIX-58：索引也按项目分家，重建谁的台账就刷谁的索引喵
      if (ledger && typeof ledger.rebuildIndexFor === 'function' && key) ledger.rebuildIndexFor(key)
      else if (ledger && typeof ledger.rebuildIndex === 'function') ledger.rebuildIndex()
      // 台账变更即刷新面板派生快照（这就是「台账变更后重写」的节流口径：批次边界写一次）
      await writePanelSnapshot({ store, project, audit: null })
      return { summary }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_tags',
    description: '图书管理员的 **tags 步骤**喵（FIX-25）：对「正文比头部新」的档重算 keywords。'
      + '判据与审计项 `doc_tags_stale` **同源**（文件 mtime 晚于 front-matter 的 createdAt/librarianTouchedAt），'
      + '关键词与派生器同源（标题 + 固定小节正文 + 术语表展开）。'
      + '三条纪律：① **只增不删**既有 keywords ② 即使一个词都不用加也会**盖章**'
      + '（librarianTouchedAt + librarianChanges）——"复核过、无需变更"同样是事实，不盖章下轮还会报警 '
      + '③ 不改正文结论。写前按 §9-26 备份；备份失败即跳过该篇并记 warning。',
    parameters: {
      dryRun: { type: 'boolean', description: '可选：只报告会盖章/新增哪些词，不落盘。' },
      limit: { type: 'number', description: '可选：本次最多处理几篇，缺省不限。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { report: { type: 'object', additionalProperties: true, required: true } },
      },
      render: (_args, value) => {
        const r = value.report
        const lines = [
          `关键词复核${r.dryRun ? '（试算，未落盘）' : ''}：扫描 ${r.scanned} 篇，过期 ${r.stale} 篇，`
            + `盖章 ${r.stamped} 篇，新增词 ${r.added} 个`,
        ]
        for (const file of r.files) lines.push(`- ${file.path}：${file.added.length ? `新增 ${file.added.join('、')}` : '无需变更（仅盖章）'}`)
        if (r.changelog && r.changelog.appended) lines.push(`变更日志：${r.changelog.path}`)
        return [{ type: 'text', text: lines.join('\n') + failureLines(r.writeFailures) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '馆员关键词复核', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const limit = Number(args && args.limit) > 0 ? Math.floor(Number(args.limit)) : undefined
      const report = await refreshStaleTags({
        project, store, dryRun: args && args.dryRun === true, limit,
      })
      return { report }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_patrol',
    description: '图书管理员的格式面巡检 + 直修喵。'
      + '**上游闸门：只有元数据派生器报出的 needs_librarian 清单非空时才会真的干活**——'
      + '清单为空则直接空转返回，不读不改任何档（省唤醒、省 token）。'
      + '被唤醒后只处理清单点名的档，且只动格式不动正文结论：补固定小节占位、'
      + '给三级档回贴同任务一/二级档的绝对路径；字数超标与命名不合规范只上报不自动改。'
      + '每次直修都会写 librarianTouchedAt / librarianChanges，并在核心数据库留一条变更日志。'
      + '存量旧档（无 front-matter）请先用 ledger_backfill 或 librarian_backfill 补元数据。',
    parameters: {
      taskId: { type: 'string', description: '可选：只看该任务号下的待办；缺省则处理全部待办。' },
      limit: { type: 'number', description: '可选：本次最多处理几篇，默认 20。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          report: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => {
        const r = value.report
        if (r.gated) {
          return [{ type: 'text', text: '派生器的 needs_librarian 清单为空，馆员无需唤醒（未读、未改任何档）' }]
        }
        const lines = [`馆员巡检：待办 ${r.queue.length} 条，检查 ${r.inspected} 篇，直修 ${r.changed} 篇`]
        for (const file of r.files) lines.push(`- 已修 ${file.path}：${file.changes.join('；')}`)
        for (const item of r.reportOnly) lines.push(`- 仅上报 [${item.code}] ${item.path}：${item.detail}`)
        if (r.changelog && r.changelog.appended) lines.push(`变更日志：${r.changelog.path}`)
        return [{ type: 'text', text: lines.join('\n') + failureLines(r.writeFailures) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '馆员格式巡检与直修', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const limit = Number(args && args.limit) > 0 ? Math.floor(Number(args.limit)) : 20
      const report = await patrol({ project, store, taskId: args && args.taskId, limit })
      return { report }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_backfill',
    description: '给存量旧档补元数据的**限量试跑**（默认 5 篇 + 报告，不做全量）喵。'
      + '只补 front-matter 的派生字段，不补固定小节、不改文件名——命名规范化与全量回填留到后续里程碑。'
      + '补上头部后该档不再是「无头旧档」，其档级仍为 0，因此不参与 doc_meta_missing 审计。'
      + '需要全量请用 ledger_backfill。',
    parameters: {
      limit: { type: 'number', description: '可选：本次最多回填几篇，默认 5（试跑限量）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          report: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => {
        const r = value.report
        const lines = [`legacy 回填试跑：扫描 ${r.scanned} 篇，尝试 ${r.attempted} 篇，回填 ${r.updated} 篇`]
        for (const file of r.files) lines.push(`- 已回填 ${file.path}：${file.changes.join('；')}`)
        return [{ type: 'text', text: lines.join('\n') + failureLines(r.writeFailures) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'legacy 回填试跑', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const limit = Number(args && args.limit) > 0 ? Math.floor(Number(args.limit)) : 5
      const report = await autoBackfill({ project, store, limit, legacyOnly: true })
      return { report }
    },
  }))

  registerOne(defineTool({
    name: 'ledger_backfill',
    description: '元数据批量自动补全入口（`ledger_backfill --auto`）喵。'
      + '全量扫描产出目录，用确定性派生器补齐 front-matter 各字段（任务号 / 档级 / 角色 / 时间 / 字数 / '
      + 'relatedFiles / 关键词术语表展开），**零模型调用**喵。'
      + '只补「缺的且派生得出来的」字段，绝不覆盖已有的人工值；只动元数据，不补固定小节、不改文件名。'
      + '输出 needs_librarian 报告——只有该清单非空才需要唤醒馆员喵。',
    parameters: {
      auto: { type: 'boolean', required: true, description: '必须为 true（对应命令行 `--auto`）；否则本工具拒绝执行。' },
      dryRun: { type: 'boolean', description: '可选：只出报告不落盘，用于先看会改什么。' },
      limit: { type: 'number', description: '可选：最多处理几篇；缺省为全量。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          report: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => {
        const r = value.report
        const lines = [
          `自动补元数据${r.dryRun ? '（试算，未落盘）' : ''}：扫描 ${r.scanned} 篇，补全 ${r.updated} 篇；`
          + `术语表 ${r.glossary.terms} 条（${r.glossary.path}）`,
        ]
        for (const file of r.files.slice(0, 20)) lines.push(`- ${file.path}：${file.changes.join('；')}`)
        lines.push(r.needsLibrarian.length
          ? `需馆员兜底 ${r.needsLibrarian.length} 条（清单非空，可唤醒馆员）：\n`
            + r.needsLibrarian.slice(0, 20).map((item) => `  [${item.code}] ${item.path}：${item.detail}`).join('\n')
          : '派生器未报出任何需人工判断的条目（不必唤醒馆员）')
        return [{ type: 'text', text: lines.join('\n') + failureLines(r.writeFailures) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '批量自动补元数据', kind: 'edit' }),
    async execute(args, exec) {
      if (!(args && args.auto === true)) {
        throw new Error('agent-contract: ledger_backfill 必须带 auto=true（对应命令行 --auto）')
      }
      const { project, store } = await projectFor(exec)
      const limit = Number(args && args.limit) > 0 ? Math.floor(Number(args.limit)) : undefined
      const report = await autoBackfill({ project, store, limit, dryRun: args.dryRun === true })
      return { report }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_relocate',
    description: '图书管理员的**通用搬迁能力**喵：把一批「源路径 → 目标路径」搬过去（分类归位 / 临时文件挪走都靠它）。'
      + '**默认 dryRun**：先出「将移动 N 项 / 冲突 C 项 / 影响引用 R 处」的预演，确认后再传 `dryRun: false` 落盘。'
      + '护栏：目标已存在**拒收**（不覆盖）· 写前备份到 `.agent-contract/backups/<时间戳>/` · '
      + '**搬完自动修正引用方**（`relatedFiles`、其它文档里的路径指针、索引类派生物）· 留痕（`librarianTouchedAt`/`librarianChanges`）· '
      + '回执给**回滚清单**（新 → 旧）· **只移动/改名，不改正文**（正文指纹逐篇给你验）。',
    parameters: {
      moves: { type: 'array', required: true, items: { type: 'json' }, description: '形如 [{ from: "绝对路径", to: "绝对路径" }]；一批一次。' },
      dryRun: { type: 'boolean', description: '默认 true = 只预演不落盘；确认预演后再传 false。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { relocation: { type: 'object', additionalProperties: true, required: true } },
      },
      render: (_args, value) => {
        const r = value.relocation
        if (r.dryRun) {
          const lines = [`搬移预演（未落盘）：将移动 ${r.planned.length} 项 / 冲突 ${r.conflicts.length} 项 / 影响引用 ${r.refsTotal} 处`]
          for (const move of r.planned.slice(0, 20)) lines.push(`- 将移动 ${move.oldPath} → ${move.newPath}`)
          if (r.planned.length > 20) lines.push(`- …（其余 ${r.planned.length - 20} 项略）`)
          for (const row of r.refs.filter((item) => item.count)) lines.push(`- 引用：${row.oldPath} 被 ${row.count} 篇提到`)
          for (const item of r.conflicts) lines.push(`- ✗ 拒收 ${item.from || '(空)'} → ${item.to || '(空)'}：${item.reason}`)
          if (r.planned.length) lines.push('确认无误后传 `dryRun: false` 落盘（会自动备份、同步引用、留痕，并给回滚清单）喵')
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`搬移完成：移动 ${r.moved} 项，更新引用 ${r.refsUpdated} 处`]
        for (const file of r.files.slice(0, 20)) lines.push(`- ${file.from} → ${file.to}`)
        for (const item of r.conflicts) lines.push(`- ✗ 拒收 ${item.from || '(空)'}：${item.reason}`)
        for (const item of r.failed) lines.push(`- 失败 ${item.target}：${item.error}`)
        const changed = (r.bodyProof || []).filter((row) => !row.same)
        lines.push(changed.length
          ? `正文指纹：**${changed.length} 篇不一致（要看）**：${changed.slice(0, 5).map((row) => row.path).join('、')}`
          : `正文指纹：逐篇一致 ✓（只移动/改名，正文零改动；共验 ${(r.bodyProof || []).length} 篇）`)
        if (r.rollback.length) {
          lines.push(`回滚清单（${r.rollback.length} 条，反着再搬一次即可撤单）：`)
          for (const row of r.rollback.slice(0, 5)) lines.push(`- ${row.from} → ${row.to}`)
          if (r.rollback.length > 5) lines.push(`- …（其余 ${r.rollback.length - 5} 条略）`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '馆员搬移（默认先预演）', kind: 'move' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const moves = Array.isArray(args && args.moves) ? args.moves : []
      if (!moves.length) throw new Error('agent-contract: librarian_relocate 需要非空 moves（[{ from, to }]）')
      // **默认 dryRun**（单据要求：先预演，确认后才落盘）喵
      const dryRun = !(args && args.dryRun === false)
      const relocation = await relocateBatch({ project, store, moves, dryRun })
      return { relocation }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_sweep',
    description: '图书管理员的**一轮治理**（M4 交付物 2 的批次入口）喵。按顺序做：'
      + '审计人话化（产出给主代理的待办清单）→ 归档建议落地（`archive_suggest`）→ 去重（重复档归档）'
      + '→ 命名与档级规范化（改名 + 更新引用）→ 核心数据库/索引维护（进度计数 / 阻塞清单 / 文档索引）'
      + '→ 坑库 README 索引 → 术语表缺口报告喵。'
      + '**正文零改动**：只动元数据、命名、位置与索引；每处改动都有 librarianTouchedAt / librarianChanges 留痕喵。'
      + '`dryRun: true` 只出报告不落盘，用于先看会动什么喵。',
    parameters: {
      dryRun: { type: 'boolean', description: '可选：只出报告不落盘（不归档、不改名、不写索引）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { result: { type: 'object', additionalProperties: true, required: true } },
      },
      render: (_args, value) => {
        const r = value.result
        const lines = [r.todos]
        // FIX-22：试算必须先给**三类写入明细**（将覆盖含旧指纹 / 将新建 / 将改名）——人审后才执行喵
        if (r.dryRun && r.plan) {
          lines.push('', `写入预演（${planSummary(r.plan)}）：`, ...renderWritePlan(r.plan))
        }
        lines.push('', `本轮动作${r.dryRun ? '（试算，未落盘）' : ''}：`)
        lines.push(`- 归档：移动 ${r.archive.moved} 篇，更新引用 ${r.archive.refsUpdated} 处`)
        lines.push(`- 去重：归档重复档 ${r.dedupe.duplicates} 篇`)
        lines.push(`- 命名规范化：候选 ${r.naming.candidates} 篇，改名 ${r.naming.moved} 篇`)
        // FIX-19：试算必须能看出**旧名 → 新名**，否则用户没法在落盘前判断计划对不对喵
        for (const move of (r.naming.files || []).slice(0, 20)) {
          lines.push(`    ${basename(move.oldPath)} → ${basename(move.newPath)}`)
        }
        if ((r.naming.files || []).length > 20) lines.push(`    …（其余 ${r.naming.files.length - 20} 篇省略）`)
        for (const item of r.naming.blocked || []) lines.push(`- 已拦下（不制造重复前置的任务号）：${basename(item.target)} → ${item.expected}`)
        // FIX-32：台账里的脏标题会被回写（治本），真跑与试算都要报出来喵
        if (r.naming.titlesFixed) lines.push(`- 台账标题回写（按文件名重算）：${r.naming.titlesFixed} 篇`)
        if (r.naming.titlesPending) lines.push(`- 台账标题待回写（按文件名重算，本轮试算未落）：${r.naming.titlesPending} 篇`)
        // FIX-25：tags 步骤（关键词复核 + 盖章）
        if (r.tags) {
          lines.push(`- 关键词复核：过期 ${r.tags.stale} 篇，盖章 ${r.tags.stamped} 篇，新增词 ${r.tags.added} 个`
            + (r.tags.dryRun ? '（试算）' : ''))
        }
        // FIX-26：索引与真身分家后要把**两个**路径都打出来，否则用户不知道 changelog 写到哪去了喵
        if (r.core) {
          lines.push(`- 派生态索引：成员 ${r.core.members} / 任务 ${r.core.tasks} / 文档 ${r.core.docs}，阻塞 ${r.core.blocked} 条 → ${r.core.path}`)
          lines.push(`- 核心数据库真身（changelog 落点）：${r.core.corePath}`)
          lines.push(...diffLines('派生态索引', r.core))
          for (const stray of r.core.strays || []) {
            lines.push(`- 发现错位同名档（**只读不写**${stray.hasOwnIdentity ? '' : '，无自述身份'}）：${stray.path}`)
          }
        }
        if (r.pitfall) {
          lines.push(`- 坑库索引：${r.pitfall.entries} 条 → ${r.pitfall.path}${r.pitfall.wrote ? '' : '（内容未变，未重写）'}`)
          lines.push(...diffLines('坑库索引', r.pitfall))
          if (r.pitfall.backupPath) lines.push(`    旧版已备份：${r.pitfall.backupPath}`)
        }
        if (r.glossaryGaps.length) lines.push(`- 术语表缺口：${r.glossaryGaps.slice(0, 10).map((gap) => `${gap.word}(${gap.count})`).join('、')}`)
        const failed = [
          ...(r.archive.failed || []), ...(r.naming.failed || []), ...(r.dedupe.failed || []),
          ...((r.tags && r.tags.writeFailures) || []),
        ]
        for (const item of failed) lines.push(`- 失败 ${item.target}：${item.error}`)
        // FIX-62 / FIX-67：基线提示与自动提交结果都要看得见（**不静默**）喵
        if (value.gitHint) lines.push(value.gitHint)
        // FIX-66：治理结束自动出**验收报告**（动作清单 / 正文零改动 / 引用残留 / 审计前后）喵
        if (r.verification) lines.push('', ...renderVerification(r.verification))
        const autoLine = autoCommitLine(value.autoCommit)
        if (autoLine) lines.push(autoLine)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '馆员一轮治理', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const result = await librarianSweep({
        project, store, config: pluginConfig, dryRun: args && args.dryRun === true,
      })
      // FIX-62：写动作回执带 git 基线提示（每个项目只提示一次）喵
      const gitHint = await maybeBaselineHint({ project })
      // FIX-67：可选自动提交（默认关）—— 一次治理**最多一次提交**，且只 add 本次动到的路径喵
      const auto = await maybeAutoCommit({ project, config: pluginConfig, result })
      return { result, ...(gitHint ? { gitHint } : {}), ...(auto ? { autoCommit: auto } : {}) }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_glossary',
    description: '维护术语表喵：把 `主词 + 同义词` 并入 `paths.docsDirs[0]/术语表.md`（同主词合并、同义词去重）喵。'
      + '术语表供 keywords 自动展开，是提升 grep/glob 命中率的正式通道喵。',
    parameters: {
      entries: { type: 'array', required: true, items: { type: 'json' }, description: '形如 [{ term: "分裂炮台", synonyms: ["scatter"] }]。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { report: { type: 'object', additionalProperties: true, required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `术语表已更新：共 ${value.report.terms} 条（新增主词 ${value.report.added}）→ ${value.report.path}` }],
    },
    presentCall: () => ({ card: 'generic', title: '维护术语表', kind: 'edit' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const entries = Array.isArray(args && args.entries) ? args.entries : []
      if (!entries.length) throw new Error('agent-contract: librarian_glossary 需要非空 entries')
      return { report: await mergeGlossary({ project, entries }) }
    },
  }))

  registerOne(defineTool({
    name: 'librarian_archive',
    description: '图书管理员的归档动作喵（**审计只建议，动手在这里**）喵。'
      + '按 DESIGN §5.5 的**时间分片**把指定档移进 `archive/<YYYY-MM>/`，一次做四件事：'
      + '移动 → 留痕（librarianTouchedAt / librarianChanges）→ **更新引用**（别的档里提到旧路径的一起改）→ 更新台账喵。'
      + '每篇单独兜错，一篇失败不影响其余喵。路径来自 `audit_scan` 的 `archive_suggest` 建议。',
    parameters: {
      paths: { type: 'array', required: true, items: { type: 'string' }, description: '要归档的文档绝对路径列表。' },
      dryRun: { type: 'boolean', description: '可选：先出「将归档 N 篇 / 各自 → archive/<月>/ / 冲突 C 项」的预演，不落盘（**默认 true**）。' },
      monthOf: { type: 'string', description: "可选：分片口径 —— 'obsolete'（默认，按该档被标废/被判定归档的月份）或 'now'（按执行时刻）。" },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          report: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => {
        const r = value.report
        // FIX-87 ①：**预演**要先看得见"将归档 N 篇 / 各自 → archive/<月>/ / 冲突 C 项"（默认就是预演）喵
        if (r.dryRun) {
          const lines = [`归档预演（未落盘）：将归档 ${(r.willArchive || []).length} 篇 / 冲突 ${(r.conflicts || []).length} 项`]
          for (const row of r.willArchive || []) lines.push(`- 将移动 ${row.from} → ${row.to}`)
          for (const item of r.conflicts || []) lines.push(`- ✗ 拒收 ${item.from}：${item.reason}`)
          lines.push('口径：默认按**该档被标废/被判定归档的月份**分片（`monthOf: "obsolete"`）；要按执行时刻就传 `monthOf: "now"`喵')
          lines.push('确认无误后传 `dryRun: false` 落盘喵')
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`归档完成：移动 ${r.moved} 篇，更新引用 ${r.refsUpdated} 处`]
        for (const file of r.files) lines.push(`- ${file.from} → ${file.to}`)
        for (const item of r.failed) lines.push(`- 失败 ${item.target}：${item.error}`)
        if (r.changelog && r.changelog.appended) lines.push(`变更日志：${r.changelog.path}`)
        // FIX-62 / FIX-67：基线提示与自动提交结果都要看得见（**不静默**）喵
        if (value.gitHint) lines.push(value.gitHint)
        const autoLine = autoCommitLine(value.autoCommit)
        if (autoLine) lines.push(autoLine)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '执行归档', kind: 'move' }),
    async execute(args, exec) {
      const { project, store } = await projectFor(exec)
      const paths = listOf(args && args.paths)
      if (!paths.length) throw new Error('agent-contract: librarian_archive 需要非空 paths')
      // FIX-87 ①：**默认先预演**（"不可预演"正是上次归档事故的直接根因）喵
      const dryRun = !(args && args.dryRun === false)
      const report = await archiveDocs({ project, store, paths, dryRun, monthOf: (args && args.monthOf) || 'obsolete' })
      const gitHint = await maybeBaselineHint({ project })
      // FIX-67：归档是"移动 + 改引用"，同样走一次（且只一次）可选提交喵
      const auto = await maybeAutoCommit({
        project,
        config: pluginConfig,
        result: { ...report, dryRun: false },
        changed: [...(report.files || []).flatMap((file) => [file.from, file.to])],
        taskId: '',
        summary: `归档 ${report.moved} 篇 / 更新引用 ${report.refsUpdated} 处`,
      })
      return { report, ...(gitHint ? { gitHint } : {}), ...(auto ? { autoCommit: auto } : {}) }
    },
  }))

  registerOne(defineTool({
    name: 'audit_scan',
    description: '跑一轮契约工作流审计（DESIGN §5.7）喵。'
      + '**警告制：只报不拦** —— 不会改任何文件、不会阻断任何流程，判定为"该修"的只写进报告交给图书管理员喵。'
      + '检查项由 config.audit.checks 开关控制；**写错检查项名会直接报错**（不静默忽略）喵。'
      + '返回 `{ level, items, humanReport, counts }`，humanReport 是按严重度排序的人话清单（路径 + 原因 + 建议动作）喵。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          level: { type: 'string', required: true },
          items: { type: 'array', required: true, items: { type: 'json' } },
          humanReport: { type: 'string', required: true },
          counts: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.humanReport }],
    },
    presentCall: () => ({ card: 'generic', title: '契约审计（只报不拦）', kind: 'read' }),
    async execute(_args, exec) {
      const { project, store } = await projectFor(exec)
      // FIX-96 ②（用户约束）：**三处同源** —— 这条工具、启动自愈、面板「强制刷新」按钮
      // 一律走 `refreshPanel`（算审计 + 重写快照，顺带更新写入方版本标记），不许各写一套喵。
      // FIX-84/90：归档会话与父链这两个宿主侧事实也在那个实现里统一注入喵
      const { report } = await refreshPanel({ ctx, config: pluginConfig, store, project })
      return report
    },
  }))

  registerOne(defineTool({
    name: 'doc_search',
    description: '检索 L0 层（DESIGN §5.5）：先在台账 docs 表里按 taskId / role / tier 过滤缩小范围，'
      + '**只对候选**做轻量匹配，返回「路径 + 命中原因 + 命中行 + 建议精读的小节」喵。'
      + '**只指路，不替代 grep，也不返回整篇正文**——拿到 suggest 后用 read 精读 `<路径>#小节` 即可；'
      + '需要全文正则定位行号请用宿主的 grep（L2），需要找文件名用 glob（L1）喵。'
      + 'query 支持空白分隔的关键词或 `/正则/flags`；泛词（研究/产出/文件/仓库/md…）不作召回依据，纯泛词查询返回零召回喵。',
    parameters: {
      query: { type: 'string', required: true, description: '关键词（空白分隔）或 /正则/flags。' },
      taskId: { type: 'string', description: '可选：限定任务号。' },
      role: { type: 'string', description: '可选：限定产出角色。' },
      tier: { type: 'number', description: '可选：限定档级 1 / 2 / 3。' },
      limit: { type: 'number', description: '可选：最多返回几条，默认 10。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          results: { type: 'array', required: true, items: { type: 'json' } },
          suggest: { type: 'array', required: true, items: { type: 'string' } },
          scanned: { type: 'number', required: true },
          filtered: { type: 'number', required: true },
          strategy: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const lines = [
          `doc_search：扫描 ${value.scanned} 篇 → L0 过滤后 ${value.filtered} 篇 → 命中 ${value.results.length} 篇（strategy ${value.strategy}）`,
        ]
        for (const row of value.results) {
          lines.push(`- #${row.rank} score=${row.score} ${row.path}`)
          lines.push(
            `  命中原因：${row.hitReason.join('、') || '(无)'}`
            + `（关键词 ${row.matchedIn.keywords.length} / 标题 ${row.matchedIn.title.length} / 正文 ${row.matchedIn.body.length}）`,
          )
          for (const snippet of row.snippets) lines.push(`  L${snippet.line}: ${snippet.text}`)
        }
        if (value.suggest.length) lines.push('建议精读：', ...value.suggest.map((item) => `- ${item}`))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '检索文档（L0 指路）', kind: 'search' }),
    async execute(args, exec) {
      // FIX-58：检索也要按**调用方所在项目**分域——否则在 A 项目里搜出 B 项目的档喵
      const { store, key } = await projectFor(exec)
      return docSearch({
        store,
        index: ledger && typeof ledger.indexFor === 'function' && key ? ledger.indexFor(key) : (ledger ? ledger.index : undefined),
        query: args && args.query,
        taskId: args && args.taskId,
        role: args && args.role,
        tier: args && args.tier,
        limit: args && args.limit,
      })
    },
  }))
}
