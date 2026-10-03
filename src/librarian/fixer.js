/**
 * 格式面直修喵（DESIGN §5.8 职责 2 / 本阶段边界 ①）喵。
 *
 * 分工原则：任务子智能体只对**内容**负责，格式问题由馆员直接修，**不退回返工**喵。
 * 因此这里只动元数据与结构，**正文一个字都不改**——结论是产出者的资产喵。
 *
 * 强制留痕（§5.8）：每次直修都要写 `librarianTouchedAt` 与 `librarianChanges[]`，
 * 让「谁改了我的档」永远可追喵。
 */
import { classifyLength, countChars, missingSections, parseFrontMatter, renderFrontMatter } from '../ledger/docmeta.js'
import { parseDocFileName } from '../ledger/naming.js'

/** 无法自动修、只能上报的问题码喵。 */
export const REPORT_ONLY = new Set(['l3_length', 'name_noncompliant', 'content_legacy'])

/** 由标题与任务号派生一组基础关键词（同义词靠人补，这里只保证不为空）喵。 */
function deriveKeywords(title, taskId, role) {
  const words = [title, taskId, role].map((item) => String(item ?? '').trim()).filter(Boolean)
  return [...new Set(words)]
}

/** 读取 front-matter 里馆员留痕字段喵。 */
function readTrace(meta) {
  return {
    librarianTouchedAt: typeof meta.librarianTouchedAt === 'string' ? meta.librarianTouchedAt : null,
    librarianChanges: Array.isArray(meta.librarianChanges) ? meta.librarianChanges : [],
  }
}

/**
 * 格式面巡检：不给结论，只报「哪里不合规、能不能自动修」喵。
 * @param args.text - 文档全文喵。
 * @param args.fileName - 文件名（用于档级与命名规范判定）喵。
 * @param args.siblingDocs - 同任务的其它档（用于判定三级档的绝对路径回贴）喵。
 * @returns `{ tier, legacy, issues: [{ code, detail, fixable }] }`喵。
 */
export function inspectDoc({ text, fileName, siblingDocs = [] }) {
  const source = String(text ?? '')
  const parsed = parseFrontMatter(source)
  const named = parseDocFileName(fileName)
  const meta = parsed.meta || {}
  const issues = []
  const metaTier = Number(meta.tier)
  const tier = named ? named.tier : (metaTier >= 1 && metaTier <= 3 ? metaTier : 0)

  if (parsed.meta === null) {
    issues.push({ code: 'fm_missing', detail: '缺 front-matter', fixable: true })
  } else {
    for (const key of ['taskId', 'role', 'tier', 'keywords', 'relatedFiles', 'createdAt']) {
      if (!(key in meta)) issues.push({ code: 'fm_field_missing', detail: `front-matter 缺字段 ${key}`, fixable: true })
    }
    // keywords 只对三档文档强制：tier 0（修复总结 / 已回填的旧档）本来就检索不到，不逼它凑关键词，
    // 否则「补不出关键词 → 每次巡检都判不合规」会破坏幂等喵
    if (tier >= 1 && Array.isArray(meta.keywords) && meta.keywords.length === 0) {
      issues.push({ code: 'keywords_empty', detail: 'keywords 为空（检索会完全命中不到）', fixable: true })
    }
  }

  if (parsed.meta !== null && tier >= 1) {
    for (const name of missingSections(parsed.body)) {
      issues.push({ code: 'section_missing', detail: `缺固定小节「${name}」`, fixable: true })
    }
  }

  // 三级档必须回贴一级/二级档的绝对路径（总纲 §6 + §5.5 产出规范）喵
  if (tier === 3 && siblingDocs.length) {
    const hasRef = siblingDocs.some((doc) => parsed.body.includes(doc.path))
    if (!hasRef) {
      issues.push({ code: 'ref_missing', detail: '三级档未回贴一级/二级档的绝对路径', fixable: true })
    }
  }

  if (tier === 3 && parsed.meta !== null) {
    const verdict = classifyLength(3, countChars(parsed.body))
    if (verdict.level !== 'ok') issues.push({ code: 'l3_length', detail: verdict.message, fixable: false })
  }

  if (named === null) {
    issues.push({ code: 'name_noncompliant', detail: '文件名不符合 <任务号>_<标题>_L<n>.md（降名规范化留给 M4）', fixable: false })
  }

  return { tier, legacy: parsed.meta === null, issues, meta, body: parsed.body }
}

