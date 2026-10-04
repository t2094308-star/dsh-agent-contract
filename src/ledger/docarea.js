/**
 * **文档区域的硬限制**喵（FIX-69）喵 —— 写动作层面**拒绝**，不是审计提醒喵。
 *
 * 用户拍板（2026-10-03）喵：
 * - 三级名不变：L1 详细归纳 / L2 扩充细节 / L3 高度概括喵
 * - 目录两级：**类型 → 目录**、**档级 → 子目录** ⇒ `docs/研究/` · `docs/审查/` · `docs/整合清单/` ·
 *   `docs/产出/{L1,L2,L3}/`喵
 * - 命名后缀与**所在目录**一致：`<任务号>_<标题>_研究.md` / `_审查.md` / `_整合清单.md` / `_L<n>.md`喵
 * - 产出区【硬限制】：落错档级目录 / 文件名不合规 / 写非 `.md` ⇒ **拒绝**并给出正确路径喵
 * - `^` 前缀是"归档"的意思 ⇒ 搬到元数据（`archived: true`），文件名不再带 `^`喵
 * - `.json` 这类临时文件先搬走（**只搬不删**），统一去处 `仓库/docs/_临时/`（**非类别目录、审计排除**）喵
 */
import { readdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { isAbsolutePath, joinUnderRoot } from '../project.js'
import { docFileName, kindFileName, tierSubdir } from './naming.js'

/** 默认类型（三档产出档）喵。 */
export const DEFAULT_DOC_KIND = '产出档'

/** 标准类型清单（键固定，值随项目）喵。 */
export const DOC_KIND_NAMES = ['研究', '审查', '整合清单', '坑', '修改', '核心数据库', '产出档', '归档']

/** 产出档的**档级子目录**绝对路径喵。 */
export function tierDirOf({ project, tier }) {
  const root = (project && (project.docKinds && project.docKinds.产出档)) || (project && project.deliverablesDir)
  if (!root) throw new Error('agent-contract: 项目没有配置产出档目录（docKinds.产出档 / paths.deliverablesDir）喵')
  return joinUnderRoot(root, tierSubdir(tier))
}

/**
 * 算一份文档该落在哪、叫什么名，并把**硬限制**逐条卡住喵。
 *
 * @param args.kind - 类型（默认 `产出档`）喵。
 * @param args.tier - 档级 1/2/3（**类型不是产出档时必须为空**）喵。
 * @returns `{ kind, dir, path, fileName, tier }`喵。
 * @throws 违反硬限制时直接抛（错误信息里带**正确路径**）喵。
 */
export function resolveDocArea({ project, taskId, title, tier, kind } = {}) {
  const wanted = String(kind || DEFAULT_DOC_KIND).trim() || DEFAULT_DOC_KIND
  const kinds = (project && project.docKinds) || {}
  if (!DOC_KIND_NAMES.includes(wanted)) {
    throw new Error(`agent-contract: 未知的文档类型「${wanted}」—— 可用类型：${DOC_KIND_NAMES.join(' / ')}喵`)
  }
  if (wanted === '归档') {
    throw new Error('agent-contract: 归档档由 `librarian_archive` / 一轮治理搬运（写进 archive/<YYYY-MM>/），'
      + '不要用 doc_emit 直接写归档目录喵')
  }
  if (wanted === DEFAULT_DOC_KIND) {
    const dir = tierDirOf({ project, tier })
    const fileName = docFileNameSafe(taskId, title, tier)
    return { kind: wanted, dir, path: joinUnderRoot(dir, fileName), fileName, tier: Number(tier) }
  }
  if (tier !== undefined && tier !== null && Number(tier) !== 0) {
    throw new Error(`agent-contract: 类型「${wanted}」不是三档产出档，不该带 level（收到 ${tier}）；`
      + `三档文档请用默认类型，落到 ${tierDirOf({ project, tier: Number(tier) || 1 })} 这样的档级子目录喵`)
  }
  const dir = kinds[wanted]
  if (!dir) {
    throw new Error(`agent-contract: 项目没配「${wanted}」类目录（paths.docKinds.${wanted}）—— `
      + `先让主代理调 project_init 建齐，或把它写进配置喵`)
  }
  const fileName = kindFileNameSafe(taskId, title, wanted)
  return { kind: wanted, dir, path: joinUnderRoot(dir, fileName), fileName, tier: 0 }
}

/** 产出档文件名（硬限制：必须是 `<任务号>_<标题>_L<n>.md`；命名规则本体在 `naming.js`）喵。 */
function docFileNameSafe(taskId, title, tier) {
  return assertSafeName(docFileName(taskId, title, tier), `${taskId}_<标题>_L${Number(tier)}.md`)
}

/** 类型档文件名（硬限制：必须是 `<任务号>_<标题>_<类型>.md`）喵。 */
function kindFileNameSafe(taskId, title, kind) {
  return assertSafeName(kindFileName(taskId, title, kind), `${taskId}_<标题>_${kind}.md`)
}

/**
 * 文件名守卫喵：**只允许 `.md`**、不许带路径分隔符、不许以点开头、slug 之后不许变空喵。
 * （`slug()` 会把非法字符换成 `_`，所以这里主要是**防御性**的：任何绕过 slug 的写法都被挡住）喵
 */
export function assertSafeName(fileName, expected) {
  const name = String(fileName || '')
  if (!name.toLowerCase().endsWith('.md')) {
    throw new Error(`agent-contract: 文档区**只收 .md**（收到「${name}」）—— `
      + '`.json`/`.tmp`/图片这类临时文件请放到临时目录，不要写进文档区喵')
  }
  if (/[\\/]/.test(name) || name.startsWith('.')) {
    throw new Error(`agent-contract: 文件名不得含路径分隔符或以点开头（收到「${name}」）—— 期望形如 ${expected}喵`)
  }
  if (name.replace(/\.md$/i, '').trim() === '') {
    throw new Error(`agent-contract: 文件名主干为空（收到「${name}」）—— 期望形如 ${expected}喵`)
  }
  return name
}

/** 给定路径是不是**临时目录**里（临时目录是"非类别目录"，审计要排除它）喵。 */
export function isTempPath(project, path) {
  const temp = project && project.tempDir
  if (!temp || !path) return false
  const base = String(temp).replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/').toLowerCase()
  const target = String(path).replace(/[\\/]+/g, '/').toLowerCase()
  return target === base || target.startsWith(`${base}/`)
}

/** 路径是否落在某个类型目录（或产出根的档级子目录）之内喵（越界守卫）喵。 */
export function isInside(path, dir) {
  const base = String(dir || '').replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/').toLowerCase()
  const target = String(path || '').replace(/[\\/]+/g, '/').toLowerCase()
  if (!base || !target) return false
  return target === base || target.startsWith(`${base}/`)
}

/** 临时文件的合规去处（提示文案里直接用）喵。 */
export function tempDirHint(project) {
  const temp = (project && project.tempDir) || (project && project.root ? joinUnderRoot(project.root, 'docs/_临时') : '(未配置)')
  return `${temp}（**非类别目录**，审计不查它；只搬不删）`
}

/**
 * **面向 agent 的文档规范条文**（FIX-72）喵 —— 一句话一条，不要散文喵。
 *
 * 病根（真机实测）喵：主代理做对了 `ledger_rebuild` → `contract_status` → `audit_scan`，
 * 然后开始**满世界找规范**（glob 找 DESIGN.md → 读产出目录里的设计稿 → 定位 `app.asar` → 读插件源码）——
 * 因为 `contract_status` 只输出了「目录约定」+「类别→目录」，**没有命名后缀、必备头部字段、产出区硬限制、
 * 归档字段、临时文件去处、渐进式披露指针** ⇒ agent 只能去翻源码 ✗。
 *
 * 这里给的就是那份**可执行规格**（源：`docKinds` / `docarea` / `naming` / `progressive` 的实现口径，
 * 不是另写一套文档）喵。
 */
export function docSpecLines({ project } = {}) {
  const kinds = (project && project.docKinds) || {}
  const lines = ['文档规范（每类 = 目录 + 命名后缀 + 必备头部字段）：']
  const header = 'taskId / role / tier / keywords / relatedFiles / createdAt'
  for (const name of DOC_KIND_NAMES) {
    const dir = kinds[name]
    if (!dir) continue
    if (name === '产出档') {
      lines.push(`- 产出档（三档）：目录 ${dir}/L<n>/（L1 详细归纳 / L2 扩充细节 / L3 高度概括）· `
        + `文件名 <任务号>_<标题>_L<n>.md · 头部 ${header}`)
      continue
    }
    if (name === '归档') {
      lines.push(`- 归档：目录 ${dir}/<YYYY-MM>/（由归档动作搬运，不要手写）`)
      continue
    }
    lines.push(`- ${name}：目录 ${dir}/ · 文件名 <任务号>_<标题>_${name}.md · 头部 ${header}`)
  }
  lines.push(
    `- 产出区硬限制：**只收 .md**；落错档级目录 / 类型与后缀不符 / 文件名不合规 ⇒ 写档工具**直接拒绝**并给出正确路径`,
    `- 归档 = 头部 \`archived: true\`（**不靠文件名前缀** —— \`^\` 前缀已废弃）`,
    `- 临时文件（.json/.tmp/.bak…）⇒ ${tempDirHint(project)}（非类别目录、审计排除）`,
    '- 渐进式披露：L3 → `nextTier`(L2) + `fullDetail`(L1)；L2 → `fullDetail`(L1)；L1 = 终点（`detailLevel: full`）',
    // FIX-89 ①：**分工**（用户口径：主代理只做"甩手掌柜" —— 模型同级、只是思考强度更高）喵。
    // 真机实证：一轮 T53 的 52 次调用里**侦察类占约一半**（pwsh 列目录/数数、grep 找标记、read 任务卡/进度、
    // 交付后自己核查磁盘）—— 这些**同模型下级全能干**，还更省主代理的上下文喵
    '- 分工（**你要做甩手掌柜**）：**盘点 / 侦察 / 数数 / 找标记这类重活派 `researcher`；'
      + '文档整理 / 索引 / 归档派 `librarian`；实现派 `implementer`；审查与对抗审查各自派**。'
      + '你只做「判断该派谁 · 拍板 · 验收 · 汇报」，**不要自己跑批量侦察**（列目录 / 数文件 / 找标记 / 全库 grep 一律外包）喵',
    '- 查流程：拿不准步骤就先问 `contract_flow`（内置 `organize-docs` / `implement` / `research` 三条可执行流程）喵',
    // FIX-100 ③：**硬规矩**要写在 agent 一定读得到的地方（工具描述 + 体检回执）喵 ——
    // 真机教训：契约工具一不可用，主代理就改用宿主普通派单绕过，而那条路完全不留痕 ✗
    '- **派单硬规矩**：所有子代理派单都走 `contract_delegate_*`（契约工具）。'
      + '**契约工具不可用**（宿主报错 / 被拒 / 场景不允许）时：**先调 `contract_request_escalation` 说明理由**，再用普通派单 —— '
      + '绕过会被审计报 `uncontracted_dispatch`（黄），提权之后同一作用域内标「已提权」且不计红黄喵',
    '- 整理 / 归档 / 命名规范这类活**不需要读文档正文，也不需要读插件源码** —— '
      + '按上面的规范用 `contract_delegate_librarian` 派单，先让它出 **dryRun 预演**再落地喵',
  )
  return lines
}

/**
 * **本轮解析结果 + 权威顺序 + 目标绝对路径**喵（FIX-101 治本口径）喵。
 *
 * 真机根因（助手读会话日志的实证）：馆员**不是"缺规范"，而是在仲裁矛盾** —— 它自己的推理原话：
 * 「`project.json` 说 deliverablesDir = 子agent 且 tempDir = 仓库/docs/_临时，而规范说产出根应是 产出/ ——
 * 到底哪个算数？」⇒ 于是去 grep `app.asar`、读插件源码找"插件的真实意图" ✗。
 * 三个缺口：**A 缺权威顺序**（派生物 vs 契约文字冲突时没有仲裁依据）· **B 目标是"候选清单"不是"确定答案"**
 * （"搬到哪"没给解析后的绝对路径）· **C 不一致的处置未定义**（该上报还是自行判定）喵。
 *
 * 这一份就是那三个缺口的答案：**路径是绝对路径**（本轮解析出来的，不是候选）、**权威顺序写死在前面**、
 * **不一致时怎么办写死在后面** —— 子代理读完这段就不必去源码问"插件的真实意图"了喵。
 */
export function resolvedPathsLines({ project, globalFiles = '' } = {}) {
  if (!project || !project.root) return []
  const kinds = project.docKinds || {}
  // **紧凑写法**（FIX-101 修：一段一段列会把契约撑爆）——类别目录一行说完，其余路径一行说完喵
  const kindText = DOC_KIND_NAMES
    .filter((name) => kinds[name])
    .map((name) => (name === '产出档'
      ? `产出档 ${kinds[name]}（三档子目录 L1|L2|L3）`
      : (name === '归档' ? `归档 ${kinds[name]}/<标废月 YYYY-MM>/（按**标废日**分片）` : `${name} ${kinds[name]}`)))
    .join(' ｜ ')
  const lines = [
    '**本轮解析结果（本项目绝对路径；"搬到哪 / 归到哪"就用这里，不要猜候选）**：'
    + `${kindText}`
    + (project.tempDir ? ` ｜ 临时文件 ${project.tempDir}（非类别目录、审计排除）` : '')
    + (project.deliverablesDir ? ` ｜ 产出根 ${project.deliverablesDir}` : '')
    + (project.tasksDir ? ` ｜ 任务目录 ${project.tasksDir}` : ''),
  ]
  if (globalFiles) lines.push(globalFiles)
  lines.push(
    '**权威顺序（冲突时按这个判，不必去读插件源码求证）**：'
    + '① 本段"本轮解析结果" ② 项目配置里的显式约定 ③ 探测结果；'
    + '`<项目根>/.agent-contract/project.json` 是**派生物**（可能过期）—— 它与本段冲突时**以①为准**喵',
    '**发现不一致怎么办**：按①执行，并在回执/报告里**标注这处不一致**——**不要**去 grep/读插件源码或宿主源码：'
    + '源码不是规范来源，读了会被实现细节误导，还白烧上下文喵',
    '**不必读插件源码 / 宿主源码**：规范与路径都在本契约里；工具用法看工具描述喵',
  )
  return lines
}
/** 磁盘上各类别目录里的 `.md` 篇数（**递归**，临时目录不算）喵。 */
export async function countDiskDocs({ project, readdirImpl } = {}) {
  const rows = await scanDocAreas({ project, readdirImpl })
  return rows.filter((row) => !row.nonMd).length
}

/** 从路径推"它属于哪个类型 + 哪个档级"喵（审计 `doc_kind_mismatch` 用）喵。 */
export function areaOfPath(project, path) {
  const kinds = (project && project.docKinds) || {}
  for (const [kind, dir] of Object.entries(kinds)) {
    if (!isInside(path, dir)) continue
    if (kind === '产出档') {
      const parent = dirname(String(path))
      const leaf = basename(parent)
      const tier = /^L([123])$/i.exec(leaf)
      return { kind, tier: tier ? Number(tier[1]) : null }
    }
    return { kind, tier: null }
  }
  return { kind: null, tier: null }
}

/** 供外部（迁移/搬家）判断"这个路径是不是绝对路径"的转发喵。 */
export { isAbsolutePath }

/**
 * FIX-69：扫一遍**类别目录**（含产出根的档级子目录），给三条格式类检查项共用喵。
 *
 * **临时目录刻意排除**（`paths.tempDir` 是"非类别目录"，审计不查它 —— 那是 `.json` 这类搬过来的去处）喵。
 * @returns `[{ path, name, kind, tier, nonMd }]`：`nonMd` = 该条目不是 `.md` 喵。
 */
export async function scanDocAreas({ project, readdirImpl = readdir } = {}) {
  const kinds = (project && project.docKinds) || {}
  const rows = []
  const walk = async (dir, kind, tier, depth) => {
    if (!dir || depth > 3) return
    let entries = []
    try {
      entries = await readdirImpl(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = joinUnderRoot(dir, entry.name)
      if (entry.isDirectory()) {
        // 产出档下一层的 `L1|L2|L3` 是**档级子目录**（两级布局的第二级），继续下钻并带上档级喵
        const nextTier = kind === '产出档' && /^L[123]$/i.test(entry.name) ? Number(entry.name.slice(1)) : tier
        await walk(path, kind, nextTier, depth + 1)
        continue
      }
      rows.push({
        path,
        name: entry.name,
        kind,
        tier,
        nonMd: !entry.name.toLowerCase().endsWith('.md'),
      })
    }
  }
  for (const [kind, dir] of Object.entries(kinds)) {
    if (kind === '归档') continue
    await walk(dir, kind, null, 0)
  }
  return rows
}

