/**
 * 派生物「区块内增量合并」喵（FIX-23 / DESIGN §9-28）喵。
 *
 * 实测教训：馆员重建坑库索引时**整篇覆盖**了 `仓库/docs/坑/README.md` ——
 * 34 行人工编排（任务类型对照表 + 专项坑清单 + 使用规则 4 条）被压成 20 行机器列表喵。
 *
 * 所以口径是喵：**派生物只拥有自己的标记区块**（`<!-- agent-contract:index:start/end -->`），
 * 区块之外**一个字都不动**；文件里若没有标记区块（历史手工档），就把区块**追加到文末**，
 * 而不是重排人家写好的内容喵。于是"人工段落逐字保留"是结构性保证，不靠自觉喵。
 *
 * 另附**行级 diff 统计**（`+N/-M`）：`-M > 0` 时把被删的行原样列出来 ——
 * dryRun 里给人审，真跑后进回执留痕喵。
 */

/** 机器区块的边界标记喵（HTML 注释，渲染时不可见）喵。 */
export const INDEX_BLOCK_START = '<!-- agent-contract:index:start -->'
export const INDEX_BLOCK_END = '<!-- agent-contract:index:end -->'

/**
 * 行级（多重集）diff 统计喵。
 *
 * 只关心"哪些行没了 / 哪些行多了"，不追求最小编辑距离 ——
 * 用于**风险提示**（删行要列出来）而不是生成补丁，多重集语义足够且天然幂等喵。
 */
export function diffStats(before, after) {
  const toLines = (text) => String(text ?? '').split('\n')
  const count = (lines) => {
    const map = new Map()
    for (const line of lines) map.set(line, (map.get(line) || 0) + 1)
    return map
  }
  const oldCount = count(toLines(before))
  const newCount = count(toLines(after))
  const removedLines = []
  const addedLines = []
  for (const [line, times] of oldCount) {
    const after_times = newCount.get(line) || 0
    for (let i = 0; i < times - after_times; i += 1) removedLines.push(line)
  }
  for (const [line, times] of newCount) {
    const before_times = oldCount.get(line) || 0
    for (let i = 0; i < times - before_times; i += 1) addedLines.push(line)
  }
  return {
    added: addedLines.length,
    removed: removedLines.length,
    removedLines,
    changed: removedLines.length > 0 || addedLines.length > 0,
  }
}

/**
 * 「最后更新」这类**时间戳**在比较时要中性化喵（FIX-35）喵。
 *
 * 否则每轮 sweep 都会因为"时间戳变了"被判成内容变化 → 整文件重写 → 每轮多一份备份、
 * `坑/README.md` 长期挂在 `git status` 的 M 上（语义幂等、**字节级非幂等**）喵。
 * 只中性化时间戳本身，那一行的其它文字（如"派生物·可重建"）照常参与比较喵。
 */
const TIMESTAMP_RE = /(最后更新：)[^\n）|]*/g

/** 把一行里的时间戳换成占位符，用于"内容指纹"比较喵。 */
export function stripVolatile(line) {
  return String(line ?? '').replace(TIMESTAMP_RE, '$1<T>')
}

/** 一组行 → 中性化文本（供比较与统计共用同一口径）喵。 */
function stableText(lines) {
  return lines.map(stripVolatile).join('\n')
}

/**
 * 把机器区块**合并**进既有文本喵（纯函数，便于断言）喵。
 *
 * **FIX-35 字节级幂等**：区块已存在时，先按"**不含时间戳**的内容指纹"比一次 ——
 * 内容没变就**整文件不写**（连时间戳都不动，返回 `changed:false`），
 * 只有内容真的变了才重写并刷新「最后更新」喵。
 *
 * @param existing - 既有文件内容（不存在传空串）喵。
 * @param blockLines - 机器区块的**内容行**（不含边界标记）喵。
 * @returns `{ text, added, removed, removedLines, changed }`喵。
 */
export function mergeIndexBlock(existing, blockLines) {
  const text = String(existing ?? '')
  const block = [INDEX_BLOCK_START, ...blockLines, INDEX_BLOCK_END].join('\n')
  const start = text.indexOf(INDEX_BLOCK_START)
  const end = start === -1 ? -1 : text.indexOf(INDEX_BLOCK_END, start)
  if (start !== -1 && end !== -1) {
    const oldLines = text.slice(start, end + INDEX_BLOCK_END.length).split('\n').slice(1, -1)
    const stats = diffStats(stableText(oldLines), stableText(blockLines))
    // FIX-35：内容（不含时间戳）没变 ⇒ **原样返回**，一个字节都不动（时间戳保持旧值）喵
    if (!stats.changed) return { text, added: 0, removed: 0, removedLines: [], changed: false }
    // 只换我们自己的区块：区块之前/之后的**每一个字节**都原样带回去（含空行）喵
    const head = text.slice(0, start)
    const tail = text.slice(end + INDEX_BLOCK_END.length)
    return {
      text: `${head}${block}${tail.startsWith('\n') || !tail ? tail : `\n${tail}`}`,
      ...stats,
      changed: true,
    }
  }
  // 历史手工档（没有标记区块）：**追加**区块到文末，绝不重排既有内容喵
  const next = text.trim() ? `${text.trimEnd()}\n\n${block}\n` : `${block}\n`
  return { text: next, ...diffStats(text, next) }
}
