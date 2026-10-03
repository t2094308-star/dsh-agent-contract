/**
 * 馆员职责喵（DESIGN §5.8）喵。
 *
 * **本阶段边界（§5.8「分阶段边界」M2 行，勿越界）**：
 * 先自动化、馆员兜底 —— 元数据由 `derive.js` 机器派生，**只有 `needs_librarian` 非空才唤醒馆员**喵。
 * 馆员只做骨架：① 格式面巡检 + 直修（`fixer.js`，含留痕）② 需要判断的补全（限量试跑）喵。
 *
 * 两条硬纪律喵：
 * - **口径唯一**：唤醒闸门与 `--dryRun` 的条数都走 `scanNeedsLibrarian()`，不得各算一套喵。
 * - **失败隔离**：批量写遇单条失败只跳过并记录，不得整批 abort喵。
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { FIXED_SECTIONS, countChars, parseFrontMatter, renderFrontMatter } from '../ledger/docmeta.js'
import { deriveFromFile, expandKeywords, extractPaths, glossaryPath, isGenericKeyword, loadGlossary, scanNeedsLibrarian, sectionContent } from '../ledger/derive.js'
import { baseNameOf, listMarkdown, readFileIfPresent, listMarkdownDeep } from '../ledger/fs.js'
// FIX-69：类型归位 / `^` 前缀搬元数据 / 临时文件搬离（`scanDocAreas` 与检查项共用同一份扫描）喵
import { scanDocAreas, tierDirOf } from '../ledger/docarea.js'
import { extractKeywords } from '../contract/slices.js'
import { docFileName, kindFromFileName, memberName, slug, stripArchiveCaret, titleFromFileName } from '../ledger/naming.js'
import { commonAncestorOf, isUnder } from '../ledger/placement.js'
import { docRecord } from '../ledger/store.js'
import { joinUnderRoot } from '../project.js'
import { auditScan } from '../audit/report.js'
import { isTagsStale } from '../audit/checks.js'
import { backupPathOf, fingerprintText, planWrite, writeOutcome, writeWithBackup } from './backup.js'
// FIX-66：一轮治理结束时的**验收报告**（动作清单 / 正文零改动 / 引用残留 / 审计 diff）喵
import { auditDiff, auditSummary, collectActions, diffBodies, findReferenceLeftovers, snapshotBodies } from './verify.js'
import { diffStats, mergeIndexBlock } from './merge.js'
import { fixDoc, inspectDoc } from './fixer.js'

/** 核心数据库文件名（馆员自己的簿记文件，M4 会长出进度计数/行号/阻塞清单）喵。 */
/** 核心数据库**真身**文件名喵（FIX-26）喵：唯一权威，**只追加、不整篇重写**喵。 */
export const CORE_DB_FILE = '核心数据库.md'

/**
 * 派生态索引的**独立文件名**喵（FIX-26）喵。
 *
 * 不得复用真身文件名：实测出现过两份同名 `核心数据库.md`（真身 74KB 在 docs 根、
 * 派生物 20KB 在 `研究/`），而馆员的 changelog 写到了**副本**上、真身反而空白 ——
 * "哪个是真的"当场无法分辨喵。
 */
export const CORE_INDEX_FILE = '派生态索引.md'

/** 真身自述里必须出现的标记词（用来判"这份同名档有没有自述身份"）喵。 */
export const CORE_DB_IDENTITY = '真身'

/** 派生物头部必须**同时**出现的两个词（§9-27/34）喵。 */
export const DERIVED_MARKERS = ['派生物', '可重建']

/**
 * 变更日志的两个**子区**喵（§9-35）喵：真身是唯一历史账本，
 * 「迁移批次」与「文档治理记录」分开记 —— 只记结果不记动作会让历史断链喵。
 */
export const CORE_DB_SECTIONS = { migration: '迁移批次', governance: '文档治理记录' }

/** 新建真身时的骨架（第一行就要自述身份，免得又被当成派生副本）喵。 */
const CORE_DB_SKELETON = [
  '# 核心数据库',
  '',
  '> **真身·长期维护**（唯一权威）：本文件由图书管理员**追加**变更日志，绝不整篇重写；',
  '> 派生态索引在同目录的 `派生态索引.md`（派生物，可重建），两者不重名喵。',
  '',
  '## 变更日志',
  '',
  `### ${CORE_DB_SECTIONS.migration}`,
  '',
  `### ${CORE_DB_SECTIONS.governance}`,
  '',
  '',
].join('\n')

/** 跨平台取父目录（Windows 盘符路径在 POSIX 下 `dirname()` 会返回 `.`，所以自己拆）喵。 */
function parentDir(path) {
  const raw = String(path || '').replace(/[\\/]+$/, '')
  const index = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return index <= 0 ? raw : raw.slice(0, index)
}

/**
 * 核心数据库的**家目录**喵（FIX-26）喵。
 *
 * 优先用配置里的 `paths.docKinds['核心数据库']`（Blockdustry 配的是 `仓库/docs/核心数据库`）；
 * 没配才退回 `docsDirs` 的公共父目录（= docs 根，真身历史上就躺在那里）喵。
 */
export function coreDbDir(project) {
  const configured = project.docKinds && project.docKinds['核心数据库']
  if (configured) return configured
  const dirs = (Array.isArray(project.docsDirs) ? project.docsDirs : []).filter(Boolean)
  if (dirs.length > 1) {
    const common = commonAncestorOf(dirs)
    if (common) return common
  }
  return dirs[0] || project.deliverablesDir
}

/**
 * 核心数据库**真身**路径喵（FIX-26）喵。
 *
 * 迁移期两种布局都要认：MIGRATE 后真身在 `<家目录>/核心数据库.md`，
 * 迁移前它还躺在**家目录的父目录**（docs 根）上。两者都存在时以"已迁移"的那份为准（单调，不会来回跳）喵。
 */
export function coreDbPath(project) {
  const dir = coreDbDir(project)
  const moved = joinUnderRoot(dir, CORE_DB_FILE)
  if (existsSync(moved)) return moved
  const legacy = joinUnderRoot(parentDir(dir), CORE_DB_FILE)
  if (existsSync(legacy)) return legacy
  return moved
}

/** 派生态索引路径喵（FIX-26）：与真身**同目录但不同名**，绝不覆盖真身喵。 */
export function coreIndexPath(project) {
  return joinUnderRoot(coreDbDir(project), CORE_INDEX_FILE)
}

/** 坑库 README 索引路径喵（FIX-22 的预演清单里要能列到它）喵。 */
export function pitfallIndexPath(project) {
  const dir = (project.docKinds && project.docKinds['坑']) || (project.docsDirs && project.docsDirs[0])
  return dir ? joinUnderRoot(dir, 'README.md') : null
}

/** 头部是否自述了身份（真身 or 派生物）喵：判"无自述头部的同名档"用喵。 */
export function coreDbHasIdentity(text) {
  const head = String(text || '').slice(0, 400)
  return head.includes(CORE_DB_IDENTITY) || head.includes('派生物')
}

/**
 * 找出**错位的同名档**喵（FIX-26）喵。
 *
 * 馆员的同名副本就是被这个 bug 生成出来的：迁移期一律**只读不写** ——
 * 判定与上报归我们，清理归用户/迁移脚本；我们绝不碰它（`hasOwnIdentity=false` 的更不许碰）喵。
 */
export async function findStrayCoreDbs({ project, corePath = null }) {
  const truth = corePath || coreDbPath(project)
  const dirs = new Set()
  for (const dir of Array.isArray(project.docsDirs) ? project.docsDirs : []) if (dir) dirs.add(dir)
  for (const dir of Object.values(project.docKinds || {})) if (dir) dirs.add(dir)
  if (project.deliverablesDir) dirs.add(project.deliverablesDir)
  const strays = []
  for (const dir of dirs) {
    const candidate = joinUnderRoot(dir, CORE_DB_FILE)
    if (candidate === truth) continue
    let text = null
    try {
      text = await readFile(candidate, 'utf8')
    } catch {
      continue
    }
    strays.push({ path: candidate, hasOwnIdentity: coreDbHasIdentity(text) })
  }
  return strays
}

/**
 * 「变更日志」标题的**宽容匹配**喵（FIX-26）喵。
 *
 * 实况：真身里那一节写的是 `## 九、变更日志（由执行方/馆员追加；历史行不改写）`——
 * 若只认字面 `## 变更日志`，就会在真身末尾**另起一个平行章节**，把一本账劈成两半喵。
 */
const LOG_HEADING_RE = /^#{1,6}[^\n]*变更日志[^\n]*$/m

/**
 * 把 changelog 行**增量**并进真身文本喵（纯函数，便于断言）喵。
 *
 * 三条铁律喵：① **只加行**，历史行一个字不改（`删行=0` 是验收项）；
 * ② 行落进对应**子区**（迁移批次 / 文档治理记录，§9-35）；③ 骨架缺哪段补哪段，重复调用幂等喵。
 * 标题一律**宽容匹配**：真身是人工维护的，标题写法不受我们摆布喵。
 */
export function appendCoreChangelog(text, entries, now, section = 'governance') {
  const lines = entries.map((entry) => `- ${now} ${entry}`)
  if (!lines.length) return String(text || '')
  const target = CORE_DB_SECTIONS[section] || CORE_DB_SECTIONS.governance
  let out = String(text || '')
  if (!out.trim()) out = CORE_DB_SKELETON
  if (!LOG_HEADING_RE.test(out)) out = `${out.trimEnd()}\n\n## 变更日志\n`
  for (const title of [CORE_DB_SECTIONS.migration, CORE_DB_SECTIONS.governance]) {
    if (!out.includes(`### ${title}`)) out = `${out.trimEnd()}\n\n### ${title}\n`
  }
  const marker = `### ${target}`
  const afterHeader = out.indexOf(marker) + marker.length
  const rest = out.slice(afterHeader)
  // 本子区的边界 = 后面最近的任何更低级标题（`###`/`##`）；没有就写到文末喵
  const stops = [rest.indexOf('\n### '), rest.indexOf('\n## ')].filter((index) => index >= 0)
  const stop = stops.length ? Math.min(...stops) : -1
  if (stop === -1) return `${out.trimEnd()}\n${lines.join('\n')}\n`
  const bucket = rest.slice(0, stop).trimEnd()
  return `${out.slice(0, afterHeader)}${bucket ? `${bucket}\n` : '\n'}${lines.join('\n')}\n${rest.slice(stop).replace(/^\n+/, '\n')}`
}

/**
 * 往核心数据库**真身**追加变更日志喵（FIX-26）喵。
 *
 * 曾经写在 `docsDirs[0]/核心数据库.md` —— 那是**派生物的位置**，于是 changelog 落到副本、
 * 真身反而空白。现在目标恒为 `coreDbPath()`（真身），并顺带回带错位同名档清单（只读不写）喵。
 */
