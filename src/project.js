import { readdir, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/**
 * Windows 盘符路径（D:\\... 或 D:/...）与 UNC 路径，在非 win32 的 Node 里
 * isAbsolute() 会判 false；插件运行在 Windows 宿主上，但这里做成跨平台安全。
 */
export function isAbsolutePath(value) {
  const p = String(value || '')
  if (!p) return false
  if (isAbsolute(p)) return true
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (p.startsWith('\\\\')) return true
  return false
}

function isWindowsStyle(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || String(path).startsWith('\\\\')
}

/** 规范化根路径：Windows 风格统一成正斜杠→反斜杠、去尾部分隔符、补回纯盘符根。 */
function canonicalRoot(value) {
  let r = String(value || '').trim().replace(/[\\/]+$/, '')
  if (!r) return ''
  if (/^[A-Za-z]:$/.test(r)) r += '\\'
  return isWindowsStyle(r) ? r.replace(/\//g, '\\') : r
}

/**
 * 按 root 的路径风格拼接子路径：Windows 根用反斜杠、POSIX 根用正斜杠，
 * 避免出现 `D:\Blockdustry/任务` 这类混合分隔符（跨平台配置的常见坑）。
 */
export function joinUnderRoot(root, child) {
  const r = String(root || '').replace(/[\\/]+$/, '')
  const c = String(child || '').replace(/^[\\/]+/, '')
  const sep = isWindowsStyle(r) ? '\\' : '/'
  return `${r}${sep}${c.replace(/[\\/]/g, sep)}`
}

function toAbsolute(root, value) {
  const p = String(value || '').trim()
  if (!p) return ''
  return isAbsolutePath(p) ? p : joinUnderRoot(root, p)
}

/** 把插件配置解析成一份"项目视图"（全部为绝对路径）。 */
export function resolveProject(config) {
  const projectCfg = (config && config.project) || {}
  const rawRoot = String(projectCfg.root || '').trim()
  if (!rawRoot) {
    throw new Error('agent-contract: project.root 未配置（请在该插件的 config 中填写项目根目录）')
  }
  const root = canonicalRoot(rawRoot)
  const paths = (config && config.paths) || {}
  const docKindsRaw = (paths.docKinds && typeof paths.docKinds === 'object') ? paths.docKinds : {}
  const docKinds = {}
  for (const [kind, dir] of Object.entries(docKindsRaw)) {
    const abs = toAbsolute(root, dir)
    if (abs) docKinds[kind] = abs
  }
  return {
    name: String(projectCfg.name || ''),
    root,
    tasksDir: toAbsolute(root, paths.tasksDir || '任务'),
    progressDir: toAbsolute(root, paths.progressDir || '[Agent进度]'),
    deliverablesDir: toAbsolute(root, paths.deliverablesDir || 'docs/子agent'),
    docsDirs: (paths.docsDirs || []).map((d) => toAbsolute(root, d)).filter(Boolean),
    // 归档分片目录（M4 定策略，M2.5 先作为配置项与审计范围的一部分）喵
    archiveDir: toAbsolute(root, paths.archiveDir || ''),
    // FIX-69：临时文件统一去处（**非类别目录、审计排除**）喵
    tempDir: toAbsolute(root, paths.tempDir || 'docs/_临时'),
    // FIX-80：**新建文件的行尾**（默认 LF，与仓库既有 .md 现状一致；仓库另有约定时可配）喵
    newFileEol: String(paths.newFileEol || 'lf').toLowerCase() === 'crlf' ? 'crlf' : 'lf',
    // 类别 → 目录：审计/馆员据此判「文档是否放错」喵（DESIGN §5.5 文档目录分类规范）
    docKinds,
    budgets: (config && config.budgets) || {},
    audit: (config && config.audit) || {},
    // 面板（FIX-29）：待办原文的**绝对路径**（默认 `<项目根>/待办.md`，可配 `panel.todoFile`）喵。
    // 由 host 算好放进派生快照 —— 否则 client 拿不到项目根，读待办就成了鸡生蛋喵。
    panel: {
      todoFile: toAbsolute(root, ((config && config.panel) || {}).todoFile || '待办.md'),
    },
  }
}

async function probeDir(dir) {
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) {
      return { path: dir, exists: true, isDirectory: false, entries: null, markdown: null, newest: null }
    }
    const names = await readdir(dir)
    let markdown = 0
    let newest = 0
    for (const entry of names) {
      if (entry.toLowerCase().endsWith('.md')) markdown += 1
      try {
        const st = await stat(joinUnderRoot(dir, entry))
        if (st.mtimeMs > newest) newest = st.mtimeMs
      } catch {
        /* 单个条目读不到不影响整体 */
      }
    }
    return {
      path: dir,
      exists: true,
      isDirectory: true,
      entries: names.length,
      markdown,
      newest: newest ? new Date(newest).toISOString() : null,
    }
  } catch (error) {
    return {
      path: dir,
      exists: false,
      isDirectory: false,
      entries: null,
      markdown: null,
      newest: null,
      error: error && error.code ? error.code : String(error && error.message ? error.message : error),
    }
  }
}

/** 体检：目录是否存在、有多少 md、最新更新时间。 */
export async function scanProject(project) {
  const targets = [
    ['tasks', project.tasksDir],
    ['progress', project.progressDir],
    ['deliverables', project.deliverablesDir],
    // 归档目录配了才体检（M4 才定分片策略，未配时不刷噪音）喵
    ...(project.archiveDir ? [['archive', project.archiveDir]] : []),
    ...project.docsDirs.map((d, i) => [`docs[${i}]`, d]),
    // 每个文档类别目录也单独体检，便于发现"规定的类目录还没建"喵
    ...Object.entries(project.docKinds || {}).map(([kind, dir]) => [`kind:${kind}`, dir]),
  ]
  const dirs = []
  for (const [label, dir] of targets) {
    if (!dir) continue
    dirs.push({ label, ...(await probeDir(dir)) })
  }
  const missing = dirs.filter((d) => !d.exists).map((d) => `${d.label}:${d.path}`)
  return { dirs, missing }
}
