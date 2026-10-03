/**
 * `ledger_rebuild`：扫磁盘重建三表喵。
 *
 * 核心原则（DESIGN §5.5）：**磁盘文档才是真相，台账只是可从零重建的索引**。
 * 所以重建必须幂等：文件没了就删记录，文件新了就覆盖记录，重复跑结果一致喵。
 *
 * 元数据一律走**自动派生器**（`derive.js`，零模型调用）；派生不出来的落进
 * `needsLibrarian[]`，只有该清单非空才唤醒馆员喵。
 *
 * 边界（刻意为之）喵：
 * - `docs` / `tasks` 全量对齐磁盘（含删除陈旧记录）喵。
 * - `members` 只做**增量补齐**，**绝不删除**——活跃成员的 session id、状态、成本是磁盘上没有的运行时事实喵。
 * - **失败隔离**：单条写入失败只跳过并记录，绝不让整批 abort喵。
 */
import { joinUnderRoot } from '../project.js'
import { deriveFromFile, loadGlossary, markDuplicates } from './derive.js'
import { listMarkdown, readFileIfPresent, listMarkdownDeep } from './fs.js'
import { memberName, parseMemberName } from './naming.js'
import { docRecord, memberRecord, taskRecord } from './store.js'

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString())

/** 安全成员名（任务号或角色缺失时返回 null）喵。 */
function safeMemberName(taskId, role) {
  try {
    return memberName(taskId, role)
  } catch {
    return null
  }
}

/** 扫产出目录：全程机器派生，零模型调用喵。 */
async function scanDocs(project, glossary, warnings) {
  const records = []
  for (const name of await listMarkdownDeep(project.deliverablesDir)) {
    const path = joinUnderRoot(project.deliverablesDir, name)
    const file = await readFileIfPresent(path)
    if (!file) continue

    const { legacy, derived } = deriveFromFile({ fileName: name, text: file.text, mtime: file.mtime, glossary })

    records.push(docRecord({
      path,
      tier: derived.tier,
      owner: derived.taskId && derived.role ? safeMemberName(derived.taskId, derived.role) : null,
      taskId: derived.taskId,
      title: derived.title || name.replace(/\.md$/i, ''),
      chars: derived.chars,
      keywords: derived.keywords,
      relatedFiles: derived.relatedFiles,
      // legacy 与 tier 0（修复总结这类非三档文档）不参与 doc_meta_missing 喵
      missingSections: legacy || derived.tier === 0 ? [] : derived.missingSections,
      legacy,
      needsLibrarian: derived.needsLibrarian,
      updatedAt: derived.createdAt,
    }))
    if (legacy) warnings.push(`存量旧档（标 legacy，不计入 doc_meta_missing）：${path}`)
  }

  // 疑似重复档在这层判（要看全量才能判）喵
  markDuplicates(records)
  return records
}

/** 扫任务目录与进度目录，产出任务记录喵。 */
async function scanTasks(project, existing) {
  const rows = new Map()

  for (const name of await listMarkdown(project.tasksDir)) {
    const file = await readFileIfPresent(joinUnderRoot(project.tasksDir, name))
    rows.set(name.replace(/\.md$/i, ''), { taskId: name.replace(/\.md$/i, ''), updatedAt: iso(file ? file.mtime : undefined) })
  }

  // 有进度文件却没有任务文件的，也登记一条——否则这条任务在台账里就是隐形的喵
  for (const name of await listMarkdown(project.progressDir)) {
    const file = await readFileIfPresent(joinUnderRoot(project.progressDir, name))
    const taskId = name.replace(/\.md$/i, '')
    const previous = rows.get(taskId)
    if (previous) {
      const newer = file && file.mtime > Date.parse(previous.updatedAt) ? iso(file.mtime) : previous.updatedAt
      rows.set(taskId, { ...previous, updatedAt: newer })
    } else {
      rows.set(taskId, { taskId, updatedAt: iso(file ? file.mtime : undefined) })
    }
  }

  return [...rows.values()].map((row) => {
    const prior = existing.get(row.taskId)
    return prior
      ? { ...prior, updatedAt: row.updatedAt }
      : taskRecord({ taskId: row.taskId, status: 'open', updatedAt: row.updatedAt })
  })
}

/**
 * 重建台账喵。
 * @param args.store - `createStore()` 的结果喵。
 * @param args.project - `resolveProject()` 的结果喵。
 * @returns 重建摘要 `{ docs, tasks, members, needsLibrarian, writeFailures, warnings }`喵。
 */
export async function rebuildLedger({ store, project }) {
  const warnings = []
  const writeFailures = []
  const glossary = await loadGlossary(project)

  /** 失败隔离：单条写失败只记录，不中断整批喵。 */
  const tryWrite = async (target, action) => {
    try {
      await action()
      return true
    } catch (error) {
      writeFailures.push({ target, error: String(error && error.message ? error.message : error) })
      return false
    }
  }

  // ---- docs：全量对齐（含删除陈旧） ----
  const scanned = await scanDocs(project, glossary, warnings)
  const seen = new Set(scanned.map((doc) => doc.path))
  let docsRemoved = 0
  for (const doc of store.listDocs()) {
    if (seen.has(doc.path)) continue
    if (await tryWrite(doc.path, () => store.deleteDoc(doc.path))) docsRemoved += 1
  }
  for (const doc of scanned) await tryWrite(doc.path, () => store.putDoc(doc))

  // ---- tasks：全量对齐（含删除陈旧） ----
  const existingTasks = new Map(store.listTasks().map((task) => [task.taskId, task]))
  const tasks = await scanTasks(project, existingTasks)
  const taskIds = new Set(tasks.map((task) => task.taskId))
  let tasksRemoved = 0
  for (const task of store.listTasks()) {
    if (taskIds.has(task.taskId)) continue
    if (await tryWrite(task.taskId, () => store.deleteTask(task.taskId))) tasksRemoved += 1
  }
  for (const task of tasks) await tryWrite(task.taskId, () => store.putTask(task))

  // ---- members：只增量补齐，绝不删除（session id / 状态 / 成本是磁盘上没有的事实） ----
  const known = new Set(store.listMembers().map((member) => member.name))
  let membersAdded = 0
  for (const doc of scanned) {
    if (doc.legacy || !doc.owner) continue
    const parsedOwner = parseMemberName(doc.owner)
    if (!parsedOwner || known.has(doc.owner)) continue
    known.add(doc.owner)
    const ok = await tryWrite(doc.owner, () => store.putMember(memberRecord({
      name: doc.owner,
      role: parsedOwner.role,
      mode: 'unknown',
      layer: 0,
      status: 'unknown',
      derived: true,
      latestDeliverable: doc.path,
    })))
    if (ok) membersAdded += 1
  }

  const needsLibrarian = scanned.flatMap((doc) => doc.needsLibrarian.map((item) => ({
    path: doc.path,
    taskId: doc.taskId,
    code: item.code,
    detail: item.detail,
  })))

  return {
    docs: {
      scanned: scanned.length,
      removed: docsRemoved,
      legacy: scanned.filter((doc) => doc.legacy).length,
      withNeeds: scanned.filter((doc) => doc.needsLibrarian.length > 0).length,
    },
    tasks: { scanned: tasks.length, removed: tasksRemoved },
    members: { added: membersAdded, total: known.size },
    needsLibrarian,
    writeFailures,
    warnings,
  }
}
