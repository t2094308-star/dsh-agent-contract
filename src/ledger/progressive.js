/**
 * **渐进式披露**喵（FIX-70）喵：三档之间用元数据指针串起来，L3 / L2 的终点都是 L1喵。
 *
 * 用户口径喵：「做好渐进式披露，L3、L2 文件的渐进式披露就是 L1」—— 读概括档的人需要细节时，
 * 顺着**元数据里的指针**就能下钻到更细的档，最终落到 L1（详细归纳）喵。
 *
 * 指针（写进 front-matter，人和 AI 都一眼看懂）喵：
 * - L3（高度概括）→ `nextTier: <L2 绝对路径>` + `fullDetail: <L1 绝对路径>`
 * - L2（扩充细节）→ `fullDetail: <L1 绝对路径>`
 * - L1（详细归纳）→ `detailLevel: 'full'`（**终点**，没有下钻指针）喵
 *
 * 为什么要有指针而不是只看 `relatedFiles`：实测 `relatedFiles` 里混进了带反引号的脏路径、
 * 甚至半截路径（`D:\Blockdustry\[Agent进度`），**语义不明**；指针是**显式**的，
 * 而且"下一层去看哪一份"有唯一答案喵。
 */

/** 指针字段名（写进 front-matter 的三个键）喵。 */
export const POINTER_KEYS = ['nextTier', 'fullDetail', 'detailLevel']

/** 档级 → 谁看（速览第二行用）喵。 */
export const TIER_AUDIENCE = {
  3: '上级 / 主代理（只想知道结论）',
  2: '需要细节的执行者',
  1: '长期留档与全量核查',
}

/**
 * 按档级算出这份档该带的指针喵（纯函数）喵。
 * @param args.tier - 档级 1/2/3 喵。
 * @param args.byTier - `{ 1: 路径, 2: 路径, 3: 路径 }`（同任务已知的各档路径）喵。
 * @returns `{ pointers, missing }`：`missing` = 还缺哪个下钻目标（回执据此提示"另一档生成后应补指针"）喵。
 */
export function pointersFor({ tier, byTier = {} } = {}) {
  const level = Number(tier)
  const byLevel = byTier || {}
  if (level === 1) return { pointers: { detailLevel: 'full' }, missing: [] }
  if (level === 2) {
    return byLevel[1]
      ? { pointers: { fullDetail: byLevel[1] }, missing: [] }
      : { pointers: {}, missing: ['L1'] }
  }
  if (level === 3) {
    const pointers = {}
    const missing = []
    if (byLevel[2]) pointers.nextTier = byLevel[2]
    else missing.push('L2')
    if (byLevel[1]) pointers.fullDetail = byLevel[1]
    else missing.push('L1')
    return { pointers, missing }
  }
  return { pointers: {}, missing: [] }
}

/** 一份档缺不缺"指向 L1 的下钻指针"喵（审计 `missing_progressive_link` 用）喵。 */
export function missingProgressiveLink({ tier, meta } = {}) {
  const level = Number(tier)
  const source = meta || {}
  if (level === 1) return !source.detailLevel
  if (level === 2) return !source.fullDetail
  // L3 的**终点也是 L1**（`nextTier` 只是中间层）⇒ 只有 `nextTier`、没有 `fullDetail` 仍算缺喵
  if (level === 3) return !source.fullDetail
  return false
}

/**
 * `relatedFiles` 里的**脏路径**喵（FIX-70 附带审计项 `dirty_related_path`）喵。
 *
 * 实测脏成什么样：带反引号（`` `D:\x\y.md` ``）、半截（`D:\Blockdustry\[Agent进度`）、
 * 只有目录没有文件、或者干脆不是路径。判据**保守**（宁少报不误报）喵：
 * ① 带引号/反引号 ② 方括号不配对 ③ 既不含路径分隔符、也不像文件名 ④ 太短喵
 */
export function dirtyRelatedPaths(list) {
  const rows = []
  for (const raw of Array.isArray(list) ? list : []) {
    const text = String(raw ?? '')
    if (!text.trim()) {
      rows.push({ path: text, reason: '空字符串' })
      continue
    }
    if (/[`'"]/.test(text)) {
      rows.push({ path: text, reason: '带引号/反引号（派生时没有清洗）' })
      continue
    }
    const opens = (text.match(/\[/g) || []).length
    const closes = (text.match(/\]/g) || []).length
    if (opens !== closes) {
      rows.push({ path: text, reason: '方括号不配对（路径被截断）' })
      continue
    }
    if (!/[\\/]/.test(text) && !/\.[A-Za-z0-9]{1,6}$/.test(text)) {
      rows.push({ path: text, reason: '既没有路径分隔符也没有扩展名（不像路径）' })
      continue
    }
    if (text.trim().length < 4) {
      rows.push({ path: text, reason: '太短，明显是残片' })
    }
  }
  return rows
}

/**
 * 正文首屏的**速览**（≤3 行，机器生成、零模型调用）喵：本项目做什么 / 本档给谁看 / 要细节去哪喵。
 */
export function quickView({ tier, project, pointers = {}, brief = '' } = {}) {
  const level = Number(tier)
  const summary = String(brief || (project && project.name) || '').trim().replace(/\s+/g, ' ')
  const clip = summary.length > 60 ? `${summary.slice(0, 60)}…` : summary
  const where = pointers.fullDetail
    ? `细节见 ${pointers.fullDetail}`
    : (level === 1
      ? '本档即最详细的一档（终点，没有下钻指针）'
      : `细节见本档 front-matter 的指针（${pointers.nextTier ? `nextTier: ${pointers.nextTier}；` : ''}fullDetail 指向 L1，另一档生成后由工具自动补齐）`)
  return [
    `> **速览** 本项目：${clip || '(未配置项目简介)'}`,
    `> **速览** 本档（L${level}）给：${TIER_AUDIENCE[level] || '读者'}`,
    `> **速览** ${where}`,
    '',
  ].join('\n')
}
