/**
 * 项目**自适应**喵（FIX-58）喵：任意新文件夹当仓库即自适应、零配置喵。
 *
 * 用户原话：「这些应该做成插件自适应的，我任意开一个新的文件夹作为仓库应该自适应这个仓库」——
 * 换项目不该要人改 `cordis.patch.yml` 的 name/root/paths/docKinds/archiveDir/todoFile 喵。
 *
 * 三层自适应（+ 一条安全护栏）喵：
 * ① **根自适应**：显式配置 `project.root` 优先（想锁死项目的人说了算）；
 *    否则跟随**当前工作区 / 会话**（`session.header.cwd` → `workspaceRegistry.resolveByPath()` → 登记过的唯一工作区）喵
 * ② **结构自适应**：按**候选清单**探测既有目录（`任务`/`tasks`、`[Agent进度]`/`progress`、
 *    `docs/{研究,坑,修改,核心数据库}` 及其 `仓库/docs/…` 变体…），**命中即用**、绝不动既有文件喵
 * ③ **探不到就自建默认结构**：在项目根内建默认目录与 `待办.md`（**只新建、不覆盖**），
 *    并把"建了什么"如实回报（回执/面板）喵
 * ④ **项目名从目录名推导**（记录表按项目分域 ⇒ 换项目不串），可显式覆盖喵
 * ⑤ 推导结果写 `<项目根>/.agent-contract/project.json`（**随项目走**），下次启动直接读它，
 *    探测结果因此稳定；全局配置降级为"默认/兜底/显式锁定"喵
 *
 * 安全护栏喵：① 只新建不覆盖（目标已存在一律跳过）② `dryRun` 可预览"将建哪些目录"
 * ③ 所有路径解析后必须**落在项目根内**（越界直接抛错）④ 每个动作都进结果清单（留痕）喵。
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { commonAncestorOf } from '../ledger/placement.js'
import { projectKeyOfName } from '../ledger/keys.js'
import { isAbsolutePath, joinUnderRoot, resolveProject } from '../project.js'

/** 项目级元数据的**相对路径**喵（随项目走；派生物，可重建）喵。 */
export const PROJECT_META_REL = '.agent-contract/project.json'

/** 元数据的 schema 版本（不认识就忽略这份缓存，重新探测）喵。 */
export const PROJECT_META_VERSION = 1

/**
 * **布局定义版本**喵（FIX-82）喵：候选清单 / 类别集合 / 两级目录这些"布局定义"变了就 +1 喵。
 *
 * 真机实证：`project.json` 的 `generatedAt` 是 16:53、内容是**旧的六类布局**（没有 FIX-69 新增的
 * 审查 / 整合清单，也没有 `_临时` 与 `产出/L1|L2|L3`）⇒ **插件已升级、旧项目还在用旧布局**
 * （`contract_status` 的"文档规范"段与实际不符、类别判定按旧表走）✗。
 * 规则：加载时比对 —— 不一致就**自动重探**（保留 root/name/key，只重算 paths/docKinds/hits）喵。
 * 2 = FIX-69 的八类 + `tempDir` + 产出档两级子目录喵。
 * 3 = FIX-98 的"临时目录从**已解析的类别路径**算"（不看目录是否存在）—— 递增版本号是为了让已经写回磁盘的
 * **错值**（`<root>/docs/_临时`）被重算一次：版本号一样就永远不重探 ⇒ 错值固化 ✗ 喵。
 */
export const PROJECT_LAYOUT_VERSION = 3

/**
 * **候选清单**喵：每个逻辑位置按顺序探测，命中即用（不命中的候选一个都不动）喵。
 * 顺序刻意是"项目自己的习惯命名"优先、"仓库/ 变体"其后 —— Blockdustry 那类老项目命中后面的变体，
 * 而任意新项目通常一个都不命中 ⇒ 走默认结构喵。
 */
export const STRUCTURE_CANDIDATES = {
  tasksDir: ['任务', 'tasks', 'Tasks'],
  progressDir: ['[Agent进度]', '进度', 'progress', 'Progress'],
  // FIX-69：产出根按新的两级布局 `docs/产出/{L1,L2,L3}/`；旧的 `docs/子agent` 作为**兼容探测位**保留喵
  deliverablesDir: ['docs/产出', '仓库/docs/产出', 'docs/子agent', '仓库/docs/子agent', '子agent', 'deliverables'],
  researchDir: ['docs/研究', '仓库/docs/研究', '研究'],
  reviewDir: ['docs/审查', '仓库/docs/审查', '审查'],
  listDir: ['docs/整合清单', '仓库/docs/整合清单', '整合清单'],
  pitfallDir: ['docs/坑', '仓库/docs/坑', '坑'],
  changeDir: ['docs/修改', '仓库/docs/修改', '修改'],
  coreDbDir: ['docs/核心数据库', '仓库/docs/核心数据库', '核心数据库'],
  archiveDir: ['docs/archive', '仓库/docs/archive', 'archive', '归档'],
  // FIX-69：临时文件统一去处（**非类别目录、审计排除**）：`.json` 这类先搬过来，只搬不删喵
  tempDir: ['docs/_临时', '仓库/docs/_临时', '_临时', 'temp'],
  todoFile: ['待办.md', 'TODO.md', 'todo.md'],
}

/** 探测不到时**新建**的默认结构喵（都落在项目根内）喵。 */
export const DEFAULT_STRUCTURE = {
  tasksDir: '任务',
  progressDir: '[Agent进度]',
  deliverablesDir: 'docs/产出',
  researchDir: 'docs/研究',
  reviewDir: 'docs/审查',
  listDir: 'docs/整合清单',
  pitfallDir: 'docs/坑',
  changeDir: 'docs/修改',
  coreDbDir: 'docs/核心数据库',
  archiveDir: 'docs/archive',
  tempDir: 'docs/_临时',
  todoFile: '待办.md',
}

/** 目录类逻辑位置（`todoFile` 是文件，单独处理）喵。 */
export const STRUCTURE_DIR_KEYS = [
  'tasksDir', 'progressDir', 'deliverablesDir', 'researchDir', 'reviewDir', 'listDir',
  'pitfallDir', 'changeDir', 'coreDbDir', 'archiveDir', 'tempDir',
]

