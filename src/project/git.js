/**
 * git 能力喵（FIX-62 只提示 / FIX-67 可选提交）喵。
 *
 * **口径（用户 2026-10-03 拍板）**喵：**只读探测允许，写命令默认禁止**喵。
 * - 只读：`rev-parse --is-inside-work-tree` / `status --porcelain`（用来数"未提交改动 N"）——
 *   FIX-62 要报具体数字就必须读，所以这两条是允许的喵。
 * - 写：`add` / `commit` / `tag` **只在 `git.autoCommit` 打开时**执行（默认关），
 *   且只 `add -- <本次动到的路径>`（**绝不 `git add -A`**）；**永不 push**（推远端要用户授权）喵。
 * - 任何一步失败都**明示原因、不阻断治理动作本身**（治理该干的活照干）喵。
 *
 * 执行器可注入（`run`）——套件用假 git 就能把护栏逐条断言出来，不必真跑 git 喵。
 */
import { execFile } from 'node:child_process'
import { joinUnderRoot } from '../project.js'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 默认执行器：`git <args>`（cwd 由调用方给；不经过 shell，避免引号/通配符被解释）喵。 */
export async function runGit(args, { cwd, timeout = 15_000 } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  })
  return String(stdout)
}

/** 路径归一化（比较"是不是同一条路径"用；大小写不敏感、斜杠统一）喵。 */
export function normalizeGitPath(path) {
  return String(path ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 读工作区状态喵（**只读**，可安全调用）喵。
 * @returns `{ repo, dirty, files }`：`repo:false` = 不是 git 仓库（此时不提示、不提交）喵。
 */
export async function gitStatus({ root, run = runGit } = {}) {
  if (!root) return { repo: false, dirty: 0, files: [] }
  try {
    await run(['rev-parse', '--is-inside-work-tree'], { cwd: root })
  } catch {
    return { repo: false, dirty: 0, files: [] }
  }
  try {
    const out = await run(['status', '--porcelain'], { cwd: root })
    const files = String(out).split('\n').map((line) => line.trimEnd()).filter(Boolean).map((line) => {
      const body = line.slice(3).trim()
      // 重命名行是 `R  old -> new`，取新路径喵
      const arrow = body.lastIndexOf(' -> ')
      return arrow >= 0 ? body.slice(arrow + 4) : body
    })
    return { repo: true, dirty: files.length, files }
  } catch (error) {
    return { repo: false, dirty: 0, files: [], error: String(error && error.message ? error.message : error) }
  }
}

/**
 * FIX-62 的提示句喵：**只提示、绝不自动提交**；非仓库 / 工作区干净 ⇒ 返回 null（不刷噪音）喵。
 */
export function baselineHint(status) {
  if (!status || !status.repo || !status.dirty) return null
  return `建议先提交一次基线：当前有 ${status.dirty} 个未提交改动（\`git status --short\`）`
}

/**
 * 本次动作会不会动文件喵（决定要不要挂 git 基线提示）喵。
 * 判据是**角色的工具白名单**（会写盘的那些）：`write` / `edit` / `doc_emit` / `bugfix_note` / `librarian_*` 喵。
 */
export function touchesFiles(tools) {
  const list = Array.isArray(tools) ? tools : []
  return list.some((name) => ['write', 'edit', 'doc_emit', 'bugfix_note'].includes(name) || String(name).startsWith('librarian_'))
}

/**
 * FIX-67：**可选的**自动提交喵（默认关；调用方先看 `config.git.autoCommit`）喵。
 *
 * 护栏（缺一不可）喵：
 * ① 只 `add -- <本次动到的路径>`（绝不 `-A`）；② 提交前若工作区有**范围外改动** ⇒ **中止**并提示；
 * ③ 提交信息含任务号 + 动作摘要 + 备份目录（可追溯）；④ 可选 `autoTag` 打锚点 tag；⑤ **永不 push**；
 * ⑥ 失败明示、不阻断；⑦ 一次治理 = 最多一次提交（调用方保证只调一次）喵。
 */
export async function autoCommit({
  root, paths = [], taskId = '', summary = '', backupRel = '', autoTag = false, run = runGit,
} = {}) {
  const targets = [...new Set((paths || []).map(String).filter(Boolean))]
  if (!root) return { ok: false, skipped: true, reason: '拿不到项目根，跳过自动提交' }
  if (!targets.length) return { ok: false, skipped: true, reason: '本次没有动到任何路径，无需提交' }
  const status = await gitStatus({ root, run })
  if (!status.repo) return { ok: false, skipped: true, reason: '不是 git 仓库，跳过自动提交（治理动作本身不受影响）' }
  // ② 范围外改动 ⇒ 中止（绝不把用户的 WIP 一起提交）喵
  // ⚠ `status --porcelain` 给的是**仓库相对路径**，而动作清单是**绝对路径** ⇒ 比对前必须先拼回绝对路径，
  // 否则每一个改动都会被当成"范围外"（护栏变成永远中止）✗ 喵
  const inside = new Set(targets.map(normalizeGitPath))
  const outside = status.files.filter((file) => !inside.has(normalizeGitPath(joinUnderRoot(root, file))))
  if (outside.length) {
    return {
      ok: false,
      skipped: true,
      outside,
      reason: `工作区有本次范围之外的改动 ${outside.length} 处，已跳过自动提交（避免把你的 WIP 一起提交）：`
        + outside.slice(0, 10).join('、'),
    }
  }
  const message = `[agent-contract] ${taskId || '(无任务号)'}：${summary || '一轮治理'}`
    + `，备份见 ${backupRel || '.agent-contract/backups/'}`
  let tag = null
  try {
    if (autoTag) {
      tag = `agent-contract/${taskId || 'untagged'}-before`
      try {
        await run(['tag', tag], { cwd: root })
      } catch (error) {
        // tag 撞名/失败不该挡住提交：记下来，提交照走喵
        tag = { failed: String(error && error.message ? error.message : error) }
      }
    }
    await run(['add', '--', ...targets], { cwd: root })
    const out = await run(['commit', '-m', message], { cwd: root })
    return { ok: true, skipped: false, message, files: targets.length, tag, out: String(out).slice(0, 400) }
  } catch (error) {
    return { ok: false, skipped: false, reason: `git 提交失败（已跳过，治理动作不受影响）：${error && error.message ? error.message : error}` }
  }
}

/**
 * FIX-62：算一次基线提示（**不记忆**，调用方决定要不要去重）喵。
 * @returns 提示句或 null（非仓库 / 干净 / 读不到）喵。**只读**，不执行任何写类 git 命令喵。
 */
export async function baselineHintFor({ project, run = runGit } = {}) {
  const root = project && project.root
  if (!root) return null
  return baselineHint(await gitStatus({ root, run }))
}

/**
 * FIX-62：**每个项目只提示一次**的版本喵（写动作可能被高频调用，别刷噪音）喵。
 * 只有**真提示过**才记住 —— 干净工作区这次不提，下次脏了仍会提喵。
 */
const baselineHinted = new Set()

export async function maybeBaselineHint({ project, run = runGit } = {}) {
  const root = String((project && project.root) || '')
  if (!root || baselineHinted.has(root)) return null
  const hint = await baselineHintFor({ project, run })
  if (hint) baselineHinted.add(root)
  return hint
}

/** 清空"已提示过"的记忆（套件用；真机不需要）喵。 */
export function resetBaselineHints() {
  baselineHinted.clear()
}

/** 把自动提交的结果压成一行回执文案喵（成功/跳过/失败都说清，**不静默**）喵。 */
export function autoCommitLine(result) {
  if (!result) return null
  if (result.ok) return `自动提交：已提交 ${result.files} 个路径（${result.tag && typeof result.tag === 'string' ? `已打锚点 tag ${result.tag}，` : ''}未 push）`
  return `自动提交：已跳过 —— ${result.reason}`
}