export async function appendChangelog({ project, entries, now = new Date().toISOString(), section = 'governance' }) {
  const path = coreDbPath(project)
  if (!entries.length) return { path, appended: 0, section, strays: [] }
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    text = ''
  }
  const next = appendCoreChangelog(text, entries, now, section)
  // FIX-22 / §9-26：真身是既有档 → 追加前也先备份（追加虽温和，但"没退路"这三个字不能再出现）喵
  const written = await writeWithBackup({ project, path, text: next, stampIso: now })
  // FIX-34：`writeOutcome` 保证 `undefined` 不泄进回执（宿主会以"非无损 JSON"整条拒收）喵
  const outcome = writeOutcome(written)
  if (!outcome.ok) return { path, appended: 0, section, strays: [], ...outcome }
  return {
    path, appended: entries.length, section, ...outcome,
    strays: await findStrayCoreDbs({ project, corePath: path }),
  }
}

/** 相对项目根的短路径，用于报告与 changelog 喵。 */
function shortPath(project, path) {
  const rel = relative(project.root, path)
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : path
}

/**
 * 往核心数据库追加变更日志喵。
 * 改动产出档必须留这条痕（§5.8「直修留痕」强制）喵。
 * 实现见文件上方的 `appendChangelog`（FIX-26 起目标恒为**真身**）喵。
 */

/** 取同任务的关联档（用于三级档回贴绝对路径）喵。 */
function siblingsOf(store, doc) {
  if (!doc.taskId) return []
  return store.listDocs()
    .filter((other) => other.path !== doc.path && other.taskId === doc.taskId && other.tier >= 1 && other.tier <= 2)
    .sort((a, b) => b.tier - a.tier)
}

/** 给 front-matter 盖留痕章喵。 */
function stampTrace(meta, changes, now) {
  const previous = Array.isArray(meta.librarianChanges) ? meta.librarianChanges : []
  return { ...meta, librarianTouchedAt: now, librarianChanges: [...previous, ...changes] }
}

/**
 * 格式面巡检 + 直修喵。
 *
 * **上游闸门**：`scanNeedsLibrarian()`（扫磁盘现算）返回空则直接空转，
 * 不读不改任何档（省唤醒、省 token）。闸门管的是「要不要唤醒」，
 * 唤醒后按正常范围做格式直修；清单本身在报告里回带喵。
 */
export async function patrol({ project, store, taskId, limit = 20, now = new Date().toISOString() }) {
  const { items } = await scanNeedsLibrarian({ project })
  const queue = items.filter((item) => (taskId ? item.taskId === taskId : true))
  if (queue.length === 0) {
    return {
      gated: true,
      queue: [],
      inspected: 0,
      changed: 0,
      files: [],
      reportOnly: [],
      writeFailures: [],
      skippedLegacy: store.listDocs().filter((doc) => doc.legacy).length,
      changelog: { path: coreDbPath(project), appended: 0 },
    }
  }

  const candidates = store.listDocs()
    .filter((doc) => (taskId ? doc.taskId === taskId : true))
    .filter((doc) => !doc.legacy)
    .slice(0, limit)

  const report = { gated: false, queue, inspected: 0, changed: 0, files: [], reportOnly: [], writeFailures: [], skippedLegacy: 0 }
  const changelog = []

  for (const doc of candidates) {
    const file = await readFileIfPresent(doc.path)
    if (!file) continue
    report.inspected += 1
    const fixed = fixDoc({
      text: file.text,
      fileName: baseNameOf(doc.path),
      siblingDocs: siblingsOf(store, doc),
      taskId: doc.taskId,
      role: doc.owner,
      now,
    })
    if (fixed.changed) {
      // FIX-22 / §9-26：直修也是**改写既有档** → 先备份；备份失败则跳过这一篇（不许无退路地覆盖）喵
      const written = await writeWithBackup({ project, path: doc.path, text: fixed.text, stampIso: now })
      if (!written.ok) {
        report.writeFailures.push({
          target: doc.path, error: `备份失败，已跳过改写：${written.error}`,
        })
        continue
      }
      try {
        await store.putDoc(docRecord({ ...doc, chars: countChars(fixed.text) }))
        report.changed += 1
        report.files.push({ path: doc.path, changes: fixed.changes, backupPath: written.backupPath })
        changelog.push(`[格式直修] ${shortPath(project, doc.path)}：${fixed.changes.join('；')}`)
      } catch (error) {
        // 失败隔离：这一篇修不动就跳过，别把整轮巡检带塌喵
        report.writeFailures.push({ target: doc.path, error: String(error && error.message ? error.message : error) })
      }
    }
    for (const issue of fixed.remaining) {
      report.reportOnly.push({ path: doc.path, code: issue.code, detail: issue.detail })
    }
  }

  report.skippedLegacy = store.listDocs().filter((doc) => doc.legacy).length
  const logged = await appendChangelog({ project, entries: changelog, now })
  return { ...report, changelog: logged }
}

/**
 * 自动批量补元数据喵（**零模型调用**，DESIGN §5.5「批量入口」）喵。
 *
 * 直接扫产出目录（不依赖先前的 rebuild），对每篇：
 * 1. 跑派生器得到 front-matter 各字段
 * 2. 只补「缺的 / 空的」字段，**不覆盖已有的人工值**
 * 3. 写回文件 + 刷新台账 doc 记录 + 留痕 + changelog
 * 4. `needs_librarian` 报告**与唤醒闸门同一口径**（都用 `scanNeedsLibrarian()`）
 *
 * 只动元数据，**不补固定小节、不改文件名**（那是巡检与 M4 的事）喵。
 * @param args.limit - 最多处理几篇；缺省不限（全量）喵。
 * @param args.legacyOnly - 只处理存量旧档（`librarian_backfill` 的限量试跑用）喵。
 * @param args.dryRun - 只报告不落盘喵。
 */
export async function autoBackfill({ project, store, limit, legacyOnly = false, dryRun = false, now = new Date().toISOString() }) {
  const glossary = await loadGlossary(project)
  // 口径唯一：先按磁盘现状算一次，dryRun 与实跑的条数必然一致喵
  const { items: needsLibrarian } = await scanNeedsLibrarian({ project })
  const report = {
    glossary: { path: glossaryPath(project), terms: glossary.length },
    scanned: 0,
    attempted: 0,
    updated: 0,
    dryRun,
    files: [],
    writeFailures: [],
    needsLibrarian,
  }
  const changelog = []

  for (const name of await listMarkdownDeep(project.deliverablesDir)) {
    const path = joinUnderRoot(project.deliverablesDir, name)
    const file = await readFileIfPresent(path)
    if (!file) continue
    report.scanned += 1

    const { parsed, legacy, body, meta: parsedMeta, derived } = deriveFromFile({
      fileName: name, text: file.text, mtime: file.mtime, glossary,
    })
    if (legacyOnly && !legacy) continue
    if (limit !== undefined && report.attempted >= limit) break
    report.attempted += 1

    const meta = { ...parsedMeta }
    const changes = []
    for (const key of ['taskId', 'role', 'tier', 'createdAt']) {
      const current = meta[key]
      const value = derived[key]
      const missing = current === undefined || current === null || current === ''
      const usable = value !== undefined && value !== null && value !== ''
      // 只补「缺的且派生得出来的」，绝不覆盖已有的人工值，也不写空值喵
      if (missing && usable) {
        meta[key] = value
        changes.push(`补 ${key}`)
      }
    }
    if ((!Array.isArray(meta.keywords) || meta.keywords.length === 0) && derived.keywords.length) {
      meta.keywords = derived.keywords
      changes.push(`补 keywords（${derived.keywords.join('、')}）`)
    }
    if ((!Array.isArray(meta.relatedFiles) || meta.relatedFiles.length === 0) && derived.relatedFiles.length) {
      meta.relatedFiles = derived.relatedFiles
      changes.push(`补 relatedFiles（${derived.relatedFiles.length} 条）`)
    }

    const touched = changes.length > 0 && !dryRun
    if (changes.length) {
      report.updated += 1
      report.files.push({ path, changes })
    }

    let owner = null
    if (derived.taskId && derived.role) {
      try {
        owner = memberName(derived.taskId, derived.role)
      } catch {
        owner = null
      }
    }
    try {
      if (touched) {
        const next = renderFrontMatter(stampTrace(meta, changes, now)) + body.replace(/^\n+/, '')
        // FIX-22 / §9-26：回填同样是**改写既有档** → 写前备份；备份失败即中止这一篇喵
        const written = await writeWithBackup({ project, path, text: next, stampIso: now })
        if (!written.ok) {
          report.writeFailures.push({ target: path, error: `备份失败，已跳过改写：${written.error}` })
          continue
        }
        changelog.push(`[${legacyOnly ? 'legacy 回填·试跑' : '自动补元数据'}] ${shortPath(project, path)}：${changes.join('；')}`)
      }
      if (!dryRun) {
        await store.putDoc(docRecord({
          path,
          tier: derived.tier,
          taskId: derived.taskId,
          title: derived.title || name.replace(/\.md$/i, ''),
          owner,
          chars: derived.chars,
          keywords: meta.keywords || derived.keywords,
          relatedFiles: meta.relatedFiles || derived.relatedFiles,
          missingSections: legacy || derived.tier === 0 ? [] : derived.missingSections,
          // 补上头部后就不再是「无头旧档」了喵
          legacy: touched ? false : legacy,
          needsLibrarian: derived.needsLibrarian,
          updatedAt: derived.createdAt,
        }))
      }
    } catch (error) {
      // 失败隔离：这一篇写不进就跳过，别把整批带塌喵
      report.writeFailures.push({ target: path, error: String(error && error.message ? error.message : error) })
    }
  }

  const logged = await appendChangelog({ project, entries: changelog, now })
  return { ...report, changelog: logged }
}

/** 只读巡检：给报告用，不落盘喵。 */
export async function survey({ store, limit = 50 }) {
  const rows = []
  for (const doc of store.listDocs().slice(0, limit)) {
    const file = await readFileIfPresent(doc.path)
    if (!file) continue
    rows.push({
      path: doc.path,
      legacy: doc.legacy,
      ...inspectDoc({ text: file.text, fileName: baseNameOf(doc.path), siblingDocs: siblingsOf(store, doc) }),
    })
  }
  return rows
}

