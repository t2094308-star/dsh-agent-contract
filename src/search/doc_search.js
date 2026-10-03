/**
 * `doc_search` —— 检索 L0 层喵（DESIGN §5.5「检索设计」）喵。
 *
 * **定位：先缩小范围 + 指路，绝不替代 `grep`**喵。
 * 做法严格按 §5.5：先查台账 `docs` 表做 L0 过滤 → **只对候选**做轻量匹配 → 排序 → 给 `suggest`喵。
 * 不扫全库、不返回整篇正文（正文交给宿主的 `read` 按 `readHints` 精读）喵。
 */
import { readFile } from 'node:fs/promises'
import { FIXED_SECTIONS, countChars } from '../ledger/docmeta.js'
import { parseMemberName } from '../ledger/naming.js'
import { isStopWord, realWords } from '../contract/slices.js'

/**
 * 文档数超此阈值就该切 FTS/BM25 实现（**工具签名不变**）喵。
 * M2.5 只留这个接口与注释，不真的实现 FTS喵。
 */
export const FTS_THRESHOLD = 1500

/** 排序权重：关键词 > 标题 > 正文——分数可解释，一眼看得出为什么排在前面喵。 */
export const SCORE_WEIGHTS = { keywords: 3, title: 2, body: 1 }

/** 每篇最多给几条命中行喵。 */
const MAX_SNIPPETS = 3

/** 每篇最多建议几节喵。 */
const MAX_SUGGESTS_PER_DOC = 2

/**
 * 解析查询串喵。
 * `/pattern/flags` 形态按正则；其余按空白切词，并**复用 FIX-2 的泛词表**剔掉泛词喵。
 * @returns `{ words, regex }`喵。
 */
export function parseQuery(query) {
  const raw = String(query ?? '').trim()
  if (!raw) return { words: [], regex: null }
  const asRegex = /^\/(.+)\/([a-z]*)$/.exec(raw)
  if (asRegex) {
    try {
      return { words: [], regex: new RegExp(asRegex[1], asRegex[2] || 'i') }
    } catch {
      /* 正则写错就退回关键词模式，不抛错喵 */
    }
  }
  return { words: realWords(raw.split(/\s+/)), regex: null }
}

/** 一段文本里是否命中某个词（大小写不敏感，字面包含）喵。 */
function hits(text, word) {
  return String(text ?? '').toLowerCase().includes(String(word).toLowerCase())
}

/** 词与关键词是否互含（关键词通常是短标签，互含能提高召回）喵。 */
function keywordHits(keywords, word) {
  const target = String(word).toLowerCase()
  return (keywords || []).some((item) => {
    const value = String(item).toLowerCase()
    return value.includes(target) || target.includes(value)
  })
}

/** front-matter 占掉的行数（命中行不该指向元数据，要从正文开始找）喵。 */
function frontMatterLines(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)*/.exec(String(text ?? ''))
  if (!match) return 0
  return match[0].split(/\r?\n/).length - 1
}

/** 收集命中行（≤3 条，跳过 front-matter）喵。 */
function collectSnippets(text, words, regex) {
  const snippets = []
  const lines = String(text ?? '').split(/\r?\n/)
  const start = frontMatterLines(text)
  for (let i = start; i < lines.length && snippets.length < MAX_SNIPPETS; i += 1) {
    const line = lines[i]
    const matched = regex ? regex.test(line) : words.some((word) => hits(line, word))
    if (matched && line.trim()) snippets.push({ line: i + 1, text: line.trim().slice(0, 200) })
  }
  return snippets
}