/**
 * **文档类**逻辑位置喵（这几个共享一个"文档根"，缺失时按命中项的公共父目录补建 ——
 * `任务`/`[Agent进度]` 与文档布局无关，不参与这个推断）喵。
 */
export const DOC_STRUCTURE_KEYS = ['deliverablesDir', 'researchDir', 'reviewDir', 'listDir', 'pitfallDir', 'changeDir', 'coreDbDir', 'archiveDir']

/**
 * 类别名 → 结构键 的反查表喵（FIX-98）喵：重探时要按 `project.json` 里记的 `docKinds`（中文类别名）
 * 把"这个项目实际用的位置"还原成结构键 ⇒ 目录整批不存在时也不会被挪到另一棵树喵。
 */
export const STRUCTURE_KEY_OF_KIND = {
  研究: 'researchDir',
  审查: 'reviewDir',
  整合清单: 'listDir',
  坑: 'pitfallDir',
  修改: 'changeDir',
  核心数据库: 'coreDbDir',
  产出档: 'deliverablesDir',
  归档: 'archiveDir',
}

/** 产出档的**档级子目录**（两级布局的第二级；三档名不变：L1 详细归纳 / L2 扩充细节 / L3 高度概括）喵。 */
export const TIER_SUBDIRS = ['L1', 'L2', 'L3']

/** 项目名的净化：去掉路径与常见非法字符（记录表分域键要稳）喵。 */
export function deriveProjectName(root) {
  const leaf = basename(String(root || '').replace(/[\\/]+$/, ''))
  const cleaned = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim()
  return cleaned || 'project'
}

/** 判断路径是否**落在项目根内**（越界一律拒）喵。 */
export function isInsideRoot(root, path) {
  const base = String(root || '').replace(/[\\/]+$/, '').toLowerCase()
  const target = String(path || '').toLowerCase()
  if (!base || !target) return false
  return target === base || target.startsWith(`${base}\\`) || target.startsWith(`${base}/`)
}

/**
 * 根的**优先级**解析喵（纯函数，便于断言）喵。
 * @returns `{ root, source }`：`source` ∈ `config` / `cwd` / `workspace` 喵。
 * @throws 一个来源都拿不到时抛错（早失败，别静默落到某个瞎猜的目录）喵。
 */
export function resolveRoot({ config, cwd, workspaceRoot } = {}) {
  const explicit = config && config.project ? String(config.project.root || '').trim() : ''
  if (explicit) return { root: explicit, source: 'config' }
  const fromCwd = String(cwd || '').trim()
  if (fromCwd && isAbsolutePath(fromCwd)) return { root: fromCwd, source: 'cwd' }
  const fromWorkspace = String(workspaceRoot || '').trim()
  if (fromWorkspace && isAbsolutePath(fromWorkspace)) return { root: fromWorkspace, source: 'workspace' }
  throw new Error(
    'agent-contract: 推不出项目根 —— 既没有显式配置 project.root，也拿不到当前工作区/会话的 cwd。'
    + '请打开一个工作区（或在配置里显式写 project.root）喵',
  )
}

/**
 * 从宿主上下文拿"当前工作区根"喵（可选服务，全部 try 包住）喵。
 *
 * 顺序喵：① `workspaceRegistry.resolveByPath(cwd)`（会话就在工作区根上）
 * ② 登记过的工作区里**包含** cwd 的那个（会话开在子目录里时用祖先工作区当项目根，
 *    免得在 `仓库/` 这种子目录里另起一套 `任务/`）③ 只登记了一个工作区就用它喵。
 * 全拿不到返回 null（外层还有会话 cwd 与显式配置兜底）喵。
 */
export function workspaceRootOf(ctx, cwd) {
  try {
    const registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (!registry) return null
    if (cwd && typeof registry.resolveByPath === 'function') {
      const hit = registry.resolveByPath(cwd)
      const path = hit && (hit.root || hit.path)
      if (path) return String(path)
    }
    if (typeof registry.list === 'function') {
      const rows = Array.isArray(registry.list()) ? registry.list() : []
      const paths = rows.map((row) => String((row && (row.root || row.path)) || '')).filter(Boolean)
      if (cwd) {
        // 取**最长**的祖先（嵌套工作区时选最贴近的那个）喵
        const ancestors = paths.filter((path) => isInsideRoot(path, cwd)).sort((a, b) => b.length - a.length)
        if (ancestors.length) return ancestors[0]
      }
      if (paths.length === 1) return paths[0]
    }
  } catch {
    /* 拿不到就算了：外层还有会话 cwd 与配置兜底喵 */
  }
  return null
}

/**
 * 宿主**已登记的工作区**根列表喵（FIX-95）喵。
 *
 * 为什么需要它：启动自愈不能依赖"用户开始了工作"——真机实证（2026-10-03 22:43）：应用重启了、
 * 客户端也是新版，但 `panel.json` 一个字节没动（还是旧版插件写的），因为多工作区时启动这一刻
 * **推不出"当前项目"**（没有会话），而自愈只挂在"会话出现"上 ⇒ 用户不开工就永远不自愈 ✗。
 *
 * 于是启动时直接扫**宿主登记的工作区**：每个工作区各自有自己的 `.agent-contract/panel.json`，
 * 谁的写入方版本旧就重写谁 —— 这件事**不需要会话**也做得成喵。
 *
 * @returns 工作区根数组；**拿不到清单**（宿主没挂 workspaceRegistry）返回 `null` ——
 *   与"清单是空的"（返回 `[]`）必须分开：前者是"没辙了"，后者是"确实没有工作区"喵。
 */
export function workspaceRootsOf(ctx) {
  try {
    const registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (!registry || typeof registry.list !== 'function') return null
    const rows = registry.list()
    const paths = (Array.isArray(rows) ? rows : [])
      .map((row) => String((row && (row.root || row.path)) || ''))
      .filter(Boolean)
    return [...new Set(paths)]
  } catch {
    return null
  }
}

/** 会话 cwd 喵（`agent.session.header.cwd`；拿不到就 null）喵。 */
export function sessionCwdOf(agent) {
  const header = agent && agent.session ? agent.session.header : null
  const cwd = header && header.cwd ? String(header.cwd) : ''
  return cwd || null
}

