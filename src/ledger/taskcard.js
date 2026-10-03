/**
 * **任务文件 = 子代理的作业登记卡**喵（FIX-64 + FIX-68）喵。
 *
 * 口径（用户两次纠正后定稿，读真机 55 张卡得出）喵：任务文件**不是需求单**，而是
 * **子代理写自己那份作业登记卡**：谁派我来的、我占了哪些文件、现在什么状态、产出在哪、有没有异常。
 * "要什么"来自契约里的**上级补充指令**（口述原样透传），不由人预先写卡喵。
 *
 * 字段覆盖率（55 张卡实测）喵：`占用文件/资源` 50 · `状态` 48 · `阶段产出` 48 · `上级` 47 · `异常` 47 ·
 * `结论摘要` 3 · `风险` 2 · `禁止改动` 3 ⇒ 必备取前五个（覆盖率高且都是"别人也需要的登记信息"）喵。
 *
 * 两条用途喵：
 * ① **交付时校验**（不是派单时）：卡缺必备字段 → 给一句轻量提示（进审计观察项，不刷噪音）喵
 * ② **占用冲突审计**（FIX-68）：把 `占用文件/资源` 解析成机读数据，两个**活跃**任务都声明写同一路径 ⇒ 报喵
 */
import { readFile } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isAbsolutePath, joinUnderRoot } from '../project.js'

/** 必备字段（其余是推荐字段）喵。 */
export const TASK_CARD_REQUIRED = ['上级', '占用文件或资源', '状态', '阶段产出', '异常']

/** 推荐字段喵。 */
export const TASK_CARD_OPTIONAL = ['占用时间', '结论摘要', '风险']

/** 面向**子代理**的字段规范（会进契约的能力段，子代理照着写自己的卡）喵。 */
export const TASK_CARD_SPEC_MARK = '任务文件（作业登记卡）字段规范'
export const TASK_CARD_SPEC = [
  `${TASK_CARD_SPEC_MARK}：`,
  '- 任务文件**由你（子代理）自己写与维护**，它是你的**作业登记卡**，不是别人给你的需求单；',
  `- 必备：${TASK_CARD_REQUIRED.join(' / ')}；推荐：${TASK_CARD_OPTIONAL.join(' / ')}；`,
  '- `占用文件或资源` 要**逐条**标注模式：`写(新文件)` / `只读` / `禁止改动` —— 并发任务靠它避让；',
  '- 状态用「进行中 / 完成 / 阻塞」；异常没有就写「无」（空着会被当成漏填）喵。',
].join('\n')

/** 可直接抄的模板喵（`<...>` 是占位）喵。 */
export const TASK_CARD_TEMPLATE = [
  '# T<任务号> <标题>',
  '- 上级: <派你来的那个 Agent 的名字>',
  '- 占用时间: <YYYY-MM-DD>',
  '- 占用文件或资源:',
  '  - <绝对路径或相对项目根的路径> — 写(新文件)',
  '  - <路径> — 只读',
  '  - <路径> — 禁止改动',
  '- 状态: <进行中 / 完成 / 阻塞>',
  '- 阶段产出: <产出档绝对路径>',
  '- 结论摘要: <一两句>',
  '- 风险: <一两句>',
  '- 异常: <没有就写「无」>',
  '',
].join('\n')

/** 占用模式词表（写法宽容：中英文、带不带括号都吃）喵。 */
export const OCCUPANCY_MODES = [
  { mode: 'forbidden', words: ['禁止改动', '禁止修改', '禁止', 'forbidden', 'readonly-forbidden'] },
  { mode: 'newFile', words: ['写(新文件)', '写（新文件）', '新文件', '新建', 'newfile', 'new'] },
  { mode: 'write', words: ['写', 'write', '可写', '修改'] },
  { mode: 'read', words: ['只读', 'read', '查看'] },
]

