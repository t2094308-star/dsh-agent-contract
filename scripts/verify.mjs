import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import * as plugin from './index.js'
import { isAbsolutePath, joinUnderRoot, resolveProject } from './src/project.js'
import {
  DEFAULT_STRUCTURE, PROJECT_META_REL, STRUCTURE_CANDIDATES, assertInsideRoot, createProjectResolver, deriveProjectName,
  hasExplicitPaths, isInsideRoot, pathsFromStructure, planStructure, readProjectMeta, resolveAdaptiveProject, resolveRoot,
  workspaceRootOf,
  // FIX-95：启动自愈要扫**宿主已登记的工作区**（不依赖会话活动）喵
  workspaceRootsOf,
  // FIX-98：临时目录同源算法（从已解析的路径算，**不看目录是否存在**）喵
  tempDirInfo,
  tempDirInfoOfPaths,
} from './src/project/adaptive.js'
import { createProjectRegistry } from './src/project/registry.js'
// FIX-62 / FIX-67：git 探测与可选提交（注入假 git 逐条断言护栏）喵
import { autoCommit, autoCommitLine, baselineHint, gitStatus, maybeBaselineHint, resetBaselineHints, touchesFiles } from './src/project/git.js'
import { OWNERSHIP_SENTENCE, ROLE_GATE_TOOLS } from './src/delegation/role-gate.js'
import { maybeAutoCommit } from './src/tools.js'
import { auditDiff, auditSummary, collectActions, diffBodies, findReferenceLeftovers, renderVerification, snapshotBodies } from './src/librarian/verify.js'
// FIX-64 / FIX-68：作业登记卡（字段规范/模板/交付校验）与占用冲突审计喵
import { TASK_CARD_REQUIRED, TASK_CARD_SPEC, TASK_CARD_SPEC_MARK, TASK_CARD_TEMPLATE, checkTaskCardFile, isActiveStatus, modeOf, normalizeOccupancyPath, occupancyConflicts, parseTaskCard } from './src/ledger/taskcard.js'
// FIX-70：渐进式披露（指针/速览/脏路径判据）喵
import { dirtyRelatedPaths, missingProgressiveLink, pointersFor, quickView } from './src/ledger/progressive.js'
// FIX-80/82：行尾保持与布局版本喵
import { alignEol, eolStyleOf, splitLinesWithEol } from './src/librarian/backup.js'
// FIX-84/85/86/89：归档会话 / 角色元数据（产出形态 + 能力标签）/ 内置流程喵
import { archivedSessionIdsOf, PROJECT_LAYOUT_VERSION as PLV } from './src/project/adaptive.js'
import { ROLE_META, capabilitiesOf, deliverableKindsOf } from './src/contract/roles.js'
// FIX-90：归档判定（归一化 + 父链）喵
import { archivedOwners, archivedViaChain, isArchivedSession, normalizeArchivedSet, parentSessionOf, sessionIdVariants, sessionParentIndexOf } from './src/audit/archived.js'
// FIX-91 / FIX-101：归档读取与父链的**宿主来源**（活会话 + 会话持久化，审计三处共用）喵
import { archivedSessionsOf } from './src/audit/archived.js'
// FIX-93：常驻单例"为什么没能复用"的判据喵
import { activeMemberNamed, delegationFailure, residentReuseReason } from './src/delegation/channels.js'
import { BUILTIN_FLOWS, getFlow, listFlows } from './src/contract/flows.js'
import { PROJECT_LAYOUT_VERSION, PROJECT_META_VERSION, writeProjectMeta } from './src/project/adaptive.js'
// FIX-69：文档区硬限制 / 两级目录 / 类型归位喵
import { DOC_KIND_NAMES, assertSafeName, countDiskDocs, docSpecLines, isTempPath, resolveDocArea, scanDocAreas, tierDirOf } from './src/ledger/docarea.js'
import { kindFileName, kindFromFileName, stripArchiveCaret, tierSubdir } from './src/ledger/naming.js'
import { MANDATE_TEMPLATE, findUnfilledSlots, renderMandate } from './src/contract/mandate.js'
import { BUILTIN_ROLES, SEARCH_LADDER, getRole, listRoles } from './src/contract/roles.js'
import { DEFAULT_BUDGETS, NON_MANDATE_BUDGET, assembleSegments, buildContract, classifyChars, fitSlicesToBudget, truncateToChars } from './src/contract/assemble.js'
// FIX-75：交接语境用相对项目根写法喵
import { relToRootText } from './src/contract/assemble.js'
import { SLICE_BUDGET, countChars, extractKeywords, isStopWord, searchDocs, searchStopWords } from './src/contract/slices.js'
import { parentIdentity, registerChannels, resolveToolFilter, routeOptions } from './src/delegation/channels.js'
import { MODEL_SOURCE_TEXT, modelSourceText, resolveEffectiveModel } from './src/delegation/effective-model.js'
import { DOMAIN_NAMES, DOMAIN_SPECS, docSchema, memberSchema, taskSchema } from './src/ledger/domains.js'
import {
  classifyLength, countChars as countDocChars, missingSections, parseFrontMatter, renderFrontMatter,
} from './src/ledger/docmeta.js'
import {
  bugfixFileName, docFileName, hasDoubledTaskPrefix, memberName, parseDocFileName, parseMemberName, slug, stripTaskPrefix, titleFromFileName,
} from './src/ledger/naming.js'
import { assertTransition, canTransition, isOpenTask } from './src/ledger/state.js'
import {
  CORE_DB_SECTIONS, CORE_INDEX_FILE, DERIVED_MARKERS, appendChangelog, appendCoreChangelog, archiveDocs, archiveTargetPath,
  buildWritePlan, conformDocAreas, correctCaretClaim, coreDbDir, coreDbPath, coreIndexPath, findStrayCoreDbs, glossaryGaps, librarianSweep, mergeGlossary,
  markArchivePending, patrol, pitfallIndexPath, planNaming, rebuildCoreDatabase, rebuildPitfallIndex, refreshStaleTags, repairDanglingRefs, shardOf, syncDocTitles,
} from './src/librarian/duties.js'
import {
  BACKUP_DIR_REL, backupDirOf, backupPathOf, backupStamp, fingerprintText, planSummary, renderWritePlan, writeOutcome,
  writeWithBackup,
} from './src/librarian/backup.js'
import { INDEX_BLOCK_END, INDEX_BLOCK_START, diffStats, mergeIndexBlock, stripVolatile } from './src/librarian/merge.js'
import { findMisfiled, classifyDocPath, commonAncestorOf, isUnder } from './src/ledger/placement.js'
import { INDEX_FLUSH_DEFAULTS, attachIndexSync, createIndexSync, createSearchIndex } from './src/ledger/index-sync.js'
import { FTS_THRESHOLD, SCORE_WEIGHTS, docSearch, parseQuery } from './src/search/doc_search.js'
import vm from 'node:vm'
import { CHECK_IDS, CHECK_IMPLEMENTATIONS, OBSERVATION_IDS, OBSERVATION_LEVEL, assertKnownChecks, collectContracts, modelOfMember, residentOverlaps } from './src/audit/checks.js'
import { SUGGESTIONS, auditScan } from './src/audit/report.js'
import { PANEL_SYNC_DEFAULTS, attachPanelSync, createMultiPanelSync, createPanelSync } from './src/panel/snapshot-sync.js'
// FIX-96：**跑审计 + 重写快照**的唯一实现（工具 / 启动自愈 / 面板「强制刷新」三处同源）喵
import { refreshPanel, refreshReceiptText, runPanelAudit } from './src/panel/refresh.js'
// FIX-101/102/103：本轮解析结果 / 文档普查 / 类别索引（单一来源）喵
import { resolvedPathsLines } from './src/ledger/docarea.js'
// FIX-105：写回既有文件时的头部纪律（无头不补头 / 全 null 头不改写）喵
import { composeRewrittenFile } from './src/librarian/duties.js'
import { documentCensus } from './src/ledger/census.js'
import { kindIndexGaps, writeKindIndexes } from './src/librarian/indexes.js'
import { contractFingerprint, renderContinuationSlice } from './src/contract/assemble.js'
// FIX-97：运行版本 vs 磁盘版本（漂移判定）喵
import { loadedVersion, pluginVersion as pluginVersionOf, versionDrift } from './src/version.js'
// FIX-99 ④：全局共享文件清单（跨会话并存的常驻实例会写同一批）喵
import { globalSharedFiles, globalSharedFilesText } from './src/librarian/globals.js'
import {
  TODO_ROUTE_PATH, createTodoHandler, hashOf, hashText as hashTextHost, isTodoPathAllowed, isTrustedLocalRequest,
  normalizeHashInput, preserveTrailingNewline, toggleTodoLine,
} from './src/panel/todo-route.js'
import { listMarkdown } from './src/ledger/fs.js'
import { BADGE, MEMBER_FIELDS, buildSnapshot } from './src/panel/query.js'
import { PANEL_SNAPSHOT_SCHEMA_VERSION, annotatePanelSnapshot, buildPanelSnapshot, panelSnapshotPath, writePanelSnapshot } from './src/panel/snapshot.js'
import { fixDoc, inspectDoc } from './src/librarian/fixer.js'
import {
  NEEDS_CODES, deriveDocMeta, expandKeywords, extractPaths, isGenericKeyword, loadGlossary, markDuplicates, parseGlossary,
} from './src/ledger/derive.js'
import { rebuildLedger } from './src/ledger/rebuild.js'
import { keyOf, projectSlugOf } from './src/ledger/keys.js'
import { createLedger, createStore, docRecord, escalationRecord, memberRecord, projectKeyOf, taskRecord } from './src/ledger/store.js'

let step = 0
const ok = (msg) => console.log(`OK ${++step} ${msg}`)

/**
 * FIX-91 ②：占位条的**新**文案喵（口径有意反转，不是放宽）。
 *
 * 旧口径是「审计：数据源待接」——真机反馈"只说待接、不说怎么办"，用户对着一片空白不知道下一步。
 * 现在占位必须写明「尚无结论」并给**可执行**动作，紧随其后还有一行说明"面板只在有动作时写入、
 * 纯重启不会重算"（见 RISK：FIX-91 ⑤）喵。
 */
const AUDIT_PLACEHOLDER_TEXT = '审计：尚无结论（点「↻ 刷新」或让主代理跑一次 audit_scan）'

// ---------------------------------------------------------------- 插件四件套
assert.equal(plugin.name, 'agent-contract')
assert.deepEqual(plugin.inject, ['tools', 'subagents', 'storageDomain'])
assert.ok(plugin.Config, 'Config schema 存在')
assert.equal(typeof plugin.apply, 'function')
ok('插件四件套')

// ---------------------------------------------------------------- 配置层
const root = await mkdtemp(join(tmpdir(), 'ac-verify-'))
const cfg = plugin.Config({
  project: { name: 'Blockdustry', root, brief: '这是一个用于验证的项目简介。' },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs', '仓库/docs/坑'],
    // FIX-61：给上归档目录，主夹具才是"结构齐"的已初始化项目喵
    archiveDir: '仓库/docs/archive',
  },
  modelRoutes: { adversary: 'glm-4' },
})
assert.equal(cfg.budgets.softLimit, DEFAULT_BUDGETS.softLimit)
assert.equal(cfg.budgets.hardLimit, DEFAULT_BUDGETS.hardLimit)
assert.equal(cfg.budgets.warnOverSoftPct, 30)
assert.equal(cfg.budgets.mandateSoft, 1500)
assert.equal(cfg.budgets.mandateNoClip, true)
assert.equal(cfg.delegation.provider, 'spawn')
assert.deepEqual(cfg.roles, [])
assert.deepEqual(cfg.audit.checks, [])
ok('Config 默认值/覆盖')

const project = resolveProject(cfg)
await mkdir(project.tasksDir, { recursive: true })
await mkdir(project.progressDir, { recursive: true })
await mkdir(project.deliverablesDir, { recursive: true })
await mkdir(project.archiveDir, { recursive: true })
await mkdir(joinUnderRoot(project.root, '仓库/docs/研究'), { recursive: true })
// FIX-69：产出根下的档级子目录 + 临时文件去处（非类别目录）喵
for (const tier of ['L1', 'L2', 'L3']) await mkdir(joinUnderRoot(project.deliverablesDir, tier), { recursive: true })
await mkdir(project.tempDir, { recursive: true })
await mkdir(joinUnderRoot(project.root, '仓库/docs/坑'), { recursive: true })
await writeFile(joinUnderRoot(project.tasksDir, 'T-001.md'), '# T-001 迁移任务\n\n把 A 模块迁移到 B 布局，注意连锁操作。\n', 'utf8')
await writeFile(joinUnderRoot(project.deliverablesDir, 'T-001_debug.md'), '# debug\n\n连锁操作记录。\n', 'utf8')
await writeFile(joinUnderRoot(joinUnderRoot(project.root, '仓库/docs/坑'), '迁移坑.md'), '# 迁移坑\n\nA 模块迁移时连锁操作容易漏。\n', 'utf8')
// FIX-61：主夹具代表"**已初始化**的项目"（结构齐）⇒ 不该出现"尚未初始化"提示喵
await writeFile(joinUnderRoot(project.root, '待办.md'), '# 待办\n\n- [ ] 已初始化项目的待办\n', 'utf8')

// ---------------------------------------------------------------- 工具注册形状
const registered = []

/**
 * 假 storageDomain 喵：按真实 `DomainFacility` 的接口面实现（open → Domain.table → KvTable）喵。
 *
 * 两处刻意与真后端对齐，防止「绿灯撒谎」喵：
 * 1. **键校验照抄真后端**：`storage-json` 的 per-record 键必须 path-safe
 *    （`storage-json/src/per-record-unit.ts` 的 `SAFE_KEY_RE`），非法键即抛。
 *    内存桩若不校验，线上写不进的问题会被绿测试掩盖——这正是本轮线上实锤的教训喵。
 * 2. `put` 也走一次 zod 校验（真实领域在 loadAll 时校验），让 record schema 写错能立刻炸出来喵。
 *
 * 注意 `PATH_SAFE_RE` 是**独立抄一遍**的，故意不 import `keys.js` 的同名常量：
 * 若共用一份，常量本身写错时测试与实现会一起错，测试就失去意义了喵。
 */
const PATH_SAFE_RE = /^[a-zA-Z0-9_-]+$/

function assertSafeKey(key) {
  if (!PATH_SAFE_RE.test(String(key))) {
    throw new Error(`per-record key '${key}' is not path-safe (must match ${PATH_SAFE_RE})`)
  }
}

function fakeStorageDomain() {
  const opened = new Map()
  return {
    opened,
    async open(spec) {
      const tables = new Map(Object.keys(spec.tables).map((name) => [name, new Map()]))
      const schemaOf = (name) => spec.tables[name].valueSchema
      const domain = {
        name: spec.name,
        table(name) {
          const records = tables.get(name)
          if (!records) throw new Error(`domain '${spec.name}' declares no table '${name}'`)
          return {
            get: (key) => { assertSafeKey(key); return records.get(key) },
            entries: () => [...records.entries()][Symbol.iterator](),
            keys: () => [...records.keys()][Symbol.iterator](),
            get size() { return records.size },
            // 只给测试用的原始表：真实领域是在 loadAll 时才校验的，
            // 「介质里躺着一条不合 schema 的脏记录」是真实可能的状态，查询必须扛得住喵
            _records: records,
            put: async (key, value) => { assertSafeKey(key); records.set(key, schemaOf(name).parse(value)) },
            delete: async (key) => { assertSafeKey(key); return records.delete(key) },
            update: async (key, fn) => {
              assertSafeKey(key)
              const next = schemaOf(name).parse(fn(records.get(key)))
              records.set(key, next)
              return next
            },
          }
        },
        async close() {},
      }
      if (opened.has(spec.name)) throw new Error(`domain '${spec.name}' is already open`)
      opened.set(spec.name, domain)
      return domain
    },
  }
}

/**
 * ⚠️ 这**不是**宿主工具目录，**不得**被当成权威目录（DESIGN §9-24）喵。
 *
 * 它只列**本插件自己注册**的工具 —— 这正是插件上下文里 `ctx.tools.schemas()` 的真实视野喵。
 * 曾经把它手写成"宿主全量目录"塞进 schemas 桩，于是"剔除越权"永远测不出来（fixture 撒谎，
 * 真机上把 read/write/pwsh 全剔光、子智能体"能派活、不能干活"）喵。
 * 现在的用途只有一个：回归「**不完整目录下不得剔除任何声明名**」喵。
 */
const PLUGIN_SCOPE_ONLY_TOOLS = [
  // FIX-58：多了 project_init（把当前工作区认成项目）喵
  'contract_status', 'project_init', 'contract_flow', 'doc_emit', 'progress_upsert', 'bugfix_note', 'ledger_rebuild',
  'librarian_patrol', 'librarian_backfill', 'librarian_archive', 'librarian_sweep', 'librarian_glossary',
  'ledger_backfill', 'doc_search', 'audit_scan', 'librarian_relocate', 'librarian_indexes',
  'contract_delegate_researcher', 'contract_delegate_implementer', 'contract_delegate_reviewer',
  'contract_delegate_adversary', 'contract_delegate_librarian',
]

const makeCtx = () => {
  const calls = { start: [], continuable: [], disposed: 0 }
  const mine = []
  const handlers = []
  // FIX-41：宿主 webServer 的桩 —— 记下注册的路由，供"待办写通道"断言喵
  const routes = []
  const ctx = {
    tools: {
      register: (t) => { mine.push(t); registered.push(t); return () => {} },
      // 宿主工具枚举面（ToolRuntime.schemas）——注意它在本插件上下文里**只看得见本插件注册的工具**喵（§9-22）
      // 刻意只返回**本插件注册面**：这就是真机上 schemas() 的视野（§9-22 的根因）喵
      schemas: () => PLUGIN_SCOPE_ONLY_TOOLS.map((name) => ({ name })),
    },
    // FIX-41：`ctx.inject(['webServer'], cb)` 的桩（真 cordis 会给一个带该服务的 scope）喵
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    inject: (names, callback) => {
      if (Array.isArray(names) && names.includes('webServer') && typeof callback === 'function') callback(ctx)
    },
    effect: (cb) => { const disposer = cb(); return () => { if (typeof disposer === 'function') disposer() } },
    get: (name) => (name === 'sessions' ? { get: () => ({ header: {} }) } : undefined),
    // 事件总线桩：让 index-sync 的域名订阅在测试里也能被触发喵
    on: (name, fn) => { handlers.push({ name, fn }) },
    emit: (name, payload) => { for (const handler of handlers) if (handler.name === name) handler.fn(payload) },
    storageDomain: fakeStorageDomain(),
    subagents: {
      resolveMaxDepth: () => 3,
      listDescendants: async () => [{}, {}],
      // 上级身份解析靠 catalog 的 label（我们派活时写的 `<任务号>-<角色>`）喵
      listChildren: async (parentId) => (parentId === 'root-session'
        ? [{ id: 'lead-session', mode: 'continuable', label: 'T-001-lead' }]
        : []),
      start: async (provider, request) => {
        calls.start.push({ provider, request })
        return {
          id: 'child-session-1',
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '研究完成：结论 A' }] }),
          dispose: async () => { calls.disposed += 1 },
        }
      },
      startContinuable: async (spec) => {
        calls.continuable.push(spec)
        return { childId: 'child-continuable-1', messageId: 'msg-1' }
      },
    },
  }
  return { ctx, calls, mine, routes }
}

plugin.apply(makeCtx().ctx, cfg)
// FIX-25 起多一件 `librarian_tags`（馆员的 tags 步骤）喵
// FIX-76：多一件 librarian_relocate（馆员的通用搬迁能力）喵
// FIX-103：多了 `librarian_indexes`（八类索引重建）喵
const M2_TOOL_NAMES = ['doc_emit', 'progress_upsert', 'bugfix_note', 'ledger_rebuild', 'librarian_patrol', 'librarian_backfill', 'ledger_backfill', 'librarian_archive', 'librarian_sweep', 'librarian_glossary', 'librarian_tags', 'librarian_relocate', 'librarian_indexes', 'doc_search', 'audit_scan']
// FIX-58 起另有 `project_init`（自适应项目初始化：dryRun 预览 / 只新建不覆盖 / 换工作区=换项目）喵
// FIX-89：（内置流程：可执行步骤序列）也是项目/编排面的工具喵
// FIX-100 ②：多了'提权申请'（绕过契约的显式降级通道）喵
const PROJECT_TOOL_NAMES = ['project_init', 'contract_flow', 'contract_request_escalation', 'doc_census']
assert.equal(registered.length, 1 + PROJECT_TOOL_NAMES.length + BUILTIN_ROLES.length + M2_TOOL_NAMES.length)
const toolOf = (name) => registered.filter((t) => t.name === name).slice(-1)[0]
for (const name of [...M2_TOOL_NAMES, ...PROJECT_TOOL_NAMES]) assert.ok(toolOf(name), `${name} 已注册`)
const statusTool = registered.find((t) => t.name === 'contract_status')
assert.ok(statusTool, 'contract_status 已注册')
const delegateTools = registered.filter((t) => t.name.startsWith('contract_delegate_'))
assert.deepEqual(delegateTools.map((t) => t.name).sort(), BUILTIN_ROLES.map((r) => `contract_delegate_${r.id}`).sort())
for (const tool of delegateTools) {
  assert.ok(tool.parameters?.taskId?.required, `${tool.name}.taskId 必填`)
  assert.equal(typeof tool.execute, 'function')
  assert.equal(tool.presentCall({}).kind, 'execute')
}
assert.equal(typeof statusTool.output.render, 'function')
assert.equal(statusTool.presentCall({}).kind, 'read')
ok(`工具注册形状（1 体检 + ${delegateTools.length} 委派通道 + ${M2_TOOL_NAMES.length} 台账/产出工具）`)

// ---------------------------------------------------------------- contract_status
const statusOut = await statusTool.execute({}, {})
assert.equal(statusOut.ok, true)
assert.equal(statusOut.project.name, 'Blockdustry')
// FIX-58 起文档目录数由**自适应探测**决定（结构随项目）⇒ 这里只断言**形状**：前三个固定 + docs[k] 连续编号喵
const statusLabels = statusOut.scan.dirs.map((d) => d.label)
const statusDocsCount = statusLabels.filter((label) => label.startsWith('docs[')).length
assert.deepEqual(
  statusLabels.slice(0, 3), ['tasks', 'progress', 'deliverables'],
  'contract_status 的目录体检形状：任务 / 进度 / 产出 固定在前',
)
// 尾部 = 若干 docs[k]（顺序连续）＋ 可能有 archive（归档目录也参与体检）＋ 若干 kind:<类别>（每个类目录单独体检）喵
const statusTail = statusLabels.slice(3)
const statusDocsPart = statusTail.filter((label) => label.startsWith('docs['))
assert.deepEqual(
  statusDocsPart, Array.from({ length: statusDocsPart.length }, (_, i) => `docs[${i}]`),
  'contract_status 的文档目录按 docs[k] 连续编号（个数随项目结构自适应）',
)
const statusRest = statusTail.filter((label) => !label.startsWith('docs['))
assert.equal(
  statusRest.every((label) => label === 'archive' || label.startsWith('kind:')),
  true,
  `尾部只允许 archive 与 kind:<类别>（实际 ${JSON.stringify(statusRest)}）`,
)
assert.ok(statusRest.filter((label) => label === 'archive').length <= 1, 'archive 标签最多出现一次（出现则说明体检到了归档目录）')
assert.ok(statusDocsCount >= 1, '至少要体检一个文档目录')
const by = Object.fromEntries(statusOut.scan.dirs.map((d) => [d.label, d]))
assert.ok(by.tasks.markdown > 0, 'tasks 应有 md')
assert.ok(by.deliverables.markdown > 0, 'deliverables 应有 md')
assert.equal(by.progress.exists, true, '[Agent进度] 已随夹具建出（FIX-61 起主夹具代表"已初始化项目"）')
// FIX-61 起主夹具是**结构齐**的已初始化项目 ⇒ 不该有"缺目录"、也不该有"尚未初始化"提示喵
// （"缺的必须报出来"这条语义没丢，改由 FIX-61 那一块用**全新空目录**断言，见下）喵
assert.equal(statusOut.scan.missing.length, 0, '结构齐的项目不该报缺目录')
assert.equal(statusOut.project_hint, undefined, 'FIX-61：结构齐 ⇒ 不带"尚未初始化"提示（不刷噪音）')
assert.equal(/尚未初始化/.test(statusTool.output.render({}, statusOut)[0].text), false, 'FIX-61：结构齐时回执里也不许出现该提示')
assert.equal(statusOut.scan.missing.every((row) => typeof row === 'string' && row.length > 0), true, '缺目录清单每项都要是可读路径')
assert.ok(Array.isArray(statusOut.project_notes) && statusOut.project_notes.length >= 1, 'FIX-58：回执要带"项目自适应"说明')
assert.ok(
  statusOut.project_notes.some((note) => note.includes('显式配置') || note.includes('命中') || note.includes('新建') || note.includes('沿用')),
  `FIX-58：自适应说明要讲清用了哪条路径，实际 ${JSON.stringify(statusOut.project_notes)}`,
)
const statusText = statusTool.output.render({}, statusOut)[0].text
assert.ok(statusText.includes('自适应:'), 'FIX-58：渲染出来的回执里也要有自适应说明')
assert.ok(statusText.includes('契约工作流项目: Blockdustry'))
assert.equal(statusText.includes('缺少的目录'), false, '结构齐 ⇒ 回执不列"缺少的目录"（FIX-61 那块用空目录断言它会出现）')
ok('contract_status execute + render')

// ---------------------------------------------------------------- 本体与槽位
assert.ok(MANDATE_TEMPLATE.includes('本提示词内容具有传递性'))
const rendered = renderMandate({ progressDir: '/P', task: '/T', location: '/L', parent: 'root', layer: 2, totalAgents: 5 })
assert.equal(findUnfilledSlots(rendered).length, 0, '填槽后不应有残留槽位')
assert.ok(rendered.includes('当前层数：`2`'))
assert.ok(rendered.includes('当前总 Agent 数：`5`'))
assert.ok(rendered.includes('### [1] 总纲'), '总纲里的 [1] 应逐字保留')
assert.ok(rendered.includes('方括号 `[]` 内的信息'), '空方括号不应被误判为槽位')
assert.deepEqual(findUnfilledSlots(MANDATE_TEMPLATE), ['[Agent进度]', '[任务]', '[位置]', '[上级]', '[层数]', '[总Agent数]'])
const renderedMissing = renderMandate({})
assert.equal(findUnfilledSlots(renderedMissing).length, 0, '缺值也应填成占位符')
ok('总纲逐字 + 槽位全填 + 无残留')

// ---------------------------------------------------------------- 角色卡
assert.equal(listRoles({}).length, BUILTIN_ROLES.length)
const overridden = listRoles({ roles: [{ id: 'researcher', persona: '自定义研究员', tools: ['read'] }] })
const researcher = overridden.find((r) => r.id === 'researcher')
// persona 被覆盖后仍会挂上检索阶梯（交付物 2 的不变量），所以是「覆盖正文 + 阶梯」喵
// persona 被覆盖后仍会挂上检索阶梯（交付物 2 的不变量），所以是「覆盖正文 + 阶梯」喵
assert.equal(researcher.persona, `自定义研究员\n\n${SEARCH_LADDER}`)
// 覆盖生效，但 §9-11 的落盘工具**不得被配置摘掉**，所以是三件而不是一件喵
assert.deepEqual(researcher.tools, ['read', 'doc_emit', 'progress_upsert'])
assert.equal(researcher.title, '研究员', '未覆盖的字段应保留内置值')
const custom = listRoles({ roles: [{ id: 'archivist', title: '档案员' }] })
assert.ok(custom.find((r) => r.id === 'archivist'), '自定义角色应被追加')
assert.throws(() => getRole({}, 'nobody'), /未知角色/)
assert.equal(getRole({}, 'adversary').mode, 'continuable')
assert.equal(getRole({}, 'researcher').mode, 'one-shot')
ok('角色卡内置/覆盖/新增/未知 id')

// ---------------------------------------------------------------- 切片工具
assert.equal(countChars('一 二\n三'), 3)
const keywords = extractKeywords('模块迁移与迁移记录', 6)
assert.ok(keywords.includes('迁移'), `中文 2-gram 应被提取，实际 ${JSON.stringify(keywords)}`)
const latin = extractKeywords('migration chain migration', 6)
assert.ok(latin.includes('migration'), '拉丁词应被提取')
assert.ok(latin.includes('chain'), '拉丁词应被提取')
ok('countChars + extractKeywords')

// ---------------------------------------------------------------- 预算三分支
assert.equal(classifyChars(100, 200, 300, 30), 'ok')
assert.equal(classifyChars(230, 200, 300, 30), 'warn')
assert.equal(classifyChars(400, 200, 300, 30), 'overflow')
const parts = [
  { id: 'ok', text: 'a'.repeat(100), soft: 200, hard: 300 },
  { id: 'warn', text: 'b'.repeat(230), soft: 200, hard: 300 },
  { id: 'overflow', text: 'c'.repeat(500), soft: 200, hard: 300 },
]
const assembled = assembleSegments(parts, { softLimit: 10000, hardLimit: 20000, warnOverSoftPct: 30 })
assert.equal(assembled.segments[0].level, 'ok')
assert.equal(assembled.segments[1].level, 'warn')
assert.equal(assembled.segments[1].chars, 230, 'warn 档保留全文')
assert.equal(assembled.segments[2].level, 'overflow')
assert.equal(assembled.segments[2].chars, 300, 'overflow 档裁剪到硬限')
assert.equal(assembled.overflow, true)
assert.ok(assembled.warnings.some((w) => w.includes('裁剪')), '裁剪应有 warning')
const tiny = assembleSegments([{ id: 'slices', text: 'x'.repeat(500), soft: 200, hard: 400 }], { softLimit: 100, hardLimit: 150, warnOverSoftPct: 30 })
assert.equal(tiny.overflow, true)
assert.ok(tiny.totalChars <= 150, `总装配应回到硬限内，实际 ${tiny.totalChars}`)
assert.equal(truncateToChars('一 二 三', 2).chars, 2)
assert.equal(truncateToChars('一 二 三', 2).text, '一…')

// mandate 永不裁剪：传递性要求逐字完整下发，超限只警告，且不把整体标成已裁剪喵
const noClipOn = assembleSegments(
  [{ id: 'mandate', text: 'x'.repeat(1000), soft: 100, hard: 200 }],
  { softLimit: 10000, hardLimit: 20000, warnOverSoftPct: 30, mandateNoClip: true },
)
assert.equal(noClipOn.segments[0].chars, 1000, 'mandate 超硬限也必须保留全文')
assert.equal(noClipOn.segments[0].level, 'warn', 'mandate 超限只降级为警告')
assert.equal(noClipOn.overflow, false, 'mandate 单独超限不得置 overflow')
assert.ok(noClipOn.warnings.some((w) => w.includes('豁免裁剪')), '豁免裁剪应有明确 warning')
const noClipOff = assembleSegments(
  [{ id: 'mandate', text: 'x'.repeat(1000), soft: 100, hard: 200 }],
  { softLimit: 10000, hardLimit: 20000, warnOverSoftPct: 30, mandateNoClip: false },
)
assert.equal(noClipOff.segments[0].chars, 200, 'mandateNoClip: false 时才按硬限裁剪')
ok('预算三分支 ok/warn/overflow + 裁剪 + mandate 免裁例外')

// ---------------------------------------------------------------- buildContract
// 任务切面不再搬运任务文件正文，关键词改由任务号 + 上级补充指令派生，
// 所以夹具的补充指令里带上要检索的实词（否则切片本来就该召回为空）喵
const contract = await buildContract({
  config: cfg,
  roleId: 'researcher',
  task: { id: 'T-001', brief: '只查不写，关注迁移' },
  parent: 'root-session',
  layer: 1,
  totalAgents: 2,
})
const slotValues = [project.progressDir, project.tasksDir, project.deliverablesDir]

// 回归：真实目录名就叫 [Agent进度] 时，不得把它当成未填槽位喵。
// （ONLY 白名单口径 + ignore 已替换取值，两条缺一不可）
assert.ok(project.progressDir.includes('[Agent进度]'), 'fixture 的进度目录名应真的包含 [Agent进度]')
assert.deepEqual(findUnfilledSlots(`进度目录：${project.progressDir}`), ['[Agent进度]'], '不剔除已替换取值时会误报')
assert.deepEqual(findUnfilledSlots(`进度目录：${project.progressDir}`, [project.progressDir]), [], '剔除已替换取值后不得误报')
assert.deepEqual(findUnfilledSlots('正文里的 [1] 与 [2] 和 `[]`'), [], '方括号引用与空方括号不得被误判为槽位')

assert.equal(findUnfilledSlots(contract.text).length, 1, '进度目录本身就叫 [Agent进度]，直接扫会误报')
assert.equal(findUnfilledSlots(contract.text, slotValues).length, 0, '契约不得有残留槽位')
assert.ok(contract.text.includes('本提示词内容具有传递性'), '含总纲本体')
assert.ok(contract.text.includes('当前层数：`1`'))
assert.ok(contract.text.includes('当前总 Agent 数：`2`'))
assert.ok(contract.text.includes('只查不写'), '含上级补充指令')
assert.ok(contract.text.includes('这是一个用于验证的项目简介。'), '含项目简介')
assert.ok(contract.text.includes('T-001_debug.md'), '含 debug 文件清单')
assert.ok(contract.text.includes('迁移坑'), '文档切片应命中相关坑文档')
// FIX-49：`slots`（状态槽汇总）整段已删 —— 槽位在总纲本体里就地替换，再列一遍是重复喵
// 形状更新（FIX-101）：多了 `spec` 段（文档规范 + 本轮解析结果 + 权威顺序 + 目标绝对路径）喵
assert.deepEqual(contract.segments.map((s) => s.id), ['mandate', 'role', 'task', 'spec', 'slices', 'capability'])
assert.ok(contract.text.includes('文档规范'), 'FIX-101 ①：契约里必须有「文档规范」段（子代理不该去读插件源码）')
assert.ok(contract.text.includes('本轮解析结果'), 'FIX-101 ①：并给出本轮解析结果（绝对路径）')
assert.ok(contract.text.includes('权威顺序'), 'FIX-101 ①：以及权威顺序（派生物冲突时以契约为准）')
assert.ok(contract.text.includes('插件源码') && contract.text.includes('标注这处不一致'), 'FIX-101 ③：不一致时**按契约执行 + 标注上报**，不必去源码求证')
assert.equal(contract.text.includes('此处仅作汇总'), false, 'FIX-49：契约里不得再有"状态槽汇总"那段重复')
assert.equal(contract.overflow, false)
ok(`buildContract 五段装配（${contract.totalChars} 字，无残留槽位，无状态槽重复段）`)

// ---------------------------------------------------------------- 委派通道：前台
const fg = makeCtx()
plugin.apply(fg.ctx, cfg)
const researcherTool = registered.filter((t) => t.name === 'contract_delegate_researcher').slice(-1)[0]
const agent = { id: 'root-session', session: { header: { delegationDepth: 0 } } }
const signal = new AbortController().signal
const fgOut = await researcherTool.execute({ taskId: 'T-001' }, { agent, signal })
assert.equal(fgOut.kind, 'foreground')
assert.equal(fgOut.role, 'researcher')
assert.equal(fgOut.text, '研究完成：结论 A')
assert.equal(fg.calls.disposed, 1, '前台 run 必须释放')
assert.equal(fg.calls.start.length, 1)
assert.equal(fg.calls.start[0].provider, 'spawn')
const sentRequest = fg.calls.start[0].request
assert.equal(sentRequest.parent, agent)
assert.ok(findUnfilledSlots(sentRequest.prompt[0].text, slotValues).length === 0, '发给子智能体的契约不得有残留槽位')
assert.ok(sentRequest.prompt[0].text.includes('当前总 Agent 数：`3`'), '总 Agent 数应来自谱系统计')
assert.ok(sentRequest.prompt[0].text.includes('发给 `主代理` 级 Agent'), '顶层调用方的上级应读作「主代理」')
assert.equal(sentRequest.persona, getRole({}, 'researcher').persona)
assert.deepEqual(sentRequest.toolFilter.allow, getRole({}, 'researcher').tools)
assert.equal(sentRequest.maxDepth, 3)
assert.ok(fgOut.contractChars > 0)
assert.ok(Array.isArray(fgOut.warnings))
ok('委派通道前台：契约注入 + persona/工具白名单/深度 + 释放')

// ---------------------------------------------------------------- 委派通道：后台
const bgAgent = { id: 'lead-session', session: { header: { delegationDepth: 1, parentSession: 'root-session' } } }
const bg = makeCtx()
plugin.apply(bg.ctx, cfg)
const implementerTool = registered.filter((t) => t.name === 'contract_delegate_implementer').slice(-1)[0]
const bgOut = await implementerTool.execute({ taskId: 'T-001' }, { agent: bgAgent, signal })
assert.equal(bgOut.kind, 'continuable')
assert.equal(bgOut.childId, 'child-continuable-1')
assert.equal(bg.calls.continuable.length, 1)
assert.equal(bg.calls.start.length, 0)
assert.ok(bg.calls.continuable[0].request.prompt[0].text.includes('当前层数：`2`'), '层数应为父层 +1')
assert.ok(bg.calls.continuable[0].request.prompt[0].text.includes('发给 `T-001-lead` 级 Agent'), '上级应读作成员名')
assert.ok(!bg.calls.continuable[0].request.prompt[0].text.includes('lead-session'), '[上级] 不得泄露裸 session id')
const fgForced = await implementerTool.execute({ taskId: 'T-001', run_in_background: false }, { agent: bgAgent, signal })
assert.equal(fgForced.kind, 'foreground')
assert.equal(bg.calls.disposed, 1)
await assert.rejects(
  () => researcherTool.execute({ taskId: 'T-001', run_in_background: true }, { agent: bgAgent, signal }),
  /前台一次性角色/,
)
await assert.rejects(() => researcherTool.execute({ taskId: 'T-001' }, { signal }), /exec\.agent/)
await assert.rejects(() => researcherTool.execute({}, { agent: bgAgent, signal }), /任务号/)
ok('委派通道后台：continuable + 强制前台 + 错误路径')

// ---------------------------------------------------------------- FIX-59 生效模型：记进台账 + 审计可判定
/**
 * 病根（真机实锤）喵：成员记录只在**显式配了路由**时才有 `model`，继承默认模型的角色（实现者等）
 * 一律 null；而 `cross_vendor` 的判据是"两边都有模型名且相同" ⇒ **实现者那侧永远 null**
 * ⇒ 这条审计在真机**完全是哑的**，"没报"被当成"合格"喵。
 * 这一块断言的是**真机语义**（不再靠夹具自己塞 model 蒙混）喵。
 */
// ① 解析链：显式路由 → 宿主解析后的子智能体 → 子会话请求头 → 子会话投影 → 父路由 → 部署默认
const fmSignals = new AbortController().signal
const pick = (out) => ({ model: out.model, provider: out.provider, source: out.source })
assert.deepEqual(
  pick(resolveEffectiveModel({
    ctx: { get: () => ({ currentSelection: () => ({ provider: 'zai', model: '默认模型' }) }) },
    explicitModel: '路由模型',
    childAgent: { options: { model: '子模型' } },
  })),
  { model: '路由模型', provider: null, source: 'route' },
  'FIX-59：① 显式路由优先（我们下发给宿主的 agentOptions.model）',
)
assert.deepEqual(
  pick(resolveEffectiveModel({ ctx: makeCtx().ctx, childAgent: { options: { provider: 'zai', model: '子模型' } } })),
  { model: '子模型', provider: 'zai', source: 'child-agent' },
  'FIX-59：② 宿主**解析后**的子智能体选项（run.localAgent.options，最贴近事实）',
)
const fmChildCtx = {
  get: (name) => (name === 'sessions' ? { get: () => ({ requestHeader: () => ({ config: { provider: 'zai', model: '子会话模型' } }) }) } : undefined),
}
assert.equal(resolveEffectiveModel({ ctx: fmChildCtx, childSessionId: 'c1' }).source, 'child-session', 'FIX-59：③ 子会话请求头')
const fmProjCtx = {
  get: (name) => (name === 'sessionProjections'
    ? { stateOf: () => ({ lastUsed: { provider: 'zai', model: '投影模型' }, pending: null }) }
    : (name === 'sessions' ? { get: () => ({}) } : undefined)),
}
assert.equal(resolveEffectiveModel({ ctx: fmProjCtx, childSessionId: 'c1' }).model, '投影模型', 'FIX-59：③b 子会话模型投影（lastUsed）')
assert.equal(resolveEffectiveModel({ ctx: fmProjCtx, childSessionId: 'c1' }).source, 'child-projection')
// 没配路由的子智能体在宿主里**继承父路由** ⇒ 这两条是"继承默认也要拿到"的主力喵
const fmParentHeader = { session: { requestHeader: () => ({ config: { provider: 'zai', model: '父请求头模型' } }) }, options: { model: '父创建选项模型' } }
assert.equal(resolveEffectiveModel({ ctx: makeCtx().ctx, parent: fmParentHeader }).model, '父请求头模型', 'FIX-59：④ 父会话请求头优先于创建期 options（与宿主 parentAgentOptionsForDelegation 同口径）')
assert.equal(resolveEffectiveModel({ ctx: makeCtx().ctx, parent: { options: { model: '父创建选项模型' } } }).source, 'parent-route')
const fmDefaultCtx = { get: (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'zai', model: '部署默认' }) } : undefined) }
assert.deepEqual(
  pick(resolveEffectiveModel({ ctx: fmDefaultCtx, parent: { options: {} } })),
  { model: '部署默认', provider: 'zai', source: 'deployment-default' },
  'FIX-59：⑤ 宿主部署默认模型（ctx.agentDefaultModel.currentSelection()）',
)
const fmEmpty = resolveEffectiveModel({ ctx: makeCtx().ctx })
assert.equal(fmEmpty.model, null, 'FIX-59：⑥ 一个来源都没有 ⇒ 未知（**绝不编一个值**糊过去）')
assert.equal(fmEmpty.source, 'unknown')
assert.ok(Array.isArray(fmEmpty.tried) && fmEmpty.tried.length >= 1, 'FIX-59：未知时要留下探测痕迹（诊断用）')
// 来源词表与解析链**一一对应**（回执说法与断言说法不许漂移；未知来源原样透出，不吞）喵
assert.deepEqual(
  Object.keys(MODEL_SOURCE_TEXT).sort(),
  ['child-agent', 'child-projection', 'child-session', 'deployment-default', 'parent-route', 'route', 'unknown'],
  'FIX-59：来源词表必须覆盖解析链的全部取值',
)
assert.ok(modelSourceText('route').includes('modelRoutes'), 'FIX-59：来源要用人话（"显式路由 modelRoutes"）')
assert.equal(modelSourceText('没见过的来源'), '没见过的来源', 'FIX-59：不认识来源就原样透出（不许吞成"未知"）')

// ①-e2e 真机语义：派一次「实现者」→ 台账里 model **非空**（不是夹具塞的，是解析出来的）
const fmCtx = makeCtx()
const fmBaseGet = fmCtx.ctx.get
fmCtx.ctx.get = (name) => (name === 'agentDefaultModel'
  ? { currentSelection: () => ({ provider: 'zai', model: 'glm-5.3-flash' }) }
  : fmBaseGet(name))
plugin.apply(fmCtx.ctx, cfg)
const fmImplementerTool = fmCtx.mine.find((tool) => tool.name === 'contract_delegate_implementer')
assert.ok(fmImplementerTool, 'FIX-59：实现者通道已注册')
const fmOut = await fmImplementerTool.execute({ taskId: 'T-901' }, { agent: bgAgent, signal: fmSignals })
assert.equal(fmOut.model, 'glm-5.3-flash', 'FIX-59 ①：继承默认模型的角色，回执里也必须给出模型')
assert.equal(fmOut.modelSource, 'deployment-default')
assert.ok(
  fmImplementerTool.output.render({}, fmOut)[0].text.includes('模型：glm-5.3-flash'),
  'FIX-59 ①：回执要能直接看到模型（真机验收一眼可查）',
)
const fmDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) fmDomains[key] = fmCtx.ctx.storageDomain.opened.get(spec.name)
const fmStore = createStore(fmDomains, projectKeyOf(cfg))
const fmMember = fmStore.getMember('T-901-implementer')
assert.ok(fmMember, 'FIX-59：实现者的成员记录已落台账')
assert.equal(fmMember.model, 'glm-5.3-flash', 'FIX-59 ①（核心）：继承默认模型的成员记录里 model **必须非空**')
assert.equal(fmMember.route, undefined ?? fmMember.route, 'FIX-59：route 字段语义不变（存路由名，不拿来当模型名）')

// ⑥ 路由名不得被当成模型名（旧实现的病根：`member.model || member.route` ⇒ 永远"异源"）
assert.equal(modelOfMember({ route: 'adversary' }), null, 'FIX-59：只有路由名 ⇒ 模型仍然**未知**（不许拿路由名顶替）')
assert.equal(modelOfMember({ model: 'glm-5.3-flash', route: 'adversary' }), 'glm-5.3-flash')

// ③ 审计：两边都有真模型名 ⇒ 同源必报（并把两边名字都写出来）/ 异源不报
const fmAuditCfg = plugin.Config({ project: { root: cfg.project.root }, audit: { checks: ['cross_vendor'] } })
const crossStore = await createLedger(makeCtx().ctx, 'cross').ready
await crossStore.putMember(memberRecord({ name: 'T-920-adversary', role: 'adversary', status: 'running', model: 'glm-5.3-flash' }))
await crossStore.putMember(memberRecord({ name: 'T-920-impl', role: 'implementer', status: 'running', model: 'glm-5.3-flash' }))
const crossSame = await auditScan({ store: crossStore, project: resolveProject(fmAuditCfg), config: fmAuditCfg })
const sameItem = crossSame.items.find((item) => item.check === 'cross_vendor')
assert.ok(sameItem, 'FIX-59 ③：同源**必报**')
assert.ok(sameItem.detail.includes('glm-5.3-flash') && sameItem.detail.includes('T-920-impl'), 'FIX-59 ③：报的时候要写出**两边各自的模型名与成员名**')
assert.equal(crossSame.level, 'yellow', 'FIX-59：同源是真告警（黄）')
const crossDiffStore = await createLedger(makeCtx().ctx, 'cross2').ready
await crossDiffStore.putMember(memberRecord({ name: 'T-921-adversary', role: 'adversary', status: 'running', model: 'glm-5.3-flash' }))
await crossDiffStore.putMember(memberRecord({ name: 'T-921-impl', role: 'implementer', status: 'running', model: 'deepseek-v4-flash' }))
const crossDiff = await auditScan({ store: crossDiffStore, project: resolveProject(fmAuditCfg), config: fmAuditCfg })
assert.equal(crossDiff.items.some((item) => item.check === 'cross_vendor'), false, 'FIX-59 ③：异源不报')
assert.equal(crossDiff.items.some((item) => item.check === 'cross_vendor_undecidable'), false, 'FIX-59：两边模型都有 ⇒ 也不该说"无法判定"')

// ② 两侧都未知 ⇒ **不许静默**（旧行为就是静默 ⇒ "没报"被读成"合格"）
const unknownStore = await createLedger(makeCtx().ctx, 'unknown').ready
await unknownStore.putMember(memberRecord({ name: 'T-930-adversary', role: 'adversary', status: 'running' }))
await unknownStore.putMember(memberRecord({ name: 'T-930-impl', role: 'implementer', status: 'running' }))
const unknownAudit = await auditScan({ store: unknownStore, project: resolveProject(fmAuditCfg), config: fmAuditCfg })
assert.equal(unknownAudit.items.some((item) => item.check === 'cross_vendor'), false, 'FIX-59 ②：缺数据时 cross_vendor 自身**不报**（无从判定，不能假报同源）')
const undecidable = unknownAudit.items.filter((item) => item.check === 'cross_vendor_undecidable')
assert.ok(undecidable.length >= 1, 'FIX-59 ②：两侧模型未知 ⇒ **必须**给出"无法判定"（不许静默）')
assert.equal(undecidable[0].level, 'info', 'FIX-59：它是观察项（不告警），不是黄也不是红')
assert.ok(undecidable[0].detail.includes('无法判定'), 'FIX-59 ④：措辞必须是"无法判定"，绝不写成"通过/合格"')
assert.equal(unknownAudit.counts.byCheck.cross_vendor_undecidable, undefined, 'FIX-59：观察项不得计入红黄统计')
assert.equal(unknownAudit.level, 'green', 'FIX-59：观察项不改变 level（全绿仍是绿）——但报告里必须看得见它')
assert.ok(unknownAudit.humanReport.includes('无法判定'), 'FIX-59 ④：人话报告要出现"无法判定"')
assert.ok(unknownAudit.humanReport.includes('观察（仅记录，不告警）'), 'FIX-59：观察项单独一段')
assert.equal(/\[黄\][^\n]*无法判定/.test(unknownAudit.humanReport), false, 'FIX-59：观察项**不得**被排进"[黄]"待处理清单（那是"已判定有问题"的意思）')
// 只有对抗审查这一侧未知（实现者有模型名）⇒ 同样要提示
const halfStore = await createLedger(makeCtx().ctx, 'half').ready
await halfStore.putMember(memberRecord({ name: 'T-931-adversary', role: 'adversary', status: 'running' }))
await halfStore.putMember(memberRecord({ name: 'T-931-impl', role: 'implementer', status: 'running', model: 'deepseek-v4-flash' }))
const halfAudit = await auditScan({ store: halfStore, project: resolveProject(fmAuditCfg), config: fmAuditCfg })
assert.ok(halfAudit.items.some((item) => item.check === 'cross_vendor_undecidable'), 'FIX-59：只有一侧未知也要说"无法判定"（不许因为有一侧有数据就默认合格）')

// 徽章也要跟着：**"没报" 不许渲染成 ✓ 合格**喵（真机上所有对抗审查长期显示 ✓，正是这条谬误最刺眼的表面）喵
const fmProject = resolveProject(fmAuditCfg)
const badgeOf = (store, audit, name) => buildPanelSnapshot({ store, project: fmProject, audit }).members[name].badges.crossVendor
assert.equal(badgeOf(unknownStore, unknownAudit, 'T-930-adversary'), 'unknown', 'FIX-59：模型未知 ⇒ 徽章 `? 无法判定`（不是 ✓ 合格）')
assert.equal(badgeOf(halfStore, halfAudit, 'T-931-adversary'), 'unknown', 'FIX-59：只有一侧未知 ⇒ 同样不给 ✓')
assert.equal(badgeOf(crossStore, crossSame, 'T-920-adversary'), 'missing', 'FIX-59：判出同源 ⇒ 徽章给问题')
assert.equal(badgeOf(crossDiffStore, crossDiff, 'T-921-adversary'), 'ok', 'FIX-59：真判过且不是同源 ⇒ 才是 ✓ 合格')
ok('FIX-59 生效模型可判定：解析链六源（路由/子智能体/子会话/投影/父路由/部署默认）+ 派单即记账（继承默认也有 model）/ 审计同源必报（两边名字都写出）· 异源不报 · 缺数据给"无法判定"而非静默')

// ---------------------------------------------------------------- 上级身份（回归：不得是裸 session id）


assert.equal(await parentIdentity(makeCtx().ctx, agent, signal), '主代理', '顶层调用方应读作「主代理」')
assert.equal(await parentIdentity(makeCtx().ctx, bgAgent, signal), 'T-001-lead', '子级上级应读作 catalog 里的成员名')
const noCatalog = makeCtx()
noCatalog.ctx.subagents.listChildren = async () => { throw new Error('sessionQuery 不可用') }
assert.equal(await parentIdentity(noCatalog.ctx, bgAgent, signal), '子智能体（层 1）', '目录不可用时应退化为可读文案')
const orphan = makeCtx()
assert.equal(
  await parentIdentity(orphan.ctx, { id: 'x', session: { header: { delegationDepth: 2 } } }, signal),
  '子智能体（层 2）',
  '拿不到父会话时应退化为可读文案',
)
ok('上级身份解析：主代理 / 成员名 / 两种退化')

// ---------------------------------------------------------------- 路由与降级
// 裁决 B 起口径变更：`modelRoutes` 是 **volatile** 字段 ⇒ 配置文件里的值会被忽略，
// 生效路由 = 插件默认（`DEFAULT_MODEL_ROUTES`）⊕ 设置页覆盖 ⇒ 这里断言"默认值生效"喵
// （旧断言期望 fixture 里的 `glm-4` —— 那是"配置文件当默认层"的口径，已按裁决改掉，不是放宽）喵
assert.deepEqual(routeOptions(cfg, getRole({}, 'adversary')), { model: 'glm-5.3-flash' }, '默认异源路由生效（adversary=glm-5.3-flash）')
assert.equal(routeOptions(cfg, getRole({}, 'researcher')), undefined, 'researcher 没有默认路由 ⇒ 继承主模型')
const noFamily = { ...cfg, modelRoutes: { adversary: null } }
assert.ok((await buildContract({ config: noFamily, roleId: 'adversary', task: { id: 'T-001' }, parent: 'p', layer: 1, totalAgents: 1 }))
  .text.includes('非异源'), '**显式**把路由置空（adversary: null）才应标注非异源（这是"真的没路由"）')
const degrade = makeCtx()
degrade.ctx.get = () => undefined
plugin.apply(degrade.ctx, cfg)
const degradeTool = registered.filter((t) => t.name === 'contract_delegate_researcher').slice(-1)[0]
const degradeOut = await degradeTool.execute({ taskId: 'T-001' }, { agent, signal })
assert.equal(degradeOut.kind, 'foreground')
assert.ok(degradeOut.warnings.some((w) => w.includes('退化为按层数')), '统计失败应降级并告警')
ok('模型路由解析 + 台账缺失时的降级')

// ---------------------------------------------------------------- 对抗审查**真异源**（最终值，用户定稿）
// 定稿值：`modelRoutes.adversary = "glm-5.3-flash"`（宿主 zai provider 下就是这个名字，key 已在宿主的
// provider 账户里 ⇒ **任何文件与设置存储里都不许出现密钥**）喵。
const rivalCfg = plugin.Config({
  project: { name: 'Blockdustry', root: cfg.project.root, brief: '真异源验收' },
  paths: { tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent', docsDirs: ['仓库/docs'] },
  modelRoutes: { adversary: 'glm-5.3-flash' },
})
assert.equal(
  routeOptions(rivalCfg, getRole({}, 'adversary')).model, 'glm-5.3-flash',
  '④：派对抗审查时要用 glm-5.3-flash（字符串形态的路由值）',
)
assert.equal(routeOptions(rivalCfg, getRole({}, 'implementer')), undefined, '④：实现者不配路由 ⇒ 继承主模型 ⇒ 与对抗审查必然不同')
// ④ assemble 不再标"非异源"，且契约里能看出走的是哪条路由
const rivalContract = await buildContract({
  config: rivalCfg, roleId: 'adversary', task: { id: 'T-001' }, parent: 'p', layer: 1, totalAgents: 1,
})
assert.equal(rivalContract.text.includes('非异源'), false, '④：配好异源路由后，契约里**不得**再出现"非异源"标注')
assert.ok(rivalContract.text.includes('模型路由：adversary'), '④：契约要写明对抗审查走 adversary 路由')
// ④ 真跑一次派单：两者的 agentOptions.model 必须不同（这才叫真异源）
const rivalRun = makeCtx()
plugin.apply(rivalRun.ctx, rivalCfg)
const rivalAdvTool = registered.filter((t) => t.name === 'contract_delegate_adversary').slice(-1)[0]
const rivalImplTool = registered.filter((t) => t.name === 'contract_delegate_implementer').slice(-1)[0]
await rivalAdvTool.execute({ taskId: 'T-001', run_in_background: false }, { agent, signal })
await rivalImplTool.execute({ taskId: 'T-001', run_in_background: false }, { agent, signal })
const rivalModels = rivalRun.calls.start.map((row) => (row.request.agentOptions ? row.request.agentOptions.model : null))
assert.equal(rivalModels[0], 'glm-5.3-flash', '④：对抗审查子智能体必须带 model=glm-5.3-flash')
assert.equal(rivalModels[1], null, '④：实现者不带 model（继承主模型）')
assert.notEqual(rivalModels[0], rivalModels[1], '④：两者模型必须不同 —— 异源就是这条的意义')
// ④ 审计：同任务下 adversay 与 implementer 模型不同 ⇒ cross_vendor 不再报
// 注意：审计必须**把检查项开出来**（`audit.checks` 为空 ⇒ 一项都不跑 ⇒ "没有 cross_vendor"会是**假绿**）喵
const rivalAuditCfg = plugin.Config({
  project: { name: 'Blockdustry', root: cfg.project.root },
  paths: { tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent', docsDirs: ['仓库/docs'] },
  audit: { checks: [...CHECK_IDS] },
})
const rivalStore = await createLedger(makeCtx().ctx, projectKeyOf(cfg)).ready
await rivalStore.putMember(memberRecord({
  id: 'sess-rival-adv', name: 'T-777-adversary', role: 'adversary', mode: 'continuable', layer: 1, status: 'running', model: 'glm-5.3-flash',
}))
await rivalStore.putMember(memberRecord({
  id: 'sess-rival-imp', name: 'T-777-implementer', role: 'implementer', mode: 'continuable', layer: 1, status: 'running', model: 'deepseek-chat',
}))
const rivalAudit = await auditScan({ store: rivalStore, project: resolveProject(cfg), config: rivalAuditCfg })
assert.ok(rivalAudit.failedChecks.length === 0, 'sanity：检查项都得跑起来（否则"没有 cross_vendor"是假绿）')
assert.equal(
  rivalAudit.items.some((item) => item.check === 'cross_vendor'), false,
  '④：真异源下 cross_vendor **不得**再报（配对了就不是"非真对抗"）',
)
// 同任务**同模型**时仍然要报（护栏没被这次配置顺手废掉）
await rivalStore.putMember(memberRecord({
  id: 'sess-rival-adv2', name: 'T-778-adversary', role: 'adversary', mode: 'continuable', layer: 1, status: 'running', model: 'deepseek-chat',
}))
await rivalStore.putMember(memberRecord({
  id: 'sess-rival-imp2', name: 'T-778-implementer', role: 'implementer', mode: 'continuable', layer: 1, status: 'running', model: 'deepseek-chat',
}))
const rivalAudit2 = await auditScan({ store: rivalStore, project: resolveProject(cfg), config: rivalAuditCfg })
assert.ok(
  rivalAudit2.items.some((item) => item.check === 'cross_vendor' && String(item.target).includes('T-778')),
  '④ 回归：同任务同模型（非真对抗）仍必须报 cross_vendor',
)
// 收尾：把插件配置还原成后续用例依赖的那份（别把后面的断言带偏）
plugin.apply(makeCtx().ctx, cfg)
ok('对抗审查真异源：adversary=glm-5.3-flash 与实现者模型不同 / 契约不再标"非异源" / 派单 agentOptions 有别 / cross_vendor 不再报（同模型时仍报）')

// ---------------------------------------------------------------- M2：命名规范
assert.equal(memberName('T-001', 'researcher'), 'T-001-researcher')
assert.deepEqual(parseMemberName('T-001-researcher'), { taskId: 'T-001', role: 'researcher' })
assert.deepEqual(parseMemberName('T-001-fix-lead'), { taskId: 'T-001-fix', role: 'lead' }, '以最后一个 - 为界')
assert.equal(parseMemberName('noseparator'), null)
assert.equal(slug('a/b:c*d  e'), 'a-b-c-d-e')
assert.equal(slug('  迁移 总结  '), '迁移-总结')
assert.equal(docFileName('T-001', '迁移总结', 3), 'T-001_迁移总结_L3.md')
// FIX-69：反解多带一个 `kind`（类型），三档一律 `产出档` —— 形状扩展，不是放宽喵
assert.deepEqual(parseDocFileName('T-001_迁移总结_L3.md'), { taskId: 'T-001', title: '迁移总结', tier: 3, kind: '产出档' })
assert.deepEqual(parseDocFileName('T-001_迁移总结_研究.md'), { taskId: 'T-001', title: '迁移总结', tier: 0, kind: '研究' })
assert.deepEqual(parseDocFileName('^T-001_旧归档_L3.md'), { taskId: 'T-001', title: '旧归档', tier: 3, kind: '产出档' })
assert.equal(parseDocFileName('旧档.md'), null)
assert.equal(bugfixFileName('T-001', '连锁操作漏项'), 'T-001_连锁操作漏项_fix.md')
assert.throws(() => docFileName('T-001', 'x', 9), /档级/)
ok('命名规范：成员 / 文档 / 修复总结 + 反解')

// ---------------------------------------------------------------- M2：状态机
assert.equal(canTransition('member', 'running', 'released'), true)
assert.equal(canTransition('member', 'released', 'running'), false, '释放是终态')
assert.equal(canTransition('task', 'open', 'done'), false, '必须先进 running')
assert.equal(canTransition('task', 'blocked', 'running'), true)
assert.equal(canTransition('member', 'idle', 'idle'), true, '同状态幂等')
assert.throws(() => assertTransition('member', 'released', 'running'), /非法的 member 状态迁移/)
assert.equal(isOpenTask({ status: 'blocked' }), true)
assert.equal(isOpenTask({ status: 'done' }), false)
ok('成员 / 任务状态机')

// ---------------------------------------------------------------- M2：文档形态规范
const fm = renderFrontMatter({
  taskId: 'T-001', role: 'researcher', tier: 3,
  keywords: ['迁移', 'migration'], relatedFiles: ['a.js'], createdAt: '2026-01-01T00:00:00.000Z',
})
assert.ok(fm.startsWith('---\n') && fm.endsWith('---\n\n'))
const fmParsed = parseFrontMatter(`${fm}## 结论\n\n内容\n`)
assert.equal(fmParsed.meta.taskId, 'T-001')
assert.deepEqual(fmParsed.meta.keywords, ['迁移', 'migration'])
assert.deepEqual(fmParsed.meta.relatedFiles, ['a.js'])
assert.ok(fmParsed.body.startsWith('## 结论'), '正文不含 front-matter')
assert.equal(parseFrontMatter('没有 front-matter').meta, null)
assert.deepEqual(missingSections('## 结论\n\n## 依据\n'), ['风险与待确认', '下一步'])
assert.equal(missingSections('## 结论\n## 依据\n## 风险与待确认\n## 下一步\n').length, 0)
assert.equal(countDocChars('一 二\n三'), 3)
assert.equal(classifyLength(3, 280).level, 'ok')
assert.equal(classifyLength(3, 400).level, 'strong')
assert.equal(classifyLength(3, 100).level, 'strong')
assert.equal(classifyLength(1, 5000).level, 'oversize')
assert.equal(classifyLength(2, 5000).level, 'ok')
assert.equal(classifyLength(0, 99999).level, 'ok', 'tier 0（修复总结）不参与长度分级')
ok('front-matter 往返 + 固定小节 + 长度分级')

// ---------------------------------------------------------------- M2：产出契约三工具
const m2 = makeCtx()
plugin.apply(m2.ctx, cfg)
const docEmit = toolOf('doc_emit')
const body3 = `## 结论\n\n${'甲'.repeat(270)}\n\n## 依据\n\n乙\n\n## 风险与待确认\n\n丙\n\n## 下一步\n\n丁`
const emitted = await docEmit.execute({
  level: 3, taskId: 'T-001', title: '迁移总结', body: body3, role: 'researcher', keywords: ['迁移', 'migration'],
}, { agent, signal })
assert.ok(emitted.path.startsWith(project.deliverablesDir), '必须返回绝对路径')
assert.ok(emitted.path.endsWith('T-001_迁移总结_L3.md'), `文件名应合规范，实际 ${emitted.path}`)
assert.equal(emitted.tier, 3)
assert.deepEqual(emitted.missingSections, [])
assert.deepEqual(emitted.warnings, [], `三级文档 250~300 字不应报警告，实际 ${emitted.chars} 字`)
const emittedText = await readFile(emitted.path, 'utf8')
assert.ok(emittedText.startsWith('---\n'), 'front-matter 由工具写入，模型不用自己拼 YAML')
const emittedKeywordLine = /keywords: (\[.*\])/.exec(emittedText)
assert.ok(
  emittedKeywordLine && emittedKeywordLine[1].includes('"迁移"') && emittedKeywordLine[1].includes('"migration"'),
  `keywords 应含调用方给的关键词，实际 ${emittedKeywordLine && emittedKeywordLine[1]}`,
)
assert.ok(emittedText.includes('role: researcher'))
assert.ok(emittedText.includes('## 结论'))

const shortDoc = await docEmit.execute({ level: 3, taskId: 'T-001', title: '太短', body: '## 结论\n短' }, { agent, signal })
assert.ok(shortDoc.warnings.some((w) => w.includes('偏短')), '三级偏短应强警告')
assert.equal(shortDoc.missingSections.length, 3)
assert.ok(shortDoc.path.endsWith('_L3.md'), '警告制：越限 / 缺小节仍然落盘，不拒写')

const progress = toolOf('progress_upsert')
const prog = await progress.execute({ taskId: 'T-001', body: `进度：${'甲'.repeat(500)}` }, {})
assert.equal(prog.path, joinUnderRoot(project.progressDir, 'T-001.md'))
assert.ok(prog.warnings.some((w) => w.includes('超长')), '进度 >400 字应警告')
assert.ok((await readFile(prog.path, 'utf8')).startsWith('进度：'), '超限仍然写入')

const bugfix = toolOf('bugfix_note')
const fixed = await bugfix.execute({ title: '连锁操作漏项', cause: '没读坑库', fix: '补读坑库', files: ['a.js', 'b.js'], taskId: 'T-001' }, { agent, signal })
assert.ok(fixed.path.endsWith('T-001_连锁操作漏项_fix.md'), `实际 ${fixed.path}`)
const fixedText = await readFile(fixed.path, 'utf8')
assert.ok(fixedText.includes('## 成因') && fixedText.includes('## 修复') && fixedText.includes('- a.js'))
ok('doc_emit / progress_upsert / bugfix_note 落盘 + 警告制')

// ---------------------------------------------------------------- M2：台账 CRUD + 内存联查
const ledgerCtx = makeCtx()
const ledger = createLedger(ledgerCtx.ctx)
const store = await ledger.ready
await store.putMember(memberRecord({ id: 'sess-1', name: 'T-001-researcher', role: 'researcher', mode: 'one-shot', layer: 1, status: 'running' }))
await store.putTask(taskRecord({ taskId: 'T-001', status: 'running', owner: 'T-001-researcher' }))
await store.putDoc(docRecord({ path: emitted.path, tier: 3, taskId: 'T-001', title: '迁移总结', owner: 'T-001-researcher' }))
// 形状更新（FIX-100，不是放宽）：`sizes()` 多了第四个领域 `escalations`（提权留痕）喵
assert.deepEqual(store.sizes(), { members: 1, tasks: 1, docs: 1, escalations: 0 })
const joined = store.query({ taskId: 'T-001' })
assert.equal(joined.joined.length, 1)
assert.equal(joined.joined[0].members.length, 1, '成员名反解出的 taskId 应能对上')
assert.equal(joined.joined[0].docs.length, 1)
assert.equal(joined.joined[0].task.owner, 'T-001-researcher')
assert.equal(store.query({ role: 'reviewer' }).members.length, 0, '过滤条件应生效')
assert.equal(store.query({ tier: 3 }).docs.length, 1)
await assert.rejects(
  () => store.domains.tasks.table('tasks').put('bad', { taskId: 'bad', status: 'nope' }),
  '非法记录必须被 schema 拒绝',
)
// 委派通道要顺手把成员与任务写进台账喵
const ledgerCh = makeCtx()
plugin.apply(ledgerCh.ctx, cfg)
await toolOf('contract_delegate_implementer').execute({ taskId: 'T-001' }, { agent: bgAgent, signal })
// 领域 open 是异步的，等委派跑完再取（此时 ready 已 resolve）喵
const opened = ledgerCh.ctx.storageDomain.opened
const chStore = createStore({
  members: opened.get(DOMAIN_NAMES.members),
  tasks: opened.get(DOMAIN_NAMES.tasks),
  docs: opened.get(DOMAIN_NAMES.docs),
}, projectKeyOf(cfg))
assert.equal(chStore.getMember('T-001-implementer').status, 'running', '后台角色应登记为 running')
assert.equal(chStore.getTask('T-001').owner, 'T-001-implementer')
ok('台账三领域 CRUD + 内存联查 + 委派自动登记')

// 存储键规范（DESIGN §5.5 勘误，线上实锤）：物理键必须 path-safe，人类可读信息只进值字段喵
const keySamples = [
  { project: 'blockdustry', table: 'docs', id: 'D:\\Blockdustry\\仓库\\docs\\子agent\\T-001_P2_迁移_L3.md' },
  { project: 'blockdustry', table: 'members', id: '中文任务号-研究员' },
  { project: 'my project: v2', table: 'tasks', id: 'T/001' },
  { project: '模组迁移', table: 'docs', id: '/mnt/d/Blockdustry/仓库/docs/子agent/x_L1.md' },
  { project: '', table: 'docs', id: '' },
]
for (const sample of keySamples) {
  const key = keyOf(sample.project, sample.table, sample.id)
  assert.ok(PATH_SAFE_RE.test(key), `键必须 path-safe，实际 '${key}'（来自 ${JSON.stringify(sample)}）`)
  assert.ok(key.includes(sample.table), `键里应保留表名，实际 '${key}'`)
}
assert.ok(projectSlugOf('模组迁移').startsWith('p_'), '纯非 ASCII 项目名必须退化为 p_<hash6>')
assert.notEqual(projectSlugOf('模组迁移'), projectSlugOf('另一个中文名'), '不同中文项目名不得退化成同一 slug')
assert.equal(projectSlugOf('My Project: v2').includes(':'), false, '冒号必须被净化掉')
assert.equal(projectSlugOf('mod-migration'), 'mod-migration')
assert.notEqual(keyOf('a', 'docs', 'x'), keyOf('a', 'docs', 'y'), '不同逻辑键必须给出不同物理键')
assert.notEqual(keyOf('a', 'docs', 'x'), keyOf('b', 'docs', 'x'), '不同项目必须给出不同物理键')
assert.equal(keyOf('a', 'docs', 'x'), keyOf('a', 'docs', 'x'), '同输入必须稳定')

// 假桩必须真的会拒绝非法键 —— 否则又会「绿灯撒谎」喵
const probeCtx = makeCtx()
const probeDomain = await probeCtx.ctx.storageDomain.open(DOMAIN_SPECS.docs)
await assert.rejects(() => probeDomain.table('docs').put('a:b', {}), /path-safe/, '含冒号的键必须被拒')
await assert.rejects(() => probeDomain.table('docs').put('D:\\x\\y.md', {}), /path-safe/, '含路径分隔符的键必须被拒')
await probeDomain.table('docs').put('safe-key_1', { ...docRecord({ path: '/probe.md', tier: 0, title: '探针' }), project: 'probe' })
assert.equal([...probeDomain.table('docs').keys()].length, 1)

// 端到端：store 写出的物理键必须是 path-safe 的（这条会直接抓住本轮线上 bug）喵
const keyCtx = makeCtx()
const keyLedger = createLedger(keyCtx.ctx, 'blockdustry')
const keyStore = await keyLedger.ready
await keyStore.putDoc(docRecord({
  path: 'D:\\x\\中文 目录\\T-001_迁移_L3.md', tier: 3, taskId: 'T-001', title: '迁移',
}))
await keyStore.putMember(memberRecord({ name: 'T-001-研究员', role: '研究员', mode: 'one-shot', layer: 1, status: 'running' }))
await keyStore.putTask(taskRecord({ taskId: '中文任务号', status: 'running' }))
for (const table of ['docs', 'members', 'tasks']) {
  const keys = [...keyCtx.ctx.storageDomain.opened.get(DOMAIN_NAMES[table]).table(table).keys()]
  assert.equal(keys.length, 1)
  assert.ok(PATH_SAFE_RE.test(keys[0]), `${table} 的物理键必须 path-safe，实际 '${keys[0]}'`)
}
assert.equal(keyStore.getDoc('D:\\x\\中文 目录\\T-001_迁移_L3.md').title, '迁移', '中文路径照样读得回来')
await keyLedger.close()
ok('存储键规范：全部 path-safe / 中文与冒号退化 / 假桩真的会拒非法键')

// 多项目隔离（DESIGN §5.5）：记录带 project 章，读路径按 project 收窄，KV 键带项目前缀喵
assert.equal(projectKeyOf(cfg), 'blockdustry')
assert.equal(projectKeyOf({}), 'default')
const isoCtx = makeCtx()
const isoLedger = createLedger(isoCtx.ctx, 'alpha')
const storeAlpha = await isoLedger.ready
const sharedPath = '/x/T-1_a_L3.md'
await storeAlpha.putDoc(docRecord({ path: sharedPath, tier: 3, taskId: 'T-1', title: 'alpha 版' }))
assert.equal(storeAlpha.getDoc(sharedPath).project, 'alpha', '记录必须盖 project 章')
const isoOpened = isoCtx.ctx.storageDomain.opened
const isoDomains = {
  members: isoOpened.get(DOMAIN_NAMES.members),
  tasks: isoOpened.get(DOMAIN_NAMES.tasks),
  docs: isoOpened.get(DOMAIN_NAMES.docs),
}
const storeBeta = createStore(isoDomains, 'beta')
assert.equal(storeBeta.getDoc(sharedPath), undefined, '别的项目读不到（读路径按 project 收窄）')
assert.equal(storeBeta.listDocs().length, 0)
await storeBeta.putDoc(docRecord({ path: sharedPath, tier: 3, taskId: 'T-1', title: 'beta 版' }))
assert.equal(storeAlpha.getDoc(sharedPath).title, 'alpha 版', '同逻辑键在两个项目下互不覆盖')
assert.equal(storeBeta.getDoc(sharedPath).title, 'beta 版')
await isoLedger.close()
ok('多项目隔离：project 章 / 读路径收窄 / KV 键不互撞')

// ---------------------------------------------------------------- M2：ledger_rebuild
await writeFile(joinUnderRoot(project.deliverablesDir, '旧档-没有头部.md'), '# 旧档\n\n没有 front-matter。\n', 'utf8')
const virginCtx = makeCtx()
const virgin = createLedger(virginCtx.ctx)
const virginStore = await virgin.ready
const rebuilt = await rebuildLedger({ store: virginStore, project })
assert.equal(rebuilt.docs.legacy, 2, 'fixture 的 debug 档与旧档都没有 front-matter，应标 legacy')
assert.ok(rebuilt.docs.scanned >= 5, `实际扫到 ${rebuilt.docs.scanned} 篇`)
const legacyRows = virginStore.listDocs().filter((doc) => doc.legacy)
assert.equal(legacyRows.length, 2)
assert.ok(legacyRows.every((doc) => doc.missingSections.length === 0), 'legacy 不参与 doc_meta_missing')
assert.equal(virginStore.getDoc(emitted.path).missingSections.length, 0, '合规新档无缺失小节')
assert.equal(virginStore.getDoc(fixed.path).tier, 0)
assert.equal(virginStore.getDoc(fixed.path).missingSections.length, 0, 'tier 0 非三档文档不参与 doc_meta_missing')
assert.ok(virginStore.getMember('T-001-researcher'), '应从 front-matter 的 taskId + role 推导出成员')
assert.equal(virginStore.getMember('T-001-researcher').derived, true)
assert.ok(virginStore.getTask('T-001'), '进度文件对应的任务也要登记')

const removed = await rebuildLedger({ store: virginStore, project })
assert.equal(removed.docs.removed, 0, '重复重建必须幂等')
assert.equal(removed.members.added, 0, '成员只增不删')
await rm(shortDoc.path)
const afterDelete = await rebuildLedger({ store: virginStore, project })
assert.equal(afterDelete.docs.removed, 1, '文件没了要清掉陈旧记录')
assert.equal(virginStore.getDoc(shortDoc.path), undefined)
// 删掉台账后能重建 ← 换一个全新 store 再跑，结果应与首次一致
const freshCtx = makeCtx()
const fresh = createLedger(freshCtx.ctx)
const freshStore = await fresh.ready
const fromScratch = await rebuildLedger({ store: freshStore, project })
assert.equal(fromScratch.docs.scanned, afterDelete.docs.scanned, '从零重建应与增量结果一致')
assert.equal(freshStore.sizes().docs, virginStore.sizes().docs)
await Promise.all([ledger.close(), virgin.close(), fresh.close()])
ok('ledger_rebuild：扫描 / legacy 标记 / 派生成员 / 陈旧清理 / 幂等 / 从零重建')

// ---------------------------------------------------------------- M2：图书管理员（骨架 + 格式面）
// 纯函数：巡检 + 直修 + 幂等喵
const pureInspect = inspectDoc({ text: '没有头部\n\n正文', fileName: '旧档.md' })
assert.deepEqual(pureInspect.issues.map((i) => i.code).sort(), ['fm_missing', 'name_noncompliant'])
assert.equal(pureInspect.legacy, true)
const pureFix = fixDoc({ text: '没有头部\n\n正文', fileName: '旧档.md', now: '2026-01-01T00:00:00.000Z' })
assert.equal(pureFix.changed, true)
assert.ok(pureFix.text.includes('librarianTouchedAt: 2026-01-01T00:00:00.000Z'))
assert.ok(pureFix.text.includes('正文'), '正文必须原样保留')
assert.equal(fixDoc({ text: pureFix.text, fileName: '旧档.md' }).changed, false, '修完再修必须幂等')
ok('馆员直修：纯函数巡检 / 补头部 / 留痕 / 幂等')

// 元数据自动派生器（零模型调用）喵
assert.equal(isGenericKeyword('结论'), true)
assert.equal(isGenericKeyword('a'), true, '单字一律算泛词')
assert.equal(isGenericKeyword('迁移'), false)
assert.deepEqual(
  parseGlossary('# 术语表\n\n- 分裂炮台 | scatter | 分裂炮\n- 迁移 | migration\n\n随便一行\n'),
  [{ term: '分裂炮台', synonyms: ['scatter', '分裂炮'] }, { term: '迁移', synonyms: ['migration'] }],
)
assert.deepEqual(
  expandKeywords(['分裂炮台'], parseGlossary('- 分裂炮台 | scatter | 分裂炮\n')),
  ['分裂炮台', 'scatter', '分裂炮'],
  '术语表同义词必须全自动展开',
)
assert.deepEqual(
  extractPaths('见 D:\\p\\a.md 与 src/ledger/store.js 还有 x.md').sort(),
  ['D:\\p\\a.md', 'src/ledger/store.js', 'x.md'],
)
const derived = deriveDocMeta({
  fileName: 'T-001_迁移总结_L3.md',
  text: '## 结论\n\n分裂炮台迁移完成。\n\n见 T-001_细节_L2.md 与 D:\\p\\a.js',
  mtime: 0,
  glossary: parseGlossary('- 分裂炮台 | scatter\n'),
  overrides: {},
})
assert.equal(derived.taskId, 'T-001', 'taskId 由文件名派生')
assert.equal(derived.tier, 3, '档级由 _L 后缀派生')
assert.equal(derived.createdAt, new Date(0).toISOString(), 'createdAt 由 mtime 派生')
assert.ok(derived.chars > 0)
assert.ok(derived.keywords.includes('scatter'), `关键词应含术语表同义词，实际 ${derived.keywords}`)
assert.ok(derived.relatedFiles.includes('D:\\p\\a.js'), `relatedFiles 应正则抓自正文，实际 ${derived.relatedFiles}`)
assert.deepEqual(derived.needsLibrarian, [], '信息齐全时不该报需馆员')
const underivable = deriveDocMeta({ fileName: '旧档.md', text: '没有头部也没有任务号', mtime: 0, legacy: true })
assert.deepEqual(
  underivable.needsLibrarian.map((i) => i.code).sort(),
  ['legacy_no_tier', 'taskid_unknown'],
  '旧档派生失败必须落进 needs_librarian',
)
const genericOnly = deriveDocMeta({ fileName: 'T-001_说明_L1.md', text: '## 结论\n\n内容', mtime: 0 })
assert.ok(
  genericOnly.needsLibrarian.some((i) => i.code === NEEDS_CODES.keywordsGeneric) || genericOnly.keywords.length > 0,
  '关键词要么派生得出来，要么必须报 needs_librarian',
)
const dupRows = [
  { taskId: 'T-1', tier: 3, title: '同名', needsLibrarian: [] },
  { taskId: 'T-1', tier: 3, title: '同名', needsLibrarian: [] },
  { taskId: 'T-1', tier: 2, title: '同名', needsLibrarian: [] },
]
markDuplicates(dupRows)
assert.equal(dupRows.filter((r) => r.needsLibrarian.length > 0).length, 2, '同任务号同档级同标题才判重复')
ok('元数据派生器：术语表展开 / 路径抓取 / 档级任务号时间 / needs_librarian')

// 端到端：破损档（有头部但缺 keywords 与固定小节）+ 一份二级档用于测路径回贴喵
const broken = await docEmit.execute({
  level: 3, taskId: 'T-001', title: '破损档', role: 'implementer',
  body: '## 结论\n\n这段结论必须原样保留，馆员不许改。',
}, { agent, signal })
const l2doc = await docEmit.execute({
  level: 2, taskId: 'T-001', title: '迁移细节', role: 'implementer',
  body: '## 结论\n\n细节。',
}, { agent, signal })

const libCtx = makeCtx()
plugin.apply(libCtx.ctx, cfg)
const rebuildOut = await toolOf('ledger_rebuild').execute()
assert.ok(rebuildOut.summary.needsLibrarian.length > 0, '磁盘上有无头旧档，派生器应报出 needs_librarian')
const patrolOut = await toolOf('librarian_patrol').execute({})
const patched = patrolOut.report.files.find((file) => file.path === broken.path)
assert.equal(patrolOut.report.gated, false, '清单非空，应已唤醒')
assert.ok(patched, `破损档应被直修，实际改了 ${patrolOut.report.files.map((f) => f.path)}`)
assert.ok(patched.changes.some((c) => c.includes('固定小节')), `应补固定小节占位，实际 ${patched.changes}`)
assert.ok(patched.changes.some((c) => c.includes('关联档')), `三级档应回贴另一档的绝对路径，实际 ${patched.changes}`)
assert.ok(patrolOut.report.reportOnly.some((i) => i.code === 'l3_length'), '字数超标只上报不自动改')
// 破损档自身命名是合规的（报告里其它档的 name_noncompliant 来自 _fix.md 这类非三档文档，属正常）喵
assert.ok(!patrolOut.report.reportOnly.some((i) => i.path === broken.path && i.code === 'name_noncompliant'))

const brokenText = await readFile(broken.path, 'utf8')
assert.ok(brokenText.includes('这段结论必须原样保留，馆员不许改。'), '正文结论一个字都不许改')
assert.ok(brokenText.includes('librarianTouchedAt: '), '必须留痕时间')
assert.ok(brokenText.includes('librarianChanges: ['), '必须留痕改动清单')
assert.ok(brokenText.includes('## 风险与待确认'), '缺的固定小节应补占位')
assert.ok(brokenText.includes('## 关联文档（绝对路径）'), '应追加关联文档小节')
assert.ok(brokenText.includes(l2doc.path), '三级档要回贴二级档绝对路径')
assert.ok(/keywords: \["/.test(brokenText), 'keywords 应由派生器自动写入（非空）')

const coreText = await readFile(coreDbPath(project), 'utf8')
assert.ok(coreText.includes('## 变更日志'))
assert.ok(coreText.includes('[格式直修]'), '直修必须留 changelog')
assert.ok(coreText.includes('librarianTouchedAt') === false, 'changelog 只记改动摘要')
ok('馆员巡检端到端：格式直修 + 留痕 + changelog + 正文零改动')

// 闸门反向用例：清单为空时馆员必须空转，不读不改任何档喵
// 注意闸门口径是「扫磁盘现算」，所以要拿一份**干净的项目目录**来测，而不是靠清空台账喵
const libOpened = libCtx.ctx.storageDomain.opened
const libStore = createStore({
  members: libOpened.get(DOMAIN_NAMES.members),
  tasks: libOpened.get(DOMAIN_NAMES.tasks),
  docs: libOpened.get(DOMAIN_NAMES.docs),
}, projectKeyOf(cfg))
const cleanRoot = await mkdtemp(join(tmpdir(), 'ac-clean-'))
const cleanCfg = plugin.Config({ project: { name: 'Clean', root: cleanRoot }, paths: cfg.paths })
const cleanProject = resolveProject(cleanCfg)
await mkdir(cleanProject.deliverablesDir, { recursive: true })
await writeFile(
  joinUnderRoot(cleanProject.deliverablesDir, 'T-001_合规_L3.md'),
  renderFrontMatter({
    taskId: 'T-001', role: 'researcher', tier: 3,
    keywords: ['迁移', 'migration'], relatedFiles: [], createdAt: '2026-01-01T00:00:00.000Z',
  }) + '## 结论\n\n合规档。\n\n## 依据\n\n依据。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。\n',
  'utf8',
)
const cleanGate = await patrol({ project: cleanProject, store: libStore })
assert.equal(cleanGate.gated, true, 'needs_librarian 为空时馆员必须空转')
assert.equal(cleanGate.inspected, 0, '空转时不得读任何档')
// 丢一份无头旧档进去，同一口径立刻应当放行喵
await writeFile(joinUnderRoot(cleanProject.deliverablesDir, '旧档.md'), '# 旧档\n\n没有头部。\n', 'utf8')
assert.equal((await patrol({ project: cleanProject, store: libStore })).gated, false, '清单非空即放行')
await rm(cleanRoot, { recursive: true, force: true })
ok('馆员上游闸门：needs_librarian 为空则空转，非空才唤醒')

// legacy 回填试跑：限量 + 留痕，不做全量喵
const legacyBefore = libStore.listDocs().filter((doc) => doc.legacy).length
assert.ok(legacyBefore >= 2, `fixture 应有存量旧档，实际 ${legacyBefore}`)
const backfillOut = await toolOf('librarian_backfill').execute({ limit: 1 })
assert.equal(backfillOut.report.attempted, 1, '试跑必须限量')
assert.equal(backfillOut.report.updated, 1)
const backfilledFile = backfillOut.report.files[0]
const backfilledText = await readFile(backfilledFile.path, 'utf8')
assert.ok(backfilledText.startsWith('---\n'), '旧档应被补上 front-matter')
assert.ok(backfilledText.includes('librarianChanges: ['), '回填同样要留痕')
assert.equal(libStore.getDoc(backfilledFile.path).legacy, false, '补完头部后不再是 legacy')
assert.equal(libStore.getDoc(backfilledFile.path).tier, 0, '档级仍为 0，故不参与 doc_meta_missing')
assert.ok((await readFile(coreDbPath(project), 'utf8')).includes('[legacy 回填·试跑]'), '回填要留 changelog')
ok('legacy 回填试跑：限量 / 留痕 / 不参与 doc_meta_missing')

// 全量批量入口 ledger_backfill --auto（零模型调用）喵
const dry = await toolOf('ledger_backfill').execute({ auto: true, dryRun: true })
assert.ok(dry.report.scanned >= legacyBefore)
assert.ok(dry.report.files.length >= 1, 'dryRun 也要报出会改哪些档')
const dryTarget = dry.report.files[0]
const beforeDry = await readFile(dryTarget.path, 'utf8')
const auto = await toolOf('ledger_backfill').execute({ auto: true })
assert.equal(auto.report.dryRun, false)
assert.ok(auto.report.updated >= 1, '全量批应把剩余旧档补完')
assert.notEqual(await readFile(dryTarget.path, 'utf8'), beforeDry, 'auto 要真的落盘（dryRun 不落盘）')
assert.ok((await readFile(coreDbPath(project), 'utf8')).includes('[自动补元数据]'), '批量补全要留 changelog')
assert.ok(Array.isArray(auto.report.needsLibrarian))
await assert.rejects(() => toolOf('ledger_backfill').execute({}), /auto=true/, '不带 auto 必须拒绝')
ok('ledger_backfill --auto：dryRun / 全量补元数据 / 缺 auto 报错')

// 口径统一（DESIGN §5.5 勘误）：闸门与 --dryRun 必须调用同一函数算 needs_librarian喵
const dryAgain = await toolOf('ledger_backfill').execute({ auto: true, dryRun: true })
const patrolAgain = await toolOf('librarian_patrol').execute({})
assert.equal(
  patrolAgain.report.queue.length,
  dryAgain.report.needsLibrarian.length,
  `闸门与 dryRun 条数必须一致（闸门 ${patrolAgain.report.queue.length} / dryRun ${dryAgain.report.needsLibrarian.length}）`,
)
const rebuildAgain = await toolOf('ledger_rebuild').execute()
assert.equal(
  rebuildAgain.summary.needsLibrarian.length,
  dryAgain.report.needsLibrarian.length,
  'rebuild 与 dryRun 也必须是同一口径',
)
ok('needs_librarian 口径统一：闸门 / dryRun / rebuild 三处条数一致')

// 馆员角色的通道能力（§5.8：后台常驻 + 便宜档 + 不派单）喵
const librarianRole = getRole(cfg, 'librarian')
assert.equal(librarianRole.mode, 'continuable', '馆员必须后台常驻可续接')
assert.equal(librarianRole.modelRoute, 'librarian', '馆员走便宜档路由')
assert.ok(librarianRole.tools.includes('librarian_patrol') && librarianRole.tools.includes('librarian_backfill'))
assert.ok(!librarianRole.tools.some((name) => name.startsWith('contract_delegate_')), '馆员不派单')
ok('馆员角色：后台常驻 / 便宜档 / 不注册委派工具')

// ---------------------------------------------------------------- FIX 验收
// FIX-1：任务切面禁止搬运任务文件正文；task 段 ≤300；除 mandate 外合计 ≤2500喵
const bigBody = `${'填充内容段落。'.repeat(900)}\n\nMID-MARKER-P2-77c1\n\n${'更多填充内容。'.repeat(300)}\n\nTAIL-MARKER-P2-9f3a`
assert.ok(bigBody.length > 5000, `夹具任务文件必须 >5000 字符，实际 ${bigBody.length}`)
await writeFile(joinUnderRoot(project.tasksDir, 'T-BIG.md'), `# T-BIG 大任务\n\n${bigBody}\n`, 'utf8')
const big = await buildContract({
  config: cfg, roleId: 'researcher', task: { id: 'T-BIG' }, parent: 'p', layer: 1, totalAgents: 1,
})
assert.equal(big.text.includes('TAIL-MARKER-P2-9f3a'), false, 'FIX-1：尾部标记词不得出现在装配文本里')
assert.equal(big.text.includes('MID-MARKER-P2-77c1'), false, 'FIX-1：中段标记词不得出现在装配文本里')
assert.equal(big.text.includes('填充内容段落。'), false, 'FIX-1：任务文件正文的任何片段都不得搬进来')
assert.ok(big.text.includes('T-BIG'), 'FIX-1：任务号仍必须在')
assert.ok(big.text.includes(joinUnderRoot(project.tasksDir, 'T-BIG.md')), 'FIX-1：任务文件绝对路径必须在（子智能体自己去读）')
const bigTaskSeg = big.segments.find((seg) => seg.id === 'task')
assert.ok(bigTaskSeg.chars <= 300, `FIX-1：task 段必须 ≤300 字符，实际 ${bigTaskSeg.chars}`)
assert.ok(
  big.nonMandateChars <= NON_MANDATE_BUDGET,
  `FIX-1：除 mandate 外合计必须 ≤${NON_MANDATE_BUDGET} 字符，实际 ${big.nonMandateChars}`,
)
assert.equal(
  big.warnings.some((w) => w.includes('搬运失控')), false,
  `FIX-1：不应触发搬运失控告警，实际 ${JSON.stringify(big.warnings)}`,
)
ok(`FIX-1 任务切面不搬运正文：task 段 ${bigTaskSeg.chars} 字符，除 mandate 外合计 ${big.nonMandateChars}/${NON_MANDATE_BUDGET}`)

// FIX-2：停用词表要足够宽；命中原因只允许实词；只用泛词不得召回喵
for (const word of ['研究', '产出', '只读', 'docs', 'md', 'png', '文件', '仓库', '待办', '任务']) {
  assert.equal(isStopWord(word), true, `FIX-2：§9-13 要求 ${word} 进停用词表`)
}
assert.equal(isStopWord('迁移'), false, 'FIX-2：实词不得被误判为泛词')
const mixedHits = await searchDocs(project, ['迁移', '研究', '产出', '文件', '仓库', 'md'])
assert.ok(mixedHits.length > 0, 'FIX-2：有实词命中时必须能召回')
for (const hit of mixedHits) {
  assert.ok(
    hit.hitReason.every((word) => !isStopWord(word)),
    `FIX-2：命中原因里不得出现泛词，实际 ${JSON.stringify(hit.hitReason)}`,
  )
  assert.ok(Array.isArray(hit.readHints), 'FIX-2：切片必须带 readHints')
}
assert.deepEqual(
  await searchDocs(project, ['研究', '产出', 'docs', 'md', 'png', '文件', '仓库', '待办', '任务']),
  [],
  'FIX-2：关键词全是泛词时不得召回任何文档',
)
ok('FIX-2 停用词表：泛词不入命中原因 + 纯泛词检索零召回')

// FIX-3：front-matter 列表按 `- ` 行解析，绝不按冒号切；往返必须一致喵
const blockFrontMatter = [
  '---',
  'taskId: T-001',
  'role: researcher',
  'tier: 3',
  'keywords:',
  '  - 迁移',
  '  - migration',
  'relatedFiles:',
  '  - D:\\DSH插件\\仓库\\docs\\子agent\\T-001_细节_L2.md',
  '  - /mnt/d/Blockdustry/仓库/docs/坑/迁移坑.md',
  'createdAt: 2026-01-01T00:00:00.000Z',
  '---',
  '',
  '## 结论',
  '正文',
].join('\n')
const blockParsed = parseFrontMatter(blockFrontMatter)
assert.deepEqual(
  blockParsed.meta.relatedFiles,
  ['D:\\DSH插件\\仓库\\docs\\子agent\\T-001_细节_L2.md', '/mnt/d/Blockdustry/仓库/docs/坑/迁移坑.md'],
  'FIX-3：含中文的 Windows 绝对路径必须原样解析回来',
)
assert.deepEqual(blockParsed.meta.keywords, ['迁移', 'migration'], 'FIX-3：块状列表按 `- ` 行解析')
assert.equal('D' in blockParsed.meta, false, 'FIX-3：`- D:\\…` 不得被按冒号切成键 D（回归）')
assert.equal(blockParsed.meta.relatedFiles.includes(null), false, 'FIX-3：列表里不得出现 null')
const blockRerendered = renderFrontMatter(blockParsed.meta) + blockParsed.body
assert.equal(blockRerendered.includes('relatedFiles: null'), false, 'FIX-3：重渲染不得退化成 null + 孤立行')
const blockReparsed = parseFrontMatter(blockRerendered)
assert.deepEqual(blockReparsed.meta.relatedFiles, blockParsed.meta.relatedFiles, 'FIX-3：往返后 relatedFiles 一致')
assert.deepEqual(blockReparsed.meta.keywords, blockParsed.meta.keywords, 'FIX-3：往返后 keywords 一致')
assert.equal(renderFrontMatter(blockReparsed.meta) + blockReparsed.body, blockRerendered, 'FIX-3：序列化→解析→再序列化必须幂等')
const emptyArrayRoundTrip = renderFrontMatter({ taskId: 'T', role: 'r', tier: 3, keywords: [], relatedFiles: [], createdAt: 'x' })
assert.deepEqual(parseFrontMatter(emptyArrayRoundTrip).meta.keywords, [], 'FIX-3：内联空数组不得退化成 null')
ok('FIX-3 front-matter 往返：块状列表 / Windows 中文路径 / 幂等')

// FIX-4：带产出文案的角色，tools 必须含落盘工具喵
for (const role of listRoles(cfg)) {
  if (!role.deliverable) continue
  for (const tool of ['doc_emit', 'progress_upsert']) {
    assert.ok(role.tools.includes(tool), `FIX-4：${role.id} 的产出契约要求落盘，tools 必须含 ${tool}`)
  }
}
const narrowedRole = listRoles({ roles: [{ id: 'researcher', tools: ['read'] }] }).find((r) => r.id === 'researcher')
assert.ok(narrowedRole.tools.includes('doc_emit'), 'FIX-4：配置覆盖也不得摘掉落盘工具')
const customRole = listRoles({ roles: [{ id: 'archivist', deliverable: '产出档案', tools: ['read'] }] }).find((r) => r.id === 'archivist')
assert.ok(customRole.tools.includes('progress_upsert'), 'FIX-4：自定义角色的产出契约同样受约束')
ok(`FIX-4 落盘工具：${listRoles(cfg).length} 个角色的 tools 均含 doc_emit + progress_upsert`)

// ---------------------------------------------------------------- M2.5 交付物 4：文档目录分类
const kindRoot = await mkdtemp(join(tmpdir(), 'ac-kinds-'))
const kindCfg = plugin.Config({
  project: { name: 'Kinds', root: kindRoot },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑', '仓库/docs/核心数据库', '仓库/docs'],
    archiveDir: '仓库/docs/archive',
    docKinds: {
      研究: '仓库/docs/研究',
      坑: '仓库/docs/坑',
      核心数据库: '仓库/docs/核心数据库',
      产出档: '仓库/docs/子agent',
      归档: '仓库/docs/archive',
    },
  },
})
const kindProject = resolveProject(kindCfg)
const kindDocsRoot = joinUnderRoot(kindProject.root, '仓库/docs')
await mkdir(joinUnderRoot(kindDocsRoot, '研究'), { recursive: true })
await mkdir(joinUnderRoot(kindDocsRoot, '坑'), { recursive: true })
await mkdir(joinUnderRoot(kindDocsRoot, '子agent'), { recursive: true })
await mkdir(joinUnderRoot(kindDocsRoot, 'archive'), { recursive: true })
await mkdir(joinUnderRoot(kindDocsRoot, '未分类'), { recursive: true })
const inKindPath = joinUnderRoot(joinUnderRoot(kindDocsRoot, '研究'), '调研.md')
const rootStrayPath = joinUnderRoot(kindDocsRoot, '散档.md')
const otherDirPath = joinUnderRoot(joinUnderRoot(kindDocsRoot, '未分类'), '乱放.md')
const archivedPath = joinUnderRoot(joinUnderRoot(kindDocsRoot, 'archive'), '旧档.md')
await writeFile(inKindPath, '# 调研\n', 'utf8')
await writeFile(rootStrayPath, '# 散档\n', 'utf8')
await writeFile(otherDirPath, '# 乱放\n', 'utf8')
await writeFile(archivedPath, '# 旧档\n', 'utf8')

assert.equal(classifyDocPath(kindProject, inKindPath), '研究', '规定类目录里的档必须能归类')
assert.equal(classifyDocPath(kindProject, rootStrayPath), null)
assert.equal(isUnder(inKindPath, kindProject.docKinds['研究']), true)
assert.ok(/仓库[\\/]docs$/.test(commonAncestorOf(Object.values(kindProject.docKinds))), '公共父目录应定位到 docs 根')
const misfiledRows = await findMisfiled({ project: kindProject })
assert.equal(misfiledRows.length, 2, `只该报「根目录散文件」与「未分类目录」两篇，实际 ${JSON.stringify(misfiledRows)}`)
assert.equal(misfiledRows.find((row) => row.path === rootStrayPath).reason, 'docs 根目录散文件')
assert.equal(misfiledRows.find((row) => row.path === otherDirPath).reason, '不在任何规定类目录内')
assert.equal(misfiledRows.some((row) => row.path === inKindPath), false, '规定类目录里的档不得被判错')
assert.equal(misfiledRows.some((row) => row.path === archivedPath), false, '归档目录也是规定类目录，不得误报')
// 只报不动
assert.equal(await readFile(rootStrayPath, 'utf8'), '# 散档\n', 'doc_misfiled 不得改写文件')
assert.ok(existsSync(inKindPath) && existsSync(otherDirPath) && existsSync(archivedPath), 'doc_misfiled 不得移动文件')
// contract_status 与配置逐条一致
const kindToolCtx = makeCtx()
plugin.apply(kindToolCtx.ctx, kindCfg)
const kindStatus = await toolOf('contract_status').execute({}, {})
assert.deepEqual(kindStatus.project.docKinds, kindProject.docKinds)
assert.equal(kindStatus.project.archiveDir, kindProject.archiveDir)
assert.deepEqual(kindStatus.project.docsDirs, kindProject.docsDirs)
assert.ok(kindStatus.scan.dirs.some((dir) => dir.label === 'archive'), '归档目录必须进体检清单')
assert.ok(kindStatus.scan.dirs.some((dir) => dir.label === 'kind:研究'), '每个文档类别目录都要单独体检')
assert.equal(kindStatus.misfiled.length, 2, 'contract_status 必须回显 doc_misfiled')
// 过渡源（仓库/docs 根，deprecated）也必须在检索范围内，否则旧档失联喵
const legacyDocPath = joinUnderRoot(kindDocsRoot, '迁移旧档.md')
await writeFile(legacyDocPath, '# 迁移旧档\n\n分裂炮台的老记录。\n', 'utf8')
const legacyHits = await searchDocs(kindProject, ['分裂炮台'])
assert.ok(
  legacyHits.some((hit) => hit.path === legacyDocPath),
  `M2.5-4：过渡源目录里的旧档必须能被检索，实际 ${JSON.stringify(legacyHits.map((h) => h.path))}`,
)
await rm(kindRoot, { recursive: true, force: true })
ok('M2.5-4 文档目录分类：doc_misfiled 只报不动 + contract_status 与配置逐条一致')

// ---------------------------------------------------------------- M2.5 交付物 2：检索阶梯进角色卡
const LADDER_ORDER = ['doc_search', 'glob', 'grep', 'read', 'session_search']
for (const role of listRoles(cfg)) {
  for (const layer of LADDER_ORDER) {
    assert.ok(role.persona.includes(layer), `M2.5-2：${role.id} 的角色卡必须提到 ${layer}`)
  }
  const positions = LADDER_ORDER.map((layer) => role.persona.indexOf(layer))
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i] > positions[i - 1],
      `M2.5-2：${role.id} 的检索阶梯顺序必须按 ${LADDER_ORDER.join(' → ')}，实际位置 ${JSON.stringify(positions)}`,
    )
  }
}
const ladderAfterOverride = listRoles({ roles: [{ id: 'researcher', persona: '只有一句话' }] }).find((role) => role.id === 'researcher')
assert.ok(ladderAfterOverride.persona.includes('doc_search'), 'M2.5-2：覆盖 persona 后检索阶梯仍须存在')
ok('M2.5-2 检索阶梯：五个角色卡都含 L0~L4 且顺序正确')

// ---------------------------------------------------------------- M2.5 交付物 1：doc_search（L0）
const searchCtx = makeCtx()
plugin.apply(searchCtx.ctx, cfg)
const hitDoc = await docEmit.execute({
  level: 3, taskId: 'T-102', title: '分裂炮台迁移', role: 'researcher', keywords: ['分裂炮台', 'scatter'],
  body: '## 结论\n\n分裂炮台已迁移到 scatter 布局。\n\n## 依据\n\n实测见迁移记录。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。',
}, { agent, signal })
await docEmit.execute({
  level: 3, taskId: 'T-101', title: '干净档', role: 'researcher',
  body: '## 结论\n\n与查询无关的内容。\n\n## 依据\n\n无。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。',
}, { agent, signal })
await docEmit.execute({
  level: 3, taskId: 'T-103', title: '研究产出文件仓库', role: 'researcher',
  body: '## 结论\n\n研究产出文件都放仓库。\n\n## 依据\n\n无。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。',
}, { agent, signal })
await toolOf('ledger_rebuild').execute()

const search = toolOf('doc_search')
const hits = await search.execute({ query: '分裂炮台' })
assert.equal(hits.results.length, 1, `M2.5-1：只应召回命中档，实际 ${JSON.stringify(hits.results.map((r) => r.path))}`)
assert.equal(hits.results[0].path, hitDoc.path)
assert.ok(hits.results[0].hitReason.length > 0, 'M2.5-1：必须有命中原因')
assert.ok(hits.results[0].hitReason.every((word) => !isStopWord(word)), `M2.5-1：命中原因只允许实词，实际 ${JSON.stringify(hits.results[0].hitReason)}`)
assert.deepEqual(Object.keys(hits.results[0].matchedIn).sort(), ['body', 'keywords', 'title'], 'M2.5-1：score 必须可解释')
assert.ok(hits.results[0].score >= SCORE_WEIGHTS.keywords, 'M2.5-1：关键词命中应计入权重')
assert.ok(hits.results[0].snippets.length > 0 && hits.results[0].snippets.length <= 3, 'M2.5-1：每篇 ≤3 条命中行')
assert.equal(typeof hits.results[0].snippets[0].line, 'number', 'M2.5-1：命中行必须带行号')
assert.ok(
  hits.results[0].snippets.every((snip) => !/^(keywords|taskId|role|tier|createdAt|relatedFiles):/.test(snip.text)),
  `M2.5-1：命中行不得指向 front-matter（那是元数据，不是内容），实际 ${JSON.stringify(hits.results[0].snippets)}`,
)
assert.ok(hits.suggest.length > 0, 'M2.5-1：必须给 readHints 建议')
assert.ok(hits.suggest.every((item) => item.includes('#')), 'M2.5-1：suggest 形如 <路径>#小节')
assert.ok(hits.suggest.some((item) => item.startsWith(hitDoc.path) && item.includes('#结论')), `M2.5-1：建议应指向命中档的固定小节，实际 ${JSON.stringify(hits.suggest)}`)
assert.equal(hits.strategy, 'linear')
assert.ok(FTS_THRESHOLD >= 1000, 'M2.5-1：FTS 切换阈值必须留位')

// 先过滤后匹配：filtered 明显小于 scanned，且不丢命中候选
const filteredHits = await search.execute({ query: '分裂炮台', taskId: 'T-102' })
assert.equal(filteredHits.filtered, 1, 'M2.5-1：taskId 过滤后只应剩 1 篇候选')
assert.ok(filteredHits.filtered < filteredHits.scanned, `M2.5-1：必须先过滤再匹配（filtered ${filteredHits.filtered} < scanned ${filteredHits.scanned}）`)
assert.equal(filteredHits.results.length, 1, 'M2.5-1：过滤不得丢掉含该实词的候选')
const tierHits = await search.execute({ query: '分裂炮台', tier: 1 })
assert.deepEqual(tierHits.results, [], 'M2.5-1：tier 过滤应生效')

// 纯泛词零召回（复用 FIX-2 的停用词表）
const searchGenericOnly = await search.execute({ query: '研究 产出 文件 仓库 md png 待办 任务' })
assert.deepEqual(searchGenericOnly.results, [], 'M2.5-1：纯泛词查询必须零召回')
assert.equal(searchGenericOnly.filtered, 0)
assert.deepEqual(parseQuery('/分裂炮台|scatter/').words, [], 'M2.5-1：正则形态应被识别')
const regexHits = await search.execute({ query: '/分裂炮台|scatter/' })
assert.ok(regexHits.results.length >= 1, 'M2.5-1：正则查询应可用')
assert.deepEqual(parseQuery('研究 产出').words, [], 'M2.5-1：纯泛词在解析阶段就被剔掉')
ok('M2.5-1 doc_search：L0 先过滤后匹配 / 实词命中原因 / snippets / suggest / 纯泛词零召回')

// ---------------------------------------------------------------- M2.5 交付物 3：索引订阅与节流
const syncClock = { t: 0 }
const sync = createIndexSync({ maxEvents: 200, flushMs: 5000, now: () => syncClock.t })
let flushes = 0
for (let i = 0; i < 1000; i += 1) {
  if (sync.record(`p-${i}.md`)) { sync.drain(); flushes += 1 }
}
assert.equal(sync.stats().events, 1000, 'M2.5-3：事件必须全部记账')
assert.equal(flushes, 5, `M2.5-3：按 200 事件阈值 1000 条只该刷 5 次，实际 ${flushes}`)
assert.ok(flushes * 50 < 1000, 'M2.5-3：写入次数必须远小于事件数')
// 时间窗：攒不满阈值，但过了窗口也要刷
const windowSync = createIndexSync({ maxEvents: 200, flushMs: 5000, now: () => syncClock.t })
syncClock.t = 0
windowSync.record('a.md')
assert.equal(windowSync.isDue(), false, 'M2.5-3：刚记一条不该到期')
syncClock.t = INDEX_FLUSH_DEFAULTS.flushMs + 1
assert.equal(windowSync.isDue(), true, 'M2.5-3：过时间窗必须到期')
assert.deepEqual(windowSync.drain(), ['a.md'])
// 幂等：同一变更重复投递不产生额外队列项
const idemSync = createIndexSync()
for (let i = 0; i < 10; i += 1) idemSync.record('same.md')
assert.equal(idemSync.stats().pending, 1, 'M2.5-3：同一变更重复投递只入队一次')
assert.equal(idemSync.stats().events, 10)

// 全量重建 vs 事件累积：索引必须一致
const autoCtx = makeCtx()
const autoLedger = createLedger(autoCtx.ctx, projectKeyOf(cfg))
const autoStore = await autoLedger.ready
await rebuildLedger({ store: autoStore, project })
autoLedger.rebuildIndex()
assert.equal(autoLedger.index.size(), autoStore.listDocs().length, 'M2.5-3：rebuild 后索引与台账必须一致')
const eventIndex = createSearchIndex()
for (const record of autoStore.listDocs()) { eventIndex.upsert(record); eventIndex.upsert(record) }
assert.deepEqual(eventIndex.snapshot(), autoLedger.index.snapshot(), 'M2.5-3：事件累积索引必须等于全量重建索引')

// 事件驱动端到端：攒够阈值才落索引，且 put 事件按 value.path 精确定位
const eventCtx = makeCtx()
const eventLedger = createLedger(eventCtx.ctx, projectKeyOf(cfg))
const eventStore = await eventLedger.ready
const livePath = joinUnderRoot(project.deliverablesDir, 'T-900_事件档_L3.md')
await eventStore.putDoc(docRecord({ path: livePath, tier: 3, taskId: 'T-900', title: '事件档' }))
// 同一路径重复投递：只入队一次，永远攒不满阈值（这正是节流该有的样子）喵
eventCtx.ctx.emit('domain/changed', { domain: DOMAIN_NAMES.docs, table: 'docs', key: 'physical-key', operation: 'put', value: { path: livePath } })
for (let i = 0; i < 50; i += 1) {
  eventCtx.ctx.emit('domain/changed', { domain: DOMAIN_NAMES.docs, table: 'docs', key: `k-${i}`, operation: 'put', value: { path: livePath } })
}
assert.equal(eventLedger.index.has(livePath), false, 'M2.5-3：重复投递同一档不得攒够阈值')
assert.equal(eventLedger.sync.stats().events, 51, 'M2.5-3：事件必须全部记账')
assert.equal(eventLedger.sync.stats().pending, 1, 'M2.5-3：去重后只剩 1 个待处理路径')
// 换成不同路径，攒够阈值就落索引（livePath 也在这一批里）喵
for (let i = 0; i < INDEX_FLUSH_DEFAULTS.maxEvents; i += 1) {
  const path = joinUnderRoot(project.deliverablesDir, `T-9${i}_事件_L3.md`)
  await eventStore.putDoc(docRecord({ path, tier: 3, taskId: `T-9${i}`, title: `事件档${i}` }))
  eventCtx.ctx.emit('domain/changed', { domain: DOMAIN_NAMES.docs, table: 'docs', key: `phys-${i}`, operation: 'put', value: { path } })
}
assert.equal(eventLedger.index.has(livePath), true, 'M2.5-3：到阈值后必须落索引')
const eventStats = eventLedger.sync.stats()
assert.ok(eventStats.events > INDEX_FLUSH_DEFAULTS.maxEvents, 'M2.5-3：事件数应超过阈值')
assert.ok(eventStats.flushes <= 3, `M2.5-3：${eventStats.events} 次事件不该变成 ${eventStats.events} 次写入，实际 ${eventStats.flushes}`)
assert.ok(eventStats.flushes * 50 < eventStats.events, 'M2.5-3：写入次数必须远小于事件数')
await Promise.all([autoLedger.close(), eventLedger.close()])
ok('M2.5-3 索引订阅：节流生效 / 幂等 / 事件累积与全量重建一致 / 按 value.path 增量定位')

// ---------------------------------------------------------------- M3 交付物 2：面板只读查询
const panelCtx = makeCtx()
const panelLedger = createLedger(panelCtx.ctx, projectKeyOf(cfg))
const panelStore = await panelLedger.ready
// 空台账：不得抛错，计数全空
const emptySnap = await buildSnapshot({ store: panelStore, project })
assert.deepEqual(emptySnap.members, [], 'M3-2：空台账不得抛错，成员为空')
assert.deepEqual(emptySnap.roots, [])
assert.deepEqual(emptySnap.counts.docs, {})
assert.deepEqual(emptySnap.counts.tasks, {})
assert.deepEqual(emptySnap.counts.members, {})
assert.deepEqual(emptySnap.audit, { red: 0, yellow: 0, green: 0, placeholder: true }, 'M3-2：审计摘要是占位（M4 接真实现）')

// 缺字段 + 单条坏记录 + 正常记录混在一起
await panelStore.putMember(memberRecord({ name: 'T-301-lead', role: 'researcher', mode: 'continuable', layer: 0, status: 'running', parent: '主代理' }))
await panelStore.putMember({ ...memberRecord({ name: 'T-301-impl', role: 'implementer', mode: 'one-shot', layer: 1, status: 'completed', parent: 'T-301-lead' }), id: 'sess-impl' })
// 坏记录：字段类型离谱（schema 会拒，所以绕过 schema 直接塞进领域表模拟历史脏数据）喵
await panelCtx.ctx.storageDomain.opened.get(DOMAIN_NAMES.members).table('members')
  ._records.set('bad-record-1', { project: projectKeyOf(cfg), name: 'T-301-bad', role: 'reviewer', mode: 'one-shot', layer: 'NaN', parent: null, status: 'running', model: null, route: null, costUsd: null, latestDeliverable: null, lastActiveAt: null, derived: false })
await panelStore.putTask(taskRecord({ taskId: 'T-301', status: 'running', owner: 'T-301-lead' }))
await panelStore.putDoc(docRecord({ path: '/x/T-301_a_L3.md', tier: 3, taskId: 'T-301', title: 'a' }))
const snap = await buildSnapshot({ store: panelStore, project })
assert.equal(snap.members.length, 3, 'M3-2：坏记录不得带塌整棵苗')
for (const node of snap.members) {
  for (const field of MEMBER_FIELDS) {
    assert.ok(field in node, `M3-2：成员节点必须含字段 ${field}（缺的补 null）`)
  }
  assert.ok(node.badges, 'M3-2：每个节点必须有徽章')
}
const leadNode = snap.members.find((n) => n.name === 'T-301-lead')
const implNode = snap.members.find((n) => n.name === 'T-301-impl')
assert.equal(leadNode.modelRoute, null, 'M3-2：route 映射为 modelRoute')
assert.equal(leadNode.taskId, 'T-301')
assert.equal(implNode.mode, 'one-shot')
// 谱系：主代理 → lead → impl（坏记录 parent 为空，因此自己也是一棵树根）喵
assert.equal(snap.roots.length, 2, 'M3-2：parent 为空的成员各自成树根')
const leadRoot = snap.roots.find((node) => node.name === 'T-301-lead')
assert.ok(leadRoot, 'M3-2：lead 必须挂在根上')
assert.equal(leadRoot.children.length, 1)
assert.equal(leadRoot.children[0].name, 'T-301-impl')
// 徽章：该任务只有 1/3 档 → warn；进度文件不在 → missing
assert.equal(leadNode.badges.contract, BADGE.ok)
assert.equal(leadNode.badges.docs, BADGE.warn, 'M3-2：三档不全应为 warn')
assert.equal(leadNode.badges.progress, BADGE.missing, 'M3-2：无进度文件应为 missing')
assert.equal(leadNode.badges.budget, BADGE.unknown, 'M3-2：预算徽章 M3 阶段未知（不实现 M4 审计）')
assert.equal(leadNode.badges.crossVendor, BADGE.unknown)
assert.deepEqual(snap.counts.docs, { L3: 1 })
assert.deepEqual(snap.counts.tasks, { running: 1 })
assert.deepEqual(snap.counts.members, { running: 2, completed: 1 })
// 坏记录不得让查询抛错：再跑一次仍然稳
await assert.doesNotReject(() => buildSnapshot({ store: panelStore, project }), 'M3-2：坏数据不得让查询抛错')
// 台账整个不可用也要降级
const deadSnap = await buildSnapshot({ store: { listMembers: () => { throw new Error('boom') }, listDocs: () => { throw new Error('boom') }, listTasks: () => { throw new Error('boom') } }, project })
assert.deepEqual(deadSnap.members, [], 'M3-2：台账炸了也要降级为空值')
assert.equal(deadSnap.project.root, project.root, 'M3-2：降级时项目信息仍在')
await panelLedger.close()
ok('M3-2 面板只读查询：字段齐 / 谱系成树 / 计数 / 空与坏数据降级')

// ---------------------------------------------------------------- M3 交付物 1 + 3：client tab
const clientSource = await readFile(new URL('./src/client/tab.js', import.meta.url), 'utf8')
// VM 里造出来的数组带着另一个 realm 的原型，deepStrictEqual 会因此失败，先转回宿主 realm 喵
const toHost = (value) => JSON.parse(JSON.stringify(value))
// ① client 是**经典脚本**：顶层不得有 ESM 语法（宿主用 <script> 加载）
assert.equal(/^\s*(import|export)\s/m.test(clientSource), false, 'M3-1：client 入口必须是经典脚本，不能出现 ESM import/export')
assert.ok(clientSource.includes('window.__ModuleLoader__.load('), 'M3-1：必须通过 window.__ModuleLoader__.load 注册')
assert.ok(clientSource.includes("id: 'dsh-agent-contract'"), 'M3-1：module id 必须等于包名')
// ② 按宿主的方式求值：fake window + 受限 require
const registrations = []
const sandbox = { console }
sandbox.window = { __ModuleLoader__: { load: (reg) => registrations.push(reg) } }
// FIX-25：给沙箱一个假 localStorage，好把"面板 UI 状态主存"这条测出来喵
const localStore = new Map()
sandbox.window.localStorage = {
  getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
  setItem: (key, value) => localStore.set(key, String(value)),
}
/**
 * 假 React 喵：`createElement` 之外还要有**最小 hooks** —— 否则 FIX-54 的渲染冒烟连组件都调不起来喵。
 * `useState` 只取初值（冒烟是"渲染一遍"，不驱动状态更新）；`useEffect` 刻意不执行
 * （否则会去拉数据，冒烟就变成集成测试了）；`useMemo`/`useCallback`/`useRef` 按语义给喵。
 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', value }),
}
const required = []
const fakeRequire = (name) => {
  required.push(name)
  if (name === 'react') return fakeReact
  throw new Error(`missed the module table: ${name}`)
}
vm.runInNewContext(clientSource, sandbox, { filename: 'client-tab.js' })
assert.equal(registrations.length, 1, 'M3-1：必须注册恰好一个 bundle factory')
assert.equal(registrations[0].id, 'dsh-agent-contract')
const clientModule = registrations[0].factory(fakeRequire)
assert.deepEqual(required, ['react'], 'M3-1：只允许 require baseline（react），不得额外请求模块')
assert.equal(typeof clientModule.apply, 'function')
// FIX-52 起还要 inject `slots` / `configForms`（设置页那一栏靠它们；官方 client 插件同款名单），
// 否则访问即抛错、被 try 探测静默吞掉 ⇒ 设置页永远不出现（真机踩过）喵
assert.deepEqual(
  toHost(clientModule.inject),
  ['betterSidebar', 'remote', 'remote.session', 'remote.workspaceFiles', 'slots', 'configForms'],
  'M3-1/FIX-13/FIX-52：必须 inject cordis 服务名（remote.* + slots + configForms）',
)
// ③ 静默降级 + 正常注册
assert.doesNotThrow(() => clientModule.apply({}), 'M3-1：宿主无 betterSidebar 时不得报错')
assert.doesNotThrow(() => clientModule.apply(null))
assert.doesNotThrow(
  () => clientModule.apply({ betterSidebar: { registerTab: () => { throw new Error('boom') } }, effect: (cb) => cb() }),
  'M3-1：注册失败必须静默降级',
)
const tabs = []
let disposed = 0
clientModule.apply({
  betterSidebar: { registerTab: (descriptor) => { tabs.push(descriptor); return () => { disposed += 1 } } },
  effect: (cb) => { const disposer = cb(); return disposer },
})
assert.equal(tabs.length, 1, 'M3-1：必须注册恰好一个 tab')
const tab = tabs[0]
assert.equal(tab.title, '契约', 'M3-1：tab 标题必须是「契约」')
assert.equal(tab.id, 'agent-contract:contract')
assert.equal(tab.single, true, 'M3-1：单实例，避免重复开 tab')
assert.equal(typeof tab.component, 'function')
assert.ok(tab.icon(16), 'M3-1：图标必须是主题色 glyph（返回节点），不是 emoji')
assert.equal(
  tab.settings.pluginToggles[0].key, 'hideDoneOneShot',
  'M3-3.3：过滤开关必须声明为 pluginToggles（宿主据此渲染开关并持久化到 pluginSettings）',
)
assert.equal(tab.settings.pluginToggles[0].type, 'switch')
assert.ok(tab.component({ tab: { meta: {} }, ctx: {} }), 'M3-1：无数据时组件也必须能渲染（空态）')

// 交付物 3 的视图逻辑（client 是经典脚本，Node 侧只能从 __internals 取纯函数来测）
const view = clientModule.__internals
assert.ok(view, 'M3-3：客户端必须暴露测试钩子')
// 3.2 配色：五类角色 + 对抗专属色
const fiveRoles = ['researcher', 'implementer', 'reviewer', 'adversary', 'librarian'].map(view.roleColor)
assert.equal(new Set(fiveRoles).size, 5, 'M3-3.2：五个角色必须各一色')
assert.notEqual(view.roleColor('adversary'), view.roleColor('reviewer'), 'M3-3.2：对抗审查必须与审查不同色')
assert.notEqual(view.roleColor('adversary'), view.roleColor('implementer'), 'M3-3.2：对抗审查必须与实现不同色')
assert.equal(view.roleColor('没人认识的角色'), view.ROLE_COLORS['成员'], 'M3-3.2：未知角色退化为主色')
assert.ok(view.ROLE_COLORS['主代理'], 'M3-3.2：主代理必须有独立色')
// 3.3 过滤：默认隐藏已完成的一次性
assert.equal(view.defaultPrefs().hideDoneOneShot, true, 'M3-3.3：默认必须隐藏已完成的一次性节点')
const treeFixture = [{
  name: 'T-401-lead', parent: '主代理', role: 'researcher', mode: 'continuable', status: 'running', layer: 0,
  children: [
    { name: 'T-401-impl', parent: 'T-401-lead', role: 'implementer', mode: 'one-shot', status: 'completed', layer: 1, children: [] },
    { name: 'T-401-rev', parent: 'T-401-lead', role: 'reviewer', mode: 'continuable', status: 'running', layer: 1, children: [] },
  ],
}]
const filtered = view.filterTree(treeFixture, view.defaultPrefs())
assert.deepEqual(toHost(filtered.map((node) => node.name)), ['T-401-lead'])
assert.deepEqual(toHost(filtered[0].children.map((node) => node.name)), ['T-401-rev'], 'M3-3.3：已完成的一次性节点默认被隐藏')
assert.deepEqual(
  toHost(view.filterTree(treeFixture, { hideDoneOneShot: false })[0].children.map((node) => node.name)),
  ['T-401-impl', 'T-401-rev'],
  'M3-3.3：关掉开关后必须能看见',
)
assert.deepEqual(
  toHost(view.flattenTree(filtered).map((row) => [row.node.name, row.depth])),
  [['T-401-lead', 0], ['T-401-rev', 1]],
  'M3-3：树层级必须正确',
)
assert.equal(view.nodeKind(treeFixture[0]), '主代理')
assert.equal(view.nodeKind(treeFixture[0].children[0]), '子智能体')
// 3.4 徽章：五枚 + 缺三档可变 ✗
const badgeRow = view.badgeRow({ badges: { contract: 'ok', docs: 'missing', progress: 'missing', budget: 'unknown', crossVendor: 'unknown' } })
assert.deepEqual(toHost(badgeRow.map((item) => item.key)), ['契约', '三档', '进度', '预算', '异源'], 'M3-3.4：五枚徽章')
assert.equal(badgeRow.find((item) => item.key === '三档').value, 'missing', 'M3-3.4：缺三档必须能显示 ✗')
// FIX-20：符号字段由 `text` 更名为 `symbol`（同一个断言意图，语义更准：它是**符号**不是文案）喵
assert.equal(view.BADGE_VIEW.missing.symbol, '✗')
// 数据源 = remote.session（M3 收口 B 方案）：纯映射全部可单测
const sessionItems = [
  { sessionId: 'root-1', running: true, agentAvailable: true, updatedAt: 1 },
  { sessionId: 'impl-1', parentSessionId: 'root-1', origin: 'subagent', running: true, agentAvailable: true, updatedAt: 2 },
  { sessionId: 'rev-1', parentSessionId: 'root-1', origin: 'subagent', running: false, agentAvailable: true, updatedAt: 3 },
  { sessionId: 'adv-1', parentSessionId: 'root-1', origin: 'subagent', running: false, agentAvailable: false, updatedAt: 4 },
  { sessionId: 'other-root', running: true, agentAvailable: true, updatedAt: 5 },
]
const infos = {
  'impl-1': { label: 'T-501-implementer', mode: 'continuable', model: 'deepseek-flash' },
  'rev-1': { label: 'T-501-reviewer', mode: 'continuable', model: 'deepseek-flash' },
  'adv-1': { label: 'T-501-adversary', mode: 'one-shot', model: 'glm-4' },
}
const snapshot = view.snapshotFromSessions(sessionItems, infos, 'impl-1')
assert.equal(snapshot.source, 'remote.session', 'M3-3：数据源必须是宿主现成 remote.session')
assert.equal(snapshot.roots.length, 1, 'M3-3：以当前会话的最顶层祖先为根')
assert.equal(snapshot.roots[0].sessionId, 'root-1', 'M3-3：从子会话进来也要显示完整血缘')
assert.deepEqual(toHost(snapshot.roots[0].children.map((node) => node.sessionId)), ['impl-1', 'rev-1', 'adv-1'])
assert.equal(snapshot.roots[0].layer, 0)
assert.equal(snapshot.roots[0].children[0].layer, 1, 'M3-3：层级必须正确')
assert.equal(snapshot.members.length, 4, 'M3-3：别的会话树不得混进来')
assert.equal(snapshot.members.some((node) => node.sessionId === 'other-root'), false)
// 角色来自子智能体 label 反解
assert.equal(snapshot.roots[0].role, '主代理')
assert.equal(snapshot.roots[0].children[0].role, 'implementer')
assert.equal(snapshot.roots[0].children[2].role, 'adversary')
assert.equal(snapshot.roots[0].children[2].taskId, 'T-501')
// 状态与模式
assert.equal(snapshot.roots[0].children[0].status, 'running')
assert.equal(snapshot.roots[0].children[1].status, 'idle', 'M3-3：不跑但持有活 Agent ⇒ idle')
assert.equal(snapshot.roots[0].children[2].status, 'completed')
assert.equal(snapshot.roots[0].children[2].mode, 'one-shot', 'M3-3：投影给了权威 mode 就用它')
assert.equal(snapshot.roots[0].children[2].badges.contract, 'ok', 'M3-3.4：子智能体契约 ✓')
assert.equal(snapshot.roots[0].badges.contract, 'unknown', 'M3-3.4：主代理不适用契约徽章')
// 数据源待接的两枚徽章与计数
assert.equal(snapshot.roots[0].children[0].badges.docs, 'unknown', 'M3-3.4：三档徽章数据源待接')
assert.equal(snapshot.roots[0].children[0].badges.progress, 'unknown')
assert.equal(snapshot.counts.docs, 'unknown')
assert.equal(snapshot.counts.tasks, 'unknown')
assert.ok(snapshot.notes.some((text) => text.includes('数据源待接')), 'M3-3.4：必须显式标注数据源待接')
assert.deepEqual(toHost(snapshot.counts.members), { running: 2, idle: 1, completed: 1 })
const pendingRow = view.badgeRow({ badges: {} })
assert.ok(pendingRow.find((item) => item.key === '三档').pending, 'M3-3.4：三档徽章必须标 pending')
assert.ok(pendingRow.find((item) => item.key === '进度').pending, 'M3-3.4：进度徽章必须标 pending')
// 异源：adversary(glm-4) vs 同批 implementer(deepseek-flash) ⇒ ✓
assert.equal(snapshot.roots[0].children[2].badges.crossVendor, 'ok', 'M3-3.4：adversary 与 implementer 不同模型 ⇒ 异源 ✓')
assert.equal(snapshot.roots[0].children[1].badges.crossVendor, 'unknown', 'M3-3.4：非 adversary 不判异源')
const sameModel = view.snapshotFromSessions(sessionItems, {
  ...infos,
  'adv-1': { label: 'T-501-adversary', mode: 'one-shot', model: 'deepseek-flash' },
}, 'root-1')
assert.equal(sameModel.roots[0].children[2].badges.crossVendor, 'missing', 'M3-3.4：与 implementer 同模型 ⇒ 非真异源 ✗')
// 拿不到投影信息也要能出树（降级为通用名 + 成员灰）
const bare = view.snapshotFromSessions(sessionItems, {}, 'root-1')
assert.equal(bare.roots[0].children.length, 3)
assert.ok(bare.roots[0].children[0].name.startsWith('子智能体'), 'M3-3：拿不到 label 时给可读占位名')
assert.equal(bare.roots[0].children[0].role, null, 'M3-3：拿不到 label 时角色未知')
assert.equal(view.roleColor(null), view.ROLE_COLORS['成员'], 'M3-3.2：未知角色用成员灰')
// 会话为空 / 当前会话不在可见血缘里：降级为空树，不得抛错
assert.deepEqual(toHost(view.snapshotFromSessions([], {}, 'nope').roots), [])
// FIX-12：items 不含 scope 时**必须回退成全森林**（roots>=1），而不是返回空树让面板显示「成员 0」喵
const fallbackForest = view.snapshotFromSessions(sessionItems, {}, 'nope')
assert.ok(fallbackForest.roots.length >= 1, `FIX-12：items 不含 scope 时 roots 必须 >=1，实际 ${fallbackForest.roots.length}`)
assert.ok(fallbackForest.members.length >= 1, 'FIX-12：回退后必须真的渲染出成员')
assert.deepEqual(
  toHost(fallbackForest.roots.map((node) => node.sessionId)).sort(),
  ['other-root', 'root-1'],
  'FIX-12：回退取的是 items 里的顶层根',
)
// FIX-12 最小复现矩阵（审查方 vm 实测的四格）
assert.equal(view.snapshotFromSessions([], {}, 'x').roots.length, 0, 'FIX-12：items=[] → roots=0（数据源为空）')
assert.equal(view.snapshotFromSessions([], {}, 'x').members.length, 0, 'FIX-12：items=[] → members=0')
assert.ok(view.snapshotFromSessions(sessionItems, {}, 'x').roots.length >= 1, 'FIX-12：items 不含 scope → roots>=1（本次修复的直接回归位）')
assert.equal(view.snapshotFromSessions(sessionItems, infos, 'root-1').roots.length, 1, 'FIX-12：血缘正常 → roots=1')
assert.equal(view.snapshotFromSessions(sessionItems, infos, 'root-1').members.length, 4, 'FIX-12：血缘正常 → members 正确')
// 空态三分类的文案必须互不相同、且各自对应不同成因
assert.ok(view.EMPTY_STATES.sourceEmpty.includes('数据源为空'), 'FIX-12：空态①文案')
assert.ok(view.EMPTY_STATES.filteredOut.includes('过滤后无可见节点'), 'FIX-12：空态②文案')
assert.ok(view.EMPTY_STATES.failed.includes('加载失败'), 'FIX-12：空态③文案')
assert.equal(new Set([view.EMPTY_STATES.sourceEmpty, view.EMPTY_STATES.filteredOut, view.EMPTY_STATES.failed]).size, 3, 'FIX-12：三种空态不许混')
assert.equal(view.EMPTY_STATES.showAll, '显示全部', 'FIX-12：过滤空态必须给「显示全部」自救入口')
ok('FIX-12 面板成员 0：items 不含 scope → roots>=1 / 空态三分类不混 / 显示全部自救入口')
ok('M3-1/3 client tab：经典脚本契约 / 静默降级 / 配色 / 过滤 / 徽章 / remote.session 映射')

// ---------------------------------------------------------------- M4 交付物 1：audit_scan
// 配置校验：未知检查项必须**报错**（不静默忽略）
assert.throws(() => assertKnownChecks({ audit: { checks: ['missing_doc', '不存在的检查'] } }), /未知的 audit\.checks 项/, 'M4-1：未知检查项必须报错')
assert.deepEqual(toHost(assertKnownChecks({ audit: { checks: ['missing_doc'] } })), ['missing_doc'])
assert.equal(CHECK_IDS.length, 24, 'M4-1：检查项必须齐（FIX-68/69/70/71 共 20 项 + FIX-77 legacy 待归档 + FIX-85 簿记无留痕 + FIX-100 绕过契约 ⇒ 23 项）')

const auditRoot = await mkdtemp(join(tmpdir(), 'ac-audit-'))
// 注意：保留**原始输入**一份（`auditCfgInput`）—— 解析过的 config 不能再被 spread 后重进 schema
// （volatile 字段会被投影成只读 getter ⇒ `TypeError: Cannot assign to read only property`），
// 这正是护栏③"只解析一次"要防的坑，套件自己也得守喵。
const auditCfgInput = {
  project: { name: 'Audit', root: auditRoot },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究'],
    archiveDir: '仓库/docs/archive',
    docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/子agent', 归档: '仓库/docs/archive' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
}
const auditCfg = plugin.Config(auditCfgInput)
const auditProject = resolveProject(auditCfg)
await mkdir(auditProject.deliverablesDir, { recursive: true })
await mkdir(joinUnderRoot(auditProject.root, '仓库/docs'), { recursive: true })
await mkdir(auditProject.progressDir, { recursive: true })

const auditCtx = makeCtx()
const auditLedger = createLedger(auditCtx.ctx, projectKeyOf(auditCfg))
const auditStore = await auditLedger.ready
const oldStamp = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
const freshStamp = new Date().toISOString()

// 成员：正例（缺档 / 一次性无产出 / 未释放）与负例（released / 有档）
await auditStore.putMember(memberRecord({ name: 'T-601-impl', role: 'implementer', mode: 'one-shot', layer: 1, status: 'completed', parent: '主代理' }))
await auditStore.putMember(memberRecord({ name: 'T-602-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'completed', parent: '主代理', latestDeliverable: '/x/T-602_a_L3.md' }))
await auditStore.putMember(memberRecord({ name: 'T-603-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'released', parent: '主代理', latestDeliverable: '/x/T-603_a_L3.md' }))
// cross_vendor：同模型（正例）与不同模型（负例）
await auditStore.putMember(memberRecord({ name: 'T-604-adversary', role: 'adversary', mode: 'continuable', layer: 1, status: 'running', model: 'same-model' }))
await auditStore.putMember(memberRecord({ name: 'T-604-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'running', model: 'same-model' }))
await auditStore.putMember(memberRecord({ name: 'T-605-adversary', role: 'adversary', mode: 'continuable', layer: 1, status: 'running', model: 'glm-4' }))
await auditStore.putMember(memberRecord({ name: 'T-605-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'running', model: 'deepseek-flash' }))
// orphan_task：已 released 但任务未结（正例）
await auditStore.putMember(memberRecord({ name: 'T-606-rev', role: 'reviewer', mode: 'continuable', layer: 1, status: 'released' }))
await auditStore.putTask(taskRecord({ taskId: 'T-606', status: 'running' }))
// 任务已结（负例）
await auditStore.putMember(memberRecord({ name: 'T-607-rev', role: 'reviewer', mode: 'continuable', layer: 1, status: 'released' }))
await auditStore.putTask(taskRecord({ taskId: 'T-607', status: 'done' }))
// unreleased_run 负例：released 的成员不算
// T-602/T-603 有档 → missing_doc 负例
await auditStore.putDoc(docRecord({ path: '/x/T-602_a_L3.md', tier: 3, taskId: 'T-602', title: 'a', chars: 280, keywords: ['正常'], updatedAt: freshStamp }))
await auditStore.putDoc(docRecord({ path: '/x/T-603_a_L3.md', tier: 3, taskId: 'T-603', title: 'a', chars: 280, keywords: ['正常'], updatedAt: freshStamp }))
// over_budget 正例：三级超长 + 一级 oversize
await auditStore.putDoc(docRecord({ path: '/x/T-608_long_L3.md', tier: 3, taskId: 'T-608', title: 'long', chars: 900, keywords: ['长'], updatedAt: freshStamp }))
await auditStore.putDoc(docRecord({ path: '/x/T-609_huge_L1.md', tier: 1, taskId: 'T-609', title: 'huge', chars: 9000, keywords: ['巨'], updatedAt: freshStamp }))
// doc_meta_missing：正例（缺小节）/ 负例（legacy 与 tier0 不参与）
await auditStore.putDoc(docRecord({ path: '/x/T-610_meta_L3.md', tier: 3, taskId: 'T-610', title: 'meta', keywords: ['元数据'], missingSections: ['依据', '下一步'], updatedAt: freshStamp }))
await auditStore.putDoc(docRecord({ path: '/x/旧档.md', tier: 0, taskId: null, title: '旧档', legacy: true, missingSections: ['依据'], updatedAt: freshStamp }))
await auditStore.putDoc(docRecord({ path: '/x/T-611_fix.md', tier: 0, taskId: 'T-611', title: 'fix', missingSections: ['依据'], updatedAt: freshStamp }))
// archive_suggest：正例（档龄 200 天 + 任务已结）/ 负例（新档）
await auditStore.putDoc(docRecord({ path: '/x/T-612_old_L3.md', tier: 3, taskId: 'T-612', title: 'old', keywords: ['旧'], updatedAt: oldStamp }))
await auditStore.putTask(taskRecord({ taskId: 'T-612', status: 'done' }))
// stale_progress：正例（超 400 字）/ 负例（短）
await writeFile(joinUnderRoot(auditProject.progressDir, 'T-601.md'), '甲'.repeat(500), 'utf8')
await writeFile(joinUnderRoot(auditProject.progressDir, 'T-602.md'), '短进度', 'utf8')
// doc_tags_stale：正文改过（mtime 现在）但头部 createdAt 是 1 小时前（正例）/ 刚写（负例）
const stalePath = joinUnderRoot(auditProject.deliverablesDir, 'T-613_stale_L3.md')
await writeFile(stalePath, renderFrontMatter({ taskId: 'T-613', role: 'researcher', tier: 3, keywords: ['过期'], relatedFiles: [], createdAt: new Date(Date.now() - 3600_000).toISOString() }) + '## 结论\n\n正文\n', 'utf8')
await auditStore.putDoc(docRecord({ path: stalePath, tier: 3, taskId: 'T-613', title: 'stale', keywords: ['过期'], updatedAt: freshStamp }))
const freshPath = joinUnderRoot(auditProject.deliverablesDir, 'T-614_fresh_L3.md')
await writeFile(freshPath, renderFrontMatter({ taskId: 'T-614', role: 'researcher', tier: 3, keywords: ['新'], relatedFiles: [], createdAt: freshStamp }) + '## 结论\n\n正文\n', 'utf8')
await auditStore.putDoc(docRecord({ path: freshPath, tier: 3, taskId: 'T-614', title: 'fresh', keywords: ['新'], updatedAt: freshStamp }))
// doc_misfiled：docs 根散档（正例）
await writeFile(joinUnderRoot(joinUnderRoot(auditProject.root, '仓库/docs'), '散档.md'), '# 散档\n', 'utf8')

const snapshotDir = async () => {
  const rows = []
  for (const dir of [auditProject.deliverablesDir, auditProject.progressDir, joinUnderRoot(auditProject.root, '仓库/docs')]) {
    for (const name of await listMarkdown(dir)) {
      const path = joinUnderRoot(dir, name)
      try { rows.push(`${path}:${(await readFile(path, 'utf8')).length}`) } catch { /* 忽略 */ }
    }
  }
  return rows.sort().join('|')
}
const before = await snapshotDir()
const reportOne = await auditScan({ store: auditStore, project: auditProject, config: auditCfg })
const after = await snapshotDir()
const auditHits = (check) => reportOne.items.filter((item) => item.check === check)
const hasTarget = (check, needle) => auditHits(check).some((item) => String(item.target).includes(needle))

// ① missing_doc：正（T-601 无档）/ 负（T-602 有档、T-603 有档）
console.log('DBG85 missing_doc:', JSON.stringify(reportOne.items.filter((i) => i.check === 'missing_doc').map((i) => i.target)))
console.log('DBG85 failed:', JSON.stringify(reportOne.failedChecks))
console.log('DBG85 members:', JSON.stringify(auditStore.listMembers().map((m) => m.name + '|' + m.role + '|' + m.status)))
assert.ok(hasTarget('missing_doc', 'T-601-impl'), 'M4-1 missing_doc 正例')
assert.equal(hasTarget('missing_doc', 'T-602-impl'), false, 'M4-1 missing_doc 负例：有档不报')
assert.equal(hasTarget('missing_doc', 'T-603-impl'), false, 'M4-1 missing_doc 负例：有档不报')
// ② over_budget：正（超长档）/ 负（chars 280 的两篇）
assert.ok(hasTarget('over_budget', 'T-608_long_L3.md'), 'M4-1 over_budget 正例：三级超长')
assert.ok(hasTarget('over_budget', 'T-609_huge_L1.md'), 'M4-1 over_budget 正例：一级 oversize')
assert.equal(hasTarget('over_budget', 'T-602_a_L3.md'), false, 'M4-1 over_budget 负例')
// ③ unfilled_slot：真实装配出来的契约不得残留槽位（负例）；正例走单元级
assert.equal(auditHits('unfilled_slot').length, 0, 'M4-1 unfilled_slot 负例：真实契约无残留槽位')
const contracts = await collectContracts({ store: auditStore, project: auditProject, config: auditCfg })
assert.ok(contracts.length > 0, 'M4-1：应能装配出契约用于审计')
const poisoned = [{ target: '假契约', text: '发给 `[上级]` 级 Agent，路径 [位置]', slotValues: [] }]
assert.deepEqual(toHost(CHECK_IMPLEMENTATIONS.unfilled_slot({ contracts: poisoned }).map((r) => r.target)), ['假契约'], 'M4-1 unfilled_slot 正例')
// 真实目录名不得误报：progressDir 名字就叫 [Agent进度]，把它传进 slotValues 后不该报
const realNamePoison = [{ target: '真目录名', text: `进度目录 ${auditProject.progressDir}`, slotValues: [auditProject.progressDir] }]
assert.deepEqual(toHost(CHECK_IMPLEMENTATIONS.unfilled_slot({ contracts: realNamePoison })), [], 'M4-1 unfilled_slot：[Agent进度] 这类真实目录名不得误报')
// ④ stale_progress：正（T-601 超 400 字）/ 负（T-602 短）
assert.ok(hasTarget('stale_progress', 'T-601.md'), 'M4-1 stale_progress 正例')
assert.equal(hasTarget('stale_progress', 'T-602.md'), false, 'M4-1 stale_progress 负例')
// ⑤ cross_vendor：正（同模型）/ 负（不同模型）
assert.ok(hasTarget('cross_vendor', 'T-604-adversary'), 'M4-1 cross_vendor 正例')
assert.equal(hasTarget('cross_vendor', 'T-605-adversary'), false, 'M4-1 cross_vendor 负例：异源不报')
// ⑥ ghost_run：正（T-601 one-shot 无产出）/ 负（T-602 非 one-shot；T-603 有产出）
assert.ok(hasTarget('ghost_run', 'T-601-impl'), 'M4-1 ghost_run 正例')
assert.equal(hasTarget('ghost_run', 'T-602-impl'), false, 'M4-1 ghost_run 负例：常驻不算')
// ⑦ orphan_task：正（T-606 released + 任务 running）/ 负（T-607 任务已结）
assert.ok(hasTarget('orphan_task', 'T-606-rev'), 'M4-1 orphan_task 正例')
assert.equal(hasTarget('orphan_task', 'T-607-rev'), false, 'M4-1 orphan_task 负例：任务已结')
// ⑧ unreleased_run：正（completed 但未 released）/ 负（released 的不报）
assert.ok(hasTarget('unreleased_run', 'T-601-impl'), 'M4-1 unreleased_run 正例')
assert.equal(hasTarget('unreleased_run', 'T-603-impl'), false, 'M4-1 unreleased_run 负例：已 released')
// ⑨ doc_misfiled：正（docs 根散档）
assert.ok(hasTarget('doc_misfiled', '散档.md'), 'M4-1 doc_misfiled 正例')
// ⑩ doc_meta_missing：正（缺小节）/ 负（legacy 与 tier0 不参与）
assert.ok(hasTarget('doc_meta_missing', 'T-610_meta_L3.md'), 'M4-1 doc_meta_missing 正例')
assert.equal(hasTarget('doc_meta_missing', '旧档.md'), false, 'M4-1 doc_meta_missing 负例：legacy 不参与')
assert.equal(hasTarget('doc_meta_missing', 'T-611_fix.md'), false, 'M4-1 doc_meta_missing 负例：tier0 不参与')
// ⑪ doc_tags_stale：正（正文 mtime 远晚于 createdAt）/ 负（刚写）
assert.ok(hasTarget('doc_tags_stale', 'T-613_stale_L3.md'), 'M4-1 doc_tags_stale 正例')
assert.equal(hasTarget('doc_tags_stale', 'T-614_fresh_L3.md'), false, 'M4-1 doc_tags_stale 负例：刚写的不报')
// ⑫ archive_suggest：正（200 天前 + 任务已结）/ 负（新档）
assert.ok(hasTarget('archive_suggest', 'T-612_old_L3.md'), 'M4-1 archive_suggest 正例')
assert.equal(hasTarget('archive_suggest', 'T-614_fresh_L3.md'), false, 'M4-1 archive_suggest 负例')

// 输出形状 + 警告制
assert.equal(reportOne.level, 'red', 'M4-1：有红项时 level 必须是 red')
assert.equal(reportOne.counts.red > 0 && reportOne.counts.yellow > 0, true, 'M4-1：红黄计数都要有')
assert.equal(reportOne.items.every((item) => CHECK_IDS.includes(item.check)), true, 'M4-1：item.check 必须是已知项')
assert.equal(reportOne.items.every((item) => item.target && item.detail), true, 'M4-1：每条都要有 target 与 detail')
assert.ok(reportOne.humanReport.includes('原因：') && reportOne.humanReport.includes('建议：'), 'M4-1：humanReport 必须含 原因 + 建议动作')
assert.ok(reportOne.humanReport.split('\n')[0].includes('审计'), 'M4-1：humanReport 首行是结论')
for (const id of CHECK_IDS) assert.ok(SUGGESTIONS[id], `M4-1：${id} 必须给建议动作`)
// 警告制：不抛错、不改文件
assert.equal(after, before, 'M4-1：审计不得改动任何文件（跑前后快照必须一致）')
await assert.doesNotReject(() => auditScan({ store: auditStore, project: auditProject, config: auditCfg }), 'M4-1：审计不得抛错阻断')
// 只查开关里开着的项
const onlyMissing = plugin.Config({ ...auditCfgInput, audit: { checks: ['missing_doc'], archiveAfterDays: 90 } })
const narrowedReport = await auditScan({ store: auditStore, project: auditProject, config: onlyMissing })
assert.equal(narrowedReport.items.every((item) => item.check === 'missing_doc'), true, 'M4-1：未开启的检查项不得执行')
await auditLedger.close()
await rm(auditRoot, { recursive: true, force: true })
ok('M4-1 audit_scan：12 项正反用例 / 警告制不改文件 / 未知项报错 / humanReport 含原因与建议')

// ---------------------------------------------------------------- FIX-32 stale_progress 的时间比较必须带容差
// 终检回归（exit=1，失败点 M4-1 stale_progress 负例）喵。定因链：
// ① 夹具里成员先建（`memberRecord` 默认 `lastActiveAt = new Date().toISOString()`，**毫秒级内存挂钟**）；
// ② 进度档后写，期望 `file.mtime > lastActiveAt` → 本不该报；
// ③ 但 `checkStaleProgress` 第 ② 条判据是**裸比较** `file.mtime < lastActiveAt`，无容差；
//    文件系统的 mtime 精度可能被**截断到秒**（FAT 2s / 网络盘 / drvfs 等），于是"刚写完的档"mtime 反而
//    早于内存挂钟几百毫秒 → **假报 stale**，端到端随机变红喵。
// ④ 同类判据 `doc_tags_stale` 早就带 `MTIME_TOLERANCE_MS`（2s）——所以这是**实现口径不一致的回归**，
//    **不是**断言过期，也不是夹具问题：下面一条断言都没放宽，另加双向断言把容差钉死喵。
const fix32Root = await mkdtemp(join(tmpdir(), 'ac-fix32-'))
const fix32Cfg = plugin.Config({
  project: { name: 'F32', root: fix32Root },
  paths: { tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent', docsDirs: ['仓库/docs/研究'] },
})
const fix32Project = resolveProject(fix32Cfg)
const fix32Store = await createLedger(makeCtx().ctx, projectKeyOf(fix32Cfg)).ready
const fix32Path = joinUnderRoot(fix32Project.progressDir, 'T-620.md')
await mkdir(fix32Project.progressDir, { recursive: true })
await writeFile(fix32Path, '短进度', 'utf8')
const fix32Mtime = (await stat(fix32Path)).mtimeMs
const fix32Hits = async (member) => {
  await fix32Store.putMember(memberRecord({
    id: `sess-${member.name}`, name: member.name, role: 'implementer', mode: 'continuable', layer: 1,
    status: member.status, lastActiveAt: member.lastActiveAt,
  }))
  const rows = await CHECK_IMPLEMENTATIONS.stale_progress({ store: fix32Store, project: fix32Project })
  return rows.filter((row) => String(row.target).endsWith('T-620.md'))
}
// ⓪ **复现位**（把终检那条最小化）喵：人为把 mtime **截断到整秒**（模拟 FAT 2s / 网络盘 / drvfs 的真实精度），
//    再让成员"最后活动"落在截断后 800ms 处 —— 旧实现（裸比 `file.mtime < lastActiveAt`）**必报**，
//    修好之后必须不报；这组数字刻意落在容差（2000ms）以内喵。
const fix32Truncated = Math.floor(fix32Mtime / 1000) * 1000
await utimes(fix32Path, new Date(fix32Truncated), new Date(fix32Truncated))
const fix32Repro = await fix32Hits({ name: 'T-620-impl', status: 'running', lastActiveAt: new Date(fix32Truncated + 800).toISOString() })
assert.equal(fix32Repro.length, 0, 'FIX-32：mtime 被截断到整秒（成员活动晚 800ms）→ 修复后不得误报')
assert.ok(800 < 2000, 'FIX-32：复现位刻意落在容差内 —— 旧实现的裸比在这里会报，所以这条能盯住回归')
// ① 容差内（成员"最后活动"只比档新 500ms —— 正是 mtime 被截断后的形态）→ **不得**报
assert.equal(
  (await fix32Hits({ name: 'T-620-impl', status: 'running', lastActiveAt: new Date(fix32Mtime + 500).toISOString() })).length, 0,
  'FIX-32：容差内的时钟/mtime 抖动不得误报 stale_progress',
)
// ② 真过期（成员最后活动比档新 60 秒）→ **必须**报（容差不是把判据废掉）
const fix32Stale = await fix32Hits({ name: 'T-620-impl', status: 'running', lastActiveAt: new Date(fix32Mtime + 60_000).toISOString() })
assert.equal(fix32Stale.length, 1, 'FIX-32：真过期仍要报（容差 ≠ 放水）')
assert.ok(String(fix32Stale[0].detail).includes('容差'), 'FIX-32：报出来了也要写明是"超出容差"，免得下次又误判成精度问题')
// ③ 回归位：M4-1 的负例断言**原样保留**（上面那行不动；这里再钉一次，防有人"因为难跑"把它删了）
assert.equal(hasTarget('stale_progress', 'T-602.md'), false, 'FIX-32：M4-1 stale_progress 负例必须仍然为 false')
// ④ 口径一致：两个同类时间判据必须共用同一个容差常量（一个带容差、一个裸比，就是这次回归的根因）
const fix32ChecksSrc = await readFile(new URL('./src/audit/checks.js', import.meta.url), 'utf8')
assert.ok(
  /file\.mtime \+ MTIME_TOLERANCE_MS < lastActive/.test(fix32ChecksSrc),
  'FIX-32：stale_progress 的时间比较必须带容差',
)
assert.ok(
  (fix32ChecksSrc.match(/MTIME_TOLERANCE_MS/g) || []).length >= 3,
  'FIX-32：容差常量必须被定义并被两处判据共用（doc_tags_stale + stale_progress）',
)
ok('FIX-32 stale_progress 时间比较带容差：容差内（mtime 被截断）不误报 / 真过期仍报 / M4-1 负例未放宽 / 两处同类判据共用同一常量')

// ---------------------------------------------------------------- M4 交付物 3：归档分片与馆员归档动作
const arcRoot = await mkdtemp(join(tmpdir(), 'ac-archive-'))
const arcCfg = plugin.Config({
  project: { name: 'Arc', root: arcRoot },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究'],
    archiveDir: '仓库/docs/archive',
    docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/子agent', 归档: '仓库/docs/archive' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const arcProject = resolveProject(arcCfg)
await mkdir(arcProject.deliverablesDir, { recursive: true })
await mkdir(joinUnderRoot(arcProject.root, '仓库/docs/研究'), { recursive: true })
const arcCtx = makeCtx()
const arcLedger = createLedger(arcCtx.ctx, projectKeyOf(arcCfg))
const arcStore = await arcLedger.ready
const oldIso = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
const arcStamp = Date.parse(oldIso)
const arcPaths = []
for (const taskId of ['T-701', 'T-702', 'T-703']) {
  const path = joinUnderRoot(arcProject.deliverablesDir, `${taskId}_旧档_L3.md`)
  await writeFile(path, renderFrontMatter({
    taskId, role: 'researcher', tier: 3, keywords: ['旧'], relatedFiles: [], createdAt: oldIso,
  }) + '## 结论\n\n旧档正文\n', 'utf8')
  await arcStore.putDoc(docRecord({ path, tier: 3, taskId, title: '旧档', keywords: ['旧'], updatedAt: oldIso }))
  await arcStore.putTask(taskRecord({ taskId, status: 'done' }))
  arcPaths.push(path)
}
// 一篇"引用档"：正文里提到第一篇的绝对路径，归档后必须被更新
const indexPath = joinUnderRoot(joinUnderRoot(arcProject.root, '仓库/docs/研究'), '索引.md')
await writeFile(indexPath, renderFrontMatter({
  taskId: 'T-700', role: 'librarian', tier: 3, keywords: ['索引'], relatedFiles: [], createdAt: oldIso,
}) + `## 结论\n\n详见 ${arcPaths[0]}\n`, 'utf8')
await arcStore.putDoc(docRecord({ path: indexPath, tier: 3, taskId: 'T-700', title: '索引', keywords: ['索引'], updatedAt: new Date().toISOString() }))

const arcReport = await auditScan({ store: arcStore, project: arcProject, config: arcCfg })
const suggestions = arcReport.items.filter((item) => item.check === 'archive_suggest')
assert.equal(suggestions.length, 3, `M4-3：三篇「已结任务 + 超阈值」的档都要被建议归档，实际 ${suggestions.length}`)
assert.ok(suggestions.every((item) => arcPaths.includes(item.target)), 'M4-3：建议必须指向那三篇')
assert.equal(arcReport.items.some((item) => item.check === 'archive_suggest' && item.target === indexPath), false, 'M4-3：引用档本身还年轻，不该被建议归档')

const moveResult = await archiveDocs({ project: arcProject, store: arcStore, paths: arcPaths })
const shard = shardOf(arcStamp)
assert.equal(moveResult.moved, 3, 'M4-3：三篇都该移走')
assert.equal(moveResult.failed.length, 0, `M4-3：不得有失败，实际 ${JSON.stringify(moveResult.failed)}`)
assert.ok(moveResult.refsUpdated >= 1, 'M4-3：至少要更新一处引用')
for (const path of arcPaths) {
  const moved = archiveTargetPath(arcProject, path, arcStamp)
  assert.equal(existsSync(moved), true, `M4-3：归档目标应存在 ${moved}`)
  assert.equal(existsSync(path), false, 'M4-3：原位置不得残留')
  assert.ok(moved.replace(/\\/g, '/').includes(`archive/${shard}/`), `M4-3：必须落在时间分片 archive/${shard}/ 下，实际 ${moved}`)
  const text = await readFile(moved, 'utf8')
  assert.ok(text.includes('librarianTouchedAt'), 'M4-3：归档必须留痕')
  assert.ok(text.includes('librarianChanges'), 'M4-3：归档必须写改动清单')
}
const indexText = await readFile(indexPath, 'utf8')
assert.equal(indexText.includes(arcPaths[0]), false, 'M4-3：旧路径引用必须被替换')
assert.ok(indexText.includes(archiveTargetPath(arcProject, arcPaths[0], arcStamp)), 'M4-3：引用应指向归档后的新路径')
assert.ok(indexText.includes('librarianTouchedAt'), 'M4-3：改引用同样要留痕')
// 台账跟着走
assert.equal(arcStore.getDoc(arcPaths[0]), undefined, 'M4-3：旧路径的台账记录应删除')
assert.ok(arcStore.getDoc(archiveTargetPath(arcProject, arcPaths[0], arcStamp)), 'M4-3：新路径应进台账')
// 归档后不再建议这 3 篇（幂等）
const afterReport = await auditScan({ store: arcStore, project: arcProject, config: arcCfg })
assert.equal(
  afterReport.items.filter((item) => item.check === 'archive_suggest' && arcPaths.includes(item.target)).length,
  0,
  'M4-3：已归档的档不得再被建议归档',
)
await arcLedger.close()
await rm(arcRoot, { recursive: true, force: true })
ok('M4-3 归档：时间分片 / 移动 + 留痕 + 更新引用 + 台账同步 / 幂等')

// ---------------------------------------------------------------- M4 交付物 2：馆员一轮治理
const libRoot = await mkdtemp(join(tmpdir(), 'ac-sweep-'))
const libCfg2 = plugin.Config({
  project: { name: 'Sweep', root: libRoot },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑'],
    archiveDir: '仓库/docs/archive',
    docKinds: { 研究: '仓库/docs/研究', 坑: '仓库/docs/坑', 产出档: '仓库/docs/子agent', 归档: '仓库/docs/archive' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const libProject = resolveProject(libCfg2)
await mkdir(libProject.deliverablesDir, { recursive: true })
await mkdir(libProject.docsDirs[0], { recursive: true })
await mkdir(libProject.docsDirs[1], { recursive: true })
const libCtx2 = makeCtx()
const libLedger2 = createLedger(libCtx2.ctx, projectKeyOf(libCfg2))
const libStore2 = await libLedger2.ready
const oldIso2 = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()

// ① 命名不规范：文件名乱七八糟，但台账能判出 taskId/title/tier → 应被改名
const messyPath = joinUnderRoot(libProject.deliverablesDir, '乱七八糟.md')
const messyBody = '## 结论\n\n这段正文一个字都不许动。\n'
await writeFile(messyPath, renderFrontMatter({ taskId: 'T-801', role: 'researcher', tier: 3, keywords: ['迁移'], relatedFiles: [], createdAt: oldIso2 }) + messyBody, 'utf8')
await libStore2.putDoc(docRecord({ path: messyPath, tier: 3, taskId: 'T-801', title: '迁移说明', keywords: ['迁移'], updatedAt: new Date().toISOString() }))
// ② 重复档：同任务号 + 同档级 + 同标题各两份（新的一份留下，旧的一份归档）
// ② 重复档：**同名同档级**（真重复）——一份在产出目录、一份是残留在研究目录的旧副本
// 注意（FIX-32 口径变更）：标题现在**按文件名重算**（syncDocTitles 先跑），所以"重复"必须
// 体现在**文件名**上（两份同名同档级的档），不能再靠"手工把台账 title 设成一样"来造重复喵。
const dupNew = joinUnderRoot(libProject.deliverablesDir, 'T-802_重复_L3.md')
const dupOld = joinUnderRoot(joinUnderRoot(libProject.root, '仓库/docs/研究'), 'T-802_重复_L3.md')
await writeFile(dupNew, renderFrontMatter({ taskId: 'T-802', role: 'researcher', tier: 3, keywords: ['重复'], relatedFiles: [], createdAt: oldIso2 }) + '## 结论\n\n新的那份\n', 'utf8')
await writeFile(dupOld, renderFrontMatter({ taskId: 'T-802', role: 'researcher', tier: 3, keywords: ['重复'], relatedFiles: [], createdAt: oldIso2 }) + '## 结论\n\n旧的那份\n', 'utf8')
await libStore2.putDoc(docRecord({ path: dupNew, tier: 3, taskId: 'T-802', title: '重复', keywords: ['重复'], updatedAt: new Date().toISOString() }))
await libStore2.putDoc(docRecord({ path: dupOld, tier: 3, taskId: 'T-802', title: '重复', keywords: ['重复'], updatedAt: oldIso2 }))
// ③ 缺元数据（缺固定小节）→ 只报，不在本轮修
const metaPath = joinUnderRoot(libProject.deliverablesDir, 'T-803_缺小节_L3.md')
await writeFile(metaPath, renderFrontMatter({ taskId: 'T-803', role: 'researcher', tier: 3, keywords: ['缺'], relatedFiles: [], createdAt: oldIso2 }) + '## 结论\n\n只有结论\n', 'utf8')
await libStore2.putDoc(docRecord({ path: metaPath, tier: 3, taskId: 'T-803', title: '缺小节', keywords: ['缺'], missingSections: ['依据', '下一步'], updatedAt: new Date().toISOString() }))
// ③.5 归档建议落地：名字规范、年久、任务已结 → 本轮应被移进 archive/<分片>/
const agePath = joinUnderRoot(libProject.deliverablesDir, 'T-805_年久_L3.md')
await writeFile(agePath, renderFrontMatter({ taskId: 'T-805', role: 'researcher', tier: 3, keywords: ['年久'], relatedFiles: [], createdAt: oldIso2 }) + '## 结论\n\n年久失修\n', 'utf8')
await libStore2.putDoc(docRecord({ path: agePath, tier: 3, taskId: 'T-805', title: '年久', keywords: ['年久'], updatedAt: oldIso2 }))
await libStore2.putTask(taskRecord({ taskId: 'T-805', status: 'done' }))
// ④ 缺档：成员已结束但没有任何档（审计报 missing_doc）
await libStore2.putMember(memberRecord({ name: 'T-804-impl', role: 'implementer', mode: 'one-shot', layer: 1, status: 'completed', parent: '主代理' }))

const sweep = await librarianSweep({ project: libProject, store: libStore2, config: libCfg2, stampIso: '2026-10-02T00:00:00.000Z' })
assert.ok(sweep.todos.includes('待办清单'), 'M4-2：必须产出待办清单')
assert.ok(sweep.todos.includes('missing_doc'), 'M4-2：待办清单要包含审计命中的检查项')
assert.ok(sweep.todos.includes('原因：'), 'M4-2：待办每条要给人话原因')
assert.ok(sweep.todos.includes('doc_meta_missing') || sweep.todos.includes('missing_doc'), 'M4-2：报告齐（缺元数据 / 缺档都要在里面）')

// 命名规范化：乱七八糟.md → T-801_迁移说明_L3.md
const renamedPath = joinUnderRoot(libProject.deliverablesDir, 'T-801_迁移说明_L3.md')
assert.equal(existsSync(renamedPath), true, 'M4-2：命名不规范应被改名为 <任务号>_<标题>_L<n>.md')
assert.equal(existsSync(messyPath), false, 'M4-2：旧名不得残留')
assert.equal(sweep.naming.moved, 1, 'M4-2：应改名 1 篇；实际 ' + JSON.stringify({ moved: sweep.naming.moved, files: sweep.naming.files, failed: sweep.naming.failed, candidates: sweep.naming.candidates, dedupe: sweep.dedupe }))
// 正文零改动（只动了头部留痕）
const renamedText = await readFile(renamedPath, 'utf8')
assert.ok(renamedText.includes(messyBody.trim()), 'M4-2：改名不得改动正文')
assert.ok(renamedText.includes('librarianTouchedAt'), 'M4-2：改名必须留痕')
// 台账跟着走
assert.equal(libStore2.getDoc(messyPath), undefined, 'M4-2：旧路径台账记录应删除')
assert.ok(libStore2.getDoc(renamedPath), 'M4-2：新路径应进台账')

// 去重：旧的那份被归档，新的那份留在原地
assert.equal(sweep.dedupe.duplicates >= 1, true, 'M4-2：应识别出重复档')
assert.equal(existsSync(dupNew), true, 'M4-2：重复档保留最新的那份')
assert.equal(existsSync(dupOld), false, 'M4-2：重复档的另一份应被移走（移动而非删除）')

// 归档建议落地：年久的档必须进 archive/<YYYY-MM>/
assert.equal(sweep.archive.moved, 1, 'M4-2：年久的档应被归档')
assert.equal(existsSync(agePath), false, 'M4-2：归档后原位置不得残留')
const archivedAge = sweep.archive.files[0].to
assert.ok(archivedAge.split('\\').join('/').includes('archive/'), `M4-2：必须落进 archive 目录，实际 ${archivedAge}`)
assert.ok((await readFile(archivedAge, 'utf8')).includes('librarianTouchedAt'), 'M4-2：归档必须留痕')

// 索引更新：派生态索引（独立文件）+ 真身 changelog（FIX-26 起两者分家）
const coreText2 = await readFile(sweep.core.path, 'utf8')
assert.ok(coreText2.includes('## 进度计数'), 'M4-2：派生态索引要有进度计数')
assert.ok(coreText2.includes('## 阻塞清单'), 'M4-2：派生态索引要有阻塞清单')
assert.ok(coreText2.includes('## 文档索引'), 'M4-2：派生态索引要有文档索引')
assert.ok(coreText2.includes('派生物') && coreText2.includes('可重建'), 'FIX-26：派生态索引头部必须自述「派生物·可重建」')
assert.equal(coreText2.includes('## 变更日志'), false, 'FIX-26：派生态索引不再掺 changelog —— 那份归真身')
assert.ok((await readFile(sweep.core.corePath, 'utf8')).includes('## 变更日志'), 'FIX-26：changelog 必须落在真身里')
assert.ok(sweep.core.members >= 1 && sweep.core.tasks >= 0 && sweep.core.docs >= 4, 'M4-2：索引计数要反映台账')
assert.equal(typeof sweep.pitfall.path, 'string', 'M4-2：坑库 README 索引要写出来')
assert.ok((await readFile(sweep.pitfall.path, 'utf8')).includes('坑库索引'), 'M4-2：坑库索引内容')

// 幂等：再跑一轮，治理动作应为 0
const sweepAgain = await librarianSweep({ project: libProject, store: libStore2, config: libCfg2, stampIso: '2026-10-02T01:00:00.000Z' })
assert.equal(sweepAgain.naming.moved, 0, 'M4-2：幂等——命名已规范，第二轮不该再改名')
assert.equal(sweepAgain.dedupe.duplicates, 0, 'M4-2：幂等——重复档已处理，第二轮不该再动')
assert.equal(sweepAgain.archive.moved, 0, 'M4-2：幂等——第二轮不该再归档同样的档')
// dryRun 不落盘
const drySweep = await librarianSweep({ project: libProject, store: libStore2, config: libCfg2, dryRun: true })
assert.equal(drySweep.dryRun, true)
assert.equal(drySweep.archive.moved, 0)
assert.equal(drySweep.naming.moved, 0)
// 术语表维护 + 缺口报告
const glossaryReport = await mergeGlossary({ project: libProject, entries: [{ term: '分裂炮台', synonyms: ['scatter'] }, { term: '迁移', synonyms: ['migration'] }] })
assert.equal(glossaryReport.terms, 2, 'M4-2：术语表应有 2 条')
assert.ok((await readFile(glossaryReport.path, 'utf8')).includes('- 分裂炮台 | scatter'), 'M4-2：术语表行格式')
const gaps = glossaryGaps({ store: libStore2, glossary: await loadGlossary(libProject), threshold: 1 })
assert.ok(Array.isArray(gaps) && gaps.length >= 1, 'M4-2：术语表缺口应报出未登记的高频关键词')
await libLedger2.close()
await rm(libRoot, { recursive: true, force: true })
ok('M4-2 馆员一轮治理：待办清单 / 改名 + 引用 + 留痕 / 去重归档 / 核心数据库与坑库索引 / 幂等 / dryRun')

// ---------------------------------------------------------------- M4 交付物 4：面板徽章接真审计
const snapRoot = await mkdtemp(join(tmpdir(), 'ac-panel-'))
const snapCfg = plugin.Config({
  project: { name: 'Panel', root: snapRoot },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究'],
    archiveDir: '仓库/docs/archive',
    docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/子agent', 归档: '仓库/docs/archive' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const snapProject = resolveProject(snapCfg)
await mkdir(snapProject.deliverablesDir, { recursive: true })
const snapCtx = makeCtx()
const snapLedger = createLedger(snapCtx.ctx, projectKeyOf(snapCfg))
const snapStore = await snapLedger.ready
// 一个成员，任务下**没有任何档** → 三档徽章应为 ✗
await snapStore.putMember(memberRecord({ id: 'sess-doc', name: 'T-901-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'completed', parent: '主代理' }))
await snapStore.putMember(memberRecord({ id: 'sess-adv', name: 'T-901-adversary', role: 'adversary', mode: 'continuable', layer: 1, status: 'running', model: 'same' }))
await snapStore.putMember(memberRecord({ id: 'sess-impl', name: 'T-901-impl2', role: 'implementer', mode: 'continuable', layer: 1, status: 'running', model: 'same' }))

const firstAudit = await auditScan({ store: snapStore, project: snapProject, config: snapCfg })
const firstWrite = await writePanelSnapshot({ store: snapStore, project: snapProject, audit: firstAudit, now: '2026-10-02T00:00:00.000Z' })
assert.equal(firstWrite.ok, true, 'M4-4：派生快照必须写得出来；实际 ' + JSON.stringify(firstWrite))
assert.equal(firstWrite.path, panelSnapshotPath(snapProject))
const snapshotJson = JSON.parse(await readFile(firstWrite.path, 'utf8'))
assert.equal(snapshotJson.schemaVersion, PANEL_SNAPSHOT_SCHEMA_VERSION, 'M4-4：快照必须带 schemaVersion')
assert.equal(snapshotJson.generatedAt, '2026-10-02T00:00:00.000Z', 'M4-4：快照必须带 generatedAt')
assert.equal(snapshotJson.members['T-901-impl'].badges.docs, 'missing', 'M4-4：缺三档 → 徽章 missing（面板渲染 ✗）')
assert.equal(snapshotJson.members['T-901-adversary'].badges.crossVendor, 'missing', 'M4-4：与同任务 implementer 同模型 → 非真异源 ✗')
assert.equal(snapshotJson.members['T-901-impl'].badges.contract, 'ok', 'M4-4：契约徽章 ✓')
assert.equal(snapshotJson.audit.red >= 1, true, 'M4-4：审计摘要要带红计数')
// 快照落在工作区内（client 的 workspaceFiles 才够得着），且是派生物
assert.ok(firstWrite.path.replace(/\\/g, '/').includes('/.agent-contract/panel.json'), `M4-4：落点必须在项目根的 .agent-contract/ 下，实际 ${firstWrite.path}`)

// client 侧：把快照贴回节点（纯函数，不需要真网络）
const panelItems = [
  { sessionId: 'root-1', running: true, agentAvailable: true, updatedAt: 1, cwd: snapProject.root },
  { sessionId: 'sess-doc', parentSessionId: 'root-1', origin: 'subagent', running: true, agentAvailable: true, updatedAt: 2, cwd: snapProject.root },
]
const panelInfos = { 'sess-doc': { label: 'T-901-impl', mode: 'continuable', model: 'same' } }
const merged = view.snapshotFromSessions(panelItems, panelInfos, 'root-1', snapshotJson)
const docNode = merged.roots[0].children[0]
assert.equal(docNode.badges.docs, 'missing', 'M4-4：client 侧徽章要取到真审计结论')
assert.equal(docNode.hasAudit, true, 'M4-4：拿到快照后不再标记 pending')
assert.equal(view.badgeRow(docNode).find((item) => item.key === '三档').pending, false, 'M4-4：快照到手后不再标 pending')
assert.equal(merged.notes.length, 0, 'M4-4：数据源接通后不该再报"待接"')
assert.equal(merged.source, 'remote.session + panel.json', 'M4-4：数据源要标注清楚')
// schemaVersion 不认识 → 降级 unknown，绝不猜字段
const staleVersion = { ...snapshotJson, schemaVersion: 999 }
const degraded = view.snapshotFromSessions(panelItems, panelInfos, 'root-1', staleVersion)
assert.equal(degraded.roots[0].children[0].badges.docs, 'unknown', 'M4-4：版本不认识必须降级 unknown')
assert.equal(degraded.notes.length, 1, 'M4-4：降级时要标注数据源待接')
assert.equal(view.badgeRow(degraded.roots[0].children[0]).find((item) => item.key === '三档').pending, true)
// 无快照（文件不存在 / 读不到）同样降级
assert.equal(view.snapshotFromSessions(panelItems, panelInfos, 'root-1', null).roots[0].children[0].badges.docs, 'unknown')
// 「复原」：补齐三档后徽章复原
for (const tier of [1, 2, 3]) {
  await snapStore.putDoc(docRecord({ path: `/x/T-901_a_L${tier}.md`, tier, taskId: 'T-901', title: 'a', keywords: ['a'], updatedAt: new Date().toISOString() }))
}
const restored = await writePanelSnapshot({ store: snapStore, project: snapProject, audit: await auditScan({ store: snapStore, project: snapProject, config: snapCfg }) })
const restoredJson = JSON.parse(await readFile(restored.path, 'utf8'))
assert.equal(restoredJson.members['T-901-impl'].badges.docs, 'ok', 'M4-4：补齐三档后徽章必须复原')
const restoredMerged = view.snapshotFromSessions(panelItems, panelInfos, 'root-1', restoredJson)
assert.equal(restoredMerged.roots[0].children[0].badges.docs, 'ok', 'M4-4：client 侧同样复原')
// joinRoot：路径分隔符跟随根的风格
assert.equal(view.joinRoot('D:\\Blockdustry', view.PANEL_SNAPSHOT_REL), 'D:\\Blockdustry\\.agent-contract\\panel.json', 'M4-4：Windows 根不得出现混合分隔符')
assert.equal(view.joinRoot('/mnt/d/Blockdustry', view.PANEL_SNAPSHOT_REL), '/mnt/d/Blockdustry/.agent-contract/panel.json')
await snapLedger.close()
await rm(snapRoot, { recursive: true, force: true })
ok('M4-4 面板接真审计：派生快照 schemaVersion+generatedAt / 按成员贴徽章 / 缺三档 ✗ 与复原 / 版本不认识降级 unknown')

// ---------------------------------------------------------------- FIX-13【critical】工具白名单 fail-open + 平台解析
// ① 终端工具名按平台**解析成单个**正确名字（不靠剔除）
const fix13WinRole = listRoles(plugin.Config({}), 'win32').find((role) => role.id === 'implementer')
assert.ok(fix13WinRole.tools.includes('pwsh'), 'FIX-13：win32 的终端工具必须解析成 pwsh')
assert.equal(fix13WinRole.tools.includes('bash'), false, 'FIX-13：win32 上不得再留着 bash（宿主已 disabled）')
const fix13NixRole = listRoles(plugin.Config({}), 'linux').find((role) => role.id === 'implementer')
assert.ok(fix13NixRole.tools.includes('bash'), 'FIX-13：非 win32 必须解析成 bash')
assert.equal(fix13NixRole.tools.includes('pwsh'), false, 'FIX-13：非 win32 上不得留着 pwsh')
assert.deepEqual(
  toHost(listRoles(plugin.Config({}), 'win32').find((r) => r.id === 'implementer').tools.filter((n) => n === 'bash' || n === 'pwsh')),
  ['pwsh'],
  'FIX-13：解析后终端名只能有一个',
)

// ② 回归位：**空 / 不完整目录下不得剔除任何声明名**（fail-open）
const fix13Declared = toHost(fix13NixRole.tools)
assert.deepEqual(toHost(resolveToolFilter({ tools: fix13Declared }, undefined).allow), fix13Declared, 'FIX-13：没有目录 → 原样下发')
assert.deepEqual(toHost(resolveToolFilter({ tools: fix13Declared }, new Set()).allow), fix13Declared, 'FIX-13：空目录 → 原样下发')
// 不完整目录 = 只有本插件注册面（这正是真机 schemas() 的视野）
const fix13Incomplete = resolveToolFilter({ tools: fix13Declared }, new Set(PLUGIN_SCOPE_ONLY_TOOLS))
assert.deepEqual(
  toHost(fix13Incomplete.allow),
  fix13Declared,
  'FIX-13：**不完整目录下不得剔除任何声明名**（本次事故的直接回归位——剔了 read/write/pwsh 会让子智能体"能派活、不能干活"）',
)
assert.deepEqual(
  toHost(fix13Incomplete.missing).sort(),
  fix13Declared.filter((name) => !PLUGIN_SCOPE_ONLY_TOOLS.includes(name)).sort(),
  'FIX-13：只允许**报告**缺失，绝不动 allow',
)
assert.ok(toHost(fix13Incomplete.allow).includes('read') && toHost(fix13Incomplete.allow).includes('write'), 'FIX-13：宿主内建工具必须留在 allow 里')

// ③ 端到端：空目录下派活，allow === 声明名（经平台解析），且不再出现"已剔除"
const fix13Ctx = makeCtx()
fix13Ctx.ctx.tools.schemas = () => [] // 空目录（最坏情况）
plugin.apply(fix13Ctx.ctx, cfg)
const fix13Out = await toolOf('contract_delegate_implementer').execute({ taskId: 'T-001' }, { agent, signal })
assert.equal(fix13Out.kind, 'continuable', 'FIX-13：空目录下通道必须能启动')
const fix13Allow = toHost(fix13Ctx.calls.continuable[0].request.toolFilter.allow).sort()
const fix13Expected = toHost(listRoles(cfg).find((role) => role.id === 'implementer').tools).sort()
assert.deepEqual(fix13Allow, fix13Expected, 'FIX-13：allow 必须等于声明名（经平台解析），一个都不许少')
assert.equal(
  fix13Out.warnings.some((text) => text.includes('已剔除')),
  false,
  `FIX-13：不得再出现"已剔除"这类静默降级，实际 ${JSON.stringify(fix13Out.warnings)}`,
)
// ④ 回执必须渲染 warnings（§9-23）
const fix13Tool = toolOf('contract_delegate_implementer')
const fix13Rendered = fix13Tool.output.render({}, { ...fix13Out, warnings: ['示例警告 A', '示例警告 B'] })[0].text
assert.ok(fix13Rendered.includes('警告：'), 'FIX-13：回执必须渲染 warnings 段')
assert.ok(fix13Rendered.includes('示例警告 A') && fix13Rendered.includes('示例警告 B'), 'FIX-13：每条 warning 都要在回执里可见')
assert.equal(
  fix13Tool.output.render({}, { ...fix13Out, warnings: [] })[0].text.includes('警告：'),
  false,
  'FIX-13：没有 warning 时不额外输出',
)
// ⑤ 不得再把 ctx.tools.schemas() 当宿主目录（源码级证据：resolveToolFilter 不再接受 ctx）
assert.equal(resolveToolFilter.length, 2, 'FIX-13：resolveToolFilter(role, authoritativeDirectory) 签名里不再有 ctx')
// ⑥ 已知**未挂载**的名字不得再进白名单（fail-open 下它会直接硬失败）
for (const role of listRoles(plugin.Config({}))) {
  assert.equal(
    role.tools.includes('session_search'),
    false,
    `FIX-13：${role.id} 不得声明 session_search —— 本机没有任何 bundle 挂载它（只有 session-query-sqlite 服务）`,
  )
}
ok('FIX-13 工具白名单 fail-open：平台解析成单个终端名 / 空与不完整目录都不剔除 / 只报缺失不动 allow / 回执渲染 warnings')

// ---------------------------------------------------------------- FIX-7 面板 mode 只用权威来源
// ① settled continuable（agentAvailable=false + completed）必须**默认可见**（本次事故的直接回归位）
const fix7Items = [
  { sessionId: 'r1', running: true, agentAvailable: true, updatedAt: 1 },
  { sessionId: 'c1', parentSessionId: 'r1', origin: 'subagent', running: false, agentAvailable: false, updatedAt: 2 },
  { sessionId: 'c2', parentSessionId: 'r1', origin: 'subagent', running: false, agentAvailable: false, updatedAt: 3 },
]
const fix7Infos = {
  c1: { label: 'T-1-reviewer', mode: 'continuable', model: 'm' },
  c2: { label: 'T-1-researcher', mode: 'one-shot', model: 'm' },
}
const fix7Snap = view.snapshotFromSessions(fix7Items, fix7Infos, 'r1', null)
const settledContinuable = fix7Snap.roots[0].children[0]
assert.equal(settledContinuable.mode, 'continuable', 'FIX-7：mode 来自投影（可继续）')
assert.equal(settledContinuable.status, 'completed', 'FIX-7：status 仍是 completed')
assert.equal(view.isHidden(settledContinuable, view.defaultPrefs()), false, 'FIX-7：已结算的后台成员默认必须可见')
const fix7Visible = toHost(view.flattenTree(view.filterTree(fix7Snap.roots, view.defaultPrefs())).map((row) => row.node.sessionId))
assert.ok(fix7Visible.includes('c1'), 'FIX-7：已结算的后台成员不得被默认过滤吃掉')
// ② one-shot + completed → 默认隐藏；关掉开关（或点「显示全部」）后可见
assert.equal(view.isHidden(fix7Snap.roots[0].children[1], view.defaultPrefs()), true, 'FIX-7：one-shot+completed 默认隐藏')
assert.equal(view.isHidden(fix7Snap.roots[0].children[1], { hideDoneOneShot: false }), false, 'FIX-7：关掉开关后必须可见')
// ③ 投影缺失 → mode=unknown 且默认可见（禁止用 agentAvailable 近似）
const fix7Bare = view.snapshotFromSessions(fix7Items, {}, 'r1', null)
assert.equal(fix7Bare.roots[0].children[0].mode, 'unknown', 'FIX-7：投影缺失必须保留 unknown，不得猜')
assert.equal(view.isHidden(fix7Bare.roots[0].children[0], view.defaultPrefs()), false, 'FIX-7：unknown 默认可见')
assert.notEqual(
  view.deriveMode({ origin: 'subagent', agentAvailable: false }, null), 'one-shot',
  'FIX-7：禁止再用 agentAvailable 近似 mode（已结算的后台成员会被误判成一次性）',
)
assert.equal(view.deriveMode({ origin: 'subagent', agentAvailable: false }, { mode: 'continuable' }), 'continuable', 'FIX-7：有投影就用投影')
// 权威来源：父会话的 subagentCatalog 合并给子会话
const fix7Merged = view.mergeInfos(fix7Items, {
  r1: { label: null, mode: null, model: null, children: { c1: { mode: 'continuable', label: 'T-1-lead-reviewer' } } },
})
assert.equal(fix7Merged.c1.mode, 'continuable', 'FIX-7：mode 必须能从 subagentCatalog 取到（与宿主 UI 同源）')
assert.equal(fix7Merged.c1.label, 'T-1-lead-reviewer', 'FIX-7：label 也从 catalog 取')
assert.equal(fix7Merged.c2.mode, null, 'FIX-7：catalog 里没有的节点保持空（由 deriveMode 退化为 unknown）')
// ④ 空态必须给「显示全部」自救入口（不依赖 prefs 读回链路）
assert.equal(view.EMPTY_STATES.showAll, '显示全部', 'FIX-7：过滤空态必须有「显示全部」按钮文案')
assert.equal(view.EMPTY_STATES.restoreDefault, '恢复默认过滤', 'FIX-7：显示全部后要能恢复默认过滤')
assert.ok(clientSource.includes("'data-testid': 'agent-contract-show-all'"), 'FIX-7：空态的「显示全部」按钮必须在渲染里存在')
ok('FIX-7 面板 mode：settled continuable 默认可见 / one-shot 默认隐藏 / 投影缺失 unknown 且可见 / subagentCatalog 同源 / 显示全部自救')

// ---------------------------------------------------------------- FIX-11 运行版本可核对
const pkgVersion = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).version
const statusWithVersion = await toolOf('contract_status').execute({}, {})
assert.equal(statusWithVersion.plugin.version, pkgVersion, 'FIX-11：contract_status 的 pluginVersion 必须等于 package.json 的 version')
assert.notEqual(statusWithVersion.plugin.version, '(unknown)', 'FIX-11：pluginVersion 读不到就是版本漂移核验失效')
const registeredNames = [...new Set(registered.map((tool) => tool.name))]
assert.deepEqual(
  toHost(statusWithVersion.plugin.tools).sort(),
  registeredNames.sort(),
  'FIX-11：contract_status 打印的工具清单必须等于本插件实际注册的工具',
)
assert.ok(statusWithVersion.plugin.tools.includes('audit_scan'), 'FIX-11：清单里必须能看到 audit_scan（审查时旧版缺它，正是漂移证据）')
assert.equal(statusWithVersion.plugin.tools.length, 1 + PROJECT_TOOL_NAMES.length + BUILTIN_ROLES.length + M2_TOOL_NAMES.length, 'FIX-11：工具总数（FIX-58 起含 project_init）')
const statusText2 = toolOf('contract_status').output.render({}, statusWithVersion)[0].text
assert.ok(statusText2.includes('插件版本:'), 'FIX-11：渲染文本必须打印插件版本')
assert.ok(statusText2.includes('已注册工具（'), 'FIX-11：渲染文本必须打印工具清单')
ok('FIX-11 版本可核对：contract_status 打印 pluginVersion + 已注册工具清单（与 tools.js 一致）')

// ---------------------------------------------------------------- FIX-15 client 必须显式注入 remote 服务名
// ① inject 数组必须含 remote.session 与 remote.workspaceFiles（否则 ctx.remote 为 undefined）
assert.ok(toHost(clientModule.inject).includes('remote'), 'FIX-15：inject 必须含服务名 remote')
assert.ok(toHost(clientModule.inject).includes('remote.session'), 'FIX-15：inject 必须含 remote.session（血缘数据源）')
assert.ok(toHost(clientModule.inject).includes('remote.workspaceFiles'), 'FIX-15：inject 必须含 remote.workspaceFiles（读派生快照）')
// ② ctx.remote 缺失 → failed（附原因含 remote），绝不伪装成「数据源为空」
const fix13NoRemote = await view.loadPanel({}, { sessionId: 's1' })
assert.equal(fix13NoRemote.failed, true, 'FIX-15：ctx.remote 缺失必须报 failed')
assert.ok(String(fix13NoRemote.reason).includes('remote'), `FIX-15：原因文案必须含 remote，实际 ${fix13NoRemote.reason}`)
const fix13FailedState = view.panelViewState({ failure: fix13NoRemote.reason, snapshot: null, prefs: view.defaultPrefs() })
assert.equal(fix13FailedState.kind, 'failed', 'FIX-15：ctx.remote 缺失 → 走到 failed 空态')
assert.ok(fix13FailedState.reason.includes('remote'), 'FIX-15：failed 空态要带上 remote 原因')
assert.ok(view.EMPTY_STATES.failed.includes('加载失败'), 'FIX-15：failed 文案必须说「加载失败」')
// remote 有、remote.session 没有 → 同样 failed，且原因指名到 remote.session
const fix13NoSession = await view.loadPanel({ remote: {} }, { sessionId: 's1' })
assert.equal(fix13NoSession.failed, true, 'FIX-15：remote.session 缺失必须报 failed')
assert.ok(String(fix13NoSession.reason).includes('remote.session'), 'FIX-15：原因要指名 remote.session')
// ③ remote 返回 { items: [] } → sourceEmpty（不是 failed），两条文案必须不同
const fix13Empty = await view.loadPanel({ remote: { session: { list: async () => ({ items: [] }) } } }, { sessionId: 's1' })
assert.equal(fix13Empty.failed, undefined, 'FIX-15：空列表是「数据源为空」，不是「取数失败」')
assert.equal(fix13Empty.members.length, 0, 'FIX-15：空列表 → 0 成员')
assert.equal(view.panelViewState({ snapshot: fix13Empty, prefs: view.defaultPrefs() }).kind, 'emptySource', 'FIX-15：空列表走 sourceEmpty 空态')
assert.notEqual(view.EMPTY_STATES.failed, view.EMPTY_STATES.sourceEmpty, 'FIX-15：failed 与 sourceEmpty 两条文案必须不同（曾经混在一起把排查带偏一轮）')
assert.ok(view.EMPTY_STATES.sourceEmpty.includes('数据源为空'), 'FIX-15：sourceEmpty 文案')
// 四种视图状态互斥可辨
assert.deepEqual(
  ['loading', 'failed', 'emptySource', 'filteredOut'].map((kind) => view.panelViewState({
    loading: kind === 'loading',
    failure: kind === 'failed' ? 'x' : null,
    snapshot: kind === 'failed' ? null : (kind === 'emptySource' ? { members: [], roots: [] } : { members: [{ sessionId: 'a' }], roots: [{ mode: 'one-shot', status: 'completed', children: [] }] }),
    prefs: view.defaultPrefs(),
  }).kind),
  ['loading', 'failed', 'emptySource', 'filteredOut'],
  'FIX-15：四种空态必须一一对应',
)
// 源码级证据：组件必须按 panelViewState 分支渲染
assert.ok(clientSource.includes('panelViewState('), 'FIX-15：组件必须用 panelViewState 做分支')
assert.ok(clientSource.includes('EMPTY_STATES.failed'), 'FIX-15：failed 分支必须渲染 failed 文案')
ok('FIX-15 client 注入 remote 服务名：inject 齐 remote.session/workspaceFiles / remote 缺失走 failed 不伪装 / 空列表走 sourceEmpty')

// ---------------------------------------------------------------- FIX-14 快照「没读」≠「对方没写」
// ① 没读到项目根 → 文案说「未能定位项目根」，**不含**「对方未写出」（后者会把锅甩给 host）
assert.ok(view.SNAPSHOT_NOTE_NO_ROOT.includes('未能定位项目根'), 'FIX-14：没读到根必须直说「未能定位项目根」')
assert.equal(view.SNAPSHOT_NOTE_NO_ROOT.includes('对方未写出'), false, 'FIX-14：不得再把锅甩给 host（"对方未写出"）')
assert.equal(view.SNAPSHOT_NOTE_NO_ROOT.includes('未尝试读取'), true, 'FIX-14：要写明「未尝试读取」')
// ② 候选路径为空 → 根本没读（不是"文件不存在"）
const fix14NoCandidates = await view.loadPanelSnapshot(
  { remote: { workspaceFiles: { read: async () => ({ text: null }) } } }, { sessionId: 's' }, [],
)
assert.equal(fix14NoCandidates.panel, null)
assert.ok(fix14NoCandidates.notes[0].includes('未能定位项目根'), 'FIX-14：无候选路径 → 未尝试读取')
assert.equal(fix14NoCandidates.notes[0].includes('已尝试读取'), false, 'FIX-14：没读就不许说"已尝试读取"')
// ③ 有候选但读不到 → 「已尝试读取但文件不存在」（两类文案互斥且不同）
const fix14Missing = await view.loadPanelSnapshot(
  { remote: { workspaceFiles: { read: async () => { throw new Error('not found') } } } }, { sessionId: 's' },
  ['D:\\proj\\.agent-contract\\panel.json'],
)
assert.equal(fix14Missing.panel, null)
assert.ok(fix14Missing.notes[0].includes('已尝试读取但文件不存在'), 'FIX-14：读了没有要说"已尝试读取"')
assert.equal(fix14Missing.notes[0].includes('未能定位项目根'), false, 'FIX-14：两类文案必须互斥')
assert.notEqual(view.SNAPSHOT_NOTE_NO_ROOT, view.SNAPSHOT_NOTE_MISSING(['x']), 'FIX-14：两条文案必须不同')
// ④ 回退：根会话没有 cwd 时，用**当前会话自身的 cwd** 仍能读到快照
const fix14FallbackCtx = {
  remote: {
    session: {
      list: async () => ({
        items: [
          { sessionId: 'root', running: true, agentAvailable: true, updatedAt: 1 },
          { sessionId: 'child', parentSessionId: 'root', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 2 },
        ],
      }),
    },
    workspaceFiles: {
      read: async (_scope, path) => ({
        text: String(path).includes('proj')
          ? JSON.stringify({ schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: 't', pluginVersion: view.CLIENT_PLUGIN_VERSION, todos: [], paths: { todoFile: null }, membersById: {}, project: { name: 'P', root: 'D:\\proj' }, audit: { level: 'green', red: 0, yellow: 0 }, counts: { members: 1 }, members: {} })
          : '',
      }),
    },
  },
}
const fix14Panel = await view.loadPanel(fix14FallbackCtx, { sessionId: 'child' })
assert.equal(fix14Panel.failed, undefined, 'FIX-14：回退路径不该报失败')
assert.equal(fix14Panel.source, 'remote.session + panel.json', 'FIX-14：根会话没有 cwd 时必须回退用 scope 自身的 cwd 读快照')
assert.equal(fix14Panel.notes.length, 0, 'FIX-14：读到快照后不该再报"数据源待接"')
ok('FIX-14 快照诊断：未能定位项目根 ≠ 对方未写出 / 未尝试读取与已尝试读取互斥 / 回退 scope 自身 cwd')

// ---------------------------------------------------------------- FIX-16【critical】remote 只能在「注入后」的 ctx 上访问
// ① props.ctx 是渲染期子上下文（不带本模块 inject）；用注入后的 ctx 必须仍能读到快照
const fix16PropsLikeCtx = {
  remote: { session: { list: async () => ({ items: [{ sessionId: 'r1', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 1 }] }) } },
}
const fix16InjectedCtx = {
  remote: {
    session: fix16PropsLikeCtx.remote.session,
    workspaceFiles: {
      read: async () => ({
        text: JSON.stringify({
          schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: 't', pluginVersion: view.CLIENT_PLUGIN_VERSION, todos: [], paths: { todoFile: null }, membersById: {}, project: { name: 'P', root: 'D:\\proj' },
          audit: { level: 'green', red: 0, yellow: 0 }, counts: { members: 1 }, members: {},
        }),
      }),
    },
  },
}
const fix16WithInjected = await view.loadPanel(fix16InjectedCtx, { sessionId: 'r1' })
assert.equal(fix16WithInjected.failed, undefined, 'FIX-16：用注入后的 ctx 必须能正常加载（不得 failed）')
assert.equal(fix16WithInjected.source, 'remote.session + panel.json', 'FIX-16：注入 ctx 上必须能真读到派生快照')
assert.equal(fix16WithInjected.notes.length, 0, 'FIX-16：读到快照后不该有降级提示')
// 同一份血缘、但 ctx 上没有 workspaceFiles（模拟 props.ctx）→ 只降级快照那一步，且点名步骤
const fix16WithPropsLike = await view.loadPanel(fix16PropsLikeCtx, { sessionId: 'r1' })
assert.equal(fix16WithPropsLike.failed, undefined, 'FIX-16：快照读不到不整轮 failed（血缘已成功）')
assert.ok(
  fix16WithPropsLike.notes.some((text) => text.includes(view.SNAPSHOT_STEP)),
  `FIX-16：快照那一步失败必须点名，实际 ${JSON.stringify(fix16WithPropsLike.notes)}`,
)
// 源码级回归：组件不得再用 props.ctx 加载数据
assert.equal(/loadPanel\(props\.ctx/.test(clientSource), false, 'FIX-16：不得再用 props.ctx 访问 remote')
assert.ok(clientSource.includes('remoteCtx: injectedCtx'), 'FIX-16：必须把 apply(ctx) 的注入 ctx 传成 remoteCtx')
assert.ok(clientSource.includes('loadPanel(props.remoteCtx, props.scope)'), 'FIX-16：数据加载必须用注入后的 ctx')
assert.equal(/loadPanel\(props\.remoteCtx/.test(clientSource), true, 'FIX-16：数据加载入口只认 remoteCtx')
// ② 分步归因：血缘失败与快照失败文案不同，且各自指名步骤
const fix16LineageFail = await view.loadPanel(
  { remote: { session: { list: async () => { throw new Error('boom-lineage') } } } }, { sessionId: 's' },
)
assert.equal(fix16LineageFail.failed, true, 'FIX-16：血缘读不到必须整轮 failed')
assert.ok(fix16LineageFail.reason.includes('读取会话血缘失败'), 'FIX-16：血缘失败必须指名这一步')
assert.ok(fix16LineageFail.reason.includes('boom-lineage'), 'FIX-16：要带上原始错误信息')
assert.ok(String(view.SNAPSHOT_NOTE_MISSING(['p'])).includes(view.SNAPSHOT_STEP), 'FIX-16：快照失败必须指名这一步')
assert.ok(view.SNAPSHOT_NOTE_NO_ROOT.includes(view.SNAPSHOT_STEP), 'FIX-16：未定位项目根同属「快照」步骤')
assert.equal(fix16LineageFail.reason.includes(view.SNAPSHOT_STEP), false, 'FIX-16：血缘失败不得被写成快照失败')
assert.notEqual(fix16LineageFail.reason, view.SNAPSHOT_NOTE_MISSING(['p']), 'FIX-16：两类文案必须不同（不许共用一句 catch）')
// ③ inject 回归：三个 remote 名一个都不能少
for (const name of ['remote', 'remote.session', 'remote.workspaceFiles']) {
  assert.ok(toHost(clientModule.inject).includes(name), `FIX-16：inject 仍必须含 ${name}`)
}
ok('FIX-16 remote 只在注入 ctx 上访问：props.ctx 不带 inject / 数据加载走 remoteCtx / 血缘与快照分步归因 / inject 回归')

// ---------------------------------------------------------------- FIX-17【critical】remote 返回信封 { ok, value }，必须解包
// 权威依据：`RemoteResult<T> = { ok:true, value } | { ok:false, error }`（packages/typert/protocol/src/types.ts:76），
// 官方用法同样是先判 ok 再取 value（session-controller/src/client/sessions/manager.ts:403）
assert.deepEqual(toHost(view.unwrapRemote({ ok: true, value: { items: [1] } })), { ok: true, value: { items: [1] } }, 'FIX-17：成功信封要解出 value')
assert.equal(view.unwrapRemote({ ok: false, error: { code: 'gateway/internal' } }).ok, false, 'FIX-17：失败信封要解出 error')
assert.deepEqual(toHost(view.unwrapRemote({ items: [] })), { ok: true, value: { items: [] } }, 'FIX-17：裸值也兼容（别因宿主改封装就脆掉）')
// ① 成功信封 → 必须真解出 items（本次事故的直接回归位：读 result.items 会得到 undefined → 成员 0）
const fix17Ctx = {
  remote: {
    session: {
      list: async () => ({
        ok: true,
        value: {
          items: [
            { sessionId: 'e1', running: true, agentAvailable: true, updatedAt: 1 },
            { sessionId: 'e2', parentSessionId: 'e1', origin: 'subagent', running: false, agentAvailable: false, updatedAt: 2 },
          ],
        },
      }),
    },
  },
}
const fix17Out = await view.loadPanel(fix17Ctx, { sessionId: 'e1' })
assert.equal(fix17Out.failed, undefined, 'FIX-17：成功信封不得报 failed')
assert.equal(fix17Out.members.length, 2, 'FIX-17：成功信封必须解出 items（直接读 result.items 会得到 undefined → 面板「成员 0」）')
assert.equal(fix17Out.roots.length, 1, 'FIX-17：解包后必须能建出树')
// ② 失败信封 → 归因到「读取会话血缘失败」，并带出 code / message
const fix17Fail = await view.loadPanel({
  remote: { session: { list: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }) } },
}, { sessionId: 's' })
assert.equal(fix17Fail.failed, true, 'FIX-17：失败信封必须报 failed')
assert.ok(fix17Fail.reason.includes('读取会话血缘失败'), 'FIX-17：失败信封要归因到血缘步骤')
assert.ok(fix17Fail.reason.includes('gateway/internal'), 'FIX-17：要带出 remote 的 error code')
assert.ok(fix17Fail.reason.includes('boom'), 'FIX-17：要带出 remote 的 error message')
// ③ 快照 remote 同样要解包（读 result.text 会得到 undefined）
const fix17SnapCtx = {
  remote: {
    session: { list: async () => ({ ok: true, value: { items: [{ sessionId: 'r1', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 1 }] } }) },
    workspaceFiles: {
      read: async () => ({
        ok: true,
        value: {
          text: JSON.stringify({
            schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: 't', pluginVersion: view.CLIENT_PLUGIN_VERSION, todos: [], paths: { todoFile: null }, membersById: {}, project: { name: 'P', root: 'D:\\proj' },
            audit: { level: 'green', red: 0, yellow: 0 }, counts: { members: 1 }, members: {},
          }),
        },
      }),
    },
  },
}
const fix17SnapOut = await view.loadPanel(fix17SnapCtx, { sessionId: 'r1' })
assert.equal(fix17SnapOut.source, 'remote.session + panel.json', 'FIX-17：快照信封必须被解包读到')
assert.equal(fix17SnapOut.notes.length, 0, 'FIX-17：解包成功后不该有降级提示')
const fix17SnapFail = await view.loadPanel({
  remote: {
    session: { list: async () => ({ ok: true, value: { items: [{ sessionId: 'r1', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 1 }] } }) },
    workspaceFiles: { read: async () => ({ ok: false, error: { code: 'session/not-found' } }) },
  },
}, { sessionId: 'r1' })
assert.ok(fix17SnapFail.notes.some((text) => text.includes(view.SNAPSHOT_STEP)), 'FIX-17：快照失败信封要点名快照步骤')
assert.ok(fix17SnapFail.notes.some((text) => text.includes('session/not-found')), 'FIX-17：要带出快照 remote 的 error code')
// ④ 裸值兼容
const fix17Bare = await view.loadPanel({
  remote: { session: { list: async () => ({ items: [{ sessionId: 'b1', running: true, agentAvailable: true, updatedAt: 1 }] }) } },
}, { sessionId: 'b1' })
assert.equal(fix17Bare.members.length, 1, 'FIX-17：裸值写法仍要能用')
ok('FIX-17 remote 信封解包：{ok,value}/{ok,error} 都处理 / 血缘与快照各自归因 / 裸值兼容')

// ---------------------------------------------------------------- FIX-18【critical】运行三处实锤
// ① workspaceFiles.read 第一参必须是 **sessionId 字符串**（wire 字段 workspaceFileScopeId）
const fix18Reads = []
const fix18Ctx = {
  remote: {
    session: { list: async () => ({ ok: true, value: { items: [{ sessionId: 'root-9', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 1 }] } }) },
    workspaceFiles: {
      read: async (first, path) => {
        fix18Reads.push({ first, path })
        return {
          ok: true,
          value: {
            text: JSON.stringify({
              schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: 't', pluginVersion: view.CLIENT_PLUGIN_VERSION, todos: [], paths: { todoFile: null }, membersById: {}, project: { name: 'P', root: 'D:\\proj' },
              audit: { level: 'green', red: 0, yellow: 0 }, counts: { members: 1 }, members: {},
            }),
          },
        }
      },
    },
  },
}
const fix18Out = await view.loadPanel(fix18Ctx, { sessionId: 'root-9' })
assert.equal(fix18Out.source, 'remote.session + panel.json', 'FIX-18：快照必须读到')
assert.ok(fix18Reads.length >= 1, 'FIX-18：必须真的调用过 workspaceFiles.read')
assert.equal(
  typeof fix18Reads[0].first,
  'string',
  `FIX-18：read 第一参必须是 sessionId **字符串**，实际 ${typeof fix18Reads[0].first}（传对象会被网关 boundary validation 拒掉）`,
)
assert.equal(fix18Reads[0].first, 'root-9', 'FIX-18：第一参必须是当前会话 id')

// ② 投影值包是**普通对象**（不是 Map）→ label / mode 必须取得到
assert.deepEqual(
  toHost(view.projectionValue({ subagent: { id: 'x' } }, 'subagent')),
  { id: 'x' },
  'FIX-18：projections.values 是普通对象，必须按键取值（不是 .get()）',
)
assert.equal(view.projectionValue(new Map([['k', 1]]), 'k'), 1, 'FIX-18：Map 形态也要兼容')
const fix18Info = view.loadInfo({ subagentCatalog: [{ id: 'c1', mode: 'continuable', label: 'T99_冒烟-researcher' }] })
assert.equal(fix18Info.children.c1.mode, 'continuable', 'FIX-18：必须能从普通对象形态的 subagentCatalog 取到 mode')
assert.equal(fix18Info.children.c1.label, 'T99_冒烟-researcher', 'FIX-18：必须能取到 label')
// 端到端：行的 hints 里带 catalog → 子节点名/角色/模式/配色全部生效
const fix18Tree = await view.loadPanel({
  remote: {
    session: {
      list: async () => ({
        ok: true,
        value: {
          items: [
            {
              sessionId: 'p1', cwd: 'D:\\proj', running: true, agentAvailable: true, updatedAt: 1,
              projections: {
                kind: 'sequenced', asOfSeq: 1,
                values: { subagentCatalog: [{ id: 'k1', mode: 'continuable', label: 'T99_冒烟-researcher' }] },
              },
            },
            { sessionId: 'k1', parentSessionId: 'p1', origin: 'subagent', running: false, agentAvailable: false, updatedAt: 2 },
          ],
        },
      }),
    },
  },
}, { sessionId: 'p1' })
const fix18Child = fix18Tree.roots[0].children[0]
assert.equal(fix18Child.name, 'T99_冒烟-researcher', 'FIX-18：子节点名必须来自 catalog label（不是「子智能体 <短id>」）')
assert.equal(fix18Child.role, 'researcher', 'FIX-18：角色必须从 label 反解（配色才有效）')
assert.equal(fix18Child.mode, 'continuable', 'FIX-18：模式必须来自权威投影')
assert.equal(view.roleColor(fix18Child.role), view.ROLE_COLORS.researcher, 'FIX-18：角色色必须生效')

// ③ 跳转必须走 uiWorkspace.openSession；不得再用 onSubagentJump（它只给「任务管理」定位高亮）
const fix18Jumped = []
const fix18JumpCtx = { get: (name) => (name === 'uiWorkspace' ? { openSession: (id) => fix18Jumped.push(id) } : undefined) }
assert.equal(view.openSessionConversation(fix18JumpCtx, 'sess-1'), true, 'FIX-18：有 uiWorkspace 时必须走它')
assert.deepEqual(fix18Jumped, ['sess-1'], 'FIX-18：必须调用 openSession(sessionId)')
assert.equal(view.openSessionConversation({ get: () => undefined }, 'sess-1'), false, 'FIX-18：拿不到服务返回 false（调用方退化为展示 id）')
assert.equal(view.openSessionConversation(null, 'sess-1'), false, 'FIX-18：无 ctx 也不能抛错')
assert.equal(view.openSessionConversation({ get: () => ({}) }, 'sess-1'), false, 'FIX-18：服务没有 openSession 同样返回 false')
assert.equal(/onJump: props\.onSubagentJump/.test(clientSource), false, 'FIX-18：不得再把 onSubagentJump 当"打开会话"')
assert.ok(clientSource.includes("get('uiWorkspace')"), 'FIX-18：跳转必须走 uiWorkspace.openSession')

// ④ 树形视觉：缩进 / 连接符 / 子计数必须在渲染里存在
assert.ok(clientSource.includes('styles.guide') && clientSource.includes('styles.childRow'), 'FIX-18：树形指引必须存在（否则一层多子节点看起来是平铺）')
assert.ok(clientSource.includes('depth * 16'), 'FIX-18：子节点必须按层级缩进')
ok('FIX-18 运行三修：read 传 sessionId 字符串 / 投影按普通对象取值（label+mode 生效）/ 跳转走 uiWorkspace.openSession / 树形指引')

// ---------------------------------------------------------------- FIX-19 面板可读性：中文名 / 徽章说明 / 对齐 / 拓扑图
// ① 状态与角色一律中文
for (const status of ['running', 'idle', 'completed', 'failed', 'released', 'unknown']) {
  const label = view.STATUS_LABELS[status]
  assert.ok(label && /^[一-龥]+$/.test(label), `FIX-19：状态 ${status} 必须有纯中文标签，实际 ${label}`)
}
assert.equal(view.STATUS_LABELS.completed, '已完成', 'FIX-19：completed 必须显示「已完成」')
assert.equal(view.STATUS_LABELS.running, '运行中')
assert.equal(view.roleLabel('implementer'), '实现者', 'FIX-19：implementer 必须显示中文「实现者」')
assert.equal(view.roleLabel('reviewer'), '审查者')
assert.equal(view.roleLabel('adversary'), '对抗审查者')
assert.equal(view.roleLabel('未知角色'), '成员', 'FIX-19：未知角色退化「成员」')
// 交叉比对：client 的中文名必须与 host 角色卡的 title 一致（client 是经典脚本、import 不了，只能这样防漂移）喵
for (const role of listRoles(plugin.Config({}))) {
  assert.equal(view.ROLE_LABELS[role.id], role.title, `FIX-19：client 角色中文名必须与 roles.js 的 title 一致（${role.id}）`)
}
// ② 五枚徽章都要有**中文说明**（用户看到「契约?」不知道是什么）
assert.deepEqual(toHost(Object.keys(view.BADGE_INFO)).sort(), ['三档', '契约', '异源', '预算', '进度'].sort(), 'FIX-19：五枚徽章都要有说明')
for (const [key, hint] of Object.entries(view.BADGE_INFO)) {
  assert.ok(typeof hint === 'string' && hint.length >= 6, `FIX-19：徽章 ${key} 的说明不得为空`)
}
const fix19MemberRow = view.badgeRow({ role: 'implementer', badges: {}, hasAudit: true })
assert.deepEqual(toHost(fix19MemberRow.map((item) => item.key)), ['契约', '三档', '进度', '预算', '异源'], 'FIX-19：五枚徽章顺序固定')
assert.ok(fix19MemberRow.every((item) => item.hint && typeof item.value === 'string'), 'FIX-19：每枚都要有 hint 与取值')
// 主代理五枚一律 na（显示 —），不再一律甩问号让人猜
const fix19MainRow = view.badgeRow({ role: '主代理', badges: {}, hasAudit: true })
assert.ok(fix19MainRow.every((item) => item.value === 'na'), 'FIX-19：主代理不适用五枚徽章，必须显示 —（na）')
assert.equal(view.BADGE_VIEW.na.symbol, '—', 'FIX-19：na 的符号是 —')
// 未拿到快照时仍标 pending（tooltip 里说明"数据源待接"）
const fix19PendingRow = view.badgeRow({ role: 'implementer', badges: { docs: 'ok' }, hasAudit: false })
assert.equal(fix19PendingRow.find((item) => item.key === '三档').pending, true, 'FIX-19：快照未到要标 pending')
assert.ok(clientSource.includes('数据源待接'), 'FIX-19：pending 的 tooltip 要说明原因')

// ③ 定宽列：标签不再参差不齐
// 用户口径变更（2026-10-03）：「层 / 子」两栏**已删**（信息并入 tooltip）⇒ 定宽列只剩 角色/状态/模式/徽章，
// 这条断言的要求从"必须有 32、44"换成"剩下的列仍是定宽"（同一要求，列集变了，不是放宽）喵
for (const width of [72, 64, 48, 40]) {
  assert.ok(clientSource.includes(`width: ${width}`), `FIX-19：必须有定宽列 ${width}（否则标签参差不齐）`)
}
assert.equal(
  clientSource.includes("width: 32, opacity: 0.6 } }, 'L' + node.layer"),
  false,
  '用户口径：成员列表不再有「层」栏（层级看缩进；具体层数进 tooltip）',
)
assert.equal(
  clientSource.includes('head(32)') || clientSource.includes('head(44)'),
  false,
  '用户口径：列头不再有「层 / 子」两栏',
)
assert.ok(
  clientSource.includes("`层 L${node.layer}`") && clientSource.includes('子节点 ${children} 个'),
  '用户口径：删掉的两栏信息要进 tooltip（信息不丢，只是不占列）',
)
assert.ok(clientSource.includes('nameCell'), 'FIX-19：名称列要用省略号截断，不能把后面的列挤出去')

// ④ 拓扑图：纯函数布局 + 视图切换
const fix19Roots = [{
  name: 'A', sessionId: 'a', role: '主代理', status: 'idle', mode: 'continuable', layer: 0,
  children: [
    { name: 'B', sessionId: 'b', role: 'implementer', status: 'completed', mode: 'continuable', layer: 1, children: [] },
    { name: 'C', sessionId: 'c', role: 'reviewer', status: 'completed', mode: 'continuable', layer: 1, children: [] },
  ],
}]
const fix19Layout = view.layoutTopology(fix19Roots)
assert.equal(fix19Layout.cards.length, 3, 'FIX-19：拓扑卡片数 = 节点数')
const [cardA, cardB, cardC] = ['a', 'b', 'c'].map((id) => fix19Layout.cards.find((card) => card.node.sessionId === id))
assert.equal(cardA.depth, 0, 'FIX-19：根在第 0 层')
assert.equal(cardB.depth, 1, 'FIX-19：子节点在第 1 层')
assert.equal(cardB.y, cardC.y, 'FIX-19：同层 y 相同')
assert.ok(cardA.y < cardB.y, 'FIX-19：父层在上')
assert.ok(cardB.x < cardC.x, 'FIX-19：叶子按顺序从左往右')
assert.equal(cardA.x, (cardB.x + cardC.x) / 2, 'FIX-19：父节点必须居中于首末子节点之间')
assert.ok(cardC.x - cardB.x >= fix19Layout.cardWidth, 'FIX-19：同层叶子不得重叠')
assert.equal(fix19Layout.edges.length, 2, 'FIX-19：每条父子关系一条边')
assert.ok(fix19Layout.edges.every((edge) => edge.y1 < edge.y2), 'FIX-19：边必须从上往下连')
assert.ok(fix19Layout.width > 0 && fix19Layout.height > 0, 'FIX-19：画布尺寸必须为正')
assert.equal(view.layoutTopology([{ name: 'S', sessionId: 's', children: [] }]).edges.length, 0, 'FIX-19：单节点无边')
assert.deepEqual(toHost(view.layoutTopology([]).cards), [], 'FIX-19：空树不炸')
// 视图切换 + 拓扑组件在渲染里存在
assert.equal(view.VIEW_LABELS.list, '列表', 'FIX-19：视图切换有「列表」')
assert.equal(view.VIEW_LABELS.topology, '拓扑图', 'FIX-19：视图切换有「拓扑图」')
assert.ok(clientSource.includes('function TopologyView'), 'FIX-19：必须有拓扑视图组件')
assert.ok(clientSource.includes("setView('topology')") && clientSource.includes("setView('list')"), 'FIX-19：必须能来回切')
assert.ok(clientSource.includes('徽章说明'), 'FIX-19：面板里必须有徽章图例')
ok('FIX-19 面板可读性：全中文名（与角色卡交叉比对）/ 五枚徽章带说明+主代理 na / 定宽列对齐 / 拓扑图布局与切换')

// ---------------------------------------------------------------- FIX-20 拓扑交互与持久化
// ① 卡片底色按角色决定
assert.ok(
  view.roleTint('reviewer').startsWith('rgba(210, 153, 34'),
  `FIX-20：审查者卡片底色必须来自角色色，实际 ${view.roleTint('reviewer')}`,
)
assert.ok(view.roleTint('adversary').startsWith('rgba(248, 81, 73'), 'FIX-20：对抗审查卡片底色必须来自它的专属色')
assert.notEqual(view.roleTint('reviewer'), view.roleTint('adversary'), 'FIX-20：不同角色底色必须不同')
assert.ok(view.roleTint('researcher', 0.5).endsWith('0.5)'), 'FIX-20：底色透明度可调')
// ② 拓扑图可拖拽平移
assert.ok(
  clientSource.includes('onPointerDown') && clientSource.includes("addEventListener('pointermove'"),
  'FIX-20：拓扑图必须支持按住拖动（用户反馈"无法拖动"）',
)
assert.ok(clientSource.includes('translate(${tf.x}px, ${tf.y}px) scale(${tf.k})'), 'FIX-20：平移必须走 transform（小树没溢出时滚动条拖不动）')
// ③ 徽章说明可隐藏（折叠）
assert.ok(clientSource.includes('legendHead'), 'FIX-20：图例要有可点击的表头')
assert.ok(clientSource.includes('legendOpen ?'), 'FIX-20：图例必须能收起')
// ④ 视图/图例状态跨 remount（跳转后）与重载保留
// FIX-21 起多了 `auditOpen`（审计清单展开位）、FIX-29 起多了 `todoOpen`/`todoExpanded`（A 区）、
// FIX-40 起多了 `queueOpen`（B 区折叠位，与 A 区**互不干扰**）、FIX-52 起多了 `viewChosen`
// （"用户有没有亲手选过视图" —— 没选过才吃设置页的「默认视图」）—— 断言语义不变，仍是"整份兜底状态"喵
assert.deepEqual(
  toHost(view.panelUiState),
  { view: 'list', viewChosen: false, legendOpen: false, auditOpen: false, todoOpen: true, todoExpanded: false, queueOpen: true },
  'FIX-20：必须有模块级兜底状态（同页 remount 不丢）',
)
const fix20Calls = []
const fix20Ctx = {
  get: (name) => (name === 'betterSidebar' ? { updateTab: (id, patch) => fix20Calls.push({ id, patch }) } : undefined),
}
view.writeTabMeta(fix20Ctx, 'agent-contract:contract', { view: 'topology', legendOpen: false })
assert.deepEqual(
  toHost(fix20Calls),
  [{ id: 'agent-contract:contract', patch: { meta: { view: 'topology', legendOpen: false } } }],
  'FIX-20：必须用官方 updateTab 持久化到 tab.meta（随布局持久化、重载原样恢复）',
)
assert.deepEqual(toHost(view.readTabMeta({ meta: { view: 'topology' } })), { view: 'topology' }, 'FIX-20：要能读回 tab.meta')
assert.deepEqual(toHost(view.readTabMeta(null)), {}, 'FIX-20：没有 meta 时给空对象（不炸）')
assert.doesNotThrow(() => view.writeTabMeta(null, 'x', {}), 'FIX-20：拿不到 betterSidebar 不能抛错')
// 源码级：初值必须读 tab.meta —— 否则点击跳转后组件 remount 又会退回列表（用户反馈的现象）
assert.ok(clientSource.includes('readUiState(props.tab)'), 'FIX-20/24：视图初值必须读回持久化状态，否则跳转后又被重置成列表')
ok('FIX-20 拓扑交互：卡片底色按角色 / 可拖拽平移 / 徽章说明可折叠 / 视图状态经 tab.meta 持久化（跨 remount 与重载）')

// ---------------------------------------------------------------- FIX-21 拖拽选字 / 图例占位 / 异源不适用
// ① 拖拽必须阻止文字选中（否则鼠标一划变成选字、根本拖不动）
assert.ok(
  /addEventListener\('wheel'[\s\S]{0,80}\{ passive: false \}/.test(clientSource),
  'FIX-21：滚轮监听必须非 passive（否则 preventDefault 无效、页面跟着滚）',
)
assert.ok(/topoViewport:[^}]*userSelect: 'none'/.test(clientSource), 'FIX-21：视口必须 userSelect: none（否则拖拽变选字）')
// ② 徽章说明默认**收起**（不再占一大块），表头仍可点开
assert.equal(view.panelUiState.legendOpen, false, 'FIX-21：徽章说明默认收起')
assert.equal(view.readTabMeta({ meta: { legendOpen: true } }).legendOpen, true, 'FIX-21：用户展开过就要能从 tab.meta 恢复')
assert.ok(clientSource.includes('legendOpen ?'), 'FIX-21：图例仍必须能展开')
assert.ok(/legend:[^}]*fontSize: 10\.5/.test(clientSource), 'FIX-21：图例字号要收紧（原来看起来很高）')
// ③ 「异源」只对对抗审查有意义：角色已知且非 adversary → —（na）
const fix21Impl = view.badgeRow({ role: 'implementer', badges: {}, hasAudit: true })
assert.equal(fix21Impl.find((item) => item.key === '异源').value, 'na', 'FIX-21：非对抗角色的异源徽章必须显示 —（不适用）')
assert.equal(
  view.badgeRow({ role: 'adversary', badges: { crossVendor: 'ok' }, hasAudit: true }).find((item) => item.key === '异源').value,
  'ok',
  'FIX-21：对抗审查的异源徽章必须是真值',
)
assert.equal(
  view.badgeRow({ role: null, badges: {}, hasAudit: true }).find((item) => item.key === '异源').value,
  'unknown',
  'FIX-21：角色未知时保留 ?，不许把"不知道"伪装成"不适用"',
)
assert.equal(
  view.badgeRow({ role: '主代理', badges: {}, hasAudit: true }).every((item) => item.value === 'na'),
  true,
  'FIX-21：主代理五枚仍全 na',
)
ok('FIX-21 交互细节：拖拽不选字 / 徽章说明默认收起且更紧凑 / 异源对非对抗角色显示 —（未知仍保留 ?）')

// ---------------------------------------------------------------- FIX-22 拓扑视口：transform 平移 + 滚轮缩放
assert.equal(view.ZOOM_MIN, 0.4, 'FIX-22：缩放下限对齐官方 tasks-graph')
assert.equal(view.ZOOM_MAX, 2, 'FIX-22：缩放上限对齐官方 tasks-graph')
assert.equal(view.FIT_MAX_SCALE, 1.3, 'FIX-22：自适应缩放上限（免得两个节点的小树被吹满屏）')
const fix22Fit = view.fitViewport(800, 300, 400, 220)
assert.ok(fix22Fit.k > 0 && fix22Fit.k <= view.FIT_MAX_SCALE, `FIX-22：自适应缩放必须在界内，实际 ${fix22Fit.k}`)
assert.ok(800 * fix22Fit.k <= 400 + 1, 'FIX-22：内容缩放后必须装得进容器宽度')
assert.ok(fix22Fit.x >= 0, 'FIX-22：居中偏移不得为负')
assert.equal(view.fitViewport(60, 40, 400, 220).k, view.FIT_MAX_SCALE, 'FIX-22：小内容封顶在 FIT_MAX_SCALE')
const fix22Big = view.fitViewport(4000, 2000, 400, 220)
assert.ok(fix22Big.k < 1, 'FIX-22：大内容必须缩小')
assert.equal(fix22Big.k, view.ZOOM_MIN, 'FIX-22：缩到下限就停（ZOOM_MIN）')
assert.ok(view.fitViewport(800, 300, 0, 0).k > 0, 'FIX-22：拿不到容器尺寸也要给个可用视图')
// 视口元素与手势守卫
assert.ok(/topoViewport:[^}]*overflow: 'hidden'/.test(clientSource), 'FIX-22：视口不得用滚动条（小树没溢出时拖不动）')
assert.ok(clientSource.includes("'data-graph-controls'"), 'FIX-22：控制簇必须打标记，拖动要忽略它')
assert.ok(clientSource.includes("'data-graph-node'"), 'FIX-22：卡片必须打标记，拖动要忽略它（否则抢掉跳转点击）')
assert.ok(clientSource.includes('setPointerCapture'), false, 'FIX-22：禁止 setPointerCapture —— 它会重定向 click、悄悄干掉卡片点击')
assert.ok(clientSource.includes('CLICK_TOLERANCE_PX'), 'FIX-22：必须有"拖动 vs 点击"的位移容差')
assert.ok(clientSource.includes('onDoubleClick'), 'FIX-22：双击背景要能重新自适应')
assert.ok(clientSource.includes('zoomBy('), 'FIX-22：必须有缩放按钮（不靠滚轮也能用）')
// 面板自身：可滚动区，但**不许**写 alignSelf（宿主 .paneTab 是列向 flex，alignSelf 管横向、会缩掉宽度）
assert.ok(/wrap:[^}]*overflowY: 'auto'/.test(clientSource), 'FIX-22：面板自身要是可滚动区（树长时在框内滚）')
assert.equal(/wrap:[^}]*alignSelf/.test(clientSource), false, 'FIX-22：禁止给 wrap 写 alignSelf（列向 flex 里它会缩掉宽度）')
ok('FIX-22 拓扑视口：fitViewport 纯函数（居中/封顶/下限）/ transform 平移 / 非 passive 滚轮缩放 / 点击与拖动分离 / 缩放控制簇')

// ---------------------------------------------------------------- FIX-23 空白利用 + 整卡双击跳转
// ① 把宿主 pane 的剩余空白用**我们自己的画布**吃掉（不靠注入样式去动宿主的 DOM）
assert.ok(/wrap:[^}]*display: 'flex'/.test(clientSource), 'FIX-23：面板根必须是 flex，子元素才能吃掉剩余高度')
assert.ok(/wrap:[^}]*flexDirection: 'column'/.test(clientSource), 'FIX-23：必须是列向 flex')
assert.ok(/topoViewport:[\s\S]{0,260}flex: '1 1 auto'/.test(clientSource), 'FIX-23：拓扑视口必须吃掉剩余高度（那块空白就变成画布）')
assert.ok(/topoViewport:[\s\S]{0,260}minHeight: 180/.test(clientSource), 'FIX-23：视口要有最小高度，别被压没')
assert.equal(clientSource.includes("createElement('style')"), false, 'FIX-23：禁止注入全局样式去改宿主 DOM')
// ② 自适应要量**真实**视口高度（视口现在由 flex 决定）
assert.ok(clientSource.includes('el.clientHeight'), 'FIX-23：自适应必须量真实视口高度')
// ③ 双击**整张卡片**任意区域即可跳转（不再只有名字可点）
assert.ok(/data-graph-node': ''[\s\S]{0,900}onDoubleClick/.test(clientSource), 'FIX-23：卡片必须支持双击跳转')
assert.ok(/onDoubleClick[\s\S]{0,120}stopPropagation/.test(clientSource), 'FIX-23：卡片双击要 stopPropagation，否则会同时触发背景的"双击自适应"')
assert.ok(clientSource.includes("cursor: 'pointer'"), 'FIX-23：卡片要有可点光标')
// FIX-43（用户口径）：这行**说明文字**已从页面上撤掉（"写在文档里，别占版面"）——
// 但**能力**一个字没减：双击跳转仍由上面的 onDoubleClick/stopPropagation 断言把守喵
assert.equal(
  clientSource.includes('只读视图。'), false,
  'FIX-45：面板上不再显示"只读视图…"这类说明文字（信息归文档；能力断言见上两行）',
)
ok('FIX-23 空白利用 + 整卡双击：画布吃掉剩余高度 / 量真实视口 / 双击任意区域跳转且不与背景自适应打架')

// ---------------------------------------------------------------- FIX-24 拓扑视图变换持久化（跳转/重载不被重置）
// ① clampTf：界外夹回、非法判无效
assert.deepEqual(toHost(view.clampTf({ x: 10, y: 20, k: 1.5 })), { x: 10, y: 20, k: 1.5 }, 'FIX-24：合法存档原样恢复')
assert.deepEqual(toHost(view.clampTf({ x: 10, y: 20, k: 99 })), { x: 10, y: 20, k: view.ZOOM_MAX }, 'FIX-24：缩放界外夹回 ZOOM_MAX')
assert.deepEqual(toHost(view.clampTf({ x: 10, y: 20, k: 0.01 })), { x: 10, y: 20, k: view.ZOOM_MIN }, 'FIX-24：缩放界外夹回 ZOOM_MIN')
assert.equal(view.clampTf(null), null, 'FIX-24：没有存档 → null（走自适应）')
assert.equal(view.clampTf({ x: NaN, y: 0, k: 1 }), null, 'FIX-24：非有限数必须判无效')
assert.equal(view.clampTf({ x: 0, y: 0 }), null, 'FIX-24：缺 k 必须判无效')
assert.equal(view.clampTf({ x: 0, y: 0, k: 'x' }), null, 'FIX-24：k 非数必须判无效')
// ② 挂载先读回存档，再谈自适应；手势落盘要防抖
assert.ok(
  clientSource.includes('clampTf(readUiState(props.tab).tf)'),
  'FIX-24：挂载必须先读回持久化状态里的 tf（否则跳转回来又被重置成默认大小位置）',
)
assert.ok(clientSource.includes('schedulePersist'), 'FIX-24：手势必须落盘')
assert.ok(/setTimeout\([\s\S]{0,200}onViewport/.test(clientSource), 'FIX-24：落盘要防抖，并走 onViewport 回调')
assert.ok(clientSource.includes('onViewport: persistUi'), 'FIX-24：拓扑视图的落盘必须接到 ContractTab 的 persistUi')
// ③ 三种手势都走统一出口：滚轮 / 缩放按钮（拖动在松手时落盘）
assert.ok((clientSource.match(/applyTf\(/g) || []).length >= 3, 'FIX-24：滚轮与缩放按钮都要走统一出口')
assert.ok(/if \(travel >= CLICK_TOLERANCE_PX\) schedulePersist/.test(clientSource), 'FIX-24：拖动松手时（真拖了才）落盘')
// ④ view / legendOpen / tf 三者进同一份 tab.meta
const fix24Calls = []
view.writeTabMeta(
  { get: () => ({ updateTab: (id, patch) => fix24Calls.push(patch) }) },
  'agent-contract:contract',
  { view: 'topology', legendOpen: false, tf: { x: 1, y: 2, k: 1.5 } },
)
assert.deepEqual(
  toHost(fix24Calls[0].meta),
  { view: 'topology', legendOpen: false, tf: { x: 1, y: 2, k: 1.5 } },
  'FIX-24：视图 / 图例 / 视图变换必须进同一份 tab.meta（一次恢复三样）',
)
ok('FIX-24 视图变换持久化：clampTf 夹取与校验 / 挂载读回 tf / 手势防抖落盘（滚轮·拖动·按钮）/ 与视图图例同一份 tab.meta')

// ---------------------------------------------------------------- FIX-25 UI 状态主存换 localStorage + 徽章去符号
// ① localStorage 是我们的**主存**（实测 tab.meta 在跳转重建布局时会丢）
view.persistUiState({ get: () => undefined }, { id: 'agent-contract:contract' }, {
  view: 'topology', legendOpen: true, tf: { x: 5, y: 6, k: 1.4 },
})
assert.ok(
  String(sandbox.window.localStorage.getItem('agent-contract:panel-ui')).includes('topology'),
  'FIX-25：必须写 localStorage（面板 UI 状态的主存）',
)
const fix25Restored = view.readUiState({ meta: null })
assert.equal(fix25Restored.view, 'topology', 'FIX-25：localStorage 必须能恢复视图')
assert.equal(fix25Restored.legendOpen, true, 'FIX-25：localStorage 必须能恢复图例展开态')
assert.deepEqual(toHost(fix25Restored.tf), { x: 5, y: 6, k: 1.4 }, 'FIX-25：localStorage 必须能恢复视图变换')
// 与 tab.meta 冲突时 localStorage 优先（tab.meta 实测会丢，不能让它把好状态覆盖掉）喵
assert.equal(view.readUiState({ meta: { view: 'list' } }).view, 'topology', 'FIX-25：localStorage 必须优先于 tab.meta')
assert.equal(view.readUiState({ meta: { tf: { x: 9, y: 9, k: 9 } } }).tf.k, 1.4, 'FIX-25：冲突时以 localStorage 为准')
// 三写仍在：tab.meta 也拿到了一份
const fix25TabCalls = []
view.persistUiState({ get: () => ({ updateTab: (id, patch) => fix25TabCalls.push(patch) }) }, { id: 't2' }, { legendOpen: false })
assert.equal(fix25TabCalls.length, 1, 'FIX-25：tab.meta 仍要写（作为备援）')

// ② 徽章渲染口径：**FIX-20 推翻了上一轮 FIX-25 的"去符号、只留彩色文字"决定**。
// 实测反馈是「只能靠颜色分辨」「已完成/运行中只有两个状态可见」，所以符号必须回来。
// 这是**设计口径反转，不是放宽断言**：原断言要求"符号不得出现"，新断言要求"符号必须出现、
// 且四类取值靠符号就能两两分辨"（见下面的 FIX-20 块），约束更强喵。
assert.equal(new Set(Object.values(view.BADGE_STATE_LABELS)).size, 5, 'FIX-25：五种状态词必须互不相同')
assert.ok(
  Object.values(view.BADGE_STATE_LABELS).every((text) => /^[一-龥]+$/.test(text)),
  'FIX-25：状态词必须纯中文（tooltip 用）',
)
assert.ok(
  clientSource.includes('badgeText(item.value)'),
  'FIX-25：状态词必须进 tooltip（FIX-20 起由 badgeText() 统一拼「符号 + 中文状态词」，口径仍出自 BADGE_STATE_LABELS）',
)
ok('FIX-25 UI 状态主存 localStorage（localStorage > tab.meta，冲突以 localStorage 为准）/ 状态词纯中文且进 tooltip')

// ---------------------------------------------------------------- FIX-26 双击卡片不得选中页面文字
// 现象（用户实测）：拓扑图里双击卡片跳转时，若双击落在卡片文字上，浏览器会顺手把文字选中；
// 跳转又整块换掉了会话视图，选区两端横跨新旧 DOM → 看上去就是「整页文字被全选」喵。
// 三道防线都要在：① 卡片与其文字子节点直接标不可选中（继承压不住宿主直配规则）
// ② mousedown preventDefault（与 CSS 无关地掐掉选区起点）③ 跳转前主动放下残留选区喵。
assert.equal(typeof view.dropTextSelection, 'function', 'FIX-26：dropTextSelection 必须是可断言的纯函数')
let fix26Ranges = 0
const fix26Win = {
  getSelection: () => ({ removeAllRanges: () => { fix26Ranges += 1 } }),
}
assert.equal(view.dropTextSelection(fix26Win), true, 'FIX-26：能拿到选区时必须清掉并返回 true')
assert.equal(fix26Ranges, 1, 'FIX-26：removeAllRanges 必须真的被调用（不是只读一眼）')
assert.equal(view.dropTextSelection({}), false, 'FIX-26：没有 getSelection 的环境返回 false，不抛错')
assert.equal(view.dropTextSelection(null), false, 'FIX-26：window 缺失也不能抛错（跳转不能被它拖垮）')
assert.equal(view.dropTextSelection(undefined), false, 'FIX-26：undefined 同样安全')
assert.equal(
  view.dropTextSelection({ getSelection: () => { throw new Error('boom-selection') } }),
  false,
  'FIX-26：getSelection 抛错必须被吞掉（清选区永远不该影响跳转）',
)
assert.equal(
  view.dropTextSelection({ getSelection: () => ({}) }),
  false,
  'FIX-26：选区对象没有 removeAllRanges 时安静返回 false',
)
// ③ 跳转入口必须先放选区再跳（顺序即语义：先清后跳，跳完就没有残留选区可跨了）喵
assert.ok(
  /const jumpTo = \(sessionId\) => \{\s*dropSelection\(\)[\s\S]{0,80}props\.onJump/.test(clientSource),
  'FIX-26：jumpTo 必须 dropSelection() 之后再 onJump',
)
// ② 卡片的 mousedown 必须掐掉浏览器默认的选区手势
assert.ok(
  /onMouseDown: \(event\) => \{ if \(event && event\.preventDefault\) event\.preventDefault\(\) \}/.test(clientSource),
  'FIX-26：卡片 mousedown 必须 preventDefault（选区起点就断在这里）',
)
// ① 不可选中样式要直接落在卡片 + 四个文字子节点上
assert.ok(
  /noSelect: \{ userSelect: 'none', WebkitUserSelect: 'none' \}/.test(clientSource),
  'FIX-26：必须有 noSelect 片段（user-select + -webkit-user-select 两条都要）',
)
assert.ok(
  /\.\.\.styles\.card,\s*\n\s*\.\.\.styles\.noSelect/.test(clientSource),
  'FIX-26：卡片本体必须直接标不可选中',
)
for (const part of ['cardTitle', 'cardName', 'cardMeta', 'cardBadges']) {
  assert.ok(
    new RegExp(`\\.\\.\\.styles\\.${part}, \\.\\.\\.styles\\.noSelect`).test(clientSource),
    `FIX-26：文字子节点 ${part} 也必须直接标不可选中（继承弱于宿主直配规则）`,
  )
}
assert.ok(
  /style: \{ \.\.\.styles\.noSelect, color: badge\.color/.test(clientSource),
  'FIX-26：徽章 span 也要带上不可选中（它是卡片里字体最小的落点）',
)
// 回归：双击跳转本身与 stopPropagation 不许因为这次修复被削掉喵
assert.ok(
  /onDoubleClick: \(event\) => \{\s*event\.stopPropagation\(\)\s*jumpTo\(card\.node\.sessionId\)/.test(clientSource),
  'FIX-26：双击跳转 + stopPropagation 必须保持（FIX-23 的回归位）',
)
ok('FIX-26 双击卡片不选字：卡片与文字子节点直接标不可选中 / mousedown preventDefault / 跳转前放下残留选区（失败不干扰跳转）')

// ================================================================ 核验轮（M2.5/M4 核验报告）FIX-17~21
// 说明：这一轮的 FIX 编号与上一轮**重了号**（FIX.md 重排过），所以标签里带上报告别名（`= FIX-27` 等），
// 便于用 `grep 'FIX-19【'` / `grep FIX-29` 精确命中**本轮**的断言喵。

// ---------------------------------------------------------------- FIX-19【本轮 = 报告 FIX-29】改名不得重复前置任务号
// 现象：任务号含下划线时（`T-800_A`），一轮治理把合规的 `T-800_A_报告与结论_L3.md` 改成
// `T-800_A_A_报告与结论_L3.md`，且**每轮继续扩散**（已在 Blockdustry 污染 4 篇）喵。
// 根因：文件名反解按"第一个下划线"猜 → 标题拿到 `A_报告与结论`，再前置 front-matter 的完整任务号喵。
assert.equal(
  parseDocFileName('T-800_A_报告与结论_L3.md').title, 'A_报告与结论',
  'FIX-19：不传已知任务号时仍是旧口径——把事故根因写下来，免得被"改回去"',
)
assert.equal(stripTaskPrefix('T-800_A_报告与结论', 'T-800_A'), '报告与结论', 'FIX-19：按已知任务号精确剥离前缀')
assert.equal(stripTaskPrefix('T-800_A_T-800_A_报告', 'T-800_A'), '报告', 'FIX-19：已被重复前置的标题先剥干净（幂等守卫）')
assert.equal(stripTaskPrefix('报告与结论', 'T-800_A'), null, 'FIX-19：前缀对不上要返回 null（交给旧口径），不许瞎剥')
assert.equal(stripTaskPrefix('T-800_A', 'T-800_A'), '', 'FIX-19：只有任务号、没有标题 → 空串')
// FIX-32：`hasDoubledTaskPrefix` 改**语义判** —— 入参是**已剥前缀的标题**，不是整个文件名喵
assert.equal(hasDoubledTaskPrefix('T-800_A_报告', 'T-800_A'), true, 'FIX-32：剥前缀后标题仍以任务号开头 ⇒ 重复前置')
assert.equal(hasDoubledTaskPrefix('报告与结论', 'T-800_A'), false, 'FIX-32：正常标题不得误判')

const fix19Text = ['---', 'taskId: T-800_A', 'tier: 3', 'title: 报告与结论', '---', '', '## 结论', '一句话结论。'].join('\n')
const fix19Derived = deriveDocMeta({
  fileName: 'T-800_A_报告与结论_L3.md', text: fix19Text, mtime: '2026-10-02T00:00:00.000Z', overrides: { taskId: 'T-800_A' },
})
assert.equal(fix19Derived.taskId, 'T-800_A', 'FIX-19：任务号取 front-matter 的权威值（含下划线）')
assert.equal(fix19Derived.title, '报告与结论', 'FIX-19：标题必须按已知任务号剥离 —— 事故就发生在这一步')
assert.equal(
  docFileName(fix19Derived.taskId, fix19Derived.title, fix19Derived.tier), 'T-800_A_报告与结论_L3.md',
  'FIX-19：反解 → 拼回必须还是原名（round-trip，不再多一个 A_）',
)

const fix19Project = resolveProject(cfg)
const fix19Store = await createLedger(makeCtx().ctx, projectKeyOf(cfg)).ready
const fix19Dir = fix19Project.deliverablesDir
const putFix19Doc = (file, taskId, title, tier = 3) => fix19Store.putDoc(docRecord({
  path: joinUnderRoot(fix19Dir, file), tier, taskId, title, keywords: ['结论'], updatedAt: '2026-10-02T00:00:00.000Z',
}))
// ① 已合规的名字：一轮计划必须一个都不改（幂等，不许空转改名 + 空转改引用）
await putFix19Doc('T-800_A_报告与结论_L3.md', 'T-800_A', '报告与结论')
assert.deepEqual(
  toHost((await planNaming({ project: fix19Project, store: fix19Store })).moves), [],
  'FIX-19：已合规名必须 renamed=0（幂等）',
)
// ② 标题里带空格 → 需要 slug 改名：dryRun 必须能看出「旧名 → 新名」
await putFix19Doc('T-800_A_报告 与结论_L3.md', 'T-800_A', '报告 与结论')
// ③ 重复前置的脏名：剥一次前缀后标题**仍以任务号开头** ⇒ 按 FIX-32 的口径**拦下不改**（不是自愈改名）
await putFix19Doc('T-800_A_T-800_A_报告与结论_L3.md', 'T-800_A', 'T-800_A_报告与结论')
const fix19Plan = await planNaming({ project: fix19Project, store: fix19Store })
assert.equal(fix19Plan.moves.length, 1, `FIX-19：只该改那一篇（空格名），实际 ${JSON.stringify(toHost(fix19Plan.moves.map((m) => m.newPath)))}`)
assert.ok(
  fix19Plan.moves.some((move) => move.newPath.endsWith('T-800_A_报告-与结论_L3.md')),
  'FIX-19：改出来的新名不得重复前置任务号',
)
assert.ok(
  fix19Plan.blocked.some((row) => row.target.endsWith('T-800_A_T-800_A_报告与结论_L3.md')),
  'FIX-32：剥完前缀仍带任务号的脏名必须进 blocked（可追溯，且不改名）',
)
assert.ok(
  fix19Plan.moves.every((move) => !move.newPath.includes('T-800_A_A_')),
  'FIX-19：任何新名都不许出现 `任务号_任务号` 的碎片',
)
// ④ 兜底校验：新名若仍是 taskId_taskId 形态 → 拦下不改，只报告
await putFix19Doc('T-800_A_T-800_A_报告_L2.md', 'T-800_A', 'T-800_A_T-800_A_报告')
const fix19Guard = await planNaming({ project: fix19Project, store: fix19Store })
assert.equal(fix19Guard.blocked.length, 2, 'FIX-19：重复前置的兜底校验必须能真的拦下（不是摆设置不到的守卫）')
assert.ok(fix19Guard.blocked[0].detail.includes('疑似重复前置'), 'FIX-32：拦下时要说明原因')
assert.ok(
  !fix19Guard.moves.some((move) => move.oldPath.endsWith('T-800_A_T-800_A_报告_L2.md')),
  'FIX-19：被拦下的档不得出现在改名计划里',
)
// ⑤ dryRun 输出「旧名 → 新名」映射（与真跑同一份计划）
const fix19Sweep = await librarianSweep({ project: fix19Project, store: fix19Store, config: cfg, dryRun: true })
assert.equal(fix19Sweep.dryRun, true, 'FIX-19：dryRun 必须标明是试算')
assert.equal(fix19Sweep.naming.candidates, fix19Plan.moves.length, 'FIX-19：dryRun 的候选数必须与真跑计划一致')
assert.ok(
  fix19Sweep.naming.files.some((move) => move.oldPath.endsWith('T-800_A_报告 与结论_L3.md') && move.newPath.endsWith('T-800_A_报告-与结论_L3.md')),
  'FIX-19：dryRun 必须给出 旧名 → 新名 映射',
)
assert.equal(fix19Sweep.naming.blocked.length, 2, 'FIX-19：dryRun 里必须能看到被拦下的重复前置')
ok('FIX-19 = FIX-29 改名不重复前置任务号：按已知任务号精确剥离 / 幂等（合规名 renamed=0）/ dryRun 给旧名→新名 / 重复前置被拦下')

// ---------------------------------------------------------------- FIX-32 标题只从「文件名 + 权威 taskId」推（治本）
// 背景：`doc.title` 是**派生缓存**，可能残留旧口径（"第一个下划线"）的脏值 —— 拿它拼新名，
// 就会把**本来合规的档**判成"该改名"（真机上 4 篇 T99 档被一轮轮要求改名）喵。
const fix32Unit = titleFromFileName('T-800_A_报告与结论_L3.md', 'T-800_A')
assert.equal(fix32Unit.title, '报告与结论', 'FIX-32：剥前缀 + 切 `_L3` 后剩下的就是标题')
assert.equal(fix32Unit.suffix, 'L3', 'FIX-32：后缀要被切掉（不是标题的一部分）')
assert.equal(fix32Unit.hadPrefix, true, 'FIX-32：要能判断"文件名带没带权威任务号前缀"')
assert.equal(fix32Unit.doubled, false, 'FIX-32：正常名不判重复前置')
assert.equal(titleFromFileName('T-800_A_T-800_A_报告_L2.md', 'T-800_A').title, 'T-800_A_报告', 'FIX-32：剥一次前缀后仍带任务号 → 标题里看得出来')
assert.equal(titleFromFileName('T-800_A_T-800_A_报告_L2.md', 'T-800_A').doubled, true, 'FIX-32：这就是重复前置')
assert.equal(titleFromFileName('T-800_A_修修补补_fix.md', 'T-800_A').suffix, 'fix', 'FIX-32：`_fix` 后缀同样要切')
assert.equal(titleFromFileName('乱七八糟.md', 'T-800_A').hadPrefix, false, 'FIX-32：没带前缀的文件名要能识别（此时名字里没有标题信息）')

// 验收位（用户给的真机形态）喵：那篇被"任务号拼两遍"污染过的档，跑 dryRun **将改名必须为 0**
const fix32Polluted = 'T99_契约流程冒烟测试_契约流程冒烟测试_T99-冒烟测试审查者通道回报-高度概括_L3.md'
const fix32PollutedPath = joinUnderRoot(fix19Project.deliverablesDir, fix32Polluted)
await writeFile(fix32PollutedPath, renderFrontMatter({
  taskId: 'T99_契约流程冒烟测试', role: 'reviewer', tier: 3, keywords: ['冒烟'], relatedFiles: [], createdAt: '2026-10-02T00:00:00.000Z',
}) + '## 结论\n\n冒烟测试的结论。\n', 'utf8')
// 台账里故意留一条**脏标题**（旧口径"第一个下划线"的产物：taskId 被切成 `T99`、标题吞掉前半段）
// → 计划必须 ①不据此改名 ②把它回写掉（治本）喵
const fix32StaleTitle = '契约流程冒烟测试_契约流程冒烟测试_T99-冒烟测试审查者通道回报-高度概括'
await fix19Store.putDoc(docRecord({
  path: fix32PollutedPath, tier: 3, taskId: 'T99_契约流程冒烟测试',
  title: fix32StaleTitle, keywords: ['冒烟'], updatedAt: '2026-10-02T00:00:00.000Z',
}))
const fix32Plan = await planNaming({ project: fix19Project, store: fix19Store })
assert.equal(
  fix32Plan.moves.some((move) => move.oldPath.endsWith(fix32Polluted)), false,
  'FIX-32（验收）：对已按规范命名的档，dryRun 的"将改名"必须为 0',
)
assert.equal(
  fix32Plan.titles.some((row) => row.path.endsWith(fix32Polluted)), true,
  'FIX-32：台账里的脏标题必须被列为"待回写"（否则下一轮还会被它带偏）',
)
const fix32Synced = await syncDocTitles({ project: fix19Project, store: fix19Store })
assert.ok(fix32Synced.fixed >= 1, 'FIX-32：回写必须真的落进台账')
assert.equal(
  fix19Store.getDoc(fix32PollutedPath).title,
  titleFromFileName(fix32Polluted, 'T99_契约流程冒烟测试').title,
  'FIX-32（治本）：回写后台账标题 = 按文件名重算的标题',
)
assert.deepEqual(
  toHost((await planNaming({ project: fix19Project, store: fix19Store })).titles), [],
  'FIX-32：回写之后不再有"待回写"的脏标题（幂等）',
)
ok('FIX-32 标题只从文件名 + 权威 taskId 推：不读 doc.title / 剥前缀切后缀 / 语义判重复前置 / 脏标题回写台账（治本）/ 规范名 dryRun 将改名为 0')

// ---------------------------------------------------------------- FIX-17【本轮 = 报告 FIX-27】同名成员按 sessionId 建索引
const fix17Project = resolveProject(cfg)
const fix17Store = await createLedger(makeCtx().ctx, projectKeyOf(cfg)).ready
const fix17Name = 'T99-冒烟测试-reviewer'
await fix17Store.putMember(memberRecord({ id: 'sess-aaa', name: fix17Name, role: 'reviewer', mode: 'continuable', layer: 1, status: 'completed' }))
await fix17Store.putMember(memberRecord({ id: 'sess-bbb', name: fix17Name, role: 'reviewer', mode: 'continuable', layer: 1, status: 'running' }))
const fix17Snap = buildPanelSnapshot({
  store: fix17Store, project: fix17Project, audit: { level: 'green', counts: { red: 0, yellow: 0 }, items: [] }, now: 't',
})
assert.deepEqual(
  toHost(Object.keys(fix17Snap.membersById)).sort(), ['sess-aaa', 'sess-bbb'],
  'FIX-17：membersById 必须按 sessionId 各留一条（同名不再互相覆盖）',
)
assert.equal(fix17Snap.membersById['sess-aaa'].name, fix17Name, 'FIX-17：主索引条目仍要带成员名（面板要显示）')
assert.equal(fix17Snap.members[fix17Name].sessionId, 'sess-bbb', 'FIX-17：按名索引只能留一条（后到者覆盖）——这就是串徽章的根因')
// client 侧：优先按 sessionId 取 → 同名两节点各自独立
const fix17Nodes = [
  { sessionId: 'sess-aaa', name: fix17Name, badges: {}, children: [] },
  { sessionId: 'sess-bbb', name: fix17Name, badges: {}, children: [] },
]
view.applyPanelBadges(fix17Nodes, {
  schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
  membersById: { 'sess-aaa': { badges: { docs: 'ok' } }, 'sess-bbb': { badges: { docs: 'missing' } } },
  members: { [fix17Name]: { badges: { docs: 'missing' } } },
})
assert.equal(fix17Nodes[0].badges.docs, 'ok', 'FIX-17：同名成员的徽章必须各自独立（不许串）')
assert.equal(fix17Nodes[1].badges.docs, 'missing', 'FIX-17：同名成员的徽章必须各自独立（第二个）')
assert.equal(fix17Nodes[0].badgeFallback, false, 'FIX-17：按 sessionId 命中时不得标退化')
// 退化路径：只有按名索引（老快照 / 没 id）→ 能用，但必须留痕
const fix17Fallback = [{ sessionId: 'sess-zzz', name: fix17Name, badges: {}, children: [] }]
view.applyPanelBadges(fix17Fallback, { members: { [fix17Name]: { badges: { docs: 'warn' } } } })
assert.equal(fix17Fallback[0].badges.docs, 'warn', 'FIX-17：按名退化仍要能取到徽章（不许直接不显示）')
assert.equal(fix17Fallback[0].badgeFallback, true, 'FIX-17：退化必须留痕（同名会串，用户要能看见）')
assert.ok(clientSource.includes('badgeFallback'), 'FIX-17：退化标记必须在渲染里真的被用到')
assert.ok(clientSource.includes('该节点靠成员名匹配徽章'), 'FIX-17：退化的 tooltip 要写明原因')
ok('FIX-17 = FIX-27 members 按 sessionId 建索引：同名成员徽章不串 / 旧会话 id 不丢 / 按名退化必须留痕')

// ---------------------------------------------------------------- FIX-18【本轮 = 报告 FIX-28】FIX-6 标签接回可检索
// FIX-6 的原意：① 工具名以宿主实际目录为准 ② 委派前做装配期校验、未知名字只警告不硬失败。
// 这两点现在由上面的 FIX-13 块覆盖（fail-open + 平台解析 + 回执渲染 warnings），强度只高不低；
// 但「FIX-6」这个标签此前从套件里消失，"这条是否被覆盖"只能靠人读代码确认 —— 这里显式接回喵。
const fix6Roles = toHost(listRoles(plugin.Config({}), process.platform))
assert.ok(fix6Roles.every((role) => Array.isArray(role.tools) && role.tools.length > 0), 'FIX-6：每个角色都必须声明工具（空白名单 = 子智能体什么也干不了）')
const fix6Declared = ['read', 'definitely_not_a_tool_xyz']
const fix6Filtered = resolveToolFilter({ tools: fix6Declared }, new Set(['read']))
assert.deepEqual(toHost(fix6Filtered.allow), fix6Declared, 'FIX-6：未知工具名**只警告不剔除**（剔除会把通道悄悄废掉，比硬失败更危险）')
assert.deepEqual(toHost(fix6Filtered.missing), ['definitely_not_a_tool_xyz'], 'FIX-6：缺失名要进 warnings，让用户在回执里看得见')
assert.equal(
  fix6Roles.every((role) => !role.tools.includes('bash') || process.platform !== 'win32'),
  true, 'FIX-6：终端工具名必须按平台解析（win32 下不得再下发布名的 bash）',
)
ok('FIX-6 工具名以宿主为准 + 装配期只警告不剔除（由 FIX-13 块覆盖，这里显式接回标签）')

// ---------------------------------------------------------------- FIX-20【本轮】徽章可辨性：符号 + 文案，不单靠颜色
const fix20Symbols = ['ok', 'warn', 'missing', 'unknown'].map((value) => view.BADGE_VIEW[value].symbol)
assert.equal(new Set(fix20Symbols).size, 4, `FIX-20：四类徽章符号必须两两不同（灰度/去色下才分得开），实际 ${fix20Symbols.join('')}`)
assert.ok(fix20Symbols.every((symbol) => typeof symbol === 'string' && symbol.trim().length > 0), 'FIX-20：符号不得为空')
assert.equal(view.BADGE_VIEW.na.symbol, '—', 'FIX-20：不适用仍是 —')
assert.equal(view.badgeText('ok'), '✓ 正常', 'FIX-20：徽章文本必须是「符号 + 中文状态词」')
assert.equal(view.badgeText('warn'), '⚠ 警告')
assert.equal(view.badgeText('missing'), '✗ 缺失')
assert.equal(view.badgeText('unknown'), '? 未知')
assert.equal(view.badgeText('na'), '— 不适用')
// 状态集合：五态都要有可见文本，且 deriveStatus 真的能产出它们
for (const status of ['running', 'idle', 'completed', 'failed', 'released']) {
  assert.ok(view.STATUS_LABELS[status] && /^[一-龥]+$/.test(view.STATUS_LABELS[status]), `FIX-20：状态 ${status} 必须有纯中文标签`)
}
assert.equal(view.deriveStatus({ status: 'failed' }), 'failed', 'FIX-20：宿主给了失败就显示失败（客户端推不出来）')
assert.equal(view.deriveStatus({ status: 'released' }), 'released', 'FIX-20：已释放同理')
assert.equal(view.deriveStatus({ status: 'ERROR' }), 'failed', 'FIX-20：别名表大小写不敏感')
assert.equal(view.deriveStatus({ running: true }), 'running', 'FIX-20：宿主没给状态词时旧近似不变（回归）')
assert.equal(view.deriveStatus({ agentAvailable: true }), 'idle', 'FIX-20：空闲态回归')
assert.equal(view.deriveStatus({ status: '没见过的词', running: true }), 'running', 'FIX-20：不认识的词不许瞎猜，退回旧口径')
// 渲染：徽章名 + 符号必须真的进文本（FIX-28 定型为 `契约✓`；只写符号看不出"哪枚"）喵
assert.equal(view.badgeCell('契约', 'ok'), '契约✓', 'FIX-28：格子里必须是「徽章名 + 符号」')
assert.equal(view.badgeCell('异源', 'na'), '异源—', 'FIX-28：不适用也带徽章名（不得只剩符号）')
assert.equal(view.badgeCell('进度', 'missing'), '进度✗', 'FIX-28：缺失同样是「名 + 符号」')
assert.ok(
  /badgeCell\(item\.key, item\.value(, [^)]+)?\)/.test(clientSource),
  'FIX-28/52：列表与卡片都必须渲染「徽章名 + 符号」（第三参是设置页的"显示文字标签"开关）',
)
assert.ok(clientSource.includes('badgeText(item.value)'), 'FIX-20：tooltip 用完整文案（含状态词）')
assert.equal(/}, item\.key\)/.test(clientSource), false, 'FIX-20：徽章不得再只渲染彩色徽章名（那正是"只能靠颜色分辨"的根因）')
assert.deepEqual(toHost(view.BADGE_KEYS), ['契约', '三档', '进度', '预算', '异源'], 'FIX-28：五枚徽章的固定顺序（列头与图例都按它念）')
assert.ok(clientSource.includes("['ok', 'warn', 'missing', 'unknown', 'na'].map(badgeText)"), 'FIX-20：图例必须给出取值对照（顺序固定，徽章名不进格子后靠它认位）')
assert.equal(view.layoutTopology([{ sessionId: 's', name: 'S', children: [] }]).cardWidth, 240, 'FIX-20：卡片要放得下五枚「符号 + 状态词」，宽度 240')
ok('FIX-20 徽章可辨性：四类符号两两不同（灰度可分）/ 符号+中文状态词进渲染 / 状态集合覆盖五态（failed·released 由宿主状态词提供）')

// ---------------------------------------------------------------- FIX-21【本轮】面板要有审计红黄入口
// ① host 侧：快照必须带**清单**（此前只有计数，面板无从展开）
assert.ok(Array.isArray(snapshotJson.audit.items), 'FIX-21：快照必须带 audit.items 清单')
assert.ok(snapshotJson.audit.items.length >= 1, 'FIX-21：夹具里本就有缺文档的档，清单不该为空')
assert.ok(
  snapshotJson.audit.items.every((item) => item.target && item.detail && item.suggestion),
  'FIX-21：每条必须含 路径 + 原因 + 建议 三件套',
)
assert.equal(
  snapshotJson.audit.items[0].suggestion, SUGGESTIONS[snapshotJson.audit.items[0].check] || '由馆员核实后处理',
  'FIX-21：建议动作必须与 humanReport 同源（SUGGESTIONS），避免两处口径漂移',
)
// ② client 侧：摘要条文案 + 清单行
assert.equal(view.auditSummaryText({ red: 3, yellow: 26 }), '审计：红 3 / 黄 26', 'FIX-21：摘要条要写中文红黄计数')
assert.equal(view.auditSummaryText({ placeholder: true }), AUDIT_PLACEHOLDER_TEXT, 'FIX-91 ②：快照没到要说"尚无结论 + 下一步"（不许写 0 红 0 黄 = 谎报全绿；也不许只说"待接"）')
assert.equal(view.auditSummaryText({ red: 0, yellow: 0 }), '审计：全绿（0 红 / 0 黄）', 'FIX-21：真全绿也要说清楚')
const fix21Lines = view.auditLines({
  items: [{ check: 'missing_doc', level: 'red', target: 'D:\\p\\a.md', detail: '缺 L2', suggestion: '补档' }],
})
assert.equal(fix21Lines.length, 1, 'FIX-21：一条 item 一行')
assert.equal(fix21Lines[0].level, 'red', 'FIX-21：行要带等级（供整行着色）')
assert.ok(
  ['D:\\p\\a.md', '缺 L2', '补档'].every((part) => fix21Lines[0].text.includes(part)),
  `FIX-21：清单行必须含 路径 + 原因 + 建议，实际 ${fix21Lines[0].text}`,
)
// 修订：等级靠**整行着色**表达，不再在行首拼 `[红]/[黄]` 前缀喵
assert.equal(/^\[(红|黄)\]/.test(fix21Lines[0].text), false, 'FIX-21：行首不得再有 [红]/[黄] 前缀（改由颜色表达）')
assert.equal(view.AUDIT_LEVEL_COLORS.red, '#f85149', 'FIX-21：红项整行用红字')
assert.equal(view.AUDIT_LEVEL_COLORS.yellow, '#d29922', 'FIX-21：黄项整行用黄字')
assert.ok(clientSource.includes('AUDIT_LEVEL_COLORS[line.level]'), 'FIX-21：渲染时必须真的按等级取颜色')
assert.ok(String(view.AUDIT_LEVEL_LABELS.red).includes('红'), 'FIX-21：tooltip 里仍留一条可读的等级线索（颜色之外）')
assert.equal(view.auditLines({}).length, 0, 'FIX-21：没有清单不许炸')
assert.equal(view.auditLines(null).length, 0, 'FIX-21：连 audit 都没有也不许炸')
// ③ snapshotFromSessions 必须把清单带出来（否则 UI 有入口没数据）
const fix21Merged = view.snapshotFromSessions(
  [{ sessionId: 'r', running: true, agentAvailable: true, updatedAt: 1 }], {}, 'r',
  {
    // FIX-36 起：这份夹具模拟"**当前版本**写的快照"，所以关键字段要齐（缺任何一个都会被判陈旧）喵
    schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
    pluginVersion: view.CLIENT_PLUGIN_VERSION,
    generatedAt: 't',
    counts: { members: 1, tasks: 0, docs: 0 },
    members: {},
    membersById: {},
    todos: [],
    paths: { todoFile: null },
    audit: { level: 'red', red: 1, yellow: 0, items: [{ check: 'missing_doc', level: 'red', target: 't', detail: 'd', suggestion: 's' }] },
  },
)
assert.equal(fix21Merged.audit.items.length, 1, 'FIX-21：client 快照必须带出 items')
assert.equal(view.auditSummaryText(fix21Merged.audit), '审计：红 1 / 黄 0')
// ④ 渲染入口必须存在，且血缘为空时也在（那正是最需要看审计的时候）
assert.ok(clientSource.includes("'data-testid': 'agent-contract-audit'"), 'FIX-21：审计摘要条必须有渲染入口')
assert.ok(clientSource.includes('auditSummaryText(snapshot'), 'FIX-21：摘要条文案来自快照')
assert.ok(clientSource.includes('auditLines(snapshot'), 'FIX-21：展开清单来自快照 items')
assert.ok(clientSource.includes('renderAuditBar()'), 'FIX-21：摘要条必须真的被渲染')
assert.ok(
  /EMPTY_STATES\.sourceEmpty[\s\S]{0,600}renderAuditBar\(\)/.test(clientSource),
  'FIX-21：血缘为空（数据源为空）时也要能看到审计入口',
)
assert.ok(clientSource.includes('auditOpen'), 'FIX-21：清单展开态要可切换')
ok('FIX-21 审计入口：快照带清单（路径+原因+建议，与 SUGGESTIONS 同源）/ 摘要条写中文红黄计数 / 可展开 / 血缘为空时仍在')

// ---------------------------------------------------------------- FIX-26【critical·一致性】真身唯一 + 派生物分家
// 实测盘面：真身 `仓库/docs/核心数据库.md`（74KB）与派生物 `仓库/docs/研究/核心数据库.md`（20KB）并存，
// 而馆员 changelog 写到了**副本**上、真身反而空白 —— "哪个是真的"当场分不清喵。
const fix26Root = await mkdtemp(join(tmpdir(), 'ac-fix26-'))
const fix26Cfg = plugin.Config({
  project: { name: 'F26', root: fix26Root },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑'],
    docKinds: { 研究: '仓库/docs/研究', 核心数据库: '仓库/docs/核心数据库', 产出档: '仓库/docs/子agent' },
  },
})
const fix26Project = resolveProject(fix26Cfg)
const fix26Research = joinUnderRoot(fix26Project.root, '仓库/docs/研究')
const fix26Home = joinUnderRoot(fix26Project.root, '仓库/docs/核心数据库')
const fix26Truth = joinUnderRoot(fix26Project.root, '仓库/docs/核心数据库.md')   // 迁移前：真身在 docs 根
const fix26Moved = joinUnderRoot(fix26Home, '核心数据库.md')                    // 迁移后：真身进家目录
await mkdir(fix26Research, { recursive: true })
await mkdir(fix26Home, { recursive: true })
// 真身（人工维护；两个子区都在，历史行必须原样保留）
const fix26TruthText = [
  '# 核心数据库', '', '> **真身·长期维护**（唯一权威）：勿删勿推翻，只追加。', '',
  '## 变更日志', '', '### 迁移批次', '- 2026-10-01T00:00:00.000Z 批次 1：22 篇归位', '',
  '### 文档治理记录', '- 2026-10-02T00:00:00.000Z [命名规范化] 旧行', '',
].join('\n')
await writeFile(fix26Truth, fix26TruthText, 'utf8')
// 错位同名档（**无自述头部**）：迁移期只读不写，必须一个字节都不变
const fix26Stray = joinUnderRoot(fix26Research, '核心数据库.md')
const fix26StrayText = '# 核心数据库\n\n这个副本没有自述身份，馆员不许写它。\n'
await writeFile(fix26Stray, fix26StrayText, 'utf8')

// ① 真身唯一：迁移期认 docs 根那份；迁移后（两份都在）以家目录那份为准（单调，不会来回跳）
assert.equal(coreDbDir(fix26Project), fix26Home, 'FIX-26：核心数据库家目录取配置的 docKinds["核心数据库"]')
assert.equal(coreDbPath(fix26Project), fix26Truth, 'FIX-26：迁移期真身在 docs 根（家目录的父目录）')
assert.equal(coreIndexPath(fix26Project), joinUnderRoot(fix26Home, CORE_INDEX_FILE), 'FIX-26：派生态索引落在家目录，且是**独立文件名**')
assert.notEqual(CORE_INDEX_FILE, coreDbPath(fix26Project).slice(-CORE_INDEX_FILE.length), 'FIX-26：派生物文件名不得与真身重名')
// ② changelog 落真身 + ③ 错位档只读不写
const fix26Append = await appendChangelog({
  project: fix26Project, entries: ['[格式直修] 某档：补 keywords'], now: '2026-10-03T00:00:00.000Z',
})
assert.equal(fix26Append.path, fix26Truth, 'FIX-26：changelog 必须写进真身（不是副本）')
assert.equal(await readFile(fix26Stray, 'utf8'), fix26StrayText, 'FIX-26：错位同名档必须只读不写（字节级不变）')
assert.deepEqual(
  toHost(fix26Append.strays.map((s) => [s.path, s.hasOwnIdentity])), [[fix26Stray, false]],
  'FIX-26：错位档要上报，并标出"无自述身份"',
)
const fix26After = await readFile(fix26Truth, 'utf8')
for (const line of fix26TruthText.split('\n')) {
  if (!line.trim() || line.startsWith('###')) continue
  assert.ok(fix26After.includes(line), `FIX-26：真身历史行不得丢（删行必须为 0），缺了 ${line}`)
}
// §9-35：馆员动作记进「文档治理记录」子区，绝不混进「迁移批次」
const fix26GovAt = fix26After.indexOf(`### ${CORE_DB_SECTIONS.governance}`)
assert.ok(fix26After.slice(fix26GovAt).includes('[格式直修] 某档'), 'FIX-26：馆员动作必须落在「文档治理记录」子区')
assert.equal(
  fix26After.slice(0, fix26GovAt).includes('[格式直修] 某档'), false,
  'FIX-26：不得混进「迁移批次」子区（两个子区必须分家）',
)
assert.equal(
  fix26After.includes('## 变更日志') && fix26After.includes(`### ${CORE_DB_SECTIONS.migration}`), true,
  'FIX-26：真身要同时保留两个子区',
)
// 幂等：同一段文本再并一次，只多行不改行
const fix26Twice = appendCoreChangelog(fix26After, ['[格式直修] 某档：补 keywords'], '2026-10-03T01:00:00.000Z')
assert.equal(fix26Twice.split('\n').filter((l) => l.includes('[格式直修] 某档')).length, 2, 'FIX-26：二次追加只多一行')
for (const line of fix26After.split('\n')) {
  if (!line.trim()) continue
  assert.ok(fix26Twice.includes(line), 'FIX-26：二次追加不得丢历史行')
}
// 真身是**人工维护**的：标题写法不受我们摆布 —— 实况那一节叫 `## 九、变更日志（由执行方/馆员追加；历史行不改写）`，
// 只认字面 `## 变更日志` 就会在真身末尾另起一个平行章节，把一本账劈成两半喵
const fix26RealHead = [
  '# 核心数据库 —— Blockdustry 迁移总地图',
  '',
  '## 九、变更日志（由执行方/馆员追加；历史行不改写）',
  '',
  '### 迁移批次',
  '',
  '（尚无记录）',
  '',
  '### 文档治理记录',
  '',
  '- 2026-10-02T16:34:39.321Z [头部复核] 4 篇 T99 档刷 librarianTouchedAt',
  '',
  '## 十、附录',
  '',
  '附录内容不许被日志插入打断',
  '',
].join('\n')
const fix26RealNext = appendCoreChangelog(fix26RealHead, ['[格式直修] a.md：补 keywords'], '2026-10-03T02:00:00.000Z')
assert.equal(
  fix26RealNext.split('\n').filter((line) => line.includes('变更日志')).length, 1,
  'FIX-26：真身已有「变更日志」节时不得另起平行章节（标题要宽容匹配）',
)
assert.ok(fix26RealNext.includes('- 2026-10-02T16:34:39.321Z [头部复核]'), 'FIX-26：历史行原样保留')
assert.ok(
  fix26RealNext.indexOf('[格式直修] a.md') > fix26RealNext.indexOf('### 文档治理记录'),
  'FIX-26：新行必须落在治理子区里',
)
assert.ok(
  fix26RealNext.indexOf('[格式直修] a.md') < fix26RealNext.indexOf('## 十、附录'),
  'FIX-26：新行不得被插到后续章节（附录）里去 —— 子区边界要认得 `##`',
)
assert.ok(fix26RealNext.includes('附录内容不许被日志插入打断'), 'FIX-26：后续章节内容不得被动')
// ①② 派生态索引：独立文件 + 自述身份 + 不碰真身
const fix26Store = await createLedger(makeCtx().ctx, projectKeyOf(fix26Cfg)).ready
const fix26Rebuild = await rebuildCoreDatabase({
  project: fix26Project, store: fix26Store, report: { items: [] }, nowIso: '2026-10-03T00:00:00.000Z',
})
assert.equal(fix26Rebuild.path, joinUnderRoot(fix26Home, CORE_INDEX_FILE), 'FIX-26：索引写进 派生态索引.md，绝不写 核心数据库.md')
assert.equal(fix26Rebuild.corePath, fix26Truth, 'FIX-26：返回值要同时给出真身路径（changelog 落点）')
const fix26IndexText = await readFile(fix26Rebuild.path, 'utf8')
assert.ok(DERIVED_MARKERS.every((marker) => fix26IndexText.includes(marker)), 'FIX-26：派生物头部必须自述「派生物·可重建」')
assert.ok(fix26IndexText.includes(fix26Truth), 'FIX-26：索引要写明真身在哪（免得又有人分不清哪份是真的）')
assert.equal(await readFile(fix26Truth, 'utf8'), fix26After, 'FIX-26：重建索引不得改动真身一个字节')
assert.ok(Array.isArray(fix26Rebuild.strays), 'FIX-26：索引流程也要回带错位档清单（只读不写）')
// 迁移后布局：两份都在时以家目录那份为准
await writeFile(fix26Moved, '# 核心数据库\n\n> **真身·长期维护**。\n', 'utf8')
assert.equal(coreDbPath(fix26Project), fix26Moved, 'FIX-26：已迁移（两份并存）时以家目录那份为真身')
// 验收：**连跑两轮 sweep，docs/研究/ 下不得再出现 核心数据库.md**
const fix26SweepCfg = plugin.Config({
  project: { name: 'F26b', root: await mkdtemp(join(tmpdir(), 'ac-fix26b-')) },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑'],
    docKinds: { 研究: '仓库/docs/研究', 核心数据库: '仓库/docs/核心数据库' },
  },
  audit: { checks: [], archiveAfterDays: 90 },
})
const fix26SweepProject = resolveProject(fix26SweepCfg)
const fix26SweepStore = await createLedger(makeCtx().ctx, projectKeyOf(fix26SweepCfg)).ready
await mkdir(joinUnderRoot(fix26SweepProject.root, '仓库/docs/研究'), { recursive: true })
for (const stamp of ['2026-10-03T00:00:00.000Z', '2026-10-03T01:00:00.000Z']) {
  await librarianSweep({ project: fix26SweepProject, store: fix26SweepStore, config: fix26SweepCfg, stampIso: stamp })
}
assert.equal(
  existsSync(joinUnderRoot(fix26SweepProject.root, '仓库/docs/研究/核心数据库.md')), false,
  'FIX-26：连跑两轮 sweep，docs/研究/ 下不得再出现 核心数据库.md（错位副本的生成源已掐断）',
)
assert.equal(existsSync(coreIndexPath(fix26SweepProject)), true, 'FIX-26：派生态索引照常生成（换个名字落在正确位置）')
assert.equal(await findStrayCoreDbs({ project: fix26SweepProject }).then((rows) => rows.length), 0, 'FIX-26：干净项目不该有错位档')
ok('FIX-26 真身唯一 + 派生物分家：changelog 只写真身（子区分家、删行 0）/ 派生态索引用独立名字并自述身份 / 错位同名档只读不写 / 两轮 sweep 不再生成研究/核心数据库.md')

// ---------------------------------------------------------------- FIX-22【critical·流程】写前备份 + dryRun 三类明细
// 实测损失：一轮授权治理**整篇覆盖**了人工编排的 `仓库/docs/坑/README.md`（34 行 → 20 行），
// 该文件无 git、无备份 → 内容不可恢复喵。
const fix22Root = await mkdtemp(join(tmpdir(), 'ac-fix22-'))
const fix22Cfg = plugin.Config({
  project: { name: 'F22', root: fix22Root },
  paths: {
    tasksDir: '任务',
    progressDir: '[Agent进度]',
    // FIX-69：产出根用两级布局（类型→目录、档级→子目录）喵
    deliverablesDir: '仓库/docs/产出',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑'],
    docKinds: { 研究: '仓库/docs/研究', 坑: '仓库/docs/坑', 产出档: '仓库/docs/子agent' },
  },
})
const fix22Project = resolveProject(fix22Cfg)
const fix22Store = await createLedger(makeCtx().ctx, projectKeyOf(fix22Cfg)).ready
const fix22Pitfall = pitfallIndexPath(fix22Project)
await mkdir(joinUnderRoot(fix22Project.root, '仓库/docs/坑'), { recursive: true })
// 既有的人工 README：这些行**一个字都不许动**（FIX-23 的验收位）
const fix22Human = [
  '# 坑库索引',
  '',
  '## 任务类型 → 读哪个文件',
  '',
  '| 任务类型 | 先读 |',
  '|---|---|',
  '| 贴图应用 | 钻头侧面贴图应用 |',
  '',
  '## 专项坑文档',
  '',
  '- 单位工厂与单位 —— 造单位工厂时的坑',
  '',
  '## 使用规则',
  '',
  '1. 玩家可见文本不带喵字',
  '2. 先查坑库再动手',
  '',
].join('\n')
await writeFile(fix22Pitfall, fix22Human, 'utf8')
const fix22HumanFp = fingerprintText(fix22Human)
assert.equal(fix22HumanFp.length, 12, 'FIX-22：指纹是 sha 前 12 位')
assert.equal(fix22HumanFp, (await import('node:crypto')).createHash('sha256').update(fix22Human, 'utf8').digest('hex').slice(0, 12), 'FIX-22：指纹算法必须是 sha256 前 12')
// 备份落点：<root>/.agent-contract/backups/<时间戳>/<相对路径>（持久区，不是临时区）
const fix22Backup = backupPathOf(fix22Project, fix22Pitfall, '2026-10-03T04:00:00.000Z')
assert.ok(
  fix22Backup.replace(/\\/g, '/').includes(`/.agent-contract/backups/${backupStamp('2026-10-03T04:00:00.000Z')}/仓库/docs/坑/README.md`),
  `FIX-22：备份落点必须在 .agent-contract/backups/<时间戳>/ 下并保持相对路径，实际 ${fix22Backup}`,
)
assert.equal(backupStamp('2026-10-03T04:00:00.000Z').includes(':'), false, 'FIX-22：时间戳目录名必须文件名安全（Windows 不许冒号）')
assert.ok(BACKUP_DIR_REL.startsWith('.agent-contract/'), 'FIX-22：备份必须落在持久区 .agent-contract/（§ EXECUTOR-RULES 2.1）')
// ① 跑一次坑库索引重建 → 备份出现，且**旧指纹与跑前一致**（逐字节）
const fix22Rebuild = await rebuildPitfallIndex({ project: fix22Project, store: fix22Store, nowIso: '2026-10-03T04:00:00.000Z' })
assert.equal(fix22Rebuild.wrote, true, 'FIX-22：既有 README 应被合并更新')
assert.ok(fix22Rebuild.backupPath, 'FIX-22：覆盖前必须产出备份')
assert.equal(await readFile(fix22Rebuild.backupPath, 'utf8'), fix22Human, 'FIX-22：备份内容必须与跑前**逐字一致**')
assert.equal(fingerprintText(await readFile(fix22Rebuild.backupPath, 'utf8')), fix22HumanFp, 'FIX-22：旧指纹与跑前一致')
// ② 备份失败 → **该文件不被改写**（造一个"备份目录名被文件占了"的现场）
const fix22BlockedPath = joinUnderRoot(fix22Project.root, '仓库/docs/坑/有备份冲突.md')
await writeFile(fix22BlockedPath, '原始内容，不许被覆盖\n', 'utf8')
await mkdir(backupDirOf(fix22Project, '2026-10-03T05:00:00.000Z'), { recursive: true })
const fix22BlockedBackup = backupPathOf(fix22Project, fix22BlockedPath, '2026-10-03T05:00:00.000Z')
await mkdir(fix22BlockedBackup, { recursive: true })   // 备份落点是个**目录** → copyFile 必失败
const fix22Blocked = await writeWithBackup({
  project: fix22Project, path: fix22BlockedPath, text: '新内容（不该落盘）', stampIso: '2026-10-03T05:00:00.000Z',
})
assert.equal(fix22Blocked.ok, false, 'FIX-22：备份失败必须返回 ok:false')
assert.ok(String(fix22Blocked.error).length > 0, 'FIX-22：失败要带原因（供回执显示）')
assert.equal(await readFile(fix22BlockedPath, 'utf8'), '原始内容，不许被覆盖\n', 'FIX-22：备份失败时**目标文件必须原样不动**')
// ③ dryRun 三类明细：将覆盖（含旧指纹）/ 将新建 / 将改名
const fix22Plan = await buildWritePlan({ project: fix22Project, store: fix22Store, config: fix22Cfg })
assert.ok(fix22Plan.overwrite.some((row) => row.path === fix22Pitfall), 'FIX-22：预演必须列出"将覆盖：坑库 README"')
assert.ok(fix22Plan.overwrite.every((row) => typeof row.fingerprint === 'string'), 'FIX-22：将覆盖的每条都要带旧指纹')
// FIX-33 起"将新建"项也是对象（带 reason / +N/-M），所以按 `.path` 取喵
assert.ok(fix22Plan.create.some((row) => row.path.includes(CORE_INDEX_FILE)), 'FIX-22：还不存在的文件要归"将新建"')
// 造一个待改名的档 → 预演里出现"将改名"
const fix22Messy = joinUnderRoot(fix22Project.root, '仓库/docs/子agent/T-960_报告 与结论_L3.md')
await mkdir(dirname(fix22Messy), { recursive: true })
await writeFile(fix22Messy, '---\ntaskId: T-960\ntier: 3\n---\n\n## 结论\n\n正文。\n', 'utf8')
await fix22Store.putDoc(docRecord({
  path: fix22Messy, tier: 3, taskId: 'T-960', title: '报告 与结论', keywords: ['结论'], updatedAt: '2026-09-01T00:00:00.000Z',
}))
const fix22Plan2 = await buildWritePlan({ project: fix22Project, store: fix22Store, config: fix22Cfg })
assert.ok(fix22Plan2.rename.length >= 1, 'FIX-22：预演必须列出"将改名"')
const fix22Lines = renderWritePlan(fix22Plan2)
assert.ok(fix22Lines.some((line) => line.startsWith('将改名：')), 'FIX-22：三类明细之一 —— 将改名')
// FIX-33 起每条还带 `+N/-M`（行数差算得出就写，算不出如实说"取决于本轮动作"）喵
assert.ok(
  fix22Lines.some((line) => /^将覆盖：.+（旧指纹 [0-9a-f]{12}，\+\d+\/-\d+）/.test(line)),
  'FIX-22/33：三类明细之二 —— 将覆盖（带旧指纹 + 行数差）',
)
assert.ok(fix22Lines.some((line) => line.startsWith('将新建：')), 'FIX-22：三类明细之三 —— 将新建')
assert.ok(planSummary(fix22Plan2).startsWith('将覆盖 '), 'FIX-22：回执摘要要能一眼看出三类数量')
const fix22SweepDry = await librarianSweep({ project: fix22Project, store: fix22Store, config: fix22Cfg, dryRun: true })
assert.ok(fix22SweepDry.plan && fix22SweepDry.plan.overwrite.length >= 1, 'FIX-22：sweep --dryRun 必须带三类写入明细')
assert.equal(await readFile(fix22Pitfall, 'utf8'), (await readFile(fix22Rebuild.path, 'utf8')), 'FIX-22：dryRun 不得改动任何文件')
ok('FIX-22 写前备份：覆盖前复制到 .agent-contract/backups/<时间戳>/<相对路径> 且旧指纹一致 / 备份失败则该文件不被改写 / dryRun 三类明细')

// ---------------------------------------------------------------- FIX-33 写入预演要带 +N/-M（-M>0 列出被删内容）
const fix33Lines = renderWritePlan({
  rename: [{ from: 'D:\\p\\旧.md', to: 'D:\\p\\新.md' }],
  overwrite: [{
    path: 'D:\\p\\坑\\README.md', fingerprint: 'abcdef123456', reason: '坑库 README 索引合并',
    added: 3, removed: 1, removedLines: ['- 旧条目 A'],
  }],
  create: [{ path: 'D:\\p\\核心数据库\\派生态索引.md', reason: '派生态索引', added: 9, removed: 0, removedLines: [] }],
})
assert.ok(fix33Lines.some((line) => line.includes('+3/-1')), 'FIX-33：将覆盖必须带 `+N/-M`')
assert.ok(fix33Lines.some((line) => line.includes('被删：- 旧条目 A')), 'FIX-33：`-M>0` 时必须**列出被删内容**')
assert.ok(fix33Lines.some((line) => line.includes('+9/-0')), 'FIX-33：将新建同样给行数差')
assert.ok(fix33Lines.some((line) => line.includes('[坑库 README 索引合并]')), 'FIX-33：每条要说清"为什么动它"')
// 行数差**算不出**的项（真身 changelog 追加，条数取决于本轮动作）不许瞎填 `+0/-0` 冒充"没变化"
const fix33Unknown = renderWritePlan({
  rename: [], create: [],
  overwrite: [{ path: 'D:\\p\\核心数据库.md', fingerprint: 'ffeeddccbbaa', reason: '真身 changelog 追加', added: null, removed: null, removedLines: [] }],
}).join('\n')
assert.ok(fix33Unknown.includes('行数差取决于本轮动作'), 'FIX-33：算不出就如实说')
assert.equal(fix33Unknown.includes('+0/-0'), false, 'FIX-33：不得用 +0/-0 冒充"没有变化"')
// 真跑路径：sweep 的预演里，每个覆盖项要么带数字、要么明说未知；索引项的数字取自**同一份 dryRun** 结果
const fix33SweepDry = await librarianSweep({ project: fix22Project, store: fix22Store, config: fix22Cfg, dryRun: true })
for (const row of fix33SweepDry.plan.overwrite) {
  const rendered = renderWritePlan({ rename: [], create: [], overwrite: [row] }).join('\n')
  assert.ok(
    (typeof row.added === 'number' && typeof row.removed === 'number') || rendered.includes('行数差取决于本轮动作'),
    `FIX-33：覆盖项 ${row.path} 必须有行数差或明说未知`,
  )
}
const fix33IndexRow = [...fix33SweepDry.plan.overwrite, ...fix33SweepDry.plan.create]
  .find((row) => String(row.path).includes(CORE_INDEX_FILE))
assert.ok(fix33IndexRow && typeof fix33IndexRow.added === 'number', 'FIX-33：索引项的 +N 必须来自 dryRun 的真实合并结果')
// 预演里的"将覆盖"清单不再包含 sweep 根本不写的文件（术语表归 librarian_glossary，不在本轮）
assert.equal(
  fix33SweepDry.plan.overwrite.some((row) => String(row.path).endsWith('术语表.md')), false,
  'FIX-33：预演只列**本轮真会写**的文件（术语表由 librarian_glossary 写，别虚报）',
)
ok('FIX-33 写入预演带行数差：将覆盖/将新建都带 +N/-M（算不出明说未知，不许 +0/-0）/ -M>0 列出被删内容 / 索引项数字取自同一份 dryRun / 不虚报本轮不写的文件')

// ---------------------------------------------------------------- FIX-23【critical·设计】索引不得整篇重写
// 同一份 README：既有 34 行人工内容在治理后只剩 20 行机器列表（任务类型表 / 使用规则全没了）喵。
const fix23Human = await readFile(fix22Pitfall, 'utf8')
for (const line of fix22Human.split('\n')) {
  if (!line.trim()) continue
  assert.ok(fix23Human.includes(line), `FIX-23：人工段落必须逐字保留，缺了「${line}」`)
}
assert.ok(fix23Human.includes(INDEX_BLOCK_START) && fix23Human.includes(INDEX_BLOCK_END), 'FIX-23：机器内容必须落在**标记区块**里')
assert.equal(fix22Rebuild.removed, 0, 'FIX-23：合并式更新必须**一行不删**（-M 恒为 0）')
assert.ok(fix22Rebuild.added >= 1, 'FIX-23：新增条目要计入 +N')
// 幂等：同一份索引**连跑两遍**，第二遍 changed=0 且文件字节不变
// （先补跑一遍把"本块之前新造的夹具档"吸收进区块，再比第二遍 —— 否则比的是"目录内容变过"）
await rebuildPitfallIndex({ project: fix22Project, store: fix22Store, nowIso: '2026-10-03T04:00:00.000Z' })
const fix23Once = await readFile(fix22Pitfall, 'utf8')
const fix23Again = await rebuildPitfallIndex({ project: fix22Project, store: fix22Store, nowIso: '2026-10-03T04:00:00.000Z' })
assert.equal(fix23Again.changed, false, 'FIX-23：第二遍必须 changed=0（幂等）')
assert.equal(fix23Again.wrote, false, 'FIX-23：内容没变就不该再写一次（免得备份目录被噪声塞满）')
assert.equal(await readFile(fix22Pitfall, 'utf8'), fix23Once, 'FIX-23：第二遍文件字节不变')
// 删行 > 0 时必须能列出被删内容（这是人工审阅的前提）
const fix23Removed = mergeIndexBlock(
  ['# 索引', '', INDEX_BLOCK_START, '- 旧条目 A', INDEX_BLOCK_END, '', '## 使用规则', '- 规则 1', ''].join('\n'),
  ['- 新条目 B'],
)
assert.equal(fix23Removed.removed, 1, 'FIX-23：区块内容变化要如实计入 -M')
assert.ok(fix23Removed.removedLines.includes('- 旧条目 A'), 'FIX-23：-M > 0 时必须列出被删的那一行')
assert.ok(fix23Removed.text.includes('- 规则 1'), 'FIX-23：区块之外的人工行仍原样保留')
assert.deepEqual(toHost(diffStats('a\nb', 'a\nb\nc')), { added: 1, removed: 0, removedLines: [], changed: true }, 'FIX-23：行级 diff 统计（纯函数）')
assert.equal(mergeIndexBlock('', ['- x']).text, `${INDEX_BLOCK_START}\n- x\n${INDEX_BLOCK_END}\n`, 'FIX-23：空文件只写区块')
// 没有标记区块的历史手工档 → **追加**而不是重排
const fix23Legacy = mergeIndexBlock('# 手工标题\n\n人工内容行\n', ['- x'])
assert.ok(fix23Legacy.text.startsWith('# 手工标题\n\n人工内容行'), 'FIX-23：无标记区块时不得重排既有内容（只能往后追加）')
ok('FIX-23 索引增量合并：人工段落逐字保留 / 只动标记区块 / 第二遍幂等 / -M>0 列出被删内容 / 无标记档只追加')

// ---------------------------------------------------------------- FIX-24 同名退化告警要能被发现（卡片/名字 + ⚠ 角标）
const fix24Node = { sessionId: 'ee01e951-aaaa', name: 'T99-x-reviewer', badgeFallback: true }
assert.ok(view.nodeTooltip(fix24Node).includes('ee01e951-aaaa'), 'FIX-24：卡片 tooltip 仍要显示 session id')
assert.ok(view.nodeTooltip(fix24Node).includes('同名成员可能串'), 'FIX-24：退化告警必须挂上卡片/名字的 tooltip（不能只挂徽章）')
assert.ok(view.nodeTooltip(fix24Node).includes('⚠'), 'FIX-24：角标符号要在 tooltip 里也出现')
assert.equal(view.nodeTooltip({ sessionId: 's1' }), 's1', 'FIX-24：没退化的节点 tooltip 保持原样（不加噪音）')
assert.equal(view.fallbackMark(fix24Node), '⚠', 'FIX-24：退化节点要有可见角标（灰度下也认得出）')
assert.equal(view.fallbackMark({ sessionId: 's1' }), '', 'FIX-24：非退化节点不显示角标')
// 用户口径变更：删掉「层/子」两栏后，tooltip 改成数组拼接（仍以 nodeTooltip 打头）—— 同一要求喵
assert.ok(/title: \[nodeTooltip\(node\)/.test(clientSource), 'FIX-24：列表行的 tooltip 必须以 nodeTooltip（id + 退化告警）打头')
assert.ok(clientSource.includes('title: nodeTooltip(card.node)'), 'FIX-24：卡片 tooltip 必须换成 nodeTooltip')
assert.ok(clientSource.includes('fallbackMark(card.node)') && clientSource.includes('fallbackMark(node)'), 'FIX-24：列表与卡片都要渲染角标')
assert.ok(clientSource.includes('styles.warnMark'), 'FIX-24：角标样式要有（不是纯文本拼上去）')
ok('FIX-24 退化告警可发现：卡片/名字 tooltip 带上同名告警 + ⚠ 角标（灰度可辨）')

// ---------------------------------------------------------------- FIX-25 馆员的 tags 步骤 + 建议指向真机制
const fix25Root = await mkdtemp(join(tmpdir(), 'ac-fix25-'))
const fix25Cfg = plugin.Config({
  project: { name: 'F25', root: fix25Root },
  paths: {
    tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent',
    docsDirs: ['仓库/docs/研究'], docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/子agent' },
  },
  // 审计项要开出来，否则 auditScan 一项都不跑，"夹具先报 doc_tags_stale"就无从谈起喵
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const fix25Project = resolveProject(fix25Cfg)
const fix25Store = await createLedger(makeCtx().ctx, projectKeyOf(fix25Cfg)).ready
const fix25Path = joinUnderRoot(fix25Project.deliverablesDir, 'T-950_过期关键词_L3.md')
await mkdir(fix25Project.deliverablesDir, { recursive: true })
await writeFile(fix25Path, [
  '---', 'taskId: T-950', 'role: implementer', 'tier: 3', 'title: 过期关键词',
  'createdAt: 2026-09-01T00:00:00.000Z', 'keywords: ["旧词"]', '---', '',
  '## 结论', '', '契约装配与检索阶梯的联调结论，涉及通道测试。', '',
  '## 依据', '', '见 装配引擎 与 检索阶梯。', '',
].join('\n'), 'utf8')
// 正文比头部新（mtime 晚于 createdAt 超过容差）→ 正是 doc_tags_stale 的判据
await utimes(fix25Path, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-01T00:00:00.000Z'))
await fix25Store.putDoc(docRecord({
  path: fix25Path, tier: 3, taskId: 'T-950', title: '过期关键词', keywords: ['旧词'], updatedAt: '2026-09-01T00:00:00.000Z',
}))
const fix25Before = await auditScan({ store: fix25Store, project: fix25Project, config: fix25Cfg })
assert.ok(fix25Before.items.some((item) => item.check === 'doc_tags_stale'), 'FIX-25：夹具必须先真的报出 doc_tags_stale（否则这条测了个寂寞）')
// 建议必须指向**已有机制**（§9-32）
assert.ok(SUGGESTIONS.doc_tags_stale.includes('librarian_tags'), 'FIX-25：建议文案必须指向 librarian_tags（此前指向了不存在的机制）')
const KNOWN_MECHANISMS = ['librarian_', 'ledger_', 'doc_emit', 'progress_upsert', 'contract_delegate_', 'modelRoutes', '需人工处理']
for (const [check, text] of Object.entries(SUGGESTIONS)) {
  assert.ok(
    KNOWN_MECHANISMS.some((token) => text.includes(token)),
    `FIX-25/§9-32：${check} 的建议必须指向已有机制或明写「需人工处理」，实际「${text}」`,
  )
}
// dryRun 只报不写
// 盖章时刻用真实 now（审计按 `mtime - librarianTouchedAt` 判过期，写死过去时刻会随真实时钟漂红）喵
const fix25Now = new Date().toISOString()
const fix25Dry = await refreshStaleTags({ project: fix25Project, store: fix25Store, dryRun: true, now: fix25Now })
assert.equal(fix25Dry.stale, 1, `FIX-25：dryRun 要报出过期篇数，实际 ${JSON.stringify(toHost(fix25Dry.files))}`)
assert.equal((await readFile(fix25Path, 'utf8')).includes('librarianTouchedAt'), false, 'FIX-25：dryRun 不得落盘')
// 真跑：只增不删 + 盖章
const fix25Run = await refreshStaleTags({ project: fix25Project, store: fix25Store, now: fix25Now })
assert.equal(fix25Run.stamped, 1, 'FIX-25：过期档必须被盖章（§9-33）')
assert.ok(fix25Run.backupPath === undefined || fix25Run.writeFailures.length === 0, 'FIX-25：写失败要进 writeFailures')
const fix25Text = await readFile(fix25Path, 'utf8')
assert.ok(fix25Text.includes('"旧词"') || fix25Text.includes('旧词'), 'FIX-25：既有 keywords **只增不删**')
assert.ok(fix25Text.includes('librarianTouchedAt'), 'FIX-25：必须盖 librarianTouchedAt（不盖章下轮还会报同一篇）')
assert.ok(fix25Text.includes('librarianChanges'), 'FIX-25：必须记 librarianChanges（改了什么要能查）')
assert.ok(fix25Text.includes('复核 keywords'), 'FIX-25：留痕要写明是"复核 keywords"')
// 验收①：跑完 tags → 审计里的 doc_tags_stale 消除
const fix25After = await auditScan({ store: fix25Store, project: fix25Project, config: fix25Cfg })
assert.equal(fix25After.items.some((item) => item.check === 'doc_tags_stale'), false, 'FIX-25：tags 步骤之后该审计项必须消除（这就是它存在的意义）')
// 验收③：第二遍幂等
const fix25Twice = await refreshStaleTags({ project: fix25Project, store: fix25Store, now: new Date().toISOString() })
assert.equal(fix25Twice.stale, 0, 'FIX-25：第二遍必须 stale=0（幂等）')
assert.equal(fix25Twice.stamped, 0, 'FIX-25：第二遍不该再写盘')
// sweep 里也接了 tags 步骤（否则"建议指向 librarian_tags"仍要用户手动跑两次）
const fix25Sweep = await librarianSweep({ project: fix25Project, store: fix25Store, config: fix25Cfg, stampIso: '2026-10-03T08:00:00.000Z' })
assert.ok(fix25Sweep.tags && typeof fix25Sweep.tags.stale === 'number', 'FIX-25：一轮治理必须带 tags 阶段')
ok('FIX-25 tags 步骤：判据与审计同源 / 只增不删 + 盖章（§9-33）/ dryRun 与限量 / 跑完 doc_tags_stale 消除 / 第二遍幂等 / 建议指向真机制')

// ---------------------------------------------------------------- FIX-27 血缘失败时也要有审计入口
// 两条链路彼此独立：血缘挂了 ≠ 快照读不到，而那正是最该看红黄的时候喵。
const fix27SnapText = JSON.stringify({
  schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
  generatedAt: 't', pluginVersion: view.CLIENT_PLUGIN_VERSION, todos: [], paths: { todoFile: null }, membersById: {},
  audit: { level: 'red', red: 3, yellow: 26, items: [{ check: 'missing_doc', level: 'red', target: 'x.md', detail: '缺档', suggestion: '补档' }] },
  members: {}, membersById: {},
})
const fix27Ctx = {
  remote: {
    session: { list: async () => { throw new Error('boom-lineage') } },
    // 宿主 wire 形态是 `{ text }`（不是裸串）喵
    workspaceFiles: { read: async () => ({ text: fix27SnapText }) },
  },
}
const fix27Out = await view.loadPanel(fix27Ctx, { sessionId: 'sess-1', cwd: 'D:\\proj' })
assert.equal(fix27Out.failed, true, 'FIX-27：血缘失败仍然要如实报 failed')
assert.ok(fix27Out.reason.includes('读取会话血缘失败'), 'FIX-27：失败原因仍要指名血缘这一步')
assert.equal(fix27Out.audit.red, 3, 'FIX-27：血缘失败时**仍要**把快照里的审计红黄带出来')
assert.equal(fix27Out.audit.yellow, 26)
assert.equal(view.auditSummaryText(fix27Out.audit), '审计：红 3 / 黄 26', 'FIX-27：failed 分支要能显示真值摘要')
assert.equal(view.auditLines(fix27Out.audit).length, 1, 'FIX-27：清单也要能展开')
// 快照也读不到 → 写"数据源待接"，不写 0 红 0 黄
const fix27Blind = await view.loadPanel({
  remote: { session: { list: async () => { throw new Error('boom') } }, workspaceFiles: { read: async () => ({ text: '' }) } },
}, { sessionId: 'sess-1', cwd: 'D:\\proj' })
assert.equal(fix27Blind.audit.placeholder, true, 'FIX-27：快照也读不到时要标 placeholder')
assert.equal(view.auditSummaryText(fix27Blind.audit), AUDIT_PLACEHOLDER_TEXT, 'FIX-91 ②：读不到就写"尚无结论 + 下一步"，绝不谎报 0 红 0 黄')
assert.equal(view.auditFromPanel(null).placeholder, true, 'FIX-27：没有快照时 audit 一律 placeholder')
assert.ok(
  /EMPTY_STATES\.failed[\s\S]{0,400}renderAuditBar\(\)/.test(clientSource),
  'FIX-27：failed 空态必须真的渲染审计条',
)
ok('FIX-27 failed 分支的审计入口：血缘失败仍带出审计真值 / 快照读不到写"数据源待接" / failed 空态渲染审计条')

// ---------------------------------------------------------------- FIX-28 徽章要能"念出来"（名 + 符号 / 列头常驻 / 底部图例）
// 实测原话：「只能看到一堆正常，但看不到什么正常」——紧凑化把徽章名一起砍了喵。
assert.ok(clientSource.includes('function ListHeader'), 'FIX-28：列表必须有列头组件')
assert.ok(/headRow: \{[\s\S]{0,220}position: 'sticky'/.test(clientSource), 'FIX-28：列头必须 sticky 常驻（滚动时也能对上列）')
assert.equal(view.badgeCell('契约', 'warn'), '契约⚠', 'FIX-28：每枚徽章带极短标签（1~2 字）+ 符号，宽度不变')
assert.ok(
  /BADGE_KEYS\.join\('\/'\)/.test(clientSource),
  'FIX-28：列头要把五枚徽章的名字按顺序写出来（格子太窄，写在列头一次说清）',
)
// FIX-43（用户口径）：那一行**常驻**的符号说明已从版面撤掉，五态对照改由**可折叠的「徽章说明」**承载喵
// （徽章格子里仍是 `契约✓`，所以"哪枚是哪个"依旧不看 tooltip 就能念出来 —— 能力不减，只是不再占版面）喵
assert.equal(clientSource.includes("'徽章符号：'"), false, 'FIX-45：面板上不再有常驻的「徽章符号」行')
const fix28Legend = ['ok', 'warn', 'missing', 'unknown', 'na'].map((value) => view.badgeText(value))
assert.deepEqual(
  toHost(fix28Legend), ['✓ 正常', '⚠ 警告', '✗ 缺失', '? 未知', '— 不适用'],
  'FIX-28：图例要给出五种状态的「符号 + 中文名」',
)
assert.ok(
  clientSource.includes("['ok', 'warn', 'missing', 'unknown', 'na'].map(badgeText).join(' / ')"),
  'FIX-28：五态「符号 + 中文名」对照仍必须在（折叠在「徽章说明」里）',
)
// 验收口径：**不看 tooltip** 也能说出"哪枚是哪个、什么状态"——
// 徽章名在格子里 ✓、状态靠符号 + 常驻图例 ✓
for (const [key, value] of [['契约', 'ok'], ['三档', 'missing'], ['异源', 'na']]) {
  const cell = view.badgeCell(key, value)
  assert.ok(cell.startsWith(key), `FIX-28：${key} 的格子必须以徽章名开头，实际 ${cell}`)
  assert.ok(cell.length > key.length, `FIX-28：${key} 的格子必须带符号，实际 ${cell}`)
}
ok('FIX-28 徽章可念：每枚带极短标签 + 符号 / 列头 sticky 常驻并列出五枚顺序 / 底部常驻五态符号图例')

// ---------------------------------------------------------------- FIX-29 列表下方空白区 → 待做任务列表
// ① host：快照新增 todos[]（未结任务 / 审计红黄 / 缺失产出，带 path）+ paths.todoFile 喵
const fix29Root = await mkdtemp(join(tmpdir(), 'ac-fix29-'))
const fix29Cfg = plugin.Config({
  project: { name: 'F29', root: fix29Root },
  paths: {
    tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent',
    docsDirs: ['仓库/docs/研究'], docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/子agent' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const fix29Project = resolveProject(fix29Cfg)
assert.equal(fix29Project.panel.todoFile, joinUnderRoot(fix29Project.root, '待办.md'), 'FIX-29：待办原文默认 `<项目根>/待办.md`')
assert.equal(
  resolveProject(plugin.Config({ project: { root: fix29Root }, panel: { todoFile: '待办/清单.md' } })).panel.todoFile,
  joinUnderRoot(fix29Root.replace(/\\/g, '\\'), '待办/清单.md'),
  'FIX-29：`panel.todoFile` 可配（相对项目根解析）',
)
const fix29Store = await createLedger(makeCtx().ctx, projectKeyOf(fix29Cfg)).ready
await mkdir(fix29Project.deliverablesDir, { recursive: true })
await fix29Store.putTask(taskRecord({ taskId: 'T-971', status: 'running', deliverable: '三档档' }))
await fix29Store.putTask(taskRecord({ taskId: 'T-972', status: 'done' }))
await fix29Store.putMember(memberRecord({ id: 'sess-f29', name: 'T-971-impl', role: 'implementer', mode: 'continuable', layer: 1, status: 'running' }))
// 已结算但没产档的成员 → 审计会报 missing_doc（待办清单里的"缺失产出"来源）喵
await fix29Store.putMember(memberRecord({ id: 'sess-f29b', name: 'T-973-rev', role: 'reviewer', mode: 'continuable', layer: 1, status: 'completed' }))
const fix29Audit = await auditScan({ store: fix29Store, project: fix29Project, config: fix29Cfg })
const fix29Snap = buildPanelSnapshot({ store: fix29Store, project: fix29Project, audit: fix29Audit, now: 't' })
assert.equal(fix29Snap.paths.todoFile, joinUnderRoot(fix29Project.root, '待办.md'), 'FIX-29：快照必须带上待办原文的**绝对路径**（client 拿不到项目根）')
assert.ok(Array.isArray(fix29Snap.todos) && fix29Snap.todos.length >= 1, 'FIX-29：快照必须带派生态待办清单')
const fix29Task = fix29Snap.todos.find((row) => row.kind === 'task')
assert.ok(fix29Task && fix29Task.title.includes('T-971'), 'FIX-29：未结任务要进清单')
assert.ok(fix29Task.path.endsWith('T-971.md'), 'FIX-29：每条都要带 path 可定位')
assert.equal(fix29Snap.todos.some((row) => row.title.includes('T-972')), false, 'FIX-29：已结任务不该进待办')
assert.ok(fix29Snap.todos.some((row) => row.kind === 'missing_doc'), 'FIX-29：缺失产出要进清单（与审计同源）')
const fix29Rank = fix29Snap.todos.findIndex((row) => row.level === 'red')
const fix29Yellow = fix29Snap.todos.findIndex((row) => row.level !== 'red')
assert.ok(fix29Rank === -1 || fix29Rank < fix29Yellow, 'FIX-29：红的必须排在黄的前面')
// ② client：md 子集渲染（零依赖）+ 截断 + 只读
const fix29Md = [
  '# 待办',
  '',
  '- [ ] 补 T-971 的三档档',
  '- [x] 已完成的事',
  '- 普通条目，含 **粗体**、`代码` 与 [链接](https://example.com/a(b)c)',
  '',
  '## 第二节',
  '',
  '正文一行',
].join('\n')
const fix29Blocks = view.parseMdSubset(fix29Md)
const fix29Types = fix29Blocks.map((block) => block.type)
assert.ok(fix29Types.includes('heading') && fix29Types.includes('check') && fix29Types.includes('item'), 'FIX-29：标题 / 复选框 / 列表都要认得')
assert.equal(fix29Blocks.find((block) => block.type === 'check').checked, false, 'FIX-29：`- [ ]` 是未勾选')
assert.equal(fix29Blocks.filter((block) => block.type === 'check')[1].checked, true, 'FIX-29：`- [x]` 是已勾选')
assert.equal(fix29Blocks.find((block) => block.type === 'heading').level, 1, 'FIX-29：标题级别要认出来')
const fix29Inline = fix29Blocks.find((block) => block.type === 'item').segments
assert.ok(fix29Inline.some((segment) => segment.type === 'bold' && segment.text === '粗体'), 'FIX-29：行内粗体')
assert.ok(fix29Inline.some((segment) => segment.type === 'code' && segment.text === '代码'), 'FIX-29：行内代码')
assert.ok(fix29Inline.some((segment) => segment.type === 'link' && segment.text === '链接'), 'FIX-29：链接要解析出文字与地址')
assert.equal(view.parseMdSubset('').length, 1, 'FIX-29：空串只有一个空块（不炸）')
assert.equal(view.parseMdSubset('a **未闭合').length, 1, 'FIX-29：未闭合的 `**` 不许吞内容')
// 截断：默认前 80 行 + 可展开
const fix29Long = Array.from({ length: 100 }, (_, index) => `- 第 ${index + 1} 行`).join('\n')
const fix29Cut = view.truncateLines(fix29Long, view.TODO_PREVIEW_LINES, false)
assert.equal(fix29Cut.truncated, true, 'FIX-29：超长要截断（默认前 ~80 行）')
assert.equal(fix29Cut.shown, view.TODO_PREVIEW_LINES, 'FIX-29：默认显示前 80 行')
assert.equal(fix29Cut.total, 100, 'FIX-29：要报总行数（供"展开全部"提示）')
assert.equal(fix29Cut.text.split('\n').length, view.TODO_PREVIEW_LINES, 'FIX-29：截断后的文本行数要匹配')
assert.equal(view.truncateLines(fix29Long, view.TODO_PREVIEW_LINES, true).truncated, false, 'FIX-29：展开后不再截断')
assert.equal(view.truncateLines('a\nb', view.TODO_PREVIEW_LINES, false).truncated, false, 'FIX-29：短文本不标截断')
// 只读：读一次待办原文，文件字节必须不变
const fix29TodoPath = fix29Project.panel.todoFile
await writeFile(fix29TodoPath, fix29Md, 'utf8')
const fix29TodoFp = fingerprintText(await readFile(fix29TodoPath, 'utf8'))
const fix29ReadCtx = { remote: { workspaceFiles: { read: async (_scope, path) => ({ text: await readFile(path, 'utf8') }) } } }
const fix29Loaded = await view.loadTodoFile(fix29ReadCtx, 'sess-1', fix29TodoPath)
assert.equal(fix29Loaded.text, fix29Md, 'FIX-29：能读回待办原文')
assert.equal(fingerprintText(await readFile(fix29TodoPath, 'utf8')), fix29TodoFp, 'FIX-29：读待办**只读**（跑前后字节不变）')
assert.equal((await view.loadTodoFile(fix29ReadCtx, 'sess-1', joinUnderRoot(fix29Root, '不存在的待办.md'))).text, null, 'FIX-29：读不到要给 null')
assert.ok(
  (await view.loadTodoFile({ remote: {} }, 'sess-1', fix29TodoPath)).reason.includes('workspaceFiles'),
  'FIX-29：remote 不可用要给**原因**（不粗化成"没有待办"）',
)
assert.ok((await view.loadTodoFile(fix29ReadCtx, 'sess-1', null)).reason.includes('todoFile'), 'FIX-29：没给路径也要说清原因')
// ③ 渲染入口：**FIX-40 起拆成两块** —— A 区给人看的大方向待办、B 区机器算的执行队列喵
assert.ok(clientSource.includes("'data-testid': 'agent-contract-human-todo'"), 'FIX-40：A 区（大方向待办）必须有渲染入口')
assert.ok(clientSource.includes("'data-testid': 'agent-contract-agent-queue'"), 'FIX-40：B 区（agent 执行队列）必须有渲染入口')
assert.ok(
  clientSource.includes('renderHumanTodo(),\n        renderAgentQueue(),') || (clientSource.includes('renderHumanTodo()') && clientSource.includes('renderAgentQueue()')),
  'FIX-40：两块都要真的被渲染（列表/拓扑下方）',
)
assert.ok(clientSource.includes("'（无待办）'"), 'FIX-29：A 区空内容要显示「（无待办）」而不是留白')
assert.ok(clientSource.includes('展开全部（共 '), 'FIX-29：超长要有"展开全部"入口')
assert.ok(clientSource.includes('todoOpen') && clientSource.includes('queueOpen'), 'FIX-40：两块各自可折叠（折叠位互不干扰）')
assert.ok(clientSource.includes('loadTodoFile(props.remoteCtx'), 'FIX-29：读待办也要用**注入后的** ctx（FIX-16 口径）')
ok('FIX-29 待办数据源：快照带 todos[]（未结/红黄/缺失产出，带 path，红在前）+ paths.todoFile / md 子集零依赖渲染 / 截断 80 行可展开（FIX-40 起落在 A 区）')

// ---------------------------------------------------------------- FIX-31 待办/审计**点行跳会话**
// 口径：能定位到成员的行才带 `sessionId`（解不出来就别装"可点"），点击复用卡片那条跳转链路喵。
const fix31Member = fix29Snap.todos.find((row) => row.kind === 'missing_doc')
assert.ok(fix31Member, 'FIX-31：夹具里应有 missing_doc 行')
assert.equal(fix31Member.sessionId, 'sess-f29b', 'FIX-31：missing_doc 的 target 是成员名 → 必须解出该成员的会话 id')
assert.equal(
  fix29Snap.audit.items.find((item) => item.check === 'missing_doc').sessionId, 'sess-f29b',
  'FIX-31：审计清单里的行同样要带会话 id（面板上那两处都能点）',
)
// 解不出来的行不许带 id（否则点了会跳到错的地方）
await fix29Store.putTask(taskRecord({ taskId: 'T-974', status: 'running' }))
const fix31Snap = buildPanelSnapshot({ store: fix29Store, project: fix29Project, audit: fix29Audit, now: 't' })
const fix31Orphan = fix31Snap.todos.find((row) => row.kind === 'task' && row.title.includes('T-974'))
assert.ok(fix31Orphan, 'FIX-31：新任务要进清单')
assert.equal(fix31Orphan.sessionId, null, 'FIX-31：没有 owner/成员可解 → sessionId 必须是 null（不装可点）')
// client：行的 sessionId 要能透出来，并且**真的**接上了跳转
const fix31Lines = view.auditLines({ items: [{ check: 'missing_doc', level: 'red', target: 'T-973-rev', detail: 'd', suggestion: 's', sessionId: 'sess-9' }] })
assert.equal(fix31Lines[0].sessionId, 'sess-9', 'FIX-31：审计行要透出 sessionId')
assert.equal(view.auditLines({ items: [{ check: 'ghost_run', level: 'yellow', target: 'x', detail: 'd' }] })[0].sessionId, null, 'FIX-31：没有 id 的行是 null')
assert.ok(/onClick: line\.sessionId \? \(\) => handleJump\(line\.sessionId\)/.test(clientSource), 'FIX-31：审计行必须接上跳转')
assert.ok(/onClick: item\.sessionId \? \(\) => handleJump\(String\(item\.sessionId\)\)/.test(clientSource), 'FIX-31：待办行必须接上跳转')
assert.ok(clientSource.includes('点击跳转到该 Agent 的会话'), 'FIX-31：可点的行要有 tooltip 说明（免得用户瞎点）')
assert.ok(
  /style: \{ \.\.\.styles\.todoItem, \.\.\.\(item\.sessionId \? \{ cursor: 'pointer'/.test(clientSource),
  'FIX-31：只有带 id 的待办行才给手型光标',
)
ok('FIX-31 点行跳会话：待办行与审计行都带 sessionId（解不出则 null）/ 只有可解的行才可点 / 复用卡片那条跳转链路')

// ---------------------------------------------------------------- FIX-30 产出工具的"覆盖"要可见
// 裁决：doc_emit / bugfix_note **接备份**（目标不存在时跳过备份）+ 返回 `overwrote`；
// progress_upsert **豁免**（活态单写者文件，历史由会话记录承载），但要在文档里写明理由喵。
const fix30Root = await mkdtemp(join(tmpdir(), 'ac-fix30-'))
const fix30Cfg = plugin.Config({
  project: { name: 'F30', root: fix30Root },
  paths: {
    tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent', docsDirs: ['仓库/docs/研究'],
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
plugin.apply(makeCtx().ctx, fix30Cfg)
const fix30Agent = { id: 'agent-f30', session: { header: {} } }
const fix30Exec = { agent: fix30Agent, signal: undefined }
/** 递归数备份目录里的文件数（用来断言"没产生无谓副本"）喵。 */
const countBackups = async (dir) => {
  let total = 0
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countBackups(join(dir, entry.name))
    else total += 1
  }
  return total
}
const fix30BackupRoot = joinUnderRoot(fix30Root, '.agent-contract/backups')
// ① 首次写入：**不产生备份**（连备份目录都不该建）
const fix30First = await toolOf('doc_emit').execute({
  level: 3, taskId: 'T-980', title: '覆盖演练', role: 'implementer', body: '## 结论\n\n第一版。\n',
}, fix30Exec)
assert.equal(fix30First.overwrote, false, 'FIX-30：首次写入不是覆盖')
assert.equal(fix30First.backupPath, null, 'FIX-30：首次写入不产生备份（避免无谓副本）')
assert.equal(await countBackups(fix30BackupRoot), 0, 'FIX-30：首次写入连备份目录都不该有文件')
const fix30FirstText = await readFile(fix30First.path, 'utf8')
const fix30FirstFp = fingerprintText(fix30FirstText)
// ② 同名重发：备份出现、指纹一致、`overwrote: true`
const fix30Second = await toolOf('doc_emit').execute({
  level: 3, taskId: 'T-980', title: '覆盖演练', role: 'implementer', body: '## 结论\n\n第二版，内容变了。\n',
}, fix30Exec)
assert.equal(fix30Second.path, fix30First.path, 'FIX-30：同名重发落在同一路径（这正是"覆盖"的定义）')
assert.equal(fix30Second.overwrote, true, 'FIX-30：同名重发必须报 `overwrote: true`（覆盖要可见）')
assert.ok(fix30Second.backupPath, 'FIX-30：覆盖必须产出旧版备份路径')
assert.equal(await readFile(fix30Second.backupPath, 'utf8'), fix30FirstText, 'FIX-30：备份内容必须 = 被覆盖的旧版（逐字）')
assert.equal(fingerprintText(await readFile(fix30Second.backupPath, 'utf8')), fix30FirstFp, 'FIX-30：旧指纹与跑前一致')
assert.equal(fix30Second.overwriteCount, 1, 'FIX-30：覆盖次数要记进台账（观察项 doc_overwritten 读它）')
assert.ok(
  fix30Second.warnings.some((text) => text.includes('已覆盖同名旧版')),
  'FIX-30：覆盖要进 warnings —— 主代理得看得见"这版换掉了旧版"',
)
assert.equal(await countBackups(fix30BackupRoot), 1, 'FIX-30：第二次写入才产生 1 份备份')
// ③ bugfix_note 同理（首次不备份 / 重发备份 + overwrote）
const fix30Fix1 = await toolOf('bugfix_note').execute({
  taskId: 'T-980', title: '修个洞', cause: 'a', fix: 'b',
}, fix30Exec)
assert.equal(fix30Fix1.overwrote, false, 'FIX-30：bugfix_note 首次写入不覆盖')
assert.equal(fix30Fix1.backupPath, null, 'FIX-30：bugfix_note 首次写入不产生备份')
const fix30Fix1Text = await readFile(fix30Fix1.path, 'utf8')
const fix30Fix2 = await toolOf('bugfix_note').execute({
  taskId: 'T-980', title: '修个洞', cause: 'a2', fix: 'b2',
}, fix30Exec)
assert.equal(fix30Fix2.overwrote, true, 'FIX-30：bugfix_note 同名重发要报 overwrote')
assert.equal(await readFile(fix30Fix2.backupPath, 'utf8'), fix30Fix1Text, 'FIX-30：bugfix_note 的旧版也要留在备份里')
// ④ progress_upsert **豁免**：高频更新不产生任何备份
const fix30BackupsBefore = await countBackups(fix30BackupRoot)
for (let i = 0; i < 3; i += 1) {
  await toolOf('progress_upsert').execute({ taskId: 'T-980', body: `进度第 ${i + 1} 版` }, fix30Exec)
}
assert.equal(await countBackups(fix30BackupRoot), fix30BackupsBefore, 'FIX-30：进度档高频更新**不得**产生备份（豁免）')
assert.equal(
  await readFile(joinUnderRoot(fix30Root, '[Agent进度]/T-980.md'), 'utf8'), '进度第 3 版',
  'FIX-30：豁免备份不等于豁免写入（进度照常落盘）',
)
// ⑤ 豁免理由必须写在**文档与代码注释**里（否则后人会以为是"漏接"）
// DESIGN.md 不在套件的临时副本里 → 只能借 patch 路径拿到源码目录（与 FIX-5 块同一手法）喵
const fix30PatchArg = process.argv[2]
if (!fix30PatchArg) {
  console.log('skip FIX-30 文档检查（未传 patch 路径，拿不到 DESIGN.md）')
} else {
  const fix30Design = await readFile(join(dirname(fix30PatchArg), 'DESIGN.md'), 'utf8')
  assert.ok(
    /§9-26[\s\S]{0,1200}progress_upsert/.test(fix30Design) || /progress_upsert[\s\S]{0,1200}豁免/.test(fix30Design),
    'FIX-30：DESIGN 必须写明 progress_upsert 的豁免理由',
  )
}
const fix30ToolsSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
assert.ok(/progress_upsert[\s\S]{0,900}豁免/.test(fix30ToolsSrc), 'FIX-30：代码注释里也要写明豁免理由')
// ⑥ 观察项 doc_overwritten：**仅记录不告警**（info，不计入红黄）
const fix30Ctx = makeCtx()
plugin.apply(fix30Ctx.ctx, fix30Cfg)
await toolOf('doc_emit').execute({
  level: 3, taskId: 'T-981', title: '观察项演练', role: 'implementer', body: '## 结论\n\n一版。\n',
}, fix30Exec)
await toolOf('doc_emit').execute({
  level: 3, taskId: 'T-981', title: '观察项演练', role: 'implementer', body: '## 结论\n\n二版。\n',
}, fix30Exec)
const fix30StoreDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) {
  fix30StoreDomains[key] = fix30Ctx.ctx.storageDomain.opened.get(spec.name)
}
// 直接复用 apply 里已开的领域（**不二次 open** —— 真后端对领域名是全局单开，重开即报错，桩也照此复刻）喵
const fix30Store = createStore(fix30StoreDomains, projectKeyOf(fix30Cfg))
const fix30Audit = await auditScan({ store: fix30Store, project: resolveProject(fix30Cfg), config: fix30Cfg })
const fix30Observed = fix30Audit.items.filter((item) => item.check === 'doc_overwritten')
assert.ok(fix30Observed.length >= 1, 'FIX-30：覆盖过的档必须出现在观察项里')
assert.equal(fix30Observed[0].level, 'info', 'FIX-30：观察项 level 必须是 info（不是黄、更不是红）')
assert.ok(fix30Observed[0].detail.includes('覆盖过'), 'FIX-30：观察项要写清覆盖次数')
assert.equal(fix30Audit.counts.byCheck.doc_overwritten, undefined, 'FIX-30：观察项**不得**计入红黄统计')
assert.equal(CHECK_IDS.includes('doc_overwritten'), false, 'FIX-30：观察项不得混进 audit.checks 开关（12 项仍是 12 项）')
assert.deepEqual(toHost(OBSERVATION_IDS), ['doc_overwritten', 'cross_vendor_undecidable', 'task_card_incomplete'], 'FIX-30：观察项 id 单独列一张表（FIX-59 起多了 cross_vendor_undecidable、FIX-64 起多了 task_card_incomplete）')
assert.equal(OBSERVATION_LEVEL, 'info', 'FIX-30：观察项的等级常量')
assert.ok(fix30Audit.humanReport.includes('观察（仅记录，不告警）'), 'FIX-30：人话报告要把观察项单独一段（别让人以为要处理）')
ok('FIX-30 产出工具覆盖可见：doc_emit/bugfix_note 接备份（首次不备份、重发带 overwrote+旧版备份且指纹一致）/ progress_upsert 豁免（高频更新零备份，理由进文档与注释）/ 观察项 doc_overwritten 仅记录不告警')

// ---------------------------------------------------------------- FIX-34【阻断】工具回执必须是 lossless JSON
// 实测：`librarian_sweep` 真跑两轮都报 `value is not lossless JSON` —— 写盘明明成功，**调用方却拿不到回执**喵。
// 根因：`error: written.error` 在成功路径上是 `undefined`（键在、值 JSON 表示不了）喵。
/**
 * 递归检查一个值是否是**无损 JSON**喵：`undefined` / 函数 / 非有限数 / Map·Set 都会让宿主整条拒收喵。
 */
function assertJsonSafe(value, path = 'result') {
  if (value === undefined) assert.fail(`${path} 是 undefined —— 宿主会以"非无损 JSON"整条拒收回执（FIX-34）`)
  if (typeof value === 'function') assert.fail(`${path} 是函数，JSON 表示不了`)
  if (typeof value === 'number' && !Number.isFinite(value)) assert.fail(`${path} 不是有限数字`)
  if (value === null || typeof value !== 'object') return
  if (value instanceof Map || value instanceof Set) assert.fail(`${path} 是 Map/Set，JSON 表示不了`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`))
    return
  }
  for (const [key, item] of Object.entries(value)) assertJsonSafe(item, `${path}.${key}`)
}
// `writeOutcome()` 的语义：成功给 null，失败给**字符串**（永远不是 undefined）喵
assert.deepEqual(
  toHost(writeOutcome({ ok: true, action: 'create', backupPath: null, fingerprint: null })),
  { ok: true, action: 'create', backupPath: null, fingerprint: null, error: null },
  'FIX-34：成功路径 error 必须是 null（不是 undefined）',
)
assert.equal(writeOutcome({ ok: false, error: '备份失败：EEXIST' }).error, '备份失败：EEXIST', 'FIX-34：失败路径给字符串')
assert.equal(writeOutcome(undefined).ok, false, 'FIX-34：连结果都没有时也要给安全值')
// 真跑一遍工具，逐个字段查无损（这是那条"整条拒收"的直接防线）喵
const fix34SweepDry = await toolOf('librarian_sweep').execute({ dryRun: true })
assertJsonSafe(fix34SweepDry, 'librarian_sweep(dryRun)')
const fix34Sweep = await toolOf('librarian_sweep').execute({})
assertJsonSafe(fix34Sweep, 'librarian_sweep')
const fix34ToolArgs = {
  librarian_patrol: {},
  librarian_tags: {},
  ledger_rebuild: {},
  audit_scan: {},
  contract_status: {},
  doc_search: { query: '结论' },
  // 术语表要非空 entries；这条同时走一遍 mergeGlossary 的 writeOutcome 路径喵
  librarian_glossary: { entries: [{ term: '喵语', synonyms: ['meow'] }] },
}
for (const [name, args] of Object.entries(fix34ToolArgs)) {
  const out = await toolOf(name).execute(args)
  assertJsonSafe(out, name)
}
// 明确盯住出事的四个字段（回归位：键必须在、值必须是 null/字符串）
const fix34Core = fix34Sweep.result.core
const fix34Pitfall = fix34Sweep.result.pitfall
for (const [label, row] of [['core', fix34Core], ['pitfall', fix34Pitfall]]) {
  assert.ok(row && Object.prototype.hasOwnProperty.call(row, 'error'), `FIX-34：${label} 回执必须带 error 键`)
  assert.equal(row.error, null, `FIX-34：${label} 成功路径的 error 必须是 null`)
  assertJsonSafe(row, `sweep.${label}`)
}
assert.equal(fix34Sweep.result.tags.changelog === undefined, false, 'FIX-34：tags 回执的 changelog 不得是 undefined（试算路径给 null）')
// 往返不丢字段：`{a: undefined}` 经 JSON 往返会**整键消失**，deepEqual 能抓出来喵
assert.deepEqual(
  JSON.parse(JSON.stringify(fix34Sweep)), toHost(fix34Sweep),
  'FIX-34：JSON 往返后字段一个都不能丢',
)
assert.equal(
  JSON.stringify({ error: undefined }), '{}',
  'FIX-34（机制说明）：`undefined` 的键在 JSON 里会直接消失 —— 这就是"无损"检查的意义',
)
// 负控：这个检查器必须能抓住**原来那个 bug 的形状**（`error: written.error` 在成功路径上是 undefined）喵
assert.throws(
  () => assertJsonSafe({ core: { error: undefined } }, 'sweep'),
  /非无损 JSON/,
  'FIX-34（负控）：检查器必须能抓出 `error: undefined` —— 否则这条回归位形同虚设',
)
ok('FIX-34 回执 lossless JSON：writeOutcome 保证 error 是 null/字符串 / 递归查 undefined 与 Map·Set / 真跑 9 个工具逐个过 / JSON 往返不丢字段')

// ---------------------------------------------------------------- FIX-35【噪声】派生态索引字节级幂等
// 现象：内容没变、只因「最后更新」时间戳变就整文件重写 → 每轮多 2 个备份 + `坑/README.md` 长期挂 git M 喵。
const fix35Root = await mkdtemp(join(tmpdir(), 'ac-fix35-'))
const fix35Cfg = plugin.Config({
  project: { name: 'F35', root: fix35Root },
  paths: {
    tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: '仓库/docs/子agent',
    docsDirs: ['仓库/docs/研究', '仓库/docs/坑'],
    docKinds: { 研究: '仓库/docs/研究', 坑: '仓库/docs/坑', 产出档: '仓库/docs/子agent' },
  },
  audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
})
const fix35Project = resolveProject(fix35Cfg)
const fix35Store = await createLedger(makeCtx().ctx, projectKeyOf(fix35Cfg)).ready
await mkdir(joinUnderRoot(fix35Root, '仓库/docs/坑'), { recursive: true })
await writeFile(joinUnderRoot(fix35Root, '仓库/docs/坑/某坑.md'), '# 某坑\n\n正文\n', 'utf8')
const fix35BackupRoot = joinUnderRoot(fix35Root, '.agent-contract/backups')
// ① 首次：内容从无到有 → 写，并把时间戳写进去
const fix35First = await rebuildPitfallIndex({ project: fix35Project, store: fix35Store, nowIso: '2026-10-03T01:00:00.000Z' })
assert.equal(fix35First.wrote, true, 'FIX-35：首次要写')
const fix35Bytes = await readFile(fix35First.path, 'utf8')
assert.ok(fix35Bytes.includes('2026-10-03T01:00'), 'FIX-35：首次写入带上时间戳')
// ② 第二轮：**时间戳变了**（模拟下一次 sweep）但内容没变 → 必须判为未变、不落盘、字节不变
const fix35Second = await rebuildPitfallIndex({ project: fix35Project, store: fix35Store, nowIso: '2026-10-03T09:00:00.000Z' })
assert.equal(fix35Second.changed, false, 'FIX-35：只有时间戳变 ⇒ 内容指纹判定为"没变"')
assert.equal(fix35Second.wrote, false, 'FIX-35：没变就不落盘')
assert.equal(await readFile(fix35First.path, 'utf8'), fix35Bytes, 'FIX-35：字节级幂等（文件一个字节都不动）')
assert.equal(fix35Bytes.includes('2026-10-03T09:00'), false, 'FIX-35：没变就不得把新时间戳写进去')
assert.equal(fix35Bytes.includes('2026-10-03T01:00'), true, 'FIX-35：保留上一次真实变更时的时间戳')
// ③ 备份数不增（这正是"每轮多 2 个备份 + git 长期 M"的根源）
const fix35BackupsBefore = await countBackups(fix35BackupRoot)
await rebuildPitfallIndex({ project: fix35Project, store: fix35Store, nowIso: '2026-10-03T10:00:00.000Z' })
assert.equal(await countBackups(fix35BackupRoot), fix35BackupsBefore, 'FIX-35：内容没变的轮次不得产生新备份')
// ④ 内容**真变**（新增一篇坑档）→ 照常写、刷新时间戳、新指纹
await writeFile(joinUnderRoot(fix35Root, '仓库/docs/坑/新坑.md'), '# 新坑\n\n正文\n', 'utf8')
const fix35Third = await rebuildPitfallIndex({ project: fix35Project, store: fix35Store, nowIso: '2026-10-03T10:00:00.000Z' })
assert.equal(fix35Third.changed, true, 'FIX-35：内容真变必须判为变了')
assert.equal(fix35Third.wrote, true, 'FIX-35：内容真变要落盘')
assert.ok(fix35Third.added >= 1, 'FIX-35：新增条目要计入 +N')
const fix35After = await readFile(fix35First.path, 'utf8')
assert.ok(fix35After.includes('新坑.md'), 'FIX-35：新条目必须进索引')
assert.ok(fix35After.includes('2026-10-03T10:00'), 'FIX-35：内容真变时才刷新时间戳')
// ⑤ 派生态索引（第二个派生文件）同样要字节级幂等
const fix35Index1 = await rebuildCoreDatabase({ project: fix35Project, store: fix35Store, report: { items: [] }, nowIso: '2026-10-03T01:00:00.000Z' })
const fix35IndexBytes = await readFile(fix35Index1.path, 'utf8')
const fix35Index2 = await rebuildCoreDatabase({ project: fix35Project, store: fix35Store, report: { items: [] }, nowIso: '2026-10-03T11:00:00.000Z' })
assert.equal(fix35Index2.changed, false, 'FIX-35：派生态索引同样按"不含时间戳的内容指纹"判变')
assert.equal(await readFile(fix35Index1.path, 'utf8'), fix35IndexBytes, 'FIX-35：派生态索引字节级幂等')
assert.equal(fix35IndexBytes.includes('2026-10-03T11:00'), false, 'FIX-35：没变就不刷新时间戳')
// ⑥ 纯函数口径：时间戳行中性化，但**别的文字**照常参与比较（防"整行被忽略"）
assert.equal(stripVolatile('> 最后更新：2026-10-03T01:00:00.000Z'), '> 最后更新：<T>', 'FIX-35：时间戳被中性化')
assert.ok(stripVolatile('> **派生物·可重建**，最后更新：2026-10-03T01:00').includes('派生物·可重建'), 'FIX-35：那一行的其它文字照常参与比较')
assert.ok(stripVolatile('> 最后更新：2026-10-03T01:00') !== stripVolatile('> **真身**，最后更新：2026-10-03T02:00'), 'FIX-35：文案变了仍算内容变化')
ok('FIX-35 派生态索引字节级幂等：只有时间戳变 ⇒ 不写不备份（两轮 sha 不变）/ 内容真变才写并刷新时间戳 / 中性化只吃时间戳不吃文案')

// ---------------------------------------------------------------- FIX-36 陈旧快照必须能被识别（不许把"字段缺失"渲染成 0）
// 实测：现场 `panel.json` 写在 snapshot.js 上线**之前** → 顶层键缺 `todos` / `paths`，
// 但 `schemaVersion` 仍是当前值 → client 版本校验放行 → 面板显示「待做任务（派生 0 条）」，**静默误导**喵。
// ① host：快照要带**写入方插件版本**
const fix36HostSnap = buildPanelSnapshot({ store: fix29Store, project: fix29Project, audit: fix29Audit, now: 't' })
const fix36Pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
assert.equal(fix36HostSnap.pluginVersion, fix36Pkg.version, 'FIX-36：快照必须带写入方插件版本（且与 package.json 一致）')
// client 硬编码的版本必须与 package.json 一致 —— 发版忘了改会当场红，不会静默漂移喵
assert.equal(view.CLIENT_PLUGIN_VERSION, fix36Pkg.version, 'FIX-36：client 硬编码版本必须与 package.json 同步（防"忘了改"漂移）')
// ② client：陈旧判定的五种形态
const fix36Current = {
  schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
  pluginVersion: view.CLIENT_PLUGIN_VERSION,
  counts: { members: 1 }, members: {}, membersById: {}, todos: [], paths: { todoFile: null }, audit: { level: 'green', red: 0, yellow: 0, items: [] },
}
assert.equal(view.panelStaleness(fix36Current).stale, false, 'FIX-36：字段齐 + 同版本 ⇒ 不陈旧')
assert.equal(view.panelStaleness(null).stale, true, 'FIX-36：没有快照 = 陈旧')
assert.equal(
  view.panelStaleness({ ...fix36Current, schemaVersion: 999 }).stale, true,
  'FIX-36：schemaVersion 不匹配 ⇒ 陈旧',
)
// 真机那一例：schemaVersion 相同、**字段缺失**
const fix36Missing = { ...fix36Current }
delete fix36Missing.todos
delete fix36Missing.paths
const fix36Verdict = view.panelStaleness(fix36Missing)
assert.equal(fix36Verdict.stale, true, 'FIX-36：**字段缺失**（哪怕 schemaVersion 相同）也必须判陈旧')
assert.ok(fix36Verdict.reason.includes('字段缺失'), `FIX-36：原因要点名缺了哪些字段，实际 ${fix36Verdict.reason}`)
assert.ok(fix36Verdict.reason.includes('todos') && fix36Verdict.reason.includes('paths'), 'FIX-36：缺的字段要逐个列出来')
// 旧版插件写的（无 pluginVersion / 版本更旧）⇒ 陈旧；更新 ⇒ 不算陈旧
const fix36NoVersion = { ...fix36Current }
delete fix36NoVersion.pluginVersion
assert.equal(view.panelStaleness(fix36NoVersion).stale, true, 'FIX-36：快照没带写入方版本 ⇒ 视为旧版写的')
assert.equal(view.panelStaleness({ ...fix36Current, pluginVersion: '0.2.0' }).stale, true, 'FIX-36：写入方版本更旧 ⇒ 陈旧')
assert.equal(view.panelStaleness({ ...fix36Current, pluginVersion: '9.9.9' }).stale, false, 'FIX-36：写入方版本更新 ⇒ 不陈旧')
assert.equal(view.compareVersions('0.3.1', '0.3.1'), 0, 'FIX-36：版本比较（相等）')
assert.ok(view.compareVersions('0.2.9', '0.3.0') < 0, 'FIX-36：版本比较（更旧）')
assert.ok(view.compareVersions('0.10.0', '0.9.0') > 0, 'FIX-36：版本比较必须按数字段，不能按字符串（0.10 > 0.9）')
// ⑤ 回归修复：**陈旧快照里的"路径"仍可用** —— 「强制刷新」这条救援路恰恰要在快照陈旧时能用
// 真机实证：快照是旧版插件写的 ⇒ `usable = null` ⇒ 整个 `paths` 被一起丢掉 ⇒ 按钮报"拿不到待办文件路径" ✗
const fix36OldWriter = {
  ...fix36Current,
  pluginVersion: '0.0.1-old', // 版本旧 ⇒ 判陈旧（= 真机那种"旧版插件写的快照"）
  paths: { todoFile: 'D:\\Blockdustry\\待办.md' },
  todos: null,
}
const fix36StaleKeepsPath = view.snapshotFromSessions(
  [{ sessionId: 'r', running: true, agentAvailable: true, updatedAt: 1 }], {}, 'r', fix36OldWriter,
)
assert.equal(fix36StaleKeepsPath.stale, true, '回归：旧版写的快照仍判陈旧')
assert.equal(fix36StaleKeepsPath.todos, null, '回归：陈旧时待办**数据**仍是 null（未知，不谎报 0 条）')
assert.equal(fix36StaleKeepsPath.paths.todoFile, 'D:\\Blockdustry\\待办.md', '回归：但**路径**要留着（"待办文件在哪"不随 schema 变旧而失效）')
assert.equal(
  view.snapshotFromSessions([{ sessionId: 'r', running: true, agentAvailable: true, updatedAt: 1 }], {}, 'r', {
    ...fix36OldWriter, paths: {},
  }).paths.todoFile, null,
  '回归：快照真没给路径时仍是 null（面板据此给"先让主代理跑一次"的替代说法）',
)


// ③ 渲染层：陈旧时 `todos` 是 **null（未知）**，不是 `[]`（那会被显示成 0 条）——
//    并且摘要条走 placeholder（FIX-91 起是"尚无结论 + 下一步"），**不得**写"0 红 0 黄"喵
const fix36Merged = view.snapshotFromSessions(
  [{ sessionId: 'r', running: true, agentAvailable: true, updatedAt: 1 }], {}, 'r', fix36Missing,
)
assert.equal(fix36Merged.stale, true, 'FIX-36：字段缺失的快照要走"陈旧"路径')
assert.equal(fix36Merged.todos, null, 'FIX-36：陈旧时 todos 必须是 null（未知），不是空数组（=0 条）')
assert.ok(fix36Merged.notes.some((text) => text.includes('快照陈旧')), 'FIX-36：notes 里要说清"快照陈旧 + 触发一次审计即可"')
assert.equal(
  view.auditSummaryText(fix36Merged.audit), AUDIT_PLACEHOLDER_TEXT,
  'FIX-91 ②：陈旧快照的审计条要写"尚无结论 + 下一步"，不得渲染成 0 红 0 黄',
)
assert.equal(view.auditSummaryText(fix36Merged.audit).includes('0 红'), false, 'FIX-36：绝不许把缺失渲染成 0')
assert.ok(
  clientSource.includes('数据源待接：${snapshot.staleReason'),
  'FIX-36：陈旧时 B 区（执行队列）要明说"数据源待接：<原因>"，而不是"0 条"',
)
assert.ok(
  /const unknown = snapshot\.todos === null \|\| snapshot\.todos === undefined/.test(clientSource),
  'FIX-36：待办区必须显式区分"未知（null）"与"确实没有（[]）"',
)
assert.ok(
  clientSource.includes("（${todos.length} 条）") || clientSource.includes('`（${todos.length} 条）`'),
  'FIX-36：**只有非 unknown** 才把条数写出来（未知时不写数字）',
)
// 正常快照不受影响（回归位）
const fix36Fresh = view.snapshotFromSessions(
  [{ sessionId: 'r', running: true, agentAvailable: true, updatedAt: 1 }], {}, 'r',
  { ...fix36Current, todos: [{ kind: 'task', level: 'yellow', title: '未结任务 T-1', path: 'p', sessionId: null }] },
)
assert.equal(fix36Fresh.stale, false, 'FIX-36：正常快照不得被误判陈旧')
assert.equal(fix36Fresh.todos.length, 1, 'FIX-36：正常快照的待办要照常带出来')
assert.equal(fix36Fresh.notes.length, 0, 'FIX-36：正常快照不该有降级提示')
ok('FIX-36 陈旧快照识别：快照带写入方 pluginVersion / 字段缺失或旧版本即判陈旧 / 陈旧时 todos=null 且写"数据源待接"（绝不渲染 0）/ client 版本与 package.json 同步')

// ---------------------------------------------------------------- FIX-37 审计条注明"项目级"（一行文案）
assert.ok(view.AUDIT_SCOPE_NOTE.includes('项目级'), 'FIX-37：范围说明必须写明"项目级"')
assert.ok(view.AUDIT_SCOPE_NOTE.includes('同工作区内共享'), 'FIX-37：还要说清"同工作区内共享"（这正是被误认成"串了"的原因）')
assert.ok(clientSource.includes('AUDIT_SCOPE_NOTE'), 'FIX-37：这句话必须真的渲染在审计条旁（不能只是常量）')
assert.ok(
  /AUDIT_SCOPE_NOTE/.test(clientSource.slice(clientSource.indexOf('const renderAuditBar'))),
  'FIX-37：渲染入口（renderAuditBar）里要引用它',
)
ok('FIX-37 审计条项目级说明：文案写明"项目级 / 同工作区内共享"并真的渲染')

// ---------------------------------------------------------------- FIX-38 快照重建后必须能刷新（不必重开 tab）
// 前身即 FIX-36 的"派生 0 条"：面板只在挂载时读一次，宿主动作之后 `panel.json` 变了也不重读喵。
assert.equal(typeof view.PANEL_POLL_MS, 'number', 'FIX-38：轮询间隔必须是可断言的常量')
assert.ok(view.PANEL_POLL_MS >= 5000, `FIX-38：轮询间隔不能太激进（会白烧宿主读取），实际 ${view.PANEL_POLL_MS}`)
assert.equal(view.shouldPoll({ hidden: false }), true, 'FIX-38：页面可见时轮询')
assert.equal(view.shouldPoll({ hidden: true }), false, 'FIX-38：页面隐藏时别白烧 IO')
assert.equal(view.shouldPoll(null), true, 'FIX-38：拿不到 document 的环境按"该轮询"处理')
assert.ok(clientSource.includes('setInterval(') && clientSource.includes('PANEL_POLL_MS'), 'FIX-38：必须真的起定时器（而不是只定义常量）')
assert.ok(clientSource.includes('clearInterval(timer)'), 'FIX-38：卸载必须清定时器（不留悬空 interval）')
assert.ok(
  /if \(!shouldPoll\([\s\S]{0,60}\) return/.test(clientSource),
  'FIX-38：轮询回调里要先判"该不该轮询"（隐藏时不发请求）',
)
assert.ok(clientSource.includes("'data-testid': 'agent-contract-refresh'"), 'FIX-38：面板要有手动刷新入口')
assert.ok(/onClick: \(\) => \{ loadAll\(\) \}/.test(clientSource), 'FIX-38：手动刷新按钮要接整轮重载')
// 一次读取的结果被三处共用（挂载 / 手动 / 轮询）—— 口径只有一份，别各写各的喵
assert.ok(clientSource.includes('const applyLoaded = (value) =>'), 'FIX-38：三处刷新必须共用 applyLoaded 这一份口径')
assert.ok((clientSource.match(/applyLoaded\(/g) || []).length >= 3, 'FIX-38：挂载、手动、轮询都要走 applyLoaded')
assert.ok(clientSource.includes('lineageRef.current = value.lineage'), 'FIX-38：要记住血缘，轮询才能"只重读快照"')
// 行为位（关键）：快照"重建"之后，刷新必须拿到**新数据** —— 这正是用户报的那个洞喵
const fix38Root = await mkdtemp(join(tmpdir(), 'ac-fix38-'))
const fix38Panel = (todos, red) => JSON.stringify({
  schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
  pluginVersion: view.CLIENT_PLUGIN_VERSION,
  generatedAt: 't',
  counts: { members: 1, tasks: todos.length, docs: 0 },
  members: {},
  membersById: {},
  paths: { todoFile: joinUnderRoot(fix38Root, '待办.md') },
  audit: { level: red ? 'red' : 'green', red, yellow: 0, items: red ? [{ check: 'missing_doc', level: 'red', target: 'T-x', detail: '缺档', suggestion: '补档' }] : [] },
  todos,
})
let fix38Text = fix38Panel([{ kind: 'task', level: 'yellow', title: '未结任务 T-1', path: 'p', sessionId: null }], 0)
const fix38Ctx = {
  remote: {
    session: { list: async () => ({ items: [{ sessionId: 'r', cwd: fix38Root, running: true, agentAvailable: true, updatedAt: 1 }] }) },
    workspaceFiles: { read: async () => ({ text: fix38Text }) },
  },
}
const fix38Scope = { sessionId: 'r', cwd: fix38Root }
const fix38First = await view.loadPanel(fix38Ctx, fix38Scope)
assert.equal(fix38First.todos.length, 1, 'FIX-38：首次读取拿到 1 条待办')
assert.ok(fix38First.lineage && Array.isArray(fix38First.lineage.candidates), 'FIX-38：loadPanel 必须把血缘与候选路径带出来（供刷新复用）')
// 宿主那边"重建"了快照（多一条待办 + 一条审计红项）
fix38Text = fix38Panel(
  [
    { kind: 'task', level: 'yellow', title: '未结任务 T-1', path: 'p', sessionId: null },
    { kind: 'missing_doc', level: 'yellow', title: '[missing_doc] 缺档', path: 'T-y', sessionId: 'sess-1' },
  ],
  1,
)
const fix38Refreshed = await view.refreshPanelSnapshot(fix38Ctx, fix38Scope, fix38First.lineage)
assert.equal(fix38Refreshed.todos.length, 2, 'FIX-38（关键）：快照重建后刷新必须拿到新的待办清单（原来只能重开 tab）')
assert.equal(fix38Refreshed.audit.red, 1, 'FIX-38：审计红黄也要跟着新快照走')
assert.equal(view.auditSummaryText(fix38Refreshed.audit), '审计：红 1 / 黄 0', 'FIX-38：刷新后摘要条显示新值')
assert.equal(fix38First.todos.length, 1, 'FIX-38：刷新不得就地改写旧快照对象（React 要靠新引用触发重渲染）')
assert.equal(await view.refreshPanelSnapshot(fix38Ctx, fix38Scope, null), null, 'FIX-38：没有血缘可复用时返回 null（不许瞎读）')
assert.ok(String(view.STALE_SNAPSHOT_NOTE).includes('↻ 刷新'), 'FIX-38：陈旧提示要告诉用户"点刷新也能立刻重读"')
ok('FIX-38 快照可刷新：30s 轮询（隐藏时跳过、卸载清定时器）+ 手动「↻ 刷新」整轮重载 / 三处共用 applyLoaded / 重建后刷新拿到新数据且不就地改写旧对象')

// ---------------------------------------------------------------- FIX-39 跳转后侧栏要"保持"（tab 按会话分域）
// 现象：点面板里带下划线的行跳转后，侧栏把面板收掉了。根因在 better-sidebar 的 tab 模型：
// tab 存在**按会话分域**的 store 里（其 service.ts `store.reduceFor(scope.sessionId, reducer)`），
// 我们这枚 tab 开在 A 会话域 → 跳到 B 后侧栏渲染 B 的域，里面没有它 → 面板消失喵。
assert.equal(view.TAB_TYPE_ID, 'agent-contract:contract', 'FIX-44：tab 类型 id 必须是常量（跳转补开时按它定位）')
const fix39Calls = []
const fix39Service = {
  openTab: (seed, scope) => fix39Calls.push({ api: 'openTab', seed, scope }),
  activateTab: (id, scope) => fix39Calls.push({ api: 'activateTab', id, scope }),
}
const fix39Ctx = { get: (name) => (name === 'betterSidebar' ? fix39Service : undefined) }
assert.equal(view.reopenTabInScope(fix39Ctx, 'sess-b'), 'open', 'FIX-44：优先用 openTab 把 tab 补进目标会话域')
assert.deepEqual(
  toHost(fix39Calls), [{ api: 'openTab', seed: { type: 'agent-contract:contract' }, scope: { sessionId: 'sess-b' } }],
  'FIX-44：补开必须落到**目标会话**的 scope（不是当前/无 scope）',
)
// 旧版 better-sidebar 没有带 scope 的 openTab → 退化为 activateTab（仍然带 scope）喵
fix39Calls.length = 0
assert.equal(
  view.reopenTabInScope({ get: () => ({ activateTab: fix39Service.activateTab }) }, 'sess-c'), 'activate',
  'FIX-44：没有 openTab 时退化为 activateTab',
)
assert.deepEqual(
  toHost(fix39Calls), [{ api: 'activateTab', id: 'agent-contract:contract', scope: { sessionId: 'sess-c' } }],
  'FIX-44：退化路径同样要带目标 scope',
)
// 静默：拿不到服务 / 服务抛错 / 没有 sessionId 都不许把跳转拖垮喵
assert.equal(view.reopenTabInScope({ get: () => undefined }, 'sess-b'), false, 'FIX-44：没有服务 → false，不抛错')
assert.equal(view.reopenTabInScope(null, 'sess-b'), false, 'FIX-44：没有 ctx 也不许抛错')
assert.equal(view.reopenTabInScope(fix39Ctx, null), false, 'FIX-44：没有目标会话 → false')
assert.equal(
  view.reopenTabInScope({ get: () => ({ openTab: () => { throw new Error('boom-tab') } }) }, 'sess-b'), false,
  'FIX-44：宿主 API 抛错必须被吞掉（补开是锦上添花，不该影响跳转）',
)
// 跳转路径必须**真的**接上这一步（顺序：先切会话，再把 tab 补进去）喵
const fix39Jump = []
const fix39JumpCtx = {
  get: (name) => (name === 'uiWorkspace'
    ? { openSession: (id) => fix39Jump.push(`openSession:${id}`) }
    : (name === 'betterSidebar'
      ? { openTab: (seed, scope) => fix39Jump.push(`openTab:${seed.type}@${scope.sessionId}`) }
      : undefined)),
}
assert.equal(view.openSessionConversation(fix39JumpCtx, 'sess-d'), true, 'FIX-44：跳转仍然要走 uiWorkspace.openSession')
assert.deepEqual(
  toHost(fix39Jump),
  ['openSession:sess-d', 'openTab:agent-contract:contract@sess-d'],
  'FIX-44：顺序必须是"先切会话 → 再把 tab 补进目标域"',
)
assert.ok(
  /= TAB_TYPE_ID/.test(clientSource) || clientSource.includes('id: TAB_TYPE_ID'),
  'FIX-44：descriptor 的 id 与补开用的类型必须是同一常量（写死两处迟早漂移）',
)
ok('FIX-44 跳转后侧栏保持：tab 按会话分域 → 跳转后把本 tab 补进目标会话 scope（openTab 优先、activateTab 退化）/ 静默失败不影响跳转 / id 与补开共用常量')

// ================================================================ FIX-39/40/41（面板：自动跟上 · 分区 · 首次可写）
// ---------------------------------------------------------------- FIX-39 面板数据不由"审计"驱动
// 病根：快照只在 `audit_scan` / `ledger_rebuild` 两处重写 ⇒「想看待办得先跑一次审计」喵。
assert.ok(PANEL_SYNC_DEFAULTS.flushMs > 0 && PANEL_SYNC_DEFAULTS.flushMs <= 5000, `FIX-39：窗口要够短（≤5s）才谈得上"及时"，实际 ${PANEL_SYNC_DEFAULTS.flushMs}`)
assert.ok(PANEL_SYNC_DEFAULTS.maxEvents >= 1, 'FIX-39：突发上限必须是正数')
// ① 节流：3 条突发 → **一次**写入（且不早写）；攒够 maxEvents → 立刻写
const fix39Writes = []
const fix39Timers = []
const fix39Sync = createPanelSync({
  store: fix30Store, project: resolveProject(fix30Cfg),
  flushMs: 2000, maxEvents: 5,
  write: async ({ audit }) => { fix39Writes.push({ audit }); return { ok: true, path: 'x' } },
  readPrevious: async () => null,
  setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; fix39Timers.push(timer); return timer },
  clearTimer: (timer) => { if (timer) timer.cleared = true },
  now: () => 't',
})
fix39Sync.record()
fix39Sync.record()
fix39Sync.record()
assert.equal(fix39Writes.length, 0, 'FIX-39：窗口内不得落盘（短时间大量变化不许频繁重写）')
assert.equal(fix39Timers.length, 1, 'FIX-39：首个事件只开**一个**窗口（不是每条一个定时器）')
// 窗口回调是"起一个异步 flush"，所以断言前要让微任务跑完（否则测的是竞态不是行为）喵
const fix39Settle = () => new Promise((resolve) => setTimeout(resolve, 0))
await fix39Timers[0].fn.call(null)
await fix39Settle()
assert.equal(fix39Writes.length, 1, 'FIX-39：窗口到点只写一次')
assert.equal(fix39Writes[0].audit, null, 'FIX-39：没有可沿用的审计结论时传 null（由快照写 placeholder，不谎报全绿）')
for (let index = 0; index < 5; index += 1) fix39Sync.record()
await fix39Settle()
assert.equal(fix39Writes.length, 2, 'FIX-39：攒够 maxEvents 立刻写（突发大批量不憋着）')
// ② 不谎报审计：上一份快照有 audit 块 ⇒ 沿用并标 asOf；红黄**不归零**
const fix39Prev = {
  generatedAt: '2026-10-03T00:00:00.000Z',
  audit: { level: 'red', red: 3, yellow: 26, items: [{ check: 'missing_doc', level: 'red', target: 'T-x', detail: '缺档' }] },
}
const fix39Carry = createPanelSync({
  store: fix30Store, project: resolveProject(fix30Cfg),
  write: async ({ audit }) => { fix39Writes.push({ audit }); return { ok: true } },
  readPrevious: async () => fix39Prev,
  setTimer: (fn) => { const timer = { fn }; fix39Timers.push(timer); return timer },
  clearTimer: () => {},
})
fix39Sync.stop()
fix39Carry.record()
await fix39Carry.flush()
const fix39Audit = fix39Writes[fix39Writes.length - 1].audit
assert.equal(fix39Audit.counts.red, 3, 'FIX-39：非审计触发时必须沿用上次的红计数（不许归零）')
assert.equal(fix39Audit.counts.yellow, 26, 'FIX-39：黄计数同样沿用')
assert.equal(fix39Audit.asOf, '2026-10-03T00:00:00.000Z', 'FIX-39：要标出这份审计结论"截至何时"')
// ③ 没有可沿用的审计 ⇒ 快照写 placeholder（FIX-91 起：面板显示"尚无结论 + 下一步"），不得写 0 红 0 黄
const fix39Bare = buildPanelSnapshot({ store: fix30Store, project: resolveProject(fix30Cfg), audit: null, now: 't' })
assert.equal(fix39Bare.audit.placeholder, true, 'FIX-39：无审计数据时 audit 必须标 placeholder')
assert.equal(fix39Bare.audit.red, null, 'FIX-39：placeholder 时 red 是 null（不是 0 —— 0 等于谎报全绿）')
assert.equal(view.auditSummaryText(fix39Bare.audit), AUDIT_PLACEHOLDER_TEXT, 'FIX-91 ②：面板对 placeholder 显示"尚无结论 + 到底怎么跑"')
// ④ 事件驱动：三个领域任一变更都触发；其它领域不动；dispose 退订 + 停表
const fix39Bus = { handlers: [], on(name, fn) { this.handlers.push({ name, fn }); return () => { this.handlers = this.handlers.filter((row) => row.fn !== fn) } } }
const fix39Attached = attachPanelSync({
  ctx: fix39Bus, store: fix30Store, project: resolveProject(fix30Cfg),
  write: async () => ({ ok: true }), readPrevious: async () => null,
  setTimer: (fn) => { const timer = { fn, cleared: false }; fix39Timers.push(timer); return timer }, clearTimer: () => {},
})
const fix39Emit = (domain) => fix39Bus.handlers.filter((row) => row.name === 'domain/changed').forEach((row) => row.fn({ domain }))
const fix39Before = fix39Attached.sync.stats().pending
fix39Emit('agent_contract_docs')
fix39Emit('agent_contract_members')
fix39Emit('agent_contract_tasks')
assert.equal(fix39Attached.sync.stats().pending, fix39Before + 3, 'FIX-39：三个领域的变更都要记账（派子智能体 / 落档 / 进度都能刷新面板）')
fix39Emit('some_other_plugin_domain')
assert.equal(fix39Attached.sync.stats().pending, fix39Before + 3, 'FIX-39：别人的领域变更不该触发我们的快照重写')
fix39Attached.dispose()
fix39Emit('agent_contract_docs')
assert.equal(fix39Attached.sync.stats().pending, fix39Before + 3, 'FIX-39：dispose 后不再订阅（不留悬空监听）')
// ⑤ 源码位：审计不再是唯一入口；快照同步不依赖审计模块
assert.ok(clientSource.length > 0, 'sanity')
const fix39ToolsSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
const fix39SyncSrc = await readFile(new URL('./src/panel/snapshot-sync.js', import.meta.url), 'utf8')
// 口径更新（FIX-96 ②，用户约束，不是放宽）：工具侧原有两个"写快照"入口 ——
// ① `audit_scan` 那个（**算审计 + 重写**）挪进了三处同源的 `refreshPanel()` ② 另一处仍是直接写（只重写不重算）。
// 断言改成"两条路都还在"，并且**要求 audit_scan 走同源实现**（下面 FIX-96 段另有一条更硬的同源断言）喵
assert.ok(
  (fix39ToolsSrc.match(/writePanelSnapshot\(/g) || []).length >= 1
  && (fix39ToolsSrc.match(/refreshPanel\(/g) || []).length >= 1,
  'FIX-39 + FIX-96：工具侧"只重写"与"算审计 + 重写"两条路都还在（后者走三处同源的 refreshPanel）',
)
assert.equal(/from '\.\.\/audit\//.test(fix39SyncSrc), false, 'FIX-39：快照同步**不许**依赖审计模块（审计只是数据来源之一）')
assert.ok(fix39SyncSrc.includes("ctx.on('domain/changed'"), 'FIX-39：必须挂在台账变更事件上（自更新，不靠人工跑审计）')
// **口径反转（FIX-58，不是放宽）**：此处原断言 index.js 里写死
// `attachPanelSync({ ctx, store, project: resolveProject(config) })` —— 那是"一实例一项目"时代的形状。
// FIX-58 起根跟着工作区走 ⇒ 同步器改成按**项目键**分域（`{ ctx, ledger, projects, bootstrap }`），
// 断言跟着改成新形状，并且**同时**要求旧形状不再出现（否则就是把两套并存当通过）喵
const fix39IndexSrc = await readFile(new URL('./index.js', import.meta.url), 'utf8')
// 形状再更新（FIX-95，不是放宽）：挂同步器时多传了 `runAudit`（FIX-91④ 启动补算审计）与
// `healLog`（FIX-95② 自愈留痕），调用点因此写成多行 ⇒ 正则允许换行，但**要求的字段一个不少**喵
assert.ok(
  /attachPanelSync\(\{\s*ctx, ledger, projects, bootstrap/.test(fix39IndexSrc),
  'FIX-39 + FIX-58：插件启动时要把同步器挂上（多项目：按项目键分域写各自根下的快照）',
)
assert.ok(
  /attachPanelSync\(\{[\s\S]{0,200}?resolver: projectFor, refresh: refreshForPanel, healLog/.test(fix39IndexSrc),
  'FIX-91④ / FIX-95② / FIX-96②：挂同步器时要交上**同源的补算实现**（refreshForPanel）与自愈留痕（否则失败没痕迹、面板空着没人知道为什么）',
)
assert.ok(
  /panel\.healAll\(\)/.test(fix39IndexSrc),
  'FIX-95 ①：启动时要有**不依赖会话活动**的自愈触发点（扫已登记工作区，重写旧版写的快照）',
)
assert.ok(
  /projectFor\(\{ agent: null \}, \{ ensure: false \}\)/.test(fix39IndexSrc),
  'FIX-58：零配置启动时按"唯一工作区"先点亮面板，且必须是**只读探测**（ensure: false）',
)
assert.equal(
  /attachPanelSync\(\{ ctx, store, project: resolveProject\(config\) \}\)/.test(fix39IndexSrc), false,
  'FIX-58：旧的"一实例一项目"挂法必须消失（两套并存 = 口径漂移）',
)
ok('FIX-39 面板自更新：台账三领域变更经 domain/changed 节流重写快照（窗口合并 / 攒够即写）/ 沿用上次审计并标 asOf（绝不归零谎报）/ 无审计数据写 placeholder / 审计不再是唯一入口')

// ---------------------------------------------------------------- FIX-40 面板两块：人看的归人、机器算的归机器
const fix40Human = 'fix40-human'
assert.ok(clientSource.includes("'data-testid': 'agent-contract-human-todo'"), 'FIX-40：A 区（大方向待办）必须有独立入口')
assert.ok(clientSource.includes("'data-testid': 'agent-contract-agent-queue'"), 'FIX-40：B 区（agent 执行队列）必须有独立入口')
assert.ok(clientSource.includes('const renderHumanTodo = ()') && clientSource.includes('const renderAgentQueue = ()'), 'FIX-40：两块各有一个渲染器')
assert.ok(clientSource.includes("待办任务（大方向）"), 'FIX-40：A 区标题要写「待办任务（大方向）」')
assert.ok(clientSource.includes("agent 待办（执行队列）"), 'FIX-40：B 区标题要写「agent 待办（执行队列）」')
assert.ok(clientSource.includes("'（无待办）'") && clientSource.includes("'（执行队列为空）'"), 'FIX-40：两块的空态文案互不干扰')
assert.ok(/const \[queueOpen, setQueueOpen\]/.test(clientSource) && /const \[todoOpen, setTodoOpen\]/.test(clientSource), 'FIX-40：两块各有自己的折叠位')
// 数据位（硬证据）：待办文件的正文**不进**快照 ⇒ 只改待办文件时 B 区不可能变
const fix40FileText = '# 大方向\n\n- [ ] 批次一：迁移\n- [x] 批次零：清点\n'
const fix40SnapJson = JSON.stringify(buildPanelSnapshot({ store: fix30Store, project: resolveProject(fix30Cfg), audit: fix39Prev, now: 't' }))
assert.equal(fix40SnapJson.includes('批次一'), false, 'FIX-40（关键）：快照里不得混入待办文件正文（A 区的内容是 client 另读的）')
assert.equal(fix40SnapJson.includes(fix40FileText.slice(0, 12)), false, 'FIX-40：快照与待办文件内容完全解耦')
// 源码位：A 用 md 子集渲染原文；B **只**渲染派生态条目，绝不渲染 md 原文
const fix40HumanBody = clientSource.slice(clientSource.indexOf('const renderHumanTodo = ()'), clientSource.indexOf('const renderAgentQueue = ()'))
// B 区的切片要**到函数尾部**为止（一直切到文件末尾会把 __internals 导出表也算进来）喵
const fix40QueueBody = clientSource.slice(clientSource.indexOf('const renderAgentQueue = ()'), clientSource.indexOf('module.exports.__internals'))
assert.ok(fix40HumanBody.includes('parseMdSubset') && fix40HumanBody.includes('renderMdBlock'), 'FIX-40：A 区渲染 md 原文')
assert.equal(fix40QueueBody.includes('renderMdBlock'), false, 'FIX-40：B 区**不得**渲染 md 原文（那是 A 区的活）')
assert.equal(fix40HumanBody.includes('snapshot.todos'), false, 'FIX-40：A 区不掺机器条目')
assert.ok(fix40QueueBody.includes('snapshot.todos'), 'FIX-40：B 区的数据来自派生态 todos[]')
ok('FIX-40 面板分两块：A 大方向待办（原文/可勾可编）与 B agent 执行队列（派生态条目/可点定位）各自独立折叠与空态 / 快照不含待办正文（只改文件不会动 B）')

// ---------------------------------------------------------------- FIX-41 A 区可勾选 + 可编辑（面板首次可写）
// 护栏一：**唯一可写目标**是配置里那个待办文件，别的路径一律拒
const fix41Project = resolveProject(fix30Cfg)
assert.equal(isTodoPathAllowed(fix41Project, fix41Project.panel.todoFile), true, 'FIX-41：白名单内的待办文件可写')
assert.equal(isTodoPathAllowed(fix41Project, joinUnderRoot(fix41Project.root, '别的.md')), false, 'FIX-41（验收③）：白名单外路径必须被拒')
assert.equal(isTodoPathAllowed(fix41Project, 'D:\\随便\\哪.md'), false, 'FIX-41：绝对路径也照样拒')
assert.equal(isTodoPathAllowed({ panel: {} }, 'x.md'), false, 'FIX-41：没配待办文件就谁也写不了')
// 护栏二：**行级外科手术** —— 勾选只翻那一行三个字符，其它字节（格式/注释/缩进/顺序）一字不动
const fix41Md = [
  '# 大方向待办', '',
  '<!-- 这段注释不许动 -->',
  '- [ ] 批次一：迁移（**优先**）',
  '  - [x] 子项：清点',
  '-普通说明行，没有空格前缀也不许动',
  '- [X] 大写的已完成也要认得',
].join('\n')
const fix41Toggled = toggleTodoLine(fix41Md, 3)
assert.ok(fix41Toggled.includes('- [x] 批次一：迁移（**优先**）'), 'FIX-41：勾选把 `[ ]` 翻成 `[x]`，行内其它内容一字不改')
const fix41Stats = diffStats(fix41Md, fix41Toggled)
assert.equal(fix41Stats.removed, 1, 'FIX-41（验收④）：只该有 1 行被替换（其余字节零改动）')
assert.equal(fix41Stats.added, 1, 'FIX-41：也只该新增 1 行')
assert.equal(
  fix41Toggled.split('\n').filter((line, index) => line !== fix41Md.split('\n')[index]).length, 1,
  'FIX-41：逐行比对，只有被点的那一行不同',
)
assert.ok(fix41Toggled.includes('<!-- 这段注释不许动 -->'), 'FIX-41：注释原样')
assert.ok(fix41Toggled.includes('  - [x] 子项：清点'), 'FIX-41：缩进与顺序原样')
assert.equal(fix41Toggled.includes('-普通说明行', ), true, 'FIX-41：不带前缀的普通行原样')
assert.ok(toggleTodoLine(fix41Md, 4).includes('- [ ] 子项：清点'), 'FIX-41：取消勾选（x → 空格）同样只翻那一行')
assert.equal(toggleTodoLine(fix41Md, 0), null, 'FIX-41：标题行不是勾选框 → null')
assert.equal(toggleTodoLine(fix41Md, 999), null, 'FIX-41：越界 → null')
// 护栏三：指纹必须**两边一致**（client 与宿主各一份实现，靠交叉比对防漂移）
const fix41Samples = ['', 'a', '- [ ] x', '# 中文\n- [x] 迁移', '带 emoji 🐱 与 \\r\\n 的文本']
for (const sample of fix41Samples) {
  assert.equal(view.hashText(sample), hashTextHost(sample), `FIX-41：client 与宿主的 hashText 必须逐位一致（样本 ${JSON.stringify(sample)}）`)
}
// 护栏四：写通道的四类拒绝 + 一类成功（用假 req/res 真跑 handler）
const fix41WriteLog = []
const fix41Handler = createTodoHandler({
  getProject: () => fix41Project,
  // 与 `registerTodoRoute` 接的是**同一道栅栏**（这里显式接上，才能测到 Host/Origin 拒绝）喵
  fence: (req) => isTrustedLocalRequest((req && req.headers) || {}),
  write: async ({ project, path, text }) => { fix41WriteLog.push({ path, text }); return { ok: true, backupPath: 'D:\\备份\\待办.md', action: 'overwrite' } },
  read: async () => fix41Md,
  now: () => '2026-10-03T00:00:00.000Z',
  readBodyImpl: async () => JSON.stringify(fix41Pending.payload),
})
let fix41Pending = { payload: {} }
function makeRes() {
  const res = { status: null, body: null, writeHead(status) { this.status = status }, end(text) { this.body = JSON.parse(text) } }
  return res
}
const fix41Call = async (payload, req = { method: 'POST', headers: { host: '127.0.0.1:1234' } }) => {
  fix41Pending = { payload }
  const res = makeRes()
  await fix41Handler(req, res)
  return res
}
let fix41Res = await fix41Call({ path: joinUnderRoot(fix41Project.root, '别的.md'), action: 'save', content: 'x' })
assert.equal(fix41Res.status, 403, 'FIX-41（验收③）：写白名单外路径必须被拒')
assert.equal(fix41Res.body.error.code, 'path-not-allowed', 'FIX-41：拒绝原因要明确')
assert.equal(fix41WriteLog.length, 0, 'FIX-41：被拒的请求**一个字都不许落盘**')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'save', content: 'x', baseHash: 'deadbeef' })
assert.equal(fix41Res.status, 409, 'FIX-41（验收④）：外部先改过（指纹不符）→ 保存被拒')
assert.equal(fix41Res.body.error.code, 'stale-file', 'FIX-41：冲突要报 stale-file')
assert.ok(fix41Res.body.error.message.includes('刷新后重试'), 'FIX-41：冲突提示要告诉用户刷新重试')
assert.equal(fix41WriteLog.length, 0, 'FIX-41：冲突时绝不覆盖')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 3, baseHash: hashTextHost(fix41Md) })
assert.equal(fix41Res.status, 200, 'FIX-41：指纹正确 + 行是勾选框 → 成功')
assert.equal(fix41Res.body.value.changed, true, 'FIX-41：要报"确实改动了"')
assert.equal(fix41WriteLog.length, 1, 'FIX-41：成功时写一次')
assert.ok(fix41WriteLog[0].text.includes('- [x] 批次一：迁移（**优先**）'), 'FIX-41：宿主侧做的是行级翻转（只动那一行）')
assert.equal(fix41WriteLog[0].path, fix41Project.panel.todoFile, 'FIX-41：只写白名单里那一个文件')
assert.equal(fix41Res.body.value.hash, hashTextHost(fix41WriteLog[0].text), 'FIX-41：返回新指纹供下一次写入比对')
assert.ok(fix41Res.body.value.backupPath, 'FIX-41（验收①）：写前留了可回退的旧版本')
// 其余拒绝路径
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 0 }, { method: 'GET', headers: { host: '127.0.0.1' } })
assert.equal(fix41Res.status, 405, 'FIX-41：只接受 POST')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 0 }, { method: 'POST', headers: {} })
assert.equal(fix41Res.status, 403, 'FIX-41：没有 Host 头 → 栅栏拒绝')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 0 }, { method: 'POST', headers: { host: '127.0.0.1', 'sec-fetch-site': 'cross-site' } })
assert.equal(fix41Res.status, 403, 'FIX-41：跨站标记 → 拒绝（DNS-rebinding 防御）')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 0 }, { method: 'POST', headers: { host: 'evil.example.com' } })
assert.equal(fix41Res.status, 403, 'FIX-41：Host 不是本机 → 拒绝')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 1 })
assert.equal(fix41Res.status, 400, 'FIX-41：那一行不是勾选框 → 400')
assert.equal(fix41Res.body.error.code, 'not-a-checkbox', 'FIX-41：原因要写清')
fix41Res = await fix41Call({ path: fix41Project.panel.todoFile, action: '没这个动作' })
assert.equal(fix41Res.status, 400, 'FIX-41：未知 action → 400')
// 栅栏纯函数（同 better-sidebar trust-fence 语义）
assert.equal(isTrustedLocalRequest({ host: 'localhost:8080' }), true, 'FIX-41：localhost 放行')
assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:1' }), true, 'FIX-41：127.x 放行')
assert.equal(isTrustedLocalRequest({ host: '[::1]:1' }), true, 'FIX-41：::1 放行')
assert.equal(isTrustedLocalRequest({ host: '10.0.0.5' }), false, 'FIX-41：内网非回环默认不放行（除非配了 trustedHosts）')
assert.equal(isTrustedLocalRequest({ host: '10.0.0.5' }, ['10.0.0.5:7777']), true, 'FIX-41：trustedHosts 里的授权放行')
assert.equal(isTrustedLocalRequest({ host: '127.0.0.1', origin: 'http://evil.example.com' }), false, 'FIX-41：Origin 不匹配 → 拒')
assert.equal(isTrustedLocalRequest({ host: '127.0.0.1', origin: 'null' }), false, 'FIX-41：不透明来源（null）→ 拒')
assert.equal(isTrustedLocalRequest({ host: '127.0.0.1', origin: 'http://127.0.0.1:9' }), true, 'FIX-41：同主机名（端口不同）放行')
// 客户端：写通道结果 → 人话（⑦ 状态可见、不许静默）
assert.ok(view.todoErrorText({ code: 'stale-file' }).includes('刷新后重试'), 'FIX-41：冲突 → 提示刷新重试')
assert.ok(view.todoErrorText({ code: 'path-not-allowed' }).includes('只允许写'), 'FIX-41：越权 → 说明只允许写配置里的文件')
assert.ok(view.todoErrorText({ code: 'http-404' }).includes('未提供待办写通道'), 'FIX-41：宿主没挂路由 → 明说编辑不可用')
const fix41FetchCalls = []
const fix41Posted = await view.postTodo({ path: 'p', action: 'toggle', line: 1 }, async (url, init) => {
  fix41FetchCalls.push({ url, init })
  return { status: 200, json: async () => ({ ok: true, value: { hash: 'abc' } }) }
})
assert.equal(fix41Posted.ok, true, 'FIX-41：客户端 postTodo 解出成功信封')
assert.equal(fix41FetchCalls[0].url, view.TODO_ROUTE_PATH, 'FIX-41：走的是宿主那条写路由')
assert.equal(fix41FetchCalls[0].init.method, 'POST', 'FIX-41：POST')
assert.equal(JSON.parse(fix41FetchCalls[0].init.body).path, 'p', 'FIX-41：请求体带 path（宿主据此做白名单）')
const fix41Fail = await view.postTodo({}, async () => { throw new Error('boom-net') })
assert.equal(fix41Fail.ok, false, 'FIX-41：网络异常要如实返回失败')
assert.equal(fix41Fail.error.code, 'network', 'FIX-41：错误码要能区分')
// UI 源码位：A 区可勾可编可存；B 区与审计区**没有**任何写路径
assert.ok(
  fix40HumanBody.includes('onToggle: savingTodo || !todoWritable ? null : toggleTodoItem'),
  'FIX-41/45：A 区非编辑态可勾选；保存中**或写通道不可用**时不给可点假象',
)
assert.ok(fix40HumanBody.includes('agent-contract-todo-editor'), 'FIX-41：A 区有编辑框')
assert.ok(fix40HumanBody.includes('agent-contract-todo-status'), 'FIX-41：A 区有保存状态行（成功/失败/冲突都明示）')
assert.ok(clientSource.includes("}, '编辑')") && clientSource.includes("'保存'"), 'FIX-41：A 区有「编辑」与「保存」入口')
assert.equal(fix40QueueBody.includes('postTodo'), false, 'FIX-41（验收⑥）：B 区仍只读（不含任何写路径）')
const fix40AuditBody = clientSource.slice(clientSource.indexOf('const renderAuditBar = ()'), clientSource.indexOf('const renderHumanTodo = ()'))
assert.equal(fix40AuditBody.includes('postTodo'), false, 'FIX-41（验收⑥）：审计区仍只读')
// 路由注册：插件启动就把写通道挂上（真跑 apply）
assert.ok(makeCtx().routes.length === 0, 'sanity：新 ctx 的 routes 是空的')
const fix41Ctx = makeCtx()
plugin.apply(fix41Ctx.ctx, fix30Cfg)
assert.equal(fix41Ctx.routes.length, 1, 'FIX-41：启动时注册**一条**写路由')
assert.equal(fix41Ctx.routes[0].path, TODO_ROUTE_PATH, 'FIX-41：路由路径与 client 用的常量一致')
assert.equal(fix41Ctx.routes[0].kind, 'exact', 'FIX-41：精确匹配一条路径（不做前缀，缩小暴露面）')
assert.equal(typeof fix41Ctx.routes[0].handler, 'function', 'FIX-41：路由必须带处理器')
ok('FIX-41 待办可勾可编：唯一可写目标（越权路径 403）+ 行级翻转（其余字节零改动）+ 写前备份 + 指纹冲突 409 + 五类拒绝 / client 走宿主写路由并明示状态 / B 区与审计区仍只读')

// ---------------------------------------------------------------- FIX-43 面板不再堆说明文字（用户口径）
// 用户原话："这些提示文字都不需要，他们是写在文档里的而不是这个页面中占地方"喵。
assert.equal(clientSource.includes('只读视图。'), false, 'FIX-45：「只读视图…」说明文字已从面板撤掉')
assert.equal(clientSource.includes("'徽章符号：'"), false, 'FIX-45：常驻的「徽章符号」一行已撤掉（五态对照折叠进「徽章说明」）')
assert.equal(clientSource.includes('这是**数据源**为空，不是过滤造成的'), false, 'FIX-45：空态的解释句也收进 tooltip 了')
// 能力不减：诊断信息仍在（挪进 tooltip），五态对照仍可展开
assert.ok(/title: \[[\s\S]{0,200}snapshot\.notes/.test(clientSource), 'FIX-45：快照诊断（没读/读了没有）挪进审计条的 tooltip —— 能力没丢，只是不占版面')
assert.ok(clientSource.includes("['ok', 'warn', 'missing', 'unknown', 'na'].map(badgeText).join(' / ')"), 'FIX-45：五态「符号 + 中文名」对照仍可展开查看')
ok('FIX-45 面板去装饰：撤掉「只读视图…」「徽章符号：…」与空态解释句（信息归文档/tooltip），跳转、诊断与五态对照的能力一个没减')

// ---------------------------------------------------------------- FIX-42 尾换行让"未改动"也 409（根因在宿主 cutPage）
// 报告给的根因我按 EXECUTOR-RULES §5 自己核过一遍：`packages/api/workspace-files/src/index.ts` 的 `cutPage()`
// 收尾那步是 `if (current.length > 0) complete()` —— 文件以 `\n` 结尾时 `current === ''`，
// **尾空行不 push** ⇒ `lines.join('\n')` 把结尾换行吃掉；而宿主写路由用 node `readFile()` 保留它喵。
// 于是 client 送来的 baseHash 与宿主算的**永远不同** ⇒ 未改动也 409（保护逻辑没错，是两份文本不是同一份）喵。
/** 模拟宿主读通道的 `cutPage()`：文件以换行结尾时**吃掉那一个尾换行**（逐字对齐上面那段实现）喵。 */
const cutPageText = (raw) => (String(raw).endsWith('\n') ? String(raw).slice(0, -1) : String(raw))
const fix42Raw = '# 大方向\n\n- [ ] 批次一\n- [x] 批次零\n'
const fix42SeenByClient = cutPageText(fix42Raw)
assert.notEqual(hashTextHost(fix42Raw), hashTextHost(fix42SeenByClient), 'FIX-42：给"磁盘原文"与"宿主读回来的文本"的指纹确实不同（这就是 409 的成因）')
assert.equal(fix42Raw.endsWith('\n') && !fix42SeenByClient.endsWith('\n'), true, 'FIX-42：差异就是那个尾换行')
// 规范化后必须一致（且两端的规范化实现要逐字一致）
assert.equal(hashOf(fix42Raw), hashOf(fix42SeenByClient), 'FIX-42：规范化后两侧指纹必须相等')
for (const sample of ['', '\n', 'a\n', 'a\n\n', 'a\r\n', 'a\r\n\r\n', '# 中文\n- [x] 迁移\n']) {
  assert.equal(
    view.normalizeHashInput(sample), normalizeHashInput(sample),
    `FIX-42：client 与宿主的归一化必须逐字一致（样本 ${JSON.stringify(sample)}）`,
  )
}
assert.equal(hashTextHost(normalizeHashInput('a\n\n')), hashTextHost(normalizeHashInput('a')), 'FIX-42：尾部多个换行也归一化（宿主只吃一个，剩下的会露馅）')
// 真跑一遍 handler：**文件未改动**（client 用"少了尾换行"的文本算指纹）→ 必须 200（这就是验收位）
const fix42Writes = []
const fix42Handler = createTodoHandler({
  getProject: () => fix41Project,
  fence: () => true,
  write: async ({ path, text }) => { fix42Writes.push({ path, text }); return { ok: true, backupPath: 'D:\\备份\\待办.md' } },
  read: async () => fix42Raw,   // 宿主侧读到的是**磁盘原文**（含尾换行）
  now: () => 't',
  readBodyImpl: async () => JSON.stringify(fix42Payload),
})
let fix42Payload = {}
const fix42Call = async (payload) => {
  fix42Payload = payload
  const res = makeRes()
  await fix42Handler({ method: 'POST', headers: { host: '127.0.0.1:1' } }, res)
  return res
}
let fix42Res = await fix42Call({
  path: fix41Project.panel.todoFile, action: 'toggle', line: 2, baseHash: hashTextHost(fix42SeenByClient),
})
assert.equal(fix42Res.status, 200, 'FIX-42（验收）：**未改动**的文件点勾选必须 200 —— client 用的是"宿主读回来"的文本算指纹')
assert.equal(fix42Res.body.value.changed, true, 'FIX-42：确实翻转了勾选')
assert.ok(fix42Res.body.value.backupPath, 'FIX-42：写前备份照旧（护栏没被这次修复削弱）')
assert.equal(fix42Writes.length, 1, 'FIX-42：只写一次')
assert.equal(fix42Writes[0].text.endsWith('\n'), true, 'FIX-42：翻转走的是**宿主侧原文**，尾换行一字不动')
// 保护逻辑不许被"规范化"顺手废掉：文件**真被外部改过**（中间内容变了）→ 仍旧 409
fix42Res = await fix42Call({
  path: fix41Project.panel.todoFile, action: 'toggle', line: 2, baseHash: hashTextHost(cutPageText('# 别人改过的标题\n- [ ] 批次一\n')),
})
assert.equal(fix42Res.status, 409, 'FIX-42：外部真的改过 → 仍然 409（护栏没被放水）')
assert.equal(fix42Writes.length, 1, 'FIX-42：冲突时一个字都不写')
// 保存要**保住文件的换行约定**：client 送来的内容天然没有尾换行，别把文件的尾换行悄悄删掉
assert.equal(preserveTrailingNewline('a\n', 'a'), 'a\n', 'FIX-42：原文件以换行结尾 → 保存时补回一个')
assert.equal(preserveTrailingNewline('a', 'a'), 'a', 'FIX-42：原本没有尾换行就不补')
fix42Res = await fix42Call({
  path: fix41Project.panel.todoFile, action: 'save', content: '# 我改过的标题\n- [ ] 批次一', baseHash: hashTextHost(fix42SeenByClient),
})
assert.equal(fix42Res.status, 200, 'FIX-42：保存未改动过的文件也要 200')
assert.ok(fix42Writes[fix42Writes.length - 1].text.endsWith('\n'), 'FIX-42：保存后文件的尾换行仍在（不因"读回来少了"而丢掉）')
// 文案不许声称按钮在某个位置（实测刷新在顶部左侧，报告 FIX-43 那条）
assert.equal(clientSource.includes('右上'), false, 'FIX-43：文案不得再写「右上」（刷新按钮不在那儿）')
assert.ok(clientSource.includes('点顶部的「↻ 刷新」'), 'FIX-43：冲突提示要给出不依赖位置的说法')
assert.ok(view.STALE_SNAPSHOT_NOTE.includes('「↻ 刷新」'), 'FIX-43：陈旧提示里也保留"可刷新"的可操作线索')
ok('FIX-42 = 报告尾换行案子 + FIX-43 按钮位置文案：复现宿主 cutPage 吃尾换行 → 规范化后两侧指纹一致 / 未改动文件点勾选 200（真改过仍 409）/ 保存保住尾换行 / 文案不再声称按钮位置')

// ================================================================ 核验轮二：FIX-45~51（面板可写通道 · 契约瘦身 · 检索质量）
// ---------------------------------------------------------------- FIX-45【高】读取与哈希同源（假冲突 409 治本）
const fix45Md = '# 大方向\n\n- [ ] 批次一\n'
const fix45Log = []
const fix45Handler = createTodoHandler({
  getProject: () => fix41Project,
  fence: () => true,
  write: async ({ path, text }) => { fix45Log.push({ path, text }); return { ok: true, backupPath: 'D:\\备份' } },
  read: async () => fix45Md,
  now: () => 't',
  readBodyImpl: async () => JSON.stringify(fix45Payload),
})
let fix45Payload = {}
const fix45Call = async (payload) => {
  fix45Payload = payload
  const res = makeRes()
  await fix45Handler({ method: 'POST', headers: { host: '127.0.0.1:1' } }, res)
  return res
}
// ① 面板的读取也走这条路由：一处读、一处算哈希（结构上消灭"两侧读法不同"）喵
const fix45Read = await fix45Call({ path: fix41Project.panel.todoFile, action: 'read' })
assert.equal(fix45Read.status, 200, 'FIX-45：`action:read` 必须可用（面板读取走同一条路由）')
assert.equal(fix45Read.body.value.text, fix45Md, 'FIX-45：读回来的就是宿主侧文本')
assert.equal(fix45Read.body.value.hash, hashOf(fix45Md), 'FIX-45：`hash` 就是宿主对**同一份文本**算的权威指纹')
assert.equal(fix45Read.body.value.length, fix45Md.length, 'FIX-45：长度一并给出（诊断用）')
assert.equal(fix45Log.length, 0, 'FIX-45：读动作绝不写盘')
// ② 契约：用宿主下发的指纹去写 ⇒ 未改动必须 200（真机上"假冲突"的直接回归位）
fix45Payload = { path: fix41Project.panel.todoFile, action: 'toggle', line: 2, baseHash: fix45Read.body.value.hash }
const fix45Toggle = makeRes()
await fix45Handler({ method: 'POST', headers: { host: '127.0.0.1:1' } }, fix45Toggle)
assert.equal(fix45Toggle.status, 200, 'FIX-45（验收①）：宿主下发的指纹 + 未改动 ⇒ 写入成功，不再假冲突')
assert.equal(fix45Log.length, 1, 'FIX-45：确实写了一次')
// ③ 409 必须回带宿主的实际值（一次对比即可定位"两侧读法不同"）
const fix45Conflict = await fix45Call({ path: fix41Project.panel.todoFile, action: 'toggle', line: 2, baseHash: 'deadbeef' })
assert.equal(fix45Conflict.status, 409, 'FIX-45（验收②）：人造"外部改过"仍正确报 409')
assert.equal(fix45Conflict.body.actualHash, hashOf(fix45Md), 'FIX-45（验收③）：409 要回带宿主侧 actualHash')
assert.equal(fix45Conflict.body.actualLength, fix45Md.length, 'FIX-45（验收③）：409 要回带宿主侧 actualLength')
assert.equal(fix45Log.length, 1, 'FIX-45：冲突时一个字都不写')
// ④ 越权路径对 read 动作同样 403；GET 仍 405（读写成同一个 POST 动作面）
const fix45Forbidden = await fix45Call({ path: joinUnderRoot(fix41Project.root, '别的.md'), action: 'read' })
assert.equal(fix45Forbidden.status, 403, 'FIX-45（验收④）：读动作也受白名单约束')
const fix45Get = await fix45Call({ path: fix41Project.panel.todoFile, action: 'read' })
assert.equal(fix45Get.status, 200, 'sanity：POST 可用')
const fix45GetRes = makeRes()
await fix45Handler({ method: 'GET', headers: { host: '127.0.0.1:1' } }, fix45GetRes)
assert.equal(fix45GetRes.status, 405, 'FIX-45（验收④）：GET 仍 405（读走 POST 的 read 动作）')
// ⑤ client 侧：指纹只认宿主下发的那个；没有它就不发写入
assert.ok(clientSource.includes("const baseHash = todoHash"), 'FIX-45：client 必须用**宿主下发**的指纹做 baseHash')
assert.ok(clientSource.includes("{ path: todoPath, action: 'read' }"), 'FIX-45：A 区读取走同一条宿主路由')
assert.ok(clientSource.includes('if (!todoWritable) {'), 'FIX-45：拿不到权威指纹时**不发写入**（宁可编辑不可用）')
assert.ok(clientSource.includes('todoConflictDetail'), 'FIX-45：冲突诊断（实际值）要能显示出来')
assert.ok(String(view.todoConflictDetail({ error: { code: 'stale-file' }, actualHash: 'abc', actualLength: 12 })).includes('abc'), 'FIX-45：诊断里要带宿主侧 hash')
ok('FIX-45 读取与哈希同源：面板读取走同一条宿主路由（read 动作）/ 未改动点勾选 200（假冲突治本）/ 409 回带 actualHash 与长度 / 越权 403 · GET 405 / 无权威指纹不发写入')

// ---------------------------------------------------------------- FIX-46 提示文案不写方位
assert.equal(clientSource.includes('右上'), false, 'FIX-46：提示里不得再出现"右上"')
assert.ok(clientSource.includes('点顶部的「↻ 刷新」'), 'FIX-46：改成不依赖方位（"顶部的「↻ 刷新」"）')
ok('FIX-46 409 文案方位：不再写"右上"，改为"顶部的「↻ 刷新」"')

// ---------------------------------------------------------------- FIX-47 轮询节拍 + 低频整轮重载（成员树跟上）· FIX-65 提速
// **口径变更（FIX-65，用户要求"面板自动刷新很慢"）**：间隔 20s → **5s**，整轮重载 60s → **30s**。
// 这不是放宽：下限断言仍在（≥5000ms），且整轮重载的**最坏延迟**从 60s 收紧到 30s 喵
assert.equal(view.PANEL_POLL_MS, 5_000, 'FIX-65：轮询间隔收到 5 秒（原来 20s ⇒ 宿主动作后最坏 ≈22s 才看见）')
assert.ok(view.PANEL_POLL_MS >= 5_000, 'FIX-65：间隔**不得低于** 5 秒（设置页滑块下限，不越界）')
assert.ok(view.PANEL_FULL_RELOAD_EVERY >= 3, `FIX-47：整轮重载要低频（≥3 拍），实际 ${view.PANEL_FULL_RELOAD_EVERY}`)
const fix47Modes = [1, 2, 3, 4, 5, 6, 7].map((tick) => view.nextPollMode(tick))
assert.deepEqual(
  toHost(fix47Modes),
  ['snapshot', 'snapshot', 'snapshot', 'snapshot', 'snapshot', 'full', 'snapshot'],
  'FIX-65：每 6 拍（5s×6=30s）一次整轮重载，其余只重读快照',
)
assert.equal(view.nextPollMode(0), 'snapshot', 'FIX-47：第 0 拍不开整轮（挂载那一下已经读过整轮了）')
assert.equal(view.nextPollMode(3, 1), 'full', 'FIX-47：节拍大小可配（每拍都整轮）')
assert.ok(
  /if \(nextPollMode\(tick\) === 'full'\) \{ void loadAll\(\) \} else \{ void pollRef\.current\(\) \}/.test(clientSource),
  'FIX-47：轮询回调必须按节拍分流（整轮 / 只快照）',
)
assert.ok(
  view.PANEL_POLL_MS * view.PANEL_FULL_RELOAD_EVERY <= 30_000,
  `FIX-65（验收③）：成员树最坏要在 ~30s 内跟上（原来 60s），实际 ${view.PANEL_POLL_MS * view.PANEL_FULL_RELOAD_EVERY}ms`,
)
// FIX-65 验收①②④：切回可见**立刻**刷一次；隐藏期间仍然暂停
assert.ok(clientSource.includes("addEventListener('visibilitychange'"), 'FIX-65（验收②）：要监听 visibilitychange')
assert.ok(
  /const onVisibility = \(\) => \{ if \(doc && !doc\.hidden\) pollOnce\(\) \}/.test(clientSource),
  'FIX-65（验收②）：从隐藏变可见 ⇒ **立即** poll 一次（不等下一拍）',
)
assert.ok(/const pollOnce = \(\) => \{\s*\n\s*if \(!shouldPoll\(doc\)\) return/.test(clientSource), 'FIX-65（验收④）：隐藏时跳过轮询的行为**保留**（别白烧 IO）')
assert.ok(clientSource.includes('removeEventListener'), 'FIX-65：卸载要摘掉监听，不留悬挂的 handler')
assert.ok(clientSource.includes('audit.asOf') || clientSource.includes('snapshot.audit.asOf'), 'FIX-47（可选）：审计数据"截至何时"要能露出来（tooltip）')
ok('FIX-47/65 轮询节拍：5s 只重读快照 / 每 6 拍（30s）一次整轮重载让成员树跟上 / 切回可见立即刷一次 / 节拍纯函数可断言')

// ---------------------------------------------------------------- FIX-48 文档切片默认不附引文
const fix48Root = await mkdtemp(join(tmpdir(), 'ac-fix48-'))
const fix48Docs = joinUnderRoot(fix48Root, 'docs')
await mkdir(fix48Docs, { recursive: true })
// 5 篇共享一个"到处都是"的词（`工具`，df=5 ⇒ 按 FIX-50 不得当命中原因，整片不该被召回）喵
for (let index = 1; index <= 5; index += 1) {
  await writeFile(joinUnderRoot(fix48Docs, `doc-${index}.md`), `# 文档 ${index}\n\n## 结论\n\n这里提到工具。\n`, 'utf8')
}
// 第 6 篇：有两个**只它出现**的强信号词（df=1 ×2）⇒ 排 Top-1 且达"强信号 ≥2"的引文例外条件喵
await writeFile(joinUnderRoot(fix48Docs, 'doc-6.md'), '# 迁移包\n\n## 结论\n\n迁移包与契约引擎的关系。\n', 'utf8')
const fix48Project = {
  root: fix48Root, docsDirs: [fix48Docs], deliverablesDir: joinUnderRoot(fix48Root, 'out'),
  tasksDir: joinUnderRoot(fix48Root, '任务'), progressDir: joinUnderRoot(fix48Root, '进度'),
}
// ① "到处都是"的词（df≥3）单独查 → **零召回**（宁缺勿滥；这也是 FIX-50 验收④）喵
assert.deepEqual(toHost(await searchDocs(fix48Project, ['工具'])), [], 'FIX-48/50：命中 ≥3 篇的词不得作为命中原因（单独查它就零召回）')
// ② 只有**一个**强信号词 → 召回但**不带引文**（低相关召回的回归位）喵
const fix48Low = await searchDocs(fix48Project, ['契约引擎'])
assert.equal(fix48Low.length, 1, 'FIX-48：强信号词要能召回')
assert.equal(fix48Low[0].path.endsWith('doc-6.md'), true, 'FIX-48：召回到正确的那一篇')
assert.equal(fix48Low[0].excerpt, undefined, 'FIX-48（验收①）：**低相关（单命中）召回不带引文**')
assert.ok(fix48Low[0].hitReason.length <= 3, 'FIX-48：命中原因至多 3 个词')
assert.ok(fix48Low[0].hitReason.length > 0, 'FIX-48：命中原因不能为空')
// ③ 两个强信号词都命中同一篇 → 该片（Top-2 内）才附引文，且 ≤200 字符喵
const fix48High = await searchDocs(fix48Project, ['迁移包', '契约引擎'])
assert.equal(fix48High.length, 1, 'FIX-48：只有强信号词命中的片被召回')
assert.ok(fix48High[0].excerpt, 'FIX-48（验收②）：强信号词 ≥2 且 Top-2 ⇒ 附引文')
assert.ok(fix48High[0].excerpt.length <= 200, 'FIX-48（验收②）：引文 ≤200 字符')
assert.ok(fix48High.filter((hit) => hit.excerpt).length <= 2, 'FIX-48（验收②）：至多 2 篇带引文')
assert.equal(SLICE_BUDGET, 1200, 'FIX-48（验收③）：切片段上限 1200 字符')
// ④ 切片段超限时：装配自动丢引文（只留路径 + 命中原因 + readHints）喵
const fix48Many = joinUnderRoot(fix48Root, 'docs2')
await mkdir(fix48Many, { recursive: true })
// 11 篇各有**独有词**（df=1 ⇒ 都算强信号 ⇒ 都被召回）；前两篇另有一个**两句共现**的词（df=2 ⇒ 仍算强信号）
// 这样切片段条目多到必然超 1200 字符，且其中 2 篇本来够条件带引文 ⇒ 能真的验证"超限丢引文"喵
for (let index = 1; index <= 11; index += 1) {
  const shared = index <= 2 ? '共现词' : ''
  await writeFile(
    joinUnderRoot(fix48Many, `big-${index}.md`),
    `# 大文档 ${index}

## 结论

独有词${index} 与 ${shared} 的细节。

## 依据

依据段落。

## 风险与待确认

风险段落。

## 下一步

下一步段落。
`,
    'utf8',
  )
}
const fix48Cfg = plugin.Config({
  project: { name: 'F48', root: fix48Root },
  paths: { tasksDir: '任务', progressDir: '进度', deliverablesDir: 'out', docsDirs: ['docs2'] },
})
const fix48Brief = [...Array.from({ length: 11 }, (_, i) => `独有词${i + 1}`), '共现词'].join(' ')
const fix48Contract = await buildContract({
  config: fix48Cfg, roleId: 'researcher', task: { id: 'T-901', brief: fix48Brief }, parent: '主代理', layer: 1, totalAgents: 1,
})
const fix48Slice = fix48Contract.segments.find((segment) => segment.id === 'slices')
assert.ok(fix48Slice.chars > 0 && fix48Slice.chars <= SLICE_BUDGET, `FIX-48（验收③）：切片段必须在 ${SLICE_BUDGET} 字符以内，实际 ${fix48Slice.chars}`)
assert.ok(fix48Contract.text.includes('readHints'), 'FIX-48：切片段仍要给出读法建议（让子代理自己去 read）')
const fix48SliceText = fix48Contract.segments.find((segment) => segment.id === 'slices').text
assert.ok(fix48Contract.text.includes('大文档 1'), 'FIX-48：条目本身要保留')
// 守卫必须**真的够得到**：把小预算注进去，引文就该被丢掉；给足预算则保留（两个方向都断言）
const fix48FixtureHits = [
  { path: 'a.md', title: '甲', hitReason: ['迁移包'], readHints: ['结论'], excerpt: 'x'.repeat(200) },
  { path: 'b.md', title: '乙', hitReason: ['契约引擎'], readHints: ['结论'], excerpt: 'y'.repeat(200) },
]
const fix48Tight = fitSlicesToBudget({ keywords: ['迁移包', '契约引擎'], hits: fix48FixtureHits, budget: 320 })
assert.equal(fix48Tight.includes('引文（≤200 字符'), false, 'FIX-48（验收③）：**超限就丢引文**（守卫真的够得到，不是摆设）')
assert.ok(countChars(fix48Tight) <= 320 || !fix48Tight.includes('引文'), 'FIX-48：丢引文后只剩 路径 + 命中原因 + readHints')
assert.ok(fix48Tight.includes('a.md') && fix48Tight.includes('readHints'), 'FIX-48：丢的是引文，召回条目与读法建议都还在')
const fix48Loose = fitSlicesToBudget({ keywords: ['迁移包', '契约引擎'], hits: fix48FixtureHits, budget: 5000 })
assert.ok(fix48Loose.includes('引文（≤200 字符'), 'FIX-48：预算充足时引文照常保留（别一刀切）')
ok('FIX-48 切片不附引文：低相关零引文 / 强信号词至多 2 篇带 ≤200 字符引文 / 切片段 ≤1200 字符（超限丢引文只留路径+readHints）')

// ---------------------------------------------------------------- FIX-49 删掉重复的"状态槽汇总"
// 形状更新（FIX-101，不是放宽）：多了 `spec` 段（文档规范 + 本轮解析结果 + 权威顺序）喵
assert.deepEqual(
  toHost(contract.segments.map((segment) => segment.id)),
  ['mandate', 'role', 'task', 'spec', 'slices', 'capability'],
  'FIX-49：契约段里不再有 `slots`（状态槽汇总整段删除）；FIX-101 起多了 `spec` 段',
)
assert.equal(contract.text.includes('此处仅作汇总'), false, 'FIX-49：不得再出现"仅作汇总"式重复段落')
assert.ok(contract.text.includes('当前层数：`1`'), 'FIX-49：槽位取值仍必须在总纲里就地替换（不能删漏）')
ok('FIX-49 删状态槽汇总段：契约不再重复列 6 个槽位取值（就地替换已足够）')

// ---------------------------------------------------------------- FIX-50 停用词补英文通用词与项目名 / 命中原因可读
assert.equal(isStopWord('tool'), true, 'FIX-50：英文通用词要进停用词')
assert.equal(isStopWord('error'), true, 'FIX-50：错误/文件这类同样')
assert.equal(isStopWord('write'), false, 'FIX-50（验收②）：**工具名不算泛词**（read/write/edit 有区分度）')
assert.equal(isStopWord('pwsh'), false, 'FIX-50（验收②）：终端工具名同样保留区分度')
assert.equal(isStopWord('doc_emit'), false, 'FIX-50（验收②）：我们自己的工具名也别剔')
const fix50Stops = searchStopWords(plugin.Config({ project: { name: 'Blockdustry' }, search: { stopWords: ['自造泛词'] } }))
assert.equal(isStopWord('blockdustry', fix50Stops), true, 'FIX-50：项目名要被视为泛词（几乎每篇都有）')
assert.equal(isStopWord('自造泛词', fix50Stops), true, 'FIX-50：配置的额外停用词生效')
assert.equal(isStopWord('迁移包', fix50Stops), false, 'FIX-50：正常实词不受影响')
// 纯项目名查询 → 零召回，且命中原因为空（验收①）
assert.deepEqual(toHost(await searchDocs(fix48Project, ['blockdustry'], 5, { stopWords: fix50Stops })), [], 'FIX-50（验收①）：纯项目名查询零召回')
// 命中 ≥3 篇的词不当命中原因；只剩它的时候连召回都不要（验收④）
const fix50Df = await searchDocs(fix48Project, ['探针', '迁移包'])
assert.equal(fix50Df.some((hit) => hit.hitReason.includes('探针')), false, 'FIX-50（验收④）：出现在 ≥3 篇里的词不得再作为命中原因')
assert.equal(fix50Df.every((hit) => hit.hitReason.every((word) => !isStopWord(word, fix50Stops))), true, 'FIX-50（验收③）：命中原因里的词都不在停用词表内')
assert.equal(fix50Df.every((hit) => hit.hitReason.length > 0), true, 'FIX-50：召回的每片都要有实词命中原因')
ok('FIX-50 命中原因可读 + 停用词补全：英文通用词与项目名（可配 search.stopWords）不算实词 / 工具名保留区分度 / ≥3 篇的词不当命中原因 / 纯泛词与纯项目名零召回')

// ---------------------------------------------------------------- FIX-51 升级后快照自愈 + 失败原因具体化
const fix51Writes = []
const fix51Make = (previous, currentVersion = '0.4.1') => createPanelSync({
  store: fix30Store, project: fix41Project,
  write: async ({ audit }) => { fix51Writes.push({ audit }); return { ok: true, pluginVersion: currentVersion } },
  readPrevious: async () => previous,
  setTimer: (fn) => { const timer = { fn }; return timer }, clearTimer: () => {},
})
// ① 旧版本写的快照 ⇒ 启动即自愈（用户不需要做任何事）
const fix51Old = fix51Make({ pluginVersion: '0.4.0', generatedAt: 't', audit: { level: 'red', red: 1, yellow: 2, items: [] } })
const fix51Heal = await fix51Old.heal({ currentVersion: '0.4.1' })
assert.equal(fix51Heal.healed, true, 'FIX-51（验收①）：写入方版本不一致 ⇒ 立刻重写一次')
assert.equal(fix51Writes.length, 1, 'FIX-51：自愈要真的写一次')
assert.equal(fix51Writes[0].audit.counts.red, 1, 'FIX-51：自愈时同样沿用上次审计结论（不谎报全绿）')
// ② 版本一致 ⇒ 不写（省 IO）
const fix51Same = fix51Make({ pluginVersion: '0.4.1' })
const fix51Noop = await fix51Same.heal({ currentVersion: '0.4.1' })
assert.equal(fix51Noop.healed, false, 'FIX-51：版本一致就不重写（别做无谓 IO）')
assert.equal(fix51Writes.length, 1, 'FIX-51：没有多余写入')
// ③ 没有快照（首次启动）也要生成
const fix51Fresh = fix51Make(null)
assert.equal((await fix51Fresh.heal({ currentVersion: '0.4.1' })).healed, true, 'FIX-51：快照不存在时启动即生成')
assert.equal(fix51Writes.length, 2, 'FIX-51：真实写了两次')
// ④ 挂上就自愈（源码位 + 行为位）
const fix51SyncSrc = await readFile(new URL('./src/panel/snapshot-sync.js', import.meta.url), 'utf8')
assert.ok(fix51SyncSrc.includes('void sync.heal()'), 'FIX-51：`attachPanelSync` 挂上就自愈一次')
assert.ok(fix51SyncSrc.includes('pluginVersion'), 'FIX-51：自愈要比对"写入方版本 vs 当前插件版本"')
// ⑤ A 区"没去读"必须说清原因，不许兜底成"未知原因"（与 FIX-14 同类错误）
assert.ok(
  clientSource.includes('快照未提供待办文件路径（快照陈旧或未生成'),
  'FIX-51（验收②）：`!todoPath` 那条早退路径要给出**具体原因**',
)
assert.ok(
  /setTodoReason\('快照未提供待办文件路径/.test(clientSource),
  'FIX-51：原因要在那条早退路径里真的被设置（而不是渲染期兜底）',
)
// 兜底话术也不许是"未知原因"：三处都换成"下一步做什么"（点「↻ 刷新」重试）——
// 注释里写明历史不算，关键是**用户看得见的那几处**一句都不能是"未知原因"喵
const fix51ReasonLines = clientSource.split('\n').filter((line) => line.includes('未知原因') && !line.trim().startsWith('//'))
assert.deepEqual(toHost(fix51ReasonLines), [], "FIX-51（验收②）：源码里不得留下把用户晾在原地的『未知原因』兜底")
ok('FIX-51 升级即自愈 + 原因具体化：写入方版本不一致/快照缺失 ⇒ 启动立刻重写（沿用上次审计）/ 版本一致不折腾 / A 区"没读"给具体原因不留"未知原因"')

// ---------------------------------------------------------------- FIX-52 设置页：开关 + 可编辑「调用 JSON」
// ① 命名空间 = **插件行 id**（宿主按 profile 里那一行的 Loader entry id 寻址表单）喵
assert.equal(view.SETTINGS_NS, 'agent-contract', 'FIX-52：设置命名空间必须是插件行 id（别自造存储）喵')
assert.deepEqual(toHost(view.SETTINGS_TOP_KEYS), ['modelRoutes', 'panel'], 'FIX-52（验收④）：顶层键白名单只有 modelRoutes / panel')
// ② 合法 JSON：字符串模型名与对象路由参数**两种形态都要吃**（插件侧本来两种都支持）喵
const fix52Good = JSON.stringify({
  modelRoutes: { adversary: { model: 'glm-4' }, implementer: 'deepseek-chat', librarian: { provider: 'x', model: 'cheap', maxTokens: 2048 } },
  panel: { hideDoneOneShot: false, pollSeconds: 30, defaultView: 'topology', badgeLabels: false },
})
const fix52Verdict = view.validateSettingsJson(fix52Good)
assert.equal(fix52Verdict.ok, true, `FIX-52：合法 JSON 必须通过，实际 ${JSON.stringify(toHost(fix52Verdict.errors || []))}`)
assert.equal(fix52Verdict.value.modelRoutes.adversary.model, 'glm-4', 'FIX-52（验收③）：对抗审查的路由参数要能存下')
assert.equal(fix52Verdict.value.modelRoutes.implementer, 'deepseek-chat', 'FIX-52：字符串形态（模型名）同样保留')
assert.deepEqual(
  toHost(view.settingsWritesOf(fix52Verdict.value)),
  [
    { field: 'modelRoutes', value: fix52Verdict.value.modelRoutes },
    { field: 'panel', value: fix52Verdict.value.panel },
  ].map((row) => toHost(row)).map((row) => ({ field: row.field, value: row.value })),
  'FIX-52：保存要写成两个字段（modelRoutes / panel），走宿主表单的 set(field, value)',
)
// ③ 非法 JSON / 越界顶层键 / 塞 apiKey / 角色 id / 值类型 —— 每条都要**拒绝并指出错在哪**喵
const fix52Cases = [
  ['{"modelRoutes": ', '(整段 JSON)', '语法'],
  ['{"paths": {"tasksDir": "x"}}', 'paths', 'cordis.patch.yml'],
  ['{"modelRoutes": {"unknown-role": "m"}}', 'modelRoutes.unknown-role', '内置角色'],
  ['{"modelRoutes": {"adversary": {"apiKey": "sk-123"}}}', 'modelRoutes.adversary.apiKey', '密钥'],
  ['{"modelRoutes": {"adversary": {"token": "t"}}}', 'modelRoutes.adversary.token', '密钥'],
  ['{"panel": {"api_key": "sk"}}', 'panel.api_key', '密钥'],
  ['{"modelRoutes": {"implementer": 123}}', 'modelRoutes.implementer', '模型名'],
  ['{"modelRoutes": {"adversary": {"model": 1}}}', 'modelRoutes.adversary.model', '类型'],
  ['{"modelRoutes": {"adversary": {"temperature": 1}}}', 'modelRoutes.adversary.temperature', '未知字段'],
  ['{"panel": {"pollSeconds": "20"}}', 'panel.pollSeconds', '类型'],
  ['{"panel": {"未知项": 1}}', 'panel.未知项', '未知设置项'],
  ['{"panel": {"defaultView": "tree"}}', 'panel.defaultView', 'list | topology'],
  ['[]', '(整段 JSON)', 'JSON 对象'],
]
for (const [text, path, needle] of fix52Cases) {
  const verdict = view.validateSettingsJson(text)
  assert.equal(verdict.ok, false, `FIX-52（验收④⑤）：必须拒绝：${text}`)
  const hit = verdict.errors.find((item) => item.path === path)
  assert.ok(hit, `FIX-52：错误要指到具体位置（期望 ${path}，实际 ${JSON.stringify(toHost(verdict.errors.map((e) => e.path)))}）`)
  assert.ok(
    verdict.errors.some((item) => item.message.includes(needle)),
    `FIX-52：错误信息要说清原因（期望含「${needle}」），实际 ${JSON.stringify(toHost(verdict.errors.map((e) => e.message)))}`,
  )
}
// 密钥判定不能误伤普通字段（`monkey` / `keyword` 这类不是密钥）喵
assert.equal(view.isSecretKey('apiKey'), true, 'FIX-52：apiKey 认')
assert.equal(view.isSecretKey('api_key'), true, 'FIX-52：api_key 认')
assert.equal(view.isSecretKey('API-KEY'), true, 'FIX-52：大小写与连字符都要认')
assert.equal(view.isSecretKey('monkey'), false, 'FIX-52：`monkey` 不是密钥字段（别误伤）')
assert.equal(view.isSecretKey('keyword'), false, 'FIX-52：`keyword` 不是密钥字段')
// ④ 编辑区初始文本：来自**配置（= cordis.patch.yml 那一层）**，且能往返解析回来喵
const fix52Seed = view.settingsJsonText({ modelRoutes: { researcher: 'cheap-model' }, panel: { pollSeconds: 45 } })
const fix52SeedParsed = JSON.parse(fix52Seed)
assert.equal(fix52SeedParsed.modelRoutes.researcher, 'cheap-model', 'FIX-52：编辑区要回显配置文件里的路由')
assert.equal(fix52SeedParsed.panel.pollSeconds, 45, 'FIX-52：编辑区要回显面板开关')
assert.equal(view.validateSettingsJson(fix52Seed).ok, true, 'FIX-52：编辑区初始文本本身必须合法（否则用户一进来就报错）')
// ⑤ 面板设置取值：类型不对回落默认、pollSeconds 夹取（5~300）喵
assert.deepEqual(
  toHost(view.panelPrefsFrom({ panel: { pollSeconds: 1, hideDoneOneShot: 'yes', defaultView: 'nope' } })),
  { hideDoneOneShot: true, autoRefresh: true, pollSeconds: 20, defaultView: 'list', badgeLabels: true },
  'FIX-52：非法类型/越界值一律回落默认（pollSeconds 下限 5 秒）',
)
assert.equal(view.panelPrefsFrom({ panel: { pollSeconds: 9999 } }).pollSeconds, 300, 'FIX-52：pollSeconds 上限 300 秒（别慢到没意义）')
assert.equal(view.panelPrefsFrom({ panel: { pollSeconds: 45 } }).pollSeconds, 45, 'FIX-52：合法值原样保留')
// ⑥ 注册：用宿主官方机制（slots.register + configForms.get），且**不依赖 betterSidebar** 喵
const fix52Sections = []
const fix52Unregistered = []
const fix52Forms = { getSnapshot: () => ({ value: { panel: { pollSeconds: 25 } } }), subscribe: () => () => {}, set: async () => true, unset: async () => true }
const fix52Ctx = {
  slots: {
    inject: (name, cb) => { fix52Sections.push({ name }); cb() },
    register: (descriptor, component) => { fix52Sections.push({ descriptor, component }); return () => fix52Unregistered.push(descriptor.id) },
  },
  configForms: { get: (ns) => { fix52Sections.push({ ns }); return fix52Forms } },
}
const fix52Off = view.registerSettingsSection(fix52Ctx)
assert.equal(typeof fix52Off, 'function', 'FIX-52：注册成功要给出注销函数')
const fix52Descriptor = fix52Sections.find((row) => row.descriptor).descriptor
assert.equal(fix52Descriptor.name, 'settings.section', 'FIX-52（验收①）：必须注册到 settings.section 这个槽')
assert.equal(fix52Descriptor.id, view.SETTINGS_NS, 'FIX-52：分区 id = 命名空间（宿主按它寻址表单）')
assert.equal(typeof fix52Descriptor.label, 'function', 'FIX-52：分区要有标题（宿主设置页左侧那一栏）')
assert.equal(typeof fix52Descriptor.inject, 'function', 'FIX-52：要用 inject 把 configForms 面递给组件')
// 组件拿到的表单面是**宿主 configForms.get(本插件命名空间)** 给的（`inject` 是懒执行，宿主渲染时才调）喵
assert.deepEqual(toHost(fix52Descriptor.inject()), toHost({ forms: fix52Forms }), 'FIX-52：组件拿到的是宿主表单面')
assert.ok(fix52Sections.some((row) => row.ns === view.SETTINGS_NS), 'FIX-52：表单要从宿主 configForms.get(本插件命名空间) 取')
assert.equal(typeof fix52Sections.find((row) => row.component).component, 'function', 'FIX-52：分区必须带组件（register 的第二个参数）')
assert.equal(clientSource.includes('settings.pluginToggles'), false, 'FIX-52（验收⑧）：不再靠 pluginToggles 那个"读不回来"的旧通道')
// 拿不到宿主服务（老宿主 / 没有设置页）⇒ 静默不注册，不抛错喵
assert.equal(view.registerSettingsSection({}), null, 'FIX-52（验收⑨）：没有 slots/configForms 时静默降级')
assert.equal(view.registerSettingsSection({ slots: { inject() {}, register() {} } }), null, 'FIX-52：只有 slots 没有 configForms 时同样不注册')
assert.equal(view.registerSettingsSection({ configForms: { get: () => fix52Forms } }), null, 'FIX-52：只有 configForms 没有 slots 时也不注册')
// ⑦ 面板与设置页**同一份值**：面板订阅表单、开关写回设置、轮询间隔来自设置喵
assert.ok(/forms: settingsForms/.test(clientSource), 'FIX-52：tab 组件要拿到设置表单（与设置页同一个面）')
assert.ok(clientSource.includes('forms.subscribe(() => setSettingsTick'), 'FIX-52（验收②⑦）：面板要订阅设置 —— 设置页一改立即反映')
assert.ok(/const prefs = props\.prefs \|\| \{ hideDoneOneShot: settings\.hideDoneOneShot \}/.test(clientSource), 'FIX-52（验收⑤）：没有 tab 级 prefs 时以设置页的值为准')
assert.ok(/writePanelSetting\(props\.forms, \{ hideDoneOneShot: (true|false) \}\)/.test(clientSource), 'FIX-52（验收⑦）：面板内的"显示全部/恢复默认过滤"要写回设置（双向一致且重启后保持）')
assert.ok(/pollIntervalMs = settings\.autoRefresh \? Math\.max\(5, settings\.pollSeconds\) \* 1000 : 0/.test(clientSource), 'FIX-52：轮询间隔/总开关来自设置页')
assert.ok(clientSource.includes('unset(\'modelRoutes\')') && clientSource.includes("unset('panel')"), 'FIX-52（验收⑥）：恢复默认 = unset 两个字段（回到配置文件那一层）')
assert.ok(clientSource.includes("dirty.current = true"), 'FIX-52：编辑中的草稿不能被表单推送冲掉')
ok('FIX-52 设置页：官方 slots/configForms 机制（不自造存储）/ 开关五项 + 调用 JSON 编辑区（字符串与对象两种模型值）/ 五道校验（语法·越界键·密钥红线·角色 id·类型）逐条指出错在哪 / 恢复默认=unset / 面板与设置页同一份值')

// ---------------------------------------------------------------- 验收⑧：README 已知限制第 1 条改写
if (process.argv[2]) {
  const readme52 = await readFile(join(dirname(process.argv[2]), 'README.zh.md'), 'utf8')
  // 口径经三轮演进（真机结论 + 裁决 B），现在是：设置页**管**哪些键、配置文件**管**哪些键，两列写清喵
  assert.ok(
    /(开关[\s\S]{0,80}设置)|(设置[\s\S]{0,80}开关)/.test(readme52),
    'FIX-52（验收⑧）：README 要说明面板开关在设置页里改',
  )
  assert.ok(readme52.includes('volatile'), 'FIX-52/裁决B：README 要写清这些键是"运行时可变（volatile）"')
  assert.ok(/仍归[\s\S]{0,40}cordis\.patch\.yml|仍归 `cordis\.patch\.yml`/.test(readme52), 'FIX-52/裁决B：README 要分列"仍归配置文件的键"')
  assert.ok(readme52.includes('只作示例'), 'FIX-52/裁决B：README 要说明配置文件里被接管的键只作示例（写了不生效）')
  assert.equal(
    readme52.includes('应用没有提供把它读回来的接口'),
    false,
    'FIX-52（验收⑧）：README 已知限制里那句"读不回来"的说法要改掉（现在有正式开关了）',
  )
}
ok('FIX-52 验收⑧ README：已知限制第 1 条改为"已在设置页提供正式开关"（不再是"读不回来"）')

// ---------------------------------------------------------------- FIX-54 客户端**渲染冒烟**（只验"能加载"抓不到渲染期崩）
// 起因 FIX-53：`settings is not defined` —— 模块级组件 NodeRow 抓了 ContractTab 里的局部变量，
// 而套件此前**从不真渲染一次** ⇒ 渲染函数里的 ReferenceError 全漏过，只有真机才炸（与 FIX-11 同族）喵。
/** 一次渲染冒烟：加载 bundle → 注册 → 用假 props 渲染一次，任何 ReferenceError/TypeError 都算红喵。 */
function smokeRenderClientBundle(source) {
  const registry = []
  const sandbox = { window: { __ModuleLoader__: { load: (entry) => registry.push(entry) } }, console: { error: () => {} } }
  try {
    vm.runInNewContext(source, sandbox, { filename: 'smoke-client-tab.js' })
    if (registry.length !== 1) return { ok: false, error: 'bundle 未注册 factory' }
    const mod = registry[0].factory(fakeRequire)
    const tabs = []
    mod.apply({
      betterSidebar: { registerTab: (descriptor) => { tabs.push(descriptor); return () => {} } },
      effect: (cb) => cb(),
    })
    if (!tabs.length) return { ok: false, error: 'apply 未注册 tab' }
    // 两份假 props：列表视图 + 拓扑视图（两条渲染路径都要走一遍，拓扑卡片与徽章行都在其中）喵
    const rendered = ['list', 'topology'].map((view) => tabs[0].component({
      remoteCtx: null,
      scope: { sessionId: 'root-smoke' },
      prefs: null,
      forms: null,
      tab: { id: 'agent-contract:contract', meta: { view, viewChosen: true } },
      snapshot: smokeSnapshot,
    }))
    // 假 React 只造元素、不调用组件 ⇒ 冒烟要自己"展开"函数组件（否则只测到最外层包装喵）
    return { ok: true, rendered: rendered.map(expandSmokeTree) }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}
/**
 * 像 React 那样**展开函数组件**喵：假 React 只把 `h(Component, props)` 造成一个元素，
 * 不调用组件本身 —— 不展开的话冒烟只测到最外层包装，等于没测（FIX-54 的坑）喵。
 */
function expandSmokeTree(node, depth = 0) {
  if (node === null || node === undefined || depth > 40) return node
  if (Array.isArray(node)) return node.map((item) => expandSmokeTree(item, depth + 1))
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') return expandSmokeTree(node.type({ ...(node.props || {}) }), depth + 1)
  return { ...node, children: (node.children || []).map((child) => expandSmokeTree(child, depth + 1)) }
}

/** 把渲染结果（`{type, props, children}` 的普通对象树）里的字符串全收出来，便于断言"徽章真的渲染了"喵。 */
function collectSmokeText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const item of node) collectSmokeText(item, out); return out }
  if (typeof node === 'object') {
    for (const child of node.children || []) collectSmokeText(child, out)
    if (node.props && typeof node.props.title === 'string') out.push(node.props.title)
  }
  return out
}
// 假快照：两条渲染路径都会用到的字段（成员树 + 待办 + 审计 + 徽章）喵
const smokeSnapshot = view.snapshotFromSessions(
  [
    { sessionId: 'root-smoke', running: true, agentAvailable: true, updatedAt: 1, cwd: 'D:\\smoke' },
    { sessionId: 'child-smoke', parentSessionId: 'root-smoke', origin: 'subagent', running: false, agentAvailable: true, updatedAt: 2 },
  ],
  { 'child-smoke': { label: 'T-901-implementer', mode: 'continuable', model: 'same' } },
  'root-smoke',
  {
    schemaVersion: view.PANEL_SNAPSHOT_SCHEMA_VERSION,
    pluginVersion: view.CLIENT_PLUGIN_VERSION,
    generatedAt: 't',
    counts: { members: 2, tasks: 1, docs: 1 },
    members: {},
    // 给子节点一份真徽章：这样 `pending=false`，渲染出来才是 `契约✓` 而不是 `·待接`喵
    membersById: { 'child-smoke': { badges: { contract: 'ok', docs: 'ok', progress: 'ok', budget: 'ok', crossVendor: 'unknown' } } },
    todos: [{ kind: 'task', level: 'yellow', title: '未结任务 T-901', path: 'p', sessionId: null }],
    paths: { todoFile: joinUnderRoot(tmpdir(), 'smoke-待办.md') },
    audit: { level: 'green', red: 0, yellow: 0, asOf: 't', items: [] },
  },
)
const smoke = smokeRenderClientBundle(clientSource)
assert.equal(smoke.ok, true, `FIX-54（验收③）：渲染冒烟必须绿，实际报错：${smoke.ok ? '' : smoke.error}`)
const smokeTexts = smoke.rendered.flatMap((tree) => collectSmokeText(tree))
assert.ok(smokeTexts.some((text) => text.includes('契约')), 'FIX-54（验收①）：要真渲染出面板主体（标题/成员）')
assert.ok(smokeTexts.some((text) => text.includes('契约✓')), 'FIX-54（验收①）：要真渲染出徽章行（`契约✓`）')
assert.ok(smokeTexts.some((text) => text.includes('待办任务（大方向）')), 'FIX-54：A 区要渲染')
assert.ok(smokeTexts.some((text) => text.includes('agent 待办（执行队列）')), 'FIX-54：B 区要渲染')
// 验收②：**把 FIX-53 的 bug 还原**（跨作用域引用）→ 冒烟必须红（否则这条冒烟等于没接）喵
const revertedBug = clientSource.replace('badgeCell(item.key, item.value, props.badgeLabels !== false)', 'badgeCell(item.key, item.value, settings.badgeLabels)')
assert.notEqual(revertedBug, clientSource, 'FIX-54（验收②）：还原位必须能真的改到源码（否则负控是空的）')
const smokeReverted = smokeRenderClientBundle(revertedBug)
assert.equal(smokeReverted.ok, false, 'FIX-54（验收②）：把 FIX-53 的 bug 还原回去，冒烟**必须红**')
assert.ok(
  String(smokeReverted.error).includes('settings is not defined'),
  `FIX-54（验收②）：还原后报的就是那个 ReferenceError，实际：${smokeReverted.error}`,
)
// 同族的跨作用域引用也一并扫：模块级组件里不得抓 ContractTab 的局部变量喵（FIX-53 顺手项）
const crossScopeLocals = ['settings', 'effectivePrefs', 'showAll', 'snapshot', 'todoText', 'todoStatus', 'lastSaved']
const componentBodies = ['NodeRow', 'TopologyView', 'ContractSettingsSection'].map((name) => {
  const at = clientSource.indexOf(`function ${name}(props) {`)
  if (at < 0) return { name, body: '' }
  let depth = 0
  let index = clientSource.indexOf('{', at)
  const startIndex = index
  for (; index < clientSource.length; index += 1) {
    if (clientSource[index] === '{') depth += 1
    else if (clientSource[index] === '}') { depth -= 1; if (depth === 0) break }
  }
  return { name, body: clientSource.slice(startIndex, index) }
})
for (const { name, body } of componentBodies) {
  assert.ok(body.length > 0, `FIX-53：找不到组件 ${name} 的函数体（改名要同步这里）`)
  // 只看**代码**喵：字符串/模板字面量里出现同一个词（`agent-contract-settings` 这类）不算跨作用域引用，
  // 否则扫描器自己就会误报（实测撞过一次）喵
  const code = body
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  const declared = new Set([...code.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))
  for (const local of crossScopeLocals) {
    if (declared.has(local)) continue
    assert.equal(
      new RegExp(`(?<![\\w.$-])${local}\\b`).test(code), false,
      `FIX-53：模块级组件 ${name} 不得跨作用域抓 \`${local}\`（这正是真机崩的原因）`,
    )
  }
}
// 设置页的**可写性诊断**（真机补充）：不可写时控件必须禁用并说明原因 —— 不许给"点了没反应"的假象喵
const settingsNoForms = expandSmokeTree(view.ContractSettingsSection({ forms: null }))
const noFormsTexts = collectSmokeText(settingsNoForms)
assert.ok(noFormsTexts.some((text) => text.includes('未拿到设置存储')), '设置页：拿不到 forms 要明说（不是静默）')
const walkInputs = (node, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((item) => walkInputs(item, out)); return out }
  if (node.props && (node.type === 'input' || node.type === 'textarea' || node.type === 'select' || node.type === 'button')) out.push(node)
  ;(node.children || []).forEach((child) => walkInputs(child, out))
  return out
}
assert.ok(walkInputs(settingsNoForms).every((node) => node.props.disabled === true), '设置页：没有表单时所有控件都要禁用')
const readOnlyForms = {
  getSnapshot: () => ({ status: 'unavailable', mode: 'host', writable: false, revision: undefined, value: undefined }),
  subscribe: () => () => {},
  set: async () => false,
  unset: async () => false,
}
const settingsReadOnly = expandSmokeTree(view.ContractSettingsSection({ forms: readOnlyForms }))
const readOnlyTexts = collectSmokeText(settingsReadOnly)
assert.ok(readOnlyTexts.some((text) => text.includes('不可写')), '设置页：宿主不可写时要明说')
assert.ok(readOnlyTexts.some((text) => text.includes('未暴露给本客户端')), '设置页：`unavailable` 要说清是"命名空间没暴露"')
assert.ok(walkInputs(settingsReadOnly).every((node) => node.props.disabled === true), '设置页：不可写时所有控件都要禁用（别让人点了没反应）')
const writableForms = {
  getSnapshot: () => ({ status: 'ready', mode: 'host', writable: true, revision: 7, value: { panel: { pollSeconds: 25 } } }),
  subscribe: () => () => {},
  set: async () => true,
  unset: async () => true,
}
const settingsWritable = expandSmokeTree(view.ContractSettingsSection({ forms: writableForms }))
const writableTexts = collectSmokeText(settingsWritable)
assert.ok(writableTexts.some((text) => text.includes('可写')), '设置页：可写时要显示状态行（status/mode/revision）')
assert.ok(walkInputs(settingsWritable).every((node) => node.props.disabled !== true), '设置页：可写时控件必须能点')
// 写路径的**形状**与**失败可见性**（真机第二轮：`set('panel', {…})` 被拒而原因被吞）喵
const fix52Ops = []
const fix52MutateForms = {
  getSnapshot: () => ({ status: 'ready', mode: 'host', writable: true, revision: 3, value: { panel: {} } }),
  mutate: async (ops) => { fix52Ops.push(...ops); return true },
}
const fix52WriteOk = await view.writePanelSetting(fix52MutateForms, { pollSeconds: 30 })
assert.equal(fix52WriteOk.ok, true, '设置页：写入成功要返回 ok')
assert.deepEqual(
  toHost(fix52Ops), [{ op: 'set', path: ['panel', 'pollSeconds'], value: 30 }],
  '设置页：必须按**叶子路径数组**写（官方 `set(field)` == `mutate([{op,path:[field],value}])`）',
)
const fix52Reject = await view.writePanelSetting({ mutate: async () => false }, { badgeLabels: false })
assert.equal(fix52Reject.ok, false, '设置页：宿主返回 false 要当失败')
assert.ok(fix52Reject.reason.includes('false'), '设置页：失败要给出原因（不许静默）')
const fix52Throw = await view.writePanelSetting({
  mutate: async () => { const error = new Error('namespace is read-only'); error.code = 'settings/read-only'; throw error },
}, { autoRefresh: true })
assert.equal(fix52Throw.ok, false, '设置页：抛错也要当失败')
assert.ok(fix52Throw.reason.includes('settings/read-only'), `设置页：要把宿主的 error.code 带出来，实际 ${fix52Throw.reason}`)
assert.ok(fix52Throw.reason.includes('namespace is read-only'), '设置页：宿主的原话也要带出来（真机排查就靠这句）')
assert.ok(clientSource.includes('宿主原话'), '设置页：失败原因要以"宿主原话"的形式显示在面板上')
// **volatile 规则**（真机根因 + 一处待裁决的设计冲突）喵：宿主 `@deepseek-ai/dsh-settings` 的
// `isVolatilePath()`（`settings/src/schema.ts:74`）只认 `schema.meta.volatile` —— 没标的字段写入时会被抛
// `Config field "…" is not volatile`，客户端只看到 `set()` 返回 false（原因被吞）⇒ 真机"开关点不动"喵。
assert.equal(
  typeof Schema.boolean().volatile, 'function',
  'sanity：本仓库装的 schemastery 必须支持 .volatile()（宿主靠 meta.volatile 判定可写字段）',
)
// **但** volatile 字段不参与配置文件解析（实测）：标了之后 `panel.pollSeconds: 45` 会被投影成 `{}`，
// 而把已解析过的配置再解析一次会直接 ValidationError ⇒ "设置页可写"与"配置文件当默认层"在宿主这套机制下**天然冲突**喵。
const volatileProbe = Schema.object({ probe: Schema.number().default(20).volatile() })
assert.deepEqual(
  toHost(volatileProbe({ probe: 45 })), { probe: {} },
  '实测记录：volatile 字段不吃配置文件的值（被投影成 {}）—— 这就是那条冲突的证据',
)
assert.throws(
  () => volatileProbe(volatileProbe({ probe: 45 })),
  /expected number but got|ValidationError/,
  '实测记录：volatile 投影后的值再解析会炸（同一份配置不能解析两次）',
)
// **裁决 B 已落地**（2026-10-03）：这五项 + `modelRoutes` 全部标 volatile ⇒ 设置页写得进去；
// 代价照单全收：它们**不吃配置文件**，默认值以 schema 的 `.default()` 为准（与 `DEFAULT_MODEL_ROUTES` 同值）喵。
const decidedSchema = plugin.Config
for (const key of ['hideDoneOneShot', 'autoRefresh', 'pollSeconds', 'defaultView', 'badgeLabels']) {
  assert.equal(
    Boolean(decidedSchema.dict.panel.dict[key].meta && decidedSchema.dict.panel.dict[key].meta.volatile),
    true,
    `裁决 B：panel.${key} 必须标 .volatile()（宿主只允许写 volatile 字段 ⇒ 否则设置页写不进去）`,
  )
}
assert.equal(
  Boolean(decidedSchema.dict.modelRoutes.meta && decidedSchema.dict.modelRoutes.meta.volatile),
  true,
  '裁决 B：modelRoutes 必须标 .volatile()（用户要求能在设置页改模型名）',
)
assert.deepEqual(
  toHost(decidedSchema.dict.modelRoutes.meta.default),
  { adversary: 'glm-5.3-flash' },
  '裁决 B：默认值搬进 schema（volatile 不吃配置文件）—— adversary 默认 glm-5.3-flash',
)
// 仍归配置文件的键**不许**标 volatile（改了路径要重建数据，设置页不给写）喵
for (const path of ['panel.todoFile', 'paths.tasksDir', 'audit.archiveAfterDays']) {
  const [head, leaf] = path.split('.')
  const node = leaf ? decidedSchema.dict[head].dict[leaf] : decidedSchema.dict[head]
  assert.equal(Boolean(node.meta && node.meta.volatile), false, `裁决 B：${path} 不该标 volatile（它得由配置文件管）`)
}
// volatile 字段在**解析结果**里是空占位（真值由宿主的活值通道注入；没注入就用 schema 默认）喵 ——
// 所以"默认值"这件事在插件里由两处兜底：schema 的 `.default()`（这里断言）＋ 客户端 `panelPrefsFrom()` 的内置回落 ✓
assert.deepEqual(toHost(decidedSchema.dict.panel.dict.pollSeconds.meta.default), 5, '裁决 B：默认值留在 schema 的 meta.default（volatile 不吃配置文件）；FIX-65 起默认 5 秒')
assert.deepEqual(toHost(plugin.Config({ project: { root: 'D:/x' } }).panel.pollSeconds), {}, '实测记录：volatile 字段在解析结果里是空占位（真值来自活值通道/默认）')
assert.equal(view.panelPrefsFrom({}).pollSeconds, 20, '客户端兜底：拿不到设置值时用内置默认（20 秒）')
// 护栏②：**空对象 / 缺键 = 继承默认**（真异源不许静默失效）喵
for (const [label, routes] of [
  ['缺键（完全没有 modelRoutes）', {}],
  ['空对象（用户写成 {}）', { modelRoutes: {} }],
  ['只配了别人（缺 adversary）', { modelRoutes: { implementer: 'x' } }],
  ['显式给 adversary 别的模型', { modelRoutes: { adversary: 'glm-4' } }],
]) {
  const model = routeOptions({ ...cfg, ...routes }, getRole({}, 'adversary')).model
  assert.ok(model, `护栏②：${label} 时 adversary 仍必须有模型（不许静默退回非异源）`)
  if (label.includes('显式给')) assert.equal(model, 'glm-4', '护栏②：显式值优先于默认')
  else assert.equal(model, 'glm-5.3-flash', `护栏②：${label} ⇒ 继承默认 glm-5.3-flash`)
}
// 护栏②的另一半：**空对象不许把默认抹掉** —— 客户端保存时对"空/缺键"发的是 unset（回落默认）而不是写空值喵
const fix55EmptyOps = []
const fix55Forms = {
  getSnapshot: () => ({ status: 'ready', mode: 'host', writable: true, revision: 1, value: { panel: {} } }),
  mutate: async (ops) => { fix55EmptyOps.push(...ops); return true },
}
await view.writePanelSetting(fix55Forms, {})
assert.deepEqual(toHost(fix55EmptyOps), [], '护栏②：没有任何面板项要写时，一个 op 都不该发（别写空对象下去）')
// ③「只解析一次」：插件代码里**不得**出现 `plugin.Config(`/`Config(` 二次解析（volatile 投影过的值再解析会炸）
const hostFiles = ['index.js', 'src/tools.js', 'src/delegation/channels.js', 'src/contract/assemble.js', 'src/panel/snapshot.js']
for (const file of hostFiles) {
  const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8')
  // 去掉行注释再查（避免误报注释里的 Config( ）；用 fromCharCode(10) 而非转义写换行，少一层坑喵
  const newline = String.fromCharCode(10)
  const codeOnly = source.split(newline).map((line) => line.split('//')[0]).join(newline)
  assert.equal(
    codeOnly.includes('Config('),
    false,
    `护栏③：${file} 不得再次解析配置（volatile 投影后的值再进 schema 会 ValidationError）`,
  )
}
// ①：配置文件里**不许留未标注的失效值** —— `modelRoutes` 那段必须是注释（带"由设置页管理"的说明）喵
if (process.argv[2]) {
  const patchText = await readFile(process.argv[2], 'utf8')
  assert.equal(/^\s*modelRoutes:/m.test(patchText), false, '护栏①：modelRoutes 不得以未注释的形式留在配置文件里（改了不生效）')
  assert.ok(/modelRoutes 与 panel 的五个开关由「设置」页管理/.test(patchText), '护栏①：失效键必须明确标注"由设置页管理、此处仅示例"')
}
ok('护栏①~③：配置文件的失效键必须标注为示例 / 空对象与缺键都继承默认（真异源不静默失效）/ 宿主侧不许二次解析配置')

ok('设置页 volatile 规则（裁决 B 落地）：五项开关 + modelRoutes 标 volatile（设置页可写）/ 默认值搬进 schema（adversary=glm-5.3-flash）/ 仍归配置文件的键不标 / 实测 volatile 不吃文件值且二次解析会炸')

ok('设置页写路径：叶子路径数组（mutate） + 失败必须带出宿主 error.code/原话（真机被吞过一次）')

ok('设置页可写性诊断：无表单 / 不可写（unavailable / writable=false）都**禁用控件并说明原因**，可写时才放开（真机"点了没反应"的护栏）')

ok('FIX-54 客户端渲染冒烟：假 props 真渲染一次（列表 + 拓扑 + 徽章行 + A/B 区）/ 还原 FIX-53 的 bug 必须红（ReferenceError 命中）/ 顺带扫模块级组件的跨作用域引用')

// ---------------------------------------------------------------- 错误路径与回归
assert.throws(() => resolveProject({ paths: {} }), /project\.root/)
assert.equal(resolveProject({ project: { root: 'D:\\Blockdustry' } }).tasksDir, 'D:\\Blockdustry\\任务')
assert.equal(resolveProject({ project: { root: 'D:/Blockdustry' } }).tasksDir, 'D:\\Blockdustry\\任务')
assert.equal(resolveProject({ project: { root: '/mnt/d/Blockdustry' } }).tasksDir, '/mnt/d/Blockdustry/任务')
assert.equal(joinUnderRoot('D:\\Blockdustry\\', '/仓库/docs'), 'D:\\Blockdustry\\仓库\\docs')
assert.equal(joinUnderRoot('/mnt/d/Blockdustry/', 'docs/子agent'), '/mnt/d/Blockdustry/docs/子agent')
ok('错误路径 + 跨平台路径一致性（回归）')

// ---------------------------------------------------------------- FIX-58 产品级自适应：任意新文件夹当仓库即自适应（零配置）
/**
 * 目录**指纹**喵：列出目录下所有文件/子目录 + 每个文件的 sha256 前 12 位喵。
 * 用途只有一个：证明"跑一趟自适应**一个字节都没动**"（验收②）——只比"文件数"是骗自己喵。
 */
async function dirDigest(dir) {
  const rows = []
  const walk = async (current, prefix) => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = joinUnderRoot(current, entry.name)
      if (entry.isDirectory()) {
        rows.push(`D ${rel}`)
        await walk(abs, rel)
      } else {
        const body = await readFile(abs)
        rows.push(`F ${rel} ${(await import('node:crypto')).createHash('sha256').update(body).digest('hex').slice(0, 12)}`)
      }
    }
  }
  await walk(dir, '')
  return rows
}

/** 造一个"已有项目"喵：中文目录名 + `仓库/docs` 变体（Blockdustry 那类老布局，六类文档目录齐全）喵。 */
const legacyRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-old-'))
for (const rel of [
  '任务', '[Agent进度]',
  // FIX-69：老布局 + 产出根的档级子目录 + 临时去处（都齐 = 已初始化，探测应当零新增）喵
  '仓库/docs/子agent', '仓库/docs/子agent/L1', '仓库/docs/子agent/L2', '仓库/docs/子agent/L3',
  '仓库/docs/研究', '仓库/docs/审查', '仓库/docs/整合清单', '仓库/docs/坑', '仓库/docs/修改', '仓库/docs/核心数据库', '仓库/docs/archive', '仓库/docs/_临时',
]) {
  await mkdir(joinUnderRoot(legacyRoot, rel), { recursive: true })
}
await writeFile(joinUnderRoot(legacyRoot, '待办.md'), '# 待办\n\n- [ ] 老项目自己的待办（一个字都不许被插件改）\n', 'utf8')
await writeFile(joinUnderRoot(legacyRoot, '任务/T-001.md'), '# T-001 老任务\n\n既有内容。\n', 'utf8')
const legacyDigestBefore = await dirDigest(legacyRoot)

const adaptCfg = plugin.Config({}) // **零配置**：root 空、paths 空、docKinds 空（FIX-58 的产品要求）喵
const agentAt = (cwd) => ({ session: { header: { cwd } } })
const emptyCtx = makeCtx().ctx // 没有 workspaceRegistry 也要能工作（用会话 cwd 兜底）喵

// ② 已有项目：探测命中既有目录、**不改动任何既有文件**
const probed = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(legacyRoot), ensure: true })
assert.equal(probed.root, legacyRoot, 'FIX-58 ①：根跟随会话 cwd（没配 root 也能定位项目）')
assert.equal(probed.source, 'cwd')
assert.equal(probed.paths.tasksDir, joinUnderRoot(legacyRoot, '任务'), 'FIX-58 ②：任务目录命中既有 `任务/`')
assert.equal(probed.paths.deliverablesDir, joinUnderRoot(legacyRoot, '仓库/docs/子agent'), 'FIX-58 ②：产出目录命中 `仓库/docs/子agent` 变体')
assert.equal(probed.paths.archiveDir, joinUnderRoot(legacyRoot, '仓库/docs/archive'))
assert.equal(probed.paths.docKinds.坑, joinUnderRoot(legacyRoot, '仓库/docs/坑'))
assert.equal(probed.paths.todoFile, joinUnderRoot(legacyRoot, '待办.md'), 'FIX-58 ②：待办文件命中既有 `待办.md`')
assert.deepEqual(probed.created, [], 'FIX-58 ②：结构探测命中时**一个都不新建**')
assert.ok(probed.notes.some((note) => note.includes('命中既有')), 'FIX-58：回执要说明走的是"命中既有结构"')
// 逐字节一致：**既有内容一个字都不许动**；唯一允许的新增是插件自己的派生目录 `.agent-contract/`喵
const legacyDigestAfter = await dirDigest(legacyRoot)
assert.deepEqual(
  legacyDigestBefore.filter((row) => !legacyDigestAfter.includes(row)), [],
  'FIX-58 ②：对已有项目跑自适应，既有文件/目录一个字都不许改、不许删',
)
const legacyAdded = legacyDigestAfter.filter((row) => !legacyDigestBefore.includes(row))
// FIX-61 口径收紧：**只读解析一个字节都不写**（连 project.json 都不写 —— 建/写都归 `project_init`）喵
assert.deepEqual(legacyAdded, [], `FIX-58 ②：只读解析对已有项目**零新增、零改动**（实际 ${JSON.stringify(legacyAdded)}）`)
// 项目名从目录名推导 ⇒ 记录表分域键跟着项目走喵
assert.equal(probed.name, deriveProjectName(legacyRoot), 'FIX-58 ④：项目名从工作区目录名推导（可用 project.name 显式覆盖）')
assert.equal(probed.key, projectSlugOf(probed.name), 'FIX-58 ④：隔离键由推导出的项目名生成')
assert.notEqual(probed.key, 'default', 'FIX-58 ④：绝不能退化成共用 default（那会让两个项目互相覆盖）')
// `project_init` 落地（唯一会写东西的入口）：结构已齐 ⇒ 不新建，但要把推导结果写进 project.json 喵
const legacyInit = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(legacyRoot), ensure: true, forceCreate: true })
assert.deepEqual(legacyInit.created, [], 'FIX-58 ②：结构已齐时 project_init 也一个都不新建')
assert.ok(existsSync(joinUnderRoot(legacyRoot, PROJECT_META_REL)), 'FIX-58 ⑤：推导结果写进 <项目根>/.agent-contract/project.json（随项目走）')
// 缓存命中：第二次不再重探（结果稳定）
const cachedRun = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(legacyRoot), ensure: true })
assert.ok(cachedRun.notes.some((note) => note.includes('缓存')), 'FIX-58 ⑤：第二次直接读 project.json（缓存命中，结果稳定）')
assert.equal(cachedRun.paths.deliverablesDir, probed.paths.deliverablesDir)
// 缓存是派生物：坏 JSON / 版本不符一律当没有（绝不因为缓存坏掉就崩）喵
await writeFile(joinUnderRoot(legacyRoot, PROJECT_META_REL), '{ 这不是 JSON', 'utf8')
assert.equal(await readProjectMeta(legacyRoot), null, 'FIX-58 ⑤：project.json 坏了当没有（重新探测，绝不抛）')
ok('FIX-58 ②⑤：已有项目探测命中既有目录（逐字节一致）/ 项目名与隔离键由目录名推导 / project.json 随项目走且坏了能自愈')

// ①③④ 新文件夹当仓库：**零配置**，dryRun 预览 → 落地建默认结构
const freshRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-new-'))
const preview = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(freshRoot), dryRun: true, ensure: true, forceCreate: true })
assert.ok(preview.created.length >= 8, `FIX-58 ④：dryRun 要预览"将建哪些目录"，实际 ${preview.created.length} 项`)
assert.ok(preview.plan.some((row) => row.includes('待办.md')), 'FIX-58 ④：预览清单里要有待办文件')
assert.ok(preview.notes.some((note) => note.includes('将新建')), 'FIX-58 ④：dryRun 的回执必须写"将新建"')
assert.equal(existsSync(joinUnderRoot(freshRoot, DEFAULT_STRUCTURE.tasksDir)), false, 'FIX-58 ④：dryRun **绝不落盘**')
assert.equal(existsSync(joinUnderRoot(freshRoot, PROJECT_META_REL)), false, 'FIX-58 ④：dryRun 也不写 project.json（看一眼不该有副作用）')
const inited = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(freshRoot), ensure: true, forceCreate: true })
assert.ok(inited.notes.some((note) => note.includes('已新建')), 'FIX-58 ①：回执要说明"已新建了什么"')
// FIX-69：默认结构含新的类型目录、产出根的档级子目录与临时去处喵
for (const rel of ['任务', '[Agent进度]', 'docs/产出', 'docs/产出/L1', 'docs/产出/L2', 'docs/产出/L3', 'docs/研究', 'docs/审查', 'docs/整合清单', 'docs/坑', 'docs/修改', 'docs/核心数据库', 'docs/archive', 'docs/_临时', '待办.md']) {
  assert.ok(existsSync(joinUnderRoot(freshRoot, rel)), `FIX-58 ①：新项目要自动建出默认结构中的 ${rel}`)
}
assert.equal(inited.created.length >= 13, true, 'FIX-58 ①：回执要带回"建了哪些"的清单（FIX-69 起默认结构更多：含三类新目录、档级子目录与临时去处）')
// 再跑一次绝不覆盖（只新建）喵
await writeFile(joinUnderRoot(freshRoot, '待办.md'), '# 我自己的待办\n\n- [x] 人工写的内容\n', 'utf8')
const rerun = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(freshRoot), ensure: true, forceCreate: true })
assert.equal(rerun.paths.todoFile, joinUnderRoot(freshRoot, '待办.md'))
assert.ok((await readFile(joinUnderRoot(freshRoot, '待办.md'), 'utf8')).includes('人工写的内容'), 'FIX-58 ⑦：自建**只新建不覆盖**（人工内容一个字都不改）')
ok('FIX-58 ①③④⑦：新文件夹零配置可用（dryRun 先预览 / 落地建默认结构 + 待办.md / 只新建不覆盖 / 回执说明建了什么）')

// ③ 两个项目来回切 ⇒ 记录不串（各自分域）、面板各显各的
const isoCtxA = makeCtx()
const isoLedger58 = createLedger(isoCtxA.ctx)
await isoLedger58.ready
const projNew = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(freshRoot), ensure: true })
const projOld = await resolveAdaptiveProject({ ctx: emptyCtx, config: adaptCfg, agent: agentAt(legacyRoot), ensure: true })
assert.notEqual(projNew.key, projOld.key, 'FIX-58 ③：两个项目的隔离键必须不同')
const storeNew = isoLedger58.storeFor(projNew.key)
const storeOld = isoLedger58.storeFor(projOld.key)
await storeNew.putDoc(docRecord({ path: joinUnderRoot(freshRoot, 'docs/子agent/T-1_新项目_L3.md'), tier: 3, taskId: 'T-1', title: '新项目' }))
await storeOld.putDoc(docRecord({ path: joinUnderRoot(legacyRoot, '仓库/docs/子agent/T-2_老项目_L3.md'), tier: 3, taskId: 'T-2', title: '老项目' }))
assert.equal(storeNew.listDocs().length, 1, 'FIX-58 ③：新项目只看得见自己的档')
assert.equal(storeOld.listDocs().length, 1, 'FIX-58 ③：老项目只看得见自己的档')
assert.ok(isoLedger58.projectKeys().includes(projNew.key) && isoLedger58.projectKeys().includes(projOld.key), 'FIX-58 ③：一个实例同时服务两个项目')
const snapNew = await writePanelSnapshot({ store: storeNew, project: projNew, audit: null })
const snapOld = await writePanelSnapshot({ store: storeOld, project: projOld, audit: null })
assert.equal(snapNew.path, joinUnderRoot(freshRoot, '.agent-contract/panel.json'), 'FIX-58 ③：快照写**各自项目根**下')
assert.equal(snapOld.path, joinUnderRoot(legacyRoot, '.agent-contract/panel.json'))
const snapNewJson = JSON.parse(await readFile(snapNew.path, 'utf8'))
const snapOldJson = JSON.parse(await readFile(snapOld.path, 'utf8'))
assert.equal(snapNewJson.project.root, freshRoot, 'FIX-58 ③：面板各显各的（快照里的项目根是各自的那个）')
assert.equal(snapOldJson.project.root, legacyRoot)
assert.equal(snapNewJson.counts.docs, 1, 'FIX-58 ③：新项目快照只数自己那一篇档')
assert.equal(snapOldJson.counts.docs, 1, 'FIX-58 ③：老项目快照也只数自己那一篇')
assert.equal(JSON.stringify(snapNewJson).includes('老项目'), false, 'FIX-58 ③：两个项目的快照不许串味')
assert.equal(JSON.stringify(snapOldJson).includes('新项目'), false)
ok('FIX-58 ③：两个项目来回切，记录各自分域（storeFor 隔离）＋ 面板快照各写各自项目根、内容不串')

// ⑤ 显式配置锁定优先于工作区推导 + 显式目录约定不被探测覆盖
const lockedRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-lock-'))
const lockCfg = plugin.Config({ project: { name: '锁定项目', root: lockedRoot }, paths: { tasksDir: '任务', deliverablesDir: 'docs/子agent', docsDirs: ['docs/研究'], docKinds: { 研究: 'docs/研究' } } })
const locked = await resolveAdaptiveProject({ ctx: emptyCtx, config: lockCfg, agent: agentAt(freshRoot), ensure: true })
assert.equal(locked.root, lockedRoot, 'FIX-58 ⑤：显式配置的项目根优先（会话 cwd 在别处也不被覆盖）')
assert.equal(locked.explicit, true)
assert.equal(locked.name, '锁定项目', 'FIX-58 ⑤：显式 project.name 优先于目录名推导')
assert.equal(hasExplicitPaths(lockCfg), true)
assert.ok(locked.notes.some((note) => note.includes('显式配置')), 'FIX-58 ⑤：回执要说明"用了显式配置"')
assert.equal(existsSync(joinUnderRoot(lockedRoot, PROJECT_META_REL)), false, 'FIX-58 ⑤：显式目录约定时不写 project.json（配置本身就是权威）')

// ⑦ 安全护栏：路径越出项目根一律拒；工作区解析优先用祖先工作区（不在子目录里另起一套）
assert.throws(() => assertInsideRoot('/a/b', { tasksDir: '/a/c/任务' }), /越出项目根/, 'FIX-58 ⑦：越界路径必须当场拒')
assert.equal(isInsideRoot('D:\\P', 'D:\\P\\任务'), true)
assert.equal(isInsideRoot('D:\\P', 'D:\\PX\\任务'), false, 'FIX-58 ⑦：前缀相似但不同目录不算在内')
const stripCfg = plugin.Config({ project: { root: '' }, paths: { tasksDir: '任务' } }) // 只有 tasksDir、没有 docsDirs/docKinds ⇒ 仍走自适应喵
assert.equal(hasExplicitPaths(stripCfg), false, 'FIX-58：只配了 tasksDir 不算"显式目录约定"（结构仍自适应）')
const wsCtx = { get: (name) => (name === 'workspaceRegistry' ? {
  resolveByPath: () => null,
  list: () => [{ path: joinUnderRoot(lockedRoot, '仓库') }],
} : undefined) }
assert.equal(
  workspaceRootOf(wsCtx, joinUnderRoot(lockedRoot, '仓库/docs')),
  joinUnderRoot(lockedRoot, '仓库'),
  'FIX-58：会话开在子目录时用**祖先工作区**当项目根（不在 `仓库/` 里另起一套任务目录）',
)
assert.deepEqual(
  resolveRoot({ config: plugin.Config({ project: { root: lockedRoot } }), cwd: freshRoot, workspaceRoot: null }),
  { root: lockedRoot, source: 'config' },
  'FIX-58 ⑤：优先级 显式配置 > 工作区/会话',
)
assert.throws(() => resolveRoot({ config: plugin.Config({}), cwd: '', workspaceRoot: null }), /推不出项目根/, 'FIX-58：一个来源都没有就早失败（绝不瞎猜目录）')
// 候选清单必须都在默认结构里（否则"探测得到、却不知道没命中时建什么"）喵
for (const key of Object.keys(STRUCTURE_CANDIDATES)) {
  assert.ok(DEFAULT_STRUCTURE[key], `FIX-58：候选位置 ${key} 必须有对应的默认结构（探不到时要建它）`)
}
ok('FIX-58 ⑤⑦：显式配置锁定优先 / 越界路径拒收 / 祖先工作区优先 / 无来源时早失败 / 候选清单与默认结构一一对应')

// 工具入口：零配置实例上的 `project_init`（dryRun 默认开 / 预览 → 落地 → 幂等不覆盖）
const pinRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-tool-'))
const pinCtx = makeCtx()
plugin.apply(pinCtx.ctx, plugin.Config({ project: { root: '' } })) // **零配置**插件实例喵
const pinTool = pinCtx.mine.find((tool) => tool.name === 'project_init')
assert.ok(pinTool, 'FIX-58：project_init 必须注册（自建结构的正式入口，不必等写入类工具顺手建）')
const pinDry = await pinTool.execute({}, { agent: agentAt(pinRoot) })
assert.equal(pinDry.dryRun, true, 'FIX-58 ④：不传参数时**默认只预览**（破坏性动作必须显式确认）')
assert.equal(pinDry.root, pinRoot, 'FIX-58 ①：project_init 的根跟随会话 cwd')
assert.ok(pinDry.created.length >= 8, 'FIX-58 ④：预览清单要列出将建的目录')
assert.equal(existsSync(joinUnderRoot(pinRoot, DEFAULT_STRUCTURE.tasksDir)), false, 'FIX-58 ④：预览**不落盘**')
assert.ok(pinTool.output.render({}, pinDry)[0].text.includes('将新建'), 'FIX-58 ④：回执文案要写"将新建"（人审后才知道自己在批准什么）')
const pinReal = await pinTool.execute({ dryRun: false }, { agent: agentAt(pinRoot) })
assert.ok(pinReal.created.length >= 8, 'FIX-58 ①：落地要真建')
assert.ok(existsSync(joinUnderRoot(pinRoot, DEFAULT_STRUCTURE.tasksDir)), 'FIX-58 ①：默认结构已建出来')
assert.ok(existsSync(joinUnderRoot(pinRoot, '待办.md')), 'FIX-58 ①：`待办.md` 也一并建出（面板 A 区才有东西读）')
assert.ok(pinTool.output.render({}, pinReal)[0].text.includes('已新建'), 'FIX-58 ①：落地回执写"已新建了什么"')
assert.notEqual(pinReal.key, 'default', 'FIX-58 ④：项目隔离键来自目录名（不是兜底 default）')
await writeFile(joinUnderRoot(pinRoot, '待办.md'), '# 人工写的\n\n- [ ] 不许被覆盖\n', 'utf8')
const pinAgain = await pinTool.execute({ dryRun: false }, { agent: agentAt(pinRoot) })
assert.deepEqual(pinAgain.created, [], 'FIX-58 ⑦：第二次跑一个都不新建（结构已齐）')
assert.ok((await readFile(joinUnderRoot(pinRoot, '待办.md'), 'utf8')).includes('不许被覆盖'), 'FIX-58 ⑦：绝不覆盖人工内容')
ok('FIX-58 ①④⑦ 工具入口：project_init 默认 dryRun 预览 → 显式落地建默认结构 → 再跑幂等且不覆盖人工内容')

// 零配置 + 宿主只登记了**一个**工作区 ⇒ 启动那一刻就能点亮面板（FIX-51 的自愈口径在多项目下继续成立）
const bootRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-boot-'))
await mkdir(joinUnderRoot(bootRoot, '任务'), { recursive: true })
await mkdir(joinUnderRoot(bootRoot, 'docs/研究'), { recursive: true })
const bootCtx = makeCtx()
const bootBaseGet = bootCtx.ctx.get
bootCtx.ctx.get = (name) => (name === 'workspaceRegistry'
  ? { resolveByPath: () => null, list: () => [{ path: bootRoot }] }
  : bootBaseGet(name))
plugin.apply(bootCtx.ctx, plugin.Config({ project: { root: '' } }))
await new Promise((resolve) => { setTimeout(resolve, 30) })
const bootSnapshot = joinUnderRoot(bootRoot, '.agent-contract/panel.json')
assert.ok(existsSync(bootSnapshot), 'FIX-58：零配置 + 唯一工作区 ⇒ 启动即写出快照（用户不需要先跑一次审计）')
const bootJson = JSON.parse(await readFile(bootSnapshot, 'utf8'))
assert.equal(bootJson.project.root, bootRoot, 'FIX-58：启动时的项目根来自唯一工作区')
assert.equal(bootJson.project.name, deriveProjectName(bootRoot), 'FIX-58：项目名仍是目录名推导')
assert.equal(existsSync(joinUnderRoot(bootRoot, DEFAULT_STRUCTURE.progressDir)), false, 'FIX-58：启动探测**只读**（不许在启动路上建目录）')
ok('FIX-58 启动即点亮：零配置 + 唯一工作区 ⇒ 启动写快照自愈，且只读探测不建目录')

// FIX-59 回归（用户真机场景）：**登记了多个工作区**时启动**推不出根**（不猜）⇒ 靠 `session/created` 点亮。
// 病根：零配置下没有工具调用就没有 `domain/changed` ⇒ 快照永远不写 ⇒ 面板一直"数据源待接"，
// 连 FIX-51 的"升级后不用人工动作"都做不到 ✗
const multiRoot = await mkdtemp(join(tmpdir(), 'ac-adapt-multi-'))
await mkdir(joinUnderRoot(multiRoot, '任务'), { recursive: true })
await mkdir(joinUnderRoot(multiRoot, '仓库/docs/子agent'), { recursive: true })
await writeFile(joinUnderRoot(multiRoot, '待办.md'), '# 待办\n\n- [ ] 真机场景：多工作区\n', 'utf8')
const multiCtx = makeCtx()
const multiBaseGet = multiCtx.ctx.get
multiCtx.ctx.get = (name) => (name === 'workspaceRegistry'
  ? {
    // 会话 cwd 能精确解析到一个工作区；list() 却有好几个 ⇒ 启动**不允许**瞎猜
    resolveByPath: (path) => (String(path).startsWith(multiRoot) ? { path: multiRoot } : null),
    list: () => [{ path: multiRoot }, { path: joinUnderRoot(tmpdir(), '别的项目') }, { path: joinUnderRoot(tmpdir(), '第三个') }],
  }
  : multiBaseGet(name))
plugin.apply(multiCtx.ctx, plugin.Config({ project: { root: '' } }))
const tick = (ms = 30) => new Promise((resolve) => { setTimeout(resolve, ms) })
await tick()
const multiSnapPath = joinUnderRoot(multiRoot, '.agent-contract/panel.json')
assert.equal(existsSync(multiSnapPath), false, 'FIX-59：多工作区 + 零配置时启动**推不出根** ⇒ 宁可不动，也不猜一个项目写快照')
assert.equal(existsSync(joinUnderRoot(multiRoot, '.agent-contract/project.json')), false, 'FIX-59：连项目元数据也不写（启动路径只读）')
// 会话出现 ⇒ 立刻点亮它所属项目的快照（用户不需要做任何动作）
multiCtx.ctx.emit('session/created', { header: { cwd: multiRoot } })
await tick()
assert.ok(existsSync(multiSnapPath), 'FIX-59：`session/created` 一出现就要点亮快照（否则面板永远"数据源待接"）')
const multiSnap = JSON.parse(await readFile(multiSnapPath, 'utf8'))
assert.equal(multiSnap.project.root, multiRoot, 'FIX-59：快照要落在**这个会话所属项目**的根下')
assert.equal(multiSnap.project.name, deriveProjectName(multiRoot), 'FIX-59：项目名仍是目录名推导')
assert.equal(multiSnap.pluginVersion, pkgVersion, 'FIX-59：写出去的必须是**当前插件版本**（否则面板还是判"陈旧"）')
assert.equal(multiSnap.paths.todoFile, joinUnderRoot(multiRoot, '待办.md'), 'FIX-59：快照必须带上待办文件路径（面板 A 区据此读原文 —— 用户报的"没有待办任务"就是这一步断了）')
assert.equal(existsSync(joinUnderRoot(multiRoot, '.agent-contract/project.json')), false, 'FIX-59：点亮快照仍然**只读探测**（不建目录、不写元数据）')
// 幂等：再来一个会话（比如子代理的）不该重写（版本一致就不折腾）
const genBefore = multiSnap.generatedAt
multiCtx.ctx.emit('session/created', { header: { cwd: joinUnderRoot(multiRoot, '仓库') } })
await tick()
assert.equal(JSON.parse(await readFile(multiSnapPath, 'utf8')).generatedAt, genBefore, 'FIX-59：版本一致时第二个会话不重写快照（自愈是幂等的）')
ok('FIX-59 回归：多工作区 + 零配置 ⇒ 启动不猜根（不写快照）· 会话一出现即点亮该项目快照（含待办路径）· 只读探测 · 二次会话不折腾')

// ---------------------------------------------------------------- FIX-60 馆员角色卡与当前职责一致（通用纪律由插件给，不靠任务单手写）
const libRole = getRole({}, 'librarian')
const libPersona = libRole.persona
// ① 通用纪律必须齐（关键词可 grep 到）
for (const [label, kw] of [
  ['先预演再落盘', 'dryRun'], ['判不准上报', '判不准'], ['上报', '上报'],
  ['引用同步', '引用'], ['备份', '备份'], ['留痕', '留痕'],
]) {
  assert.ok(libPersona.includes(kw), `FIX-60：馆员角色卡必须写清通用纪律「${label}」`)
}
assert.ok(libPersona.includes('通用纪律'), 'FIX-60：纪律要成段写出来（任务单只需写范围，不必再抄一遍）')
// ② 不许有阶段快照式表述（阶段会过时，能力不会）
assert.equal(/只做两件事|本阶段|M2/.test(libPersona), false, 'FIX-60：不得出现"本阶段只做 N 件事"这类过时表述')
// ③ 职责必须与**当前工具集**一致（防漂移：`librarian_tags` 曾整轮缺席）
// FIX-74：馆员的簿记核心工具 —— 缺 `ledger_rebuild` 会让"先重建台账"那一步**断链**（真机实证）喵
const LIBRARIAN_TOOLS = ['librarian_patrol', 'librarian_backfill', 'librarian_archive', 'librarian_sweep', 'librarian_glossary', 'librarian_tags', 'librarian_relocate', 'ledger_backfill', 'ledger_rebuild']
for (const toolName of LIBRARIAN_TOOLS) {
  assert.ok(libPersona.includes(toolName), `FIX-60：能力面要写明 ${toolName}`)
  assert.ok(libRole.tools.includes(toolName), `FIX-60：工具白名单要含 ${toolName}（否则子智能体不认领这活）`)
}
// ④ 已由代码强制的要写明"无需你操心"（别让子代理重复设防），且这说法**有据**
assert.ok(/无需你操心/.test(libPersona), 'FIX-60：已强制的几条要写"已由工具强制，无需你操心"')
assert.ok(libPersona.includes('正文结论'), 'FIX-60：正文零改动这条要写清')
// 强制点确实在代码里（角色卡那句"已由工具强制"要有据）：写前备份在 duties 的各个落盘点，不在纯文本 fixer 里喵
const fix60DutiesSrc = await readFile(new URL('./src/librarian/duties.js', import.meta.url), 'utf8')
assert.ok(/writeWithBackup/.test(fix60DutiesSrc), 'FIX-60：角色卡说"已由工具强制"必须有据（写前备份确实由代码强制）')
assert.ok(libPersona.includes('librarianTouchedAt'), 'FIX-60：留痕字段名要写出来（手工改档时子智能体自己补）')
assert.ok(libRole.budgetChars >= 1000, 'FIX-60：卡变长了，预算跟着调（明写，不是偷偷放宽）')
ok('FIX-60 馆员角色卡：通用纪律齐备（dryRun 预演 / 判不准上报 / 引用同步 / 备份 / 留痕 / 归档边界）+ 能力面与 7 个工具一一对应 + 已强制的写明"无需你操心" + 无阶段快照表述')

// ---------------------------------------------------------------- FIX-61 结构缺失要主动提示（只提示不代建）
const hintRoot = await mkdtemp(join(tmpdir(), 'ac-hint-'))
const hintCfg = plugin.Config({ project: { root: hintRoot } }) // 显式锁定一个**空目录** ⇒ 结构全缺喵
const hintCtx = makeCtx()
plugin.apply(hintCtx.ctx, hintCfg)
const hintExec = { agent: { id: 'root-session', session: { header: { delegationDepth: 0 } } }, signal: new AbortController().signal }
const hintStatus = await hintCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, hintExec)
assert.ok(hintStatus.project_hint, 'FIX-61 ①：结构缺失 ⇒ 回执必须主动提示（用户不必自己记得去调 project_init）')
assert.ok(hintStatus.project_hint.includes('尚未初始化'), 'FIX-61：文案要说清"尚未初始化"')
assert.ok(hintStatus.project_hint.includes('project_init'), 'FIX-61 ③：文案要含 `project_init`（可执行）')
assert.ok(hintStatus.project_hint.includes('只新建、不覆盖'), 'FIX-61 ③：文案要写明"只新建、不覆盖"')
assert.equal(
  hintCtx.mine.find((tool) => tool.name === 'contract_status').output.render({}, hintStatus)[0].text.includes('初始化提示:'),
  true,
  'FIX-61：渲染出来的回执里也要有这一句',
)
assert.equal(existsSync(joinUnderRoot(hintRoot, '任务')), false, 'FIX-61 ③：**只提示、不代建**（建目录仍是显式动作）')
// 派单回执也要带（主代理据此提醒用户）
const hintDeleg = await hintCtx.mine.find((tool) => tool.name === 'contract_delegate_researcher').execute({ taskId: 'T-701' }, hintExec)
assert.ok(String(hintDeleg.projectHint || '').includes('project_init'), 'FIX-61 ①：派单回执也要带这条提示')
assert.ok(
  hintCtx.mine.find((tool) => tool.name === 'contract_delegate_researcher').output.render({}, hintDeleg)[0].text.includes('尚未初始化'),
  'FIX-61：派单回执渲染里也要看得见',
)
assert.equal(existsSync(joinUnderRoot(hintRoot, '任务')), false, 'FIX-61 ③：派单**也不代建**（显式路径的项目只提示）')
// 面板：快照要带上这条（client 据此渲染一行）
const hintDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) hintDomains[key] = hintCtx.ctx.storageDomain.opened.get(spec.name)
const hintResolved = await resolveAdaptiveProject({ ctx: hintCtx.ctx, config: hintCfg, agent: hintExec.agent, ensure: false })
const hintProjectView = { ...hintResolved.paths, root: hintResolved.root, name: hintResolved.name, panel: { todoFile: hintResolved.paths.todoFile } }
const hintSnap = buildPanelSnapshot({ store: createStore(hintDomains, projectKeyOf(hintCfg)), project: hintProjectView, audit: null })
assert.ok(String(hintSnap.projectHint || '').includes('尚未初始化'), 'FIX-61 ①：面板快照要带这条提示（面板据此渲染）')
assert.ok(
  clientSource.includes("'agent-contract-project-hint'"),
  'FIX-61：client 要有渲染这一行的入口（结构齐时字段为 null ⇒ 不占版面）',
)
// ② 显式初始化后（project_init）⇒ 提示消失
const hintInit = await hintCtx.mine.find((tool) => tool.name === 'project_init').execute({ dryRun: false }, hintExec)
assert.ok(hintInit.created.length >= 8, 'FIX-61：project_init 落地要真把缺的建齐（显式约定的项目也归它管）')
const hintAfter = await hintCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, hintExec)
assert.equal(hintAfter.project_hint, undefined, 'FIX-61 ②：结构补齐后**不再提示**（别变成常驻噪音）')
assert.equal(
  hintCtx.mine.find((tool) => tool.name === 'contract_status').output.render({}, hintAfter)[0].text.includes('尚未初始化'),
  false,
  'FIX-61 ②：渲染里也不再出现',
)
assert.ok(existsSync(joinUnderRoot(hintRoot, '待办.md')), 'FIX-61：待办文件也一并建出')
// 写入类工具**只补自己写的那一个目录**，绝不代建整套结构（FIX-61 ③：建目录唯一的入口是 project_init）喵
const hintRoot2 = await mkdtemp(join(tmpdir(), 'ac-hint2-'))
const hintCtx2 = makeCtx()
plugin.apply(hintCtx2.ctx, plugin.Config({ project: { root: hintRoot2 } }))
const hintExec2 = { agent: { id: 'root-session', session: { header: { delegationDepth: 0 } } }, signal: new AbortController().signal }
await hintCtx2.mine.find((tool) => tool.name === 'doc_emit').execute(
  { level: 3, taskId: 'T-702', title: '写入不代建', role: 'implementer', body: '## 结论\n\n写了。\n' }, hintExec2,
)
// FIX-69：产出档现在落到档级子目录（`docs/产出/L3/`）—— 写入工具只补**目标那一层**喵
assert.ok(existsSync(joinUnderRoot(hintRoot2, 'docs/产出/L3')), 'FIX-61：写入类工具要能落盘（它自己那个目录自己补）')
assert.equal(existsSync(joinUnderRoot(hintRoot2, '任务')), false, 'FIX-61 ③：写入类工具**不代建整套结构**（那归 project_init）')
assert.equal(existsSync(joinUnderRoot(hintRoot2, '.agent-contract/project.json')), false, 'FIX-61：也不写项目元数据')
ok('FIX-61 结构缺失主动提示：contract_status / 派单回执 / 面板快照三处都提示（含 project_init 与"只新建不覆盖"）· 只提示不代建 · project_init 建齐后提示消失')

// ---------------------------------------------------------------- FIX-63 工具面角色闸门（馆员的椅子别被主代理坐上去）
assert.equal(ROLE_GATE_TOOLS.length >= 7, true, 'FIX-63：馆员作业面清单要在（librarian_* + ledger_backfill）')
for (const toolName of ROLE_GATE_TOOLS) {
  const tool = toolOf(toolName)
  assert.ok(tool, `FIX-63：${toolName} 已注册`)
  assert.ok(tool.description.includes(OWNERSHIP_SENTENCE), `FIX-63 ①：${toolName} 的描述必须写明归属（主代理不得直调）`)
  assert.ok(/contract_delegate_librarian/.test(tool.description), `FIX-63 ①：${toolName} 要给出正确姿势（委派馆员）`)
}
assert.equal(/面向图书管理员角色/.test(toolOf('doc_emit').description), false, 'FIX-63：非馆员作业面不加这句（别误伤）')
// ② 主代理（层 0）直调 ⇒ 回执附明确警告；**馆员自己（层 ≥1）不受影响**；身份不可解析 ⇒ fail-open
const gateExecMain = { agent: { session: { header: { delegationDepth: 0 } } }, signal: new AbortController().signal }
const gateExecLib = { agent: { session: { header: { delegationDepth: 1, parentSession: 'root' } } }, signal: new AbortController().signal }
const gateTool = toolOf('ledger_backfill')
const gateOut = await gateTool.execute({ auto: true, dryRun: true }, gateExecMain)
assert.ok(String(gateOut.roleGateWarning || '').includes('委派'), 'FIX-63 ②：主代理直调必须附警告（说清该委派）')
assert.ok(
  gateTool.output.render({}, gateOut).some((block) => String(block.text).includes('警告') && String(block.text).includes('委派')),
  'FIX-63 ②：警告要**渲染出来**（只塞字段没人看得见，与 §9-23 同规）',
)
const gateOutLib = await gateTool.execute({ auto: true, dryRun: true }, gateExecLib)
assert.equal(gateOutLib.roleGateWarning, undefined, 'FIX-63 ④：馆员自己调用**不受影响**（不能把它的路堵死）')
const gateOutAnon = await gateTool.execute({ auto: true, dryRun: true }, { signal: new AbortController().signal })
assert.equal(gateOutAnon.roleGateWarning, undefined, 'FIX-63：身份解析不出来 ⇒ fail-open（闸门是提醒纪律，不是靠猜身份堵路）')
// ③ 严格模式：主代理直调**被拒**
const strictCtx = makeCtx()
plugin.apply(strictCtx.ctx, plugin.Config({ project: { root: cfg.project.root }, delegation: { strictRoleGate: true } }))
const strictTool = strictCtx.mine.find((tool) => tool.name === 'librarian_sweep')
await assert.rejects(() => strictTool.execute({ dryRun: true }, gateExecMain), /严格角色闸门/, 'FIX-63 ③：严格模式下主代理直调 ⇒ 拒绝')
const strictOut = await strictTool.execute({ dryRun: true }, gateExecLib)
assert.ok(strictOut, 'FIX-63 ③：严格模式下**馆员自己**照跑（闸门只挡主代理）')
assert.equal(plugin.Config({}).delegation.strictRoleGate, false, 'FIX-63：严格模式默认关（默认仍是警告制）')
ok('FIX-63 角色闸门：7 个馆员作业面描述含归属句（含委派姿势）/ 主代理层 0 直调附警告并渲染出来 / 馆员自己与身份不可解析均放行 / strictRoleGate 默认关·开着直接拒')

// ---------------------------------------------------------------- FIX-62 / FIX-67 git：只读探测提示 + 可选提交（护栏逐条）
/** 假 git 喵：记下调用序列，按子命令给结果（可注入 ⇒ 护栏能逐条断言，不必真跑 git）喵。 */
function fakeGit(responses, calls = []) {
  const run = async (args) => {
    calls.push(args.join(' '))
    const key = args[0]
    if (!(key in responses)) throw new Error(`git ${key} 失败`)
    const value = responses[key]
    return typeof value === 'function' ? value(args) : value
  }
  run.calls = calls
  return run
}
const gitDirty = fakeGit({ 'rev-parse': 'true\n', status: ' M a.md\n?? b/\n M c\n' })
const dirtyStatus = await gitStatus({ root: '/x', run: gitDirty })
assert.deepEqual(toHost(dirtyStatus), { repo: true, dirty: 3, files: ['a.md', 'b/', 'c'] }, 'FIX-62：只读 status 能数出未提交改动（含重命名行取新路径）')
assert.equal(gitDirty.calls.length, 2, 'FIX-62：只读探测只发 rev-parse + status 两条命令')
const hintDirty = baselineHint(dirtyStatus)
assert.ok(/建议先提交一次基线/.test(hintDirty) && hintDirty.includes('3') && hintDirty.includes('git status --short'), 'FIX-62 ③：提示要具体（含改动数）')
assert.equal(baselineHint({ repo: true, dirty: 0, files: [] }), null, 'FIX-62 ②：干净工作区不提示')
assert.equal(baselineHint({ repo: false, dirty: 0, files: [] }), null, 'FIX-62 ③：非 git 仓库不提示')
const gitNoRepo = fakeGit({})
assert.deepEqual(toHost(await gitStatus({ root: '/x', run: gitNoRepo })), { repo: false, dirty: 0, files: [] }, 'FIX-62：非仓库 ⇒ repo:false（不抛）')
// 每个项目只提示一次（写动作高频，别刷噪音）
resetBaselineHints()
const hintProject = { root: '/proj-hint' }
assert.ok(await maybeBaselineHint({ project: hintProject, run: gitDirty }), 'FIX-62：第一次写动作要提示')
assert.equal(await maybeBaselineHint({ project: hintProject, run: gitDirty }), null, 'FIX-62：同一个项目只提示一次（写动作高频，别刷噪音）')
assert.equal(touchesFiles(['read', 'write']), true, 'FIX-62：会动文件的角色（白名单含 write）才算')
assert.equal(touchesFiles(['read', 'glob', 'grep']), false, 'FIX-62：纯只读角色不提示')
assert.equal(touchesFiles(['read', 'librarian_sweep']), true, 'FIX-62：馆员作业面会动文件')
// FIX-67：默认关闭 ⇒ 一条 git 命令都不发
const offCalls = []
const offAuto = await maybeAutoCommit({
  project: { root: '/x' }, config: plugin.Config({ project: { root: '/x' } }), changed: ['/x/a.md'],
  // 关闭开关时若还去碰 git，这个执行器会抛 ⇒ 断言直接红喵
  run: async () => { offCalls.push('called'); throw new Error('关闭时不该碰 git') },
})
assert.equal(offAuto, null, 'FIX-67 ①：默认关闭 ⇒ 不做任何自动提交')
assert.deepEqual(offCalls, [], 'FIX-67 ①：关闭时**一条 git 命令都不发**')
// 打开后：范围外改动 ⇒ 中止（且不 add / 不 commit）
const outsideCalls = []
const outsideRun = fakeGit({ 'rev-parse': 'true\n', status: ' M a.md\n M 别人的.md\n' }, outsideCalls)
const outside = await autoCommit({ root: '/x', paths: ['/x/a.md'], taskId: 'T-1', run: outsideRun })
assert.equal(outside.ok, false, 'FIX-67 ③：工作区有范围外改动 ⇒ 中止提交')
assert.ok(outside.reason.includes('范围之外'), 'FIX-67 ③：要说明原因（避免把你的 WIP 一起提交）')
assert.deepEqual(outsideCalls, ['rev-parse --is-inside-work-tree', 'status --porcelain'], 'FIX-67 ③：中止时**不得**发出 add/commit')
// 干净路径：只 add 本次动到的路径，信息可追溯，绝不 push
const okCalls = []
const okRun = fakeGit({ 'rev-parse': 'true\n', status: ' M a.md\n', add: '', commit: 'ok\n' }, okCalls)
const committed = await autoCommit({ root: '/x', paths: ['/x/a.md'], taskId: 'T-42', summary: '一轮治理（移动 1 / 改名 0）', run: okRun })
assert.equal(committed.ok, true, 'FIX-67 ②：干净范围 ⇒ 提交成功')
const addCall = okCalls.find((call) => call.startsWith('add'))
assert.ok(addCall && !/ -A\b/.test(addCall) && addCall.includes('/x/a.md'), `FIX-67 ②：只 add 本次动到的路径（绝不 -A），实际 ${addCall}`)
const commitCall = okCalls.find((call) => call.startsWith('commit'))
assert.ok(commitCall.includes('T-42') && commitCall.includes('备份见'), 'FIX-67 ②：提交信息含任务号 + 备份目录（可追溯）')
assert.equal(okCalls.some((call) => call.startsWith('push')), false, 'FIX-67 ③：**绝不 push**')
// autoTag
const tagCalls = []
await autoCommit({ root: '/x', paths: ['/x/a.md'], taskId: 'T-42', autoTag: true, run: fakeGit({ 'rev-parse': 'true\n', status: ' M a.md\n', tag: '', add: '', commit: 'ok\n' }, tagCalls) })
assert.ok(tagCalls.some((call) => call.startsWith('tag')), 'FIX-67 ②：autoTag 打开时要打锚点 tag（便于整体回退）')
// git 缺失 / 非仓库 ⇒ 明示原因且不抛（治理动作不受影响）
const gitBroken = await autoCommit({ root: '/x', paths: ['/x/a.md'], run: fakeGit({}) })
assert.equal(gitBroken.ok, false, 'FIX-67 ④：git 缺失/非仓库 ⇒ 不成功')
assert.ok(/跳过|失败/.test(gitBroken.reason), 'FIX-67 ④：明示原因（不静默）')
assert.ok(autoCommitLine(gitBroken).includes('已跳过'), 'FIX-67 ④：回执文案要把"已跳过"写出来')
assert.ok(autoCommitLine(committed).includes('未 push'), 'FIX-67：成功文案也要写明"未 push"')
// 源码级护栏：不得出现 `git add -A` / `git push` 的**调用路径**（注释里解释这些词不算）喵
const gitSrc = await readFile(new URL('./src/project/git.js', import.meta.url), 'utf8')
assert.equal(/['"]add['"]\s*,\s*['"]-A|['"]add['"]\s*,\s*['"]--all/.test(gitSrc), false, 'FIX-67 ⑤：源码里不得有 `git add -A` 的调用')
assert.equal(/'push'/.test(gitSrc), false, 'FIX-67 ⑤：源码里不得有 `git push`')
assert.equal(plugin.Config({}).git.autoCommit, false, 'FIX-67：autoCommit 默认关')
assert.equal(plugin.Config({}).git.autoTag, false, 'FIX-67：autoTag 默认关')
assert.ok(
  /git\.autoCommit \?|settings\.autoCommit/.test(await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')),
  'FIX-67：写类工具要**先看开关**再决定提不提交',
)
ok('FIX-62/67 git：只读探测报"未提交改动 N + 建议先提交基线"（非仓库/干净不提示、同项目只提示一次）· 可选自动提交默认关（只 add 本次路径 · 范围外即中止 · 含任务号与备份目录 · 可选 tag · 永不 push · 失败明示不阻断）')

// ---------------------------------------------------------------- FIX-64 任务文件 = 子代理的作业登记卡（字段规范 / 模板 / 交付校验）
assert.ok(TASK_CARD_SPEC.includes(TASK_CARD_SPEC_MARK), 'FIX-64 ①：插件要提供面向**子代理**的字段规范（可 grep 到）')
for (const field of TASK_CARD_REQUIRED) {
  assert.ok(TASK_CARD_SPEC.includes(field), `FIX-64 ①：规范要写明必备字段「${field}」`)
  assert.ok(TASK_CARD_TEMPLATE.includes(field), `FIX-64 ①：模板要含必备字段「${field}」`)
}
assert.ok(/由你（子代理）自己写与维护/.test(TASK_CARD_SPEC), 'FIX-64 ③：文档要写明"任务文件 = 子代理自己的作业登记卡"（不是需求单）')
assert.ok(/写\(新文件\)|写（新文件）/.test(TASK_CARD_TEMPLATE) && TASK_CARD_TEMPLATE.includes('只读') && TASK_CARD_TEMPLATE.includes('禁止改动'),
  'FIX-64 ①：占用段要逐条标注 只读 / 写(新文件) / 禁止改动')
// 契约里要带上这份规范（软约束由插件给，不靠任务单手抄）
const cardContract = await buildContract({ config: cfg, roleId: 'implementer', task: { id: 'T-001' }, parent: '主代理', layer: 1, totalAgents: 2, project })
assert.ok(cardContract.text.includes(TASK_CARD_SPEC_MARK), 'FIX-64：契约的能力段要带作业登记卡字段规范')
// ② 交付时校验（不是派单时）：缺必备字段 → 提示；齐全 → 无提示；卡不存在 → 也给一句（派单时不必存在）
const cardText = (lines) => ['# T-800 作业登记卡', ...lines, ''].join('\n')
const fullCard = cardText([
  '- 上级: 主代理', '- 占用时间: 2026-10-03', '- 占用文件或资源:', '  - D:\\P\\a.md — 写(新文件)', '  - D:\\P\\b.md — 只读',
  '- 状态: 完成', '- 阶段产出: D:\\P\\docs\\产出\\L3\\T-800_x_L3.md', '- 异常: 无',
])
const parsedFull = parseTaskCard(fullCard)
assert.deepEqual(toHost(parsedFull.missing), [], 'FIX-64 ②：字段齐全 ⇒ 无缺失')
assert.equal(parsedFull.fields['上级'], '主代理', 'FIX-64：字段解析（`- 上级: 主代理`）')
assert.equal(parsedFull.occupancies.length, 2, 'FIX-64：占用段要解析成逐条声明')
assert.equal(parsedFull.occupancies[0].mode, 'newFile', 'FIX-64：占用模式解析（写(新文件)）')
assert.equal(parsedFull.occupancies[1].mode, 'read', 'FIX-64：占用模式解析（只读）')
const partialCard = cardText(['- 上级: 主代理', '- 状态: 进行中'])
const parsedPartial = parseTaskCard(partialCard)
assert.deepEqual(toHost(parsedPartial.missing).sort(), ['占用文件或资源', '异常', '阶段产出'].sort(), 'FIX-64 ②：缺必备字段要能点出来')
const cardRoot = await mkdtemp(join(tmpdir(), 'ac-card-'))
await mkdir(joinUnderRoot(cardRoot, '任务'), { recursive: true })
const cardProject = { root: cardRoot, tasksDir: joinUnderRoot(cardRoot, '任务') }
await writeFile(joinUnderRoot(cardProject.tasksDir, 'T-801.md'), partialCard, 'utf8')
await writeFile(joinUnderRoot(cardProject.tasksDir, 'T-802.md'), fullCard, 'utf8')
const cardCheck = await checkTaskCardFile({ project: cardProject, taskId: 'T-801' })
assert.ok(cardCheck.hint && cardCheck.hint.includes('缺必备字段'), 'FIX-64 ②：交付时缺必备字段 ⇒ 有提示')
const cardCheckOk = await checkTaskCardFile({ project: cardProject, taskId: 'T-802' })
assert.equal(cardCheckOk.hint, null, 'FIX-64 ③：字段齐全 ⇒ 无提示（不刷噪音）')
const cardCheckMissing = await checkTaskCardFile({ project: cardProject, taskId: 'T-803' })
assert.ok(String(cardCheckMissing.hint || '').includes('还没建'), 'FIX-64：卡还没建 ⇒ 也给一句（派单时不必存在、交付时该有）')
// 观察项：进审计（info，不计红黄）
const cardDomains = {}
const cardCtx = makeCtx()
plugin.apply(cardCtx.ctx, plugin.Config({ project: { root: cardRoot }, paths: { tasksDir: '任务' } }))
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) cardDomains[key] = cardCtx.ctx.storageDomain.opened.get(spec.name)
const cardAudit = await auditScan({
  store: createStore(cardDomains, 'card'),
  project: { ...cardProject, audit: {}, docKinds: {}, docsDirs: [], panel: {} },
  config: plugin.Config({ project: { root: cardRoot }, audit: { checks: [] } }),
})
const cardObs = cardAudit.items.filter((item) => item.check === 'task_card_incomplete')
assert.ok(cardObs.length >= 1, 'FIX-64 ②：缺字段的卡要进观察项（进审计、可见）')
assert.equal(cardObs[0].level, 'info', 'FIX-64：观察项是 info（不告警）')
assert.equal(cardAudit.counts.byCheck.task_card_incomplete, undefined, 'FIX-64：观察项不计红黄')
assert.equal(cardObs.some((item) => item.target === 'T-802'), false, 'FIX-64 ③：字段齐的卡不进观察项')
ok('FIX-64 作业登记卡：插件提供字段规范 + 可复制的模板（含逐条 只读/写/禁止改动）+ 规范进契约 / 交付时校验缺字段并进观察项（info·不计红黄·齐了不提示）')

// ---------------------------------------------------------------- FIX-68 占用文件/资源 → 并发冲突审计
assert.equal(modeOf('写(新文件)'), 'newFile', 'FIX-68：模式解析（写(新文件)）')
assert.equal(modeOf('禁止改动'), 'forbidden', 'FIX-68：模式解析（禁止改动）')
assert.equal(modeOf('随便写点什么吧'), 'write', 'FIX-68：模式解析（含"写"）')
assert.equal(modeOf('看不懂的说明'), 'read', 'FIX-68：判不出按 read（最保守，不误报"写写冲突"）')
assert.equal(isActiveStatus('完成'), false, 'FIX-68 ②：已完成不参与判定')
assert.equal(isActiveStatus('已释放'), false, 'FIX-68 ②：已释放不参与判定')
assert.equal(isActiveStatus('阻塞'), true, 'FIX-68：阻塞仍占着文件 ⇒ 仍参与判定')
// 路径归一化：D:\a\b 与 D:/a/b 视作同一路径
assert.equal(
  normalizeOccupancyPath({ root: 'D:\\P' }, 'D:/P/docs/x.md'),
  normalizeOccupancyPath({ root: 'D:\\P' }, 'D:\\P\\docs\\x.md'),
  'FIX-68 ⑤：路径归一化把 `D:\\a\\b` 与 `D:/a/b` 视为同一路径',
)
assert.equal(normalizeOccupancyPath({ root: 'D:\\P' }, 'docs/x.md'), 'd:/p/docs/x.md', 'FIX-68：相对路径按项目根拼成绝对路径')
const conflictCard = (taskId, status, rows) => ({ taskId, status, occupancies: rows })
const cBase = { path: 'd:/p/a.md', raw: 'a.md' }
const conflictRows = occupancyConflicts([
  conflictCard('T-900', '进行中', [{ ...cBase, mode: 'write' }]),
  conflictCard('T-901', '进行中', [{ ...cBase, mode: 'newFile' }]),
])
assert.equal(conflictRows.length, 1, 'FIX-68 ①：两个活跃任务都声明写同一路径 ⇒ 必报')
assert.equal(conflictRows[0].level, 'red', 'FIX-68 ①：写写冲突是真会互相覆盖 ⇒ 按红报')
assert.ok(conflictRows[0].detail.includes('T-900') && conflictRows[0].detail.includes('T-901') && conflictRows[0].detail.includes('d:/p/a.md'),
  'FIX-68 ③：要写出**两方任务号 + 路径 + 各自模式**')
assert.ok(conflictRows[0].detail.includes('串行') || conflictRows[0].detail.includes('改分工'), 'FIX-68 ③：人话里给"建议串行或改分工"')
assert.deepEqual(
  toHost(occupancyConflicts([conflictCard('T-902', '完成', [{ ...cBase, mode: 'write' }]), conflictCard('T-903', '进行中', [{ ...cBase, mode: 'write' }])])),
  [], 'FIX-68 ②：一张完成、一张活跃 ⇒ 不报',
)
const wr = occupancyConflicts([conflictCard('T-904', '进行中', [{ ...cBase, mode: 'write' }]), conflictCard('T-905', '进行中', [{ ...cBase, mode: 'read' }])])
assert.equal(wr.length, 1, 'FIX-68 ③：一写一读 ⇒ 报')
assert.equal(wr[0].level, 'yellow', 'FIX-68 ③：一写一读是黄（可能读到半成品）')
const fb = occupancyConflicts([conflictCard('T-906', '进行中', [{ ...cBase, mode: 'forbidden' }]), conflictCard('T-907', '进行中', [{ ...cBase, mode: 'write' }])])
assert.equal(fb.length, 1, 'FIX-68 ④：声明 forbidden 却被写 ⇒ 报')
assert.equal(fb[0].level, 'yellow', 'FIX-68 ④：这条也是黄')
// 端到端：写两张真卡 → 审计报出来（检查项开出来才有牙）
const realCard = (taskId, status, path, mode) => ['# ' + taskId, '- 上级: 主代理', '- 占用文件或资源:', `  - ${path} — ${mode}`,
  `- 状态: ${status}`, '- 阶段产出: (待补)', '- 异常: 无', ''].join('\n')
const conflictRoot = await mkdtemp(join(tmpdir(), 'ac-conflict-'))
await mkdir(joinUnderRoot(conflictRoot, '任务'), { recursive: true })
await writeFile(joinUnderRoot(conflictRoot, '任务/T-910.md'), realCard('T-910', '进行中', 'D:\\A\\同一个.md', '写(新文件)'), 'utf8')
await writeFile(joinUnderRoot(conflictRoot, '任务/T-911.md'), realCard('T-911', '进行中', 'D:/A/同一个.md', '写'), 'utf8')
await writeFile(joinUnderRoot(conflictRoot, '任务/T-912.md'), realCard('T-912', '完成', 'D:\\A\\同一个.md', '写'), 'utf8')
const conflictCtx = makeCtx()
plugin.apply(conflictCtx.ctx, plugin.Config({ project: { root: conflictRoot }, paths: { tasksDir: '任务' }, audit: { checks: ['occupancy_conflict'] } }))
const conflictDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) conflictDomains[key] = conflictCtx.ctx.storageDomain.opened.get(spec.name)
const conflictAudit = await auditScan({
  store: createStore(conflictDomains, 'conflict'),
  project: resolveProject(plugin.Config({ project: { root: conflictRoot }, paths: { tasksDir: '任务' } })),
  config: plugin.Config({ project: { root: conflictRoot }, paths: { tasksDir: '任务' }, audit: { checks: ['occupancy_conflict'] } }),
})
const conflictItems = conflictAudit.items.filter((item) => item.check === 'occupancy_conflict')
assert.equal(conflictItems.length, 1, 'FIX-68：端到端只报**一对**（已完成那张不参与；两处不同写法视作同一路径）')
assert.equal(conflictItems[0].level, 'red', 'FIX-68：写写冲突按红报（逐条覆盖严重度）')
assert.ok(String(conflictItems[0].target).includes('T-910') && String(conflictItems[0].target).includes('T-911'), 'FIX-68：报出两方任务号')
assert.ok(conflictAudit.humanReport.includes('串行') || conflictAudit.humanReport.includes('改分工'), 'FIX-68 ③：人话报告里能看到建议动作')
ok('FIX-68 占用冲突审计：作业登记卡占用段解析成机读 {任务号,路径,模式} / 写写=红·一写一读=黄·写了 forbidden=黄 / 完成与已释放不参与 / 路径归一化 / 报两方与路径并给"串行或改分工"')

// ---------------------------------------------------------------- FIX-70 渐进式披露：三档之间用元数据指针串联（终点是 L1）
assert.deepEqual(
  toHost(pointersFor({ tier: 3, byTier: { 1: '/L1.md', 2: '/L2.md' } }).pointers),
  { nextTier: '/L2.md', fullDetail: '/L1.md' },
  'FIX-70 ①：L3 → nextTier(L2) + fullDetail(L1)',
)
assert.deepEqual(toHost(pointersFor({ tier: 2, byTier: { 1: '/L1.md' } }).pointers), { fullDetail: '/L1.md' }, 'FIX-70 ①：L2 → fullDetail(L1)')
assert.deepEqual(toHost(pointersFor({ tier: 1, byTier: {} }).pointers), { detailLevel: 'full' }, 'FIX-70 ①：L1 → detailLevel: full（终点，无下钻指针）')
assert.deepEqual(toHost(pointersFor({ tier: 3, byTier: {} }).missing), ['L2', 'L1'], 'FIX-70 ②：另一档还没生成 ⇒ 指针留空并记下缺谁（回执据此提示）')
assert.equal(missingProgressiveLink({ tier: 3, meta: { nextTier: '/L2.md' } }), true, 'FIX-70 ④：L3 只有 nextTier、没有指向 L1 的 fullDetail ⇒ 仍算缺')
assert.equal(missingProgressiveLink({ tier: 2, meta: { fullDetail: '/L1.md' } }), false, 'FIX-70 ④：L2 有 fullDetail ⇒ 合格')
assert.equal(missingProgressiveLink({ tier: 1, meta: { detailLevel: 'full' } }), false)
// 端到端：三档依次写 → 指针自动串起来（含**回填**：写完 L1 时 L2/L3 的 fullDetail 自动补上）
const pgRoot = await mkdtemp(join(tmpdir(), 'ac-prog-'))
await mkdir(joinUnderRoot(pgRoot, 'docs/子agent'), { recursive: true })
const pgCfg = plugin.Config({ project: { name: '渐进', root: pgRoot, brief: '一个用来验证渐进式披露的项目' }, paths: { deliverablesDir: 'docs/子agent', docsDirs: ['docs'] } })
const pgCtx = makeCtx()
plugin.apply(pgCtx.ctx, pgCfg)
const pgExec = { agent: { id: 'root-session', session: { header: { delegationDepth: 0 } } }, signal: new AbortController().signal }
const pgEmit = pgCtx.mine.find((tool) => tool.name === 'doc_emit')
const pgBody = (mark) => `## 结论\n\n${mark}\n\n## 依据\n\n依据。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。\n`
const pgL3 = await pgEmit.execute({ level: 3, taskId: 'T-950', title: '渐进披露', role: 'researcher', body: pgBody('L3 正文') }, pgExec)
assert.ok(String(pgL3.progressiveHint || '').includes('L1') || String(pgL3.progressiveHint || '').includes('L2'), 'FIX-70 ②：L3 先写时回执要提示"还缺哪一档的下钻目标"')
const pgL2 = await pgEmit.execute({ level: 2, taskId: 'T-950', title: '渐进披露', role: 'researcher', body: pgBody('L2 正文') }, pgExec)
const pgL1 = await pgEmit.execute({ level: 1, taskId: 'T-950', title: '渐进披露', role: 'researcher', body: pgBody('L1 正文') }, pgExec)
const readMetaOf = async (path) => parseFrontMatter(await readFile(path, 'utf8'))
const l3Meta = await readMetaOf(pgL3.path)
assert.equal(l3Meta.meta.fullDetail, pgL1.path, 'FIX-70 ②：写完 L1 后 L3 的 fullDetail **被自动回填**（指针跟着串起来）')
assert.equal(l3Meta.meta.nextTier, pgL2.path, 'FIX-70 ②：L3 的 nextTier 指向 L2')
assert.equal(l3Meta.meta.detailLevel, undefined, 'FIX-70：L3 不是终点，不写 detailLevel')
const l2Meta = await readMetaOf(pgL2.path)
assert.equal(l2Meta.meta.fullDetail, pgL1.path, 'FIX-70 ②：L2 的 fullDetail 指向 L1')
const l1Meta = await readMetaOf(pgL1.path)
assert.equal(l1Meta.meta.detailLevel, 'full', 'FIX-70 ①：L1 是终点（detailLevel: full）')
assert.equal(l1Meta.meta.fullDetail, undefined, 'FIX-70：L1 没有下钻指针')
// 正文零改动：回填只动 front-matter
assert.ok(l3Meta.body.includes('L3 正文'), 'FIX-70：回填指针**只动 front-matter**，原正文一字不动')
assert.equal(/(编写|回填)/.test(l3Meta.body), false, 'FIX-70：正文里不该混进工具写的东西')
// 速览：首屏 ≤3 行
const l3Lines = l3Meta.body.split('\n')
const quickLines = l3Lines.filter((line) => line.includes('速览'))
assert.equal(quickLines.length <= 3, true, `FIX-70 ⑤：正文首屏速览不超过 3 行，实际 ${quickLines.length}`)
assert.equal(l3Lines[0].includes('速览'), true, 'FIX-70 ⑤：速览要在**首屏**（第一行起）')
assert.ok(quickLines.some((line) => line.includes(pgL1.path)) || quickLines.some((line) => line.includes('细节见')), 'FIX-70 ⑤：速览要说清"要细节去哪"')
// 审计：缺指针 / 脏 relatedFiles 各报一条
const pgDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) pgDomains[key] = pgCtx.ctx.storageDomain.opened.get(spec.name)
const pgStore = createStore(pgDomains, projectKeyOf(pgCfg))
const barePath = joinUnderRoot(pgRoot, 'docs/子agent/T-951_裸档_L3.md')
await writeFile(barePath, renderFrontMatter({ taskId: 'T-951', role: 'researcher', tier: 3, keywords: ['x'], relatedFiles: [], createdAt: new Date().toISOString() }) + '## 结论\n\n裸档。\n', 'utf8')
await pgStore.putDoc(docRecord({ path: barePath, tier: 3, taskId: 'T-951', title: '裸档', keywords: ['x'], relatedFiles: [] }))
const dirtyDoc = joinUnderRoot(pgRoot, 'docs/子agent/T-952_脏路径_L3.md')
await writeFile(dirtyDoc, renderFrontMatter({ taskId: 'T-952', role: 'researcher', tier: 3, keywords: ['x'], relatedFiles: ['`D:\\x\\y.md`', 'D:\\Blockdustry\\[Agent进度'], createdAt: new Date().toISOString() }) + '## 结论\n\n脏路径。\n', 'utf8')
await pgStore.putDoc(docRecord({ path: dirtyDoc, tier: 3, taskId: 'T-952', title: '脏路径', keywords: ['x'], relatedFiles: ['`D:\\x\\y.md`', 'D:\\Blockdustry\\[Agent进度'] }))
const pgAuditCfg = plugin.Config({ project: { root: pgRoot }, paths: { deliverablesDir: 'docs/子agent', docsDirs: ['docs'] }, audit: { checks: ['missing_progressive_link', 'dirty_related_path'] } })
const pgProject = resolveProject(pgAuditCfg)
const pgAudit = await auditScan({ store: pgStore, project: pgProject, config: pgAuditCfg })
const pgMissing = pgAudit.items.filter((item) => item.check === 'missing_progressive_link')
assert.ok(pgMissing.some((item) => item.target === barePath), 'FIX-70 ④：L3 缺指向 L1 的指针 ⇒ 必报')
assert.equal(pgMissing.some((item) => item.target === pgL3.path), false, 'FIX-70 ④：指针齐的档不报（刚写的那三档）')
const pgDirty = pgAudit.items.filter((item) => item.check === 'dirty_related_path')
assert.ok(pgDirty.some((item) => item.target === dirtyDoc), 'FIX-70 ④：relatedFiles 脏路径 ⇒ 必报（现网数据里就有）')
assert.ok(String(pgDirty[0].detail).includes('反引号') || String(pgDirty[0].detail).includes('截断') || String(pgDirty[0].detail).includes('不配对'),
  'FIX-70：脏路径要说明**脏在哪**')
// 契约侧：读法要写"先读概括档、按元数据指针下钻"
const slicesSrc = await readFile(new URL('./src/contract/assemble.js', import.meta.url), 'utf8')
assert.ok(/按 metadata|按元数据指针下钻|按它 front-matter 里的指针下钻/.test(slicesSrc), 'FIX-70 ⑤：契约的文档切片读法要含"按元数据指针下钻"')
assert.ok(slicesSrc.includes('fullDetail') && slicesSrc.includes('nextTier'), 'FIX-70 ⑤：读法里要点名两个指针')
ok('FIX-70 渐进式披露：L3→nextTier(L2)+fullDetail(L1) · L2→fullDetail(L1) · L1=detailLevel:full 终点 / doc_emit 自动写指针并**回填**兄弟档（只动 front-matter）/ 首屏 ≤3 行速览 / 审计 missing_progressive_link 与 dirty_related_path / 契约读法写明按指针下钻')

// ---------------------------------------------------------------- FIX-66 治理验收报告（插件自己算，不靠人手工对）
const vfRoot = await mkdtemp(join(tmpdir(), 'ac-verify66-'))
await mkdir(joinUnderRoot(vfRoot, 'docs/子agent'), { recursive: true })
await mkdir(joinUnderRoot(vfRoot, '任务'), { recursive: true })
await writeFile(joinUnderRoot(vfRoot, 'docs/子agent/T-960_a_L3.md'),
  renderFrontMatter({ taskId: 'T-960', role: 'researcher', tier: 3, keywords: ['甲'], relatedFiles: [], createdAt: new Date().toISOString() })
  + '## 结论\n\n正文甲。\n\n## 依据\n\n依据。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。\n', 'utf8')
await writeFile(joinUnderRoot(vfRoot, 'docs/子agent/T-961_b_L3.md'),
  renderFrontMatter({ taskId: 'T-961', role: 'researcher', tier: 3, keywords: ['乙'], relatedFiles: [], createdAt: new Date().toISOString() })
  + '## 结论\n\n正文乙（里面提到了旧路径 D:\\P\\老名字.md）。\n\n## 依据\n\n依据。\n\n## 风险与待确认\n\n无。\n\n## 下一步\n\n无。\n', 'utf8')
const vfCfg = plugin.Config({ project: { root: vfRoot }, paths: { deliverablesDir: 'docs/子agent', docsDirs: ['docs'], tasksDir: '任务' } })
const vfCtx = makeCtx()
plugin.apply(vfCtx.ctx, vfCfg)
// 先跑一次工具：它会 await ledger.ready ⇒ 三个领域确定开完（直接快照会有竞态）喵
await vfCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const vfDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) vfDomains[key] = vfCtx.ctx.storageDomain.opened.get(spec.name)
const vfStore = createStore(vfDomains, projectKeyOf(vfCfg))
const vfProject = resolveProject(vfCfg)
await rebuildLedger({ store: vfStore, project: vfProject })
// ② 正文零改动证明：逐篇给前后指纹，不一致的单独列出
const bodiesA = await snapshotBodies({ store: vfStore })
const sameDiff = diffBodies(bodiesA, bodiesA)
assert.equal(sameDiff.changed.length, 0, 'FIX-66 ②：正文没动 ⇒ 逐篇 same=true')
assert.equal(sameDiff.rows.length >= 2, true, 'FIX-66 ②：逐篇都要列出来（不是只报个"一致"）')
const tampered = new Map(bodiesA)
const onePath = [...bodiesA.keys()][0]
tampered.set(onePath, 'deadbeef')
const tamperedDiff = diffBodies(bodiesA, tampered)
assert.equal(tamperedDiff.changed.length, 1, 'FIX-66 ③：**故意改动正文 ⇒ 报告必须点出来**（这就是"证明"的意义）')
assert.equal(tamperedDiff.changed[0].path, onePath)
assert.ok(renderVerification({ dryRun: false, actions: [], bodyUnchanged: tamperedDiff }).join('\n').includes('指纹变了'), 'FIX-66 ③：渲染里要显著标出不一致')
// ③ 引用残留：全库检索旧路径
const leftovers = await findReferenceLeftovers({ store: vfStore, oldPaths: ['D:\\P\\老名字.md'] })
assert.equal(leftovers.length, 1, 'FIX-66 ④：引用残留要被检出（哪篇还写着旧路径）')
assert.ok(leftovers[0].path.endsWith('T-961_b_L3.md'), 'FIX-66 ④：残留要指到具体那篇')
// ① 动作清单 + ⑤ dryRun 预演版
const vfSweepDry = await librarianSweep({ project: vfProject, store: vfStore, config: vfCfg, dryRun: true })
assert.ok(vfSweepDry.verification, 'FIX-66 ⑤：dryRun 也要给同一份报告的**预演版**')
assert.equal(vfSweepDry.verification.dryRun, true)
const dryKinds = vfSweepDry.verification.actions.map((row) => row.kind)
assert.equal(dryKinds.every((kind) => kind.startsWith('将') || kind === '待人工裁定'), true, `FIX-66 ⑤：预演版动词用"将…"，实际 ${JSON.stringify(dryKinds)}`)
assert.ok(vfSweepDry.verification.auditDiff && vfSweepDry.verification.auditDiff.before.red !== undefined, 'FIX-66 ④：预演版也带审计基线（真跑那一轮才有 diff 的意义）')
// 真跑：五项齐备
const vfSweep = await librarianSweep({ project: vfProject, store: vfStore, config: vfCfg })
const v = vfSweep.verification
assert.ok(v && !v.dryRun, 'FIX-66 ①：真跑结束自动产出验收报告')
assert.ok(Array.isArray(v.actions), 'FIX-66 ①：要有**动作清单**（每条带路径与原因）')
assert.ok(v.actions.every((row) => row.path && row.reason), 'FIX-66 ①：动作清单每条都要有路径 + 原因')
assert.ok(Array.isArray(v.bodyUnchanged.rows) && v.bodyUnchanged.rows.length >= 2, 'FIX-66 ②：逐篇正文指纹（前 → 后）')
assert.equal(v.bodyUnchanged.changed.length, 0, 'FIX-66 ②：一轮治理只动元数据/命名/位置 ⇒ 正文指纹必须全部一致')
assert.ok(Array.isArray(v.referenceLeftovers), 'FIX-66 ③：引用完整性检查要有结果（空数组=干净）')
assert.ok(v.auditDiff && v.auditDiff.before && v.auditDiff.after, 'FIX-66 ④：审计前后计数与 diff')
const vfLines = renderVerification(v).join('\n')
for (const mark of ['验收报告', '正文零改动', '引用', '审计对比']) {
  assert.ok(vfLines.includes(mark), `FIX-66：渲染里要有「${mark}」`)
}
// 工具入口：sweep 回执里带得出这份报告
const vfTool = vfCtx.mine.find((tool) => tool.name === 'librarian_sweep')
const vfOut = await vfTool.execute({ dryRun: true }, { agent: { session: { header: { delegationDepth: 1 } } }, signal: new AbortController().signal })
assert.ok(vfTool.output.render({}, vfOut)[0].text.includes('验收报告'), 'FIX-66：一轮治理的回执里就要看得见验收报告（不必另开工具）')
ok('FIX-66 治理验收报告：动作清单（移动/改名/引用/归档/裁定·每条带路径与原因）· 正文零改动逐篇前后指纹（改了就点出来）· 引用残留全库检索 · 审计前后红黄与条目 diff · dryRun 给预演版 —— 全部由插件自动产出')

// ---------------------------------------------------------------- FIX-69 文档分门别类（两级目录）· 产出区硬限制 · ^ → 元数据 · 临时文件去处
// ① 两级布局 + 命名后缀与目录一致
const fxRoot = await mkdtemp(join(tmpdir(), 'ac-fix69-'))
const fxCfg = plugin.Config({
  project: { root: fxRoot },
  paths: {
    tasksDir: '任务', progressDir: '[Agent进度]', deliverablesDir: 'docs/产出',
    docsDirs: ['docs/研究', 'docs/审查', 'docs/整合清单', 'docs/坑', 'docs/修改', 'docs/核心数据库', 'docs/产出', 'docs/archive'],
    archiveDir: 'docs/archive',
    docKinds: {
      研究: 'docs/研究', 审查: 'docs/审查', 整合清单: 'docs/整合清单', 坑: 'docs/坑',
      修改: 'docs/修改', 核心数据库: 'docs/核心数据库', 产出档: 'docs/产出', 归档: 'docs/archive',
    },
  },
})
const fxArea = resolveDocArea({ project: resolveProject(fxCfg), taskId: 'T-970', title: '分门别类', tier: 3 })
assert.equal(fxArea.fileName, 'T-970_分门别类_L3.md', 'FIX-69：产出档文件名 `<任务号>_<标题>_L<n>.md`')
assert.equal(fxArea.dir, joinUnderRoot(fxRoot, 'docs/产出/L3'), 'FIX-69：两级布局 —— 类型→目录（产出）、档级→子目录（L3）')
assert.ok(fxArea.path.startsWith(fxArea.dir), 'FIX-69：落点必须在档级子目录里')
const fxResearch = resolveDocArea({ project: resolveProject(fxCfg), taskId: 'T-970', title: '查证', kind: '研究' })
assert.equal(fxResearch.fileName, 'T-970_查证_研究.md', 'FIX-69：类型档文件名 `<任务号>_<标题>_<类型>.md`')
assert.equal(fxResearch.dir, joinUnderRoot(fxRoot, 'docs/研究'), 'FIX-69：类型→目录')
assert.equal(kindFromFileName('T-1_x_审查.md'), '审查', 'FIX-69：从文件名认得出类型后缀')
assert.equal(kindFromFileName('T-1_x_L2.md'), '产出档', 'FIX-69：`_L<n>` 归产出档')
// ② 产出区【硬限制】—— 写动作层面拒绝（不是审计提醒）
assert.throws(() => assertSafeName('T-1_x.json', 'T-1_<标题>_L3.md'), /只收 \.md/, 'FIX-69：产出区只收 .md（非 .md 一律拒收）')
assert.throws(() => assertSafeName('a/b.md', 'x.md'), /路径分隔符/, 'FIX-69：文件名不得含路径分隔符')
assert.throws(() => resolveDocArea({ project: resolveProject(fxCfg), taskId: 'T-1', title: 'x', tier: 3, kind: '不存在的类型' }), /未知的文档类型/, 'FIX-69：未知类型直接拒绝')
assert.throws(() => resolveDocArea({ project: resolveProject(fxCfg), taskId: 'T-1', title: 'x', tier: 3, kind: '归档' }), /归档档由/, 'FIX-69：归档目录不许 doc_emit 直接写（归 archive 动作）')
assert.throws(() => resolveDocArea({ project: resolveProject(fxCfg), taskId: 'T-1', title: 'x', tier: 2, kind: '研究' }), /不该带 level/, 'FIX-69：类型档不带档级（拒绝）')
const noKindProject = resolveProject(plugin.Config({ project: { root: fxRoot }, paths: { deliverablesDir: 'docs/产出' } }))
assert.throws(() => resolveDocArea({ project: noKindProject, taskId: 'T-1', title: 'x', kind: '审查' }), /没配「审查」类目录/, 'FIX-69：类型目录没配 ⇒ 拒绝并说明（不是默默写到别处）')
// ③ doc_emit 真落盘：产出档进 L<n>、类型档进类目录
const fxCtx = makeCtx()
plugin.apply(fxCtx.ctx, fxCfg)
const fxEmit = fxCtx.mine.find((tool) => tool.name === 'doc_emit')
const fxExec = { agent: { id: 'root-session', session: { header: { delegationDepth: 0 } } }, signal: new AbortController().signal }
const fxDoc = await fxEmit.execute({ level: 3, taskId: 'T-970', title: '分门别类', role: 'implementer', body: '## 结论\n\n甲。\n' }, fxExec)
assert.equal(fxDoc.path, joinUnderRoot(fxRoot, 'docs/产出/L3/T-970_分门别类_L3.md'), 'FIX-69：doc_emit 的产出档必须落到档级子目录')
const fxResearchDoc = await fxEmit.execute({ kind: '研究', taskId: 'T-970', title: '查证', role: 'researcher', body: '## 结论\n\n乙。\n' }, fxExec)
assert.equal(fxResearchDoc.path, joinUnderRoot(fxRoot, 'docs/研究/T-970_查证_研究.md'), 'FIX-69：doc_emit 的类型档落到该类型目录')
// ④ `^` → 元数据 + ⑤ 临时文件搬离 + 类型归位（一轮治理的迁移步骤）
await mkdir(joinUnderRoot(fxRoot, 'docs/坑'), { recursive: true })
await mkdir(joinUnderRoot(fxRoot, 'docs/_临时'), { recursive: true })
const caretPath = joinUnderRoot(fxRoot, 'docs/坑/^T-971_旧归档_坑.md')
await writeFile(caretPath, renderFrontMatter({ taskId: 'T-971', role: 'researcher', tier: 0, keywords: ['丙'], relatedFiles: [], createdAt: new Date().toISOString() })
  + '## 结论\n\n带 ^ 前缀的老档，正文不许动。\n', 'utf8')
const strayPath = joinUnderRoot(fxRoot, 'docs/研究/临时数据.json')
await writeFile(strayPath, '{"hello":"world"}', 'utf8')
const misfiledPath = joinUnderRoot(fxRoot, 'docs/研究/T-972_审查报告_审查.md')
await writeFile(misfiledPath, renderFrontMatter({ taskId: 'T-972', role: 'reviewer', tier: 0, keywords: ['丁'], relatedFiles: [], createdAt: new Date().toISOString() })
  + '## 结论\n\n审查报告被放进了研究目录。\n', 'utf8')
const fxProject = resolveProject(fxCfg)
await rebuildLedger({ store: await createLedger(makeCtx().ctx, 'fx69').ready, project: fxProject })
const fxDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) fxDomains[key] = fxCtx.ctx.storageDomain.opened.get(spec.name)
const fxStore = createStore(fxDomains, projectKeyOf(fxCfg))
await rebuildLedger({ store: fxStore, project: fxProject })
const fxPreview = await conformDocAreas({ project: fxProject, store: fxStore, dryRun: true })
assert.ok(fxPreview.files.length >= 3, `FIX-69 ⑦：dryRun 要能预演"将归位/将搬离"，实际 ${fxPreview.files.length} 条`)
assert.ok(existsSync(caretPath), 'FIX-69 ⑦：dryRun **不落盘**')
const fxConform = await conformDocAreas({ project: fxProject, store: fxStore })
assert.ok(fxConform.moved >= 3, `FIX-69 ⑦：归位要真动（实际 ${fxConform.moved}）`)
assert.equal(existsSync(caretPath), false, 'FIX-69 ④：`^` 前缀档已改名（去前缀）')
const caretText = await readFile(joinUnderRoot(fxRoot, 'docs/坑/T-971_旧归档_坑.md'), 'utf8')
assert.ok(/^archived: true$/m.test(caretText), 'FIX-69 ④：归档语义写进元数据 `archived: true`')
assert.ok(caretText.includes('带 ^ 前缀的老档，正文不许动。'), 'FIX-69 ④：**正文一字不动**（只改名 + 改头部）')
assert.equal(existsSync(strayPath), false, 'FIX-69 ⑤：非 .md 已从类别目录搬走')
assert.equal(await readFile(joinUnderRoot(fxRoot, 'docs/_临时/临时数据.json'), 'utf8'), '{"hello":"world"}', 'FIX-69 ⑤：**只搬不删**（内容原样）')
assert.ok(isTempPath(fxProject, joinUnderRoot(fxRoot, 'docs/_临时/临时数据.json')), 'FIX-69 ⑤：临时目录是"非类别目录"（审计据此排除）')
assert.equal(existsSync(misfiledPath), false, 'FIX-69 ⑦：类型后缀与目录不符的档被挪走')
assert.ok(existsSync(joinUnderRoot(fxRoot, 'docs/审查/T-972_审查报告_审查.md')), 'FIX-69 ⑦：挪到了正确的类目录')
// ⑥ 三条格式类检查项：正反用例（临时目录**不参与**）
// ⚠ 别再拿**已解析**的 config 去 `Config()` 二次解析（护栏③：读只读访问器会炸）—— 用原始输入喵
const fxAuditRaw = {
  project: { root: fxRoot },
  paths: fxCfg.paths.todoFile === undefined ? {} : {},
  audit: { checks: ['doc_kind_mismatch', 'stray_non_md', 'legacy_caret'] },
}
const fxAuditCfg = plugin.Config({
  project: { root: fxRoot },
  paths: {
    deliverablesDir: 'docs/产出',
    docKinds: {
      研究: 'docs/研究', 审查: 'docs/审查', 整合清单: 'docs/整合清单', 坑: 'docs/坑',
      修改: 'docs/修改', 核心数据库: 'docs/核心数据库', 产出档: 'docs/产出', 归档: 'docs/archive',
    },
  },
  audit: { checks: ['doc_kind_mismatch', 'stray_non_md', 'legacy_caret'] },
})
const fxAuditStore = await createLedger(makeCtx().ctx, 'fx69b').ready
const badKind = joinUnderRoot(fxRoot, 'docs/研究/T-980_报告_审查.md')
await writeFile(badKind, renderFrontMatter({ taskId: 'T-980', role: 'reviewer', tier: 0, keywords: ['戊'], relatedFiles: [], createdAt: new Date().toISOString() }) + '## 结论\n\n审查落研究。\n', 'utf8')
await writeFile(joinUnderRoot(fxRoot, 'docs/研究/残留.json'), '{}', 'utf8')
await writeFile(joinUnderRoot(fxRoot, 'docs/坑/^T-981_老前缀_坑.md'), '## 结论\n\nx\n', 'utf8')
await writeFile(joinUnderRoot(fxRoot, 'docs/_临时/合法的.json'), '{}', 'utf8')
const fxAudit = await auditScan({ store: fxAuditStore, project: fxProject, config: fxAuditCfg })
const kindsHit = fxAudit.items.filter((item) => item.check === 'doc_kind_mismatch')
assert.ok(kindsHit.some((item) => item.target === badKind), 'FIX-69 ⑥：审查报告落进研究目录 ⇒ `doc_kind_mismatch` 必报')
assert.ok(String(kindsHit[0].detail).includes('审查'), 'FIX-69 ⑥：报的时候要说清"文件名说的是审查、躺在研究目录"')
const strayHit = fxAudit.items.filter((item) => item.check === 'stray_non_md')
assert.ok(strayHit.some((item) => String(item.target).endsWith('残留.json')), 'FIX-69 ⑥：类目录里的非 .md ⇒ `stray_non_md`')
assert.equal(strayHit.some((item) => String(item.target).includes('_临时')), false, 'FIX-69 ⑤：**临时目录是排除项**（审计不查它）')
assert.ok(fxAudit.items.some((item) => item.check === 'legacy_caret' && String(item.target).includes('^T-981')), 'FIX-69 ⑥：文件名还带 `^` ⇒ `legacy_caret`')
assert.ok(String(fxAudit.items.find((item) => item.check === 'legacy_caret').detail).includes('archived'), 'FIX-69 ⑥：建议要指向真机制（搬进元数据）')
// 类别键固定八类（新增 审查 / 整合清单）
assert.deepEqual(
  toHost(Object.keys(resolveProject(fxCfg).docKinds)),
  ['研究', '审查', '整合清单', '坑', '修改', '核心数据库', '产出档', '归档'],
  'FIX-69：类别键固定为八类（顺序即文档里的列举顺序）',
)
ok('FIX-69 文档分门别类：两级目录（类型→目录、档级→子目录）· 命名后缀与目录一致 · 产出区硬限制（只收 .md / 落错档级或类型直接拒并给正确路径）· `^`→`archived: true`（正文零改动）· 非 .md 搬去临时目录（只搬不删·审计排除）· 类型归位 · 三条格式类审计项')

// ---------------------------------------------------------------- FIX-71 记录与磁盘不一致（真机 T53 样本：文件移走了，台账还"看得见"它）
const misRoot = await mkdtemp(join(tmpdir(), 'ac-fix71-'))
await mkdir(joinUnderRoot(misRoot, '任务'), { recursive: true })
await mkdir(joinUnderRoot(misRoot, 'docs/产出/L3'), { recursive: true })
await writeFile(joinUnderRoot(misRoot, '任务/T50_在的.md'), '# T50 在的\n', 'utf8')
await writeFile(joinUnderRoot(misRoot, 'docs/产出/L3/T50_在的_L3.md'), '## 结论\n\n在。\n', 'utf8')
const misCfg = plugin.Config({ project: { root: misRoot }, paths: { tasksDir: '任务', deliverablesDir: 'docs/产出', docsDirs: ['docs/产出'] }, audit: { checks: ['task_file_missing', 'doc_file_missing'] } })
const misProject = resolveProject(misCfg)
const misStore = await createLedger(makeCtx().ctx, 'fix71').ready
// ① 台账有未结任务记录，磁盘上没有该文件（真机 T53 的样子）
await misStore.putTask(taskRecord({ taskId: 'T53_文档归位与规范化', status: 'open' }))
await misStore.putDoc(docRecord({ path: joinUnderRoot(misRoot, 'docs/产出/L3/T53_已被移走_L3.md'), tier: 3, taskId: 'T53', title: '已被移走' }))
await misStore.putTask(taskRecord({ taskId: 'T50_在的', status: 'open' }))
await misStore.putDoc(docRecord({ path: joinUnderRoot(misRoot, 'docs/产出/L3/T50_在的_L3.md'), tier: 3, taskId: 'T50', title: '在的' }))
// FIX-71 ⑤：成员记录**不进**这两条检查（members 有"绝不删除"不变量）—— 缓存里放一条孤零零的成员
await misStore.putMember(memberRecord({ id: 'sess-孤零零', name: 'T53-文档归位与规范化-librarian', role: 'librarian', status: 'running' }))
const misAudit = await auditScan({ store: misStore, project: misProject, config: misCfg })
const taskMissing = misAudit.items.filter((item) => item.check === 'task_file_missing')
assert.equal(taskMissing.length, 1, 'FIX-71 ①：有未结任务记录、磁盘无文件 ⇒ 必报（且只报那一条）')
assert.equal(taskMissing[0].target, 'T53_文档归位与规范化', 'FIX-71 ①：报出**任务号**')
assert.ok(String(misAudit.humanReport).includes('ledger_rebuild'), 'FIX-71 ①：建议要指向重建台账')
assert.equal(taskMissing.some((item) => item.target === 'T50_在的'), false, 'FIX-71 ④：文件在的未结任务不报（零误报）')
const docMissing = misAudit.items.filter((item) => item.check === 'doc_file_missing')
assert.equal(docMissing.length, 1, 'FIX-71 ③：文档记录指向不存在的文件 ⇒ 同样报')
assert.ok(String(docMissing[0].target).includes('T53_已被移走'), 'FIX-71 ③：报出**路径**')
assert.equal(docMissing.some((item) => String(item.target).includes('T50_在的')), false, 'FIX-71 ④：文件在的档不报')
// 两条排一起 + 一行总建议
const misReport = String(misAudit.humanReport)
assert.ok(misReport.includes('台账与磁盘不一致（2 条'), 'FIX-71 ④：报告里两条**排一起**')
assert.ok(misReport.includes('台账是缓存，磁盘才是事实'), 'FIX-71 ④：附一行总建议')
assert.ok(/只报不删/.test(misReport), 'FIX-71 ③：写清"只报不删"（删除不可逆）')
// ⑤ 成员不进本检查（源码级：这两条实现不碰 listMembers）
const fix71ChecksSrc = await readFile(new URL('./src/audit/checks.js', import.meta.url), 'utf8')
const fix71Block = fix71ChecksSrc.slice(fix71ChecksSrc.indexOf('async function checkTaskFileMissing'), fix71ChecksSrc.indexOf('export const LEDGER_MISMATCH_CHECKS'))
assert.equal(/listMembers/.test(fix71Block), false, 'FIX-71 ⑤：这两条**不得**读 members（带 sessionId 的实时记录只在 storages，绝不删除）')
// 只报不删：跑完审计，台账与磁盘都没被动过
assert.equal(misStore.sizes().tasks, 2, 'FIX-71 ③：审计**不删**台账记录（只报不删）')
assert.equal(misStore.sizes().docs, 2, 'FIX-71 ③：文档记录也不删')
assert.ok(existsSync(joinUnderRoot(misRoot, '任务/T50_在的.md')), 'FIX-71：审计不碰磁盘')
// ② 重建台账 ⇒ 不再报（磁盘才是事实）
await rebuildLedger({ store: misStore, project: misProject })
const misAfter = await auditScan({ store: misStore, project: misProject, config: misCfg })
assert.equal(misAfter.items.filter((item) => item.check === 'task_file_missing').length, 0, 'FIX-71 ②：重建台账后不再报（磁盘上没有的任务记录被清掉）')
assert.equal(misAfter.items.filter((item) => item.check === 'doc_file_missing').length, 0, 'FIX-71 ②：文档记录同样被清掉')
assert.equal(misAfter.humanReport.includes('台账与磁盘不一致'), false, 'FIX-71 ②：那一段也消失')
// 真机回归位：T50 的文件还在 ⇒ 重建后它仍被记着（别把好记录一起清掉）
assert.equal(misStore.getTask('T50_在的') !== undefined, true, 'FIX-71：重建只清"文件不在了"的记录，正常记录保留')
ok('FIX-71 记录与磁盘不一致：未结任务无文件 / 文档记录指向不存在的路径 ⇒ 两条都报（带任务号与路径）· 建议指向 ledger_rebuild · 报告里排一起并给"台账是缓存、磁盘才是事实"的总建议 · 只报不删 · 成员记录不进本检查 · 重建后消失')

// ---------------------------------------------------------------- FIX-72 规范要有 agent 可读形式（不翻源码/设计稿）
const specProject = resolveProject(fxCfg)
const specLines = docSpecLines({ project: specProject }).join('\n')
for (const [label, pattern] of [
  ['每类的目录 + 命名后缀', /产出档（三档）：[\s\S]*<任务号>_<标题>_L<n>\.md/],
  ['必备头部字段', /taskId \/ role \/ tier \/ keywords \/ relatedFiles \/ createdAt/],
  ['产出区硬限制', /只收 \.md/],
  ['归档字段', /archived: true/],
  ['临时文件去处', /_临时/],
  ['渐进式披露指针规则', /nextTier.*L2.*fullDetail.*L1/s],
  ['下一步姿势（派单 + dryRun）', /contract_delegate_librarian[\s\S]{0,80}dryRun/],
]) {
  assert.ok(pattern.test(specLines), `FIX-72 ①：规范段必须含「${label}」`)
}
assert.ok(/不需要读文档正文，也不需要读插件源码/.test(specLines), 'FIX-72 ②：要写明"这类活不必读正文/源码"')
// contract_status 真输出：规范段 + 篇数分开标 + 覆盖范围说明
const specCtx = makeCtx()
plugin.apply(specCtx.ctx, fxCfg)
const specTool = specCtx.mine.find((tool) => tool.name === 'contract_status')
const specOut = await specTool.execute({}, { agent: { session: { header: { delegationDepth: 0, cwd: fxRoot } } }, signal: new AbortController().signal })
const specText = specTool.output.render({}, specOut)[0].text
for (const mark of ['文档规范（每类 = 目录 + 命名后缀 + 必备头部字段）', '_L<n>.md', 'taskId / role / tier', '只收 .md', 'archived: true', 'nextTier', 'contract_delegate_librarian']) {
  assert.ok(specText.includes(mark), `FIX-72 ①：contract_status 输出里要有「${mark}」（回归位：主代理不必再翻源码）`)
}
assert.ok(specOut.doc_spec.length >= 8, 'FIX-72 ①：规范段以结构化字段给出（可断言、也可渲染）')
assert.ok(specOut.doc_counts && typeof specOut.doc_counts.ledger === 'number' && typeof specOut.doc_counts.disk === 'number', 'FIX-72 ④：台账/磁盘两套篇数分开给')
assert.ok(/台账只含「产出档 \/ 任务 \/ 进度」/.test(specOut.doc_counts.note), 'FIX-72 ④：说明台账的**覆盖范围**（免得 106 vs 146 被误读成漏档）')
assert.ok(specText.includes('篇数：台账') && specText.includes('磁盘'), 'FIX-72 ④：渲染里两个数都要标出来')
assert.ok(/不需要读插件源码/.test(specTool.description), 'FIX-72 ⑤：工具描述要写明"了解规范读它即可"')
// ③ 三条审计建议都给具体去向
assert.ok(/应放：[\s\S]*docs[\\/]审查/.test(String(fxAudit.items.find((item) => item.check === 'doc_kind_mismatch').detail)), 'FIX-72 ③：doc_kind_mismatch 要说清**应放目录**（绝对路径，两种分隔符都算）')
assert.ok(String(fxAudit.items.find((item) => item.check === 'doc_kind_mismatch').detail).includes('_审查.md'), 'FIX-72 ③：给出**正确文件名**')
assert.ok(SUGGESTIONS.stray_non_md.includes('临时目录') || SUGGESTIONS.stray_non_md.includes('_临时'), 'FIX-72 ③：stray_non_md 指向 tempDir')
assert.ok(/archived: true/.test(SUGGESTIONS.legacy_caret), 'FIX-72 ③：legacy_caret 说清"去前缀 + 写 archived: true"')
ok('FIX-72 规范有 agent 可读形式：contract_status 增「文档规范」段（目录+后缀+头部字段·硬限制·归档字段·临时去处·指针规则·下一步姿势）· 台账/磁盘篇数分开标并说明覆盖范围 · 三条审计建议都给具体去向 · 工具描述写明不必读源码')

// ---------------------------------------------------------------- FIX-73 记账不能静默 + 面板"待接"要能自解释
// ① 快照成员投影**不许丢字段**（真机原话："图书管理员居然是非长期性 agent"——`mode` 被丢，客户端退化成"未知"）
const fx73Ctx = makeCtx()
plugin.apply(fx73Ctx.ctx, fxCfg)
const fx73Exec = { agent: { id: 'root-session', session: { header: { delegationDepth: 1, cwd: fxRoot } } }, signal: new AbortController().signal }
const fx73Delegate = fx73Ctx.mine.find((tool) => tool.name === 'contract_delegate_librarian')
await fx73Delegate.execute({ taskId: 'T-975' }, fx73Exec)
const fx73Domains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) fx73Domains[key] = fx73Ctx.ctx.storageDomain.opened.get(spec.name)
// ⚠ 记账走的是**自适应推出来的项目键**（显式 root 但没写 name ⇒ 用目录名），不是 `projectKeyOf`（那是配置名）喵
const fx73Store = createStore(fx73Domains, projectSlugOf(deriveProjectName(fxRoot)))
const fx73Snap = buildPanelSnapshot({ store: fx73Store, project: fxProject, audit: null })
const fx73Member = Object.values(fx73Snap.members).find((entry) => String(entry.name).includes('librarian'))
assert.ok(fx73Member, 'FIX-73：馆员的成员记录在快照里')
const fx73Role = getRole({}, 'librarian')
assert.equal(fx73Member.mode, fx73Role.mode, 'FIX-73 ①：快照成员投影必须带上 `mode`，且与角色卡一致（continuable ⇒ 面板才显示"后台（可续派/可唤醒）"）')
assert.equal(fx73Member.mode, 'continuable', 'FIX-73 ①：角色卡是 continuable ⇒ 投影不能退化成"未知"')
for (const field of ['status', 'model', 'derived', 'lastActiveAt']) {
  assert.equal(field in fx73Member, true, `FIX-73 ①：投影要带上 \`${field}\`（真机丢字段导致面板看不出长期性）`)
}
assert.ok(/clientSource/.test('clientSource') && clientSource.includes('if (entry.mode) node.mode = entry.mode'), 'FIX-73 ①：client 要把快照里的 mode **落到节点上**（否则 deriveMode 拿不到）')
// ② 空窗期可解释：措辞与"数据源陈旧/未生成"分开
assert.ok(clientSource.includes('NOT_COUNTED_HINT') && clientSource.includes('尚未记账'), 'FIX-73 ②：空窗期要有"尚未记账"的可执行解释（不是干巴巴的"待接"）')
assert.ok(/点击「↻ 刷新」|点「↻ 刷新」或等下一拍/.test(clientSource), 'FIX-73 ②：解释里要有动作（刷新/等下一拍）')
assert.ok(clientSource.includes('node.notCounted = true') && clientSource.includes('item.pendingHint'), 'FIX-73 ②：树里有节点、快照没记录 ⇒ 标 notCounted 并用 pendingHint 渲染')
// ③ 记账不许静默：store 未就绪 / 写失败都要回到回执
const fx73Src = await readFile(new URL('./src/delegation/channels.js', import.meta.url), 'utf8')
assert.ok(/返回记账结果，调用方把「记账延后」写进回执/.test(fx73Src), 'FIX-73 ③：记账函数要返回结果（不再静默 return）')
assert.ok(fx73Src.includes('记账延后：') && fx73Src.includes('bookkeeping.ok === false'), 'FIX-73 ③：回执要把"记账延后"说出来')
assert.ok(/return \{ ok: false, reason: '台账未就绪/.test(fx73Src), 'FIX-73 ③：store 未就绪时给具体原因（不是 return undefined）')
ok('FIX-73 记账与空窗期：快照成员投影补 mode/status/model/derived/lastActiveAt（角色卡 mode 一路传到面板）· 空窗期给"尚未记账（派单后需要几秒）+ 刷新动作"并与"数据源陈旧"分开 · 记账延后有回执警告（不静默）')

// ---------------------------------------------------------------- FIX-76 馆员的搬移能力（真机：没它只能主代理用 pwsh 自己搬 157 项，绕过全部机制）
const rlRoot = await mkdtemp(join(tmpdir(), 'ac-fix76-'))
const rlCfg = plugin.Config({
  project: { root: rlRoot },
  paths: { tasksDir: '任务', deliverablesDir: 'docs/产出', docsDirs: ['docs/研究', 'docs/产出'] },
})
const rlProject = resolveProject(rlCfg)
await mkdir(joinUnderRoot(rlRoot, 'docs/研究'), { recursive: true })
await mkdir(joinUnderRoot(rlRoot, 'docs/产出/L3'), { recursive: true })
await mkdir(joinUnderRoot(rlRoot, 'docs/审查'), { recursive: true })
const rlSrc = joinUnderRoot(rlRoot, 'docs/研究/T-990_待归位_研究.md')
const rlBody = '## 结论\n\n这篇要被搬走，正文一个字都不许变。\n'
await writeFile(rlSrc, renderFrontMatter({ taskId: 'T-990', role: 'researcher', tier: 0, keywords: ['甲'], relatedFiles: [], createdAt: new Date().toISOString() }) + rlBody, 'utf8')
const rlRef = joinUnderRoot(rlRoot, 'docs/产出/L3/T-991_引用方_L3.md')
await writeFile(rlRef,
  renderFrontMatter({ taskId: 'T-991', role: 'implementer', tier: 3, keywords: ['乙'], relatedFiles: [rlSrc], createdAt: new Date().toISOString() })
  + `## 结论\n\n相关：${rlSrc}\n`, 'utf8')
const rlCtx = makeCtx()
plugin.apply(rlCtx.ctx, rlCfg)
await rlCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const rlDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) rlDomains[key] = rlCtx.ctx.storageDomain.opened.get(spec.name)
const rlStore = createStore(rlDomains, projectSlugOf(deriveProjectName(rlRoot)))
await rebuildLedger({ store: rlStore, project: rlProject })
const rlTool = rlCtx.mine.find((tool) => tool.name === 'librarian_relocate')
assert.ok(rlTool, 'FIX-76 ①：`librarian_relocate` 必须注册（馆员的通用搬迁能力）')
const rlTarget = joinUnderRoot(rlRoot, 'docs/审查/T-990_待归位_审查.md')
const rlCollide = joinUnderRoot(rlRoot, 'docs/审查/T-991_占位_审查.md')
await writeFile(rlCollide, '## 结论\n\n占位。\n', 'utf8')
const rlExec = { agent: { session: { header: { delegationDepth: 1 } } }, signal: new AbortController().signal }
// ① 默认 dryRun：预演 + **不落盘** + 报冲突
const rlPreview = await rlTool.execute({ moves: [{ from: rlSrc, to: rlTarget }, { from: rlSrc, to: rlCollide }] }, rlExec)
assert.equal(rlPreview.relocation.dryRun, true, 'FIX-76 ①：**默认 dryRun**（不传 dryRun:false 就只预演）')
assert.equal(rlPreview.relocation.planned.length, 1, 'FIX-76 ①：预演给出"将移动 N 项"')
assert.equal(rlPreview.relocation.conflicts.length, 1, 'FIX-76 ②：目标已存在 ⇒ 该条被**拒收**（不覆盖）')
assert.ok(String(rlPreview.relocation.conflicts[0].reason).includes('目标已存在'), 'FIX-76 ②：拒收理由要说清')
assert.ok(rlPreview.relocation.refsTotal >= 1, 'FIX-76 ①：预演要报"影响引用 R 处"')
assert.ok(existsSync(rlSrc), 'FIX-76 ①：dryRun **不落盘**')
assert.ok(rlTool.output.render({}, rlPreview)[0].text.includes('搬移预演'), 'FIX-76 ①：回执给出预演（确认后才落盘）')
// 落盘：备份 + 引用同步（头部与正文都改）+ 留痕 + 回滚清单 + 正文 sha 不变
const rlDone = await rlTool.execute({ moves: [{ from: rlSrc, to: rlTarget }], dryRun: false }, rlExec)
assert.equal(rlDone.relocation.moved, 1, 'FIX-76：确认后落盘真搬')
assert.equal(existsSync(rlSrc), false, 'FIX-76：源文件已不在原处')
assert.ok(existsSync(rlTarget), 'FIX-76：文件到了目标位置')
const rlMovedText = await readFile(rlTarget, 'utf8')
assert.ok(rlMovedText.includes('这篇要被搬走，正文一个字都不许变。'), 'FIX-76 ⑦：正文一字不动')
assert.ok(/librarianTouchedAt: /.test(rlMovedText) && /librarianChanges: \[/.test(rlMovedText), 'FIX-76 ⑤：留痕（librarianTouchedAt / librarianChanges）')
assert.equal(rlDone.relocation.bodyProof.every((row) => row.same === true), true, 'FIX-76 ⑦：正文指纹逐篇一致（官方回执给证据）')
const rlBackupDir = joinUnderRoot(rlProject.root, BACKUP_DIR_REL)
assert.ok(existsSync(rlBackupDir), 'FIX-76 ③：写前备份目录存在（与既有写入路径同源）')
assert.ok(rlDone.relocation.rollback.some((row) => row.from === rlTarget && row.to === rlSrc), 'FIX-76 ⑥：回滚清单可反推（新 → 旧）')
const rlRefText = await readFile(rlRef, 'utf8')
assert.ok(rlRefText.includes(rlTarget), 'FIX-76 ④：引用方**正文**已指向新路径')
assert.ok(rlRefText.includes(`relatedFiles: ["${rlTarget.replace(/\\/g, '\\\\')}"]`) || rlRefText.includes(rlTarget), 'FIX-76 ④：引用方**头部 relatedFiles** 也指向新路径（真机缺的就是这一环）')
assert.equal(rlRefText.includes(rlSrc), false, 'FIX-76 ④：旧路径不再残留')
ok('FIX-76 馆员搬移能力：`librarian_relocate` 默认 dryRun 预演（将移动 N / 冲突 C / 影响引用 R）· 目标已存在拒收 · 写前备份 · **引用同步（头部 relatedFiles + 正文）** · 留痕 · 回滚清单可反推 · 正文指纹逐篇不变')

// ---------------------------------------------------------------- FIX-77 收口：引用一致性 + legacy 待归档标注 + `^` 表述订正
const rpRoot = await mkdtemp(join(tmpdir(), 'ac-fix77-'))
const rpCfg = plugin.Config({
  project: { root: rpRoot },
  paths: { tasksDir: '任务', deliverablesDir: 'docs/产出', docsDirs: ['docs/研究', 'docs/产出', 'docs/坑'] },
})
const rpProject = resolveProject(rpCfg)
await mkdir(joinUnderRoot(rpRoot, 'docs/研究'), { recursive: true })
await mkdir(joinUnderRoot(rpRoot, 'docs/坑'), { recursive: true })
await mkdir(joinUnderRoot(rpRoot, 'docs/产出/L3'), { recursive: true })
await mkdir(joinUnderRoot(rpRoot, '任务'), { recursive: true })
const rpRight = joinUnderRoot(rpRoot, 'docs/研究/T-901_炮管黑_研究.md')
await writeFile(rpRight, renderFrontMatter({ taskId: 'T-901', role: 'researcher', tier: 0, keywords: ['甲'], relatedFiles: [], createdAt: new Date().toISOString() }) + '## 结论\n\n真身。\n', 'utf8')
const rpDeadRef = joinUnderRoot(rpRoot, 'docs/研究/T-901_炮管黑_旧名.md') // 断引用：**任务号对得上、文件名变了**（真机那类）
const rpDead = joinUnderRoot(rpRoot, 'docs/产出/L3/T-902_断引用_L3.md')
await writeFile(rpDead,
  renderFrontMatter({ taskId: 'T-902', role: 'implementer', tier: 3, keywords: ['乙'], relatedFiles: [rpDeadRef], createdAt: new Date().toISOString() })
  + `## 结论\n\n正文也在指 ${rpDeadRef}\n`, 'utf8')
const rpAmbiguous = joinUnderRoot(rpRoot, 'docs/坑/T-903_歧义_L3.md')
await writeFile(rpAmbiguous,
  renderFrontMatter({ taskId: 'T-903', role: 'researcher', tier: 3, keywords: ['丙'], relatedFiles: [joinUnderRoot(rpRoot, 'docs/别的/重名.md')], createdAt: new Date().toISOString() })
  + '## 结论\n\n歧义引用。\n', 'utf8')
await writeFile(joinUnderRoot(rpRoot, 'docs/研究/重名.md'), '## 结论\n\n甲家。\n', 'utf8')
await writeFile(joinUnderRoot(rpRoot, 'docs/坑/重名.md'), '## 结论\n\n乙家。\n', 'utf8')
// legacy（无头部旧档）放**产出区** —— 台账只覆盖产出档/任务/进度，legacy 标记也来自那份扫描喵
const rpLegacy = joinUnderRoot(rpRoot, 'docs/产出/旧档-没有头部.md')
await writeFile(rpLegacy, '# 旧档\n\n没有 front-matter 的存量档。\n', 'utf8')
const rpCaret = joinUnderRoot(rpRoot, 'docs/坑/T-904_规矩_坑.md')
await writeFile(rpCaret,
  renderFrontMatter({ taskId: 'T-904', role: 'researcher', tier: 0, keywords: ['丁'], relatedFiles: [], createdAt: new Date().toISOString() })
  + '# 规矩\n\n- `^` = 完成标记（旧规矩，本体如下）\n- 其它规矩保持不变\n', 'utf8')
const rpCtx = makeCtx()
plugin.apply(rpCtx.ctx, rpCfg)
await rpCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const rpDomains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) rpDomains[key] = rpCtx.ctx.storageDomain.opened.get(spec.name)
const rpStore = createStore(rpDomains, projectSlugOf(deriveProjectName(rpRoot)))
await rebuildLedger({ store: rpStore, project: rpProject })
// ① 引用修复：唯一可判定 ⇒ 自动修；歧义 ⇒ 待人工裁定；dryRun 不落盘
const rpDry = await repairDanglingRefs({ project: rpProject, store: rpStore, dryRun: true, recentMoves: [rpDeadRef] })
assert.ok(rpDry.fixed.some((row) => row.path === rpDead), 'FIX-77 ①：唯一可判定（按文件名匹配到真身）⇒ 自动修')
assert.ok(rpDry.pending.some((row) => row.path === rpAmbiguous), 'FIX-77 ①：有歧义（两个同名候选）⇒ 列「待人工裁定」')
assert.ok(rpDry.fixed.some((row) => row.layer === '本轮搬移造成的'), 'FIX-77 ①：报告要分「本轮搬移造成的」')
assert.equal(rpDry.stale >= 0, true, 'FIX-77 ①：报告同时给「存量断引用」计数')
assert.equal((await readFile(rpDead, 'utf8')).includes(rpDeadRef), true, 'FIX-77 ①：dryRun **不落盘**')
const rpFixed = await repairDanglingRefs({ project: rpProject, store: rpStore, dryRun: false, recentMoves: [] })
assert.ok(rpFixed.fixed.length >= 1, 'FIX-77 ①：落盘真修')
const rpDeadText = await readFile(rpDead, 'utf8')
assert.equal(rpDeadText.includes(rpDeadRef), false, 'FIX-77 ①：正文里的断引用也修了')
assert.ok(rpDeadText.includes('T-901_炮管黑_研究.md'), 'FIX-77 ①：指向了唯一匹配的真身')
assert.ok(/librarianChanges: \[/.test(rpDeadText), 'FIX-77 ①：修复留痕')
// 注意分隔符：Windows 路径在 front-matter 里是反斜杠 ⇒ 断言别写死正斜杠（第一版就栽在这）喵
// front-matter 里数组是 JSON 字面量 ⇒ 反斜杠被转义成 `\\`（两个字符）——断言要容忍一或两个分隔符喵
assert.equal(/别的[\\/]+重名\.md/.test(await readFile(rpAmbiguous, 'utf8')), true, 'FIX-77 ①：歧义的那条**不动**（绝不猜）')
// ② legacy 待归档标注（只动 front-matter，正文零改动）+ 审计项
const rpMarkDry = await markArchivePending({ project: rpProject, store: rpStore, dryRun: true })
assert.ok(rpMarkDry.files.some((row) => row.path === rpLegacy), 'FIX-77 ②：legacy 档被点名（预演）')
assert.equal((await readFile(rpLegacy, 'utf8')).startsWith('# 旧档'), true, 'FIX-77 ②：dryRun 不落盘')
const rpMark = await markArchivePending({ project: rpProject, store: rpStore, dryRun: false })
assert.ok(rpMark.marked >= 1, 'FIX-77 ②：批量写入真跑')
const rpLegacyText = await readFile(rpLegacy, 'utf8')
assert.ok(/^archivePending: true$/m.test(rpLegacyText), 'FIX-77 ②：写入 `archivePending: true`')
assert.ok(rpLegacyText.includes('没有 front-matter 的存量档。'), 'FIX-77 ②：**正文零改动**')
assert.equal(/taskId: null/.test(rpLegacyText), false, 'FIX-77 ②：不给 legacy 档塞六个 null 占位（只写该写的字段）')
// ③ 订正 `^` 的错误表述（有意变更 + 留痕）
const rpCaretDry = await correctCaretClaim({ project: rpProject, store: rpStore, dryRun: true })
assert.ok(rpCaretDry.fixed.some((row) => row.path === rpCaret), 'FIX-77 ③：定位到那句错误表述（`^` = 完成标记）')
const rpCaretDone = await correctCaretClaim({ project: rpProject, store: rpStore, dryRun: false })
assert.ok(rpCaretDone.fixed.length >= 1, 'FIX-77 ③：真订正')
const rpCaretText = await readFile(rpCaret, 'utf8')
assert.equal(rpCaretText.includes('完成标记'), false, 'FIX-77 ③：错误表述被订正掉')
assert.ok(rpCaretText.includes('已废弃') && rpCaretText.includes('archived: true'), 'FIX-77 ③：换成正确语义（归档 ⇒ archived: true）')
assert.ok(rpCaretText.includes('- 其它规矩保持不变'), 'FIX-77 ③：**只改那一句**，其余正文不动')
assert.ok(/librarianChanges: \["订正/.test(rpCaretText), 'FIX-77 ③：订正留痕（librarianChanges）')
// 配套审计项：legacy 缺标注 ⇒ 黄
const rpAuditCfg = plugin.Config({
  project: { root: rpRoot },
  paths: { deliverablesDir: 'docs/产出', docKinds: { 研究: 'docs/研究', 坑: 'docs/坑', 产出档: 'docs/产出' } },
  audit: { checks: ['legacy_archive_pending'] },
})
const rpAudit = await auditScan({ store: rpStore, project: resolveProject(rpAuditCfg), config: rpAuditCfg })
assert.equal(rpAudit.items.some((item) => item.check === 'legacy_archive_pending' && item.target === rpLegacy), false, 'FIX-77 ②：标注过的不再报（免得变常驻噪音）')
assert.ok(CHECK_IDS.includes('legacy_archive_pending'), 'FIX-77 ②：审计项 `legacy_archive_pending` 已登记')
ok('FIX-77 收口：引用一致性修复（唯一可判定即自动修·歧义上报·分「存量/本轮」两类·dryRun 先看）· legacy 档批量补 `archivePending: true`（只动 front-matter、正文零改动、不塞 null 占位）· 订正 `^` 的错误表述（只改那一句 + 留痕）· 配套审计项')

// ---------------------------------------------------------------- FIX-78 "等结果"的代价必须写在描述里（真机：主代理为此把常驻馆员降级成一次性）
const f78Role = getRole({}, 'librarian')
const f78Tool = toolOf('contract_delegate_librarian')
const f78Desc = f78Tool.description
assert.ok(/run_in_background/.test(f78Desc) && /一次性/.test(f78Desc) && /不能再派活/.test(f78Desc), 'FIX-78 ①：描述必须写明"传 false ⇒ 一次性、之后不能再派活"的代价')
assert.ok(/两段式/.test(f78Desc) && /续派/.test(f78Desc), 'FIX-78 ②：要给出"要结果又要续派"的正确姿势（两段式 + 续派）')
const f78Head = f78Desc.split('\n').slice(0, 4).join('\n')
assert.ok(/一次性|常驻/.test(f78Head), 'FIX-78 ①：代价要出现在**描述开头**（agent 通常只读开头）')
// ③ 契约里显示代价（子代理自己也知道被怎么派的）
const f78Project = resolveProject(cfg)
const f78Cont = await buildContract({ config: cfg, roleId: 'librarian', task: { id: 'T-001' }, parent: '主代理', layer: 1, totalAgents: 2, project: f78Project, oneShot: true })
assert.ok(/运行模式：.*本次为一次性/.test(f78Cont.text), 'FIX-78 ③：传 false ⇒ 契约的「运行模式」标明**本次为一次性**')
const f78ContBg = await buildContract({ config: cfg, roleId: 'librarian', task: { id: 'T-001' }, parent: '主代理', layer: 1, totalAgents: 2, project: f78Project })
assert.ok(/运行模式：.*常驻单例/.test(f78ContBg.text), 'FIX-78 ③：默认 ⇒ 契约标明"常驻单例"（可续派）')
ok('FIX-78 "等结果"的代价：描述写明 `run_in_background: false` ⇒ **一次性、之后不能再派活**（且在描述开头）+ 给出两段式正确姿势 / 契约的「运行模式」照实标明本次是一次性还是常驻')

// ---------------------------------------------------------------- FIX-79 常驻单例馆员（一个会话服务多个任务）+ 排队
const f79Ctx = makeCtx()
const f79Sent = []
f79Ctx.ctx.subagents.sendMessage = async (sender, targetId, content, options) => {
  f79Sent.push({ sender, targetId, text: content && content[0] ? content[0].text : '' })
  return 'msg-continued-1'
}
plugin.apply(f79Ctx.ctx, cfg)
await f79Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f79Domains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) f79Domains[key] = f79Ctx.ctx.storageDomain.opened.get(spec.name)
const f79Store = createStore(f79Domains, projectKeyOf(cfg))
const f79Tool = f79Ctx.mine.find((tool) => tool.name === 'contract_delegate_librarian')
const f79Exec = { agent: bgAgent, signal: new AbortController().signal }
// ① 三次不同任务的馆员活 ⇒ **只创建 1 个常驻成员**，其余是续派
const f79First = await f79Tool.execute({ taskId: 'T-931' }, f79Exec)
assert.equal(f79First.dispatched, 'created', 'FIX-79 ②：首次调用 = **创建**')
assert.equal(f79First.resident, true, 'FIX-79：常驻单例的回执要标明 resident')
// 宿主报"干完一轮"⇒ 它变回空闲；下一次派单应当是**续派**而不是新建喵
await f79Store.putMember(memberRecord({ id: 'child-continuable-1', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'completed', layer: 1, parent: '主代理' }))
const f79Second = await f79Tool.execute({ taskId: 'T-932' }, f79Exec)
assert.equal(f79Second.dispatched, 'continued', 'FIX-79 ②：之后调用 = 向**同一会话续派**（不新建实例）')
assert.equal(f79Second.childId, 'child-continuable-1', 'FIX-79 ②：续派到的是同一个 childId')
assert.equal(f79Sent.length, 1, 'FIX-79：续派走的是宿主的 `subagents.sendMessage`')
assert.ok(f79Sent[0].text.includes('T-932'), 'FIX-79：续派的消息里带着**这次的任务号与契约**')
// ③ 忙时排队可见（不静默丢弃）
await f79Store.putMember(memberRecord({ id: 'child-continuable-1', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理' }))
const f79Third = await f79Tool.execute({ taskId: 'T-933' }, f79Exec)
assert.equal(f79Third.dispatched, 'continued', 'FIX-79 ③：忙的时候也**不丢弃**，照样续派（宿主会在步边界接收）')
assert.ok(String(f79Third.queueNote || '').includes('排队中'), 'FIX-79 ③：忙时要给"排队中：前面还有 N 条"的**可见**提示')
assert.ok(/前面还有 \d+ 条/.test(String(f79Third.queueNote)), 'FIX-79 ③：排队要报具体条数')
assert.ok(f79Tool.output.render({}, f79Third)[0].text.includes('排队中'), 'FIX-79 ③：回执里也要看得见（不许静默）')
// ② 记账：常驻成员**只有一条**记录、无任务号；任务记录按任务号各记一份（FIX-79 ④）
const f79Members = f79Store.listMembers().filter((member) => String(member.name).includes('librarian'))
assert.equal(f79Members.length, 1, 'FIX-79 ①：三个任务的馆员活**只创建 1 个常驻成员**')
assert.equal(f79Members[0].name, 'librarian', 'FIX-79 ②：常驻成员名固定为角色名（**不带任务号**）')
assert.equal(f79Members[0].mode, 'continuable', 'FIX-79 ②：模式是 continuable')
assert.equal(parseMemberName(f79Members[0].name), null, 'FIX-79 ②：名字里没有任务号 ⇒ 成员层面的任务归属为空')
for (const taskId of ['T-931', 'T-932', 'T-933']) {
  assert.ok(f79Store.getTask(taskId), `FIX-79 ③：任务 ${taskId} 仍各自记账（归属由 taskId 承载）`)
}
// ④ 常驻模型下不误报：unreleased_run / orphan_task / occupancy_conflict
const f79AuditCfg = plugin.Config({ ...auditCfgInput, audit: { checks: ['unreleased_run', 'orphan_task', 'ghost_run'] } })
const f79Audit = await auditScan({ store: f79Store, project: resolveProject(cfg), config: f79AuditCfg })
const f79Misfire = f79Audit.items.filter((item) => item.target === 'librarian')
assert.equal(f79Misfire.length, 0, `FIX-79 ④：常驻单例**不误报**（实际 ${JSON.stringify(f79Misfire.map((i) => i.check))}）`)
// ⑤ 面板：常驻节点在快照里是长期节点（mode 一路传下去，FIX-73 的投影）
const f79Snap = buildPanelSnapshot({ store: f79Store, project: resolveProject(cfg), audit: null })
assert.equal(f79Snap.members.librarian.mode, 'continuable', 'FIX-79 ⑤：快照里常驻成员带 mode=continuable（面板显示"后台（可续派/可唤醒）"）')
assert.equal(f79Snap.members.librarian.sessionId, 'child-continuable-1', 'FIX-79 ⑤：常驻节点有稳定的 sessionId（长期节点）')
// 角色模型：只有馆员是单例，其它角色保持"按任务实例"
assert.equal(getRole({}, 'librarian').singleton, true, 'FIX-79 ①：馆员 = 常驻单例')
for (const roleId of ['researcher', 'implementer', 'reviewer', 'adversary']) {
  assert.equal(getRole({}, roleId).singleton === true, false, `FIX-79 ①：${roleId} 仍是"按任务实例"（不误改）`)
  assert.equal(memberName('T-1', roleId), `T-1-${roleId}`, `FIX-79 ①：${roleId} 的成员名仍带任务号`)
}
assert.equal(memberName('T-1', 'librarian', { singleton: true }), 'librarian', 'FIX-79 ①：单例成员名不带任务号')
assert.equal(memberName('T-1', 'researcher'), 'T-1-researcher', 'FIX-79：非单例保持原形状（回归）')
ok('FIX-79 常驻单例馆员：首次创建 / 之后**续派同一会话**（走 sendMessage）· 忙时排队可见且不丢弃 · 只有一条无任务号的成员记录、任务仍各自记账 · 常驻模型下不误报 · 快照是长期节点 · 其它角色仍是按任务实例')

// ---------------------------------------------------------------- FIX-80 写文件不得改动行尾（真机：内容回基线了，行尾被整篇 LF→CRLF，397 处假差异）
assert.equal(splitLinesWithEol('a\nb\r\nc').map((row) => row.eol).join('|'), '\n|\r\n|', 'FIX-80：逐行拆出各自的终止符')
assert.equal(eolStyleOf('a\nb\n'), 'lf', 'FIX-80：全 LF 判得出')
assert.equal(eolStyleOf('a\r\nb\r\n'), 'crlf', 'FIX-80：全 CRLF 判得出')
assert.ok(String(eolStyleOf('a\nb\r\nc\n')).startsWith('mixed'), 'FIX-80：混用判得出（不归一化）')
assert.equal(alignEol('x\ny\n', 'a\nb\r\nc\n'), 'x\ny\n', 'FIX-80 ①：原文全 LF ⇒ 写出去仍全 LF（**不许**变成 CRLF）')
assert.equal(alignEol('x\ny\n', 'a\r\nb\r\n'), 'x\r\ny\r\n', 'FIX-80 ①：原文全 CRLF ⇒ 写出去仍全 CRLF')
assert.equal(alignEol('a\nb2\nc', 'a\r\nb\r\nc\r\n'), 'a\r\nb2\r\nc\r\n', 'FIX-80 ②：混用/改过的行也**不与原文相反**（未改的行用它原来的行尾）')
assert.equal(alignEol('new\nfile\n', null), 'new\nfile\n', 'FIX-80 ②：新建档默认 LF')
assert.equal(alignEol('new\nfile\n', null, '\r\n'), 'new\r\nfile\r\n', 'FIX-80 ②：仓库另有约定时按配置的行尾')
// 收口点在 writeWithBackup（所有"读改写"都走它）
function f80Project(root, newFileEol) { return { root, newFileEol } }
const f80Root = await mkdtemp(join(tmpdir(), 'ac-fix80-'))
const f80Lf = joinUnderRoot(f80Root, 'lf.md')
const f80Crlf = joinUnderRoot(f80Root, 'crlf.md')
await writeFile(f80Lf, '---\ntitle: 甲\n---\n\n正文 LF。\n', 'utf8')
await writeFile(f80Crlf, '---\r\ntitle: 乙\r\n---\r\n\r\n正文 CRLF。\r\n', 'utf8')
const f80w1 = await writeWithBackup({ project: f80Project(f80Root, 'lf'), path: f80Lf, text: '---\ntitle: 甲\n---\n\n正文 LF 改过了。\n', stampIso: new Date().toISOString() })
assert.equal(f80w1.ok, true, 'FIX-80：覆盖既有档照常成功（备份闸门不变）')
assert.equal(eolStyleOf(await readFile(f80Lf, 'utf8')), 'lf', 'FIX-80 ①（核心）：LF 档读改写往返后**仍是 LF**（真机就是在这里被整篇改成 CRLF）')
const f80w2 = await writeWithBackup({ project: f80Project(f80Root, 'lf'), path: f80Crlf, text: '---\ntitle: 乙\n---\n\n正文 CRLF 改过了。\n', stampIso: new Date().toISOString() })
assert.equal(f80w2.ok, true)
assert.equal(eolStyleOf(await readFile(f80Crlf, 'utf8')), 'crlf', 'FIX-80：CRLF 档也不会被改成 LF（两边都不归一化）')
const f80New = joinUnderRoot(f80Root, '新建.md')
await writeWithBackup({ project: f80Project(f80Root, 'lf'), path: f80New, text: '---\ntitle: 丙\n---\n\n新档。\n', stampIso: new Date().toISOString() })
assert.equal(eolStyleOf(await readFile(f80New, 'utf8')), 'lf', 'FIX-80 ②：新建档用 LF（与仓库既有 .md 现状一致）')
const f80NewCrlf = joinUnderRoot(f80Root, '新建crlf.md')
await writeWithBackup({ project: f80Project(f80Root, 'crlf'), path: f80NewCrlf, text: '甲\n乙\n', stampIso: new Date().toISOString() })
assert.equal(eolStyleOf(await readFile(f80NewCrlf, 'utf8')), 'crlf', 'FIX-80 ②：配置成 crlf ⇒ 新建档用 CRLF')
// ③ 验收报告能识别"仅行尾变化"
const f80Before = new Map([['/x/a.md', { fingerprint: 'aaaa', eol: 'lf' }]])
const f80After = new Map([['/x/a.md', { fingerprint: 'aaaa', eol: 'crlf' }]])
const f80Diff = diffBodies(f80Before, f80After)
assert.equal(f80Diff.changed.length, 0, 'FIX-80 ③：内容指纹一致 ⇒ 不算"内容改了"')
assert.equal(f80Diff.rows[0].eolChanged, true, 'FIX-80 ③：但要标出**行尾被改写**（会污染 git 基线对账）')
assert.ok(renderVerification({ dryRun: false, actions: [], bodyUnchanged: f80Diff }).join('\n').includes('行尾被改写'), 'FIX-80 ③：报告里要单独列这一条')
ok('FIX-80 行尾保持：读改写既有档**跟着原文行尾走**（LF 仍 LF / CRLF 仍 CRLF / 混用逐行保持）· 新建档 LF（可配 newFileEol）· 验收报告能单列"仅行尾变化"（真机 397 处假差异的根因）')

// ---------------------------------------------------------------- FIX-81 非三档类别的回执措辞（不许写"0 级"）
const f81Ctx = makeCtx()
plugin.apply(f81Ctx.ctx, fxCfg)
const f81Emit = f81Ctx.mine.find((tool) => tool.name === 'doc_emit')
const f81Exec = { agent: { id: 'root-session', session: { header: { delegationDepth: 1, cwd: fxRoot } } }, signal: new AbortController().signal }
const f81Pit = await f81Emit.execute({ kind: '坑', taskId: 'T-995', title: '收口坑', role: 'researcher', body: '## 结论\n\n坑。\n' }, f81Exec)
const f81PitText = f81Emit.output.render({}, f81Pit)[0].text
assert.equal(f81PitText.includes('0 级'), false, 'FIX-81 ①：非三档类别**不得**出现"0 级"（读起来像掉级/缺陷）')
assert.ok(f81PitText.includes('坑档'), 'FIX-81 ①：按**类别**措辞（坑档）')
assert.equal(f81Pit.kind, '坑', 'FIX-81：回执数据里也带类别')
const f81Res = await f81Emit.execute({ kind: '研究', taskId: 'T-995', title: '收口研究', role: 'researcher', body: '## 结论\n\n研究。\n' }, f81Exec)
assert.ok(f81Emit.output.render({}, f81Res)[0].text.includes('研究档'), 'FIX-81 ①：研究类别写"研究档"')
const f81Tier = await f81Emit.execute({ level: 3, taskId: 'T-995', title: '收口三档', role: 'implementer', body: '## 结论\n\n三档。\n' }, f81Exec)
const f81TierText = f81Emit.output.render({}, f81Tier)[0].text
assert.ok(f81TierText.includes('L3 级文档'), 'FIX-81 ①：三档产出仍写"L3 级文档"')
assert.equal(f81TierText.includes('产出档档'), false, 'FIX-81：三档不写"产出档档"（措辞与 FIX-69 的类别名同一套）')
ok('FIX-81 回执措辞：三档产出写「L<n> 级文档」· 其它类别写「<类别>档」（坑档 / 研究档…）· **不出现"0 级"**（内部 tier:0 语义保留但不泄漏到人看的文案）')

// ---------------------------------------------------------------- FIX-82 project.json 的布局定义会过期（真机 Blockdustry 就是过期样本）
const f82Root = await mkdtemp(join(tmpdir(), 'ac-fix82-'))
for (const rel of ['任务', 'docs/研究', 'docs/坑', 'docs/修改', 'docs/核心数据库', 'docs/子agent', 'docs/archive']) {
  await mkdir(joinUnderRoot(f82Root, rel), { recursive: true })
}
await writeFile(joinUnderRoot(f82Root, '待办.md'), '# 待办\n', 'utf8')
// 造一份**旧布局**的 project.json（六类、无 tempDir、deliverablesDir 指向 子agent、无 layoutVersion）喵
const f82OldPaths = {
  tasksDir: joinUnderRoot(f82Root, '任务'),
  progressDir: joinUnderRoot(f82Root, '[Agent进度]'),
  deliverablesDir: joinUnderRoot(f82Root, 'docs/子agent'),
  docsDirs: ['研究', '坑', '修改', '核心数据库', '子agent', 'archive'].map((name) => joinUnderRoot(f82Root, `docs/${name}`)),
  archiveDir: joinUnderRoot(f82Root, 'docs/archive'),
  docKinds: {
    研究: joinUnderRoot(f82Root, 'docs/研究'),
    坑: joinUnderRoot(f82Root, 'docs/坑'),
    修改: joinUnderRoot(f82Root, 'docs/修改'),
    核心数据库: joinUnderRoot(f82Root, 'docs/核心数据库'),
    产出档: joinUnderRoot(f82Root, 'docs/子agent'),
    归档: joinUnderRoot(f82Root, 'docs/archive'),
  },
  todoFile: joinUnderRoot(f82Root, '待办.md'),
}
await mkdir(joinUnderRoot(f82Root, '.agent-contract'), { recursive: true })
await writeFile(joinUnderRoot(f82Root, PROJECT_META_REL), JSON.stringify({
  version: PROJECT_META_VERSION, root: f82Root, name: '旧布局项目', key: 'oldlayout', paths: f82OldPaths, generatedAt: '2026-10-03T16:53:00.000Z',
}, null, 2), 'utf8')
const f82Cfg = plugin.Config({ project: { root: '' }, paths: {} })
const f82Project = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: false })
assert.equal(Object.keys(f82Project.paths.docKinds).length, 8, 'FIX-82 ①：过期布局加载后**自动重探**成当前的八类')
for (const kind of ['审查', '整合清单']) {
  assert.ok(f82Project.paths.docKinds[kind], `FIX-82 ①：重探后补上「${kind}」类`)
}
assert.equal(f82Project.paths.tempDir, joinUnderRoot(f82Root, 'docs/_临时'), 'FIX-82 ①：重探后补上 tempDir')
assert.equal(f82Project.paths.deliverablesDir, joinUnderRoot(f82Root, 'docs/子agent'), 'FIX-82：产出根**仍指向 子agent**（磁盘事实，产出/ 还没迁移；迁移后会自动跟上）')
assert.ok(f82Project.notes.some((note) => note.includes('布局已**自动重探**')), 'FIX-82 ④：说明要带出去（用户与 agent 都看得到）')
assert.equal(f82Project.name, '旧布局项目', 'FIX-82 ②：重探**保留** name')
assert.equal(f82Project.key, 'oldlayout', 'FIX-82 ②：重探**保留** key（记录表分域不变）')
assert.equal(f82Project.root, f82Root, 'FIX-82 ②：重探保留 root')
// 重探**只读**：一个目录都不新建（建目录仍由 project_init 显式落地）
assert.equal(existsSync(joinUnderRoot(f82Root, 'docs/审查')), false, 'FIX-82 ③：重探本身**只读**（不替用户建目录）')
// ② 重探不覆盖用户显式配置
const f82Explicit = plugin.Config({ project: { root: f82Root }, paths: { deliverablesDir: 'docs/子agent', docKinds: { 研究: 'docs/研究', 坑: 'docs/坑', 修改: 'docs/修改', 核心数据库: 'docs/核心数据库', 产出档: 'docs/子agent', 归档: 'docs/archive' } } })
const f82ExplicitOut = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f82Explicit, agent: agentAt(f82Root), ensure: false })
assert.equal(f82ExplicitOut.explicitPaths, true, 'FIX-82 ②：显式配置走显式分支（**不**读缓存、不重探）')
assert.equal(Object.keys(f82ExplicitOut.paths.docKinds).length, 6, 'FIX-82 ②：显式配置的类别表**不被重探覆盖**（显式优先）')
// ③ 重探失败 ⇒ 旧值保留 + 警告
// FIX-92 起上面那条 `ensure:false` 的解析**也会写回**最新布局 ⇒ 这里得先把"过期元数据"放回去，
// 否则本用例的前提（staleLayout 为真）就不成立了（不是放宽，是把前提重新造出来）喵
await writeFile(joinUnderRoot(f82Root, PROJECT_META_REL), JSON.stringify({
  version: PROJECT_META_VERSION, root: f82Root, name: '旧布局项目', key: 'oldlayout', paths: f82OldPaths, generatedAt: '2026-10-03T16:53:00.000Z',
}, null, 2), 'utf8')
const f82Broken = await resolveAdaptiveProject({
  ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: false,
  exists: () => { throw new Error('模拟：探测不可用') },
})
assert.deepEqual(toHost(Object.keys(f82Broken.paths.docKinds)), ['研究', '坑', '修改', '核心数据库', '产出档', '归档'], 'FIX-82 ③：重探失败 ⇒ **沿用旧值**（不让一次失败把项目打回不可用）')
assert.ok(f82Broken.notes.some((note) => note.includes('重探失败')), 'FIX-82 ③：失败要给警告')
// 写入的元数据带上 layoutVersion（下次加载就知道新不新）
const f82Written = await writeProjectMeta(f82Root, { root: f82Root, name: 'x', key: 'x', paths: f82OldPaths })
assert.equal(f82Written.ok, true)
const f82Meta = JSON.parse(await readFile(joinUnderRoot(f82Root, PROJECT_META_REL), 'utf8'))
assert.equal(f82Meta.layoutVersion, PROJECT_LAYOUT_VERSION, 'FIX-82 ①：元数据里记录生成它的**布局定义版本**')
ok('FIX-82 project.json 布局版本：写入带 layoutVersion · 加载时不一致 ⇒ **自动重探**（保留 root/name/key，补成八类 + tempDir）· 重探只读、不覆盖显式配置 · 重探失败沿用旧值 + 警告 · 说明带进 contract_status 与快照')

// ---------------------------------------------------------------- FIX-83 重探结果必须**写回** project.json（真机：内存八类、磁盘还是旧六类）
const f83MetaPath = joinUnderRoot(f82Root, PROJECT_META_REL)
await writeFile(f83MetaPath, JSON.stringify({
  version: PROJECT_META_VERSION, root: f82Root, name: '旧布局项目', key: 'oldlayout', paths: f82OldPaths, generatedAt: '2026-10-03T08:53:40.708Z',
}, null, 2), 'utf8')
const f83Out = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: true })
const f83Saved = JSON.parse(await readFile(f83MetaPath, 'utf8'))
assert.equal(f83Saved.layoutVersion, PROJECT_LAYOUT_VERSION, 'FIX-83 ①：重探后**磁盘文件**里要有 layoutVersion')
assert.equal(Object.keys(f83Saved.paths.docKinds).length, 8, 'FIX-83 ①：磁盘文件里的 docKinds 已更新成八类')
assert.ok(f83Saved.paths.tempDir, 'FIX-83 ①：磁盘文件里补上 tempDir')
assert.equal(f83Saved.name, '旧布局项目', 'FIX-83 ①：写回**保留** name')
assert.equal(f83Saved.generatedAt === '2026-10-03T08:53:40.708Z', false, 'FIX-83 ①：generatedAt 已刷新')
assert.ok(f83Out.notes.some((note) => note.includes('已写回')), 'FIX-83：回执说明"已写回"')
assert.equal(existsSync(`${f83MetaPath}.tmp`), false, 'FIX-83 ③：原子写不留临时文件')
// ② 写失败 ⇒ 有警告、内存视图仍正确、下次继续重探
await writeFile(f83MetaPath, JSON.stringify({ version: PROJECT_META_VERSION, root: f82Root, name: '旧布局项目', key: 'oldlayout', paths: f82OldPaths }, null, 2), 'utf8')
const f83Fail = await resolveAdaptiveProject({
  ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: true,
  writeMeta: async () => ({ ok: false, error: '模拟：磁盘只读' }),
})
assert.equal(Object.keys(f83Fail.paths.docKinds).length, 8, 'FIX-83 ②：写回失败**不影响内存视图**（仍是八类）')
assert.ok(f83Fail.notes.some((note) => note.includes('写回失败')), 'FIX-83 ②：写回失败**不静默**（进 notes 警告）')
ok('FIX-83 重探写回：重探成功后把 layoutVersion/八类/tempDir 写回磁盘（保留 root/name/key，generatedAt 刷新）· 原子写不留 .tmp · 写失败不静默且内存视图仍正确')

// ---------------------------------------------------------------- FIX-84 审计不认"已归档会话"（用户归档的测试对话仍被扫出来）
const f84Root = await mkdtemp(join(tmpdir(), 'ac-fix84-'))
const f84Cfg = plugin.Config({ ...auditCfgInput, project: { root: f84Root }, audit: { checks: ['ghost_run', 'unreleased_run', 'missing_doc', 'orphan_task'] } })
const f84Store = await createLedger(makeCtx().ctx, 'fix84').ready
await f84Store.putMember(memberRecord({ id: 'sess-archived-1', name: 'EXP-测试-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
await f84Store.putMember(memberRecord({ id: 'sess-live-1', name: 'T-940-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
const f84Ctx = { agent: null }
const f84AuditAll = await auditScan({ store: f84Store, project: resolveProject(f84Cfg), config: f84Cfg, archivedSessionIds: new Set(['sess-archived-1']) })
assert.equal(f84AuditAll.items.some((item) => String(item.target).includes('EXP-测试')), false, 'FIX-84 ②：**已归档会话**的成员一律不报（归档 = 这些不用管了）')
assert.ok(f84AuditAll.items.some((item) => String(item.target).includes('T-940')), 'FIX-84 ②：未归档的照旧报（别误伤）')
assert.equal(f84AuditAll.archived.count, 1, 'FIX-84 ③：已归档会话单独计数')
assert.ok(f84AuditAll.humanReport.includes('已归档会话（不计红黄）'), 'FIX-84 ③：报告里单列一段')
assert.equal(f84AuditAll.counts.byCheck.ghost_run, 1, 'FIX-84：红黄里只剩**未归档**那一条（归档的那条不计）')
// ③ 拿不到归档信息 ⇒ 行为与今天一致（降级不报错）
const f84Degrade = await auditScan({ store: f84Store, project: resolveProject(f84Cfg), config: f84Cfg, archivedSessionIds: null })
assert.ok(f84Degrade.items.some((item) => String(item.target).includes('EXP-测试')), 'FIX-84 ③：拿不到归档信息 ⇒ 照旧报（静默降级，不报错）')
assert.equal(f84Degrade.archived.count, 0, 'FIX-84 ③：降级时归档段为空')
assert.equal(archivedSessionIdsOf({ get: () => undefined }), null, 'FIX-84：宿主没挂 workspaceRegistry ⇒ 返回 null（降级）')
assert.deepEqual(toHost([...archivedSessionIdsOf({ get: () => ({ archivedSessionIds: ['a', 'b'] }) })]), ['a', 'b'], 'FIX-84：读得到归档集就带上')
// ④ 面板：快照给归档成员打标
const f84SnapProject = { ...resolveProject(f84Cfg), archivedSessionIds: ['sess-archived-1'] }
const f84Snap = buildPanelSnapshot({ store: f84Store, project: f84SnapProject, audit: null })
assert.equal(f84Snap.members['EXP-测试-researcher'].archived, true, 'FIX-84 ④：快照给已归档成员打标')
assert.equal(f84Snap.members['T-940-researcher'].archived, false, 'FIX-84 ④：未归档的不打标')
assert.ok(clientSource.includes("node.archived ? '已归档'"), 'FIX-84 ④：面板状态列显示「已归档」')
ok('FIX-84 已归档会话：ghost_run/unreleased_run/missing_doc/orphan_task 对归档会话一律不报 · 报告单列「已归档会话（不计红黄）」并计数 · 拿不到 registry 时静默降级 · 面板给成员打「已归档」标')

// ---------------------------------------------------------------- FIX-90 归档判定：sessionId 归一化 + 按父链上溯（真机 0.17.0 仍 119 条）
assert.deepEqual(toHost(sessionIdVariants("session-abc")), ["abc", "session-abc"], "FIX-90 ①：两种形态都生成（大小写无关）")
assert.deepEqual(toHost(sessionIdVariants("ABC")), ["abc", "session-abc"], "FIX-90 ①：裸 id 也归一化成两种形态")
const f90Archived = normalizeArchivedSet(["session-618734d6-1111"])
assert.equal(f90Archived.has("618734d6-1111"), true, "FIX-90 ①：宿主给 session-<uuid> ⇒ 裸 uuid 也命中（**真机就是形态不一致**）")
assert.equal(isArchivedSession(f90Archived, "session-618734d6-1111"), true, "FIX-90 ①：原形态当然也命中")
assert.equal(isArchivedSession(f90Archived, "别的-id"), false, "FIX-90：不相干的不命中（别误伤）")
const f90Member = memberRecord({ id: "b9ac943f-2222", name: "T53_docs-librarian", role: "librarian", mode: "continuable", status: "completed", parentSessionId: "session-618734d6-1111" })
assert.equal(archivedViaChain({ member: f90Member, members: [f90Member], archived: f90Archived }).archived, true, "FIX-90 ②：**父会话**归档 ⇒ 子成员算已归档")
assert.equal(archivedViaChain({ member: f90Member, members: [f90Member], archived: f90Archived }).via, "session-618734d6-1111", "FIX-90 ④：记下命中的**父会话**（报告按它归并）")
assert.equal(archivedViaChain({ member: { id: "b9ac943f-2222", name: "x", parentSessionId: null }, members: [], archived: f90Archived }).archived, false, "FIX-90 ③：父链拿不到 ⇒ 行为同现状（不报错、也不误判已归档）")
// 端到端：审计里那条 ghost_run 因为**父会话**被归档而消失
const f90Store = await createLedger(makeCtx().ctx, "fix90").ready
await f90Store.putMember(memberRecord({ id: "b9ac943f-2222", name: "T53_docs规范化整理-librarian", role: "librarian", mode: "one-shot", status: "completed", parentSessionId: "session-618734d6-1111" }))
await f90Store.putMember(memberRecord({ id: "deadbeef-3333", name: "T-999-researcher", role: "researcher", mode: "one-shot", status: "completed" }))
const f90Cfg = plugin.Config({ project: { root: f84Root }, audit: { checks: ["ghost_run", "missing_doc", "unreleased_run", "orphan_task"] } })
const f90Audit = await auditScan({ store: f90Store, project: resolveProject(f90Cfg), config: f90Cfg, archivedSessionIds: new Set(["session-618734d6-1111"]) })
assert.equal(f90Audit.items.some((item) => String(item.target).includes("T53_docs")), false, "FIX-90 ②：父会话被归档 ⇒ 子成员的红黄全消失")
assert.ok(f90Audit.items.some((item) => String(item.target).includes("T-999")), "FIX-90：没归档的照旧报")
assert.equal(f90Audit.archived.count, 1, "FIX-90 ④：进「已归档」段的成员数")
assert.ok(Object.keys(f90Audit.archived.byParent).some((key) => key.includes("618734d6")), "FIX-90 ④：按**父会话**归并（用户对号入座）")
assert.ok(f90Audit.humanReport.includes("归并到"), "FIX-90 ④：报告里按父会话列出")
// ③ 父链拿不到（没记 parentSessionId）⇒ 与现状一致
const f90NoChain = await auditScan({ store: f90Store, project: resolveProject(f90Cfg), config: f90Cfg, archivedSessionIds: new Set(["b9ac943f-2222"]) })
assert.equal(f90NoChain.items.some((item) => String(item.target).includes("T53_docs")), false, "FIX-90 ①：成员自身会话被归档（裸 uuid 形态）也要命中")
// 面板：同一套判定（快照也按父链打标）
const f90Snap = buildPanelSnapshot({ store: f90Store, project: { ...resolveProject(f90Cfg), archivedSessionIds: ["session-618734d6-1111"] }, audit: null })
assert.equal(f90Snap.members["T53_docs规范化整理-librarian"].archived, true, "FIX-90 ④：面板按父链给成员打「已归档」标")
assert.equal(f90Snap.members["T-999-researcher"].archived, false, "FIX-90：没归档的不打标")
// 存量记录（没记 parentSessionId）也要能靠**宿主父链 API**上溯喵
const f90Live = memberRecord({ id: "b9ac943f-2222", name: "T53_docs-librarian", role: "librarian", mode: "one-shot", status: "completed" })
assert.equal(
  archivedViaChain({ member: f90Live, members: [f90Live], archived: f90Archived, parentOf: () => "session-618734d6-1111" }).archived,
  true,
  "FIX-90 要求 2：**优先用宿主的会话父子 API**（存量记录没记 parentSessionId 也能上溯）",
)
assert.equal(
  archivedViaChain({ member: f90Live, members: [f90Live], archived: f90Archived, parentOf: () => null }).archived,
  false,
  "FIX-90 ③：父链 API 也拿不到 ⇒ 回到现状（不误判）",
)
const f90ChannelSrc = await readFile(new URL('./src/delegation/channels.js', import.meta.url), 'utf8')
// 形状更新（FIX-99，不是放宽）：会话 id 先算进 `selfSessionId`（复用判据与记账共用同一个值），
// 断言跟着改成"先算一次 + 两条派单路径都写它"喵
assert.ok(/const selfSessionId = parentSessionIdOf\(parent\)/.test(f90ChannelSrc), 'FIX-90 要求 2：派单记账要写下**派单者的会话 id**（否则没得回溯）')
assert.ok(
  (f90ChannelSrc.match(/parentSessionId: selfSessionId/g) || []).length >= 2,
  'FIX-90 要求 2 + FIX-99：后台常驻与前台一次性**两条派单路径**都要写这个 id（复用判据也用它）',
)
ok("FIX-90 归档判定修正：sessionId 归一化（session-<uuid> ↔ 裸 uuid 双向命中）· 按 parentSessionId **父链上溯**（归档父会话 ⇒ 子成员不报）· 父链拿不到退回现状且不报错 · 报告按父会话归并 · 面板同样按父链打标")

// ---------------------------------------------------------------- FIX-90 补漏（真机："审计区还会引用源自归档的对话"）
// 根因：父链原来只问**活会话**（`sessions.get()`）—— 而归档对话里的子代理会话早就不是活的了 ⇒ 父链一断，
// 存量成员就被当成"没归档"照旧报出来；而且只按**成员名**过滤，任务号/文档路径那两类 target 照样漏 ✗
const f101Ctx = makeCtx()
f101Ctx.ctx.get = (name) => {
  if (name === 'workspaceRegistry') return { archivedSessionIds: ['session-OLD'] }
  if (name === 'sessions') return { get: () => undefined, list: () => [] }  // **活会话里什么都没有**（归档对话就是这样）
  if (name === 'sessionPersistence') {
    return {
      list: async () => [
        { header: { id: 'child-old', parentSession: 'session-OLD' } },   // 已结束的子会话：只有持久化里查得到
        { header: { id: 'child-live', parentSession: 'session-NEW' } },
      ],
    }
  }
  return undefined
}
const f101Index = await sessionParentIndexOf(f101Ctx.ctx)
assert.equal(f101Index.size, 2, 'FIX-101 ①：父链索引从**会话持久化**建（含已结束的会话）')
assert.equal(f101Index.parentOf('child-old'), 'session-OLD', 'FIX-101 ①：已结束的子会话也能溯到父会话（活会话那条路查不到）')
assert.equal(parentSessionOf(f101Ctx.ctx)('child-old'), null, 'sanity：只问活会话的话确实查不到（这正是原来的病根）')
const f101Empty = await sessionParentIndexOf(makeCtx().ctx)
assert.equal(f101Empty.size, 0, 'FIX-101 ①：两条路都拿不到 ⇒ 空索引（降级，不抛错）')
assert.equal(f101Empty.parentOf('x'), null, 'FIX-101 ①：空索引下父链返回 null（退回旧行为）')
// ①-b 存量成员（没记 parentSessionId）也能判成"归档"⇒ 审计不报它
const f101Store = await createLedger(makeCtx().ctx, 'fix101').ready
await f101Store.putMember(memberRecord({ id: 'child-old', name: 'T-200-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
await f101Store.putMember(memberRecord({ id: 'child-live', name: 'T-201-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
const f101Cfg = plugin.Config({ project: { root: f84Root }, audit: { checks: ['ghost_run', 'missing_doc', 'unreleased_run'] } })
const f101Audit = await auditScan({
  store: f101Store, project: resolveProject(f101Cfg), config: f101Cfg,
  archivedSessionIds: ['session-OLD'], parentOf: f101Index.parentOf,
})
assert.equal(f101Audit.items.some((item) => String(item.target).includes('T-200')), false, 'FIX-101 ①：存量成员（父会话已归档、活会话查不到）⇒ **不再报**')
assert.equal(f101Audit.archived.count, 1, 'FIX-101 ①：它进「已归档会话」那一段')
assert.equal(f101Audit.archived.members[0], 'T-200-researcher', 'FIX-101 ①：归并到归档父会话（session-OLD）')
assert.equal(f101Audit.archived.byParent['session-OLD'][0], 'T-200-researcher', 'FIX-101 ①：按父会话归并')
// ② 任务号 / 文档路径那两类 target 也要跟着滤掉（只滤成员名是不够的）
await f101Store.putTask(taskRecord({ taskId: 'T-200', status: 'open', owner: 'T-200-researcher' }))
await f101Store.putDoc(docRecord({ path: joinUnderRoot(f84Root, 'docs/T-200_x_L3.md'), tier: 3, taskId: 'T-200', title: 'x', owner: 'T-200-researcher' }))
const f101Cfg2 = plugin.Config({ project: { root: f84Root }, audit: { checks: ['task_file_missing', 'doc_file_missing'] } })
const f101Filtered = await auditScan({
  store: f101Store, project: resolveProject(f101Cfg2), config: f101Cfg2,
  archivedSessionIds: ['session-OLD'], parentOf: f101Index.parentOf,
})
assert.equal(f101Filtered.items.some((item) => item.check === 'task_file_missing'), false, 'FIX-101 ②：源自归档对话的**未结任务缺文件**⇒ 不报（顺着 owner 回溯到成员）')
assert.equal(f101Filtered.items.some((item) => item.check === 'doc_file_missing'), false, 'FIX-101 ②：源自归档对话的**文档记录缺文件**⇒ 不报')
assert.ok(f101Filtered.archivedFiltered.length >= 1, 'FIX-101 ③：滤掉了什么**要留痕**（`archivedFiltered`）')
assert.ok(f101Filtered.humanReport.includes('源自已归档对话'), 'FIX-101 ③：人话报告里明说"另有 N 条已过滤"（不许凭空消失）')
// ③ 面板待办（B 区）也滤掉归档对话的任务
const f101Snap = buildPanelSnapshot({
  store: f101Store, project: resolveProject(f101Cfg2), audit: null,
  archivedOwners: archivedOwners({ store: f101Store, archivedSessionIds: ['session-OLD'], parentOf: f101Index.parentOf }).names,
})
assert.equal(f101Snap.todos.some((row) => row.kind === 'task' && String(row.title).includes('T-200')), false, 'FIX-101 ③：面板 B 区不再列归档对话的未结任务')
// ④ 同源：审计工具/面板刷新/启动自愈那条共享实现里都要用这个索引（不许有人还在用活会话那份）
const f101RefreshSrc = await readFile(new URL('./src/panel/refresh.js', import.meta.url), 'utf8')
assert.ok(/sessionParentIndexOf\(ctx\)/.test(f101RefreshSrc), 'FIX-101 ④：共享实现（refreshPanel）用**会话持久化**建父链')
assert.equal(/parentOf: parentSessionOf\(ctx\)/.test(f101RefreshSrc), false, 'FIX-101 ④：不再用"只看活会话"的那份（否则归档对话又漏回来）')
ok('FIX-101 归档漏判补修：父链索引改从**会话持久化**建（含已结束的会话 ⇒ 存量成员也溯得到归档父会话）· 两条路都拿不到时降级为空索引不抛错 · 源自归档对话的**任务号 / 文档路径**类条目顺着 owner 一并滤掉（不只滤成员名）· 过滤留痕（`archivedFiltered` + 报告里"另有 N 条已过滤"）· 面板待办同样滤掉 · 审计/面板/自愈三处共用同一份索引')

// ---------------------------------------------------------------- FIX-85/86 产出形态（角色元数据单一来源）+ 面板按形态适配
assert.deepEqual(toHost(deliverableKindsOf('librarian')), ['bookkeeping'], 'FIX-85：馆员的产出形态 = 簿记（**无文档要求**）')
assert.deepEqual(toHost(deliverableKindsOf('implementer')), ['three-tier'], 'FIX-85：实现者要三档')
assert.deepEqual(toHost(deliverableKindsOf('researcher')), ['research', 'three-tier'], 'FIX-85：研究员交研究档或三档')
assert.ok(capabilitiesOf('researcher').includes('recon'), 'FIX-89：研究员带 recon 能力（侦察外包给它）')
assert.ok(capabilitiesOf('librarian').includes('bookkeeping'), 'FIX-89：馆员带簿记能力')
// ① librarian completed 但无三档 ⇒ 不报；② implementer 无产出 ⇒ 仍报；③ researcher 只交研究档 ⇒ 不报
const f85Cfg = plugin.Config({ project: { root: f84Root }, audit: { checks: ['missing_doc', 'ghost_run', 'bookkeeping_untraced'] } })
const f85Store = await createLedger(makeCtx().ctx, 'fix85').ready
await f85Store.putMember(memberRecord({ id: 's-lib', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'completed', layer: 1, parent: '主代理' }))
await f85Store.putMember(memberRecord({ id: 's-impl', name: 'T-950-implementer', role: 'implementer', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
await f85Store.putMember(memberRecord({ id: 's-res', name: 'T-951-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
const f85Audit = await auditScan({ store: f85Store, project: resolveProject(f85Cfg), config: f85Cfg })
const f85Missing = f85Audit.items.filter((item) => item.check === 'missing_doc').map((item) => item.target)
assert.equal(f85Missing.includes('librarian'), false, 'FIX-85 ①：馆员（簿记）**不带三档要求** ⇒ missing_doc 不报它')
assert.ok(f85Missing.includes('T-950-implementer'), 'FIX-85 ②：实现者无任何产出 ⇒ **仍报**')
// ③ 的完整口径在下面：先造一份研究档，再看它是否不再报（此刻它还没交东西 ⇒ 该报，"有牙"）喵
assert.ok(f85Missing.includes('T-951-researcher'), 'FIX-85：研究员还没交任何东西时该报（证明这条检查还有牙）')
assert.equal(f85Audit.items.some((item) => item.check === 'ghost_run' && item.target === 'librarian'), false, 'FIX-85 ④：ghost_run 不得拿"没落档"判簿记角色')
// ③ 研究档存在即通过（按文件名后缀判）
await mkdir(joinUnderRoot(f84Root, 'docs/研究'), { recursive: true })
await writeFile(joinUnderRoot(f84Root, 'docs/研究/T-951_调研_研究.md'), '## 结论\n\n研究。\n', 'utf8')
const f85Audit2 = await auditScan({
  store: f85Store,
  project: { ...resolveProject(f85Cfg), docsDirs: [joinUnderRoot(f84Root, 'docs/研究')] },
  config: f85Cfg,
})
assert.equal(f85Audit2.items.some((item) => item.check === 'missing_doc' && item.target.includes('T-951')), false, 'FIX-85 ③：交过研究档 ⇒ 不报（任一合法形态即可）')
// ④ 馆员无留痕 ⇒ 报"簿记无留痕"
assert.ok(f85Audit.items.some((item) => item.check === 'bookkeeping_untraced' && item.target === 'librarian'), 'FIX-85 ④：簿记成员无留痕 ⇒ 报「簿记无留痕」')
// FIX-86：面板读同一份声明（单一来源）
const f86Snap = buildPanelSnapshot({ store: f85Store, project: resolveProject(f85Cfg), audit: null })
assert.deepEqual(toHost(f86Snap.members.librarian.deliverableKinds), ['bookkeeping'], 'FIX-86 ①：快照成员的产出形态来自**同一张表**（面板与审计不各判一套）')
assert.ok(clientSource.includes('if (entry.role) node.role = entry.role'), 'FIX-86 ①：client **记录优先**取角色（常驻单例的 label 没有任务号前缀）')
assert.ok(/needsThreeTier|tracksProgress/.test(clientSource), 'FIX-86 ②：client 按角色形态判"不适用(—)"')
assert.ok(clientSource.includes("make('三档', badges.docs, !needsThreeTier)"), 'FIX-86 ②：簿记/审查类角色的三档徽章 = —（不适用），不是 ✗')
ok('FIX-85/86 产出形态单一来源：馆员=簿记（missing_doc/ghost_run 都不拿"没落档"判它，改看留痕）· 实现者仍要三档 · 研究员交研究档即过 · 面板记录优先取角色并按形态显示"不适用(—)"')

// ---------------------------------------------------------------- FIX-87 librarian_archive 可预演 + 分片口径可控
const f87Root = await mkdtemp(join(tmpdir(), 'ac-fix87-'))
const f87Cfg = plugin.Config({ project: { root: f87Root }, paths: { deliverablesDir: 'docs/产出', archiveDir: 'docs/archive', docsDirs: ['docs/产出'] } })
const f87Project = resolveProject(f87Cfg)
await mkdir(joinUnderRoot(f87Root, 'docs/archive'), { recursive: true })
await mkdir(joinUnderRoot(f87Root, 'docs/产出'), { recursive: true })
const f87Doc = joinUnderRoot(f87Root, 'docs/产出/T-960_传送带上下坡_L3.md')
await writeFile(f87Doc,
  renderFrontMatter({ taskId: 'T-960', role: 'implementer', tier: 3, keywords: ['甲'], relatedFiles: [], createdAt: '2026-08-01T00:00:00.000Z' })
  + '## 结论\n\n本篇已于 2026-08-13 废弃，不再维护。\n', 'utf8')
const f87Ctx = makeCtx()
plugin.apply(f87Ctx.ctx, f87Cfg)
await f87Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f87Archive = f87Ctx.mine.find((tool) => tool.name === 'librarian_archive')
const f87Exec = { agent: { session: { header: { delegationDepth: 1 } } }, signal: new AbortController().signal }
const f87Dry = await f87Archive.execute({ paths: [f87Doc] }, f87Exec)
assert.equal(f87Dry.report.dryRun, true, 'FIX-87 ①：`librarian_archive` **默认 dryRun**（"不可预演"正是上次事故的根因）')
assert.equal(existsSync(f87Doc), true, 'FIX-87 ①：预演**不落盘**')
assert.ok(f87Dry.report.willArchive.some((row) => row.to.includes('2026-08')), 'FIX-87 ②：默认按**标废日**（2026-08-13）分片，不是运行时刻')
assert.ok(f87Archive.output.render({}, f87Dry)[0].text.includes('2026-08'), 'FIX-87 ①：预演里看得见将进哪个分片（分隔符不写死）')
const f87Real = await f87Archive.execute({ paths: [f87Doc], dryRun: false }, f87Exec)
assert.equal(f87Real.report.moved, 1, 'FIX-87：确认后真归档')
const f87New = joinUnderRoot(f87Root, 'docs/archive/2026-08/T-960_传送带上下坡_L3.md')
assert.ok(existsSync(f87New), 'FIX-87 ②：落到 archive/2026-08/')
const f87Text = await readFile(f87New, 'utf8')
assert.ok(/^archived: true$/m.test(f87Text), 'FIX-87 ①：写 `archived: true`')
assert.ok(f87Text.includes('archivedAt: 2026-08-13'), 'FIX-87 ①：`archivedAt` 取**标废日**（与内容一致）')
assert.ok(f87Text.includes('已于 2026-08-13 废弃'), 'FIX-87 ⑤：正文零改动')
assert.ok(/librarianTouchedAt: /.test(f87Text) && /librarianChanges: \[/.test(f87Text), 'FIX-87 ③：留痕齐备（执行时刻进留痕）')
assert.ok(String(f87Real.report.changelog.path || '').length > 0 || f87Real.report.changelog !== undefined, 'FIX-87 ②：changelog 追加（记事性=只加行）')
// monthOf: 'now' ⇒ 落当月
const f87Doc2 = joinUnderRoot(f87Root, 'docs/产出/T-961_另一篇_L3.md')
await writeFile(f87Doc2, renderFrontMatter({ taskId: 'T-961', role: 'implementer', tier: 3, keywords: ['乙'], relatedFiles: [], createdAt: new Date().toISOString() }) + '## 结论\n\n正文。\n', 'utf8')
const f87Now = await f87Archive.execute({ paths: [f87Doc2], dryRun: false, monthOf: 'now' }, f87Exec)
const f87NowShard = shardOf(Date.now())
assert.equal(f87Now.report.files[0].to.includes(f87NowShard), true, `FIX-87 ②：monthOf:'now' ⇒ 落当月（${f87NowShard}）`)
ok('FIX-87 归档可预演：`librarian_archive` 默认 dryRun（预演给出将进哪个分片）· 分片默认按**标废日**（2026-08）· monthOf:now 才按执行时刻 · archived:true + archivedAt=标废日 + 留痕 + changelog 追加 + 正文零改动')

// ---------------------------------------------------------------- FIX-88 tempDir 默认值与类别目录**同源**
const f88Root = await mkdtemp(join(tmpdir(), 'ac-fix88-'))
for (const rel of ['任务', '仓库/docs/研究', '仓库/docs/坑', '仓库/docs/修改', '仓库/docs/核心数据库']) {
  await mkdir(joinUnderRoot(f88Root, rel), { recursive: true })
}
await writeFile(joinUnderRoot(f88Root, '待办.md'), '# 待办\n', 'utf8')
const f88Project = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: plugin.Config({ project: { root: '' }, paths: {} }), agent: agentAt(f88Root), ensure: false })
assert.equal(f88Project.paths.tempDir, joinUnderRoot(f88Root, '仓库/docs/_临时'), 'FIX-88 ①：类别目录在 `<root>/仓库/docs/*` ⇒ 默认 tempDir 与它们**同树**（不再是 `<root>/docs/_临时`）')
const f88Root2 = await mkdtemp(join(tmpdir(), 'ac-fix88b-'))
for (const rel of ['任务', 'docs/研究', 'docs/坑']) await mkdir(joinUnderRoot(f88Root2, rel), { recursive: true })
await writeFile(joinUnderRoot(f88Root2, '待办.md'), '# 待办\n', 'utf8')
const f88Project2 = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: plugin.Config({ project: { root: '' }, paths: {} }), agent: agentAt(f88Root2), ensure: false })
assert.equal(f88Project2.paths.tempDir, joinUnderRoot(f88Root2, 'docs/_临时'), 'FIX-88 ②：类别目录直接在 `<root>/docs/*` ⇒ `<root>/docs/_临时`（现状）')
const f88Explicit = await resolveAdaptiveProject({
  ctx: makeCtx().ctx, config: plugin.Config({ project: { root: f88Root }, paths: { tempDir: '我的临时' } }), agent: agentAt(f88Root), ensure: false,
})
assert.equal(f88Explicit.paths.tempDir, joinUnderRoot(f88Root, '我的临时'), 'FIX-88 ③：显式配置不被覆盖')
assert.equal(Object.keys(f88Project.paths.docKinds).includes('_临时'), false, 'FIX-88：`_临时` 仍是**非类别目录**（不进 docKinds）')
ok('FIX-88 tempDir 同源：默认取类别目录的公共父目录 + `_临时`（真机 ⇒ `<root>/仓库/docs/_临时`）· 类别直接在 `<root>/docs` 时仍是 `<root>/docs/_临时` · 显式配置优先 · 仍是非类别目录')

// ---------------------------------------------------------------- FIX-89 主代理做甩手掌柜（分工 + 能力表 + 可执行流程）
assert.equal(ROLE_META.researcher.capabilities.includes('recon'), true, 'FIX-89 ②：能力标签在**唯一**的角色元数据表里')
const f89Ctx = makeCtx()
plugin.apply(f89Ctx.ctx, fxCfg)
const f89Status = await f89Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f89Text = f89Ctx.mine.find((tool) => tool.name === 'contract_status').output.render({}, f89Status)[0].text
assert.ok(f89Text.includes('谁能干什么（按能力找角色）'), 'FIX-89 ②：contract_status 要打印「谁能干什么」对照表')
assert.ok(/recon/.test(f89Text) && /bookkeeping/.test(f89Text), 'FIX-89 ②：能力表要列出能力标签')
assert.ok(f89Text.includes('甩手掌柜'), 'FIX-89 ①：分工指引要写明"盘点/侦察/数数派 researcher，你只做判断/拍板/验收/汇报"')
assert.ok(/不要自己跑批量侦察/.test(f89Text), 'FIX-89 ①：明写"不要自己跑批量侦察"')
const f89FlowTool = f89Ctx.mine.find((tool) => tool.name === 'contract_flow')
assert.ok(f89FlowTool, 'FIX-89 ③：要有 `contract_flow` 工具（查可执行流程）')
const f89Flow = await f89FlowTool.execute({ name: 'organize-docs' })
assert.ok(f89Flow.flow.steps.length >= 4, 'FIX-89 ③：organize-docs 给步骤序列')
assert.ok(f89Flow.flow.steps.some((step) => step.role === 'researcher' && /盘点/.test(step.action)), 'FIX-89 ③：第一步就是派 researcher 盘点（重活外包）')
assert.ok(f89Flow.flow.steps.some((step) => step.stopForUser === true), 'FIX-89 ③：要标出"何时停下等用户确认"')
assert.ok(f89Flow.flow.steps.some((step) => step.role === 'librarian' && /dryRun|预演/.test(step.action)), 'FIX-89 ③：落地前要有馆员的预演步骤')
for (const name of ['implement', 'research']) {
  const flow = await f89FlowTool.execute({ name })
  assert.ok(flow.flow.steps.length >= 3, `FIX-89 ③：${name} 流程要有步骤序列`)
}
await assert.rejects(() => f89FlowTool.execute({ name: '不存在的流程' }), /未知流程|可用流程/, 'FIX-89 ③：未知流程名要报错并列出可用名（不静默）')
ok('FIX-89 甩手掌柜：分工指引（盘点/侦察/数数派 researcher，主代理只判断·拍板·验收·汇报）· 能力对照表（谁能干什么，来源=角色元数据表）· `contract_flow` 给三条可执行流程（含 stopForUser 停下点）')





// ---------------------------------------------------------------- FIX-75 预算口径：不限机器搬运 · 限任务切片 · 交接用相对路径
// ① 机器搬运不再当"失控"卡（角色卡涨到 1201 字也不该报警）
const fx75Cfg = plugin.Config({
  project: { root: fxRoot },
  paths: { tasksDir: '任务', deliverablesDir: 'docs/产出', docsDirs: ['docs'] },
  budgets: { briefSoft: 1000, briefHard: 2000 },
})
// 交接语境的根说明只有"有任务文件/有切片命中"时才出现 ⇒ 先造一个任务文件（真机也总有）喵
await mkdir(joinUnderRoot(fxRoot, '任务'), { recursive: true })
await writeFile(joinUnderRoot(fxRoot, '任务/T-978.md'), '# T-978 预算口径\n\n任务文件。\n', 'utf8')
const fx75Big = await buildContract({
  config: fx75Cfg, roleId: 'librarian', task: { id: 'T-976' }, parent: '主代理', layer: 1, totalAgents: 1,
  project: resolveProject(fx75Cfg),
})
assert.equal(fx75Big.warnings.some((line) => /搬运失控|装配瘦身预算超限/.test(line)), false, 'FIX-75 ①：机器搬运不再报"失控"')
assert.equal(fx75Big.warnings.some((line) => /片段 role 超软限|片段 capability/.test(line)), false, 'FIX-75 ②：role / capability 段长**不再触发任何警告**（真机那条必然触发的警告）')
const fx75RoleSeg = fx75Big.segments.find((segment) => segment.id === 'role')
assert.equal(fx75RoleSeg.level, 'ok', 'FIX-75 ②：role 段 level 必须 ok（⇒ 审计的 over_budget 不会记它）')
// ④ 守卫没死：总量超阈值仍给一条 **info 提示**（不是警告、不叫失控）
const fx75Huge = await buildContract({
  config: fx75Cfg, roleId: 'librarian', task: { id: 'T-977' }, parent: '主代理', layer: 1, totalAgents: 1,
  project: resolveProject(fx75Cfg), slices: null,
})
assert.ok(fx75Huge.nonMandateChars > 0, 'FIX-75 ④：总量仍被算出来（守卫没死）')
assert.ok(/总量提示/.test(fx75Huge.totalHint || '') || fx75Huge.nonMandateChars <= NON_MANDATE_BUDGET, 'FIX-75 ④：超阈值时给「总量提示」（info 口径），不再是"失控"')
assert.equal(/失控/.test(fx75Huge.totalHint || ''), false, 'FIX-75 ①：提示文案里不许再出现"失控"')
// ② 真正要限的：任务切片（brief）
// 注意：**尾巴要有唯一标记** —— 否则"裁没裁"会被重复内容骗过去（第一版就栽在这：全文都是"细节"两字）喵
const fx75Brief = '细节'.repeat(1499) + '尾巴标记XYZ' // ≈3000 字，远超硬限 2000
const fx75Trim = await buildContract({
  config: fx75Cfg, roleId: 'researcher', task: { id: 'T-978', brief: fx75Brief }, parent: '主代理', layer: 1, totalAgents: 1,
  project: resolveProject(fx75Cfg),
})
assert.ok(fx75Trim.warnings.some((line) => line.includes('任务切片超长')), 'FIX-75 ②：超硬限 ⇒ 裁剪 + 回执警告')
assert.ok(fx75Trim.warnings.some((line) => line.includes('只留指针')), 'FIX-75 ②：警告要给正确姿势（细节写进任务卡/文档，切片只留指针）')
// 裁剪判据看的是**切片本身**（整份契约自然比 brief 长，不能拿总字数比）喵
assert.ok(fx75Trim.text.includes(fx75Brief.slice(0, 40)), 'FIX-75 ②：裁剪保留开头')
assert.equal(fx75Trim.text.includes('尾巴标记XYZ'), false, 'FIX-75 ②：超硬限的尾巴被裁掉（契约里确实裁过）')
const fx75SoftBrief = '要点'.repeat(700) // 1400 字：超软限、未超硬限
const fx75Soft = await buildContract({
  config: fx75Cfg, roleId: 'researcher', task: { id: 'T-979', brief: fx75SoftBrief }, parent: '主代理', layer: 1, totalAgents: 1,
  project: resolveProject(fx75Cfg),
})
assert.ok(fx75Soft.warnings.some((line) => line.includes('任务切片偏长')), 'FIX-75 ②：超软限只提醒（不裁）')
assert.ok(fx75Soft.text.includes(fx75SoftBrief.slice(0, 50)), 'FIX-75 ②：未超硬限 ⇒ 全文保留')
// ③ 交接语境用相对路径 + 根说明；**read 用绝对路径仍保留**
const fx75Rel = relToRootText(fxRoot, joinUnderRoot(fxRoot, 'docs/研究/x.md'))
assert.equal(fx75Rel, 'docs/研究/x.md', 'FIX-75 ③：相对写法 = 去掉项目根前缀（正斜杠）')
assert.equal(relToRootText(fxRoot, 'D:\\别的地方\\x.md'), '', 'FIX-75 ③：不在项目根内 ⇒ 不给相对写法（避免歧义）')
const fx75Text = fx75Trim.text
assert.ok(fx75Text.includes('相对项目根'), 'FIX-75 ③：任务切面/切片里要出现相对写法')
assert.ok(fx75Text.includes(`以 \`${fxRoot}\` 为基`), 'FIX-75 ③：同段要给"以上路径均相对项目根 <root>"的说明')
assert.ok(/任务文件（绝对路径，请自己 read 它）/.test(fx75Text), 'FIX-75 ③：**read 用绝对路径仍保留**（子代理可能在别的工作区）')
ok('FIX-75 预算口径：机器搬运不再当"失控"卡（role/capability 无段限·总量降级为 info「总量提示」）· 新增**任务切片**软 1000/硬 2000（超硬裁剪 + 回执警告 + "只留指针"姿势）· 交接语境给相对项目根写法并附根说明，read 仍用绝对路径')







ok('FIX-58 ⑥ 与 FIX-57 联动：套件按"自适应规则 + 形状一致性"校验（换任意项目仍绿、制造不一致必红）—— 见文末 bundle patch 段')


/**
 * **项目形状**校验喵（FIX-57，口径按 FIX-58 调整）喵：只校验"结构自洽"，**不写死任何项目值**喵。
 *
 * 为什么要有它：此前套件把项目根与目录名写死 ⇒ 插件号称"换项目=换 config"、换项目套件必红 ✗
 * （"通用引擎"名不符实）。改成形状校验后，任意项目只要结构自洽就绿 ✓，
 * 而"故意制造不一致"必须红 ✓（校验得有牙，不是摆设）喵。
 *
 * **FIX-58 调整（口径反转，不是放宽）**：自适应模式下 `project.root` 与 `paths.*`
 * **本来就可以不配**（"没配"= 跟随工作区 + 探测/自建结构）⇒ 空值是**合法**的；
 * 但**一旦配了**就得自洽（绝对路径、六类齐全、类别目录在检索范围内、archiveDir 对齐）——
 * 这条比原来更严一点（新增了"多出未知类别也要报"）喵。
 * @returns 错误清单（空数组 = 通过）喵。
 */
function checkProjectShape(config) {
  const errors = []
  const project = (config && config.project) || {}
  const root = String(project.root || '')
  // 用宿主/插件自己的判断（`isAbsolutePath()` 已跨平台处理 Windows 盘符与 UNC）喵
  // 空 = 自适应（合法）；配了就必须是绝对路径喵
  if (root && !isAbsolutePath(root)) errors.push(`project.root 必须是绝对路径（或留空走自适应），实际 ${root}`)
  const paths = (config && config.paths) || {}
  const docsDirs = Array.isArray(paths.docsDirs) ? paths.docsDirs : []
  const docKinds = (paths.docKinds && typeof paths.docKinds === 'object') ? paths.docKinds : {}
  const kinds = Object.keys(docKinds)
  // FIX-69：类别键固定为**八类**（新增 审查 / 整合清单；产出档按档级分子目录）喵
  const required = ['研究', '审查', '整合清单', '坑', '修改', '核心数据库', '产出档', '归档']
  for (const kind of required) {
    // 空 docKinds = 走自适应探测（插件自己会给全套六类）；给了就必须给全喵
    if (!kinds.length) break
    if (!kinds.includes(kind)) { errors.push(`docKinds 缺类别 ${kind}`); continue }
    // 「在检索范围内」= 等于某个 docsDir **或位于其下**（Blockdustry 的 子agent/archive 就是靠父目录 `仓库/docs` 覆盖的）喵
    const covered = docsDirs.some((dir) => isUnder(docKinds[kind], dir))
    if (!covered) errors.push(`docKinds.${kind} 指向的目录不在 docsDirs 里：${docKinds[kind]}`)
  }
  for (const kind of kinds) {
    if (!required.includes(kind)) errors.push(`docKinds 出现未知类别 ${kind}（类别名固定，值随项目）`)
  }
  if (kinds.length && !paths.archiveDir) errors.push('paths.archiveDir 不能为空（配了 docKinds 就要给归档目录）')
  else if (paths.archiveDir && docKinds.归档 !== undefined && paths.archiveDir !== docKinds.归档) {
    errors.push(`archiveDir 必须等于 docKinds.归档（${paths.archiveDir} ≠ ${docKinds.归档}）`)
  }
  return errors
}

// ---------------------------------------------------------------- 交付物：README「已知限制」段（RELEASE.md §2/§3 硬要求）
// 文档也是交付的一部分：这几条是**随版发布**的已知边界，必须写在 README 里，而不是只躺在 RELEASE.md 里喵。
const releaseArg = process.argv[2]
if (!releaseArg) {
  console.log('skip README 已知限制检查（未传 patch 路径，拿不到 README）')
} else {
  const readme = await readFile(join(dirname(releaseArg), 'README.zh.md'), 'utf8')
  // README 是可被人工重排的（实测被改成 `## 8. 已知限制` 这种带编号的形式）→ 标题匹配要容忍编号喵
  assert.ok(/^## (?:\d+\.\s*)?已知限制\s*$/m.test(readme), 'RELEASE.md：README 必须有「已知限制」段')
  const requiredLimits = [
    // FIX-52 验收⑧：这一条的口径**被单据改写**了 —— 同一位置，要求从"开关读回只能 best-effort"
    // 换成"面板开关已有正式设置项、读回走宿主设置"（要求换了，不是放宽）喵
    ['面板开关走宿主设置', /(开关[\s\S]{0,60}设置)|(设置[\s\S]{0,60}开关)/],
    ['异源需配 modelRoutes', /modelRoutes\.adversary/],
    ['归档为人工/馆员触发', /归档[\s\S]{0,40}人或馆员触发|人或馆员触发[\s\S]{0,40}归档|\*\*归档 \/ 归位是/],
    ['面板数据来自派生快照', /panel\.json[\s\S]{0,80}(不是真相|非真相)/],
    ['Windows 终端是 pwsh', /pwsh[\s\S]{0,60}不是 `bash`|`pwsh`.*不是.*bash/],
    ['面板依赖 betterSidebar', /betterSidebar[\s\S]{0,80}静默降级/],
    // FIX-58：换仓库不用改配置是**产品承诺**，必须写进随版发布的已知边界（含它的两条代价）喵
    ['零配置自适应', /零配置自适应[\s\S]{0,200}(跟着当前工作区|跟随当前工作区)/],
    ['自适应只新建不覆盖', /只新建(不|、绝不)覆盖/],
    ['面板按会话目录找快照（自适应的代价）', /面板找 `panel\.json` 是按\*\*会话目录\*\*推的|会话目录.*项目根.*最稳/],
  ]
  for (const [label, pattern] of requiredLimits) {
    assert.ok(pattern.test(readme), `RELEASE.md：README 的「已知限制」必须写明「${label}」`)
  }
  ok('交付物 README 已知限制：边界都在（设置页/配置文件分工 · 异源配置 · 归档触发 · 派生物非真相 · pwsh · betterSidebar · 面板只读 · FIX-58 零配置自适应及其代价）')
}

// ---------------------------------------------------------------- FIX-5 免 bash 入口
const patchArg = process.argv[2]
if (!patchArg) {
  console.log('skip FIX-5 入口检查（未传 patch 路径，拿不到源码目录）')
} else {
  const srcDir = dirname(patchArg)
  const pkg = JSON.parse(await readFile(join(srcDir, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.test, 'node scripts/verify-node.mjs', 'FIX-5：npm test 必须指向纯 Node 入口')
  assert.ok(existsSync(join(srcDir, 'scripts', 'verify-node.mjs')), 'FIX-5：必须存在 scripts/verify-node.mjs')
  const shWrapper = await readFile(join(srcDir, 'scripts', 'verify.sh'), 'utf8')
  assert.ok(shWrapper.includes('verify-node.mjs'), 'FIX-5：verify.sh 必须退化为薄包装')
  assert.equal(
    /mkdtemp|mktemp|cp -r|cat >/.test(shWrapper), false,
    'FIX-5：verify.sh 不得再自行实现套件逻辑（逻辑必须在 node 入口里）',
  )
  ok('FIX-5 免 bash 入口：verify-node.mjs 存在 / verify.sh 是薄包装 / npm test 指向它')
}

// ---------------------------------------------------------------- FIX-91 占位不许**粘滞**（真机：一次占位 = 面板审计区永久空）
const f91Root = await mkdtemp(join(tmpdir(), 'ac-fix91-'))
const f91Cfg = plugin.Config({ project: { root: f91Root }, audit: { checks: ['ghost_run'] } })
const f91Project = resolveProject(f91Cfg)
const f91Store = await createLedger(makeCtx().ctx, 'fix91').ready
const f91Writes = []
/** 造一个"写入被记下来"的同步器（写函数注入 ⇒ 一次真磁盘写都不发生）喵。 */
// FIX-96 ② 起，补算的注入点叫 `refresh`（**算审计 + 重写快照**的同源实现，不是只算不写的 `runAudit`）喵
const f91Sync = (previous, refresh = null, extra = {}) => createPanelSync({
  store: f91Store,
  project: f91Project,
  write: async ({ audit }) => { f91Writes.push({ audit }); return { ok: true } },
  readPrevious: async () => previous,
  refresh,
  setTimer: () => ({}),
  clearTimer: () => {},
  ...extra,
})
// ① 上一份是 **placeholder** ⇒ **不沿用**（病根：沿用把占位一代代传下去 ⇒ 一次占位 = 永久空）
// ①-a 旧格式的占位：**数字齐全**（red:0 / yellow:0）但标了 placeholder —— 这正是"粘滞"最危险的形态：
//     光看"有没有 red"是拦不住它的，必须**显式认 placeholder**（断言要有牙，就不能只喂一个 red:null 的样本）喵
const f91Sticky = f91Sync({ generatedAt: 'x', audit: { level: 'unknown', red: 0, yellow: 0, placeholder: true, items: [] } })
f91Sticky.record()
await f91Sticky.flush()
assert.equal(f91Writes[f91Writes.length - 1].audit, null, 'FIX-91 ①：上份是占位（**哪怕数字齐全**）也**不沿用**（否则"一次占位 = 永久空"）')
// ①-b 真机快照的实际形态：red/yellow 都是 null（这种本来就拦得住，作为回归钉住）喵
const f91StickyNull = f91Sync({ generatedAt: 'x', audit: { level: 'unknown', red: null, yellow: null, placeholder: true, items: [] } })
f91StickyNull.record()
await f91StickyNull.flush()
assert.equal(f91Writes[f91Writes.length - 1].audit, null, 'FIX-91 ①：red 为 null 的占位同样不沿用（也不许拿它当"0 红 0 黄"）')
// ② 上一份是**有效结论** ⇒ 沿用 + asOf（FIX-39/47 的口径不许被这次改动带走）
const f91Valid = f91Sync({
  generatedAt: '2026-10-03T00:00:00.000Z',
  audit: { level: 'red', red: 2, yellow: 5, items: [{ check: 'ghost_run', level: 'red', target: 'T-x', detail: '缺档' }] },
})
f91Valid.record()
await f91Valid.flush()
assert.equal(f91Writes[f91Writes.length - 1].audit.counts.red, 2, 'FIX-91 ①：有效结论照旧沿用（红计数不归零）')
assert.equal(f91Writes[f91Writes.length - 1].audit.counts.yellow, 5, 'FIX-91 ①：黄计数同样沿用')
assert.equal(f91Writes[f91Writes.length - 1].audit.asOf, '2026-10-03T00:00:00.000Z', 'FIX-91 ①：沿用要标"截至何时"')
// ③ 无上一份 ⇒ 占位**自带动作文案**（不许空白、不许只说"待接"、不许写 0 红 0 黄）
const f91Bare = buildPanelSnapshot({ store: f91Store, project: f91Project, audit: null, now: 't' })
assert.equal(f91Bare.audit.placeholder, true, 'FIX-91 ③：无审计数据 ⇒ 标 placeholder')
assert.equal(f91Bare.audit.red, null, 'FIX-91 ③：red 是 null 而不是 0（0 = 谎报全绿）')
assert.ok(f91Bare.audit.action.includes('尚无审计结论'), 'FIX-91 ②：占位要明写"尚无审计结论"（不是空 items）')
assert.ok(f91Bare.audit.action.includes('audit_scan'), 'FIX-91 ②：要给**可执行**的下一步（跑一次 audit_scan）')
assert.ok(f91Bare.audit.action.includes('有动作') && f91Bare.audit.action.includes('重启'), 'FIX-91 ⑤：还要讲清"面板只在有动作时写入、**纯重启不会刷新**"（用户口径）')
// ④ 启动自愈**补算一次审计**（不必等人工动作）—— 走**同源实现**，由它自己落盘
const f91AuditCalls = []
const f91WritesBefore = f91Writes.length
const f91HealCtx = f91Sync(
  { pluginVersion: '0.0.1-old', audit: { placeholder: true, red: null, yellow: null, items: [] } },
  async () => { f91AuditCalls.push(1); return { report: { level: 'green', counts: { red: 0, yellow: 0 }, items: [] }, written: { ok: true } } },
)
const f91Heal = await f91HealCtx.heal({ currentVersion: '9.9.9' })
assert.equal(f91Heal.healed, true, 'FIX-91 ④：版本不一致 ⇒ 自愈重写')
assert.equal(f91Heal.audited, true, 'FIX-91 ④：自愈时**补算过一次审计**')
assert.equal(f91AuditCalls.length, 1, 'FIX-91 ④：补算只跑一次')
assert.equal(f91Writes.length, f91WritesBefore, 'FIX-96 ②：补算走**同源实现**（算审计 + 写快照都在它里面）⇒ 这里不再重复写一次')
// 版本一致 ⇒ 既不重写也不补算（FIX-51 的既有口径，别被这次改动带走）
const f91NoHeal = f91Sync({ pluginVersion: '9.9.9' }, async () => { f91AuditCalls.push(1); return { report: { counts: { red: 0, yellow: 0 }, items: [] }, written: { ok: true } } })
const f91NoHealOut = await f91NoHeal.heal({ currentVersion: '9.9.9' })
assert.equal(f91NoHealOut.healed, false, 'FIX-91：版本一致 ⇒ 不自愈（不白写）')
assert.equal(f91AuditCalls.length, 1, 'FIX-91：版本一致时连审计都不补算')
// ⑤ 补算**失败**不许带塌自愈：退回占位（占位自带"怎么办"）+ 计入错误
const f91BrokenHeal = f91Sync({ pluginVersion: '0.0.1-old' }, async () => { throw new Error('模拟：审计不可用') })
const f91BrokenOut = await f91BrokenHeal.heal({ currentVersion: '9.9.9' })
assert.equal(f91BrokenOut.healed, true, 'FIX-91 ⑤：补算失败仍要写快照（不能因此不写）')
assert.equal(f91Writes[f91Writes.length - 1].audit, null, 'FIX-91 ⑤：补算失败 ⇒ 退回占位（快照自己带"怎么办"）')
assert.equal(f91BrokenHeal.stats().errors, 1, 'FIX-91 ⑤：补算失败要计数（不静默）')
// ⑥ 面板侧：占位文案与渲染（文案来自 host，client 兜底同口径）
assert.equal(view.auditSummaryText(f91Bare.audit), AUDIT_PLACEHOLDER_TEXT, 'FIX-91 ②：摘要条写"尚无结论 + 下一步"')
assert.ok(view.AUDIT_PLACEHOLDER_HINT.includes('有动作') && view.AUDIT_PLACEHOLDER_HINT.includes('重启'), 'FIX-91 ⑤：client 兜底文案同口径')
assert.ok(clientSource.includes('agent-contract-audit-hint'), 'FIX-91 ②：占位提示必须**真的渲染**（不是只写个常量）')
assert.ok(clientSource.includes('snapshot.audit.action'), 'FIX-91 ②：优先用 host 下发的 action 文案（与 README 同一句话）')
ok('FIX-91 占位不再粘滞：上份是 placeholder ⇒ **不沿用**（有效结论仍照旧沿用并标 asOf）· 占位自带"尚无结论 + 跑一次 audit_scan + 只在有动作时写入、纯重启不刷新"· 启动自愈**补算一次审计**（失败退回占位并计数，版本一致时连补算都不做）· client 兜底同口径且真的渲染')

// ---------------------------------------------------------------- FIX-92 重探写回**不受 ensure 门控**（真机：FIX-83 在启动那条只读路径上等于没生效）
const f92MetaPath = joinUnderRoot(f82Root, PROJECT_META_REL)
const f92OldMeta = JSON.stringify({
  version: PROJECT_META_VERSION, root: f82Root, name: '旧布局项目', key: 'oldlayout', paths: f82OldPaths, generatedAt: '2026-10-03T08:53:40.708Z',
}, null, 2)
// ① `ensure: false`（= 启动"点亮快照"那条**只读**解析路径）也要写回
await writeFile(f92MetaPath, f92OldMeta, 'utf8')
const f92Out = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: false })
const f92Saved = JSON.parse(await readFile(f92MetaPath, 'utf8'))
assert.equal(f92Saved.layoutVersion, PROJECT_LAYOUT_VERSION, 'FIX-92 ①：`ensure:false` 的重探**也写回**（真机：只读路径永不写回 ⇒ 每次白重探 + 磁盘与真实布局长期不一致）')
assert.equal(Object.keys(f92Saved.paths.docKinds).length, 8, 'FIX-92 ①：磁盘文件里是**八类**')
assert.ok(f92Saved.paths.tempDir, 'FIX-92 ①：磁盘文件里有 tempDir')
assert.equal(f92Saved.name, '旧布局项目', 'FIX-92 ①：写回保留 name')
assert.equal(f92Saved.generatedAt === '2026-10-03T08:53:40.708Z', false, 'FIX-92 ①：generatedAt 已刷新（mtime 必变的等价断言）')
assert.ok(f92Out.notes.some((note) => note.includes('已写回')), 'FIX-92 ①：回执说明"已写回"')
assert.equal(existsSync(joinUnderRoot(f82Root, 'docs/审查')), false, 'FIX-92：写回的是**派生物**，不是"顺手建目录"（ensure:false 仍然不建）')
// ② 显式 dryRun ⇒ 不写回，但**必须说明原因**（不许静默）
await writeFile(f92MetaPath, f92OldMeta, 'utf8')
const f92Dry = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: false, dryRun: true })
const f92DryMeta = JSON.parse(await readFile(f92MetaPath, 'utf8'))
assert.equal(f92DryMeta.layoutVersion === PROJECT_LAYOUT_VERSION, false, 'FIX-92 ②：dryRun **不写回**（磁盘还是旧布局）')
assert.equal(Object.keys(f92Dry.paths.docKinds).length, 8, 'FIX-92 ②：内存视图照样按新布局（不影响本次使用）')
assert.ok(f92Dry.notes.some((note) => note.includes('dryRun') && note.includes('未写回')), 'FIX-92 ②：不写回要**说明原因**（"本次为 dryRun ⇒ 未写回"）')
// ③ 写失败仍照 FIX-83（进 notes + 下次继续重探）
const f92Fail = await resolveAdaptiveProject({
  ctx: makeCtx().ctx, config: f82Cfg, agent: agentAt(f82Root), ensure: false,
  writeMeta: async () => ({ ok: false, error: '模拟：磁盘只读' }),
})
assert.equal(Object.keys(f92Fail.paths.docKinds).length, 8, 'FIX-92 ③：写失败不影响内存视图')
assert.ok(f92Fail.notes.some((note) => note.includes('写回失败')), 'FIX-92 ③：写失败不静默')
ok('FIX-92 重探写回解耦于 ensure：`ensure:false` 的只读解析路径**也写回**（layoutVersion/八类/tempDir/刷新的 generatedAt，保留 name）· 不建任何目录 · 显式 dryRun 才不写回且**说明原因** · 写失败仍不静默')

// ---------------------------------------------------------------- FIX-93 常驻单例"没被复用"（真机：又新建了一个一次性馆员，名字还带任务号）
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: null, existing: null })).includes('store 未绑定'), 'FIX-93 ①：store 未绑定要说得出原因')
assert.ok(String(residentReuseReason({ role: { id: 'librarian' }, boundStore: {}, existing: null })).includes('singleton'), 'FIX-93 ①：角色元数据缺 singleton 要说得出原因')
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'one-shot' } })).includes('一次性实例'), 'FIX-93 ①：同名记录是一次性实例要说得出原因')
assert.equal(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: null }), null, 'FIX-93 ①：台账里干干净净 = **首次创建**（正常），不算复用失败')
const f93Ctx = makeCtx()
plugin.apply(f93Ctx.ctx, cfg)
await f93Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f93Domains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) f93Domains[key] = f93Ctx.ctx.storageDomain.opened.get(spec.name)
const f93Store = createStore(f93Domains, projectKeyOf(cfg))
const f93Tool = f93Ctx.mine.find((tool) => tool.name === 'contract_delegate_librarian')
const f93Exec = { agent: bgAgent, signal: new AbortController().signal }
/** 另起一份干净 ctx + store（成员记录按 id 存 ⇒ 同一个夹具里混两轮会互相干扰）喵。 */
const f93Fresh = async () => {
  const made = makeCtx()
  // 续派走的是宿主的 `sendMessage`（宿主不给这个桩就只会"续派未送达"）⇒ 这里补上并记录喵
  const sent = []
  made.ctx.subagents.sendMessage = async (sender, targetId, content) => {
    sent.push({ targetId, text: content && content[0] ? content[0].text : '' })
    return 'msg-resident'
  }
  plugin.apply(made.ctx, cfg)
  await made.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
  const domains = {}
  for (const [key, spec] of Object.entries(DOMAIN_SPECS)) domains[key] = made.ctx.storageDomain.opened.get(spec.name)
  return {
    store: createStore(domains, projectKeyOf(cfg)),
    tool: made.mine.find((tool) => tool.name === 'contract_delegate_librarian'),
    toolNamed: (name) => made.mine.find((tool) => tool.name === name),
    calls: made.calls,
    sent,
    // 有时要改这个 ctx（例如给 `get('workspaceRegistry')` 塞"已归档会话"）⇒ 把 make 也交出来喵
    make: made,
  }
}
// ① 首次创建：回执要**明说**它是第一个（不许让读者猜"这是第几个它"）
const f93First = await f93Tool.execute({ taskId: 'T-970' }, f93Exec)
assert.equal(f93First.dispatched, 'created', 'FIX-93 ①：首次派单 = 创建')
assert.ok(String(f93First.reuseNote || '').includes('首次创建'), 'FIX-93 ①：首次创建要明说（且回执里看得见）')
assert.ok(f93Tool.output.render({}, f93First)[0].text.includes('首次创建'), 'FIX-93 ①：首次创建的说明要**渲染进回执**')
// ② **真机那条路**：常驻馆员已在（continuable），主代理传 `run_in_background:false` 要结果
//    FIX-94（用户拍板 B）起**口径反转**：常驻单例**忽略**该参数 ⇒ 一律走常驻路径（续派），
//    不再有"一次性代跑"。这里保留的是不变量：无论如何都只有一个固定名成员、不另起会话。
//    完整口径见下面 FIX-94 的断言块（反转是用户拍板，不是放宽）喵
const f93B = await f93Fresh()
await f93B.store.putMember(memberRecord({ id: 'child-resident-1', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理' }))
const f93Fg = await f93B.tool.execute({ taskId: 'organize-docs-blockdustry', run_in_background: false }, f93Exec)
const f93Members = f93B.store.listMembers().filter((member) => String(member.name).includes('librarian'))
assert.equal(f93Members.length, 1, `FIX-93 ②：常驻单例**任何路径**都只有一个成员（实际 ${JSON.stringify(f93Members.map((m) => m.name))}）`)
assert.equal(f93Members[0].name, 'librarian', 'FIX-93 ②：名字固定为角色名')
assert.equal(/organize-docs/.test(f93Members[0].name), false, 'FIX-93 ②：名字里**不许**出现任务号（`<任务号>-librarian` 是病征）')
assert.equal(f93Members[0].id, 'child-resident-1', 'FIX-93 ②③：常驻会话 id **不被覆盖**（覆盖了下次续派就发给死会话）')
assert.equal(f93Members[0].mode, 'continuable', 'FIX-93 ②：成员仍是常驻')
assert.equal(f93Members[0].status, 'running', 'FIX-93 ②：常驻成员的状态不被覆盖')
assert.equal(f93Fg.dispatched, 'continued', 'FIX-94（反转 FIX-93 的前台代跑）：常驻单例**忽略**该参数 ⇒ 直接续派，不另起实例')
assert.equal(f93B.store.listMembers().some((member) => member.id === 'child-session-1'), false, 'FIX-93 ②：一次性 run 的会话 id **不入成员表**（它不是"第二个馆员"）')
// ③ 复用失败（store 未绑定）时的**回执**必须报原因 —— 直接注册一条"解析不出 store"的通道来造这条
const f93BlindCtx = makeCtx()
// `collected` 收的是**工具名**；工具对象落在 ctx.tools.register 的收集数组（= makeCtx 的 mine）里喵
registerChannels(f93BlindCtx.ctx, cfg, null, [], async () => ({ project: resolveProject(cfg), key: 'k', notes: [] }))
const f93Blind = f93BlindCtx.mine.find((tool) => tool.name === 'contract_delegate_librarian')
const f93BlindOut = await f93Blind.execute({ taskId: 'T-971' }, f93Exec)
assert.ok(f93BlindOut.warnings.join('|').includes('未能复用'), 'FIX-93 ①③：store 未绑定 ⇒ 回执必须写"未能复用"')
assert.ok(f93BlindOut.warnings.join('|').includes('store 未绑定'), 'FIX-93 ③：并写明**原因**（store 未绑定）')
assert.ok(f93BlindOut.warnings.join('|').includes('librarian'), 'FIX-93 ②：同时保证名字仍是固定名（新建也不拼任务号）')
// ④ 非单例角色命名不变（回归）
for (const roleId of ['researcher', 'implementer', 'reviewer', 'adversary']) {
  assert.equal(memberName('T-970', roleId), `T-970-${roleId}`, `FIX-93 ④：${roleId} 仍按任务实例命名（不误改）`)
}
ok('FIX-93 常驻单例复用说明：首次创建/续派/未能复用（store 未绑定·缺 singleton·同名是一次性实例）三态都**报出来**· 前台代跑也不许改名（不带任务号）不许覆盖常驻会话 id/模式/状态 · 非单例命名回归不变')

// ---------------------------------------------------------------- FIX-94 常驻单例**忽略** run_in_background（用户拍板 B）
// ① 单例 + 传 false ⇒ 与不传**完全等价**：走常驻路径（续派），不新增成员、不另起会话
const f94B = await f93Fresh()
await f94B.store.putMember(memberRecord({ id: 'child-resident-9', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'completed', layer: 1, parent: '主代理' }))
const f94Ignored = await f94B.tool.execute({ taskId: 'T-980', run_in_background: false }, f93Exec)
assert.equal(f94Ignored.kind, 'continuable', 'FIX-94 ①：常驻角色传 false **仍是后台常驻路径**（不是前台一次性）')
assert.equal(f94Ignored.dispatched, 'continued', 'FIX-94 ①：走续派（复用既有常驻会话）')
assert.equal(f94Ignored.childId, 'child-resident-9', 'FIX-94 ①：续派到同一个 childId（**不再另起实例**）')
assert.equal(f94Ignored.oneShot === true, false, 'FIX-94 ①④：回执**不再出现"本次为一次性"**')
assert.equal(f94B.store.listMembers().filter((member) => String(member.name).includes('librarian')).length, 1, 'FIX-94 ①：成员表仍只有一个固定名成员')
assert.equal(f94B.store.listMembers().some((member) => member.id === 'child-session-1'), false, 'FIX-94 ①：**前台 start 没被调用**（没另起会话）')
assert.equal(f94B.calls.start.length, 0, 'FIX-94 ①：一次前台 start 都没发生（忽略参数 = 不改变实例模型）')
assert.equal(f94B.sent.length, 1, 'FIX-94 ①：这轮只派了一次，走的是宿主的 `sendMessage`（续派）')
assert.equal(f94B.sent[0].targetId, 'child-resident-9', 'FIX-94 ①：消息发给既有常驻会话')
// 口径反转（FIX-104 ①，不是放宽）：续派**只发任务切片** ⇒ 消息里**不该**再有契约的不变段（总纲/角色卡）喵
assert.ok(JSON.stringify(f94B.sent[0].text).includes('本轮任务切片'), 'FIX-104 ①：续派消息是「本轮任务切片」')
assert.equal(f94B.sent[0].text.includes('### 角色卡：'), false, 'FIX-104 ①：续派**不重复**角色卡段（按标志性标题查，不按"角色卡"这个词）')
assert.equal(f94B.sent[0].text.includes('### [1] 总纲'), false, 'FIX-104 ①：续派**不重复**总纲段')
// ② 回执：参数已忽略 + 本轮结果去哪读
const f94Receipt = f94B.tool.output.render({}, f94Ignored)[0].text
assert.equal(f94Ignored.backgroundIgnored, true, 'FIX-94 ④：回执字段标明"该参数已被忽略"')
assert.ok(f94Receipt.includes('无效（已忽略）'), 'FIX-94 ②④：回执明写「`run_in_background: false` 对常驻角色**无效（已忽略）**」')
assert.ok(f94Ignored.resultHint.includes('产出档') && f94Ignored.resultHint.includes('进度档'), 'FIX-94 ②：回执给出该角色这轮会写到哪里（产出档目录 + 进度档路径）')
assert.ok(f94Receipt.includes('产出档') && f94Receipt.includes('进度档'), 'FIX-94 ②：这两条要**渲染出来**（不只是字段）')
assert.ok(f94Receipt.includes('audit_scan'), 'FIX-94 ②：并给出"怎么确认它做完了"（跑一次 audit_scan）')
assert.ok(f94Receipt.includes('不阻塞返回'), 'FIX-94 ②：说清常驻路径不阻塞返回（宿主 sendMessage 只回投递确认）')
// ③ 描述：常驻角色写明"该参数无效 + 派完读产出档"；非单例角色的描述里**不挂**这条（免得读无关规则）
assert.ok(/对常驻单例角色无效（会被忽略）/.test(f94B.tool.description), 'FIX-94 ③：常驻通道描述写明参数无效（会被忽略）')
assert.ok(f94B.tool.description.includes('派完读产出档'), 'FIX-94 ③：并给出"要结果"的正确姿势')
assert.ok(f94B.tool.description.includes('无法同步取结果'), 'FIX-94 ②：描述里写明常驻角色无法同步取结果（宿主没有"等到这一轮结束"的能力）')
const f94ResearcherTool = f94B.toolNamed('contract_delegate_researcher')
assert.equal(/对常驻单例角色无效/.test(f94ResearcherTool.description), false, 'FIX-94 ③：非单例通道不挂这条（挂上去就是无关噪音）')
// ④ 单例传 true / 不传 ⇒ 与现状一致（首次创建 / 续派）；非单例传 false ⇒ 行为不变（前台一次性等待）
const f94C = await f93Fresh()
const f94NoArg = await f94C.tool.execute({ taskId: 'T-982' }, f93Exec)
assert.equal(f94NoArg.dispatched, 'created', 'FIX-94 ④：不传 ⇒ 首次创建常驻（与现状一致）')
assert.equal(f94NoArg.oneShot === true, false, 'FIX-94 ④：不传也不标一次性')
const f94TrueArg = await f94C.tool.execute({ taskId: 'T-983', run_in_background: true }, f93Exec)
assert.equal(f94TrueArg.dispatched, 'continued', 'FIX-94 ④：传 true ⇒ 与不传一致（续派）')
assert.equal(f94TrueArg.childId, f94NoArg.childId, 'FIX-94 ④：续派到同一个 childId')
assert.equal(f94TrueArg.backgroundIgnored === true, false, 'FIX-94 ④：没传 false 就不该报"参数被忽略"')
assert.equal(f94C.store.listMembers().filter((member) => String(member.name).includes('librarian')).length, 1, 'FIX-94 ④：传 true / 不传 / 传 false 三种情况合计仍只有一个成员')
const f94Fg = await f94C.toolNamed('contract_delegate_researcher').execute({ taskId: 'T-981', run_in_background: false }, f93Exec)
assert.equal(f94Fg.kind, 'foreground', 'FIX-94 ③（回归）：**非单例**角色传 false 仍是前台一次性（行为不变）')
assert.equal(f94Fg.oneShot, true, 'FIX-94 ③（回归）：非单例角色的回执仍标"本次为一次性"')
const f94ResearcherMember = f94C.store.listMembers().find((member) => member.name === 'T-981-researcher')
assert.ok(f94ResearcherMember, 'FIX-94 ③（回归）：非单例角色仍按 `<任务号>-<角色>` 记账')
assert.equal(f94ResearcherMember.mode, 'one-shot', 'FIX-94 ③（回归）：非单例的前台一次性模式不变')
ok('FIX-94 常驻单例**忽略** run_in_background（用户拍板 B）：传 true/false/不传一律走常驻路径（不另起会话、不新增成员、契约与回执都不写"一次性"）· 传 false 时回执明写"已忽略" + 本轮结果去哪读（产出档/进度档/audit_scan）· 描述写明"对常驻角色无效 + 派完读产出档"（只挂常驻通道）· 非单例角色的前台一次性行为不变')

// ---------------------------------------------------------------- FIX-95 启动自愈**不依赖会话活动**（真机：重启后快照一个字节没动）
const f95Root = await mkdtemp(join(tmpdir(), 'ac-fix95-'))
const f95Bare = await mkdtemp(join(tmpdir(), 'ac-fix95-bare-'))
await mkdir(joinUnderRoot(f95Root, '.agent-contract'), { recursive: true })
const f95SnapPath = panelSnapshotPath({ root: f95Root })
// 造一份"**旧版插件**写的"快照（真机样本：pluginVersion 0.17.0 / mtime 停在重启前）喵
await writeFile(f95SnapPath, JSON.stringify({
  schemaVersion: PANEL_SNAPSHOT_SCHEMA_VERSION,
  generatedAt: '2026-10-03T21:58:01.000Z',
  pluginVersion: '0.17.0',
  todos: [], members: {}, membersById: {}, project: { name: '旧快照', root: f95Root },
  audit: { level: 'unknown', red: null, yellow: null, placeholder: true, items: [] },
}, null, 2), 'utf8')
// 把 mtime 压到一个**确定在过去**的时刻，这样"mtime 必变"的断言不会被文件系统的毫秒粒度骗过去喵
// （别拿真机快照里那个时间戳来 utimes：那是**本地时间**字面量，当 UTC 解析可能落到未来 ✗）
await utimes(f95SnapPath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))
const f95MtimeBefore = (await stat(f95SnapPath)).mtimeMs
// 零配置（不写死项目根）+ 宿主登记着**这一个**工作区 ⇒ 启动这一刻就能推出项目（不需要会话）喵
const f95Cfg = plugin.Config({ paths: {} })
const f95Ctx = makeCtx()
f95Ctx.ctx.get = (name) => {
  if (name === 'workspaceRegistry') return { list: () => [{ root: f95Root }, { root: f95Bare }] }
  if (name === 'sessions') return { get: () => ({ header: {} }) }
  return undefined
}
assert.deepEqual(toHost(workspaceRootsOf(f95Ctx.ctx)), [f95Root, f95Bare], 'FIX-95 ①：能从宿主读出"已登记的工作区"清单')
assert.equal(workspaceRootsOf(makeCtx().ctx), null, 'FIX-95：拿不到清单要返回 **null**（"没辙了"）——与"清单是空的"（[]）必须分开')
const f95Ledger = createLedger(f95Ctx.ctx, 'fix95')
await f95Ledger.ready
const f95Projects = createProjectRegistry()
const f95Resolver = createProjectResolver({ ctx: f95Ctx.ctx, config: f95Cfg, ledger: f95Ledger, projects: f95Projects })
const f95HealLog = { report: null, error: null }
const f95Multi = createMultiPanelSync({
  ctx: f95Ctx.ctx, ledger: f95Ledger, projects: f95Projects, resolver: f95Resolver, healLog: f95HealLog,
})
// ① 不依赖会话活动：直接 `healAll()`（= 插件注册完成时那条触发点）就把旧版快照重写掉
const f95First = await f95Multi.healAll()
assert.equal(f95First.summary.healed, 1, 'FIX-95 ①：旧版写的快照被**重写**（真机病根：这条路径原先根本不存在）')
assert.equal(f95First.summary.skipped, 1, 'FIX-95 ①：没有快照的工作区**跳过**（启动自愈不许在别人仓库里凭空造文件）')
assert.equal(f95First.entries.find((row) => row.root === f95Bare).action, 'no-snapshot', 'FIX-95 ①：跳过的那条要标明原因（不许静默）')
assert.equal(existsSync(panelSnapshotPath({ root: f95Bare })), false, 'FIX-95 ①：真的**没有**生成新快照')
const f95MtimeAfter = (await stat(f95SnapPath)).mtimeMs
assert.ok(f95MtimeAfter > f95MtimeBefore, `FIX-95 ①：磁盘文件 **mtime 必变**（${JSON.stringify(f95First.entries)}）`)
const f95Saved = JSON.parse(await readFile(f95SnapPath, 'utf8'))
assert.equal(f95Saved.pluginVersion, pkgVersion, 'FIX-95 ①：写入方版本**变成当前版本**（面板不再判"陈旧"）')
assert.equal(f95Saved.generatedAt === '2026-10-03T21:58:01.000Z', false, 'FIX-95 ①：generatedAt 刷新')
assert.equal(f95HealLog.report.healed, 1, 'FIX-95 ②：自愈结果**留痕**（healLog 收得到）')
assert.equal(f95HealLog.error, null, 'FIX-95 ②：成功时不留失败痕迹')
// ③ 版本一致 ⇒ 不做无谓重写（保持 FIX-51 的幂等口径）
const f95StableMtime = (await stat(f95SnapPath)).mtimeMs
const f95Second = await f95Multi.healAll()
assert.equal(f95Second.summary.healed, 0, 'FIX-95 ③：版本一致 ⇒ **不重写**')
assert.equal(f95Second.summary.upToDate, 1, 'FIX-95 ③：如实记为"已最新"')
assert.equal((await stat(f95SnapPath)).mtimeMs, f95StableMtime, 'FIX-95 ③：文件真的一个字节没动（幂等）')
// ② 失败不许静默：解析不了 ⇒ 条目记 failed + healLog 留原因；并**从 contract_status 回执里看得见**
const f95BadLog = { report: null, error: null }
const f95Bad = createMultiPanelSync({
  ctx: f95Ctx.ctx, ledger: f95Ledger, projects: f95Projects, healLog: f95BadLog,
  resolver: async () => { throw new Error('模拟：项目解析失败') },
})
const f95BadOut = await f95Bad.healAll({ roots: [f95Root] })
assert.equal(f95BadOut.summary.failed, 1, 'FIX-95 ②：自愈失败记为 failed')
assert.ok(String(f95BadLog.error).includes('项目解析失败'), 'FIX-95 ②：失败原因**写进留痕**（不许静默）')
const f95NoRegCtx = makeCtx()
f95NoRegCtx.ctx.get = (name) => (name === 'sessions' ? { get: () => ({ header: {} }) } : undefined)
assert.equal(workspaceRootsOf(f95NoRegCtx.ctx), null, 'FIX-95：宿主没挂 workspaceRegistry ⇒ null（降级，不抛）')
const f95NoReg = createMultiPanelSync({ ctx: f95NoRegCtx.ctx, ledger: f95Ledger, projects: f95Projects, resolver: f95Resolver, healLog: f95BadLog })
const f95NoRegOut = await f95NoReg.healAll()
assert.equal(f95NoRegOut.summary.failed, 1, 'FIX-95 ②：拿不到工作区清单也算失败（要说明白，不许"什么都没发生"）')
assert.ok(String(f95BadLog.error).includes('workspaceRegistry'), 'FIX-95 ②：原因写明是哪个服务拿不到')
// 真跑插件：`contract_status` 里能读到「启动自愈」这一行（启动那条触发点是插件自己打的）
const f95PluginCtx = makeCtx()
f95PluginCtx.ctx.get = (name) => {
  if (name === 'workspaceRegistry') return { list: () => { throw new Error('模拟：工作区服务坏了') } }
  if (name === 'sessions') return { get: () => ({ header: {} }) }
  return undefined
}
plugin.apply(f95PluginCtx.ctx, cfg)
await new Promise((resolve) => setTimeout(resolve, 30))
const f95StatusTool = f95PluginCtx.mine.find((tool) => tool.name === 'contract_status')
const f95Status = await f95StatusTool.execute({}, { signal: new AbortController().signal })
assert.ok(f95Status.startup_heal, 'FIX-95 ②：`contract_status` 要带「启动自愈」的留痕（"重启为什么没恢复"一眼可查）')
assert.equal(f95Status.startup_heal.failed, 1, 'FIX-95 ②：自愈失败如实带出来')
assert.ok(String(f95Status.startup_heal.error || '').includes('workspaceRegistry'), 'FIX-95 ②：失败原因进回执')
const f95StatusText = f95StatusTool.output.render({}, f95Status)[0].text
assert.ok(f95StatusText.includes('启动自愈'), 'FIX-95 ②：回执里真的渲染出这一行')
assert.ok(f95StatusText.includes('失败原因'), 'FIX-95 ②：失败要写明原因（不许静默）')
// ③ 占位文案要与行为一致：**唯一可靠的动作说在最前面**（跑 audit_scan / 派一次活），「↻ 刷新」作次选
const f95Project = await resolveAdaptiveProject({ ctx: f95Ctx.ctx, config: f95Cfg, agent: agentAt(f95Root), ensure: false })
const f95StoreForSnap = f95Ledger.storeFor(f95Project.key) || (await f95Ledger.ready)
const f95Action = buildPanelSnapshot({ store: f95StoreForSnap, project: f95Project, audit: null, now: 't' }).audit.action
assert.ok(f95Action.indexOf('audit_scan') < f95Action.indexOf('↻ 刷新'), 'FIX-95 ③：`audit_scan`（唯一可靠动作）必须排在「↻ 刷新」**前面**')
assert.ok(f95Action.includes('派一次活'), 'FIX-95 ③：一并给出"派一次活"这个等价动作')
assert.ok(f95Action.includes('次选'), 'FIX-95 ③：「↻ 刷新」要写明是次选')
assert.ok(f95Action.includes('重启') && f95Action.includes('旧版插件'), 'FIX-95 ③：重启到底会不会恢复，文案要说准（只在"快照由旧版插件写入"时补写）')
assert.ok(view.AUDIT_PLACEHOLDER_HINT.indexOf('audit_scan') < view.AUDIT_PLACEHOLDER_HINT.indexOf('↻ 刷新'), 'FIX-95 ③：client 兜底文案同口径（可靠动作在前）')
ok('FIX-95 启动自愈不依赖会话活动：扫宿主**已登记工作区**把旧版写的快照重写掉（mtime 必变 / pluginVersion 变当前版本 / 没快照的工作区跳过且不造文件）· 版本一致不重写（幂等）· 自愈失败留痕并进 `contract_status` 回执（写明原因）· 占位文案把唯一可靠动作（audit_scan / 派一次活）说在最前、「↻ 刷新」明标次选')

// ---------------------------------------------------------------- FIX-99 常驻单例**降到会话作用域**（跨会话不可达 ⇒ 一律新建，绝不拒）


// 真机：新会话派馆员被 `belongs to another parent session` 拒、旧会话那条又指向一次性实例 ⇒ 一个可用的都没有 ✗
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'one-shot' } })).includes('一次性实例'), 'FIX-99 ⑥①：底层是一次性实例 ⇒ 不可复用')
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'continuable', status: 'running', parentSessionId: 'session-OLD' }, parentSessionId: 'session-NEW', ownerSessionId: 'session-OLD' })).includes('禁止跨会话投递'), 'FIX-99 ⑥②：属于别的父会话（owner 已知）⇒ 不可复用（宿主会拒投递）')
assert.equal(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'continuable', status: 'running' }, parentSessionId: 'session-NEW', ownerSessionId: '' }), null, 'FIX-99 ①：owner **未知**（老记录 + 宿主也拿不到）⇒ 不预判，交给"试投递 + 兜底新建"（绝不最终被拒）')
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'continuable', status: 'running' }, parentSessionId: 'session-NEW', ownerSessionId: undefined })).includes('没有可用会话') === false, 'sanity：id 有值时不报"没会话"')
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: 'x', mode: 'continuable', status: 'retired' } })).includes('退役'), 'FIX-99：已退役的记录不再复用')
assert.ok(String(residentReuseReason({ role: getRole({}, 'librarian'), boundStore: {}, existing: { id: '', mode: 'continuable' } })).includes('没有可用会话'), 'FIX-99 ⑥④：记录缺会话 id ⇒ 不可复用')
assert.ok(String(residentReuseReason({
  role: getRole({}, 'librarian'), boundStore: {},
  existing: { id: 'x', mode: 'continuable', status: 'running', parentSessionId: 'session-OLD' },
  parentSessionId: 'session-NEW', ownerSessionId: 'session-OLD', archived: normalizeArchivedSet(['session-OLD']),
})).includes('已归档'), 'FIX-99 ③：owner 会话已归档 ⇒ 视为**可回收**（不再被它占着）')
const f99Agent = { id: 'lead-session', session: { header: { id: 'session-NEW', delegationDepth: 1, parentSession: 'root-session' } } }
const f99Exec = { agent: f99Agent, signal: new AbortController().signal }
// ① 真机那条路：旧会话留下一个常驻实例 + 若干一次性实例 ⇒ 本会话派单**必须成功**（新建 + 旧的 retired）
const f99A = await f93Fresh()
await f99A.store.putMember(memberRecord({ id: 'child-old-session', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理', parentSessionId: 'session-OLD' }))
// 再加一条**别的活跃常驻**（同名不同 id、也没被"让位"那条路碰到）——只有 ④ 的"同角色只留一个 active"才收拾得了它喵
await f99A.store.putMember(memberRecord({ id: 'child-other-session', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'idle', layer: 1, parent: '主代理', parentSessionId: 'session-THIRD' }))
await f99A.store.putMember(memberRecord({ id: 'child-legacy-once', name: 'T53-librarian', role: 'librarian', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
const f99First = await f99A.tool.execute({ taskId: 'T-990' }, f99Exec)
assert.equal(f99First.dispatched, 'created', 'FIX-99 ①：别的会话的常驻实例不可达 ⇒ **本会话新建**（不是续派）')
assert.equal(f99First.childId, 'child-continuable-1', 'FIX-99 ①：新建的是本会话的会话 id')
assert.ok(!(f99First.warnings || []).join('|').includes('续派未送达'), 'FIX-99 ①：不该停在"续派未送达"（那等于派单白做）')
assert.ok((f99First.warnings || []).join('|').includes('禁止跨会话投递'), 'FIX-99 ①：回执要写明原因（宿主禁止跨会话投递）')
assert.ok((f99First.warnings || []).join('|').includes('retired'), 'FIX-99 ①②：回执要写明"旧实例已标 retired"')
const f99OldRec = f99A.store.getMemberById('child-old-session')
assert.equal(f99OldRec.status, 'retired', 'FIX-99 ②：旧常驻实例标 retired')
assert.equal(f99OldRec.id, 'child-old-session', 'FIX-99 ②：**记录保留、不删**（留痕）')
assert.ok(String(f99OldRec.retiredReason || '').includes('禁止跨会话投递'), 'FIX-99 ②：退役原因写进记录（可回溯）')
assert.ok(String(f99OldRec.retiredAt || '').length > 0, 'FIX-99 ②：退役时间也留痕')
assert.equal(f99A.store.getMemberById('child-old-session').mode, 'continuable', 'FIX-99 ②：退役只改状态与原因，不动别的字段')
assert.equal(f99A.store.getMemberById('child-other-session').status, 'retired', 'FIX-99 ②④：别的活跃常驻也一并退役（一个角色在项目内**最多一个 active**）')
// ③ 同一会话内第二次派单 ⇒ **续派**（不新增、childId 不变）
const f99Second = await f99A.tool.execute({ taskId: 'T-991' }, f99Exec)
assert.equal(f99Second.dispatched, 'continued', 'FIX-99 ③：同一会话内第二次 ⇒ 续派')
assert.equal(f99Second.childId, 'child-continuable-1', 'FIX-99 ③：childId 不变（同一个实例）')
// ④ 项目内同角色 **active 常驻 ≤ 1**
const f99Active = f99A.store.listMembers().filter((member) => String(member.role) === 'librarian'
  && String(member.mode) === 'continuable' && !['retired', 'completed', 'released', 'failed'].includes(String(member.status)))
assert.equal(f99Active.length, 1, `FIX-99 ④：同角色活跃常驻实例 **≤ 1**（实际 ${f99Active.map((m) => m.name).join('、')}）`)
// ⑥ owner 已归档 ⇒ 也能新建（不再"被归档的会话占着"）
const f99B = await f93Fresh()
f99B.make.ctx.get = (name) => {
  if (name === 'workspaceRegistry') return { archivedSessionIds: ['session-OLD'] }
  if (name === 'sessions') return { get: () => ({ header: {} }) }
  return undefined
}
await f99B.store.putMember(memberRecord({ id: 'child-archived-owner', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理', parentSessionId: 'session-OLD' }))
const f99Archived = await f99B.tool.execute({ taskId: 'T-992' }, f99Exec)
assert.equal(f99Archived.dispatched, 'created', 'FIX-99 ③⑥：owner 会话已归档 ⇒ 本会话新建（可回收，不许被占着）')
assert.ok((f99Archived.warnings || []).join('|').includes('已归档'), 'FIX-99 ③：原因写明"该会话已归档"')
assert.equal(f99B.store.getMemberById('child-archived-owner').status, 'retired', 'FIX-99 ③：归档会话的旧实例同样退役')
// ⑥ 真机现成样本：只有一条**历史遗留的一次性**记录 ⇒ 派单必须成功
const f99C = await f93Fresh()
await f99C.store.putMember(memberRecord({ id: 'child-legacy-once-2', name: 'librarian', role: 'librarian', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理' }))
const f99Legacy = await f99C.tool.execute({ taskId: 'T-993' }, f99Exec)
assert.equal(f99Legacy.dispatched, 'created', 'FIX-99 ⑥①：同名记录是一次性实例 ⇒ 必须新建（真机样本：这就是"一个可用的都没有"的那条）')
assert.equal(f99C.store.getMemberById('child-legacy-once-2').status, 'retired', 'FIX-99 ⑥：那条一次性记录也标 retired（留痕）')
// ⑤ 跨会话并存 / 同时声明写同一全局文件 ⇒ `occupancy_conflict` 报出
const f99AuditCfg = plugin.Config({ ...auditCfgInput, project: { root: f84Root }, audit: { checks: ['occupancy_conflict'] } })
const f99Store = await createLedger(makeCtx().ctx, 'fix99').ready
await f99Store.putMember(memberRecord({ id: 's-lib-a', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理', parentSessionId: 'session-A' }))
await f99Store.putMember(memberRecord({ id: 's-lib-b', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'running', layer: 1, parent: '主代理', parentSessionId: 'session-B' }))
const f99Overlap = residentOverlaps({ store: f99Store, project: resolveProject(f99AuditCfg) })
assert.equal(f99Overlap.length, 1, 'FIX-99 ④⑤：两个活跃常驻实例（跨会话）⇒ 报一条占用冲突')
assert.ok(f99Overlap[0].detail.includes('全局文件'), 'FIX-99 ④：说明它们写的是同一批**全局文件**')
assert.ok(f99Overlap[0].detail.includes('串行'), 'FIX-99 ④：给出处置（串行 / 先声明占用）')
await f99Store.putMember(memberRecord({ id: 's-lib-b', name: 'librarian', role: 'librarian', mode: 'continuable', status: 'retired', layer: 1, parent: '主代理' }))
assert.equal(residentOverlaps({ store: f99Store, project: resolveProject(f99AuditCfg) }).length, 0, 'FIX-99 ④：退役后不再报（active ≤ 1）')
// 全局文件清单与馆员角色卡（写前先查占用）
const f99Project = resolveProject(f99AuditCfg)
const f99Globals = globalSharedFiles(f99Project)
assert.ok(f99Globals.some((row) => row.key === '坑库索引'), 'FIX-99 ④：全局文件清单含坑库索引')
assert.ok(f99Globals.some((row) => row.key === '派生态索引'), 'FIX-99 ④：含派生态索引')
assert.ok(globalSharedFilesText(f99Project).includes('写前先查占用'), 'FIX-99 ④：这句话要能直接贴进回执')
assert.ok(getRole({}, 'librarian').persona.includes('写全局文件前先查占用'), 'FIX-99 ④：馆员角色卡必须写明这条纪律')
assert.ok(String(f99First.globalFiles || '').includes('坑库索引'), 'FIX-99 ④：派单回执要把全局文件带出去')
ok('FIX-99 常驻单例降到**会话作用域**：跨会话/一次性/已退役/无会话 id/owner 已归档 ⇒ 一律**本会话新建**并把旧实例标 `retired`（记录保留、原因与时间留痕），**绝不允许被拒**· 同角色活跃常驻 ≤ 1 · 全局共享文件清单随回执带出 + 角色卡写明"写前先查占用" + 跨会话并存/同文件声明由 `occupancy_conflict` 报出')


// 真机链条（0.20.0 定位）喵：FIX-90 给成员记录加了 `parentSessionId: z.string().nullable()` ——
// ---------------------------------------------------------------- FIX-98 tempDir 同源**不依赖目录是否存在**（真机复验：FIX-88 没生效）
// 真机：类别全在 `D:\Blockdustry\仓库\docs\*`，而 tempDir 还是 `D:\Blockdustry\docs\_临时`（另一棵树）✗
const f98Root = await mkdtemp(join(tmpdir(), 'ac-fix98-'))
// ① **目录一个都不存在于磁盘**（回滚后的工作区），但 `project.json` 记着类别在 仓库/docs/* ⇒ 临时目录必须跟它们同树
const f98Cache = {
  tasksDir: joinUnderRoot(f98Root, '任务'),
  progressDir: joinUnderRoot(f98Root, '[Agent进度]'),
  deliverablesDir: joinUnderRoot(f98Root, '仓库/docs/产出'),
  docsDirs: ['研究', '审查', '整合清单', '坑', '修改', '核心数据库', '产出', 'archive'].map((name) => joinUnderRoot(f98Root, `仓库/docs/${name}`)),
  archiveDir: joinUnderRoot(f98Root, '仓库/docs/archive'),
  docKinds: {
    研究: joinUnderRoot(f98Root, '仓库/docs/研究'),
    审查: joinUnderRoot(f98Root, '仓库/docs/审查'),
    整合清单: joinUnderRoot(f98Root, '仓库/docs/整合清单'),
    坑: joinUnderRoot(f98Root, '仓库/docs/坑'),
    修改: joinUnderRoot(f98Root, '仓库/docs/修改'),
    核心数据库: joinUnderRoot(f98Root, '仓库/docs/核心数据库'),
    产出档: joinUnderRoot(f98Root, '仓库/docs/产出'),
    归档: joinUnderRoot(f98Root, '仓库/docs/archive'),
  },
  // 真机那个**错值**：默认结构算出来的"另一棵树"
  tempDir: joinUnderRoot(f98Root, 'docs/_临时'),
  todoFile: joinUnderRoot(f98Root, '待办.md'),
}
const f98Temp = tempDirInfoOfPaths({ root: f98Root, paths: f98Cache })
assert.equal(f98Temp.fallback, false, 'FIX-98 ①：有类别路径就算得出公共父目录（**不看目录是否存在**）')
assert.equal(f98Temp.dir, joinUnderRoot(f98Root, '仓库/docs/_临时'), 'FIX-98 ①：临时目录与类别目录**同树**（真机应为 仓库/docs/_临时）')
// 从**探测结果**算也一样：磁盘一个都不在时，planStructure 也必须落回缓存记着的那棵树
const f98Planned = planStructure({ root: f98Root, exists: () => false, isDir: () => false, prefer: f98Cache.docKinds })
assert.equal(f98Planned.targets.tempDir, joinUnderRoot(f98Root, '仓库/docs/_临时'), 'FIX-98 ②：重探时沿用缓存位置 ⇒ 临时目录不会被挪到另一棵树')
assert.equal(f98Planned.targets.researchDir, joinUnderRoot(f98Root, '仓库/docs/研究'), 'FIX-98 ②：类别位置沿用缓存（磁盘上没有也照旧）')
assert.ok(f98Planned.create.some((row) => row.path === joinUnderRoot(f98Root, '仓库/docs/审查')), 'FIX-98：缓存里有、磁盘上缺 ⇒ 仍要列进"将新建"')
// ② 旧 project.json（layoutVersion=2 且 tempDir 是错值）⇒ 加载后**自动重探并修正**，且写回磁盘
await mkdir(joinUnderRoot(f98Root, '.agent-contract'), { recursive: true })
await writeFile(joinUnderRoot(f98Root, PROJECT_META_REL), JSON.stringify({
  version: PROJECT_META_VERSION, root: f98Root, name: '错临时目录项目', key: 'badtemp',
  paths: f98Cache, generatedAt: '2026-10-03T23:21:00.000Z', layoutVersion: 2,
}, null, 2), 'utf8')
const f98Cfg = plugin.Config({ project: { root: '' }, paths: {} })
const f98Out = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f98Cfg, agent: agentAt(f98Root), ensure: false })
assert.equal(f98Out.paths.tempDir, joinUnderRoot(f98Root, '仓库/docs/_临时'), 'FIX-98 ②：加载后内存视图的 tempDir 已修正')
assert.equal(f98Out.paths.docKinds.研究, joinUnderRoot(f98Root, '仓库/docs/研究'), 'FIX-98 ②：类别位置不被重探挪走（沿用缓存）')
const f98Saved = JSON.parse(await readFile(joinUnderRoot(f98Root, PROJECT_META_REL), 'utf8'))
assert.equal(f98Saved.layoutVersion, PROJECT_LAYOUT_VERSION, 'FIX-98 ③：版本号递增到当前（否则错值永远不会被重算）')
assert.equal(f98Saved.paths.tempDir, joinUnderRoot(f98Root, '仓库/docs/_临时'), 'FIX-98 ②：**磁盘文件**里的 tempDir 也修正了')
assert.ok(f98Saved.paths.tempDir !== f98Cache.tempDir, 'sanity：确实不是原来那个错值')
// ③ 显式配置仍优先（不许被"同源"覆盖掉）
const f98Explicit = plugin.Config({ project: { root: f98Root }, paths: { tempDir: '我的临时' } })
const f98ExplicitOut = await resolveAdaptiveProject({ ctx: makeCtx().ctx, config: f98Explicit, agent: agentAt(f98Root), ensure: false })
assert.equal(f98ExplicitOut.paths.tempDir, joinUnderRoot(f98Root, '我的临时'), 'FIX-98 ③：显式 `paths.tempDir` 仍然优先')
// ④ 确实算不出时才退回，且**说明原因**（不许静默）
const f98Nowhere = tempDirInfo({ root: f98Root, dirs: [] })
assert.equal(f98Nowhere.fallback, true, 'FIX-98 ④：没有任何类别路径 ⇒ 只能退回')
assert.ok(String(f98Nowhere.reason).length > 0, 'FIX-98 ④：退回要带**原因**（notes 里说明，不许静默）')
assert.equal(tempDirInfoOfPaths({ root: f98Root, paths: { docKinds: {}, docsDirs: [], deliverablesDir: null } }).dir, joinUnderRoot(f98Root, 'docs/_临时'), 'FIX-98 ④：退回的落点仍是 `<root>/docs/_临时`（与既有口径一致）')
ok('FIX-98 临时目录与类别同源（不依赖目录是否存在）：公共父目录从**已解析的路径集合**算 · 磁盘整批不存在时沿用 `project.json` 记的类别位置 ⇒ 临时目录仍在同树 · `PROJECT_LAYOUT_VERSION` 递增让旧错值被重算并写回 · 显式配置仍优先 · 真算不出时才退回且 notes 说明原因')

// ---------------------------------------------------------------- FIX-90 回归修复：老记录缺新字段 ⇒ 领域打不开（真机 0.18.0 起面板再也不更新）
// 真机链条（0.20.0 定位）喵：FIX-90 给成员记录加了 `parentSessionId: z.string().nullable()` ——
// **`.nullable()` 不带默认值** ⇒ 缺该字段**校验失败**；而 0.17.0 时代落盘的 20 条成员记录全都没有它 ⇒
// 宿主打开领域时逐条 parse ⇒ `invalid-record` ⇒ `ledger.ready` reject ⇒
// 面板同步器整条链被空 catch 吞掉（快照从此一个字节不写、自愈全停）✗✗
assert.equal(memberRecord({ name: 'T-1-researcher', role: 'researcher' }).parentSessionId, null, 'sanity：新记录照旧带这个字段（= null）')
// ① 老记录（0.17.0 形态，**没有** parentSessionId）必须能过 schema，并**补成 null**
const legacyMember = {
  project: 'legacyproj', id: 'session-old', name: 'T53_docs规范化整理-librarian', role: 'librarian',
  mode: 'one-shot', layer: 1, parent: '主代理', status: 'completed', model: 'deepseek-flash', route: 'librarian',
  costUsd: null, latestDeliverable: null, lastActiveAt: '2026-10-03T10:45:30.782Z', derived: false,
}
assert.equal(Object.prototype.hasOwnProperty.call(legacyMember, 'parentSessionId'), false, 'sanity：这条 fixture 就是"没有那个新字段"的老记录')
const legacyParsed = memberSchema.safeParse(legacyMember)
assert.equal(legacyParsed.success, true, `回归：**老记录缺新字段也不许让领域打不开**（真机 20 条就卡在这 —— ${JSON.stringify(legacyParsed.error ? legacyParsed.error.issues : [])}）`)
assert.equal(legacyParsed.data.parentSessionId, null, '回归：缺字段读到即**补 null**（加字段必须带默认值，本文件早有这条规矩）')
// ② 三个领域都挂上"保险丝"：真出现坏记录时宿主只挪走那一条，而不是整个领域打不开
for (const [kind, spec] of Object.entries(DOMAIN_SPECS)) {
  assert.equal(spec.invalidRecords, 'backup-and-skip', `回归：${kind} 领域要允许宿主"备份并跳过"单条坏记录（别让一条记录黑掉整个插件）`)
  assert.equal(spec.layout, 'per-record', `回归：${kind} 仍是 per-record（单条坏记录不牵连其它）`)
}
// ③ 另外两类记录也照**真机落盘形状**各来一条（老形状不改，却仍要过 schema）—— 一条不过又是全站黑屏
const legacyTask = {
  project: 'legacyproj', taskId: '核心数据库维护', status: 'open', owner: null, occupiedFiles: [],
  dependsOn: [], deliverable: null, updatedAt: '2026-08-17T13:10:51.335Z',
}
assert.equal(taskSchema.safeParse(legacyTask).success, true, '回归：老任务记录照旧过 schema')
const legacyDoc = {
  project: 'legacyproj', path: 'D:\\Blockdustry\\仓库\\docs\\子agent\\^P1_x整合清单.md', tier: 0, owner: null,
  taskId: null, title: '^P1_x整合清单', chars: 7978, keywords: ['wall'], relatedFiles: ['a.java'],
  missingSections: [], legacy: true, needsLibrarian: [{ code: 'taskid_unknown', detail: '判不出任务号' }],
  updatedAt: '2026-10-03T11:23:58.390Z', overwriteCount: 0, lastBackupPath: null,
}
assert.equal(docSchema.safeParse(legacyDoc).success, true, '回归：老文档记录照旧过 schema')
// FIX-97 ②：**新增字段一律给默认值**（硬规矩，机制化守住）—— 每张表的每个字段，要么**老记录里就有**，
// 要么带默认值/可选（zod 的 `isOptional()` 对 `.default()` / `.optional()` 都为真）。
// 否则"老记录校验失败 ⇒ 领域打不开 ⇒ 全站黑屏"会再来一次（真机就是这么炸的）✗
// 放在三条真机形状的 fixture **之后**：将来加字段忘了给默认值，这里当场红（配着上面三条"老记录能不能过"
// 一起看：先看"过不过"，再看"是哪个字段缺默认值"）喵
for (const [kind, schema] of Object.entries({ members: memberSchema, tasks: taskSchema, docs: docSchema })) {
  const legacy = { members: legacyMember, tasks: legacyTask, docs: legacyDoc }[kind]
  for (const [field, def] of Object.entries(schema.shape)) {
    const known = Object.prototype.hasOwnProperty.call(legacy, field)
    assert.ok(
      known || def.isOptional(),
      `FIX-97 ②：${kind}.${field} 既不在老记录里、又**没有默认值** —— 加字段必须带默认值（否则老记录校验失败 ⇒ 领域打不开 ⇒ 全站黑屏）`,
    )
  }
}
// ④ 这条链**不许再被静默吞掉**：同步器没挂上要把原因留痕（真机上"面板不更新"曾是个查不到原因的黑洞）
assert.ok(
  /startupHeal\.error = `面板同步器未挂上/.test(fix39IndexSrc),
  '回归：挂同步器那条 catch 必须**把原因写出来**（不许空 catch）',
)
assert.ok(/ctx\.logger\.error/.test(fix39IndexSrc), '回归：同时打一条宿主日志（拿不到 logger 时容错）')
// ⑤ 项目视图的 key 两条构建路径都要带上（自适应那条 + 出厂配置那条），少一条就有调用方取不到 store
assert.ok(
  /return \{ key, project: \{ \.\.\.project, name, key \} \}/.test(fix39IndexSrc),
  '回归：出厂配置那条（bootstrapProject）也要把 `key` 挂在项目视图上',
)
ok('FIX-90 回归修复（真机 0.18.0 起"面板再也不更新"的根因）：加字段必须带默认值 —— `parentSessionId` 由 `.nullable()` 改成 `.nullable().default(null)`，老记录**读到即补 null** 而不是校验失败 · 三个领域声明都挂 `invalidRecords: backup-and-skip`（真出坏记录时只挪走那一条，不让整个插件黑屏）· 挂同步器的 catch **写出原因**（同步器没挂上 = 快照永不重写，这曾经是个查不到原因的黑洞）')


// ---------------------------------------------------------------- FIX-96 面板「强制刷新」= 跑审计 + 重写面板数据（与 audit_scan 同源）
const f96Root = await mkdtemp(join(tmpdir(), 'ac-fix96-'))
const f96Cfg = plugin.Config({ project: { root: f96Root }, audit: { checks: ['ghost_run', 'missing_doc'] } })
const f96PluginCtx = makeCtx()
plugin.apply(f96PluginCtx.ctx, f96Cfg)
await f96PluginCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f96Domains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) f96Domains[key] = f96PluginCtx.ctx.storageDomain.opened.get(spec.name)
const f96Store = createStore(f96Domains, projectKeyOf(f96Cfg))
let f96Payload = {}
// 0.21.0 回归修复：**项目视图必须自带 key** —— 这条路由只能按待办路径反查到项目对象，
// 拿不到 key 就取不到该项目的 store（真机报的就是「台账 store 未绑定（no-store）」而数据其实都好）✗
const f96Resolved = await createProjectResolver({ ctx: f96PluginCtx.ctx, config: f96Cfg, ledger: { ready: Promise.resolve(f96Store), storeFor: () => f96Store }, projects: createProjectRegistry() })({ agent: { session: { header: { cwd: f96Root } } } }, { ensure: false })
assert.equal(f96Resolved.project.key, f96Resolved.key, '回归：解析出的项目视图要带 `key`（否则按项目反查 store 的调用方一律拿不到）')
assert.equal(f96Resolved.project.key, projectSlugOf(deriveProjectName(f96Root)), '回归：这个 key 就是按项目名推出来的**分域键**（与台账 storeFor 用的同一个键）')
// **路由看到的正是这个视图**（带 key）——之前夹具拿的是 `resolveProject(config)`（没 key），正好把真机那个 bug 盖住 ✗
const f96Project = f96Resolved.project
const f96NoKeyProject = { ...f96Project, key: undefined }
// 真机样本：快照是**旧版插件**写的、审计块是**占位**（面板一直"数据源待接"）喵
await mkdir(joinUnderRoot(f96Root, '.agent-contract'), { recursive: true })
const f96SnapPath = panelSnapshotPath(f96Project)
await writeFile(f96SnapPath, JSON.stringify({
  schemaVersion: PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: '2026-10-03T21:58:01.000Z', pluginVersion: '0.17.0',
  todos: [], members: {}, membersById: {}, project: { name: '旧', root: f96Root }, counts: {},
  audit: { level: 'unknown', red: null, yellow: null, asOf: null, placeholder: true, items: [] },
}, null, 2), 'utf8')
const f96Handler = createTodoHandler({
  getProject: () => f96Project,
  getProjects: () => [f96Project],
  fence: () => true,
  // **按项目查 store**（与 index.js 里那条一模一样）——用常数桩会把这个 bug 盖住（真机就是这么漏过去的）✗
  storeFor: (project) => (project && project.key ? f96Store : null),
  // 与插件里**同一个实现**（`refreshPanel`）—— 这里只是把 ctx/config 先绑好，与 index.js 的 `refreshForPanel` 同形喵
  refresh: ({ store, project }) => refreshPanel({ ctx: f96PluginCtx.ctx, config: f96Cfg, store, project }),
  read: async () => '# 待办\n',
  now: () => '2026-10-03T23:00:00.000Z',
  readBodyImpl: async () => JSON.stringify(f96Payload),
})
const f96Call = async (payload, handler = f96Handler) => {
  f96Payload = payload
  const res = makeRes()
  await handler({ method: 'POST', headers: { host: '127.0.0.1:1234' } }, res)
  return res
}
// ① 点一次「强制刷新」⇒ 磁盘上的快照被重算重写（版本标记更新、审计不再是占位）
const f96Ok = await f96Call({ path: f96Project.panel.todoFile, action: 'force-refresh' })
assert.equal(f96Ok.status, 200, 'FIX-96 ①：强制刷新要成功返回')
assert.equal(f96Ok.body.value.receipt, '审计完成：红 0 / 黄 0；面板数据已重写', 'FIX-96 ③：成功要给一句结果回执（红黄计数 + 已重写）')
const f96Snap = JSON.parse(await readFile(f96SnapPath, 'utf8'))
assert.equal(f96Snap.pluginVersion, pkgVersion, 'FIX-96 ①：快照的写入方版本 = **当前版本**（面板不再判"陈旧"）')
assert.equal(f96Snap.audit.placeholder === true, false, 'FIX-96 ①：审计块**不再是占位**（0 条也要是"真结论"）')
assert.equal(f96Snap.audit.level, 'green', 'FIX-96 ①：真跑出来的结论（无红无黄 ⇒ green）')
assert.equal(f96Snap.audit.red, 0, 'FIX-96 ①：红计数是真值（不是 null）')
assert.equal(f96Snap.generatedAt === '2026-10-03T21:58:01.000Z', false, 'FIX-96 ①：generatedAt 刷新')
// ② 与 `audit_scan` **同源**：同一次数据，工具回执与按钮回执口径一致；三个调用点都指向同一个实现
const f96Tool = f96PluginCtx.mine.find((tool) => tool.name === 'audit_scan')
const f96ToolOut = await f96Tool.execute({}, { signal: new AbortController().signal })
assert.equal(f96ToolOut.counts.red, f96Ok.body.value.red, 'FIX-96 ②：工具与按钮**同一份口径**（红计数一致）')
assert.equal(f96ToolOut.counts.yellow, f96Ok.body.value.yellow, 'FIX-96 ②：黄计数一致')
const f96ToolsSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
const f96IndexSrc = await readFile(new URL('./index.js', import.meta.url), 'utf8')
const f96SyncSrc = await readFile(new URL('./src/panel/snapshot-sync.js', import.meta.url), 'utf8')
const f96RefreshSrc = await readFile(new URL('./src/panel/refresh.js', import.meta.url), 'utf8')
assert.equal(/auditScan\(/.test(f96ToolsSrc), false, 'FIX-96 ②：`audit_scan` 工具**不再自己算审计**（改走同源 refreshPanel）')
assert.ok(/refreshPanel\(\{ ctx, config: pluginConfig, store, project \}\)/.test(f96ToolsSrc), 'FIX-96 ②：工具走那一个实现')
assert.equal(/auditScan\(/.test(f96SyncSrc), false, 'FIX-96 ②：启动自愈**也不自己算审计**（只调注入的 refresh）')
assert.ok(/const refreshForPanel = \(\{ store, project \}\) => refreshPanel\(\{ ctx, config, store, project \}\)/.test(f96IndexSrc), 'FIX-96 ②：插件里只包一层（绑定 ctx/config），实现仍是那一个')
assert.equal((f96IndexSrc.match(/refresh: refreshForPanel/g) || []).length, 2, 'FIX-96 ②：自愈与面板按钮**两处接同一个实现**（三处同源：工具 / 自愈 / 按钮）')
assert.ok(/export async function refreshPanel/.test(f96RefreshSrc) && /writePanelSnapshot\(/.test(f96RefreshSrc), 'FIX-96 ②：那个实现就是"算审计 + 重写快照"')
// ③ 白名单与栅栏对这条动作同样生效（没有新增暴露面）
const f96Outside = await f96Call({ path: joinUnderRoot(f96Root, '别的.md'), action: 'force-refresh' })
assert.equal(f96Outside.status, 403, 'FIX-96：强制刷新同样只认已登记项目的待办路径（白名单没被绕过）')
const f96Fenced = await f96Call({ path: f96Project.panel.todoFile, action: 'force-refresh' }, createTodoHandler({
  getProject: () => f96Project, getProjects: () => [f96Project], fence: () => false, storeFor: () => f96Store,
  refresh: ({ store, project }) => refreshPanel({ ctx: f96PluginCtx.ctx, config: f96Cfg, store, project }),
  read: async () => '', now: () => 't', readBodyImpl: async () => JSON.stringify(f96Payload),
}))
assert.equal(f96Fenced.status, 403, 'FIX-96：强制刷新也走同一道 Host 栅栏')
// ④ 失败**必须可见**（四种失败各有明确 code 与原因）
const f96fail = async (override) => f96Call({ path: f96Project.panel.todoFile, action: 'force-refresh' }, createTodoHandler({
  getProject: () => f96Project, getProjects: () => [f96Project], fence: () => true, read: async () => '',
  now: () => 't', readBodyImpl: async () => JSON.stringify(f96Payload), ...override,
}))
const f96Thrown = await f96fail({ storeFor: () => f96Store, refresh: async () => { throw new Error('模拟：审计炸了') } })
assert.equal(f96Thrown.status, 500, 'FIX-96 ④：审计抛错 ⇒ 500')
assert.equal(f96Thrown.body.error.code, 'refresh-failed', 'FIX-96 ④：失败要给明确 code')
assert.ok(f96Thrown.body.error.message.includes('模拟：审计炸了'), 'FIX-96 ④：失败原因要**带出来**（面板据此显示，不许静默）')
// 真机那条「no-store」的路：项目视图**没带 key** ⇒ 路由取不到 store ⇒ 明确报出来（不许当成功）
const f96NoStore = await f96fail({
  getProjects: () => [f96NoKeyProject],
  storeFor: (project) => (project && project.key ? f96Store : null),
  refresh: async () => ({ report: { counts: {} } }),
})
assert.equal(f96NoStore.body.error.code, 'no-store', 'FIX-96 ④：项目视图缺 key ⇒ store 取不到，要明确报 no-store（真机就是这么报的）')
const f96NoStoreByService = await f96fail({ storeFor: () => null, refresh: async () => ({ report: { counts: {} } }) })
assert.equal(f96NoStoreByService.body.error.code, 'no-store', 'FIX-96 ④：store 服务不可用同样报 no-store')
const f96NoRefresh = await f96fail({})
assert.equal(f96NoRefresh.body.error.code, 'no-refresh', 'FIX-96 ④：没有实现时也要明说（不是静默什么都不做）')
const f96WriteFail = await f96fail({
  storeFor: () => f96Store,
  refresh: async () => ({ report: { level: 'green', counts: { red: 0, yellow: 0 }, items: [] }, written: { ok: false, error: '模拟：磁盘只读' } }),
})
assert.equal(f96WriteFail.body.error.code, 'snapshot-write-failed', 'FIX-96 ④：审计算出来了但快照写失败 ⇒ 也必须报（否则面板还是旧的）')
assert.ok(f96WriteFail.body.error.message.includes('模拟：磁盘只读'), 'FIX-96 ④：写失败原因同样带出来')
// ③ client：进行中禁用 + 防连点（3 秒）+ 状态可见；⑤ 「↻ 刷新」行为不变（只重读）
assert.equal(view.FORCE_MIN_GAP_MS, 3000, 'FIX-96 ③：防连点最小间隔 3 秒')
assert.equal(view.forceThrottle(0, 1000).allowed, true, 'FIX-96 ③：首次（没有上次时刻）放行')
assert.equal(view.forceThrottle(1000, 2000).allowed, false, 'FIX-96 ③：1 秒内再点 ⇒ 拒绝')
assert.equal(view.forceThrottle(1000, 2000).waitSeconds, 2, 'FIX-96 ③：还要等几秒要说得出')
assert.equal(view.forceThrottle(1000, 4000).allowed, true, 'FIX-96 ③：够 3 秒 ⇒ 放行')
assert.equal(view.FORCE_LABEL, '强制刷新', 'FIX-96 ①：按钮标签')
assert.equal(view.REFRESH_LABEL, '↻ 刷新', 'FIX-96 ⑤：旧按钮标签不变')
assert.ok(view.FORCE_HINT.includes('audit_scan') && view.FORCE_HINT.includes('会改磁盘上的快照'), 'FIX-96 ⑤：强制刷新的 tooltip 写明"等同主代理 audit_scan、会改磁盘"')
assert.ok(view.REFRESH_HINT.includes('只重读') && view.REFRESH_HINT.includes('不动数据'), 'FIX-96 ⑤：「↻ 刷新」写明只重读、不动数据')
assert.equal(view.FORCE_RUNNING_TEXT, '正在跑…', 'FIX-96 ③：进行中按钮上写"正在跑…"')
assert.ok(clientSource.includes('disabled: forcing'), 'FIX-96 ③：进行中要**禁用**按钮')
assert.ok(clientSource.includes('if (forcing) return'), 'FIX-96 ③：进行中再点直接忽略（防连点）')
assert.ok(clientSource.includes("onClick: () => { loadAll() }"), 'FIX-96 ⑤：「↻ 刷新」的行为不变（仍是只重读）')
assert.ok(clientSource.includes("postTodo({ path: todoPath, action: 'force-refresh' })"), 'FIX-96 ①：按钮走的是宿主那条写路由的同一个动作面')
assert.ok(clientSource.includes('agent-contract-force-note'), 'FIX-96 ④：进行中/失败那一行要**真的渲染**')
assert.ok(clientSource.includes('强制刷新失败'), 'FIX-96 ④：失败要在面板上写出来（不许静默）')
assert.ok(clientSource.includes('void loadAll()'), 'FIX-96 ③：成功后**立刻重读**（不必等下一拍轮询）')
// ⑥ 占位文案把"人自己那条路"与"求主代理"并列给出
assert.ok(f95Action.includes('强制刷新') && f95Action.includes('audit_scan'), 'FIX-96 ⑥：占位文案里两条路并列')
assert.ok(f95Action.indexOf('强制刷新') < f95Action.indexOf('audit_scan'), 'FIX-96 ⑥：先给"你自己就能做的那一步"，再说"求主代理"')
assert.ok(view.AUDIT_PLACEHOLDER_HINT.includes('强制刷新'), 'FIX-96 ⑥：client 兜底文案同样指向它')
assert.equal(/forceThrottle|forceResultText/.test(f96Handler.toString()), false, 'sanity：宿主侧不掺 client 逻辑')
ok('FIX-96 面板「强制刷新」：一键 = 跑审计 + 重写面板数据（与 `audit_scan`、启动自愈**三处同源**：同一个 `refreshPanel`）· 成功即快照换版本标记 + 审计不再是占位 + 回执"红 N / 黄 M 已重写" + 立刻重读 · 进行中禁用/文案"正在跑…"/3 秒防连点 · 四种失败（审计抛错·store 未绑·无实现·快照写失败）都带 code 与原因可见 · 白名单与 Host 栅栏照旧 · 「↻ 刷新」仍只重读')

// ---------------------------------------------------------------- FIX-100 绕过契约的派单要能被检测；确需绕过先提权（软限制 + 留痕）
const f100Root = await mkdtemp(join(tmpdir(), 'ac-fix100-'))
const f100Cfg = plugin.Config({ project: { root: f100Root }, audit: { checks: ['uncontracted_dispatch'] } })
const f100Project = resolveProject(f100Cfg)
const f100Store = await createLedger(makeCtx().ctx, 'fix100').ready
const f100Now = Date.parse('2026-10-04T10:00:00.000Z')
// ① 会话树里有、台账里没有 ⇒ 报黄（真机样本：那批"绕过契约派出去的研究型子代理"）
const f100Sessions = [
  { id: 'sub-a', parentSession: 'session-P', createdAt: '2026-10-04T09:00:00.000Z', cwd: f100Root },
  { id: 'sub-b', parentSession: 'session-P', createdAt: '2026-10-04T09:05:00.000Z', cwd: f100Root },
]
await f100Store.putMember(memberRecord({ id: 'sub-b', name: 'T-100-researcher', role: 'researcher', mode: 'one-shot', status: 'completed', layer: 1, parent: '主代理', parentSessionId: 'session-P' }))
const f100Audit = await auditScan({
  store: f100Store, project: f100Project, config: f100Cfg, now: f100Now, sessions: f100Sessions,
})
const f100Hits = f100Audit.items.filter((item) => item.check === 'uncontracted_dispatch')
assert.equal(f100Hits.length, 1, 'FIX-100 ①：会话树里有、台账里没有 ⇒ **报出**（台账里那条不算）')
assert.equal(f100Hits[0].target, 'sub-a', 'FIX-100 ①：报的是那个没记账的子会话')
assert.equal(f100Hits[0].level, 'yellow', 'FIX-100 ①：按黄报（警告制）')
assert.ok(f100Hits[0].detail.includes('session-P'), 'FIX-100 ①：报出能拿到的信息（父会话 id）')
assert.ok(f100Hits[0].detail.includes('2026-10-04T09:00:00.000Z'), 'FIX-100 ①：并带上时间')
assert.ok(f100Hits[0].detail.includes('contract_request_escalation'), 'FIX-100 ①③：建议里写明"确需绕过先提权"')
assert.equal(f100Audit.level, 'yellow', 'sanity：黄不算红')
// ④ 正常走契约派单 ⇒ **零误报**（台账里有对应成员记录的都跳过）
const f100CleanSessions = [{ id: 'sub-b', parentSession: 'session-P', createdAt: '2026-10-04T09:05:00.000Z', cwd: f100Root }]
const f100Clean = await auditScan({ store: f100Store, project: f100Project, config: f100Cfg, now: f100Now, sessions: f100CleanSessions })
assert.equal(f100Clean.items.some((item) => item.check === 'uncontracted_dispatch'), false, 'FIX-100 ④：台账里有记录的（走契约派的）**零误报**')
// ③ 提权工具：留痕（台账 + 体检看得见），作用域内不再报黄
const f100Ctx = makeCtx()
plugin.apply(f100Ctx.ctx, f100Cfg)
await f100Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f100Domains = {}
for (const [key, spec] of Object.entries(DOMAIN_SPECS)) f100Domains[key] = f100Ctx.ctx.storageDomain.opened.get(spec.name)
const f100Tool = f100Ctx.mine.find((tool) => tool.name === 'contract_request_escalation')
assert.ok(f100Tool, 'FIX-100 ②：提权工具已注册')
assert.ok(/必须走|contract_delegate_\*/.test(f100Tool.description), 'FIX-100 ③：工具描述写明硬规矩（派单走契约工具）')
assert.ok(f100Tool.description.includes('uncontracted_dispatch'), 'FIX-100 ③：并写明"绕过会被审计报出"')
const f100EscalationAgent = { id: 'lead', session: { header: { id: 'session-P', delegationDepth: 0 } } }
const f100Req = await f100Tool.execute({ reason: '宿主报 unknown tool，契约通道暂时不可用', scope: 'session' }, { agent: f100EscalationAgent, signal: new AbortController().signal })
assert.equal(f100Req.ok, true, 'FIX-100 ②：提权成功')
assert.equal(f100Req.escalation.scope, 'session', 'FIX-100 ②：作用域默认/显式生效')
assert.ok(f100Req.receipt.includes('已记下提权'), 'FIX-100 ②：回执确认')
// 工具写的是**解析器推出来的项目键**（配置没写项目名 ⇒ 按目录名推）⇒ 读的时候要用同一个键喵
const f100ToolStore = createStore(f100Domains, projectSlugOf(deriveProjectName(f100Root)))
assert.equal(f100ToolStore.listEscalations().length, 1, 'FIX-100 ②：**留痕**（台账里真的有一条提权记录）')
assert.ok(f100ToolStore.listEscalations()[0].reason.includes('unknown tool'), 'FIX-100 ②：理由原样记下')
// ② 提权后**同一作用域内**再派 ⇒ 标「已提权」、不再报黄（最多 info）
// 造一条**时间可控**的提权记录（工具那条用的是真实时钟，没法拿来断时间序）喵
const f100CoverStore = await createLedger(makeCtx().ctx, 'fix100b').ready
await f100CoverStore.putEscalation(escalationRecord({ sessionId: 'session-P', reason: '宿主报 unknown tool，临时放行', scope: 'session', createdAt: '2026-10-04T08:00:00.000Z' }))
const f100Covered = await auditScan({ store: f100CoverStore, project: f100Project, config: f100Cfg, now: f100Now, sessions: f100Sessions })
assert.equal(f100Covered.items.filter((item) => item.check === 'uncontracted_dispatch' && item.level === 'yellow').length, 0, 'FIX-100 ②：提权后（含它之后派出的）**不再报黄**')
assert.ok(f100Covered.items.some((item) => item.check === 'uncontracted_dispatch' && item.level === 'info' && item.detail.includes('已提权')), 'FIX-100 ②：改成标「已提权」（最多 info，不计红黄）')
assert.equal(f100Covered.level, 'green', 'FIX-100 ②：全被覆盖时审计回到绿')
// ③ 提权**之前**派出去的照旧报黄（提权管不了它之前的事）
const f100LateStore = await createLedger(makeCtx().ctx, 'fix100c').ready
await f100LateStore.putEscalation(escalationRecord({ sessionId: 'session-P', reason: '迟到才提的权', scope: 'session', createdAt: '2026-10-04T09:30:00.000Z' }))
const f100Late = await auditScan({ store: f100LateStore, project: f100Project, config: f100Cfg, now: f100Now, sessions: f100Sessions })
assert.ok(f100Late.items.some((item) => item.check === 'uncontracted_dispatch' && item.level === 'yellow'), 'FIX-100 ③：提权**之前**派出去的照旧报黄（时间判据）')
assert.ok(f100Late.items.some((item) => item.check === 'uncontracted_dispatch' && item.detail.includes('已提权')) === false, 'FIX-100 ③：那些子会话不该被标"已提权"')
// ③-b `until` 到期 ⇒ 该条提权失效（重新报黄）
const f100UntilStore = await createLedger(makeCtx().ctx, 'fix100d').ready
await f100UntilStore.putEscalation(escalationRecord({ sessionId: 'session-P', reason: '临时放行', scope: 'session', createdAt: '2026-10-04T08:00:00.000Z', until: '2026-10-04T09:30:00.000Z' }))
const f100UntilOk = await auditScan({ store: f100UntilStore, project: f100Project, config: f100Cfg, now: Date.parse('2026-10-04T09:00:00.000Z'), sessions: f100Sessions })
assert.equal(f100UntilOk.items.some((item) => item.check === 'uncontracted_dispatch' && item.level === 'yellow'), false, 'FIX-100 ③：`until` 未到期 ⇒ 仍然覆盖')
const f100UntilExpired = await auditScan({ store: f100UntilStore, project: f100Project, config: f100Cfg, now: Date.parse('2026-10-04T10:00:00.000Z'), sessions: f100Sessions })
assert.ok(f100UntilExpired.items.some((item) => item.check === 'uncontracted_dispatch' && item.level === 'yellow'), 'FIX-100 ③：`until` 到期 ⇒ 提权失效（重新报黄）')
// ③-c `scope: 'task'` 要 taskId 对得上（对不上照样报黄）
const f100TaskStore = await createLedger(makeCtx().ctx, 'fix100e').ready
await f100TaskStore.putEscalation(escalationRecord({ sessionId: 'session-P', reason: '本任务放行', scope: 'task', taskId: 'T-777', createdAt: '2026-10-04T08:00:00.000Z' }))
const f100TaskMiss = await auditScan({ store: f100TaskStore, project: f100Project, config: f100Cfg, now: f100Now, sessions: f100Sessions })
assert.ok(f100TaskMiss.items.some((item) => item.check === 'uncontracted_dispatch' && item.level === 'yellow'), 'FIX-100 ③：`scope: task` 但 taskId 对不上 ⇒ 不覆盖（照旧报黄）')
// ③-b 提权在体检回执里查得到
const f100Status = await f100Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
assert.ok(f100Status.escalations.count >= 1, 'FIX-100 ②③：`contract_status` 能查到提权记录')
assert.ok(String(f100Status.escalations.last.reason).includes('unknown tool'), 'FIX-100 ②：最近一条提权的理由带出来')
const f100StatusText = f100Ctx.mine.find((tool) => tool.name === 'contract_status').output.render({}, f100Status)[0].text
assert.ok(f100StatusText.includes('提权申请'), 'FIX-100 ②：回执里打「提权申请」这一行')
assert.ok(f100StatusText.includes('contract_delegate_') || f100StatusText.includes('contract_request_escalation'), 'FIX-100 ③：体检里也写明"派单走契约工具"的硬规矩')
// ④ 契约工具不可用时的报错要写全：为什么 + 替代路径（含"先提权"）
const f100Failure = delegationFailure(new Error('unknown tool: contract_delegate_librarian'), getRole({}, 'librarian'))
assert.ok(String(f100Failure.message).includes('unknown tool'), 'FIX-100 ④：带上宿主原话')
assert.ok(String(f100Failure.message).includes('contract_request_escalation'), 'FIX-100 ④：给出"确需绕过先提权"这条替代路径')
assert.ok(String(f100Failure.message).includes('完整重启应用'), 'FIX-100 ④：也给出"工具链整体报错 ⇒ 重启"这条')
assert.ok(String(f100Failure.message).includes('uncontracted_dispatch'), 'FIX-100 ④：并说清绕过会被审计报出')
ok('FIX-100 绕过契约要被检测 + 先提权：会话树与台账**差集** ⇒ `uncontracted_dispatch`（黄，带父会话与时间，建议先提权）· 台账里有记录的**零误报** · `contract_request_escalation` 留痕（台账 + 体检"提权申请"行 + 回执确认）· 提权后同作用域标「已提权」（info、不计红黄）· 提权**之前**派出去的与 `until` 过期的照旧报黄 · 契约工具报错时给出"为什么 + 四条替代路径（含先提权 + 重启）"')

// ---------------------------------------------------------------- FIX-101/102/103/104 规范单一来源 + 索引 + 续派只发切片
// 【用户硬要求】doc_census · 各类索引 · 派生态索引 · 契约「文档规范」段 —— 四处必须取自**同一份**派生/装配结果
const f110ToolsSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
const f110IdxSrc = await readFile(new URL('./src/librarian/indexes.js', import.meta.url), 'utf8')
const f110StatusSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
assert.ok(/docSpecLines\(/.test(f110StatusSrc), 'FIX-101 ②：`contract_status` 的规范段取自 `docSpecLines()`')
assert.ok(/docSpecLines\(\{ project: projectView \}\)/.test(await readFile(new URL('./src/contract/assemble.js', import.meta.url), 'utf8')), 'FIX-101 ②：契约的规范段**调用同一个** `docSpecLines()`（单一来源）')
assert.ok(/documentCensus\(/.test(f110ToolsSrc) && /documentCensus\(/.test(f110IdxSrc), 'FIX-102/103：`doc_census` 与各类索引都取 `documentCensus()`（同一份普查，不各扫一遍盘）')
assert.ok(/from '\.\.\/ledger\/census\.js'/.test(f110IdxSrc) && /from '\.\/ledger\/census\.js'/.test(f110ToolsSrc), 'FIX-102/103：两边 import 的是同一个模块')
// 101：契约里"本轮解析结果"给的是**绝对路径** + 权威顺序 + 目标绝对路径（librarian_relocate 支持给类别自动定目标）
const f110Cfg = plugin.Config({ project: { root: root }, paths: { deliverablesDir: '仓库/docs/产出' } })
const f110Project = resolveProject(f110Cfg)
const f110Lines = resolvedPathsLines({ project: f110Project, globalFiles: '全局共享：坑库索引' })
assert.ok(f110Lines.join('\n').includes(f110Project.tempDir), 'FIX-101 ①：本轮解析结果里 tempDir 是**绝对路径**')
assert.ok(f110Lines.join('\n').includes('权威顺序'), 'FIX-101 ①：并写明权威顺序（① 契约 ② 显式配置 ③ 探测）')
assert.ok(f110Lines.join('\n').includes('project.json'), 'FIX-101 ①：点名 `project.json` 是派生物、冲突以契约为准')
assert.ok(f110Lines.join('\n').includes('标注这处不一致'), 'FIX-101 ③：不一致的处置写清（执行 + 标注上报）')
assert.ok(f110Lines.join('\n').includes('坑库索引'), 'FIX-101 ②：全局共享文件清单也进契约')
assert.ok(/必然读源码|不必读插件源码/.test(getRole({}, 'librarian').persona), 'FIX-101 ④：馆员角色卡写明"不必读插件源码"')
assert.ok(/doc_census/.test(getRole({}, 'librarian').persona), 'FIX-102 ②：馆员角色卡写明"先 doc_census、不要读全文"')
// 102：`doc_census` 形状 + 过滤生效
const f110Ctx = makeCtx()
plugin.apply(f110Ctx.ctx, cfg)
await f110Ctx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
const f110Tool = f110Ctx.mine.find((tool) => tool.name === 'doc_census')
assert.ok(f110Tool, 'FIX-102 ①：`doc_census` 已注册')
const f110Out = await f110Tool.execute({ limit: 3 }, { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal })
assert.ok(Array.isArray(f110Out.fields) && f110Out.fields.includes('legacy') && f110Out.fields.includes('archived') && f110Out.fields.includes('needsLibrarian'), 'FIX-102 ①：字段表含 legacy / archived / 待办码')
assert.ok(f110Out.counts && typeof f110Out.counts === 'object', 'FIX-102 ①：按类别给篇数')
const f110Filtered = await f110Tool.execute({ kind: '研究', legacy: false }, { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal })
assert.equal(f110Filtered.rows.every((row) => row.kind === '研究' && row.legacy === false), true, 'FIX-102 ③：kind / legacy 过滤生效')
// 103：八类各一份索引（同一份普查渲染）；幂等；缺口能被审计报出来
const f110IdxRoot = await mkdtemp(join(tmpdir(), 'ac-kindidx-'))
const f110IdxCfg = plugin.Config({ project: { root: f110IdxRoot }, paths: { deliverablesDir: '仓库/docs/产出', docKinds: { 研究: '仓库/docs/研究', 产出档: '仓库/docs/产出' } } })
const f110IdxProject = { ...resolveProject(f110IdxCfg) }
await mkdir(joinUnderRoot(f110IdxRoot, '仓库/docs/研究'), { recursive: true })
await writeFile(joinUnderRoot(f110IdxRoot, '仓库/docs/研究/T-1_甲_研究.md'), '## 结论\n\n甲喵。\n', 'utf8')
const f110Census = await documentCensus({ project: f110IdxProject })
const f110Write = await writeKindIndexes({ project: f110IdxProject, census: f110Census, dryRun: false, now: 't' })
const f110Research = f110Write.files.find((row) => row.kind === '研究')
assert.equal(f110Research.wrote, true, 'FIX-103 ①：类别目录下写出 `索引.md`')
assert.equal(f110Research.items, 1, 'FIX-103 ②：条目数 = 该类磁盘篇数')
const f110Again = await writeKindIndexes({ project: f110IdxProject, census: f110Census, dryRun: false, now: 't' })
assert.equal(f110Again.files.find((row) => row.kind === '研究').wrote, false, 'FIX-103 ③：两遍**幂等**（内容没变就不写）')
const f110IndexText = await readFile(joinUnderRoot(f110IdxRoot, '仓库/docs/研究/索引.md'), 'utf8')
assert.ok(f110IndexText.includes('机器区块'), 'FIX-103 ②：区块标明"由派生器生成、只在本区块内增删"')
assert.ok(f110IndexText.includes('T-1_甲_研究.md'), 'FIX-103 ②：条目含路径（与 doc_census 同一份渲染）')
const f110GapsAfter = await kindIndexGaps({ project: f110IdxProject, census: f110Census })
assert.equal(f110GapsAfter.length, 0, 'FIX-103 ④：写完就没有缺口')
await writeFile(joinUnderRoot(f110IdxRoot, '仓库/docs/研究/索引.md'), '# 手写的空索引\n', 'utf8')
const f110Gaps = await kindIndexGaps({ project: f110IdxProject, census: f110Census })
assert.equal(f110Gaps.length, 1, 'FIX-103 ④：索引被清空 ⇒ 缺口报出来（条目数不符/缺索引）')
assert.ok(String(f110Gaps[0].reason).includes('不符') || String(f110Gaps[0].reason).includes('没有索引'), 'FIX-103 ④：原因说清是"缺"还是"不符"')
// 104：续派只发切片 / 首次仍发完整契约 / 指纹变化才补发
const f104Slice = renderContinuationSlice({ taskId: 'T-9', brief: '只搬研究档', taskFile: 'X:\\任务\\T-9.md', fingerprint: 'a' })
assert.ok(f104Slice.text.includes('本轮任务切片') && f104Slice.text.includes('T-9'), 'FIX-104 ①：续派消息是任务切片')
assert.equal(f104Slice.text.includes('### 角色卡：'), false, 'FIX-104 ①：不含角色卡段')
assert.equal(f104Slice.text.includes('### [1] 总纲'), false, 'FIX-104 ①：不含总纲段')
assert.ok(f104Slice.text.includes('沿用本会话开头那份契约'), 'FIX-104 ①：明说"沿用开头那份契约"')
assert.equal(f104Slice.updated, false, 'FIX-104 ②：没给上次指纹 ⇒ 不判"契约已更新"')
const f104Updated = renderContinuationSlice({ taskId: 'T-9', brief: 'x', previousFingerprint: 'old', fingerprint: 'new', specText: '新规范' })
assert.equal(f104Updated.updated, true, 'FIX-104 ②：指纹变了 ⇒ 标"契约已更新"')
assert.ok(f104Updated.text.includes('契约已更新') && f104Updated.text.includes('新规范'), 'FIX-104 ②：并带上变化段（规范段）')
assert.ok(f104Updated.changedSegments.length > 0, 'FIX-104 ②：说清变了哪几段')
const f104Big = renderContinuationSlice({ taskId: 'T-9', brief: '喵'.repeat(3000) })
assert.ok(f104Big.chars <= 2100, `FIX-104 ⑤：切片长度受**任务切片预算**约束（实际 ${f104Big.chars}）`)
assert.ok(f104Big.text.includes('裁剪') === false || f104Big.chars < 2100, 'FIX-104 ⑤：超硬限即裁剪（不把整段 brief 塞进去）')
ok('FIX-101/102/103/104 单一来源 + 索引 + 续派只发切片：契约里给「文档规范 + 本轮解析结果（绝对路径）+ 权威顺序 + 目标绝对路径 + 全局共享文件」，与 `contract_status` **同一个 `docSpecLines()`** · `doc_census` 与各类索引都取**同一份** `documentCensus()` · 八类各一份 `索引.md`（机器区块、幂等、缺口可审计）· 续派只发任务切片（不含总纲/角色卡），指纹变了才补发「契约已更新 + 变化段」，切片受 brief 预算约束')

// ---------------------------------------------------------------- FIX-105 sweep 给任务卡补全 null 的 YAML 头（真机污染 23 张）
// ① **无头文件**（任务卡样本）：引用修复只改指向性内容 ⇒ 除引用目标外**字节不变**，尤其不许新增 `---` 块
const f105Card = '## 结论\n\n相关：docs/研究/旧名_研究.md 这一处要改。\n'
const f105CardNext = composeRewrittenFile({
  path: 'X:\\proj\\任务\\T-1.md',
  originalText: f105Card,
  parsed: { meta: {}, body: f105Card },
  nextBody: f105Card.split('docs/研究/旧名_研究.md').join('docs/研究/新名_研究.md'),
  changes: ['引用修复（指向现存档）'],
  project: resolveProject(cfg),
  stampIso: 't',
})
assert.equal(f105CardNext.text.includes('---'), false, 'FIX-105 ①：**不许**给无头文件补 front-matter（真机 23 张卡就是这么被污染的）')
assert.equal(f105CardNext.text.includes('librarianTouchedAt'), false, 'FIX-105 ④：留痕是**台账**属性，不写在被改文件里')
assert.equal(f105CardNext.text, f105Card.split('docs/研究/旧名_研究.md').join('docs/研究/新名_研究.md'), 'FIX-105 ①：除引用目标外**字节级不变**')
assert.equal(f105CardNext.text.split('\n').length, f105Card.split('\n').length, 'FIX-105 ④：行数不变')
// ② 有头**文档**：只改目标键，其余键与顺序保持（并且照旧盖留痕）
const f105DocMeta = { taskId: 'T-2', role: 'researcher', tier: 3, keywords: ['甲'], relatedFiles: ['a.md'], createdAt: '2026-01-01T00:00:00.000Z' }
const f105Doc = `${renderFrontMatter(f105DocMeta)}## 结论\n\n相关：a.md\n`
const f105DocNext = composeRewrittenFile({
  path: joinUnderRoot(cfg.project.root, '仓库/docs/产出/L3/T-2_x_L3.md'),
  originalText: f105Doc,
  parsed: { meta: { ...f105DocMeta, relatedFiles: ['b.md'] }, body: '## 结论\n\n相关：a.md\n' },
  nextBody: '## 结论\n\n相关：b.md\n',
  changes: ['引用修复（指向现存档）'],
  project: resolveProject(cfg),
  stampIso: 't',
})
assert.equal(f105DocNext.stamped, true, 'FIX-105 ②：有内容的头照旧盖留痕（文档类）')
assert.ok(f105DocNext.text.indexOf('taskId:') < f105DocNext.text.indexOf('role:'), 'FIX-105 ②：其余键的**顺序**不变')
assert.ok(f105DocNext.text.includes('b.md') && f105DocNext.text.includes('taskId: T-2'), 'FIX-105 ②：只改该改的键、其余保持')
// ③ 全 null 的头：**不改写头**（真机那 23 张卡的形态）—— 头部逐字保留、只改正文
const f105NullHeader = '---\ntaskId: null\nrole: null\ntier: null\nkeywords: null\nrelatedFiles: null\ncreatedAt: null\nlibrarianTouchedAt: 2026-10-03T16:38:07.512Z\nlibrarianChanges: ["引用修复（指向现存档）"]\n---\n\n## 结论\n\n相关：a.md\n'
const f105NullParsed = parseFrontMatter(f105NullHeader)
const f105NullNext = composeRewrittenFile({
  path: 'X:\\proj\\任务\\T-3.md',
  originalText: f105NullHeader,
  parsed: { meta: f105NullParsed.meta, body: f105NullParsed.body },
  nextBody: f105NullParsed.body.split('a.md').join('b.md'),
  changes: ['引用修复（指向现存档）'],
  project: resolveProject(cfg),
  stampIso: 't2',
})
assert.equal(f105NullNext.stamped, false, 'FIX-105 ③：全 null 的头**不改写**（不再为了写留痕去动它）')
assert.equal(f105NullNext.text.startsWith(f105NullHeader.slice(0, f105NullHeader.indexOf('## 结论'))), true, 'FIX-105 ③：头部逐字保留')
assert.ok(f105NullNext.text.includes('b.md'), 'FIX-105 ③：正文里的引用照旧修好')
assert.equal((f105NullNext.text.match(/librarianTouchedAt/g) || []).length, 1, 'FIX-105 ③：不叠新的留痕行（头原样）')
ok('FIX-105 写回既有文件时的头部纪律：**无头文件一律不补 front-matter**（除引用目标外字节不变、行数不变）· 有内容的头照旧盖留痕且其余键与顺序不变 · **全 null 的头不改写**（真机 23 张任务卡的污染形态）· 留痕属台账属性，不为它给文件加头 · 搬移/归位的引用改写同走这一份纪律')

// ---------------------------------------------------------------- FIX-97 版本漂移可见 + 领域打不开不许静默（真机："工具全废"却没人知道去看版本）






// ① 运行版本 vs 磁盘版本：两者不一致 ⇒ contract_status 必须明说"完整重启应用"
assert.equal(versionDrift().loaded, pkgVersion, 'FIX-97 ①：加载期版本 = 磁盘版本（正常运行时两者一致）')
assert.equal(versionDrift().drift, false, 'FIX-97 ①：正常运行时没有漂移')
const f97Status = await f96PluginCtx.mine.find((tool) => tool.name === 'contract_status').execute({}, { signal: new AbortController().signal })
assert.equal(f97Status.plugin.version, pkgVersion, 'FIX-97 ①：`contract_status` 照旧报磁盘版本')
assert.ok(f97Status.plugin.loaded, 'FIX-97 ①：**同时**报"进程里正在跑的版本"')
assert.equal(f97Status.plugin.drift, false, 'FIX-97 ①：字段里带漂移判定（面板与 agent 都能直接读）')
const f97StatusText = f96PluginCtx.mine.find((tool) => tool.name === 'contract_status').output.render({}, f97Status)[0].text
assert.ok(f97StatusText.includes('插件版本'), 'FIX-97 ①：回执首行仍是版本号')
assert.ok(f97StatusText.includes('启动自愈'), 'FIX-97 ③：回执里带"同步器有没有挂上"的留痕')
// 用**人造漂移**验证那条提示文案（不能真去改磁盘版本）：直接喂一个 drift=true 的值
const f97DriftView = clientSource.includes('⚠ **版本漂移**') || f97StatusText.length > 0
assert.ok(f97DriftView, 'sanity')
const f97ToolsSrc = await readFile(new URL('./src/tools.js', import.meta.url), 'utf8')
assert.ok(/value\.plugin\.drift/.test(f97ToolsSrc) && f97ToolsSrc.includes('完整重启应用'), 'FIX-97 ①：漂移时回执要写出「请**完整重启应用**（只刷新窗口/页面不算）」')
// ①-b 面板侧：快照带 `runtimeVersion`，写入进程 ≠ 磁盘 ⇒ 面板给"完整重启"的话
const f97Snap = buildPanelSnapshot({ store: f96Store, project: f96Project, audit: null, now: 't' })
assert.equal(f97Snap.runtimeVersion, pkgVersion, 'FIX-97 ①：快照带**写入进程的版本**（与现读磁盘的 pluginVersion 可比）')
assert.equal(view.versionDriftNote({ pluginVersion: pkgVersion, runtimeVersion: pkgVersion }), null, 'FIX-97 ①：两者一致 ⇒ 没有漂移提示')
assert.ok(String(view.versionDriftNote({ pluginVersion: '9.9.9', runtimeVersion: '0.0.1' })).includes('完整重启应用'), 'FIX-97 ①：两者不一致 ⇒ 面板明说"完整重启应用"')
assert.ok(String(view.versionDriftNote({ pluginVersion: '9.9.9', runtimeVersion: '0.0.1' })).includes('版本漂移'), 'FIX-97 ①：文案里点明"版本漂移"（用户才知道去看版本）')
// ③ 领域打不开 ⇒ 工具回执带**宿主原话 + 处置建议**（不是哑掉）
const f97Project = { ...f96Project }
// 台账领域打不开的样子：`ledger.ready` reject（真机原话就是这句 invalid-record）喵
// 先给这个 promise 挂一个"占位"处理器：否则在 Node 看来它是**未处理的 rejection**（会在测试末尾炸出来）喵
const f97LedgerDown = Promise.reject(new Error("domain 'agent_contract_members': stored record 'x' does not match its schema"))
void f97LedgerDown.catch(() => {})
const f97Resolver = createProjectResolver({
  ctx: f96PluginCtx.ctx, config: f96Cfg,
  ledger: { ready: f97LedgerDown },
  projects: createProjectRegistry(),
})
let f97ToolError = null
try {
  await f97Resolver({ agent: { session: { header: { cwd: f96Root } } } }, { ensure: false })
} catch (error) {
  f97ToolError = String(error && error.message)
}
assert.ok(f97ToolError && f97ToolError.includes('台账领域打不开'), 'FIX-97 ③：失败要**点名**"台账领域打不开"')
assert.ok(f97ToolError.includes('does not match its schema'), 'FIX-97 ③：把**宿主原话**带出来（否则没法查）')
assert.ok(f97ToolError.includes('完整重启应用'), 'FIX-97 ③：给处置建议（第一条就是完整重启）')
assert.ok(f97ToolError.includes('contract_status'), 'FIX-97 ③：再给一步可执行的排查动作')
assert.ok(f97ToolError.includes('挪去备份'), 'FIX-97 ③：并说明宿主的兜底（坏记录会被挪去备份并跳过）')
// ③-b 面板侧：原因要**写进快照**（只动 notes/setupError，数据字段原样保留）
const f97AnnRoot = await mkdtemp(join(tmpdir(), 'ac-fix97-'))
await mkdir(joinUnderRoot(f97AnnRoot, '.agent-contract'), { recursive: true })
const f97AnnPath = panelSnapshotPath({ root: f97AnnRoot })
const f97Prev = {
  schemaVersion: PANEL_SNAPSHOT_SCHEMA_VERSION, generatedAt: 'old', pluginVersion: '0.17.0',
  counts: { members: 20, tasks: 57, docs: 116 }, members: { librarian: { name: 'librarian' } }, membersById: {},
  todos: [{ kind: 'task', title: '别把我抹掉' }], project: { name: 'P', root: f97AnnRoot },
  audit: { level: 'green', red: 0, yellow: 0, items: [] }, paths: { todoFile: joinUnderRoot(f97AnnRoot, '待办.md') }, notes: ['原有的说明'],
}
await writeFile(f97AnnPath, JSON.stringify(f97Prev, null, 2), 'utf8')
const f97Annotated = await annotatePanelSnapshot({ project: { root: f97AnnRoot, name: 'P' }, error: new Error('台账领域打不开（模拟）') })
assert.equal(f97Annotated.ok, true, 'FIX-97 ③：注释写盘成功')
const f97AnnSaved = JSON.parse(await readFile(f97AnnPath, 'utf8'))
assert.ok(String(f97AnnSaved.setupError.message).includes('台账领域打不开'), 'FIX-97 ③：`setupError` 写明原因（面板页面直说）')
assert.ok(f97AnnSaved.notes.some((row) => String(row).startsWith('插件自检异常：')), 'FIX-97 ③：notes 里也留一条（tooltip 可见）')
assert.deepEqual(f97AnnSaved.counts, f97Prev.counts, 'FIX-97 ③：**数据字段原样保留**（不许因为台账坏了就把旧数据抹掉）')
assert.equal(f97AnnSaved.members.librarian.name, 'librarian', 'FIX-97 ③：成员数据原样')
assert.equal(f97AnnSaved.todos.length, 1, 'FIX-97 ③：待办数据原样')
await annotatePanelSnapshot({ project: { root: f97AnnRoot, name: 'P' }, error: new Error('台账领域打不开（模拟）') })
const f97AnnAgain = JSON.parse(await readFile(f97AnnPath, 'utf8'))
assert.equal(f97AnnAgain.notes.filter((row) => String(row).startsWith('插件自检异常：')).length, 1, 'FIX-97 ③：重复注释不叠字（幂等）')
assert.ok(clientSource.includes('agent-contract-setup-error'), 'FIX-97 ③：面板上要**真的渲染**这条（不是只写进文件）')
assert.ok(clientSource.includes('versionDriftNote'), 'FIX-97 ①：面板渲染版本漂移提示')
// ④ 熔丝：领域声明允许宿主"备份并跳过"（宿主把那条记录挪走 + 打日志，而不是整个领域打不开）
for (const [kind, spec] of Object.entries(DOMAIN_SPECS)) {
  assert.equal(spec.invalidRecords, 'backup-and-skip', `FIX-97 ④：${kind} 领域允许"备份并跳过"（真机上熔丝没触发过 ⇒ 当时跑的是旧代码）`)
}
ok('FIX-97 版本漂移可见 + 领域打不开不静默：`contract_status` 同时报**运行版本与磁盘版本**（漂移 ⇒ "请完整重启应用，只刷新窗口不算"）· 快照带 `runtimeVersion` 供面板同一判定 · 台账领域打不开时工具回执带**宿主原话 + 三条处置建议** · 原因**写进每个工作区的快照**（只动 notes/setupError，数据字段原样保留、重复注释幂等）并在面板页面直说 · 三个领域都允许宿主"备份并跳过"坏记录')



const patchPath = process.argv[2]
if (!patchPath) {
  console.log('skip bundle patch 检查（未传 patch 路径）')
} else {
  try {
    const { parse } = await import('yaml')
    const doc = parse(await readFile(patchPath, 'utf8'))
    assert.ok(Array.isArray(doc), 'patch 顶层必须是数组')
    const entry = doc[0].insert[0]
    assert.equal(entry.id, 'agent-contract')
    assert.equal(entry.name, 'dsh-agent-contract')
    // ---- FIX-57：**跟项目解耦**的形状/一致性校验（不再写死 Blockdustry）----
    assert.deepEqual(toHost(checkProjectShape(entry.config)), [], '当前配置必须符合"项目形状"规则（值随项目、形状固定）')
    // ---- FIX-58：出厂配置必须是**零配置自适应**（不许留会把工作区推导覆盖掉的硬编码项目值）----
    assert.equal(entry.config.project, undefined, 'FIX-58：出厂配置不得写死 project.root/name（留空 = 跟随工作区）')
    assert.equal(entry.config.paths, undefined, 'FIX-58：出厂配置不得写死 paths.*（留空 = 按候选清单探测 / 探不到就新建默认结构）')
    assert.equal(entry.config.panel, undefined, 'FIX-58：出厂配置连 panel.todoFile 也不必写（默认 <项目根>/待办.md）')
    assert.ok(
      /project:\s*\n?\s*#|# project:/.test(await readFile(patchPath, 'utf8')),
      'FIX-58：取消注释即可"显式锁定项目"的示例必须留在文件里（写给未来的自己看）',
    )
    // ② 换任意项目仍要绿（同一套规则跑一个临时项目）
    const tempShape = {
      project: { name: '测试任务', root: await mkdtemp(join(tmpdir(), 'ac-shape-')) },
      paths: {
        tasksDir: 'tasks',
        progressDir: 'progress',
        deliverablesDir: 'docs/子agent',
        docsDirs: ['docs/研究', 'docs/审查', 'docs/整合清单', 'docs/坑', 'docs/修改', 'docs/核心数据库', 'docs/产出', 'docs/归档'],
        archiveDir: 'docs/归档',
        docKinds: { 研究: 'docs/研究', 审查: 'docs/审查', 整合清单: 'docs/整合清单', 坑: 'docs/坑', 修改: 'docs/修改', 核心数据库: 'docs/核心数据库', 产出档: 'docs/产出', 归档: 'docs/归档' },
      },
      delegation: { provider: 'spawn' },
      audit: { checks: [...CHECK_IDS], archiveAfterDays: 90 },
    }
    assert.deepEqual(toHost(checkProjectShape(tempShape)), [], 'FIX-57（验收②）：换个项目（目录名与结构都不同）必须同样通过')
    // ③ 故意制造不一致 → **必须红**（证明新校验有牙，不是摆设）
    const brokenKinds = JSON.parse(JSON.stringify(tempShape))
    brokenKinds.paths.docKinds.研究 = 'docs/不在检索范围内'
    assert.ok(
      toHost(checkProjectShape(brokenKinds)).some((row) => row.includes('docKinds.研究')),
      'FIX-57（验收③）：docKinds.研究 指向不在 docsDirs 的目录 ⇒ 必须报错',
    )
    const brokenArchive = JSON.parse(JSON.stringify(tempShape))
    brokenArchive.paths.archiveDir = 'docs/别处'
    assert.ok(
      toHost(checkProjectShape(brokenArchive)).some((row) => row.includes('archiveDir')),
      'FIX-57：archiveDir 不等于 docKinds.归档 ⇒ 必须报错',
    )
    // FIX-58 口径反转（写明不是放宽）：`project.root` **留空** = 自适应，合法 ⇒
    // 负例改成"配了个相对路径"（配了就必须绝对）喵
    const brokenRoot = JSON.parse(JSON.stringify(tempShape))
    brokenRoot.project.root = 'relative/项目'
    assert.ok(
      toHost(checkProjectShape(brokenRoot)).some((row) => row.includes('project.root')),
      'FIX-57：project.root 配了却不是绝对路径 ⇒ 必须报错',
    )
    const adaptiveShape = { project: { root: '' }, paths: {}, delegation: { provider: 'spawn' } }
    assert.deepEqual(
      toHost(checkProjectShape(adaptiveShape)), [],
      'FIX-58：**空配置 = 自适应模式**，形状校验必须放行（零配置是产品要求，不是漏配）',
    )
    const brokenKind = JSON.parse(JSON.stringify(tempShape))
    delete brokenKind.paths.docKinds.坑
    assert.ok(
      toHost(checkProjectShape(brokenKind)).some((row) => row.includes('docKinds 缺类别 坑')),
      'FIX-57：类别键集合固定（研究/坑/修改/核心数据库/产出档/归档），缺一个必须报',
    )
    const extraKind = JSON.parse(JSON.stringify(tempShape))
    extraKind.paths.docKinds.杂项 = 'docs/杂项'
    extraKind.paths.docsDirs.push('docs/杂项')
    assert.ok(
      toHost(checkProjectShape(extraKind)).some((row) => row.includes('未知类别')),
      'FIX-58：多出未知类别也要报（类别名固定，值随项目）',
    )
    // ⑤ 过渡源：**允许存在**，但存在就必须在 docsDirs 里；"迁移完成后移除"的纪律仍要写在文档里喵
    const withLegacy = JSON.parse(JSON.stringify(tempShape))
    withLegacy.paths.docsDirs.push('legacy/docs')
    assert.deepEqual(toHost(checkProjectShape(withLegacy)), [], 'FIX-57（验收⑤）：过渡源允许存在（只要它在 docsDirs 里）')
    const legacyOutside = JSON.parse(JSON.stringify(tempShape))
    legacyOutside.paths.docsDirs = legacyOutside.paths.docsDirs.filter((dir) => dir !== 'docs/产出')
    assert.ok(
      toHost(checkProjectShape(legacyOutside)).some((row) => row.includes('产出档')),
      'FIX-57：任何类别（含产出档）不在 docsDirs 里都要报',
    )
    // ⑥ 设计值不随项目变：预算 / 审计项 / 归档阈值 / 无密钥 / 无未注释 modelRoutes（这几条与项目无关）喵
    assert.equal(entry.config.delegation.provider, 'spawn')
    assert.equal(entry.config.modelRoutes, undefined, '裁决 B：配置文件里不得留未注释的 modelRoutes（volatile ⇒ 改了不生效）')
    assert.deepEqual(
      toHost(view.collectSecretPaths(entry.config, '')),
      [],
      '配置文件里不得出现密钥字段（key 在宿主 provider 账户里）',
    )
    assert.equal(entry.config.budgets.softLimit, 6000)
    assert.equal(entry.config.budgets.mandateHard, 2400)
    assert.equal(entry.config.audit.checks.length, 24, '设计值：审计项齐（FIX-103 起 24 项）')
    for (const id of ['doc_misfiled', 'doc_meta_missing', 'doc_tags_stale', 'archive_suggest']) {
      assert.ok(entry.config.audit.checks.includes(id), '审计项必须含 ' + id)
    }
    assert.equal(entry.config.audit.archiveAfterDays, 90)
    ok('cordis.patch.yml 可解析 + 项目形状一致性（FIX-57：换任意项目仍绿 / 制造不一致必红 / 设计值不随项目变）')
  } catch (error) {
    if (error && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND')) {
      console.log('skip bundle patch 检查（yaml 包不可用）')
    } else {
      throw error
    }
  }
}

await rm(root, { recursive: true, force: true })
console.log('ALL CHECKS PASSED')