/**
 * **结构探测**喵（纯函数：`exists` 与 `isDir` 注入，便于无副作用断言）喵。
 *
 * 关键规则喵：**一个都不命中 ⇒ 按默认结构在建在项目根下**；**只要命中了一个文档类目录 ⇒
 * 缺失的兄弟目录按"命中项的公共父目录"补建**（老项目把文档放在 `仓库/docs/` 下，
 * 就补 `仓库/docs/研究`，**不会**在根下另起一套 `docs/研究` 把两种布局混在一起）喵。
 *
 * @returns `{ hit, create, plan, targets, docsBase }`：`hit` = 命中的既有路径；
 *          `create` = 需要新建的默认路径；`plan` = 给 dryRun 看的"将新建"清单；
 *          `targets` = **每个逻辑位置的最终绝对路径**（命中的用命中项）喵。
 */
export function planStructure({ root, exists = () => false, isDir = () => true, prefer = null } = {}) {
  const hit = {}
  for (const key of STRUCTURE_DIR_KEYS) {
    const candidates = STRUCTURE_CANDIDATES[key] || []
    const found = candidates.map((rel) => joinUnderRoot(root, rel)).find((abs) => exists(abs) && isDir(abs))
    if (found) hit[key] = found
  }
  const todoCandidates = STRUCTURE_CANDIDATES.todoFile || []
  const todoFound = todoCandidates.map((rel) => joinUnderRoot(root, rel)).find((abs) => exists(abs))
  if (todoFound) hit.todoFile = todoFound

  /**
   * FIX-98 ②：**磁盘上一个都没命中时，沿用"缓存里记的位置"**（`prefer`，由调用方从 `project.json` 的
   * `docKinds` 传进来）喵 —— 回滚后的工作区里类别目录可能整批不存在，只按 `exists()` 推会把它们
   * 挪到默认的 `<root>/docs/*`（与项目实际用的树**不是同一棵**）✗。
   * 只对**没有命中**的位置生效；不落在项目根内的一律不采信（防脏缓存把路径带出根）喵
   */
  const carried = {}
  if (prefer && typeof prefer === 'object') {
    for (const [kind, path] of Object.entries(prefer)) {
      const key = STRUCTURE_KEY_OF_KIND[kind]
      if (!key || hit[key]) continue
      if (typeof path !== 'string' || !path.trim() || !isInsideRoot(root, path)) continue
      carried[key] = String(path)
    }
  }
  const settled = (key) => hit[key] || carried[key] || null

  // 文档类位置（命中项优先、其次缓存位置）的公共父目录 ⇒ 缺失的兄弟目录跟着它走喵
  const hitDocs = DOC_STRUCTURE_KEYS.map((key) => settled(key)).filter(Boolean)
  let docsBase = null
  if (hitDocs.length > 1) docsBase = commonAncestorOf(hitDocs)
  else if (hitDocs.length === 1) docsBase = dirname(hitDocs[0])

  const targets = {}
  const create = []
  for (const key of STRUCTURE_DIR_KEYS) {
    if (settled(key)) {
      targets[key] = settled(key)
      if (!hit[key]) create.push({ key, path: settled(key), kind: 'dir' }) // 缓存说过它在哪，但磁盘上确实缺 ⇒ 仍要建喵
      continue
    }
    // FIX-88：**临时目录的默认值必须与类别目录同源** —— 取文档类目录的公共父目录 + `_临时` 喵。
    // 真机：默认写 `<root>/docs/_临时`，而类别全在 `<root>/仓库/docs/*` ⇒ 临时目录长到**另一棵树**上
    // （agent 照规则真把它建出来了，主代理还专门来问"落哪棵树"）✗
    const leaf = key === 'tempDir' ? '_临时' : basename(DEFAULT_STRUCTURE[key])
    const path = docsBase && (DOC_STRUCTURE_KEYS.includes(key) || key === 'tempDir')
      ? joinUnderRoot(docsBase, leaf)
      : joinUnderRoot(root, DEFAULT_STRUCTURE[key])
    targets[key] = path
    create.push({ key, path, kind: 'dir' })
  }
  if (todoFound) {
    targets.todoFile = todoFound
  } else {
    const path = joinUnderRoot(root, DEFAULT_STRUCTURE.todoFile)
    targets.todoFile = path
    create.push({ key: 'todoFile', path, kind: 'file' })
  }
  // FIX-98：临时目录**从已解析的类别路径重算**一遍 —— 上面那轮是按"命中项"推的，而目录**一个都不存在**时
  // （回滚后的工作区就是这样）它只能退回默认值 ⇒ 临时目录长到另一棵树上 ✗。
  // 这里改成"算完类别路径再定临时目录"，与 `pathsFromStructure` 同源（预览/落地/paths 三者一致）喵
  const tempInfo = tempDirInfo({ root, dirs: DOC_STRUCTURE_KEYS.map((key) => targets[key]) })
  if (targets.tempDir && targets.tempDir !== tempInfo.dir) {
    targets.tempDir = tempInfo.dir
    const row = create.find((item) => item.key === 'tempDir')
    if (row) row.path = tempInfo.dir
  }
  // FIX-69：产出根下的**档级子目录**（两级布局的第二级）也要齐 —— 三档各一个，`doc_emit` 直接落到这里喵
  for (const tier of TIER_SUBDIRS) {
    const path = joinUnderRoot(targets.deliverablesDir || joinUnderRoot(root, DEFAULT_STRUCTURE.deliverablesDir), tier)
    targets[`tier${tier}`] = path
    if (!isDir(path)) create.push({ key: `tier${tier}`, path, kind: 'dir' })
  }
  return {
    hit,
    create,
    plan: create.map((row) => `${row.kind === 'dir' ? '目录' : '文件'} ${row.path}`),
    targets,
    docsBase,
  }
}

/**
 * **临时目录与类别目录同源**的算法喵（FIX-98）喵。
 *
 * 真机复验（2026-10-03 23:21）：FIX-88 没生效 —— `project.json` 里 `tempDir` 仍是 `<root>/docs/_临时`，
 * 而类别目录在 `<root>/仓库/docs/*` ⇒ 临时目录**长到另一棵树**上 ✗。
 * 根因：原来那个公共父目录是拿**命中项**（磁盘上**确实存在**的目录）算的，而回滚后的工作区里
 * `仓库/docs/研究`… 这些目录**一个都不存在** ⇒ 算不出 ⇒ 退回默认值（正是要干掉的错值）✗。
 *
 * 现在的规矩：**从"已解析的路径集合"算，不看目录是否存在** ——
 * `docKinds` 各值 + `docsDirs` + `deliverablesDir`（它们本来就是解析结果，与磁盘状态无关）喵。
 * 确实算不出（没有任何类别路径 / 公共父目录就是项目根）⇒ 才退回 `<root>/docs/_临时`，
 * 并**在 notes 里说明原因**（不许静默退回）喵。
 */
