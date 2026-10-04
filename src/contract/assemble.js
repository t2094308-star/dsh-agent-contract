/**
 * 契约装配引擎喵。
 *
 * 装配顺序严格按 DESIGN §5.2：总纲本体 → 角色卡 → 任务切面 → 文档切片 → 状态槽 → 能力配置喵。
 * 预算只做字符级软/硬闸（三分支：ok / warn / overflow），不做 token 精算——
 * 真实计量由宿主的 dsh-context 面板负责喵。
 */
import { resolveProject } from '../project.js'
// FIX-104：契约指纹要带插件版本（升级即视为契约已变）喵
import { pluginVersion } from '../version.js'
// FIX-64：作业登记卡的字段规范进能力配置段（软约束由插件给，不靠任务单手抄）喵
// FIX-101：「文档规范」段与 `contract_status` **同源**（都取这一个函数）+ 本轮解析结果/权威顺序喵
import { docSpecLines, resolvedPathsLines } from '../ledger/docarea.js'
import { TASK_CARD_SPEC } from '../ledger/taskcard.js'
import { findUnfilledSlots, renderMandate } from './mandate.js'
import { getRole } from './roles.js'
import { mergeModelRoutes } from './routes.js'
import { SLICE_BUDGET, countChars, debugFileList, extractKeywords, locateTask, projectBrief, searchDocs, searchStopWords } from './slices.js'

/** 预算默认值喵。 */
export const DEFAULT_BUDGETS = {
  softLimit: 6000,
  hardLimit: 9000,
  warnOverSoftPct: 30,
  // FIX-75：**真正要限的是这个** —— 主代理给子代理的**任务切片**（上级补充指令）长度喵
  briefSoft: 1000,
  briefHard: 2000,
  // mandate 片段永不裁剪；设为 false 才允许按硬限裁剪（不建议）喵
  mandateNoClip: true,
}

/** 各片段的默认字符上限（角色卡另用 role.budgetChars）喵。 */
const SEGMENT_LIMITS = {
  mandate: { soft: 1500, hard: 2400 },
  // task 段只给路径与清单，300 是机器搬运部分的目标（上级口述的补充指令按 FIX-75 的 brief 限单独管）喵
  task: { soft: 300, hard: 300 },
  slices: { soft: 1500, hard: 2400 },
  // FIX-75：`role` 与 `capability` **不再设段限** —— 它们是插件自己生成的（完全可控），
  // 涨了是插件的事，不该报成"子代理搬运失控"（真机实证：补全角色卡后 role 段 1201 字，那条警告必然触发）喵
}

/**
 * 除 `mandate` 外各段合计的**观察阈值**（原「搬运失控」硬卡，FIX-75 按用户口径废掉）喵。
 *
 * 用户裁定原话喵：「机器搬运反而不用限制，因为**可控**；**限主 agent 给子 agent 的任务切片长度**就可以了」。
 * ⇒ 这个总量**不再当门控**（不产生 warning、不进 `over_budget`），只在超阈值时给一条 `info` 提示喵。
 */
export const NON_MANDATE_BUDGET = 2500

/** 总装配超限时允许裁剪的片段，按优先级从低到高喵。 */
const TRIMMABLE = ['slices', 'task']

/** 安全取数，非有限数时回落到默认值喵。 */
function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 判定片段/总体落在哪个预算档位喵。
 * @returns 'ok' | 'warn' | 'overflow' 喵。
 */
export function classifyChars(chars, soft, hard, warnPct) {
  if (chars <= soft) return 'ok'
  const warnCeiling = soft * (1 + warnPct / 100)
  if (chars <= hard && chars <= warnCeiling) return 'warn'
  return 'overflow'
}

/**
 * 按字符数（忽略空白）截断文本喵，末尾补省略号并计入字符数喵。
 * @returns { text, chars }，chars 恰好等于 limit（除非原文本来就短）喵。
 */