/** 归档分片名喵：**时间分片**（默认按月 `YYYY-MM`），与批次解耦（DESIGN §5.5）喵。 */
export function shardOf(stamp) {
  const date = new Date(Number.isFinite(stamp) ? stamp : Date.now())
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 某档的归档目标绝对路径（`archive/<分片>/<原文件名>`）喵。 */
export function archiveTargetPath(project, docPath, stamp) {
  return joinUnderRoot(project.archiveDir, `${shardOf(stamp)}/${basename(docPath)}`)
}

/**
 * 馆员执行归档喵（**审计只建议，动手的在这里**）喵。
 *
 * 一次归档做四件事：**移动 → 留痕 → 更新引用 → 更新台账**喵。
 * 每篇单独 try/catch（失败隔离），一篇出问题不影响其余喵。
 * @param args.paths - 要归档的文档绝对路径列表喵。
 * @returns `{ moved, refsUpdated, failed, files, changelog }`喵。
 */
export async function archiveDocs({
  project, store, paths, now = Date.now(), stampIso = new Date().toISOString(),
  dryRun = false, monthOf = 'obsolete',
} = {}) {
  const empty = { moved: 0, refsUpdated: 0, failed: [], files: [], changelog: { path: '', appended: 0 } }
  if (!project.archiveDir) {
    return { ...empty, failed: [{ target: '(archiveDir)', error: '未配置 paths.archiveDir，无法归档' }] }
  }
  const moves = []
  const conflicts = []
  for (const oldPath of paths || []) {
    // FIX-87 ②：**分片口径可控** —— 默认按"该档被标废/被判定归档的月份"（内容语义），
    // 显式要"按执行时刻"时才用 `now`（真机事故：3 篇正文标废日是 2026-08-13，却按运行时刻落进 2026-10）喵
    const record = store.getDoc(oldPath)
    // 兜底顺序：头部 archivedAt → 正文标废日 → **台账 updatedAt**（"被判定归档"的时间，与旧口径一致）→ now 喵
    const obsoleteStamp = await obsoleteStampOf({
      store, path: oldPath, fallback: Date.parse((record && record.updatedAt) || '') || now,
    })
    const stamp = monthOf === 'now' ? now : (obsoleteStamp || now)
    const target = archiveTargetPath(project, oldPath, stamp)
    if (existsSync(target)) {
      conflicts.push({ from: oldPath, to: target, reason: `目标已存在，拒收（不覆盖）：${target}` })
      continue
    }
    moves.push({
      oldPath,
      newPath: target,
      changeLabel: `归档到 ${shardOf(stamp)} 分片`,
      refLabel: `${basename(oldPath)} 已归档`,
      // FIX-69：**归档语义进元数据**（`^` 前缀那套已经废弃）—— 检索/审计读字段，不看文件名喵。
      // FIX-87 ①：`archivedAt` 取**标废日**（与内容一致），执行时刻进留痕（两个时间事实都保留）喵
      setMeta: { archived: true, archivedAt: new Date(monthOf === 'now' ? stamp : (obsoleteStamp || stamp)).toISOString() },
    })
    void record
  }
  // FIX-87 ①：**任何动真实文件的工具都不许缺预演** —— "不可预演"正是本次事故的直接根因喵
  if (dryRun) {
    return {
      dryRun: true,
      moved: 0,
      refsUpdated: 0,
      files: [],
      failed: [],
      conflicts,
      willArchive: moves.map((move) => ({ from: move.oldPath, to: move.newPath, month: shardOf(Date.parse(move.setMeta.archivedAt) || now) })),
      changelog: { path: '', appended: 0 },
    }
  }
  const done = await runMoveBatch({ project, store, moves, stampIso, kind: '归档' })
  return { ...done, dryRun: false, willArchive: [], conflicts }
}

/**
 * 该档的**标废日**（内容语义的时间）喵（FIX-87 ②）喵：
 * ① 头部 `archivedAt`（已经标过）② 正文里"废弃/作废/已弃用"附近的日期 ③ 都没有 ⇒ null（调用方退回 `now`）喵。
 */
async function obsoleteStampOf({ store, path, fallback }) {
  const file = await readFileIfPresent(path)
  if (!file || typeof file.text !== 'string') return null
  const parsed = parseFrontMatter(file.text)
  const fromMeta = Date.parse((parsed.meta && parsed.meta.archivedAt) || '')
  if (Number.isFinite(fromMeta)) return fromMeta
  const body = parsed.meta === null ? file.text : parsed.body
  const rows = body.split(/\r?\n/)
  for (let index = 0; index < rows.length; index += 1) {
    if (!/[废棄弃]|obsolete|deprecated/i.test(rows[index])) continue
    // 同一行或相邻两行里找日期（`2026-08-13` / `2026/8/13`）喵
    const window = [rows[index], rows[index + 1] || ''].join(' ')
    const hit = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(window)
    if (!hit) continue
    const stamp = Date.parse(`${hit[1]}-${String(hit[2]).padStart(2, '0')}-${String(hit[3]).padStart(2, '0')}T00:00:00Z`)
    if (Number.isFinite(stamp)) return stamp
  }
  void store
  if (Number.isFinite(fallback)) return fallback
  return null
}

/** 共享：移动一批档（读 → 留痕 → 写新路径 → 删旧 → 同步台账）喵。每篇单独兜错喵。 */
async function relocateDocs({ project, store, moves, stampIso, onMoved }) {
  const moved = []
  const failed = []
  for (const move of moves) {
    try {
      // 护栏：目标已存在就**不覆盖**，记一条失败跳过喵（宁可留着重复档，也不能吃掉内容）
      if (existsSync(move.newPath)) {
        failed.push({ target: move.oldPath, error: `目标已存在，跳过以免覆盖：${move.newPath}` })
        continue
      }
      const file = await readFileIfPresent(move.oldPath)
      if (!file) throw new Error('源档读不到')
      // FIX-22 / §9-26：改名 + 删除原文件**不是**"安全操作"（写失败/断电就两头空）→ 先备份喵
      const backupPath = backupPathOf(project, move.oldPath, stampIso)
      try {
        await mkdir(dirname(backupPath), { recursive: true })
        await copyFile(move.oldPath, backupPath)
      } catch (error) {
        failed.push({
          target: move.oldPath,
          error: `备份失败，已跳过本次改名：${String(error && error.message ? error.message : error)}`,
        })
        continue
      }
      const parsed = parseFrontMatter(file.text)
      const body = parsed.meta === null ? file.text : parsed.body
      // FIX-69：**非 .md 的搬运必须原样搬**（`.json` 这类临时文件不能被贴上 YAML 头部 ✗）喵
      if (!/\.md$/i.test(move.oldPath)) {
        await mkdir(dirname(move.newPath), { recursive: true })
        await writeFile(move.newPath, file.text, 'utf8')
        await rm(move.oldPath, { force: true })
        moved.push({ from: move.oldPath, to: move.newPath, backupPath })
        if (onMoved) onMoved(move)
        continue
      }
      // FIX-69：归位时可以顺带**改元数据**（如 `archived: true`）—— 与移动一起做完，免得写两遍喵
      const meta = { ...(parsed.meta || {}), ...(move.setMeta || {}) }
      // FIX-105：同样走"头部纪律"（无头不加头、非类别文件不动头）喵
      const next = composeRewrittenFile({
        path: move.oldPath,
        originalText: file.text,
        parsed: { meta, body: parsed.meta === null ? file.text : parsed.body },
        nextBody: body,
        changes: [move.changeLabel],
        project,
        stampIso,
        forceStamp: Boolean(move.setMeta && Object.keys(move.setMeta).length),
      }).text
      await mkdir(dirname(move.newPath), { recursive: true })
      await writeFile(move.newPath, next, 'utf8')
      await rm(move.oldPath, { force: true })
      const record = store.getDoc(move.oldPath)
      if (record) {
        await store.deleteDoc(move.oldPath)
        await store.putDoc(docRecord({ ...record, path: move.newPath, chars: countChars(next), updatedAt: stampIso }))
      }
      moved.push({ from: move.oldPath, to: move.newPath, backupPath })
      if (onMoved) onMoved(move)
    } catch (error) {
      failed.push({ target: move.oldPath, error: String(error && error.message ? error.message : error) })
    }
  }
  return { moved, failed }
}

/**
 * 把 front-matter 里指向旧路径的引用换成新路径喵（FIX-76 ④）喵。
 *
 * 真机实证：搬完 157 项之后，文档里的 `relatedFiles` **与交叉引用仍是旧路径**（连馆员刚写的
 * `archive/2026-10` 都因分片合并失效）—— 因为原来的引用改写**只动了正文**，没碰头部 ✗。
 * 这里把字符串字段、字符串数组、以及渐进式披露指针（`nextTier` / `fullDetail`）一起改掉喵。
 */
function replacePathInMeta(meta, oldPath, newPath) {
  if (!meta || typeof meta !== 'object') return meta
  const next = {}
  let touched = 0
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' && value.includes(oldPath)) {
      next[key] = value.split(oldPath).join(newPath)
      touched += 1
      continue
    }
    if (Array.isArray(value)) {
      const mapped = value.map((item) => (typeof item === 'string' && item.includes(oldPath) ? item.split(oldPath).join(newPath) : item))
      if (mapped.some((item, index) => item !== value[index])) touched += 1
      next[key] = mapped
      continue
    }
    next[key] = value
  }
  return { meta: next, touched }
}

/** 共享：把还留在原地的档里对旧路径的引用改成新路径（**头部 + 正文都改**；同样留痕 + 写前备份）喵。 */
async function rewriteReferences({ project, store, moves, stampIso, onRewritten }) {
  let count = 0
  const failed = []
  for (const move of moves) {
    for (const doc of store.listDocs()) {
      if (doc.path === move.newPath) continue
      try {
        const file = await readFileIfPresent(doc.path)
        if (!file || !file.text.includes(move.oldPath)) continue
        const parsed = parseFrontMatter(file.text)
        const originalMeta = parsed.meta || {}
        const replaced = replacePathInMeta(originalMeta, move.oldPath, move.newPath)
        const bodyFixes = parsed.meta === null ? 0 : ((parsed.body.split(move.oldPath).length - 1))
        const rawFixes = parsed.meta === null ? ((file.text.split(move.oldPath).length - 1)) : 0
        if (replaced.touched === 0 && bodyFixes === 0 && rawFixes === 0) continue
        const body = (parsed.meta === null ? file.text : parsed.body).split(move.oldPath).join(move.newPath)
        // FIX-105：搬移时的引用改写**也只改指向性内容** —— 任务卡这类非类别文件不许被补头/盖留痕喵
        const next = composeRewrittenFile({
          path: doc.path,
          alsoPaths: [move.newPath],
          originalText: file.text,
          parsed: { meta: replaced.meta, body: parsed.meta === null ? file.text : parsed.body },
          nextBody: body,
          changes: [move.refLabel],
          project,
          stampIso,
        }).text
        // FIX-22 / §9-26：改引用也是**改写既有档** → 先备份；失败就跳过这一篇喵
        const written = await writeWithBackup({ project, path: doc.path, text: next, stampIso })
        if (!written.ok) {
          failed.push({ target: doc.path, error: `备份失败，已跳过引用改写：${written.error}` })
          continue
        }
        await store.putDoc(docRecord({ ...doc, chars: countChars(next), updatedAt: stampIso }))
        count += 1
        if (onRewritten) onRewritten(doc.path, move)
      } catch (error) {
        failed.push({ target: doc.path, error: String(error && error.message ? error.message : error) })
      }
    }
  }
  return { count, failed }
}

/** 跑完一批移动 + 引用更新 + changelog喵。 */
async function runMoveBatch({ project, store, moves, stampIso, kind }) {
  const changelog = []
  const result = await relocateDocs({
    project,
    store,
    moves,
    stampIso,
    onMoved: (move) => changelog.push(`[${kind}] ${shortPath(project, move.oldPath)} → ${shortPath(project, move.newPath)}`),
  })
  const refs = await rewriteReferences({
    project,
    store,
    moves,
    stampIso,
    onRewritten: (path, move) => changelog.push(`[引用更新] ${shortPath(project, path)} → 指向 ${shortPath(project, move.newPath)}`),
  })
  const logged = await appendChangelog({ project, entries: changelog, now: stampIso })
  return {
    moved: result.moved.length,
    refsUpdated: refs.count,
    files: result.moved,
    failed: [...result.failed, ...refs.failed],
    changelog: logged,
  }
}

