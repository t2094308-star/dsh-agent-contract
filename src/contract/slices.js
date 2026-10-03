/**
 * 任务切面与文档切片检索喵。
 *
 * 两条硬口径来自 DESIGN §5.2 / §9-12·13喵：
 * - **禁止搬运正文**：任务切面只给「任务号 + 任务文件绝对路径 + 上级补充指令 + 项目简介 + debug 清单」，
 *   任务文件正文一个字都不许进装配文本（总纲第 4 条已要求子智能体自己去读）喵。
 * - **停用词表要足够宽**：`研究/产出/只读/docs/md/png/文件/仓库/待办/任务` 一律不得作为切片命中原因喵。
 *
 * 本模块只读文件系统，不做任何写入喵。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { FIXED_SECTIONS } from '../ledger/docmeta.js'
import { joinUnderRoot } from '../project.js'

/** 统计字符数（忽略空白，中英统一按字符计）喵。 */
export function countChars(text) {
  return String(text ?? '').replace(/\s/g, '').length
}

/**
 * 停用词 / 泛词表喵（DESIGN §9-13）喵。
 * 同时用于三处：分词过滤、切片命中原因白名单、`derive.js` 的关键词判定——
 * 三处共用一份，才不会出现"这边拦了那边漏了"喵。
 */
export const STOP_WORDS = new Set([
  // 中文虚词
  '的', '了', '和', '与', '或', '在', '是', '为', '对', '把', '被', '这', '那', '有', '无',
  '以', '及', '并', '中', '上', '下', '个', '们', '你', '我', '他', '它', '不', '也', '要',
  // 中文泛词（不得作为命中原因）
  '研究', '产出', '只读', '文件', '仓库', '待办', '任务', '文档', '内容', '说明', '记录',
  '项目', '总结', '信息', '变更', '注意', '详情', '其他', '其它', '相关', '简介',
  '结论', '依据', '风险', '风险与待确认', '待确认', '待补充',
  // 英文虚词 / 泛词
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'you', 'it',
  'doc', 'docs', 'note', 'notes', 'todo', 'info', 'summary', 'detail', 'details', 'misc',
  // FIX-50：英文通用词（**刻意不收 `read`/`write`/`edit`/`pwsh`/`doc_emit` 这类工具名** ——
  // 验收②要求"工具名有区分度、不该被剔"；确实嫌吵的项目可以用 `search.stopWords` 自己加）喵
  'tool', 'tools', 'probe', 'error', 'errors', 'file', 'files', 'code', 'line', 'lines',
  'test', 'tests', 'run', 'runs', 'log', 'logs', 'true', 'false', 'null', 'undefined',
  'function', 'const', 'return', 'import', 'export', 'default', 'async', 'await', 'class', 'type',
  // 文件扩展名（基本没有检索价值）
  'md', 'png', 'jpg', 'jpeg', 'svg', 'js', 'mjs', 'ts', 'json', 'yaml', 'yml', 'txt',
])

/**
 * 该词是否属于泛词/停用词喵。长度 <2 也算（单字没有检索价值）喵。
 * @param extra - **额外**停用词（项目名 / `search.stopWords` 配置）喵。
 */
export function isStopWord(word, extra = null) {
  const value = String(word ?? '').trim().toLowerCase()
  if (value.length < 2) return true
  if (STOP_WORDS.has(value)) return true
  if (!extra) return false
  const set = extra instanceof Set ? extra : new Set(Array.isArray(extra) ? extra : [extra])
  return set.has(value)
}

/** 保留实词喵（`extra` 里的词同样视为泛词）喵。 */
export function realWords(words, extra = null) {
  return (words || []).map((word) => String(word)).filter((word) => !isStopWord(word, extra))
}

/**
 * 本项目该把哪些词额外视为泛词喵（FIX-50）喵：**项目名/产品名**（如 `blockdustry`）几乎每篇都出现，
 * 拿它当命中原因等于没信息；再叠加用户配置的 `search.stopWords`喵。
 * 项目名从 `config.project.name` 取（并同时收它的紧凑形式，去掉空格/连字符）喵。
 */
