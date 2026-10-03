/**
 * 产出档案的形态规范喵：front-matter / 固定小节名 / 长度分级喵。
 *
 * 设计取向（DESIGN §5.5「文档增长策略」）喵：**不省字数，省查找**。
 * 所以这里的长度规则除三级文档外都只记警告，绝不拒写——文档写得长不是错，找不到才是错喵。
 *
 * 注：front-matter 由 `doc_emit` 自己生成，不交给模型拼 YAML，
 * 因此「必须有 front-matter」是结构性强制，而不是靠事后审计才发现缺喵。
 */

/** front-matter 必填字段（顺序即渲染顺序）喵。 */
export const FRONT_MATTER_KEYS = ['taskId', 'role', 'tier', 'keywords', 'relatedFiles', 'createdAt']

/** 固定小节名，供 M2.5 的 `readHints` 精确指路喵。 */
export const FIXED_SECTIONS = ['结论', '依据', '风险与待确认', '下一步']

/** 馆员直修留痕字段（DESIGN §5.8 强制）喵；有值时才渲染喵。 */
export const LIBRARIAN_KEYS = ['librarianTouchedAt', 'librarianChanges']

/**
 * 长度策略喵（按字符数，忽略空白）喵。
 * - 三级文档：250~300 字是总纲的硬要求，超出只**强警告**（仍不拒写，与警告制一致）喵。
 * - 一级 / 二级：放开，只记 `oversize_doc`；一级沿用 DESIGN §5.4 的 3000 字口径喵。
 */
export const LENGTH_POLICY = {
  3: { min: 250, max: 300, oversize: 300 },
  1: { oversize: 3000 },
  2: { oversize: 6000 },
}

/** 渲染单行 front-matter喵。 */
function renderLine(key, value) {
  if (Array.isArray(value)) return `${key}: ${JSON.stringify(value)}`
  if (value === undefined || value === null) return `${key}: null`
  return `${key}: ${String(value)}`
}

/**
 * 渲染 front-matter 块喵。
 * 六个必填字段总是写出来（缺值为 null）；馆员留痕字段与其它额外字段只在存在时写喵。
 * 数组用 JSON 流式写法，既是合法 YAML 也能被 JSON.parse 逐值解析喵。
 */
export function renderFrontMatter(meta) {
  const source = meta || {}
  const lines = ['---']
  for (const key of FRONT_MATTER_KEYS) lines.push(renderLine(key, source[key]))
  const extras = [
    ...LIBRARIAN_KEYS.filter((key) => key in source),
    ...Object.keys(source).filter((key) => !FRONT_MATTER_KEYS.includes(key) && !LIBRARIAN_KEYS.includes(key)),
  ]
  for (const key of extras) lines.push(renderLine(key, source[key]))
  lines.push('---')
  // 闭合线后留一个空行，正文与 front-matter 视觉分离喵
  return `${lines.join('\n')}\n\n`
}

/** 解析单行的标量/内联数组值喵（数组走 JSON，其余按标量）喵。 */
function parseValue(raw) {
  const value = raw.trim()
  if (value === 'null' || value === '') return null
  // FIX-77：布尔值要**真的还原成布尔** —— 否则 `archivePending: true` 读回来是字符串 `'true'`，
  // 判据里写 `=== true` 会永远不成立（FIX-69 的 `archived: true` 同理）喵
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return unquote(value)
}

/** 剥掉成对的引号喵。 */
function unquote(value) {
  const text = String(value ?? '').trim()
  const quoted = /^(['"])(.*)\1$/.exec(text)
  return quoted ? quoted[2] : text
}

/**
 * 解析文档的 front-matter喵。
 *
 * **列表值按 `- ` 行解析，绝不按冒号切分**（DESIGN §9-14）：
 * `- D:\DSH插件\…` 会被"第一个冒号"切成 `D` + 值，把 Windows 路径写坏，
 * 重渲染时还会退化成 `null` + 孤立行喵。
 *
 * 同时支持内联 JSON 数组（`keywords: ["a","b"]`，也就是 `renderFrontMatter` 的写法），
 * 两者解析结果一致，保证 `render → parse → render` 往返稳定喵。
 *
 * @param text - 文档全文喵。
 * @returns `{ meta, body }`；没有 front-matter 时 `meta` 为 null喵。
 */
export function parseFrontMatter(text) {
  const source = String(text ?? '')
  // 闭合线后允许空行（我们自己就会写一个空行分隔正文）喵
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/.exec(source)
  if (!match) return { meta: null, body: source }

  const meta = {}
  /** 声明了冒号却换行的键——可能是块状列表，也可能是空值喵。 */
  const pendingListKeys = new Set()
  let listKey = null

  for (const raw of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw)
    if (item) {
      // 列表项：整行剥掉 `- ` 前缀，剩下的原样收下（路径里的冒号不动）喵
      if (listKey) meta[listKey].push(unquote(item[1]))
      continue
    }
    const kv = /^([A-Za-z][\w.-]*)\s*:\s*(.*)$/.exec(raw)
    if (!kv) continue
    const key = kv[1]
    const rest = kv[2].trim()
    if (rest === '') {
      meta[key] = []
      listKey = key
      pendingListKeys.add(key)
      continue
    }
    listKey = null
    meta[key] = parseValue(rest)
  }

  // 声明了却没有列表项的键回落成 null（与 renderFrontMatter 写 `null` 的口径一致）；
  // 内联的 `[]` 不在此列，否则往返会从 `[]` 退化成 `null`喵
  for (const key of pendingListKeys) {
    if (Array.isArray(meta[key]) && meta[key].length === 0) meta[key] = null
  }
  return { meta, body: source.slice(match[0].length) }
}

/** 返回正文里缺失的固定小节名喵（小节以 `## 名称` 标题形式存在即算命中）喵。 */
export function missingSections(body) {
  const text = String(body ?? '')
  return FIXED_SECTIONS.filter((name) => !new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm').test(text))
}

/** 统计字符数（忽略空白，与契约预算同一口径）喵。 */
export function countChars(text) {
  return String(text ?? '').replace(/\s/g, '').length
}

/**
 * 判定一份产出档的长度档位喵。
 * @returns `{ level: 'ok' | 'strong' | 'oversize', message }`喵。
 */
export function classifyLength(tier, chars) {
  const policy = LENGTH_POLICY[Number(tier)]
  if (!policy) return { level: 'ok', message: '' }
  if (policy.min !== undefined && chars < policy.min) {
    return { level: 'strong', message: `${tier} 级文档偏短：${chars} < ${policy.min} 字（总纲要求 ${policy.min}~${policy.max}）` }
  }
  const limit = policy.max ?? policy.oversize
  if (chars > limit) {
    const label = policy.max === undefined ? 'oversize_doc' : '强警告'
    return {
      level: policy.max === undefined ? 'oversize' : 'strong',
      message: `${tier} 级文档超长：${chars} > ${limit} 字（${label}；警告制，不拒写）`,
    }
  }
  return { level: 'ok', message: '' }
}
