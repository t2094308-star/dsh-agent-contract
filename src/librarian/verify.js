/**
 * **治理动作的验收报告**喵（FIX-66）喵。
 *
 * 用户批评喵：「这些约束应该是插件提供的」—— 任务单里写着"正文零改动（逐篇 sha 一致）""引用无失效"
 * "审计红黄数 ≤ 基线""报告格式：移动 X / 改名 Y / 更新引用 Z / 待人工裁定 N"，可这些数据**插件全都有**，
 * 却让人去手工核 —— 正是"该自动化的没自动化"喵。
 *
 * 所以：一轮治理**结束时自动产出**这份报告，五件事都要有喵：
 * ① 动作清单（移动 / 改名 / 引用 / 归档 / 待裁定，每条带路径与原因）
 * ② **正文零改动证明**（逐篇 前指纹 → 后指纹；不一致的单独列出）
 * ③ 引用完整性（改名/移位的目标，全库是否还有旧路径残留）
 * ④ 审计前后对比（红/黄计数 + 条目 diff）
 * ⑤ `dryRun` 给**预演版**（"将移动 / 将改名 / 将删除引用"）
 *
 * 指纹取的是**正文**（front-matter 之后的部分）—— 治理本来就会改头部（补字段、盖留痕章），
 * 拿整文件指纹去证"正文零改动"会永远不等，那就成了一句空话喵。
 */
import { parseFrontMatter } from '../ledger/docmeta.js'
import { readFileIfPresent } from '../ledger/fs.js'
// FIX-80 ③：判"仅行尾变化"用喵
import { eolStyleOf } from './backup.js'

/** 逐篇正文指纹：`path → 指纹`（读不到记 null，**绝不抛**）喵。 */
export async function snapshotBodies({ store, read = readFileIfPresent } = {}) {
  const map = new Map()
  for (const doc of store.listDocs()) {
    if (!doc || !doc.path) continue
    const found = await read(doc.path)
    const text = found && typeof found.text === 'string' ? found.text : null
    if (text === null) {
      map.set(doc.path, null)
      continue
    }
    // FIX-80 ③：除了正文指纹，再记一份**行尾风格** —— 用来判"内容没变但行尾被改写"（会污染 git 基线对账）喵
    const body = parseFrontMatter(text).body
    map.set(doc.path, { fingerprint: fingerprint(body), eol: eolStyleOf(body) })
  }
  return map
}