export function searchStopWords(config) {
  const extra = new Set()
  const configured = config && config.search && Array.isArray(config.search.stopWords) ? config.search.stopWords : []
  for (const word of configured) {
    const value = String(word ?? '').trim().toLowerCase()
    if (value) extra.add(value)
  }
  const projectName = config && config.project ? String(config.project.name || '') : ''
  const compact = projectName.trim().toLowerCase()
  if (compact) {
    extra.add(compact)
    extra.add(compact.replace(/[\s_\-]+/g, ''))
  }
  return extra
}

/**
 * 从文本里提取关键词喵。
 * 拉丁词按单词切，中文按 2-gram 切（无分词依赖）喵；泛词一律剔除喵。
 * @returns 关键词数组，按出现频次降序喵。
 */
export function extractKeywords(text, max = 12) {
  const source = String(text ?? '')
  const counts = new Map()
  const bump = (word) => {
    if (isStopWord(word)) return
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  for (const word of source.toLowerCase().match(/[a-z0-9_]{2,}/g) || []) bump(word)
  for (const run of source.match(/[一-龥]{2,}/g) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) bump(run.slice(i, i + 2))
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word)
}

/** 列出目录下的 .md 文件（目录不存在时返回空数组，不抛错）喵。 */
async function listMarkdown(dir) {
  try {
    const names = await readdir(dir)
    return names.filter((name) => name.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
}

/**
 * 在任务目录里定位任务文件喵（**只定位，不读正文**，DESIGN §9-12）喵。
 * 依次尝试：`<taskId>.md` → 忽略大小写的同名 → 以 taskId 开头的第一个 .md 喵。
 * @returns 绝对路径；找不到时返回 null 喵。
 */
export async function findTaskFile(project, taskId) {
  const id = String(taskId || '').trim()
  if (!id) return null
  const names = await listMarkdown(project.tasksDir)
  const wanted = id.toLowerCase().endsWith('.md') ? id.toLowerCase() : `${id.toLowerCase()}.md`
  const exact = names.find((name) => name.toLowerCase() === wanted)
  if (exact) return joinUnderRoot(project.tasksDir, exact)
  const prefix = names.find((name) => name.toLowerCase().startsWith(id.toLowerCase()))
  return prefix ? joinUnderRoot(project.tasksDir, prefix) : null
}

/**
 * 任务切面的机器部分喵：**只有任务号与任务文件绝对路径**，没有正文喵。
 * @returns `{ path, found }`喵。
 */
export async function locateTask(project, taskId) {
  const path = await findTaskFile(project, taskId)
  return { path, found: Boolean(path) }
}

/**
 * 项目简介：直接取配置里的字符串喵。
 * 通用引擎不该猜项目文档放在哪，所以由项目配置显式提供喵。
 */
export function projectBrief(config) {
  const brief = config && config.project && config.project.brief
  return typeof brief === 'string' ? brief.trim() : ''
}

/**
 * 列出与任务相关的 debug 文件（[位置] 目录下以任务号开头的 .md）喵。
 */
export async function debugFileList(project, taskId) {
  const id = String(taskId || '').trim()
  if (!id) return []
  const names = await listMarkdown(project.deliverablesDir)
  return names.filter((name) => name.startsWith(id) || name.toLowerCase().startsWith(id.toLowerCase()))
}

/** 取该文档里出现的固定小节名，作为 `readHints`（建议读哪几节）喵。 */
function readHintsOf(text) {
  return FIXED_SECTIONS.filter((name) => new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm').test(text))
}

/**
 * 引文例外通道的上限喵（FIX-48）喵：至多前 N 篇带引文，且引文 ≤200 字符喵。
 */
export const EXCERPT_CAP = 200
export const EXCERPT_TOP = 2

/**
 * 文档切片段的总字数上限喵（FIX-48）喵：超了就先丢引文（只留路径 + 命中原因 + readHints）喵。
 */
export const SLICE_BUDGET = 1200

/** 「到处都是」的门槛喵（FIX-50 ④：命中 ≥3 篇的词不再作为命中原因）喵。 */
export const DF_IGNORE = 3

/**
 * 关键词检索文档切片喵。
 *
 * 按 DESIGN §5.2：**只给「路径 + 命中原因 + readHints」**，**默认不给正文**喵（FIX-48）——
 * 需要内容时让子代理按 readHints 自己去 `read`（这正是"禁搬运"的纪律）喵。
 *
 * 三条纪律喵：
 * ① 泛词/项目名/英文通用词**不得**作为命中原因（FIX-2 / FIX-50；额外停用词由 `searchStopWords()` 提供）；
 * ② 命中原因取**最有区分度的 2~3 个词**：先按"命中它的文档数"升序（越少越有区分度），再按词长降序喵；
 * ③ 命中 ≥`dfIgnore` 篇的词视为"到处都是"（项目名就是典型）→ 它单独**不得**作为命中原因；
 *    若一片里一个强信号词都不剩，就**不召回**它（宁缺勿滥）喵。
 *
 * @param limit - 最多返回几条切片喵。
 * @param options.excerptChars - 例外引文的字符上限（硬性 ≤200）喵。
 * @param options.excerptTop - 例外引文只给排进前几篇（默认 2）喵。
 * @param options.stopWords - 额外停用词（项目名 / 配置）喵。
 * @param options.dfIgnore - "到处都是"的文档数门槛喵。
 */
export async function searchDocs(project, keywords, limit = 5, options = {}) {
  const {
    excerptChars = EXCERPT_CAP,
    excerptTop = EXCERPT_TOP,
    stopWords = null,
    dfIgnore = DF_IGNORE,
  } = options || {}
  const words = [...new Set(realWords(keywords, stopWords).map((word) => word.toLowerCase()))]
  if (!words.length) return []
  const cap = Math.min(Number(excerptChars) || EXCERPT_CAP, EXCERPT_CAP)
  const scanned = []
  const docFrequency = new Map()
  for (const dir of project.docsDirs || []) {
    for (const name of await listMarkdown(dir)) {
      const path = joinUnderRoot(dir, name)
      let raw = ''
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        raw = await readFile(path, 'utf8')
      } catch {
        continue
      }
      const haystack = `${name}
${raw}`.toLowerCase()
      const hit = words.filter((word) => haystack.includes(word))
      if (hit.length === 0) continue
      for (const word of hit) docFrequency.set(word, (docFrequency.get(word) || 0) + 1)
      scanned.push({ path, title: name.replace(/\.md$/i, ''), raw, hit })
    }
  }
  const hits = []
  for (const doc of scanned) {
    // ③ "到处都是"的词不当命中原因；强信号词一个不剩 ⇒ 这片不召回喵
    const strong = doc.hit.filter((word) => (docFrequency.get(word) || 0) < Math.max(1, Number(dfIgnore) || DF_IGNORE))
    if (!strong.length) continue
    const ranked = [...strong].sort((a, b) => (docFrequency.get(a) || 0) - (docFrequency.get(b) || 0) || b.length - a.length)
    hits.push({
      path: doc.path,
      title: doc.title,
      score: ranked.length,
      hitReason: ranked.slice(0, 3),
      strongHits: ranked.length,
      readHints: readHintsOf(doc.raw),
      raw: doc.raw,
    })
  }
  const sorted = hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
  // ② 例外通道：**强信号词 ≥2 且排进前 excerptTop** 才附引文 —— 低相关召回一律不带引文喵（FIX-48）
  sorted.forEach((entry, index) => {
    if (index < Math.max(1, Number(excerptTop) || EXCERPT_TOP) && entry.strongHits >= 2) {
      entry.excerpt = String(entry.raw).slice(0, cap)
    }
    delete entry.raw
  })
  return sorted
}