/** 一条占用声明该归哪种模式（判不出按 `read`——最保守，不会误报"写写冲突"）喵。 */
export function modeOf(text) {
  const raw = String(text ?? '').toLowerCase()
  for (const row of OCCUPANCY_MODES) {
    if (row.words.some((word) => raw.includes(word.toLowerCase()))) return row.mode
  }
  return 'read'
}

/** 活跃状态判定：`完成 / 已释放 / 阻塞?` 之外都算活跃（阻塞仍占着文件，仍参与冲突判定）喵。 */
export function isActiveStatus(status) {
  const raw = String(status ?? '').trim().toLowerCase()
  if (!raw) return true // 没写状态 ⇒ 当成可能在跑（宁可多报一次，也别漏报真冲突）喵
  return !['完成', '已完成', '已释放', '已结束', '已退役', 'done', 'completed', 'released', 'retired', 'closed'].includes(raw)
}

/**
 * 解析一张作业登记卡喵（**纯文本解析**，不读盘，便于断言）喵。
 * @returns `{ fields, missing, occupancies }`：`occupancies` = `[{ path, mode, raw }]` 喵。
 */
export function parseTaskCard(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const fields = {}
  const occupancies = []
  const known = [...TASK_CARD_REQUIRED, ...TASK_CARD_OPTIONAL]
  let current = null
  for (const line of lines) {
    const stripped = line.trim()
    const bullet = /^[-*]\s+(.+)$/.exec(stripped)
    const body = bullet ? bullet[1].trim() : stripped
    const top = /^\*{0,2}([^:：*]{1,24})\*{0,2}\s*[:：]\s*(.*)$/.exec(body)
    const fieldName = top ? top[1].trim() : null
    const isField = Boolean(top) && (known.includes(fieldName) || !bullet)
    if (isField) {
      current = fieldName
      const value = top[2].trim()
      if (value) fields[fieldName] = value
      else if (!(fieldName in fields)) fields[fieldName] = ''
      continue
    }
    // 占用段里的子条目：`- <路径> — <模式>`（**Windows 路径自带冒号**，所以必须排在字段判定之后，
    // 且只有在"已知字段名"之外才当占用条目 —— 否则 `D:\P\a.md` 会被误当成"字段 D"）喵
    if (bullet && current === '占用文件或资源') {
      const raw = bullet[1].trim()
      const [pathPart, modePart] = splitOccupancy(raw)
      if (pathPart) occupancies.push({ path: pathPart, mode: modeOf(modePart), raw })
    }
  }
  const missing = TASK_CARD_REQUIRED.filter((name) => !String(fields[name] ?? '').trim()
    && !(name === '占用文件或资源' && occupancies.length))
  return { fields, missing, occupancies }
}

/**
 * 把 `路径 — 模式` 拆开喵。
 *
 * 分隔符**只认两侧带空白的**顿号类（`—` / `–` / `-` / `|`）——**绝不按 `:` 拆**：
 * Windows 路径自带冒号（`D:\P\a.md`），按冒号拆会把路径劈成两半（这是实测踩到的坑）喵。
 */