export function truncateToChars(text, limit) {
  const source = String(text ?? '')
  const total = countChars(source)
  if (limit <= 0) return { text: '', chars: 0 }
  if (total <= limit) return { text: source, chars: total }
  if (limit === 1) return { text: '…', chars: 1 }
  return cutAt(source, limit)
}

/** 逐字符累计非空白数量，在 limit-1 处切断并补省略号，使结果字符数恰好等于 limit 喵。 */
function cutAt(source, limit) {
  const target = limit - 1
  let count = 0
  let cut = source.length
  for (let i = 0; i < source.length; i += 1) {
    if (!/\s/.test(source[i])) {
      count += 1
      if (count === target) {
        cut = i + 1
        break
      }
    }
  }
  const head = source.slice(0, cut)
  return { text: `${head}…`, chars: countChars(`${head}…`) }
}

/**
 * 对给定片段做预算判定与裁剪，并检查总装配喵。
 * 纯函数（不读盘），便于单测覆盖三分支喵。
 * @param parts - `[{ id, text, soft, hard }]`喵。
 * @param budgets - 总软/硬限与提醒百分比喵。
 */
export function assembleSegments(parts, budgets = {}) {
  const warnPct = num(budgets.warnOverSoftPct, DEFAULT_BUDGETS.warnOverSoftPct)
  // mandate 片段永不裁剪：[1]~[2] 的「传递性」要求逐字完整下发，超限只警告喵。
  // 该例外优先于其它片段——需要裁剪时先动低优先级片段，mandate 不动喵。
  const noClip = budgets.mandateNoClip === false ? new Set() : new Set(['mandate'])
  const warnings = []
  const segments = []

  for (const part of parts) {
    const soft = num(part.soft, 800)
    const hard = Math.max(num(part.hard, soft), soft)
    let text = String(part.text ?? '')
    let chars = countChars(text)
    let level = classifyChars(chars, soft, hard, warnPct)
    const exempt = level === 'overflow' && noClip.has(part.id)
    if (exempt) {
      // 豁免片段：保留全文，降级为警告，且不让它把整体标记成「已裁剪」喵
      warnings.push(`片段 ${part.id} 超硬限：${chars} > ${hard} 字；该片段为逐字要求，已豁免裁剪（mandateNoClip）`)
      level = 'warn'
    } else if (level === 'overflow') {
      const cut = truncateToChars(text, hard)
      warnings.push(`片段 ${part.id} 超硬限：${chars} > ${hard} 字，已裁剪 ${chars - cut.chars} 字`)
      text = cut.text
      chars = cut.chars
    } else if (level === 'warn') {
      warnings.push(`片段 ${part.id} 超软限：${chars} > ${soft} 字（未超 ${warnPct}% 提醒区间，保留全文）`)
    }
    segments.push({ id: part.id, chars, soft, hard, level, text })
  }

  const totalSoft = num(budgets.softLimit, DEFAULT_BUDGETS.softLimit)
  const totalHard = Math.max(num(budgets.hardLimit, DEFAULT_BUDGETS.hardLimit), totalSoft)
  let totalChars = segments.reduce((sum, seg) => sum + seg.chars, 0)
  let overflow = segments.some((seg) => seg.level === 'overflow')

  const totalLevel = classifyChars(totalChars, totalSoft, totalHard, warnPct)
  if (totalLevel === 'warn') {
    warnings.push(`总装配超软限：${totalChars} > ${totalSoft} 字（未超 ${warnPct}% 提醒区间，保留全文）`)
  } else if (totalLevel === 'overflow') {
    overflow = true
    for (const id of TRIMMABLE) {
      if (totalChars <= totalHard) break
      if (noClip.has(id)) continue
      const seg = segments.find((item) => item.id === id)
      if (!seg) continue
      const cut = truncateToChars(seg.text, Math.max(0, seg.chars - (totalChars - totalHard)))
      const delta = seg.chars - cut.chars
      if (delta <= 0) continue
      warnings.push(`总装配超硬限：从片段 ${id} 裁掉 ${delta} 字`)
      seg.text = cut.text
      seg.chars = cut.chars
      seg.level = 'overflow'
      totalChars -= delta
    }
    if (totalChars > totalHard) {
      warnings.push(`总装配仍超硬限 ${totalChars} > ${totalHard} 字：可裁片段已裁尽，mandate 等逐字片段不做裁剪`)
    }
  }

  return {
    text: segments.map((seg) => seg.text).join('\n\n'),
    segments: segments.map(({ text: _text, ...rest }) => rest),
    warnings,
    overflow,
    totalChars,
  }
}