/**
 * **按类型归位 / 去归档前缀 / 临时文件搬离**喵（FIX-69，⑦ 迁移）喵。
 *
 * 用户拍板的口径喵：`^` 前缀是"归档"的意思 ⇒ 搬到元数据（`archived: true`），文件名不再带 `^`；
 * `.json` 这类临时文件统一搬去 `paths.tempDir`（**只搬不删**）；类型后缀与目录不符 ⇒ 挪到正确的类目录喵。
 *
 * 三条纪律喵：① **只移动 / 改名 + 改元数据，正文一字不动** ② 判不准的**列「待人工裁定」**，
 * 绝不猜着搬 ③ 每次移动都走既有引擎（写前备份 + 更新引用 + 留痕 + changelog）喵。
 */
export async function conformDocAreas({ project, store, dryRun = false, stampIso = new Date().toISOString() } = {}) {
  const rows = await scanDocAreas({ project })
  const moves = []
  const patchOnly = [] // 只改元数据（路径不变）的档：`^` 去前缀后恰好同名之类喵
  const pending = []
  for (const row of rows) {
    if (row.nonMd) {
      const temp = project.tempDir
      if (!temp) {
        pending.push({ path: row.path, reason: '非 .md 文件，但项目没配临时目录（paths.tempDir）' })
        continue
      }
      moves.push({
        oldPath: row.path,
        newPath: joinUnderRoot(temp, row.name),
        changeLabel: '临时文件搬离类别目录（只搬不删）',
        refLabel: '引用更新（临时文件搬离）',
      })
      continue
    }
    const { name, archived } = stripArchiveCaret(row.name)
    const declared = kindFromFileName(name)
    if (!declared) {
      pending.push({ path: row.path, reason: '文件名认不出类型后缀（`_研究`/`_审查`/`_整合清单`/`_L<n>`…），判不准，不搬' })
      continue
    }
    const targetDir = docAreaDirFor({ project, kind: declared, name })
    if (!targetDir) {
      pending.push({ path: row.path, reason: `认得出是「${declared}」，但项目没有对应目录（paths.docKinds.${declared}）` })
      continue
    }
    const newPath = joinUnderRoot(targetDir, name)
    const setMeta = archived ? { archived: true, archivedAt: stampIso } : undefined
    if (newPath === row.path) {
      if (setMeta) patchOnly.push({ path: row.path, setMeta, changeLabel: '归档语义移到元数据（去 ^ 前缀）' })
      continue
    }
    moves.push({
      oldPath: row.path,
      newPath,
      changeLabel: archived ? '类型归位 + 归档语义移到元数据' : '类型归位 / 命名与目录对齐',
      refLabel: '引用更新（类型归位）',
      ...(setMeta ? { setMeta } : {}),
    })
  }
  // dryRun：只出**预演清单**，一个字节都不动（与一轮治理其余步骤同一口径）喵
  if (dryRun) {
    return {
      moved: 0,
      refsUpdated: 0,
      dryRun: true,
      files: moves.map((move) => ({ oldPath: move.oldPath, newPath: move.newPath })),
      ...(patchOnly.length ? { patchOnly: patchOnly.map((row) => row.path) } : {}),
      failed: [],
      pending,
    }
  }
  const relocated = await runMoveBatch({ project, store, moves, stampIso, kind: '类型归位' })
  // 只改元数据的那些：走备份闸门逐篇写 front-matter（正文一字不动）喵
  const patched = []
  for (const row of patchOnly) {
    const file = await readFileIfPresent(row.path)
    if (!file) continue
    const parsed = parseFrontMatter(file.text)
    const next = `${renderFrontMatter(stampTrace({ ...(parsed.meta || {}), ...row.setMeta }, [row.changeLabel], stampIso))}`
      + `${(parsed.meta === null ? file.text : parsed.body).replace(/^\n+/, '')}`
    const written = await writeWithBackup({ project, path: row.path, text: next, stampIso })
    if (written && written.ok) patched.push(row.path)
  }
  return {
    // ⚠ `runMoveBatch()` 已经把 `moved` 拍成**数字**了（不是数组）——再 `.length` 会得到 undefined ✗ 喵
    moved: relocated.moved + patched.length,
    refsUpdated: relocated.refsUpdated,
    files: [
      ...relocated.files.map((file) => ({ oldPath: file.from, newPath: file.to })),
      ...patched.map((path) => ({ oldPath: path, newPath: path })),
    ],
    failed: relocated.failed,
    pending,
  }
}

/** 某个类型 + 文件名该落在哪个目录（产出档按档级子目录；拿不到返回 null）喵。 */
function docAreaDirFor({ project, kind, name }) {
  const kinds = (project && project.docKinds) || {}
  if (kind !== '产出档') return kinds[kind] || null
  const tier = Number((/_L([123])\.md$/i.exec(String(name)) || [])[1] || 0)
  if (!tier) return null
  try {
    return tierDirOf({ project, tier })
  } catch {
    return null
  }
}

/**
 * **通用搬迁能力**喵（FIX-76）喵 —— 馆员的"搬移的手"喵。
 *
 * 真机实证的架构级自相矛盾喵：FIX-63 要求"归位/整理这类活由馆员做"，可**馆员手里没有搬移工具**
 * （没有 shell、也没有通用移动工具）⇒ 主代理只能自己用 pwsh 搬了 157 项，**绕过**了写前备份 /
 * 引用更新 / 留痕三条链 ⇒ 搬完 `relatedFiles` 与交叉引用全是旧路径 ✗。
 *
 * 七条护栏（对应单据 ①~⑦）喵：默认 **dryRun** 预演 · 碰撞**拒收**（不覆盖）· 写前备份（与既有写入同源）·
 * **引用同步**（头部 + 正文，见 `rewriteReferences`）· 留痕（`librarianTouchedAt`/`librarianChanges`）·
 * **回滚清单**（新 → 旧）· **正文 sha 不变**（只移动/改名，要改正文另行授权）喵。
 */
export async function relocateBatch({ project, store, moves = [], dryRun = true, stampIso = new Date().toISOString() } = {}) {
  const planned = []
  const conflicts = []
  for (const move of moves || []) {
    const from = String((move && (move.from || move.oldPath)) || '').trim()
    const to = String((move && (move.to || move.newPath)) || '').trim()
    if (!from || !to) {
      conflicts.push({ from, to, reason: '源路径或目标路径为空' })
      continue
    }
    if (from === to) continue
    if (existsSync(to)) {
      conflicts.push({ from, to, reason: `目标已存在，拒绝覆盖：${to}` })
      continue
    }
    const file = await readFileIfPresent(from)
    if (!file) {
      conflicts.push({ from, to, reason: `源文件不存在：${from}` })
      continue
    }
    planned.push({
      oldPath: from,
      newPath: to,
      changeLabel: '馆员搬移',
      refLabel: '引用更新（搬移）',
      before: fingerprintText(parseFrontMatter(file.text).body),
    })
  }
  // 影响引用：有多少篇**别的**档提到这些旧路径（预演里报 R，落盘后由 rewriteReferences 真改）喵
  const refs = await countReferences({ store, oldPaths: planned.map((move) => move.oldPath) })
  const rollback = planned.map((move) => ({ from: move.newPath, to: move.oldPath }))
  if (dryRun) {
    return {
      dryRun: true,
      planned: planned.map(({ oldPath, newPath }) => ({ oldPath, newPath })),
      conflicts,
      refs,
      refsTotal: refs.reduce((sum, row) => sum + row.count, 0),
      rollback,
      moved: 0,
      files: [],
      failed: [],
      bodyProof: [],
    }
  }
  const result = await runMoveBatch({ project, store, moves: planned, stampIso, kind: '馆员搬移' })
  // ⑦ 正文 sha 证明：逐篇给"动手前 → 动手后"（只移动/改名 ⇒ 必须逐篇一致）喵
  const bodyProof = []
  for (const file of result.files) {
    const after = await readFileIfPresent(file.to)
    const before = (planned.find((move) => move.oldPath === file.from) || {}).before || null
    const now = after ? fingerprintText(parseFrontMatter(after.text).body) : null
    bodyProof.push({ path: file.to, before, after: now, same: before !== null && before === now })
  }
  return {
    dryRun: false,
    moved: result.moved,
    refsUpdated: result.refsUpdated,
    refsTotal: refs.reduce((sum, row) => sum + row.count, 0),
    files: result.files,
    failed: result.failed,
    rollback,
    bodyProof,
    planned: [],
    conflicts,
  }
}

/** 数一数"有多少篇别的档提到这些旧路径"（预演用；只看文本，不改任何东西）喵。 */
async function countReferences({ store, oldPaths = [] } = {}) {
  const targets = [...new Set((oldPaths || []).filter(Boolean))]
  const rows = []
  for (const oldPath of targets) {
    const paths = []
    for (const doc of store.listDocs()) {
      if (doc.path === oldPath) continue
      const file = await readFileIfPresent(doc.path)
      if (file && file.text.includes(oldPath)) paths.push(doc.path)
    }
    rows.push({ oldPath, count: paths.length, paths })
  }
  return rows
}

/**
 * 扫**全库**的档（台账里的 + 各类别目录/tasksDir 磁盘上的）喵（FIX-77）喵。
 *
 * 为什么要磁盘那半边：台账**只含产出档 / 任务 / 进度**（研究/坑/修改/核心数据库等类别不进台账，
 * 那是单独决策）⇒ 只扫台账会漏掉一大半引用方 ✗ —— 真机那句错表述就在 `任务/` 里喵。
 * @returns `[{ path, text, meta, body }]`（按路径去重）喵。
 */
async function scanAllDocs({ project, store } = {}) {
  const rows = new Map()
  const push = async (path) => {
    if (!path || rows.has(path)) return
    const file = await readFileIfPresent(path)
    if (!file) return
    const parsed = parseFrontMatter(file.text)
    rows.set(path, { path, text: file.text, meta: parsed.meta || {}, body: parsed.meta === null ? file.text : parsed.body })
  }
  for (const doc of store.listDocs()) await push(doc.path)
  for (const dir of [...(project.docsDirs || []), project.tasksDir, project.deliverablesDir]) {
    if (!dir) continue
    for (const name of await listMarkdownDeep(dir)) await push(joinUnderRoot(dir, name))
  }
  return [...rows.values()]
}

/**
 * **引用一致性修复**喵（FIX-77 ①，可独立复用）喵：全库扫"指向不存在路径的引用"，能唯一判定就自动修喵。
 *
 * 真机遗留：搬移后 `relatedFiles` 与交叉引用**全是旧路径**（含存量断引用 ~15 处，
 * 正文早就在指 `docs/研究-炮管黑.md` 这类不存在的路径）喵。
 *
 * 判据喵：引用形如 `...x.md`；目标不存在 ⇒ 拿**文件名**去"现存档索引"里找 ——
 * **恰好一个**候选 ⇒ 自动修（先 dryRun，落盘走备份 + 留痕）；**多个/零个** ⇒ 列「待人工裁定」，
 * 绝不猜（猜错等于把引用指向另一篇，比断引用更坏）喵。
 * 报告分开「存量断引用」与「本轮搬移造成的」（`recentMoves` 传本轮搬过的旧路径）喵。
 */
