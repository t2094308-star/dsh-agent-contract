/**
 * 文档目录归属判定喵（DESIGN §5.5「文档目录分类规范」）喵。
 *
 * 规范：**每类一个文件夹，禁止混放**；`仓库/docs/` 根目录不再新增散文件喵。
 *
 * 两条设计选择喵：
 * 1. **判据是文件系统事实，不是台账** —— 散落在根目录的文件本来就不在 docs 索引里，
 *    拿台账去判会"看不见"最该报的那批喵。所以这里直接扫目录。
 * 2. **只判定与上报，绝不移动/改写任何文件** —— 审计是警告制；
 *    迁移由图书管理员做（M4，要带改名 + 更新引用 + 留痕）喵。
 */
import { readdir } from 'node:fs/promises'
import { listMarkdown } from './fs.js'
import { joinUnderRoot } from '../project.js'

/** 统一成 `a/b/c` 形态便于比较（大小写不敏感，Windows 与 POSIX 都吃）喵。 */
function normalize(path) {
  return String(path ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 路径是否位于 dir 之下（含 dir 自身）喵。 */
export function isUnder(path, dir) {
  const target = normalize(path)
  const base = normalize(dir)
  if (!target || !base) return false
  return target === base || target.startsWith(`${base}/`)
}

/**
 * 取一组目录的公共父目录（用来定位"docs 根"）喵。
 * 返回时**沿用首个输入的分隔符风格**——否则 Windows 根会被拼成 `D:\a\b/docs\x` 这种混合形态，
 * 与 `joinUnderRoot()` 的结果对不上喵。
 */
export function commonAncestorOf(dirs) {
  const raw = (dirs || []).map((dir) => String(dir ?? '').replace(/[\\/]+$/, '')).filter(Boolean)
  if (!raw.length) return ''
  const sep = raw[0].includes('\\') ? '\\' : '/'
  const list = raw.map((dir) => dir.replace(/[\\/]+/g, '/'))
  const first = list[0].split('/')
  let end = first.length
  for (const dir of list.slice(1)) {
    const parts = dir.split('/')
    let i = 0
    while (i < end && i < parts.length && parts[i].toLowerCase() === first[i].toLowerCase()) i += 1
    end = i
  }
  return first.slice(0, Math.max(end, 1)).join(sep)
}

/** 按配置判断一份文档应归属的类别名；判不出返回 null喵。 */
export function classifyDocPath(project, path) {
  for (const [kind, dir] of Object.entries(project.docKinds || {})) {
    if (isUnder(path, dir)) return kind
  }
  return null
}

/** 列子目录（读不到就返回空数组）喵。 */
async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * 找出放错位置的文档喵。
 *
 * 判定（与 `doc_misfiled` 审计同口径）喵：
 * - 落在任一 `docKinds` 目录里 → 合规
 * - 直接躺在 `docKinds` 的公共父目录（= docs 根）里 → `docs 根目录散文件`
 * - docs 根下、但不在任何类目录里的子目录中的 `.md` → `不在任何规定类目录内`
 *
 * 未配置 `docKinds` 时返回空数组：**无从判断就不误报**喵。
 * @returns `[{ path, reason }]`喵。
 */
export async function findMisfiled({ project }) {
  const kindDirs = Object.values(project.docKinds || {})
  if (!kindDirs.length) return []
  const docsRoot = commonAncestorOf(kindDirs)
  if (!docsRoot) return []

  const rows = []
  for (const name of await listMarkdown(docsRoot)) {
    rows.push({ path: joinUnderRoot(docsRoot, name), reason: 'docs 根目录散文件' })
  }
  for (const sub of await listDirs(docsRoot)) {
    const dir = joinUnderRoot(docsRoot, sub)
    if (kindDirs.some((kindDir) => isUnder(dir, kindDir) || isUnder(kindDir, dir))) continue
    for (const name of await listMarkdown(dir)) {
      rows.push({ path: joinUnderRoot(dir, name), reason: '不在任何规定类目录内' })
    }
  }
  return rows
}
