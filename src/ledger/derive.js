/**
 * 元数据自动派生器喵（DESIGN §5.5「元数据自动派生优先」）喵。
 *
 * 原则：**能用确定性代码派生的，绝不叫模型**喵。
 * `doc_emit` 与 `ledger_rebuild` 都内置本模块，全程零模型调用喵。
 *
 * 派生不出来的东西**不猜**，而是落进 `needs_librarian[]`——
 * 只有该清单非空时才唤醒馆员，省唤醒、省 token喵。
 */
import { readFile } from 'node:fs/promises'
import { countChars, missingSections, parseFrontMatter } from './docmeta.js'
import { listMarkdown, readFileIfPresent, listMarkdownDeep } from './fs.js'
import { parseDocFileName, slug } from './naming.js'
import { extractKeywords, isStopWord } from '../contract/slices.js'
import { joinUnderRoot } from '../project.js'

/** 派不出来的原因码喵。 */
export const NEEDS_CODES = {
  taskidUnknown: 'taskid_unknown',
  legacyNoTier: 'legacy_no_tier',
  keywordsGeneric: 'keywords_generic',
  duplicateSuspect: 'duplicate_suspect',
}

/**
 * 泛词判定喵。
 * **与切片命中原因共用同一份停用词表**（DESIGN §9-13）——
 * 两处各维护一份，必然出现"这边拦了那边漏了"喵。
 */
export const isGenericKeyword = isStopWord

/** 术语表默认文件名（与核心数据库同级）喵。 */
export const GLOSSARY_FILE = '术语表.md'

/** 术语表路径：优先 `docsDirs[0]`，没配时退回产出目录喵。 */
export function glossaryPath(project) {
  const dir = (project.docsDirs && project.docsDirs[0]) || project.deliverablesDir
  return joinUnderRoot(dir, GLOSSARY_FILE)
}

/**
 * 读术语表喵（文件不存在时返回空表，不抛错——术语表是可选资产）喵。
 * @returns `[{ term, synonyms }]`喵。
 */
export async function loadGlossary(project) {
  try {
    return parseGlossary(await readFile(glossaryPath(project), 'utf8'))
  } catch {
    return []
  }
}

/**
 * 解析术语表喵。
 * 行格式：`- 主词 | 同义词1 | 同义词2`（首列为主词，其余为同义词）喵。
 * @returns `[{ term, synonyms }]`喵。
 */
export function parseGlossary(text) {
  const entries = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('-')) continue
    const parts = line.replace(/^-\s*/, '').split('|').map((item) => item.trim()).filter(Boolean)
    if (parts.length < 2) continue
    entries.push({ term: parts[0], synonyms: parts.slice(1) })
  }
  return entries
}

/**
 * 术语表同义词展开喵（全自动，术语表本身由人/馆员维护）喵。
 * 命中规则：主词或任一同义词出现在词里，或词出现在主词里，就算同一术语族喵。
 * @returns 去重后的关键词数组喵。
 */
export function expandKeywords(words, glossary = []) {
  const out = []
  const push = (word) => {
    const value = String(word ?? '').trim()
    if (value && !out.includes(value)) out.push(value)
  }
  for (const word of words) {
    push(word)
    const value = String(word ?? '').trim().toLowerCase()
    if (!value) continue
    for (const entry of glossary) {
      const family = [entry.term, ...entry.synonyms]
      const hit = family.some((item) => {
        const candidate = String(item).toLowerCase()
        return candidate && (value.includes(candidate) || candidate.includes(value))
      })
      if (hit) family.forEach(push)
    }
  }
  return out
}