export function tempDirInfo({ root, dirs = [] } = {}) {
  const list = (Array.isArray(dirs) ? dirs : [])
    .filter((path) => typeof path === 'string' && path.trim())
    .map((path) => String(path))
    .filter((path) => isInsideRoot(root, path))
  const base = list.length ? commonAncestorOf(list) : null
  // 公共父目录 == 项目根（类别直接摊在根下）⇒ 不把 `_临时` 建到项目根那种地方，退回 `docs/_临时` 喵
  const usable = Boolean(base) && String(base).replace(/[\\/]+$/, '').length > String(root).replace(/[\\/]+$/, '').length
  if (usable) return { dir: joinUnderRoot(base, TEMP_DIR_LEAF), base, fallback: false, reason: null }
  return {
    dir: joinUnderRoot(root, DEFAULT_STRUCTURE.tempDir),
    base: null,
    fallback: true,
    reason: list.length ? '类别目录的公共父目录就是项目根（没有更贴切的共同祖先）' : '没有任何类别目录路径可参考',
  }
}

/** 从一份 `paths` 块算临时目录（`docKinds` 各值 + `docsDirs` + `deliverablesDir`）喵。 */
export function tempDirInfoOfPaths({ root, paths } = {}) {
  const view = paths || {}
  return tempDirInfo({
    root,
    dirs: [
      ...Object.values(view.docKinds || {}),
      ...(Array.isArray(view.docsDirs) ? view.docsDirs : []),
      view.deliverablesDir,
    ],
  })
}

/** 临时目录的叶子名喵（对外只有一个来源）喵。 */
export const TEMP_DIR_LEAF = '_临时'

/**
 * 把探测结果组装成一份可用的 `paths` 块喵（与 `resolveProject()` 的字段一一对应）喵。
 * `docKinds` 的**类别名固定**（研究/坑/修改/核心数据库/产出档/归档），值随项目喵。
 */
export function pathsFromStructure({ root, structure }) {
  // 用 `structure.targets`（探测阶段就算好的最终路径）——保证"预览"与"落地"、与 `paths` 三者同源喵
  const targets = structure.targets || planStructure({ root, exists: () => false, isDir: () => true }).targets
  const dir = (key) => targets[key] || joinUnderRoot(root, DEFAULT_STRUCTURE[key])
  const paths = {
    tasksDir: dir('tasksDir'),
    progressDir: dir('progressDir'),
    deliverablesDir: dir('deliverablesDir'),
    // FIX-69：类型目录 + 产出根（档级子目录在产出根下，随用随建）喵
    docsDirs: [
      dir('researchDir'), dir('reviewDir'), dir('listDir'), dir('pitfallDir'),
      dir('changeDir'), dir('coreDbDir'), dir('deliverablesDir'), dir('archiveDir'),
    ],
    archiveDir: dir('archiveDir'),
    // FIX-69：临时文件的统一去处（**非类别目录、审计排除**）喵
    // FIX-98：**从已解析的类别路径算**（不看目录是否存在），否则回滚后的工作区会拿到"另一棵树"上的错值喵
    tempDir: dir('tempDir'),
    docKinds: {
      研究: dir('researchDir'),
      审查: dir('reviewDir'),
      整合清单: dir('listDir'),
      坑: dir('pitfallDir'),
      修改: dir('changeDir'),
      核心数据库: dir('coreDbDir'),
      产出档: dir('deliverablesDir'),
      归档: dir('archiveDir'),
    },
    todoFile: dir('todoFile'),
  }
  // 所有路径必须落在项目根内（配置里写了 `..` 或绝对路径也要拦住）喵
  assertInsideRoot(root, paths)
  // FIX-98：临时目录**从上面这份已解析的类别路径重算**（不看目录是否存在）——
  // 目录一个都不在时（回滚后的工作区）也不许退回"另一棵树上的默认值" ✗ 喵
  paths.tempDir = tempDirInfoOfPaths({ root, paths }).dir
  assertInsideRoot(root, paths)
  return paths
}

/** 读项目级元数据喵（不存在/版本不符/坏 JSON 一律返回 null ⇒ 重新探测）喵。 */
export async function readProjectMeta(root) {
  try {
    const parsed = JSON.parse(await readFile(joinUnderRoot(root, PROJECT_META_REL), 'utf8'))
    if (!parsed || parsed.version !== PROJECT_META_VERSION || !parsed.paths) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 写项目级元数据喵（**派生物·可重建**，随项目走）喵。
 * 这是".agent-contract/"下的派生文件（与面板快照同性质），失败只警告、不影响主流程喵。
 */
export async function writeProjectMeta(root, meta) {
  const path = joinUnderRoot(root, PROJECT_META_REL)
  const tempPath = `${path}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    // FIX-83 ③：**原子写** —— 先写临时文件再替换，避免半截 JSON 把项目配置搞坏喵
    await writeFile(tempPath, `${JSON.stringify({
      version: PROJECT_META_VERSION,
      // FIX-82：布局定义版本（与插件内的常量比对；不一致 ⇒ 加载时自动重探）喵
      layoutVersion: PROJECT_LAYOUT_VERSION,
      generatedAt: new Date().toISOString(),
      derived: '派生物·可重建（删掉会自动重新探测；不是真相）',
      ...meta,
    }, null, 2)}\n`, 'utf8')
    await rename(tempPath, path)
    return { path, ok: true }
  } catch (error) {
    try { await rm(tempPath, { force: true }) } catch { /* 清不掉也不影响主流程 */ }
    return { path, ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * 落地"自建默认结构"喵（**只新建、绝不覆盖**）喵。
 * @param args.dryRun - 只预览不落盘（回执里给出将建的清单）喵。
 * @returns `{ created, skipped, dryRun, failed }`喵。
 */
export async function ensureStructure({ root, structure, dryRun = false, now = () => new Date().toISOString() }) {
  const created = []
  const skipped = []
  const failed = []
  for (const row of structure.create) {
    if (existsSync(row.path)) {
      skipped.push(row.path)
      continue
    }
    if (dryRun) {
      created.push(row.path)
      continue
    }
    try {
      if (row.kind === 'dir') await mkdir(row.path, { recursive: true })
      else {
        await mkdir(dirname(row.path), { recursive: true })
        await writeFile(row.path, `# 待办\n\n> 由插件自动创建（${now()}）。这是**给人看的大方向待办**，可以直接在面板「待办任务（大方向）」里勾选与编辑喵。\n`, 'utf8')
      }
      created.push(row.path)
    } catch (error) {
      failed.push({ target: row.path, error: String(error && error.message ? error.message : error) })
    }
  }
  return { created, skipped, failed, dryRun }
}

