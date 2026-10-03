/**
 * 写前备份喵（FIX-22 / DESIGN §9-26「覆盖既有文件前必须先备份（硬规则）」）喵。
 *
 * 实测教训：一轮授权治理**整篇覆盖**了 `仓库/docs/坑/README.md`（人工编排的任务类型表 +
 * 使用规则 4 条），而该文件**无 git、无备份 → 内容不可恢复**喵。
 *
 * 三条硬口径喵：
 * ① 任何会**改写/覆盖既有文件**的动作（索引重建、命名规范化、归档、格式直修、changelog 追加），
 *    写前先把原文件复制到 `<项目根>/.agent-contract/backups/<时间戳>/<相对路径>`；
 * ② **备份失败即中止该文件的写入**（返回 `ok:false`，调用方记 warning 并跳过）——宁可少写一篇，
 *    也不能在"没有退路"的情况下覆盖人家的档；
 * ③ 备份落在**持久区** `.agent-contract/` 下（不是会被清理的 `.review-tmp`）喵。
 *
 * 备份目录是**派生物性质的过程留痕**：可随时清空，但要清就整批清（别只删一半）喵。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import { joinUnderRoot } from '../project.js'

/** 备份根目录（相对项目根）喵。 */
export const BACKUP_DIR_REL = '.agent-contract/backups'

/** 备份根目录的绝对路径喵。 */
export function backupRoot(project) {
  return joinUnderRoot(project.root, BACKUP_DIR_REL)
}

/** 时间戳目录名：把 ISO 里的 `:`/`.` 换掉（Windows 文件名不允许）喵。 */
export function backupStamp(iso) {
  return String(iso || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace(/[^0-9A-Za-z_-]/g, '')
}

/** 某次备份的目录喵（`<backups>/<时间戳>/`）喵。 */
export function backupDirOf(project, stampIso) {
  return joinUnderRoot(backupRoot(project), backupStamp(stampIso))
}

/**
 * 备份落点 = `<backups>/<时间戳>/<相对项目根的路径>`喵。
 * 项目根**之外**的路径（理论上不该有）退化成 `_external/<文件名>`，绝不拼出 `..` 喵。
 */
export function backupPathOf(project, path, stampIso) {
  const rel = relative(project.root, path).replace(/\\/g, '/')
  const safe = !rel || rel.startsWith('..') ? `_external/${basename(path)}` : rel
  return joinUnderRoot(backupDirOf(project, stampIso), safe)
}

/** 文本指纹（sha256 前 12 位）喵：dryRun 里给人工核对旧内容用喵。 */
export function fingerprintText(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 12)
}

/** 统一的错误文案提取喵。 */
function messageOf(error) {
  return String(error && error.message ? error.message : error)
}

/**
 * 只**看**不写：这次写入是「新建」还是「覆盖」喵（覆盖要带上旧指纹）喵。
 * dryRun 的「将新建 / 将覆盖」两类明细就靠它算喵。
 */
export async function planWrite({ project, path }) {
  if (!path || !existsSync(path)) return { path, action: 'create' }
  try {
    const text = await readFile(path, 'utf8')
    return { path, action: 'overwrite', fingerprint: fingerprintText(text) }
  } catch (error) {
    // 读不动（权限/编码）也按「覆盖」记：写入前还会再试一次备份，失败即中止喵
    return { path, action: 'overwrite', fingerprint: null, error: messageOf(error) }
  }
}

/**
 * 备份 + 落盘喵（所有**覆盖既有文件**的写入都必须走这里）喵。
 *
 * @returns `{ ok, action, path, backupPath, fingerprint, error? }`：
 * `ok:false` = **没有写**（备份失败），调用方必须把它记成 warning / 失败项并继续处理其它文件喵。
 */
/**
 * 把文本拆成 `{ content, eol }` 行喵（`eol` ∈ `\r\n` / `\n` / `\r` / `''`）喵。
 */