export async function repairDanglingRefs({ project, store, dryRun = true, recentMoves = [], stampIso = new Date().toISOString() } = {}) {
  const index = await indexExistingDocs({ project, store })
  const recent = new Set((recentMoves || []).map((path) => String(path)))
  const fixed = []
  const pending = []
  // 扫**全库**：台账只含产出档/任务/进度 ⇒ 只看台账会漏掉一大半引用方（研究/坑/核心数据库都在磁盘上）喵
  for (const entry of await scanAllDocs({ project, store })) {
    for (const ref of collectDocRefs(entry)) {
      const abs = toAbsoluteRef(project, ref)
      if (!abs || existsSync(abs)) continue
      const candidates = resolveRefCandidates({ index, abs })
      const row = {
        path: entry.path,
        ref,
        oldPath: abs,
        reason: candidates.length === 1
          ? `唯一匹配到 ${candidates[0]}`
          : (candidates.length ? `有 ${candidates.length} 个同名/同任务号候选，判不准` : '找不到同名档，判不准'),
        layer: recent.has(abs) ? '本轮搬移造成的' : '存量断引用',
      }
      if (candidates.length === 1) {
        if (!dryRun) {
          const written = await replaceRefInDoc({ project, store, entry, from: ref, to: candidates[0], stampIso })
          if (!written.ok) {
            pending.push({ ...row, reason: `修复未落盘：${written.error}` })
            continue
          }
        }
        fixed.push({ ...row, newPath: candidates[0] })
        continue
      }
      pending.push(row)
    }
  }
  const stale = fixed.filter((row) => row.layer === '存量断引用').length + pending.filter((row) => row.layer === '存量断引用').length
  const thisRound = fixed.filter((row) => row.layer === '本轮搬移造成的').length + pending.filter((row) => row.layer === '本轮搬移造成的').length
  return { dryRun, fixed, pending, stale, thisRound }
}

/**
 * 给一条断引用找候选（**两条策略**，命中其一且唯一才算数）喵（FIX-77 ①）喵：
 * ① **文件名匹配**：同 basename 的现存档（搬家换目录的典型情形）；
 * ② **任务号匹配**：引用名里带 `T<号>`，而现存档里**恰有一个**同任务号的档（改名换后缀的典型情形）喵。
 * 两条都判不出唯一解 ⇒ 返回空/多个 ⇒ 调用方列「待人工裁定」（**绝不猜**：指错比断着更坏）喵。
 */
function resolveRefCandidates({ index, abs }) {
  const byName = index.get(basename(abs).toLowerCase()) || []
  if (byName.length) return byName
  const taskMatch = /(T-?\d+)/i.exec(basename(abs))
  if (!taskMatch) return []
  return index.get(`#task:${taskMatch[1].toLowerCase()}`) || []
}

/** 现存 `docs` 的文件名索引（小写 basename → 绝对路径数组）喵。 */
async function indexExistingDocs({ project, store }) {
  const index = new Map()
  const add = (path) => {
    if (!path) return
    const base = basename(String(path))
    const keys = [base.toLowerCase()]
    // 任务号索引：让"改了名但任务号没变"的档也能被唯一找回喵
    const taskMatch = /(T-?\d+)/i.exec(base)
    if (taskMatch) keys.push(`#task:${taskMatch[1].toLowerCase()}`)
    for (const key of keys) {
      if (!index.has(key)) index.set(key, [])
      if (!index.get(key).includes(path)) index.get(key).push(path)
    }
  }
  for (const doc of store.listDocs()) add(doc.path)
  for (const dir of [...(project.docsDirs || []), project.tasksDir]) {
    for (const name of await listMarkdownDeep(dir)) add(joinUnderRoot(dir, name))
  }
  return index
}

/** 从一份档里收集"像路径的引用"（`relatedFiles` + 指针字段 + 正文里的 `.md` 路径）喵。 */
function collectDocRefs(parsed) {
  const refs = []
  const meta = (parsed && parsed.meta) || {}
  for (const field of ['relatedFiles']) {
    for (const item of Array.isArray(meta[field]) ? meta[field] : []) {
      if (typeof item === 'string' && /\.md$/i.test(item.trim())) refs.push(item.trim())
    }
  }
  for (const field of ['nextTier', 'fullDetail']) {
    if (typeof meta[field] === 'string' && /\.md$/i.test(meta[field].trim())) refs.push(meta[field].trim())
  }
  const body = parsed && typeof parsed.body === 'string' ? parsed.body : ''
  for (const hit of extractPaths(body)) {
    const value = String(hit).trim()
    if (/\.md$/i.test(value)) refs.push(value)
  }
  return [...new Set(refs)]
}

/** 把引用写法变成绝对路径（相对路径按项目根拼）喵。 */
function toAbsoluteRef(project, ref) {
  const raw = String(ref || '').trim().replace(/^[`"']|[`"']$/g, '')
  if (!raw) return ''
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\')) return raw
  return joinUnderRoot((project && project.root) || '', raw)
}

/**
 * **写回既有文件时的头部纪律**喵（FIX-105，真机污染）喵。
 *
 * 真机事故：一轮 sweep 的"引用修复"给 **23 张任务卡**开头插了 10 行**全 null 的 YAML 头**
 * （`taskId: null / role: null / …` + 两行留痕）—— 58 张卡里只有这 23 张有头，同族不一致，
 * 审计还可能把它们当"文档档"反复报 ✗。根因：写回时**无条件渲染 front-matter**，没看三件事：
 * ① 文件本来有没有头 ② 它是不是文档类别（任务卡/进度档/索引类不在 `docKinds` 里）③ 渲染出来的头是不是**全 null**。
 *
 * 四条纪律（本函数就是它们的唯一落点）喵：
 * - **只改指向性内容，不改文件形态**：原来没头的，写出去也不得新增头；
 * - **非文档不套文档写入路径**：不在类别目录里的文件（任务卡 / 进度档 / 索引）**一律不动头**（原有头也**原样保留、不盖留痕**）；
 * - **全 null 的头不许写、也不许改**：内容键全空时保持原样（修的就是"为了写留痕而给文件加一段毫无意义的头"）；
 * - **留痕是台账属性**：只有"真的是文档类别 + 有真头部"时才把 `librarianTouchedAt/Changes` 盖进头里，
 *   其余情况留痕只进回执/台账（**不必写在被改文件里**）喵。
 *
 * @returns `{ text, headerKept, stamped }`喵。
 */
export function composeRewrittenFile({ path, alsoPaths = [], originalText, parsed, nextBody, changes = [], project = null, stampIso = new Date().toISOString(), forceStamp = false }) {
  const text = String(originalText ?? '')
  const body = String((parsed && parsed.body) ?? nextBody ?? '')
  // 原头部**逐字**切片（parseFrontMatter 的 body 是原文后缀）⇒ 不动头时能做到字节级零改动喵
  const rawHeader = text.endsWith(body) ? text.slice(0, text.length - body.length) : ''
  const meta = parsed ? parsed.meta : null
  const hadHeader = Boolean(meta && rawHeader)
  const bodyText = String(nextBody ?? body).replace(/^\n+/, '')
  if (!hadHeader) return { text: bodyText, headerKept: false, stamped: false }
  const contentKeys = ['taskId', 'role', 'tier', 'keywords', 'relatedFiles', 'createdAt']
  const meaningful = contentKeys.some((key) => {
    const value = meta[key]
    if (value === null || value === undefined) return false
    if (Array.isArray(value)) return value.length > 0
    return String(value).trim() !== '' && String(value).trim() !== 'null'
  })
  // `forceStamp`：调用方**明确要求改元数据**（如归位时写 archived: true）时，别被"全 null"判据吞掉那次改动喵
  // 判定是不是文档类别时把调用方给的其它候选路径也算上（搬移途中"旧路径/新路径"都可能是类别目录内）喵
  const inCategory = [path, ...alsoPaths].filter(Boolean).some((item) => isDocCategoryPath(project, item))
  // FIX-105 核心：**全 null 的头不许改写**（真机那 23 张卡就是"为了写留痕"被盖了 10 行全 null 的头）——
  // 保持原头部逐字不动、只改正文；真有内容的头照旧盖留痕（`forceStamp` = 调用方明确要求改元数据）喵
  if (!forceStamp && !meaningful) {
    return { text: `${rawHeader}${bodyText}`, headerKept: true, stamped: false, inCategory }
  }
  return { text: `${renderFrontMatter(stampTrace(meta, changes, stampIso))}${bodyText}`, headerKept: true, stamped: true }
}

/** 该路径是否落在**文档类别目录**里（`docKinds` 各值，含产出根）喵 —— 非类别文件不套文档写入路径喵。 */
export function isDocCategoryPath(project, path) {
  const target = String(path || '')
  if (!target) return false
  const dirs = [
    ...Object.values((project && project.docKinds) || {}),
    project && project.deliverablesDir,
    project && project.archiveDir,
  ].filter(Boolean).map((dir) => String(dir))
  return dirs.some((dir) => target === dir || target.startsWith(dir.endsWith('\\') || dir.endsWith('/') ? dir : `${dir}\\`)
    || target.startsWith(dir.endsWith('/') ? dir : `${dir}/`))
}

/** 在一篇档里把某个引用替换掉（头部 + 正文都换，留痕 + 备份）喵。 */
async function replaceRefInDoc({ project, store, entry, from, to, stampIso }) {
  const replaced = replacePathInMeta(entry.meta || {}, from, to)
  const body = String(entry.body || '').split(from).join(to)
  // FIX-105：**只在"本来是文档类别 + 有真头部"时才盖头** —— 否则原样保留（任务卡绝不能被补头）喵
  const composed = composeRewrittenFile({
    path: entry.path,
    originalText: entry.text !== undefined ? entry.text : `${entry.rawHeader || ''}${entry.body || ''}`,
    parsed: { meta: replaced.meta, body: entry.body },
    nextBody: body,
    changes: ['引用修复（指向现存档）'],
    project,
    stampIso,
  })
  const next = composed.text
  const written = await writeWithBackup({ project, path: entry.path, text: next, stampIso })
  if (!written.ok) return { ok: false, error: written.error }
  const record = store.getDoc(entry.path)
  if (record) await store.putDoc(docRecord({ ...record, chars: countChars(next), updatedAt: stampIso }))
  return { ok: true, stamped: composed.stamped, headerKept: composed.headerKept }
}

/** 只渲染**已给出的**键（不给六个 null 占位 —— legacy 档补标注时只需要那一个字段）喵。 */
function renderMetaBlock(meta) {
  const lines = ['---']
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) lines.push(`${key}: ${JSON.stringify(value)}`)
    else lines.push(`${key}: ${value === null ? 'null' : value}`)
  }
  lines.push('---')
  return `${lines.join('\n')}\n\n`
}

/**
 * **legacy 档的"待归档"标注**喵（FIX-77 ②）喵：批量写 `archivePending: true`（**只动 front-matter**）喵。
 *
 * 真机遗留：97 篇 legacy 档缺这个标注（用户明确要求过）。标注是"我还没归档、但该归档"的事实，
 * 让检索与审计都能按**字段**办事，而不是靠人记着有哪 97 篇喵。
 */