/** 判断配置里是否**显式**给定了目录约定（给了就锁定，不再探测/自建）喵。 */
export function hasExplicitPaths(config) {
  const paths = (config && config.paths) || {}
  const docKinds = paths.docKinds && typeof paths.docKinds === 'object' ? Object.keys(paths.docKinds) : []
  const docsDirs = Array.isArray(paths.docsDirs) ? paths.docsDirs.filter(Boolean) : []
  return docKinds.length > 0 || docsDirs.length > 0
}

/**
 * 项目里"该有"的那些位置喵（顺序即人读顺序）喵。
 *
 * 兼容两种形状：`resolveProject()` / `pathsFromConfig()` 的 paths 块（`todoFile` 在顶层）
 * 与自适应解析出的 project 视图（`panel.todoFile`）喵。
 */
export function structureTargets(project) {
  const view = project || {}
  const todo = view.todoFile || (view.panel && view.panel.todoFile) || ''
  const rows = [
    { key: 'tasksDir', label: '任务', path: view.tasksDir, kind: 'dir' },
    { key: 'progressDir', label: '进度', path: view.progressDir, kind: 'dir' },
    { key: 'deliverablesDir', label: '产出', path: view.deliverablesDir, kind: 'dir' },
    // FIX-69：产出根下的档级子目录（两级布局第二级）也在"该有"之列喵
    ...TIER_SUBDIRS.map((tier) => ({
      key: `tier${tier}`, label: `产出L${tier}`, path: view.deliverablesDir ? joinUnderRoot(view.deliverablesDir, tier) : '', kind: 'dir',
    })),
    ...(Array.isArray(view.docsDirs) ? view.docsDirs : []).map((path) => ({ key: 'docsDirs', label: '文档', path, kind: 'dir' })),
    ...(view.archiveDir ? [{ key: 'archiveDir', label: '归档', path: view.archiveDir, kind: 'dir' }] : []),
    ...(view.tempDir ? [{ key: 'tempDir', label: '临时', path: view.tempDir, kind: 'dir' }] : []),
    ...(todo ? [{ key: 'todoFile', label: '待办', path: todo, kind: 'file' }] : []),
  ].filter((row) => row.path)
  // 同一个路径只算一次（自适应给出来的 docsDirs 里就含产出与归档目录）喵
  const seen = new Set()
  return rows.filter((row) => {
    const dedupeKey = String(row.path).toLowerCase()
    if (seen.has(dedupeKey)) return false
    seen.add(dedupeKey)
    return true
  })
}