/** 抓取正文里出现的文件路径（绝对路径优先，也认带扩展名的相对路径）喵。 */
export function extractPaths(text) {
  const source = String(text ?? '')
  const found = []
  const push = (value) => {
    const path = String(value ?? '').trim().replace(/[，。；、）)】」』"']+$/, '')
    if (path && !found.includes(path)) found.push(path)
  }
  for (const match of source.match(/[A-Za-z]:[\\/][^\s，。；）)"'\]】]+/g) || []) push(match)
  // POSIX 路径（相对或绝对都吃），必须带上首段，否则 `src/ledger/store.js` 会被截成 `/ledger/store.js`喵
  for (const match of source.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.\w+/g) || []) push(match)
  for (const match of source.match(/[\w一-龥.-]+\.(?:md|js|mjs|ts|json|ya?ml|txt|py|java|cs)\b/g) || []) push(match)
  // 三个正则会在同一条路径上重叠命中（`src/ledger/store.js` 同时给出 `/ledger/store.js` 与 `store.js`），
  // 这里把「是别人子串」的碎片去掉，只留最长的那份喵
  const longest = found.filter((path) => !found.some((other) => other.length > path.length && other.includes(path)))
  return longest.slice(0, 20)
}

/** 取固定小节下的正文内容（用于提取名词）喵。 */
export function sectionContent(body, names) {
  const text = String(body ?? '')
  const wanted = new Set(names)
  const chunks = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s*(.+?)\s*$/.exec(line)
    if (heading) {
      current = wanted.has(heading[1]) ? heading[1] : null
      continue
    }
    if (current) chunks.push(line)
  }
  return chunks.join('\n')
}

/**
 * 派生一份文档的全部元数据喵。
 *
 * @param args.fileName - 文件名（档级/任务号的机器来源）喵。
 * @param args.text - 文档全文喵。
 * @param args.mtime - 文件 mtime（毫秒）或已格式化的时间串喵。
 * @param args.glossary - `parseGlossary()` 的结果喵。
 * @param args.overrides - 调用方显式给的值（`doc_emit` 的参数），优先级高于派生喵。
 * @param args.memberRole - 写档成员的角色 id（谁调的 `doc_emit`）喵。
 * @param args.legacy - 该档是否为「无 front-matter 的存量旧档」（只有旧档才报 `legacy_no_tier`）喵。
 * @returns `{ taskId, tier, role, createdAt, chars, relatedFiles, keywords, legacy, needsLibrarian }`喵。
 */
export function deriveDocMeta({ fileName, text, mtime, glossary = [], overrides = {}, memberRole = null, legacy = false }) {
  const source = String(text ?? '')
  // FIX-19：front-matter 的 taskId 是**权威**的，用它精确剥离文件名前缀取标题；
  // 用"第一个下划线"猜会在任务号含下划线时把标题切成半截，再拼名就成了 `T-800_A_A_…` 喵
  const named = parseDocFileName(fileName, overrides.taskId)
  const needsLibrarian = []

  const taskId = overrides.taskId || (named ? named.taskId : null)
  if (!taskId) needsLibrarian.push({ code: NEEDS_CODES.taskidUnknown, detail: '文件名与调用参数都判不出任务号' })

  const metaTier = Number(overrides.tier)
  const tier = named
    ? named.tier
    : (metaTier >= 1 && metaTier <= 3 ? metaTier : 0)
  // 只有真正的存量旧档才报「无档级后缀」：修复总结这类 tier 0 新档天生没有 _L 后缀，不该天天骚扰馆员喵
  if (legacy && !named) {
    needsLibrarian.push({ code: NEEDS_CODES.legacyNoTier, detail: '存量旧档文件名没有 _L1/_L2/_L3 后缀，判不出档级' })
  }

  const createdAt = typeof mtime === 'number'
    ? new Date(mtime).toISOString()
    : (mtime || overrides.createdAt || new Date().toISOString())

  const title = named ? named.title : (overrides.title || null)
  const bodyForKeywords = tier >= 1 ? sectionContent(source, ['结论', '依据', '风险与待确认', '下一步']) : source
  const baseWords = [
    title,
    ...(Array.isArray(overrides.keywords) ? overrides.keywords : []),
    ...extractKeywords(`${title || ''} ${bodyForKeywords}`, 8),
  ].filter(Boolean)
  const keywords = expandKeywords(baseWords, glossary).filter((word) => !isGenericKeyword(word))
  // 关键词只对三档文档强制：tier 0（修复总结等）不参与检索，逼它凑关键词只会天天误报喵
  if (tier >= 1 && keywords.length === 0) {
    needsLibrarian.push({ code: NEEDS_CODES.keywordsGeneric, detail: '关键词全为泛词或提取不到，检索无从命中' })
  }

  const relatedFiles = [
    ...(Array.isArray(overrides.relatedFiles) ? overrides.relatedFiles : []),
    ...extractPaths(source),
  ].filter((value, index, all) => all.indexOf(value) === index)

  return {
    taskId,
    tier,
    role: overrides.role || memberRole || null,
    title,
    createdAt,
    chars: countChars(source),
    relatedFiles,
    keywords,
    legacy: false,
    missingSections: tier >= 1 ? missingSections(source) : [],
    needsLibrarian,
  }
}

/**
 * 从一份磁盘文件派生元数据喵。
 * `scanNeedsLibrarian` / `ledger_rebuild` / `ledger_backfill` 共用这一个口径，
 * 免得三处各自派生导致「一个说空、一个说 204 条」喵。
 */
export function deriveFromFile({ fileName, text, mtime, glossary = [] }) {
  const parsed = parseFrontMatter(text)
  const legacy = parsed.meta === null
  const body = legacy ? text : parsed.body
  const meta = parsed.meta || {}
  const derived = deriveDocMeta({
    fileName,
    text: body,
    mtime,
    glossary,
    legacy,
    overrides: {
      taskId: typeof meta.taskId === 'string' && meta.taskId ? meta.taskId : undefined,
      role: typeof meta.role === 'string' && meta.role ? meta.role : undefined,
      tier: Number(meta.tier) || undefined,
      keywords: Array.isArray(meta.keywords) ? meta.keywords : undefined,
      relatedFiles: Array.isArray(meta.relatedFiles) ? meta.relatedFiles : undefined,
    },
  })
  return { parsed, legacy, body, meta, derived }
}

/**
 * 唯一的 `needs_librarian` 口径：**扫磁盘现算**，不信任台账里的旧快照喵。
 *
 * `librarian_patrol` 的唤醒闸门与 `ledger_backfill --dryRun` 的条数都必须调它，
 * 否则会出现「闸门空转 / 预演一堆待办」的两口径喵。
 * @returns `{ scanned, items }`，items 已含 `duplicate_suspect`喵。
 */
export async function scanNeedsLibrarian({ project }) {
  const glossary = await loadGlossary(project)
  const rows = []
  for (const name of await listMarkdownDeep(project.deliverablesDir)) {
    const path = joinUnderRoot(project.deliverablesDir, name)
    const file = await readFileIfPresent(path)
    if (!file) continue
    const { derived } = deriveFromFile({ fileName: name, text: file.text, mtime: file.mtime, glossary })
    rows.push({
      path,
      taskId: derived.taskId,
      tier: derived.tier,
      title: derived.title,
      needsLibrarian: derived.needsLibrarian,
    })
  }
  markDuplicates(rows)
  const items = rows.flatMap((row) => row.needsLibrarian.map((item) => ({
    path: row.path,
    taskId: row.taskId,
    code: item.code,
    detail: item.detail,
  })))
  return { scanned: rows.length, items }
}

/**
 * 在一批文档记录上找疑似重复档喵（同任务号 + 同档级 + 同标题归一化）喵。
 * 重复的档全部打上 `duplicate_suspect` 并加入 `needsLibrarian`喵。
 * @returns 新增的 `needsLibrarian` 条数喵。
 */
export function markDuplicates(records) {
  const groups = new Map()
  for (const record of records) {
    if (!record.taskId) continue
    const key = `${record.taskId}|${record.tier}|${slug(record.title || '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  let marked = 0
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    for (const row of rows) {
      if (row.needsLibrarian.some((item) => item.code === NEEDS_CODES.duplicateSuspect)) continue
      row.needsLibrarian.push({
        code: NEEDS_CODES.duplicateSuspect,
        detail: `疑似重复档：同任务号同档级同标题共 ${rows.length} 份`,
      })
      marked += 1
    }
  }
  return marked
}