export async function markArchivePending({ project, store, dryRun = true, stampIso = new Date().toISOString() } = {}) {
  const rows = []
  const failed = []
  for (const doc of store.listDocs()) {
    if (!doc || doc.legacy !== true) continue
    const file = await readFileIfPresent(doc.path)
    if (!file) continue
    const parsed = parseFrontMatter(file.text)
    const meta = parsed.meta || {}
    if (meta.archivePending === true) continue
    const nextMeta = { ...meta, archivePending: true, librarianTouchedAt: stampIso, librarianChanges: ['待归档标注（archivePending）'] }
    const body = (parsed.meta === null ? file.text : parsed.body).replace(/^\n+/, '')
    rows.push({ path: doc.path })
    if (dryRun) continue
    const written = await writeWithBackup({ project, path: doc.path, text: `${renderMetaBlock(nextMeta)}${body}`, stampIso })
    if (!written.ok) {
      failed.push({ target: doc.path, error: `备份失败，已跳过标注：${written.error}` })
      rows.pop()
    }
  }
  return { dryRun, marked: rows.length, files: rows, failed }
}

/**
 * **订正文档里对 `^` 的错误表述**喵（FIX-77 ③）喵。
 *
 * 真机遗留：项目文档里"`^` = 完成标记"那句是**上下文压缩污染的产物** —— 用户已裁定 `^` = 归档
 * （⇒ `archived: true`）⇒ 留着一句错的会**继续带偏下一轮 agent**喵。
 * 这是**用户明确授权的正文订正**（唯一一处允许馆员改正文的地方），因此它不进"正文零改动"名单，
 * 而是单独作为**有意变更**报出来（见 `verify.js` 的 `intendedChanges`）喵。
 */
export async function correctCaretClaim({ project, store, dryRun = true, stampIso = new Date().toISOString() } = {}) {
  const replacement = '`^` 前缀**已废弃**：归档语义写在文档头部 `archived: true`（不再靠文件名前缀）'
  const rows = []
  const failed = []
  // 全库扫（那句错表述在  里，不进台账）喵
  for (const entry of await scanAllDocs({ project, store })) {
    const body = String(entry.body || '')
    const hitLines = body.split(/\r?\n/).filter((line) => CARET_CLAIM_RE.test(line))
    if (!hitLines.length) continue
    rows.push({ path: entry.path, before: hitLines[0].trim(), after: replacement })
    if (dryRun) continue
    const nextBody = body.split(/\r?\n/).map((line) => (CARET_CLAIM_RE.test(line) ? replacement : line)).join('\n')
    const next = `${renderMetaBlock({ ...(entry.meta || {}), librarianTouchedAt: stampIso, librarianChanges: ['订正 ^ 的表述（归档语义已改到元数据）'] })}${nextBody.replace(/^\n+/, '')}`
    const written = await writeWithBackup({ project, path: entry.path, text: next, stampIso })
    if (!written.ok) {
      failed.push({ target: entry.path, error: `备份失败，已跳过订正：${written.error}` })
      rows.pop()
    }
  }
  return { dryRun, fixed: rows, failed }
}

/** "`^` = 完成标记"这类**错误表述**的判据（窄：必须同时出现 `^`、比较符与"完成"）喵。 */
const CARET_CLAIM_RE = /^.*`?\^`?\s*(?:[=＝:：]|表示|作为|是)\s*[^\n]{0,6}完成.*$/

/**
 * 审计人话化喵（M4 交付物 2 职责 1）喵。
 * 把 `audit_scan` 的结果整理成**给主代理的待办清单**：红的在前、每条给路径 + 原因喵。
 */
export function buildTodoList({ report, maxItems = 50 }) {
  const items = (report && report.items) || []
  const order = { red: 0, yellow: 1 }
  const sorted = [...items].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9))
  if (!sorted.length) return '待办清单：无。审计全绿，馆员本轮无需治理动作。'
  const lines = [`待办清单（共 ${sorted.length} 条，红的必须先处理）：`]
  sorted.slice(0, maxItems).forEach((item, index) => {
    lines.push(`${index + 1}. [${item.level === 'red' ? '红' : '黄'}] ${item.check} · ${item.target}`)
    lines.push(`   原因：${item.detail}`)
  })
  if (sorted.length > maxItems) lines.push(`…（还有 ${sorted.length - maxItems} 条，见 audit_scan 完整报告）`)
  return lines.join('\n')
}

/**
 * 派生态索引维护喵（职责 2）喵（FIX-26 起与真身分家）喵。
 *
 * 写 `<核心数据库家目录>/派生态索引.md`：进度计数 + 阻塞清单（红项）+ 文档索引；
 * **绝不碰真身**（真身只由 `appendChangelog` 追加），名字也不与真身重名，
 * 头部自述「派生物·可重建」并写明真身在哪 —— 免得又出现"两份 核心数据库.md，哪份是真的"喵。
 */
export async function rebuildCoreDatabase({ project, store, report, nowIso = new Date().toISOString(), dryRun = false }) {
  const path = coreIndexPath(project)
  const truth = coreDbPath(project)
  const members = store.listMembers()
  const tasks = store.listTasks()
  const docs = store.listDocs()
  const tally = (rows, pick) => {
    const counts = {}
    for (const row of rows) counts[pick(row)] = (counts[pick(row)] || 0) + 1
    return Object.entries(counts).sort().map(([key, value]) => `${key} ${value}`).join(' / ') || '（空）'
  }
  const reds = ((report && report.items) || []).filter((item) => item.level === 'red')
  const blockLines = [
    '# 派生态索引',
    '',
    `> **派生物·可重建**（由 ledger_rebuild + audit_scan 生成，删了会自动重建；**不是真相**）。最后更新：${nowIso}`,
    `> 真身（唯一权威，勿删）：${truth}`,
    '> 本文件**只在标记区块内**增删；区块外若有人工内容，一字不动喵。',
    '',
    '## 进度计数',
    `- 成员：${tally(members, (row) => row.status)}`,
    `- 任务：${tally(tasks, (row) => row.status)}`,
    `- 文档：${tally(docs, (row) => (Number(row.tier) >= 1 && Number(row.tier) <= 3 ? `L${row.tier}` : 'legacy/tier0'))}`,
    '',
    '## 阻塞清单（审计红项）',
    ...(reds.length ? reds.map((item) => `- ${item.target}：${item.detail}`) : ['- 无']),
    '',
    '## 文档索引',
    ...(docs.length
      ? [...docs].sort((a, b) => String(a.path).localeCompare(String(b.path)))
        .map((doc) => `- ${doc.path} | ${Number(doc.tier) >= 1 ? `L${doc.tier}` : 'tier0'} | ${doc.title || ''} | ${doc.chars} 字 | ${doc.updatedAt || ''}`)
      : ['- （无）']),
  ]
  const previous = await readFileIfPresent(path)
  const merged = mergeIndexBlock(previous ? previous.text : '', blockLines)
  const stats = {
    members: members.length,
    tasks: tasks.length,
    docs: docs.length,
    blocked: reds.length,
    added: merged.added,
    removed: merged.removed,
    removedLines: merged.removedLines,
    strays: await findStrayCoreDbs({ project, corePath: truth }),
  }
  if (dryRun) return { path, corePath: truth, ...stats, changed: merged.changed, wrote: false, dryRun: true }
  if (!merged.changed) return { path, corePath: truth, ...stats, changed: false, wrote: false }
  const written = await writeWithBackup({ project, path, text: merged.text, stampIso: nowIso })
  // FIX-34：永不把 `undefined` 泄进回执（宿主校验 lossless JSON，一个 undefined 就整条拒收）喵
  const outcome = writeOutcome(written)
  return { path, corePath: truth, ...stats, changed: true, ...outcome, wrote: outcome.ok }
}

/**
 * 坑库 README 索引喵（职责 2）喵：列该目录下的档 + 标题 + 最近更新时间喵。
 *
 * **FIX-23**：既有 README 是**人工资产**（任务类型对照表 / 使用规则…），所以走
 * `mergeIndexBlock()` 只在标记区块内增删，区块外一字不动；写前按 §9-26 备份喵。
 */
export async function rebuildPitfallIndex({ project, store, nowIso = new Date().toISOString(), dryRun = false }) {
  const dir = (project.docKinds && project.docKinds['坑']) || (project.docsDirs && project.docsDirs[0])
  if (!dir) return { path: null, entries: 0, added: 0, removed: 0, removedLines: [], changed: false, wrote: false }
  const path = pitfallIndexPath(project)
  const rows = []
  for (const name of await listMarkdown(dir)) {
    if (name.toLowerCase() === 'readme.md') continue
    const file = await readFileIfPresent(joinUnderRoot(dir, name))
    const known = store.listDocs().find((doc) => doc.path === joinUnderRoot(dir, name))
    const title = known && known.title ? ` — ${known.title}` : ''
    const stamp = file ? ` · 更新 ${new Date(file.mtime).toISOString()}` : ''
    rows.push(`- [${name}](${name})${title}${stamp}`)
  }
  const blockLines = [
    `# 坑库索引（${dir}）`,
    '',
    '> **派生物·可重建**：由图书管理员维护，**只在下面的标记区块内增删**；'
      + '区块之外的人工内容（任务类型表 / 使用规则等）不受影响喵。',
    `> 最后更新：${nowIso}`,
    '',
    ...(rows.length ? rows : ['- （暂无）']),
  ]
  const previous = await readFileIfPresent(path)
  const merged = mergeIndexBlock(previous ? previous.text : '', blockLines)
  const stats = {
    entries: rows.length, added: merged.added, removed: merged.removed, removedLines: merged.removedLines,
  }
  // dryRun 只报不写（要在人审之后才落盘）喵
  if (dryRun) {
    return { path, ...stats, changed: merged.changed, wrote: false, dryRun: true }
  }
  // 幂等：内容没变就**不写**（第二遍 changed=0，也不产生备份噪声）喵
  if (!merged.changed) return { path, ...stats, changed: false, wrote: false }
  const written = await writeWithBackup({ project, path, text: merged.text, stampIso: nowIso })
  const outcome = writeOutcome(written)
  return { path, ...stats, changed: true, ...outcome, wrote: outcome.ok }
}

/**
 * 关键词复核（馆员的 **tags 步骤**）喵（FIX-25）喵。
 *
 * 补的是这个设计缺口：审计项 `doc_tags_stale` 报"正文改过但头部没跟着更新"，
 * 而在此之前 `ledger_backfill` 只补**空值**、`librarian_patrol` 不碰 keywords、sweep 也没有 tags 阶段
 * → 那几条黄项**天生无解**，建议文案指向了一个不存在的机制喵。
 *
 * 口径喵：
 * ① 判据与审计**同源**（`isTagsStale()`），不另立一套；
 * ② 关键词与派生器同源（标题 + 固定小节正文 + 术语表展开），**只增不删**既有值；
 * ③ 即使一个词都不用加，也要按 §9-33 **盖章**（`librarianTouchedAt` + `librarianChanges`）——
 *    "复核过、无需变更"同样是事实，不盖章的话审计下一轮还会报同一篇喵。
 */