/** 渲染「任务切面」片段喵（**只给路径，不搬运任务文件正文**，DESIGN §5.2 / §9-12）喵。 */
function renderTaskSegment({ task, taskFile, brief, debugFiles, intro, root = '' }) {
  const lines = ['### 任务切面', '', `任务号：${task.id}`]
  if (taskFile) {
    // FIX-75 ③：**read 用绝对路径**（子代理可能在别的工作区）+ 交接语境补一条相对写法喵
    lines.push(`任务文件（绝对路径，请自己 read 它）：${taskFile}${relNote(root, taskFile)}`)
  } else {
    lines.push('任务文件：(未在任务目录中找到对应文件，请向上级确认任务号)')
  }
  if (brief) lines.push('', '上级补充指令（上级口述，原样透传）：', brief)
  if (intro) lines.push('', '项目简介：', intro)
  lines.push('', `同任务 debug / 产出文件（相对项目根）：${debugFiles.length ? debugFiles.join('、') : '(暂无)'}`)
  if (root && (debugFiles.length || taskFile)) lines.push(rootNote(root))
  return lines.join('\n')
}

/**
 * 把绝对路径写成「相对项目根」的交接写法（FIX-75 ③）喵。
 *
 * 用户口径喵：交接语境（切片 / 任务切面 / 多档指针）用**相对项目根**的写法，
 * 「像研究 agent 产出的研究文档交接给下一个 agent **写相对路径**」——既短又不容易歧义喵。
 * ⚠ 但**"请你自己 read 的文件"仍保留绝对路径**：子代理可能在**别的工作区**里执行
 * （真机已见：研究员的产出先落到 `default-workspace`），绝对路径解析更稳喵。
 */
export function relToRootText(root, path) {
  const base = String(root || '').replace(/[\\/]+$/, '')
  const target = String(path || '')
  if (!base || !target) return ''
  const lowerBase = base.toLowerCase()
  const lowerTarget = target.toLowerCase()
  if (!lowerTarget.startsWith(lowerBase) || lowerTarget === lowerBase) return ''
  const tail = target.slice(base.length).replace(/^[\\/]+/, '')
  return tail.replace(/[\\/]+/g, '/')
}

/** 「相对项目根：x/y.md」的短写法（不在根内返回空串）喵。 */
function relNote(root, path) {
  const rel = relToRootText(root, path)
  return rel ? `（相对项目根：${rel}）` : ''
}

/** 交接语境下"路径一律相对项目根"的说明行喵。 */
function rootNote(root) {
  return `以上路径的「相对项目根」写法以 \`${root}\` 为基；**用 read 时用绝对路径**（子代理可能在别的工作区）喵`
}