/** 取该文档里实际出现的固定小节喵。 */
function sectionsIn(text) {
  return FIXED_SECTIONS.filter((name) => new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm').test(String(text ?? '')))
}

/**
 * 挑建议精读的小节（DESIGN §5.5：`suggest` 输出 `路径#小节名`）喵。
 * 优先挑名字与查询词相关的，不够再按固定顺序补喵。
 */
function pickSections(present, words) {
  const related = present.filter((name) => words.some((word) => name.includes(word) || word.includes(name)))
  const rest = present.filter((name) => !related.includes(name))
  return [...related, ...rest].slice(0, MAX_SUGGESTS_PER_DOC)
}

/**
 * L0 检索喵。
 *
 * @param args.store - 台账 store（读路径已按 `project` 收窄）喵。
 * @param args.index - 可选：`index-sync` 的派生索引；给了就用它取记录（与 store 内容一致）喵。
 * @param args.query - 关键词（空白分隔）或 `/正则/flags`喵。
 * @param args.taskId / role / tier - L0 过滤条件喵。
 * @param args.limit - 最多返回几条，默认 10喵。
 * @returns `{ results, suggest, scanned, filtered, strategy }`喵。
 */
export async function docSearch({ store, index, query, taskId, role, tier, limit = 10 }) {
  const { words, regex } = parseQuery(query)
  if (!words.length && !regex) {
    // 纯泛词 / 空查询：这是**正确的零召回**，不是错误喵
    return { results: [], suggest: [], scanned: (index ? index.list() : store.listDocs()).length, filtered: 0, strategy: 'linear' }
  }

  // ---- L0：先过滤，再匹配（绝不全库扫描）喵 ----
  const all = index ? index.list() : store.listDocs()
  const scanned = all.length
  const candidates = all.filter((doc) => {
    if (taskId !== undefined && doc.taskId !== taskId) return false
    if (tier !== undefined && Number(doc.tier) !== Number(tier)) return false
    if (role !== undefined) {
      const parsed = doc.owner ? parseMemberName(doc.owner) : null
      if (!parsed || parsed.role !== role) return false
    }
    return true
  })
  const filtered = candidates.length

  // ---- 只对候选做轻量匹配喵 ----
  const results = []
  for (const doc of candidates) {
    let text = ''
    try {
      text = await readFile(doc.path, 'utf8')
    } catch {
      continue
    }
    // 统一命中判定：正则模式拿正则当唯一「词」，关键词模式逐词字面匹配喵
    const terms = regex ? [String(regex)] : words
    const matchIn = (value) => terms.filter((term) => (regex ? regex.test(String(value ?? '')) : hits(value, term)))
    const matchedKeywords = (doc.keywords || []).filter((item) => terms.some((term) =>
      regex ? regex.test(String(item)) : keywordHits([item], term)))
    const titleHit = matchIn(doc.title)
    const bodyHit = matchIn(text)
    const score = SCORE_WEIGHTS.keywords * matchedKeywords.length
      + SCORE_WEIGHTS.title * titleHit.length
      + SCORE_WEIGHTS.body * bodyHit.length
    if (score === 0) continue

    const present = sectionsIn(text)
    const suggestSections = pickSections(present, words.length ? words : [regex ? String(regex) : ''])
    results.push({
      doc,
      score,
      hitReason: [...new Set([...matchedKeywords.map(String), ...titleHit, ...bodyHit])].filter((word) => !isStopWord(word)),
      matchedIn: {
        keywords: matchedKeywords.map(String),
        title: titleHit,
        body: bodyHit,
      },
      snippets: collectSnippets(text, words, regex),
      suggestSections,
      chars: doc.chars ?? countChars(text),
    })
  }

  // ---- 排序：分数降序，同分按 updatedAt 新者优先喵 ----
  results.sort((a, b) => b.score - a.score
    || String(b.doc.updatedAt || '').localeCompare(String(a.doc.updatedAt || ''))
    || String(a.doc.path).localeCompare(String(b.doc.path)))

  const top = results.slice(0, Math.max(1, Number(limit) || 10))
  const suggest = []
  for (const row of top) {
    for (const section of row.suggestSections) suggest.push(`${row.doc.path}#${section}`)
  }

  return {
    results: top.map((row, rank) => ({
      rank: rank + 1,
      path: row.doc.path,
      tier: row.doc.tier,
      taskId: row.doc.taskId,
      chars: row.chars,
      keywords: row.doc.keywords || [],
      snippets: row.snippets,
      score: row.score,
      hitReason: row.hitReason,
      matchedIn: row.matchedIn,
    })),
    suggest,
    scanned,
    filtered,
    // 到量后内部换 FTS，签名不变（M2.5 只留位）喵
    strategy: scanned > FTS_THRESHOLD ? 'fts-reserved' : 'linear',
  }
}