export function splitLinesWithEol(text) {
  const source = String(text ?? '')
  const rows = []
  let index = 0
  while (index < source.length) {
    let end = index
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1
    const content = source.slice(index, end)
    let eol = ''
    if (source[end] === '\r' && source[end + 1] === '\n') { eol = '\r\n'; end += 2 }
    else if (source[end] === '\r') { eol = '\r'; end += 1 }
    else if (source[end] === '\n') { eol = '\n'; end += 1 }
    rows.push({ content, eol })
    index = end
  }
  return rows
}

/**
 * **行尾保持**喵（FIX-80）喵 —— 读改写既有文件时，**原文是什么行尾，写出去就是什么行尾**喵。
 *
 * 真机实证（回滚之后）喵：内容已完全回到 git 基线，但**行尾被整篇改写**（LF → CRLF）⇒
 * `git status` 报 397 处 M、`--stat` 报 16714 插入 / 16714 删除，而 `--ignore-cr-at-eol` 显示改动 0 ⇒
 * **假差异淹没了真实改动**，"与开工前 git 基线对账"这条验收直接失效 ✗。
 *
 * 规则（对应用户口径）喵：
 * ① 原文行尾**统一**（全 LF / 全 CRLF）⇒ 用那一种；
 * ② 原文**混用** ⇒ **逐行保持** —— 内容在原文里出现过的行用它原来那个行尾，新行/改过的行用**多数派**；
 * ③ 新建文件 ⇒ 用 `fallback`（默认 LF；仓库另有约定时可配）喵。
 */
export function alignEol(next, original, fallback = '\n') {
  const text = String(next ?? '')
  if (original === null || original === undefined || original === '') {
    return fallback === '\n' ? text.replace(/\r\n?/g, '\n') : text.replace(/\r?\n/g, '\r\n')
  }
  const rows = splitLinesWithEol(original)
  const byContent = new Map()
  const counts = new Map()
  for (const row of rows) {
    if (!row.eol) continue
    counts.set(row.eol, (counts.get(row.eol) || 0) + 1)
    if (!byContent.has(row.content)) byContent.set(row.content, row.eol)
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const preferred = dominant ? dominant[0] : fallback
  const nextRows = splitLinesWithEol(text)
  // 末行的**有无终止符**也跟原文走（原文以换行结尾、新文本没有 ⇒ 补回一个；反之不补）喵
  const originalEndsWithEol = /[\r\n]$/.test(String(original))
  return nextRows
    .map((row, index) => {
      const isLast = index === nextRows.length - 1
      if (isLast && !row.eol) {
        return originalEndsWithEol ? row.content + (byContent.get(row.content) || preferred) : row.content
      }
      return row.content + (byContent.get(row.content) || preferred)
    })
    .join('')
}

/** 取一段文本的**行尾风格**（给验收报告判"仅行尾变化"用）喵。 */
export function eolStyleOf(text) {
  const counts = new Map()
  for (const row of splitLinesWithEol(text)) {
    if (!row.eol) continue
    counts.set(row.eol, (counts.get(row.eol) || 0) + 1)
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!rows.length) return 'none'
  if (rows.length === 1) return rows[0][0] === '\r\n' ? 'crlf' : 'lf'
  return `mixed(${rows.map(([eol, n]) => `${eol === '\r\n' ? 'crlf' : 'lf'}:${n}`).join('/')})`
}

/** 新建文件的行尾（配置项 → 实际分隔符）喵。 */
export function newFileEolOf(project) {
  const style = String((project && project.newFileEol) || 'lf').toLowerCase()
  return style === 'crlf' ? '\r\n' : '\n'
}

/**
 * 覆盖既有文件前先备份喵（FIX-22 / §9-26）喵；**并保持原文件行尾**（FIX-80）喵。
 *
 * 目标不存在 ⇒ 跳过备份（不留无谓副本），行尾用"新文件行尾"（默认 LF）喵。
 * 备份失败 ⇒ 返回 `ok:false` 且**不写**（调用方据此中止本次覆盖）喵。
 */
export async function writeWithBackup({ project, path, text, stampIso, alignEolImpl = alignEol }) {
  const plan = await planWrite({ project, path })
  let backupPath = null
  let original = null
  if (plan.action === 'overwrite') {
    try {
      original = await readFile(path, 'utf8')
    } catch {
      original = null
    }
    try {
      backupPath = backupPathOf(project, path, stampIso)
      await mkdir(dirname(backupPath), { recursive: true })
      await copyFile(path, backupPath)
    } catch (error) {
      return {
        ok: false, action: 'overwrite', path, backupPath, fingerprint: plan.fingerprint, error: messageOf(error),
      }
    }
  }
  // FIX-80：**正文的行尾跟着原文走**（新文件用配置的行尾）——不许整篇归一化喵
  const body = alignEolImpl(String(text ?? ''), original, newFileEolOf(project))
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body, 'utf8')
  } catch (error) {
    return {
      ok: false, action: plan.action, path, backupPath, fingerprint: plan.fingerprint, error: messageOf(error),
    }
  }
  return {
    ok: true, action: plan.action, path, backupPath, fingerprint: plan.fingerprint,
  }
}

