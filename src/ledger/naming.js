/**
 * 命名规范喵。
 *
 * - 成员名：`<任务号>-<角色>`（DESIGN §8）
 * - 文档名：`<任务号>_<标题>_L<档级>.md`（L3 / L2 / L1）
 * - 修复总结：`<任务号>_<标题>_fix.md`（无任务号时退化为 `<标题>_fix.md`）
 *
 * 这里的 slug 只做「文件系统安全化」：Windows 非法字符与空白折叠成 `-`，**不改大小写**——
 * 任务号是使用者自己定的标识（如 `T-001`），强行小写会与磁盘上的任务文件名对不上喵。
 */

/** Windows 非法文件名字符 + 空白，统一折叠为 `-` 喵。 */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\s]+/g

/**
 * 把一段文本变成文件系统安全的名字片段喵。
 * 保留中英文原样，只处理非法字符，并去掉首尾的 `-` 与 `.`喵。
 */
export function slug(value) {
  return String(value ?? '')
    .trim()
    .replace(UNSAFE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/**
 * 成员名喵：默认 `<任务号>-<角色>`；**常驻单例**角色（FIX-79）只有角色名（`librarian`），不带任务号喵。
 *
 * 为什么单例不拼任务号：它**服务所有任务**、只有**一条**成员记录；任务归属由文档 front-matter 的
 * `taskId` 承载（审计按任务号走，不受影响）喵。
 */
export function memberName(taskId, roleId, options = {}) {
  const role = slug(roleId)
  if (!role) throw new Error('agent-contract: 成员名需要角色 id')
  if (options && options.singleton === true) return role
  const task = slug(taskId)
  if (!task) throw new Error('agent-contract: 成员名需要任务号与角色 id')
  return `${task}-${role}`
}

/**
 * 反解成员名喵。
 * 任务号本身可能含 `-`（如 `T-001`），因此以**最后一个** `-` 为界切分喵。
 * @returns `{ taskId, role }` 或 null喵。
 */
export function parseMemberName(name) {
  const value = String(name ?? '')
  const index = value.lastIndexOf('-')
  if (index <= 0 || index === value.length - 1) return null
  return { taskId: value.slice(0, index), role: value.slice(index + 1) }
}

/** 文档档级字面量（L1/L2/L3 → 1/2/3）喵。 */
export const DOC_TIERS = [1, 2, 3]

/**
 * 按**已知任务号**精确剥离前缀取标题喵（FIX-19）喵。
 *
 * 为什么不能用"第一个下划线"：任务号本身可能含下划线（`T-800_A`），
 * 第一个下划线猜出来的"任务号"是 `T-800`、标题是 `A_报告与结论`；
 * 而 front-matter 里的 taskId 是全的 → 拼名时变成 `T-800_A_A_报告与结论`，
 * **每轮治理都把任务号多拼一遍**（已在 Blockdustry 污染 4 篇）喵。
 *
 * 幂等守卫：剥离后的标题若**自身又以 `taskId_` 开头**（历史重复前置留下的），继续剥到干净为止喵。
 * @returns 标题（可能是空串 = 只有任务号没有标题）；**前缀对不上时返回 null**（交给调用方退回旧口径）喵。
 */
export function stripTaskPrefix(stem, taskId) {
  const task = slug(taskId)
  if (!task) return null
  let rest = String(stem ?? '')
  if (rest === task) return ''
  if (!rest.startsWith(`${task}_`)) return null
  rest = rest.slice(task.length + 1)
  let guard = 0
  while (rest.startsWith(`${task}_`) && guard < 5) {
    rest = rest.slice(task.length + 1)
    guard += 1
  }
  return rest
}

/**
 * 新名是否落进「任务号拼两遍」的病态形态喵（FIX-19 起，FIX-32 改为**语义判**）喵。
 *
 * 判据是**语义**的：把已知任务号前缀剥掉之后，剩下的标题**仍以 `taskId_` 开头** ⇒ 这就是重复前置喵。
 * 不再看"名字里出现了两次任务号"这种字面特征（那会把 `T-800_A_T-800` 这类合法标题也误伤）喵。
 *
 * 传入的应当是**已剥过前缀的标题**（`titleFromFileName()` 的产物），不是整个文件名喵。
 */
export function hasDoubledTaskPrefix(title, taskId) {
  const task = slug(taskId)
  if (!task) return false
  return String(title ?? '').startsWith(`${task}_`)
}

/** 文档名尾部后缀喵：`_L1` / `_L2` / `_L3` / `_fix` / 各**类型后缀**（FIX-69）喵。 */
const DOC_SUFFIX_RE = /_(L[123]|fix|研究|审查|整合清单|坑|修改|核心数据库)$/

/**
 * **类型后缀**喵（FIX-69）喵：类型 → 目录，**后缀与所在目录必须一致**喵。
 * `产出档` 是特例：它按**档级**分子目录，后缀是 `_L<n>`（三档名不变：L1 详细归纳 / L2 扩充细节 / L3 高度概括）喵。
 */
export const KIND_SUFFIXES = {
  研究: '_研究',
  审查: '_审查',
  整合清单: '_整合清单',
  坑: '_坑',
  修改: '_修改',
  核心数据库: '_核心数据库',
  产出档: null, // 产出档用 `_L<n>`
  归档: null,
}

/** 产出档的档级子目录名（两级布局的第二级）喵。 */
export function tierSubdir(tier) {
  const level = Number(tier)
  if (!DOC_TIERS.includes(level)) throw new Error(`agent-contract: 档级必须是 1/2/3，收到 ${tier}`)
  return `L${level}`
}

/**
 * **归档标记从文件名搬到元数据**喵（FIX-69）喵。
 *
 * 用户拍板：`^` 前缀**原来是"归档"的意思** ⇒ 改为 front-matter 的 `archived: true`，文件名不再带 `^`喵。
 * 这里只做**纯字符串**处理（便于断言与迁移复用）喵。
 * @returns `{ name, archived }`：`archived` = 原名是否带 `^`（迁移时据此写元数据）喵。
 */
export function stripArchiveCaret(fileName) {
  const raw = String(fileName ?? '')
  if (raw.startsWith('^')) return { name: raw.slice(1), archived: true }
  return { name: raw, archived: false }
}

/** 类型文档名：`<任务号>_<标题>_<类型>.md`（产出档请用 `docFileName` + 档级子目录）喵。 */
export function kindFileName(taskId, title, kind) {
  const task = slug(taskId)
  const name = slug(title)
  const suffix = KIND_SUFFIXES[kind]
  if (!task) throw new Error('agent-contract: 文档名需要任务号')
  if (!name) throw new Error('agent-contract: 文档名需要标题')
  if (!suffix) throw new Error(`agent-contract: 类型 ${kind} 没有文件名后缀（产出档按档级命名）`)
  return `${task}_${name}${suffix}.md`
}

/** 从文件名判**类型后缀**（判不出返回 null）喵。 */
export function kindFromFileName(fileName) {
  const base = stripArchiveCaret(fileName).name
  const stem = base.replace(/\.md$/i, '')
  for (const [kind, suffix] of Object.entries(KIND_SUFFIXES)) {
    if (suffix && stem.endsWith(suffix)) return kind
  }
  if (/_L[123]$/i.test(stem)) return '产出档'
  if (/_fix$/i.test(stem)) return '产出档'
  return null
}

/** 从文件名主干里切出 `{ title, suffix }`（没有后缀则 suffix 为 null）喵。 */
export function splitDocSuffix(stem) {
  const value = String(stem ?? '')
  const match = DOC_SUFFIX_RE.exec(value)
  if (!match) return { title: value, suffix: null }
  return { title: value.slice(0, value.length - match[0].length), suffix: match[1] }
}

/**
 * **只按当前文件名 + 权威任务号**提取标题喵（FIX-32，治本）喵。
 *
 * 为什么不再信 `doc.title`：那是**派生缓存**，可能是旧口径（"第一个下划线"）留下的脏值——
 * 拿脏标题去拼新名，就会把"本来合规的档"判成需要改名（实测：4 篇 T99 档被一轮轮要求改名）喵。
 * 文件名的真相是 `<taskId>_<标题>_<后缀>.md`，所以口径是喵：
 * ① 剥掉**已知任务号前缀**（`startsWith(taskId + '_')`）；② 切掉尾部 `_L1|_L2|_L3|_fix`；
 * ③ 剩下的就是标题；若它**仍以 `taskId_` 开头** ⇒ `doubled: true`（重复前置，交给调用方拦下）喵。
 *
 * @returns `{ title, suffix, doubled, hadPrefix }`；`title` 为空串 = 只有任务号、没有标题喵。
 */
export function titleFromFileName(fileName, taskId) {
  const stem = String(fileName ?? '').replace(/\.md$/i, '')
  const task = slug(taskId)
  const hadPrefix = Boolean(task) && stem.startsWith(`${task}_`)
  const rest = hadPrefix ? stem.slice(task.length + 1) : stem
  const { title, suffix } = splitDocSuffix(rest)
  return { title, suffix, doubled: hasDoubledTaskPrefix(title, taskId), hadPrefix }
}

/** 文档名：`<任务号>_<标题>_L<档级>.md`喵。 */
export function docFileName(taskId, title, tier) {
  const task = slug(taskId)
  const name = slug(title)
  if (!task) throw new Error('agent-contract: 文档名需要任务号')
  if (!name) throw new Error('agent-contract: 文档名需要标题')
  if (!DOC_TIERS.includes(Number(tier))) throw new Error(`agent-contract: 档级必须是 1/2/3，收到 ${tier}`)
  return `${task}_${name}_L${tier}.md`
}

/**
 * 反解文档名喵。
 *
 * **FIX-19 的关键改动**：传了 `taskId` 就按它**精确剥离前缀**（`startsWith(taskId + '_')`），
 * 不再用"第一个下划线"猜；没传（或前缀对不上）才退回旧口径，存量旧档仍能反解喵。
 * @returns `{ taskId, title, tier }`；不符合新规范（存量旧档）时返回 null喵。
 */
export function parseDocFileName(fileName, taskId) {
  const base = stripArchiveCaret(String(fileName ?? '')).name
  const kind = kindFromFileName(base)
  const suffix = /_L([123])\.md$/i.exec(base)
  if (!suffix) {
    // FIX-69：类型档（`_研究` / `_审查` / `_整合清单` …）没有档级，`tier` 记 0（= 非三档）喵
    if (!kind || kind === '产出档') return null
    const tail = KIND_SUFFIXES[kind]
    const stem = base.slice(0, base.length - tail.length - 3) // 去掉 `_<类型>.md`
    if (taskId) {
      const title = stripTaskPrefix(stem, taskId)
      if (title !== null) return title ? { taskId: slug(taskId), title, tier: 0, kind } : null
    }
    const match = /^(.+?)_(.+)$/.exec(stem)
    if (!match) return null
    return { taskId: match[1], title: match[2], tier: 0, kind }
  }
  const tier = Number(suffix[1])
  const stem = base.slice(0, base.length - suffix[0].length)
  if (taskId) {
    const title = stripTaskPrefix(stem, taskId)
    // 前缀对得上：精确结果就是它（标题为空 = 只有任务号，判不出，返回 null）喵
    if (title !== null) return title ? { taskId: slug(taskId), title, tier, kind: '产出档' } : null
  }
  const match = /^(.+?)_(.+)$/.exec(stem)
  if (!match) return null
  return { taskId: match[1], title: match[2], tier, kind: '产出档' }
}

/** 修复总结文件名喵。 */
export function bugfixFileName(taskId, title) {
  const name = slug(title)
  if (!name) throw new Error('agent-contract: 修复总结需要标题')
  const task = slug(taskId)
  return task ? `${task}_${name}_fix.md` : `${name}_fix.md`
}

/** 进度文件名：`<任务名>.md`（总纲 §2）喵。 */
export function progressFileName(taskId) {
  const task = slug(taskId)
  if (!task) throw new Error('agent-contract: 进度文件需要任务号')
  return `${task}.md`
}