export async function refreshStaleTags({ project, store, dryRun = false, limit, now = new Date().toISOString() }) {
  const glossary = await loadGlossary(project)
  const report = {
    scanned: 0, stale: 0, updated: 0, stamped: 0, added: 0, dryRun, files: [], writeFailures: [],
    // FIX-34：`undefined` 会让整条回执被判"非无损 JSON"→ 试算路径显式给 null 喵
    changelog: null,
  }
  const changelog = []
  for (const doc of store.listDocs()) {
    if (limit !== undefined && report.files.length >= limit) break
    if (!doc || doc.legacy || Number(doc.tier) === 0) continue
    if (!Array.isArray(doc.keywords) || doc.keywords.length === 0) continue
    const file = await readFileIfPresent(doc.path)
    if (!file) continue
    report.scanned += 1
    const parsed = parseFrontMatter(file.text)
    if (!parsed.meta) continue
    if (!isTagsStale({ meta: parsed.meta, mtime: file.mtime })) continue
    report.stale += 1
    const title = String(parsed.meta.title || doc.title || '')
    const fresh = expandKeywords(
      [title, ...extractKeywords(`${title} ${sectionContent(file.text, FIXED_SECTIONS)}`, 8)].filter(Boolean),
      glossary,
    ).filter((word) => !isGenericKeyword(word))
    const added = fresh.filter((word) => !doc.keywords.includes(word))
    report.files.push({ path: doc.path, added })
    report.added += added.length
    if (dryRun) continue
    const next = renderFrontMatter(stampTrace(
      { ...parsed.meta, keywords: [...doc.keywords, ...added] },
      [`复核 keywords（新增 ${added.length} 个${added.length ? `：${added.join('、')}` : ''}）`],
      now,
    )) + String(parsed.body || '').replace(/^\n+/, '')
    const written = await writeWithBackup({ project, path: doc.path, text: next, stampIso: now })
    if (!written.ok) {
      report.writeFailures.push({ target: doc.path, error: `备份失败，已跳过盖章：${written.error}` })
      continue
    }
    // 台账记录**保留原 updatedAt**：档龄算的是"内容年龄"，只复核关键词/盖章不该让它显得新鲜
    // （否则会把该归档的老档"洗白"，`archive_suggest` 再也不报它）喵
    await store.putDoc(docRecord({ ...doc, keywords: [...doc.keywords, ...added], chars: countChars(next) }))
    if (added.length) report.updated += 1
    report.stamped += 1
    changelog.push(`[tags 复核] ${shortPath(project, doc.path)}：${added.length ? `新增关键词 ${added.join('、')}` : 'keywords 无需变更，仅盖章'}`)
  }
  if (!dryRun) {
    const logged = await appendChangelog({ project, entries: changelog, now })
    report.changelog = logged
  }
  return report
}

/**
 * 命名规范化的**计划**（只算不动）喵（FIX-19）喵。
 *
 * 与实跑共用同一份口径：`dryRun` 打印的 `旧名 → 新名` 与真跑改的是同一批，
 * 否则"试算"就成了摆设喵。
 *
/**
 * 逐档推导「**权威任务号 + 只按文件名重算的标题**」喵（FIX-32 的唯一入口）喵。
 *
 * 权威任务号 = front-matter 的 `taskId`（写档时定下的），台账值只作兜底；
 * 标题 = `titleFromFileName(当前文件名, 权威任务号)` —— **绝不读 `doc.title`**（那是派生缓存，
 * 可能是旧口径留下的脏值，会让人把合规档判成"该改名"）喵。
 *
 * @returns 只含「非 legacy、tier 1~3、在范围内」的档，每条 `{ doc, taskId, title, suffix, doubled, hadPrefix }`喵。
 */
export async function deriveDocTitles({ project, store, paths }) {
  const rows = []
  for (const doc of store.listDocs()) {
    if (doc.legacy || Number(doc.tier) < 1 || Number(doc.tier) > 3) continue
    // 归档目录里的档是**冻结的历史**：不改名、不动它（改名会 churn 归档并打断外部引用）喵
    if (project.archiveDir && isUnder(doc.path, project.archiveDir)) continue
    if (paths && !paths.includes(doc.path)) continue
    const file = await readFileIfPresent(doc.path)
    const meta = file ? parseFrontMatter(file.text).meta : null
    const taskId = (meta && typeof meta.taskId === 'string' && meta.taskId) || doc.taskId
    if (!taskId) continue
    const parsed = titleFromFileName(basename(doc.path), taskId)
    // 文件名**没带**权威任务号前缀（例：`乱七八糟.md`）⇒ 名字里压根没有标题信息，
    // 这时唯一线索就是台账的 `title`（FIX-32 的"不读 doc.title"以 `hadPrefix` 为前提）喵
    const title = parsed.hadPrefix ? parsed.title : (String(doc.title || '').trim() || parsed.title)
    if (!title) continue
    rows.push({ doc, taskId, title, suffix: parsed.suffix, doubled: parsed.hadPrefix && parsed.doubled, hadPrefix: parsed.hadPrefix })
  }
  return rows
}

/**
 * 命名规范化的**计划**（只算不动）喵（FIX-19 起，FIX-32 改口径）喵。
 *
 * 与实跑共用同一份口径：`dryRun` 打印的 `旧名 → 新名` 与真跑改的是同一批，否则"试算"就是摆设喵。
 * 三条守则喵：
 * ① 标题**只从当前文件名 + 权威 front-matter taskId 推**（`titleFromFileName()`），**不得读 `doc.title`**
 *    —— 那是派生缓存，旧口径留下的脏值会把合规档判成"该改名"喵；
 * ② **幂等**：算出来的期望名与当前文件名相同 → 一个字都不动；
 * ③ **语义兜底**：剥掉前缀后的标题**仍以 `taskId_` 开头**（重复前置的脏名）→ **拦下只报不改**喵。
 *
 * @returns `{ moves, blocked, titles }`：`titles` 是重算出来的标题（调用方据此**回写台账**，治本）喵。
 */
export async function planNaming({ project, store, paths }) {
  const moves = []
  const blocked = []
  const titles = []
  for (const row of await deriveDocTitles({ project, store, paths })) {
    const { doc, taskId, title, doubled } = row
    const name = basename(doc.path)
    // 治本：把重算的标题回写台账（**哪怕这次不改名**）——否则脏标题会一直把合规档判成"该改名"喵
    if (doc.title !== title) titles.push({ path: doc.path, title })
    // ③ 语义兜底**先于**幂等判断：重复前置的脏名哪怕与"公式名"自洽，也必须**报出来**（只报不改）喵
    if (doubled) {
      blocked.push({
        target: doc.path,
        expected: docFileName(taskId, title, doc.tier),
        detail: `标题剥离任务号前缀后仍以任务号开头（${name} → ${title}），疑似重复前置，已拦下不改`,
      })
      continue
    }
    const expected = docFileName(taskId, title, doc.tier)
    // ② 幂等：期望名与当前文件名相同 → 一个字都不动（否则每轮治理都在改名与引用更新上空转）喵
    if (name === expected) continue
    moves.push({
      oldPath: doc.path,
      newPath: joinUnderRoot(dirname(doc.path), expected),
      changeLabel: `命名规范化：改名为 ${expected}`,
      refLabel: `${name} 已改名`,
    })
  }
  return { moves, blocked, titles }
}

/**
 * 把**按文件名重算的标题**回写台账喵（FIX-32 治本的那半步）喵。
 *
 * 顺序很关键：一轮治理里它必须在 `dedupeDocs` **之前**跑 —— 去重也是按 `doc.title` 分组的，
 * 脏标题同样会让去重判错喵（本函数幂等，重复调用无副作用）喵。
 */
export async function syncDocTitles({ project, store, paths }) {
  const titles = (await planNaming({ project, store, paths })).titles
  let fixed = 0
  for (const row of titles) {
    const record = store.getDoc(row.path)
    if (!record) continue
    await store.putDoc(docRecord({ ...record, title: row.title }))
    fixed += 1
  }
  return { fixed, titles }
}

/**
 * 命名规范化喵（职责 3）喵：`<任务号>_<标题>_L<档级>.md`，改名 + 更新引用 + 留痕喵。
 * 改名口径见 `planNaming()`，这里只负责落地；落地前先把重算标题写回台账（治本）喵。
 */
export async function normalizeNaming({ project, store, paths, stampIso = new Date().toISOString() }) {
  const plan = await planNaming({ project, store, paths })
  const synced = await syncDocTitles({ project, store, paths })
  const result = await runMoveBatch({ project, store, moves: plan.moves, stampIso, kind: '命名规范化' })
  return { ...result, candidates: plan.moves.length, titlesFixed: synced.fixed, blocked: plan.blocked }
}

/**
 * 去重喵（职责 4 的半边）喵：同任务号 + 同档级 + 同标题的重复档，
 * **保留最新的一份**，其余移进归档（移动而非删除，可逆）喵。
 */