function splitOccupancy(raw) {
  const text = String(raw ?? '').trim().replace(/^[`"']|[`"']$/g, '')
  const parts = text.split(/\s+(?:—|–|-{1,2}|\|)\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return [text, '']
  return [parts[0], parts.slice(1).join(' ')]
}

/** 把占用路径归一化成绝对路径（相对路径按项目根拼）喵。 */
export function normalizeOccupancyPath(project, path) {
  const raw = String(path ?? '').trim().replace(/^[`"']|[`"']$/g, '')
  if (!raw) return ''
  const abs = isAbsolutePath(raw) ? raw : joinUnderRoot((project && project.root) || '', raw)
  return abs.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 读一张任务卡并按作业登记卡规则校验喵（交付时用）喵。
 * @returns `{ exists, missing, hint }`：`hint` 为空 = 没问题（不刷噪音）喵。
 */
export async function checkTaskCardFile({ project, taskId, read = readFile } = {}) {
  const id = String(taskId || '').trim()
  if (!id) return { exists: false, missing: [], hint: null }
  const path = joinUnderRoot(project.tasksDir, `${id}.md`)
  let text = null
  try {
    text = await read(path, 'utf8')
  } catch {
    return { exists: false, missing: TASK_CARD_REQUIRED.slice(), hint: `任务文件（作业登记卡）还没建：${path} —— 按 ${TASK_CARD_SPEC_MARK} 补齐（派单时不必存在，交付时应齐）喵` }
  }
  const parsed = parseTaskCard(text)
  if (!parsed.missing.length) return { exists: true, path, missing: [], hint: null }
  return {
    exists: true,
    path,
    missing: parsed.missing,
    hint: `任务文件（作业登记卡）缺必备字段：${parsed.missing.join(' / ')}（${path}）—— 补齐后审计不再提示喵`,
  }
}

/**
 * FIX-68：并发占用冲突判定喵（纯函数，输入是已解析的卡片清单）喵。
 *
 * @param args.cards - `[{ taskId, status, occupancies }]`（occupancies 的路径已归一化为绝对）喵。
 * @returns `[{ level, path, a, b, modeA, modeB, detail }]`：写写冲突 `red`，其余 `yellow` 喵。
 */
export function occupancyConflicts(cards = []) {
  const active = (cards || []).filter((card) => card && isActiveStatus(card.status))
  const rows = []
  const seen = new Set()
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i]
      const right = active[j]
      if (!left.taskId || !right.taskId || left.taskId === right.taskId) continue
      for (const one of left.occupancies || []) {
        for (const other of right.occupancies || []) {
          if (!one.path || one.path !== other.path) continue
          const bothWrite = (one.mode === 'write' || one.mode === 'newFile') && (other.mode === 'write' || other.mode === 'newFile')
          const writeVsRead = (one.mode === 'write' || one.mode === 'newFile') && other.mode === 'read'
            || (other.mode === 'write' || other.mode === 'newFile') && one.mode === 'read'
          const hitsForbidden = (one.mode === 'forbidden' && (other.mode === 'write' || other.mode === 'newFile'))
            || (other.mode === 'forbidden' && (one.mode === 'write' || one.mode === 'newFile'))
          if (!bothWrite && !writeVsRead && !hitsForbidden) continue
          const key = `${left.taskId}|${right.taskId}|${one.path}`
          if (seen.has(key)) continue
          seen.add(key)
          const level = bothWrite ? 'red' : 'yellow'
          const kind = bothWrite ? '写写冲突' : (hitsForbidden ? '写了声明为「禁止改动」的路径' : '一写一读（可能读到半成品）')
          rows.push({
            level,
            path: one.path,
            a: left.taskId,
            b: right.taskId,
            modeA: one.mode,
            modeB: other.mode,
            detail: `${kind}：${left.taskId}(${one.mode}) 与 ${right.taskId}(${other.mode}) 都涉足 ${one.path}`
              + ` —— 建议串行或改分工喵`,
          })
        }
      }
    }
  }
  /** 判定完成，返回结果喵。 */
  return rows
}

/** 把一份作业登记卡写到任务目录（子代理自用；只新建，不覆盖已存在的卡）喵。 */
export async function writeTaskCard({ project, taskId, text, overwrite = false } = {}) {
  const id = String(taskId || '').trim()
  if (!id) throw new Error('agent-contract: 写作业登记卡需要 taskId')
  const path = joinUnderRoot(project.tasksDir, `${id}.md`)
  await mkdir(dirname(path), { recursive: true })
  try {
    if (!overwrite) {
      await readFile(path, 'utf8')
      return { path, wrote: false, reason: '任务文件已存在（只新建、不覆盖；要改动请用 write 工具或显式 overwrite）' }
    }
  } catch {
    /* 不存在 ⇒ 新建喵 */
  }
  await writeFile(path, String(text ?? TASK_CARD_TEMPLATE), 'utf8')
  return { path, wrote: true }
}