/** 路径相对项目根的可读写法（拿不到相对关系就原样返回）喵。 */
function relToRoot(root, path) {
  const base = String(root || '').replace(/[\\/]+$/, '')
  const target = String(path || '')
  if (base && target.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) return target.slice(base.length + 1).replace(/\\/g, '/')
  if (base && target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return target.slice(base.length + 1)
  return target
}

/**
 * **"该有但现在没有"的结构清点**喵（FIX-61）喵。
 *
 * 判据是**文件系统事实**，不是"有没有 `project.json`" —— 初始化过不等于现在还在
 * （目录被删/换了机器/挪了位置都该重新提示）喵。
 * 只**提示**，绝不顺手建：建目录仍是显式动作（`project_init`）喵。
 *
 * @returns `{ missing, hint }`；结构齐了就返回 `null`（不提示，免得变成常驻噪音）喵。
 * @throws 不抛：判据本身出错（权限等）就当"没缺"——提示不值得把工具调用搞挂喵。
 */
export function missingStructure({ project, exists = (path) => existsSync(path) } = {}) {
  try {
    const rows = structureTargets(project).filter((row) => !exists(row.path))
    if (!rows.length) return null
    const root = (project && project.root) || ''
    const names = rows.map((row) => `${relToRoot(root, row.path)}${row.kind === 'dir' ? '/' : ''}`)
    const head = names.slice(0, 4).join('、')
    const more = names.length > 4 ? ` 等 ${names.length} 处` : ''
    return {
      missing: rows.map((row) => row.path),
      names,
      hint: `本工作区尚未初始化：缺少 ${head}${more} —— 调 project_init 可预览并建齐（只新建、不覆盖）`,
    }
  } catch {
    return null
  }
}

/**
 * 显式配置的目录约定 → 绝对路径的 `paths` 块喵。
 *
 * **口径刻意保持与 `resolveProject()` 一致**：配置里给什么就用什么，没给的落到默认结构；
 * `docKinds` **不合成**（配置没写就是空 —— 合成会悄悄改变馆员写核心数据库的位置，
 * 这是配置作者没同意的行为变更）喵。
 */
export function pathsFromConfig(config, root) {
  const shallow = (config && config.paths) || {}
  const rel = (value, fallback) => joinUnderRoot(root, value || fallback)
  const provided = shallow.docKinds && typeof shallow.docKinds === 'object' ? shallow.docKinds : {}
  const docKinds = {}
  for (const [kind, dir] of Object.entries(provided)) docKinds[kind] = rel(dir, dir)
  const paths = {
    tasksDir: rel(shallow.tasksDir, DEFAULT_STRUCTURE.tasksDir),
    progressDir: rel(shallow.progressDir, DEFAULT_STRUCTURE.progressDir),
    deliverablesDir: rel(shallow.deliverablesDir, DEFAULT_STRUCTURE.deliverablesDir),
    docsDirs: Array.isArray(shallow.docsDirs) && shallow.docsDirs.length
      ? shallow.docsDirs.map((dir) => joinUnderRoot(root, dir))
      : [joinUnderRoot(root, DEFAULT_STRUCTURE.researchDir)],
    archiveDir: rel(shallow.archiveDir, DEFAULT_STRUCTURE.archiveDir),
    tempDir: rel(shallow.tempDir, DEFAULT_STRUCTURE.tempDir),
    docKinds,
    todoFile: joinUnderRoot(root, ((config && config.panel) || {}).todoFile || DEFAULT_STRUCTURE.todoFile),
  }
  assertInsideRoot(root, paths)
  return paths
}

/** 路径越界守卫喵（配置里写 `..` 或绝对路径也要拦住）喵。 */
export function assertInsideRoot(root, paths) {
  const values = [
    ...(paths.docsDirs || []), paths.tasksDir, paths.progressDir, paths.deliverablesDir,
    paths.archiveDir, paths.todoFile, ...Object.values(paths.docKinds || {}),
  ]
  for (const value of values) {
    if (value && !isInsideRoot(root, value)) throw new Error(`agent-contract: 路径越出项目根 ${root}：${value}`)
  }
  return paths
}

/**
 * **自适应项目解析**喵：给工具入口用的"一步到位"函数喵。
 *
 * 顺序喵：① 求根（显式配置优先 → 工作区/会话 cwd）② **显式目录约定优先**（给了就锁定，不探测不新建）
 * ③ 否则读 `<root>/.agent-contract/project.json` 缓存 ④ 探测既有结构，探不到就（可选）自建默认结构
 * ⑤ 落盘元数据（失败只警告）喵。
 *
 * @returns `{ root, source, name, key, paths, structure, created, notes, explicit }`喵。
 *          `key` = 记录表的**项目隔离键**（换项目即换域，FIX-58 ③）喵。
 */
export async function resolveAdaptiveProject({
  ctx, config, agent, dryRun = false, ensure = true, forceCreate = false,
  exists = (path) => existsSync(path),
  isDir = (path) => { try { return statSync(path).isDirectory() } catch { return false } },
  readMeta = readProjectMeta, writeMeta = writeProjectMeta, ensureFn = ensureStructure,
} = {}) {
  const { root, source } = resolveRoot({
    config,
    cwd: sessionCwdOf(agent),
    workspaceRoot: workspaceRootOf(ctx, sessionCwdOf(agent)),
  })
  const explicitName = config && config.project ? String(config.project.name || '').trim() : ''
  // FIX-82：布局重探时这两个要**沿用缓存里的**（项目身份不该因为重探而变）⇒ 用 let 喵
  let name = explicitName || deriveProjectName(root)
  let key = projectKeyOfName(name)
  const notes = []
  let structure = { hit: {}, create: [], plan: [] }
  let paths = null
  let created = []
  let skipped = []
  let failed = []
  const explicitPaths = hasExplicitPaths(config)
  /**
   * FIX-61（口径收紧）喵：**建目录只有一个入口 = `project_init`（显式动作、人点头）**。
   * 其余所有工具（含派单）只**提示**，绝不代建 —— 这样"缺结构"这件事一定看得见，
   * 不会出现"某个工具顺手把它建了，用户永远不知道发生过什么"喵。
   * `ensure:false` 仍然表示"这次调用明确不要副作用"；`forceCreate` 才是"真的建"喵。
   */
  const shouldEnsure = Boolean(forceCreate) && ensure !== false

  if (explicitPaths) {
    notes.push('使用**显式配置**的目录约定（配置给了就不按候选清单探测）')
    paths = pathsFromConfig(config, root)
    if (source === 'config') notes.push('使用**显式配置**的项目根（显式锁定优先于工作区推导）')
    // 显式约定的项目也要能被 `project_init` 建齐（否则提示"调 project_init"却建不出东西）喵
    const targets = {}
    const create = []
    for (const row of structureTargets(paths)) {
      targets[row.key] = row.path
      if (!exists(row.path)) create.push({ key: row.key, path: row.path, kind: row.kind })
    }
    structure = { hit: {}, create, plan: create.map((row) => `${row.kind === 'dir' ? '目录' : '文件'} ${row.path}`), targets, docsBase: null }
    if (create.length) {
      const what = create.map((row) => `${row.path.replace(root, '.').replace(/\\/g, '/')}${row.kind === 'dir' ? '/' : ''}`)
      if (shouldEnsure) {
        const done = await ensureFn({ root, structure, dryRun })
        created = done.created
        skipped = done.skipped
        failed = done.failed
        notes.push(dryRun
          ? `结构有缺失，**将新建**：${what.join('、')}（试算：本次未落盘）`
          : `结构有缺失，已新建：${what.join('、')}${done.failed.length ? `（失败 ${done.failed.length} 个）` : ''}`)
      } else {
        notes.push(`结构有缺失（**本项目未自建**）：${what.join('、')} —— 调 project_init 可预览并建齐（只新建、不覆盖）`)
      }
    } else {
      notes.push('显式约定的目录都在（未改动任何文件）')
    }
  } else {
    if (source === 'config') notes.push('使用**显式配置**的项目根，结构按候选清单自适应')
    else notes.push(`项目根随${source === 'cwd' ? '会话 cwd' : '当前工作区'}自适应：${root}`)
    const cached = await readMeta(root)
    // FIX-82：**布局定义过期就自动重探**（保留 root/name/key，只重算 paths/docKinds/hits）——
    // 否则插件升级后旧项目会一直按旧布局跑（真机：六类布局的 project.json 让"文档规范"段与实际不符）喵
    // FIX-98 ③：缓存里的 `tempDir` 与"按类别路径重算"的结果不一致（真机那种"另一棵树上的旧值"）**也**算过期
    // ⇒ 同样重探 + 写回，否则那个错值会一直留着（版本号一致就永远不重探）✗ 喵
    const cachedTemp = cached && cached.paths ? tempDirInfoOfPaths({ root, paths: cached.paths }) : null
    const staleLayout = Boolean(cached && cached.paths && (
      cached.layoutVersion !== PROJECT_LAYOUT_VERSION
      || (cachedTemp && cached.paths.tempDir !== cachedTemp.dir)
    ))
    if (staleLayout) {
      try {
        // FIX-98 ②：重探要**沿用缓存里的类别位置**（`prefer`）—— 回滚后的工作区里那些目录一个都不存在，
        // 只按 exists() 推会把类别挪到 `<root>/docs/*`（另一棵树）✗；缓存里的位置才是这个项目的事实喵
        const reprobed = planStructure({ root, exists, isDir, prefer: cached.paths.docKinds || null })
        paths = pathsFromStructure({ root, structure: reprobed })
        structure = reprobed
        // FIX-82 ②：重探**保留既有 root/name/key**（只重算 paths/docKinds/hits）喵
        if (typeof cached.name === 'string' && cached.name) name = cached.name
        if (typeof cached.key === 'string' && cached.key) key = cached.key
        // FIX-83：**重探 ≠ 持久化** —— 必须写回磁盘（保留 root/name/key）喵。
        // 不写回的代价（真机）：每次解析都白重探一次，而且磁盘文件与真实布局不一致 ⇒
        // **任何直接读该文件的人/代码都会被误导**（核对者本人就被旧六类误导过一轮）✗。
        // 写失败**不静默**（进 notes），且下次解析继续重探（不因为写失败就放弃重探）喵
        //
        // FIX-92：**写回不受 `ensure` 门控**喵 —— `ensure` 只管"这次要不要**新建目录**"，
        // 与"要不要修正一份**过期的派生物**"是两件事。真机实证：启动那条"点亮快照"的解析路径是
        // 只读的（`ensure: false`）⇒ 重探只在内存里发生、`project.json` 的 mtime 一直停在旧时间、
        // layoutVersion/八类/tempDir 全都没落盘（FIX-83 等于没生效）✗。
        // 现在只有**显式 dryRun** 才不写回，且必须说明"为什么没写"（不许静默）喵
        if (!dryRun) {
          const saved = await writeMeta(root, { root, name, key, paths, hits: reprobed.hit })
          notes.push(saved && saved.ok
            ? `重探结果已写回 ${PROJECT_META_REL}（layoutVersion ${PROJECT_LAYOUT_VERSION}）喵`
            : `重探结果**写回失败**（${(saved && saved.error) || '未知原因'}）—— 内存视图已按新布局，下次解析会继续重探喵`)
        } else {
          notes.push(`本次为 **dryRun（只读试算）** ⇒ 重探结果**未写回** ${PROJECT_META_REL}`
            + `（磁盘上还是 ${cached.layoutVersion || '(无版本)'} 版；下次非 dryRun 的解析会写回）喵`)
        }
        notes.push(`项目布局已**自动重探**（旧 ${PROJECT_META_REL} 是 ${cached.layoutVersion || '(无版本)'} 版布局，当前 ${PROJECT_LAYOUT_VERSION} 版）—— `
          + `类别补成 ${Object.keys(paths.docKinds).join(' / ')}；探测本身**只读**，建目录仍由 project_init 显式落地喵`)
        if (structure.create.length) {
          notes.push(`重探后发现缺 ${structure.create.length} 处结构 —— 调 project_init 可预览并建齐（只新建、不覆盖）`)
        }
      } catch (error) {
        // 重探失败 ⇒ **沿用旧值**并给警告（绝不让一次重探把项目打回不可用）喵
        paths = cached.paths
        structure = { hit: cached.hits || {}, create: [], plan: [] }
        notes.push(`项目布局重探失败，沿用旧值：${error && error.message ? error.message : error}喵`)
      }
    } else if (cached && cached.paths) {
      notes.push(`项目元数据命中缓存：${PROJECT_META_REL}（随项目走）`)
      paths = cached.paths
      // FIX-61：命中缓存也要**清点缺了什么**（目录被删/换了机器都该重新提示），但不代建、不重写元数据喵
      const missing = structureTargets(paths).filter((row) => !exists(row.path))
      structure = {
        hit: cached.hits || {},
        create: missing.map((row) => ({ key: row.key, path: row.path, kind: row.kind })),
        plan: missing.map((row) => `${row.kind === 'dir' ? '目录' : '文件'} ${row.path}`),
      }
      if (missing.length) {
        notes.push(`元数据说结构齐，但实际缺 ${missing.length} 处 —— 调 project_init 可预览并建齐（只新建、不覆盖）`)
      }
    } else {
      structure = planStructure({ root, exists, isDir })
      if (structure.create.length) {
        const what = structure.create.map((row) => row.path.replace(root, '.').replace(/\\/g, '/'))
        if (shouldEnsure) {
          const done = await ensureFn({ root, structure, dryRun })
          created = done.created
          skipped = done.skipped
          failed = done.failed
          notes.push(
            dryRun
              ? `探测不到既有结构，**将新建**：${what.join('、') || '(无)'}（试算：本次未落盘）`
              : `探测不到既有结构，已新建：${what.join('、') || '(无)'}${done.failed.length ? `（失败 ${done.failed.length} 个）` : ''}`,
          )
        } else {
          notes.push(`探测不到既有结构（本次只读，未自建）：将新建 ${what.join('、') || '(无)'} —— 调 project_init 可预览并建齐（只新建、不覆盖）`)
        }
      } else {
        notes.push('结构探测命中既有目录（未改动任何文件）')
      }
      paths = pathsFromStructure({ root, structure })
      // dryRun 一律不落盘（含元数据）；只读路径也不写，免得"看一眼"就产生副作用喵
      if (shouldEnsure && !dryRun) await writeMeta(root, { root, name, key, paths, hits: structure.hit })
    }
  }

  // FIX-98 ②：临时目录确实算不出"与类别目录同树"时**必须说明原因**（真机那种"另一棵树上的默认值"就是
  // 悄悄退回去的，谁都不知道）—— 正常的项目不该走到这里喵
  if (paths) {
    const tempInfo = tempDirInfoOfPaths({ root, paths })
    if (tempInfo.fallback) {
      notes.push(`临时目录算不出"与类别目录同树"的位置（${tempInfo.reason}）⇒ 退回 ${tempInfo.dir} 喵`)
    }
  }

  // FIX-88 ③：**显式配置优先** —— 配置里写了 `paths.tempDir` 就用它
  // （自适应只负责"没写时让临时目录跟类别目录同源"）喵
  const explicitTemp = config && config.paths ? String(config.paths.tempDir || '').trim() : ''
  if (explicitTemp && paths) {
    const resolvedTemp = isAbsolutePath(explicitTemp) ? explicitTemp : joinUnderRoot(root, explicitTemp)
    if (!isInsideRoot(root, resolvedTemp)) {
      throw new Error(`agent-contract: 临时目录越出项目根 ${root}：${resolvedTemp}`)
    }
    paths.tempDir = resolvedTemp
    notes.push(`临时目录用**显式配置**：${resolvedTemp}`)
  }

  return {
    root, source, name, key, paths, structure, notes,
    created, skipped, failed,
    plan: structure.plan,
    explicit: source === 'config',
    explicitPaths,
  }
}


/** 配置能不能独立成一份"项目视图"喵：拿不到就 null（自适应模式下没配 root 是合法的）喵。 */
export function safeResolveProject(config) {
  try {
    return resolveProject(config)
  } catch {
    return null
  }
}

/**
 * **每次调用解析一次项目**的解析器喵（FIX-58）喵 —— 工具与委派通道**共用同一份**，
 * 免得两个入口对"现在服务哪个项目"给出两种答案（那会让契约文案与实际落盘目录对不上）喵。
 *
 * @param args.ctx - 插件上下文（拿工作区用）喵。
 * @param args.config - 插件配置喵。
 * @param args.ledger - `createLedger()` 的结果（按项目键取分域 store）喵。
 * @param args.projects - 项目登记簿（登记后面板/待办路由才能反查）喵。
 * @returns `projectFor(exec, { ensure })` → `{ project, notes, key, store }`喵。
 */
export function createProjectResolver({ ctx, config, ledger, projects } = {}) {
  const storeOf = async (key) => {
    if (!ledger || !ledger.ready) throw new Error('agent-contract: 台账未初始化（storageDomain 服务不可用？）')
    /**
     * FIX-97 ③：**领域打不开不许静默**喵 —— 真机上一条老记录不合新 schema ⇒ 宿主逐条 parse 抛
     * `invalid-record` ⇒ `ledger.ready` reject ⇒ 以前这条链被静默吞掉，用户只看到"所有契约工具一起废"，
     * **无从判断该干什么** ✗。现在把宿主原话 + 处置建议一起抛出去（工具回执里就看得到）喵。
     */
    let base
    try {
      base = await ledger.ready
    } catch (error) {
      const why = (error && error.message) || String(error)
      throw new Error(
        `agent-contract: **台账领域打不开** —— ${why}`
        + '｜处置：① **完整重启应用**（只刷新窗口/页面不算；升级插件后进程里可能还跑着旧 schema）；'
        + '② 重启后仍报，跑一次 `contract_status` 看首两行有没有"版本漂移"；'
        + '③ 都不行就把上面这句原因贴出来（多半是某条记录不合 schema：宿主会把它挪去备份并跳过）',
      )
    }
    if (!key || typeof ledger.storeFor !== 'function') return base
    return ledger.storeFor(key)
  }

  return async function projectFor(exec, options = {}) {
    try {
      // **任何工具都不建目录**（FIX-61：建目录是 `project_init` 的显式动作）——
      // 这里只解析 + 只读清点，把"缺什么"写进 notes 让各回执去提示喵
      const adaptive = await resolveAdaptiveProject({
        ctx, config, agent: exec && exec.agent, ensure: options.ensure === true,
      })
      const base = safeResolveProject(config)
      const project = {
        ...(base || {}),
        name: adaptive.name,
        root: adaptive.root,
        // **键也要挂在项目视图上**（0.21.0 真机回归修复）喵：登记簿是 `key ⇒ 项目`，但拿不到 key 的调用方
        // （典型：面板「强制刷新」那条 HTTP 路由，它只从待办路径反查到项目对象）就**取不到该项目的 store** ⇒
        // 按钮报「台账 store 未绑定（no-store）」而数据其实好端端在 ✗。构建视图的地方就把 key 带上，谁都别再自己推喵
        key: adaptive.key,
        tasksDir: adaptive.paths.tasksDir,
        progressDir: adaptive.paths.progressDir,
        deliverablesDir: adaptive.paths.deliverablesDir,
        docsDirs: adaptive.paths.docsDirs,
        archiveDir: adaptive.paths.archiveDir,
        docKinds: adaptive.paths.docKinds,
        budgets: (base && base.budgets) || (config && config.budgets) || {},
        audit: (base && base.audit) || (config && config.audit) || {},
        panel: { ...((base && base.panel) || {}), todoFile: adaptive.paths.todoFile },
      }
      // 登记：面板同步器 / 待办写路由拿不到会话，只能按这条登记反查项目喵
      // FIX-82：把自适应推导的说明挂到项目视图上 —— 快照带出去后，面板 tooltip 也能看到"布局已重探/失败"喵
      project.notes = adaptive.notes
      // FIX-84：把"已归档会话"带给快照（面板据此给成员打"已归档"标）喵
      const archivedIds = archivedSessionIdsOf(ctx)
      if (archivedIds) project.archivedSessionIds = [...archivedIds]
      if (projects && typeof projects.remember === 'function') projects.remember(adaptive.key, project)
      return { project, notes: adaptive.notes, key: adaptive.key, store: await storeOf(adaptive.key) }
    } catch (error) {
      const why = error && error.message ? error.message : String(error)
      const base = safeResolveProject(config)
      // 配置也没法独立成项目视图 ⇒ 是真的推不出根了，早失败并把原因带上喵
      if (!base) throw new Error(`agent-contract: 推不出项目根 —— ${why}`)
      return { project: base, notes: [`自适应推导失败：${why}`], key: null, store: await storeOf(null) }
    }
  }
}

/**
 * 读宿主侧"**已归档会话** id"喵（FIX-84）喵：`ctx.workspaceRegistry` 是**可选**服务 ——
 * **拿不到就返回 null**（调用方据此保持今天的行为：静默降级、不报错）喵。
 *
 * 归档 = 用户明确说"这些不用管了" ⇒ 审计按它豁免活动态判定（`ghost_run` / `unreleased_run` /
 * `missing_doc` / `orphan_task`），面板据此给成员打"已归档"标喵。
 */
export function archivedSessionIdsOf(ctx) {
  try {
    const registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (!registry) return null
    const ids = registry.archivedSessionIds || (registry.state && registry.state.archivedSessionIds) || null
    if (!ids) return null
    return new Set(Array.from(ids).map((id) => String(id)))
  } catch {
    return null
  }
}
