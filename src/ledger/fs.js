/**
 * 台账相关的文件系统小工具喵。
 * 抽出来是为了让 `derive.js` / `rebuild.js` / `librarian/duties.js` 共用同一份实现，
 * 免得三处各写一遍再慢慢漂移喵。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { joinUnderRoot } from '../project.js'

/** 列目录下的 .md（目录不存在返回空数组，不抛错）喵。 */
export async function listMarkdown(dir) {
  try {
    const names = await readdir(dir)
    return names.filter((name) => name.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
}

/**
 * **递归**列目录下的 `.md`（返回**相对该目录**的路径）喵（FIX-69）喵。
 *
 * 为什么要它：产出档改成两级布局（`docs/产出/{L1,L2,L3}/`）后，非递归的 `listMarkdown()` 在产出根下
 * **一篇 .md 都看不见**（只看到三个子目录）⇒ 台账 / 派生器 / 切片 / 账目全都漏档 ✗。
 * 返回相对路径是为了让调用方继续用 `joinUnderRoot(dir, name)` 拼绝对路径 —— **形状不变**喵。
 */
export async function listMarkdownDeep(dir, prefix = '') {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownDeep(joinUnderRoot(dir, entry.name), rel)))
      continue
    }
    if (entry.name.toLowerCase().endsWith('.md')) out.push(rel)
  }
  return out
}

/**
 * 读一个文件喵。
 * @returns `{ text, mtime }`；文件不存在 / 不是普通文件时返回 null喵。
 */
export async function readFileIfPresent(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return { text: await readFile(path, 'utf8'), mtime: info.mtimeMs }
  } catch {
    return null
  }
}

/** 取路径的文件名片段（Windows 与 POSIX 分隔符都认）喵。 */
export function baseNameOf(path) {
  return String(path).split(/[\\/]/).pop()
}