/**
 * `+N/-M` 标签喵（FIX-33）喵：行数差**算得出就写**，算不出（如 changelog 追加，条数取决于本轮动作）
 * 就如实说"取决于本轮动作"—— 不许瞎填 `+0/-0` 充数喵。
 */
function diffLabel(row) {
  if (!row || typeof row !== 'object') return ''
  if (typeof row.added === 'number' && typeof row.removed === 'number') return `，+${row.added}/-${row.removed}`
  return row.reason ? '，行数差取决于本轮动作' : ''
}

/**
 * 把 `writeWithBackup()` 的结果压成**JSON 安全**的字段喵（FIX-34）喵。
 *
 * 为什么必须有这一层：dsh 会校验工具回执是 **lossless JSON** —— 对象里只要有一个 `undefined`，
 * 整个 `librarian_sweep` 的回执就会被判 `value is not lossless JSON` 而**根本回不去**
 * （写盘明明成功了，调用方却拿不到任何结果）喵。所以成功路径统一给 `null`，失败路径给**字符串**喵。
 */
export function writeOutcome(written) {
  const row = written || {}
  return {
    ok: Boolean(row.ok),
    action: row.action || null,
    backupPath: row.backupPath || null,
    fingerprint: row.fingerprint || null,
    error: row.error ? String(row.error) : null,
  }
}

/**
 * 把三类写入明细渲染成人话喵（dryRun 用）喵。
 * 顺序固定：**将改名 → 将覆盖 → 将新建**（改名最"伤"引用，先给人看）喵。
 * FIX-33：每条都带 `+N/-M`，`-M > 0` 时**把被删的行原样列出来**（这正是当初丢掉 34 行人工索引的地方）喵。
 */
export function renderWritePlan(plan) {
  const lines = []
  for (const move of (plan && plan.rename) || []) lines.push(`将改名：${move.from} → ${move.to}`)
  for (const row of (plan && plan.overwrite) || []) {
    lines.push(`将覆盖：${row.path}（旧指纹 ${row.fingerprint || '(读不到)'}${diffLabel(row)}）${row.reason ? `　[${row.reason}]` : ''}`)
    const removed = row.removedLines || []
    for (const text of removed.slice(0, 10)) lines.push(`    被删：${text}`)
    if (removed.length > 10) lines.push(`    被删：…（其余 ${removed.length - 10} 行，旧版见备份）`)
  }
  for (const row of (plan && plan.create) || []) {
    const path = typeof row === 'string' ? row : row.path
    lines.push(`将新建：${path}${diffLabel(row)}`)
  }
  return lines.length ? lines : ['（本轮无写入动作）']
}

/** 紧凑摘要喵：给回执用 `${将覆盖 N / 将新建 M / 将改名 K}`喵。 */
export function planSummary(plan) {
  const overwrite = ((plan && plan.overwrite) || []).length
  const create = ((plan && plan.create) || []).length
  const rename = ((plan && plan.rename) || []).length
  return `将覆盖 ${overwrite} / 将新建 ${create} / 将改名 ${rename}`
}