/**
 * 直修：把可自动修的问题一次修掉，并写入留痕喵。
 *
 * 只做四件事，都不碰正文结论喵：
 * 1. 补齐 front-matter 与其必填字段
 * 2. 缺的固定小节补一个标题 + `（待补充）` 占位，等上一级或被指派的 agent 填内容
 * 3. 三级档末尾追加「关联文档」小节，回贴同任务一/二级档的绝对路径
 * 4. 写入 `librarianTouchedAt` / `librarianChanges[]`
 *
 * @returns `{ text, changes, remaining, changed }`；`changed` 为 false 时调用方不应落盘喵。
 */
export function fixDoc({ text, fileName, siblingDocs = [], taskId, role, now = new Date().toISOString() }) {
  const inspection = inspectDoc({ text, fileName, siblingDocs })
  const changes = []
  let meta = inspection.meta ? { ...inspection.meta } : {}
  let body = inspection.meta === null ? String(text ?? '') : inspection.body
  const fixable = inspection.issues.filter((issue) => issue.fixable)

  if (fixable.length === 0) {
    return { text: String(text ?? ''), changes: [], remaining: inspection.issues, changed: false, tier: inspection.tier }
  }

  const named = parseDocFileName(fileName)
  const resolvedTaskId = taskId || meta.taskId || (named ? named.taskId : null)
  const resolvedTitle = named ? named.title : null
  const resolvedTier = named ? named.tier : (Number(meta.tier) >= 1 && Number(meta.tier) <= 3 ? Number(meta.tier) : 0)

  // 1. front-matter 与必填字段喵
  if (inspection.legacy) changes.push('补写 front-matter')
  for (const key of ['taskId', 'role', 'tier', 'keywords', 'relatedFiles', 'createdAt']) {
    if (key in meta) continue
    meta[key] = null
    changes.push(`front-matter 补字段 ${key}`)
  }
  if (meta.taskId === null && resolvedTaskId) meta.taskId = resolvedTaskId
  meta.tier = resolvedTier
  if (meta.createdAt === null) meta.createdAt = now
  if (!Array.isArray(meta.relatedFiles)) meta.relatedFiles = []
  if (!Array.isArray(meta.keywords) || meta.keywords.length === 0) {
    meta.keywords = deriveKeywords(resolvedTitle, resolvedTaskId, meta.role)
    if (meta.keywords.length) changes.push(`keywords 由标题派生：${meta.keywords.join('、')}`)
  }

  // 2. 固定小节喵（只补标题与占位，不替产出者下结论）
  if (resolvedTier >= 1) {
    for (const name of missingSections(body)) {
      body = `${body.trimEnd()}\n\n## ${name}\n\n（待补充：由产出者或上级填写）\n`
      changes.push(`补固定小节「${name}」占位`)
    }
  }

  // 3. 三级档回贴一/二级档绝对路径喵
  if (resolvedTier === 3 && siblingDocs.length && !siblingDocs.some((doc) => body.includes(doc.path))) {
    const lines = siblingDocs.map((doc) => `- ${doc.path}`)
    body = `${body.trimEnd()}\n\n## 关联文档（绝对路径）\n\n${lines.join('\n')}\n`
    changes.push(`回贴 ${siblingDocs.length} 份关联档的绝对路径`)
  }

  // 4. 留痕喵
  const trace = readTrace(meta)
  meta.librarianTouchedAt = now
  meta.librarianChanges = [...trace.librarianChanges, ...changes]

  return {
    text: renderFrontMatter(meta) + body.replace(/^\n+/, ''),
    changes,
    remaining: inspection.issues.filter((issue) => !issue.fixable),
    changed: true,
    tier: resolvedTier,
  }
}