export async function dedupeDocs({ project, store, stampIso = new Date().toISOString() }) {
  const groups = new Map()
  for (const doc of store.listDocs()) {
    if (doc.legacy || !doc.taskId) continue
    // 归档目录里的是历史副本，不算「活的重复档」喵
    if (project.archiveDir && isUnder(doc.path, project.archiveDir)) continue
    const key = `${doc.taskId}|${doc.tier}|${slug(doc.title || '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(doc)
  }
  const moves = []
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    const sorted = [...rows].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    for (const dup of sorted.slice(1)) {
      const stamp = Date.parse(dup.updatedAt || '') || Date.now()
      moves.push({
        oldPath: dup.path,
        newPath: archiveTargetPath(project, dup.path, stamp),
        changeLabel: '去重：同任务同档级的重复档，已归档',
        refLabel: `${basename(dup.path)} 作为重复档已归档`,
      })
    }
  }
  const result = await runMoveBatch({ project, store, moves, stampIso, kind: '去重' })
  return { ...result, duplicates: moves.length }
}

/** 术语表维护喵（职责 5）喵：把给定条目并入 `术语表.md`（同主词合并且同义词去重）喵。 */
export async function mergeGlossary({ project, entries, nowIso = new Date().toISOString() }) {
  const path = glossaryPath(project)
  const existing = await loadGlossary(project)
  const merged = new Map(existing.map((entry) => [entry.term, new Set(entry.synonyms)]))
  let added = 0
  for (const entry of entries || []) {
    const term = String(entry && entry.term ? entry.term : '').trim()
    if (!term) continue
    if (!merged.has(term)) {
      merged.set(term, new Set())
      added += 1
    }
    for (const synonym of entry.synonyms || []) {
      const value = String(synonym).trim()
      if (value && !merged.get(term).has(value)) merged.get(term).add(value)
    }
  }
  const lines = [
    '# 术语表',
    '',
    '> 行格式 `主词 | 同义词…`，供 keywords 自动展开。由图书管理员维护。',
    `> 最后更新：${nowIso}`,
    '',
    ...[...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([term, synonyms]) => `- ${[term, ...synonyms].join(' | ')}`),
    '',
  ]
  // FIX-22 / §9-26：术语表也是既有档 → 写前备份；备份失败则**不写**并如实回报喵
  const written = await writeWithBackup({ project, path, text: lines.join('\n'), stampIso: nowIso })
  // FIX-34：成功时 `error` 必须是 `null` 而不是"键在值是 undefined"（那会毁掉整条回执）喵
  return { path, terms: merged.size, added, ...writeOutcome(written) }
}

/** 术语表缺口报告喵（只报不动）：出现多次但没进术语表的关键词，建议人工补同义词喵。 */
export function glossaryGaps({ store, glossary, threshold = 2 }) {
  const counts = new Map()
  for (const doc of store.listDocs()) {
    for (const word of doc.keywords || []) counts.set(word, (counts.get(word) || 0) + 1)
  }
  const known = new Set()
  for (const entry of glossary || []) {
    known.add(entry.term)
    for (const synonym of entry.synonyms) known.add(synonym)
  }
  return [...counts.entries()]
    .filter(([word, count]) => count >= threshold && !known.has(word))
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }))
}

/**
 * 一轮治理**会写哪些文件**的预演喵（FIX-22）喵：只读盘、算三类明细喵。
 *
 * 三类：`将覆盖`（含旧指纹）/ `将新建` / `将改名` —— 实测一轮授权治理覆盖掉人家的人工 README，
 * 事后连"跑前长什么样"都拿不出来，所以人审前必须能看见这张清单喵。
 */
export async function buildWritePlan({ project, store, config, nowIso = new Date().toISOString() }) {
  const overwrite = new Map()
  const create = []
  // FIX-33：每个目标都带上 `+N/-M`（`-M>0` 还要带被删行）—— 数字取自**与真跑同一份** dryRun 结果喵
  const add = async (path, reason, stats = null) => {
    if (!path) return
    const entry = await planWrite({ project, path })
    const row = { path, reason, ...(stats || {}) }
    if (entry.action === 'overwrite') overwrite.set(path, { ...row, fingerprint: entry.fingerprint })
    else create.push(row)
  }
  const audit = await auditScan({ store, project, config })
  const indexPlan = await rebuildCoreDatabase({ project, store, report: audit, nowIso, dryRun: true })
  await add(indexPlan.path, '派生态索引', {
    added: indexPlan.added, removed: indexPlan.removed, removedLines: indexPlan.removedLines,
  })
  const pitfallPlan = await rebuildPitfallIndex({ project, store, nowIso, dryRun: true })
  await add(pitfallPlan.path, '坑库 README 索引合并', {
    added: pitfallPlan.added, removed: pitfallPlan.removed, removedLines: pitfallPlan.removedLines,
  })
  // 真身是**追加** changelog：条数取决于本轮实际动作 → 行数差标「未知」，不许瞎填 0 充数喵
  await add(coreDbPath(project), '真身 changelog 追加', { added: null, removed: null, removedLines: [] })

  const naming = await planNaming({ project, store })
  // 引用更新会**改写别的档**（实测里那篇人工 README 就是这么没的）→ 逐篇探一次，带引用行的行数差喵
  for (const move of naming.moves) {
    for (const doc of store.listDocs()) {
      if (doc.path === move.newPath) continue
      const file = await readFileIfPresent(doc.path)
      if (!file || !file.text.includes(move.oldPath)) continue
      const after = file.text.split(move.oldPath).join(move.newPath)
      const stats = diffStats(file.text, after)
      await add(doc.path, `引用更新：${basename(move.oldPath)} 已改名`, {
        added: stats.added, removed: stats.removed, removedLines: stats.removedLines,
      })
    }
  }
  return {
    overwrite: [...overwrite.values()],
    create,
    rename: naming.moves.map((move) => ({ from: move.oldPath, to: move.newPath })),
    audit,
    naming,
  }
}

/**
 * 馆员一轮治理喵（M4 交付物 2 的批次入口）喵。
 *
 * 顺序有讲究：**先去重 → 再命名规范化 → 再 tags 复核 → 重新审计 → 归档 → 最后写索引**喵。
 * 反过来的话，归档会把"该改名的档"先挪进 archive，改名就得在归档目录里做；
 * 而且审计算出的归档路径会指向改名前的旧路径，直接失效喵。
 * tags 复核放在审计**之前**，本轮审计才能看见 `doc_tags_stale` 已被消掉（FIX-25）喵。
 *
 * @param args.dryRun - 只出报告不落盘（不归档、不改名、不盖章、不写索引）喵。
 */
export async function librarianSweep({ project, store, config, dryRun = false, stampIso = new Date().toISOString() }) {
  // FIX-66：动手**之前**先留一份基线（逐篇正文指纹 + 审计计数）—— 验收报告靠它说"零改动"喵
  const bodiesBefore = await snapshotBodies({ store })
  const auditBefore = auditSummary(await auditScan({ store, project, config }))
  if (dryRun) {
    // FIX-22：试算必须给出「将覆盖（旧指纹）/ 将新建 / 将改名」三类明细 + 逐项行数差喵
    const plan = await buildWritePlan({ project, store, config })
    const audit = plan.audit
    const planned = audit.items.filter((item) => item.check === 'archive_suggest').length
    const naming = plan.naming
    // tags 复核在 dryRun 下是只读的 → 试算也能报出"会盖章几篇"喵
    const tags = await refreshStaleTags({ project, store, dryRun: true, now: stampIso })
    const relocateDry = await conformDocAreas({ project, store, dryRun: true, stampIso })
    // FIX-77：三条收口动作在预演里也要报（引用修复 / legacy 待归档标注 / `^` 表述订正）喵
    const refRepairDry = await repairDanglingRefs({ project, store, dryRun: true, stampIso })
    const archiveMarkDry = await markArchivePending({ project, store, dryRun: true })
    const caretFixDry = await correctCaretClaim({ project, store, dryRun: true })
    const dryActions = collectActions({ relocate: relocateDry, refRepair: refRepairDry, archiveMark: archiveMarkDry, caretFix: caretFixDry, plan: { overwrite: plan.overwrite, create: plan.create, rename: plan.rename }, naming, dryRun: true })
    return {
      todos: buildTodoList({ report: audit }),
      auditLevel: audit.level,
      dryRun: true,
      plan: { overwrite: plan.overwrite, create: plan.create, rename: plan.rename },
      archive: { moved: 0, refsUpdated: 0, files: [], failed: [], planned },
      dedupe: { moved: 0, duplicates: 0, files: [], failed: [], refsUpdated: 0 },
      naming: {
        moved: 0,
        candidates: naming.moves.length,
        files: naming.moves,
        // FIX-32：dryRun 里报出"有几篇的台账标题是脏的、会/已回写"（真跑时由 syncDocTitles 落）喵
        titlesFixed: 0,
        titlesPending: naming.titles.length,
        blocked: naming.blocked,
        failed: [],
        refsUpdated: 0,
      },
      tags,
      core: null,
      pitfall: null,
      glossaryGaps: [],
      relocate: relocateDry,
      refRepair: refRepairDry,
      archiveMark: archiveMarkDry,
      caretFix: caretFixDry,
      // FIX-66 ⑤：dryRun 也给**同一份报告的预演版**（"将移动 X / 将改名 Y / 将更新引用 Z"）喵
      verification: {
        dryRun: true,
        actions: dryActions,
        // 预演没落盘 ⇒ 正文自然一致（照实写，不假装"验过了"）喵
        bodyUnchanged: diffBodies(bodiesBefore, bodiesBefore),
        referenceLeftovers: [],
        auditDiff: auditDiff({ before: auditBefore, after: auditBefore }),
        note: '预演版：未落盘，故正文与审计计数都没变；引用残留要等真跑那一轮才有意义喵',
      },
    }
  }

  // 0-FIX-69) **先按类型归位**（去  前缀搬元数据 / 非 .md 搬去临时目录）—— 后面的去重与改名看到的才是整齐的目录喵
  const relocate = await conformDocAreas({ project, store, stampIso })
  // 0) FIX-32：先把**按文件名重算的标题**回写台账（去重也按 title 分组，脏标题会让去重判错）喵
  const syncTitles = await syncDocTitles({ project, store })
  // 1) 先去重再改名——反过来的话，重复档会被改成与新档同名而互相撞车喵
  const dedupe = await dedupeDocs({ project, store, stampIso })
  const naming = await normalizeNaming({ project, store, stampIso })
  // 1.5) FIX-25：tags 复核（正文新于头部的档重算 keywords + 盖章），赶在审计之前喵
  const tags = await refreshStaleTags({ project, store, now: stampIso })
  // 2) 用**规范化之后**的真实状态重新审计（归档路径必须是最新的）喵
  const audit = await auditScan({ store, project, config })
  const archivePaths = audit.items.filter((item) => item.check === 'archive_suggest').map((item) => item.target)
  // 3) 归档建议落地
  const archive = await archiveDocs({ project, store, paths: archivePaths, stampIso })
  // 4) 簿记：核心数据库 / 坑库索引 / 术语表缺口
  const core = await rebuildCoreDatabase({ project, store, report: audit, nowIso: stampIso })
  const pitfall = await rebuildPitfallIndex({ project, store, nowIso: stampIso })
  const gaps = glossaryGaps({ store, glossary: await loadGlossary(project) })

  // FIX-77 ①：**引用一致性修复**（搬完立刻收口；`recentMoves` 传本轮搬过的旧路径，报告分「存量」与「本轮」两类）喵
  const recentOldPaths = [
    ...((relocate && relocate.files) || []).map((file) => file.oldPath),
    ...((naming && naming.files) || []).map((move) => move.oldPath),
    ...((archive && archive.files) || []).map((file) => file.from),
  ].filter(Boolean)
  const refRepair = await repairDanglingRefs({ project, store, dryRun: false, recentMoves: recentOldPaths, stampIso })
  // FIX-77 ②：legacy 档补「待归档」标注（只动 front-matter）；③：订正对 `^` 的错误表述（**有意变更**）喵
  const archiveMark = await markArchivePending({ project, store, dryRun: false, stampIso })
  const caretFix = await correctCaretClaim({ project, store, dryRun: false, stampIso })

  // FIX-66：**验收报告**（插件自己把"改了什么/正文有没有动/引用干不干净/审计好转没有"算出来）喵
  const movedOldPaths = [
    ...((dedupe && dedupe.files) || []).map((file) => file.from),
    ...((archive && archive.files) || []).map((file) => file.from),
    ...((naming && naming.files) || []).map((move) => move.oldPath),
  ].filter(Boolean)
  const verification = {
    dryRun: false,
    actions: collectActions({ relocate, refRepair, archiveMark, caretFix, archive, dedupe, naming, tags, core, pitfall }),
    bodyUnchanged: diffBodies(bodiesBefore, await snapshotBodies({ store })),
    referenceLeftovers: await findReferenceLeftovers({ store, oldPaths: movedOldPaths }),
    auditDiff: auditDiff({ before: auditBefore, after: auditSummary(await auditScan({ store, project, config })) }),
  }

  return {
    todos: buildTodoList({ report: audit }),
    auditLevel: audit.level,
    dryRun: false,
    archive,
    dedupe,
    naming,
    tags,
    syncTitles,
    core,
    pitfall,
    glossaryGaps: gaps,
    relocate,
    refRepair,
    archiveMark,
    caretFix,
    // FIX-77 ③：`^` 表述订正是**用户授权的有意正文变更** —— 从"正文零改动"名单里单列出来喵
    intendedChanges: (caretFix && caretFix.fixed) || [],
    verification,
  }
}