/** 渲染「文档切片」片段喵（只给路径 + 命中原因 + readHints，默认不给正文）喵。 */
function renderSlicesSegment(keywords, hits, root = '') {
  const lines = ['### 文档切片']
  if (!hits.length) {
    const label = keywords.length ? keywords.join('、') : '(无实词)'
    lines.push('', `按关键词 ${label} 未检索到相关文档，请自行在文档目录中查找。`)
    return lines.join('\n')
  }
  lines.push(
    '',
    `检索关键词：${keywords.join('、')}`,
    '',
    '（这里只给路径与读法，不搬运正文；需要内容时用 read 精读 readHints 指定的小节）',
    // FIX-70 ⑤：读法要写清**渐进式披露**的走法 —— 先读概括档，再按元数据指针下钻到 L1 喵
    '- 读法（渐进式披露）：**先读该任务的 L3（高度概括）**；不够再按它 front-matter 里的指针下钻：'
      + '`nextTier` → L2（扩充细节）、`fullDetail` → **L1（详细归纳，终点）**。指针就在文档开头的元数据里，不必全量通读喵',
    // FIX-75 ③：**整段只给一条**根说明（每篇一条太吵，还会挤掉引文预算）喵
    ...(root ? [`- ${rootNote(root)}`] : []),
    '',
  )
  for (const hit of hits) {
    lines.push(`#### ${hit.title}`)
    lines.push(`- 路径：${hit.path}${relNote(root, hit.path)}`)
    lines.push(`- 命中原因：${hit.hitReason.join('、')}`)
    lines.push(`- readHints：${hit.readHints.length ? hit.readHints.join('、') : '(无固定小节，按需读)'}`)
    if (hit.excerpt) lines.push('', `引文（≤200 字符，仅供参考）：${hit.excerpt}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * 把文档切片**适配进预算**喵（FIX-48）喵：超限就先把引文全丢掉（只留 路径 + 命中原因 + readHints）喵。
 *
 * 抽成纯函数的意义：预算可注入 ⇒ 套件能用一个小预算真的把这条守卫跑出来，
 * 而不是让它在真机上"永远够不到"（够不到的守卫等于摆设）喵。
 */
export function fitSlicesToBudget({ keywords, hits, budget = SLICE_BUDGET, root = '' }) {
  const full = renderSlicesSegment(keywords, hits, root)
  if (countChars(full) <= budget) return full
  return renderSlicesSegment(keywords, (hits || []).map((hit) => ({ ...hit, excerpt: undefined })), root)
}

// FIX-49：**不再单独渲染「状态槽汇总」段** —— 槽位已在总纲本体里就地替换，
// 再列一遍 6 行纯属重复（实测省下约 200 字符，也让契约更短更好读）喵。

/** 渲染「能力配置」片段喵。 */
function renderCapabilitySegment(role, routeNote, oneShot = false) {
  return [
    '### 能力配置',
    '',
    `- 角色：${role.title}（${role.id}）`,
    // FIX-78 ③：把"**本次被怎么派**"写进契约 —— 子代理自己也该知道自己是一次性还是常驻喵
    `- 运行模式：${oneShot
      ? '前台（**本次为一次性**：跑完即释放，不能再派活）'
      : (role.mode === 'continuable'
        ? (role.singleton === true ? '后台（**常驻单例**：服务所有任务，可续派 / 可唤醒）' : '后台（常驻：可续派 / 可唤醒）')
        : '前台（跑完即释放，不可再派活）')}`,
    `- 工具白名单：${role.tools && role.tools.length ? role.tools.join('、') : '(不限制)'}`,
    `- 模型路由：${role.modelRoute || 'default'}${routeNote}`,
    '',
    '产出契约：',
    role.deliverable,
    '',
    '禁止事项：',
    role.forbidden,
    '',
    // FIX-64：任务文件是**你自己的作业登记卡** —— 字段规范由插件提供（任务单不必再抄一遍）喵
    TASK_CARD_SPEC,
  ].join('\n')
}

// 任务切面里要用的项目简介由 buildContract 注入，避免 renderTaskSegment 再读一次配置喵。

/**
 * 装配一份完整的子智能体初始契约喵。
 * @param args.config - 插件配置喵。
 * @param args.roleId - 角色 id 喵。
 * @param args.task - `{ id, brief }`，brief 为上级补充指令喵。
 * @param args.parent - 上级标识（成员名或 session id）喵。
 * @param args.layer - 该子智能体的层数喵。
 * @param args.totalAgents - 当前总 Agent 数喵。
 * @param args.project - 可选，已解析的项目视图（省一次解析）喵。
 * @returns `{ text, segments, warnings, overflow, totalChars }`喵。
 */
/**
 * 契约**格式版本**喵（FIX-104）喵：总纲 / 角色卡 / 规范段这些"不变段"的形状一变就递增 ——
 * 续派时靠它 + 角色元数据 + 插件版本一起算指纹，指纹变了才重发契约（不变就只发任务切片）喵。
 */
export const CONTRACT_FORMAT_VERSION = 1

/**
 * 契约**指纹**喵（FIX-104 ②）喵：`插件版本 | 契约格式版本 | 角色 id | 角色卡预算 | 项目根` ——
 * 任何一项变了（升级插件 / 改角色卡 / 规范段改版 / 换项目）⇒ 续派时要**说明"契约已更新"**并补发变化段喵。
 */
export function contractFingerprint({ role = null, project = null } = {}) {
  return [
    pluginVersion(),
    `fmt${CONTRACT_FORMAT_VERSION}`,
    role && role.id ? String(role.id) : '-',
    role && role.budgetChars ? String(role.budgetChars) : '-',
    project && project.root ? String(project.root) : '-',
  ].join('|')
}

/**
 * **续派消息**喵（FIX-104 ①）喵 —— 常驻成员第一次已经拿到完整契约，后续每次续派**只发本轮任务切片**：
 * 任务号 + 上级补充指令 + 一句"角色卡/纪律/规范沿用开头那份"喵。
 *
 * 为什么（用户原话）：「在持久性 agent 的非第一次的提示词中出现了大量的重复内容，比如角色卡等」——
 * 契约软限 6000 字，续派 10 次 = 6 万字白烧；同一份内容在上下文里出现多份，还容易让成员对"哪份最新"产生歧义 ✗。
 * 指纹变了（升级插件 / 改角色卡 / 规范段改版）⇒ 才带上「契约已更新」说明 + **变化的那一段**（这里给规范段）喵。
 *
 * @returns `{ text, chars, sliceChars, updated, changedSegments }`喵。
 */
export function renderContinuationSlice({
  taskId, brief = '', taskFile = null, previousFingerprint = null, fingerprint = null,
  specText = '', budgets = null,
}) {
  const limit = { soft: 1000, hard: 2000, ...(budgets || {}) }
  const raw = String(brief || '')
  const sliceChars = countChars(raw)
  const briefText = sliceChars > limit.hard ? truncateToChars(raw, limit.hard).text : raw
  const lines = [
    `## 【本轮任务切片】${taskId}`,
    '',
    taskFile ? `- 任务文件：${taskFile}` : null,
    briefText ? `- 上级补充指令：${briefText}` : '- 上级补充指令：（无：按任务文件与既有进度继续）',
    '- 角色卡、纪律、文档规范、工具用法**沿用本会话开头那份契约**（不重复发送）喵',
  ].filter(Boolean)
  const updated = Boolean(previousFingerprint) && Boolean(fingerprint) && previousFingerprint !== fingerprint
  const changedSegments = []
  if (updated) {
    changedSegments.push('文档规范 / 本轮解析结果')
    lines.push(
      '',
      `**契约已更新**（指纹 ${previousFingerprint} → ${fingerprint}）：以下段落有变化，以这一段为准（其余仍沿用开头那份）喵`,
      specText || '（规范段本次无内容变化；按"权威顺序"执行并在回执里标注不一致即可）',
    )
  }
  const text = lines.join('\n')
  return { text, chars: countChars(text), sliceChars, updated, changedSegments }
}

/**
 * 把一次委派装配成完整契约喵（DESIGN §5.2）喵。
 */
export async function buildContract({ config, roleId, task, parent, layer, totalAgents, project, oneShot = false, globalFilesText = '', auditDigest = null }) {
  const projectView = project || resolveProject(config)
  const role = getRole(config, roleId)
  const taskId = String((task && task.id) || '').trim()
  if (!taskId) throw new Error('agent-contract: 委派缺少任务号（taskId）')

  const brief = (task && task.brief) || ''
  // 只**定位**任务文件，绝不读它的正文（DESIGN §9-12）；关键词只从任务号与上级补充指令派生喵
  const taskFile = await locateTask(projectView, taskId)
  const debugFiles = await debugFileList(projectView, taskId)
  const keywords = extractKeywords(`${taskId} ${brief}`)
  // FIX-50：项目名/用户配置的词不进命中原因（项目名几乎每篇都有，当命中原因等于没信息）喵
  const searchOptions = { stopWords: searchStopWords(config) }
  const hits = await searchDocs(projectView, keywords, 5, searchOptions)
  // FIX-48：切片段**单独设上限** —— 超限就把引文全丢掉（只留 路径 + 命中原因 + readHints），
  // 避免"文档一多就挤掉正事"；正文让子代理按 readHints 自己去 read 喵
  const sliceText = fitSlicesToBudget({ keywords, hits, root: projectView.root })

  const slots = {
    progressDir: projectView.progressDir,
    task: taskFile.path || projectView.tasksDir,
    location: projectView.deliverablesDir,
    parent: parent === undefined || parent === null || parent === '' ? '(主代理)' : String(parent),
    layer: layer === undefined ? 1 : layer,
    totalAgents: totalAgents === undefined ? 1 : totalAgents,
  }

  const budgets = { ...DEFAULT_BUDGETS, ...(config && config.budgets ? config.budgets : {}) }
  /**
   * FIX-75 ②：**任务切片长度上限** —— 用户裁定：机器搬运可控不必限，真正要限的是
   * "主代理口述给子代理的任务切片"（brief）。超硬限**裁剪**并给"只留指针"的正确姿势喵。
   */
  const preWarnings = []
  const briefLimit = { soft: num(budgets.briefSoft, 1000), hard: num(budgets.briefHard, 2000) }
  const briefRawChars = brief ? countChars(brief) : 0
  let briefText = brief
  if (briefRawChars > briefLimit.hard) {
    briefText = truncateToChars(brief, briefLimit.hard).text
    preWarnings.push(
      `任务切片超长：${briefRawChars} > ${briefLimit.hard} 字，已裁到 ${briefLimit.hard} 字 —— `
      + '**细节请写进任务卡或文档，切片只留指针（路径 + 要看哪一节）**喵',
    )
  } else if (briefRawChars > briefLimit.soft) {
    preWarnings.push(
      `任务切片偏长：${briefRawChars} > ${briefLimit.soft} 字（超过 ${briefLimit.hard} 会被裁剪）—— `
      + '细节更适合写进任务卡/文档，切片只留指针（路径 + 要看哪一节）喵',
    )
  }
  const mandateSegment = SEGMENT_LIMITS.mandate
  // §5.2：手写内容（上级补充指令）不做长度门控，所以把它的长度加回 task 段预算——
  // 300 那个目标只约束**机器搬运**的部分喵
  const briefChars = briefText ? countChars(briefText) : 0
  const taskLimits = {
    soft: SEGMENT_LIMITS.task.soft + briefChars,
    hard: SEGMENT_LIMITS.task.hard + briefChars,
  }
  const parts = [
    { id: 'mandate', text: renderMandate(slots), soft: num(budgets.mandateSoft, mandateSegment.soft), hard: num(budgets.mandateHard, mandateSegment.hard) },
    // FIX-75：角色卡是插件自己维护的机器搬运内容 ⇒ **不设上限**（涨了是插件的事）喵
    { id: 'role', text: `### 角色卡：${role.title}\n\n${role.persona}`, soft: Number.MAX_SAFE_INTEGER, hard: Number.MAX_SAFE_INTEGER },
    {
      id: 'task',
      text: renderTaskSegment({
        task: { id: taskId },
        taskFile: taskFile.path,
        brief: briefText,
        debugFiles,
        intro: projectBrief(config),
        root: projectView.root,
      }),
      ...taskLimits,
    },
    // FIX-101：「文档规范 + 本轮解析结果 + 权威顺序 + 目标绝对路径」——
    // **与 `contract_status` 的规范段同源**（同一个 `docSpecLines()`），子代理不必再去读插件源码喵
    {
      id: 'spec',
      text: [
        '### 文档规范（与主代理的体检回执**同源**；不必读插件源码，也不要去源码里找"真实意图"）',
        '',
        ...docSpecLines({ project: projectView }),
        '',
        ...resolvedPathsLines({ project: projectView, globalFiles: globalFilesText }),
      ].join('\n'),
      // 机器生成的固定条文 ⇒ 不设上限（涨了是插件的事）喵
      soft: Number.MAX_SAFE_INTEGER,
      hard: Number.MAX_SAFE_INTEGER,
    },
    // FIX-108 ③：**审计摘要进契约**（与 `audit_scan` / 面板同一份实现产出）——
    // 馆员看全量"这些是你要收拾的"，其它角色只带与本任务相关的条目（避免噪音）喵
    ...(auditDigest && auditDigest.text ? [{
      id: 'audit',
      text: auditDigest.text,
      soft: Number.MAX_SAFE_INTEGER,
      hard: Number.MAX_SAFE_INTEGER,
    }] : []),
    { id: 'slices', text: sliceText, ...SEGMENT_LIMITS.slices },
    // FIX-75：能力配置同样是插件生成的固定条文 ⇒ 不设上限喵
    { id: 'capability', text: renderCapabilitySegment(role, routeNoteFor(config, role), oneShot), soft: Number.MAX_SAFE_INTEGER, hard: Number.MAX_SAFE_INTEGER },
  ]

  const assembled = assembleSegments(parts, budgets)
  for (const warnLine of preWarnings) assembled.warnings.push(warnLine)
  const unfilled = findUnfilledSlots(assembled.text, Object.values(slots))
  if (unfilled.length) assembled.warnings.push(`契约存在未填槽位：${unfilled.join('、')}`)
  // 装配瘦身预算（§5.2）：除 mandate 外五段合计超限即判「搬运失控」喵
  const nonMandateChars = assembled.segments
    .filter((seg) => seg.id !== 'mandate')
    .reduce((sum, seg) => sum + seg.chars, 0)
  // FIX-75：**不是警告、也不再叫"失控"** —— 机器搬运可控，超阈值只给一条"总量提示"（info）喵
  const totalHint = nonMandateChars > NON_MANDATE_BUDGET
    ? `总量提示：除 mandate 外合计 ${nonMandateChars} > ${NON_MANDATE_BUDGET} 字符（都是机器生成的部分，不拦截；要减请先看任务切片与切片预算）`
    : ''
  return { ...assembled, nonMandateChars, totalHint }
}

/** 没配 `modelRoutes[角色]` 时标注为非异源（供审计 M4 复用同一口径）喵。 */
function routeNoteFor(config, role) {
  // 裁决 B 起：`modelRoutes` 是 volatile 字段（由设置页管理），**默认值在插件里** ——
  // 所以这里必须与派单用**同一份合并后的路由**（`DEFAULT_MODEL_ROUTES` ⊕ 配置），
  // 否则会出现"契约写着非异源、实际派单却是异源"的自相矛盾喵。
  const routes = mergeModelRoutes(config)
  if (role.modelRoute && routes[role.id]) return ''
  if (role.id === 'adversary') return '（非异源：连默认路由都没有，退化为与实现者同模型）'
  return ''
}