/** FNV-1a 32 位（与待办指纹同款算法：够用、纯算术、两边实现一致）喵。 */
export function fingerprint(text) {
  const source = String(text ?? '')
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 正文零改动证明喵：逐篇给"前 → 后"，`same=false` 的**单独列出**（这就是"证明"，不是口号）喵。
 * @returns `{ rows, changed }`：`rows` 覆盖"动过的 + 前后都在的"全部；`changed` = 正文真变了的喵。
 */
export function diffBodies(before, after, touched = []) {
  // FIX-80 ③：每行带 `eolChanged`（内容一致但**行尾被改写** ⇒ 单独列出，它会污染 git 基线对账）喵
  const paths = new Set([...(before ? before.keys() : []), ...(after ? after.keys() : []), ...(touched || [])])
  const rows = []
  for (const path of paths) {
    const fromRaw = before && before.has(path) ? before.get(path) : null
    const toRaw = after && after.has(path) ? after.get(path) : null
    const from = fromRaw && fromRaw.fingerprint ? fromRaw.fingerprint : fromRaw
    const to = toRaw && toRaw.fingerprint ? toRaw.fingerprint : toRaw
    if (from === null && to === null) continue
    const eolBefore = fromRaw && fromRaw.eol ? fromRaw.eol : null
    const eolAfter = toRaw && toRaw.eol ? toRaw.eol : null
    rows.push({ path, before: from, after: to, same: from === to, eolBefore, eolAfter, eolChanged: Boolean(eolBefore && eolAfter && eolBefore !== eolAfter) })
  }
  rows.sort((a, b) => String(a.path).localeCompare(String(b.path)))
  return { rows, changed: rows.filter((row) => !row.same) }
}

/**
 * 引用完整性喵：改名/移位后，全库是否还留着**旧路径**（有则列出来）喵。
 * @returns `[{ path, oldPath }]`（`path` = 还残留旧路径的那篇档）喵。
 */
export async function findReferenceLeftovers({ store, oldPaths = [], read = readFileIfPresent } = {}) {
  const targets = [...new Set((oldPaths || []).filter(Boolean).map((path) => String(path)))]
  if (!targets.length) return []
  const rows = []
  for (const doc of store.listDocs()) {
    const found = await read(doc.path)
    const text = found && typeof found.text === 'string' ? found.text : null
    if (text === null) continue
    for (const oldPath of targets) {
      // 别把自己算成残留（改名后新档自己不含旧路径，但旧档若还在就会命中）喵
      if (doc.path === oldPath) continue
      if (text.includes(oldPath)) rows.push({ path: doc.path, oldPath })
    }
  }
  return rows
}

/** 审计结果压成"计数 + 条目键"喵（条目键 = `check|target`，用于前后 diff）喵。 */
export function auditSummary(report) {
  const counts = (report && report.counts) || { red: 0, yellow: 0 }
  const items = ((report && report.items) || []).filter((item) => item.level === 'red' || item.level === 'yellow')
  return {
    level: (report && report.level) || 'green',
    red: counts.red || 0,
    yellow: counts.yellow || 0,
    keys: items.map((item) => `${item.check}|${item.target}`),
  }
}

/** 审计前后对比喵：计数 + 新增/消除的条目（治理"有没有变好"用数据说话）喵。 */
export function auditDiff({ before, after } = {}) {
  const a = before || { level: 'green', red: 0, yellow: 0, keys: [] }
  const b = after || { level: 'green', red: 0, yellow: 0, keys: [] }
  const beforeKeys = new Set(a.keys || [])
  const afterKeys = new Set(b.keys || [])
  return {
    before: { level: a.level, red: a.red, yellow: a.yellow },
    after: { level: b.level, red: b.red, yellow: b.yellow },
    added: (b.keys || []).filter((key) => !beforeKeys.has(key)),
    removed: (a.keys || []).filter((key) => !afterKeys.has(key)),
  }
}

/** 动作清单喵：把各步骤的结果拍平成"每条带路径与原因"的行喵。 */
export function collectActions({ relocate, refRepair, archiveMark, caretFix, archive, dedupe, naming, tags, core, pitfall, plan, dryRun = false } = {}) {
  const rows = []
  const verb = (done, todo) => (dryRun ? todo : done)
  // FIX-69：类型归位 / 去归档前缀 / 临时文件搬离（每条带路径与原因）喵
  // FIX-77：引用修复 / legacy 待归档标注 / `^` 表述订正 —— 三条都进动作清单（每条带路径与原因）喵
  for (const row of (refRepair && refRepair.fixed) || []) rows.push({ kind: verb('引用修复', '将修复引用'), path: row.path, reason: `${row.layer}：${row.ref} → ${row.newPath}（${row.reason}）` })
  for (const row of (refRepair && refRepair.pending) || []) rows.push({ kind: '待人工裁定', path: row.path, reason: `${row.layer}：${row.ref} —— ${row.reason}` })
  for (const row of (archiveMark && archiveMark.files) || []) rows.push({ kind: verb('标注', '将标注'), path: row.path, reason: 'legacy 档补「待归档」标注（archivePending: true，只动 front-matter）' })
  for (const row of (caretFix && caretFix.fixed) || []) rows.push({ kind: verb('订正', '将订正'), path: row.path, reason: `订正  的错误表述：${row.before} → ${row.after}` })
  for (const file of (relocate && relocate.files) || []) rows.push({ kind: verb('归位', '将归位'), path: file.newPath || file.oldPath, reason: `类型归位/去归档前缀：${file.oldPath} → ${file.newPath}` })
  for (const path of (relocate && relocate.patchOnly) || []) rows.push({ kind: verb('改元数据', '将改元数据'), path, reason: '归档语义移到元数据（archived: true），路径不变' })
  for (const item of (relocate && relocate.pending) || []) rows.push({ kind: '待人工裁定', path: item.path, reason: item.reason })
  for (const file of (archive && archive.files) || []) rows.push({ kind: verb('移动', '将移动'), path: file.to || file.from, reason: `归档：${file.from} → ${file.to}` })
  for (const file of (dedupe && dedupe.files) || []) rows.push({ kind: verb('移动', '将移动'), path: file.to || file.from, reason: `去重归档（重复档）：${file.from || ''}` })
  for (const move of (naming && naming.files) || []) rows.push({ kind: verb('改名', '将改名'), path: move.newPath || move.oldPath, reason: `命名规范化：${move.oldPath} → ${move.newPath}` })
  for (const item of (naming && naming.blocked) || []) rows.push({ kind: '待人工裁定', path: item.target, reason: `改名被拦下（会制造重复前置任务号）：期望 ${item.expected}` })
  if (naming && naming.titlesPending) rows.push({ kind: verb('改名', '将改名'), path: '(台账标题)', reason: `${naming.titlesPending} 篇台账标题待回写（按文件名重算）` })
  const refs = ((archive && archive.refsUpdated) || 0) + ((dedupe && dedupe.refsUpdated) || 0) + ((naming && naming.refsUpdated) || 0)
  if (refs) rows.push({ kind: verb('引用', '将更新引用'), path: '(多处)', reason: `更新引用 ${refs} 处` })
  for (const item of (tags && tags.files) || []) {
    rows.push({ kind: verb('盖章', '将盖章'), path: item.path, reason: item.added && item.added.length ? `关键词复核：新增 ${item.added.join('、')}` : '关键词复核：无需变更（仅盖章）' })
  }
  if (core && core.path) rows.push({ kind: verb('索引', '将写索引'), path: core.path, reason: `派生态索引（成员 ${core.members} / 任务 ${core.tasks} / 文档 ${core.docs}）` })
  if (pitfall && pitfall.path) rows.push({ kind: verb('索引', '将写索引'), path: pitfall.path, reason: `坑库索引（${pitfall.entries} 条）` })
  for (const row of (plan && plan.overwrite) || []) rows.push({ kind: verb('覆盖', '将覆盖'), path: row.path, reason: `覆盖既有档（旧指纹 ${row.fingerprint || '(未知)'}）` })
  for (const row of (plan && plan.create) || []) rows.push({ kind: verb('新建', '将新建'), path: row.path, reason: '新建派生态' })
  for (const row of (plan && plan.rename) || []) rows.push({ kind: verb('改名', '将改名'), path: row.newPath || row.path, reason: `改名：${row.oldPath || ''} → ${row.newPath || ''}` })
  return rows
}

/** 待人工裁定条数（报告口径里的 M）喵。 */
export function pendingManualCount(rows) {
  return (rows || []).filter((row) => row.kind === '待人工裁定').length
}

/** 把验收报告渲染成人话（回执与文档同一份口径）喵。 */
export function renderVerification(v) {
  if (!v) return []
  const lines = []
  const counts = v.actions.reduce((acc, row) => {
    acc[row.kind] = (acc[row.kind] || 0) + 1
    return acc
  }, {})
  const summary = Object.entries(counts).map(([kind, n]) => `${kind} ${n} 篇`).join(' / ') || '无动作'
  lines.push(`验收报告${v.dryRun ? '（预演）' : ''}：${summary}；待人工裁定 ${pendingManualCount(v.actions)} 篇`)
  for (const row of v.actions.slice(0, 20)) lines.push(`- [${row.kind}] ${row.path}：${row.reason}`)
  if (v.actions.length > 20) lines.push(`- …（其余 ${v.actions.length - 20} 条略）`)
  // ② 正文零改动证明
  if (v.bodyUnchanged) {
    const changed = v.bodyUnchanged.changed || []
    lines.push('', `正文零改动：逐篇比对 ${v.bodyUnchanged.rows.length} 篇`
      + (changed.length ? `，**${changed.length} 篇指纹变了（要看）**：` : '，全部一致 ✓'))
    for (const row of changed) lines.push(`- ⚠ ${row.path}：${row.before} → ${row.after}`)
    // FIX-80 ③：**仅行尾变化**要单独列出（内容没变，但 git 会把每一行都算成"删一行 + 加一行"）喵
    const eolChanged = v.bodyUnchanged.rows.filter((row) => row.eolChanged)
    if (eolChanged.length) {
      lines.push(`- ⚠ 行尾被改写（非内容改动，但会污染 git 基线对账）${eolChanged.length} 篇：`)
      for (const row of eolChanged.slice(0, 10)) lines.push(`    ${row.path}：${row.eolBefore} → ${row.eolAfter}`)
    }
    for (const row of v.bodyUnchanged.rows.slice(0, 10)) {
      if (!row.same) continue
      lines.push(`- ${row.path}：${row.before} → ${row.after} ✓`)
    }
  }
  // FIX-77 ③：**用户授权的有意正文变更**（`^` 表述订正）单独列 —— 免得被当成"正文被偷偷改了"喵
  if (v.intendedChanges && v.intendedChanges.length) {
    lines.push('', `有意变更（用户授权，正文订正）${v.intendedChanges.length} 处：`)
    for (const row of v.intendedChanges.slice(0, 10)) lines.push(`- ${row.path}：${row.before} → ${row.after}`)
  }
  // ③ 引用残留
  if (v.referenceLeftovers) {
    lines.push('', v.referenceLeftovers.length
      ? `引用残留：${v.referenceLeftovers.length} 处仍指向旧路径：`
      : '引用完整性：全库已无旧路径残留 ✓')
    for (const row of v.referenceLeftovers.slice(0, 10)) lines.push(`- ${row.path} 仍含 ${row.oldPath}`)
  }
  // ④ 审计前后
  if (v.auditDiff) {
    const { before, after } = v.auditDiff
    lines.push('', `审计对比：红 ${before.red}→${after.red} / 黄 ${before.yellow}→${after.yellow}`
      + `（新增 ${v.auditDiff.added.length} 条、消除 ${v.auditDiff.removed.length} 条）`)
    for (const key of v.auditDiff.added.slice(0, 10)) lines.push(`- 新增 ${key}`)
    for (const key of v.auditDiff.removed.slice(0, 10)) lines.push(`- 消除 ${key}`)
  }
  return lines
}
