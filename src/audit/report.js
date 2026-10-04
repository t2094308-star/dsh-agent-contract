/**
 * 审计报告喵（DESIGN §5.7 / M4 交付物 1）喵。
 *
 * **只报不拦**喵：`auditScan` 返回结果即可，不抛错、不改文件、不替馆员修喵。
 * 唯一的抛错点是**配置错误**（未知的 `audit.checks` 项）——那是"写错了却以为在查"，
 * 必须当场炸而不是静默忽略喵。
 */
import { CHECK_IDS, CHECK_IMPLEMENTATIONS, CHECK_LEVELS, LEDGER_MISMATCH_CHECKS, assertKnownChecks, collectContracts, collectObservations } from './checks.js'
// FIX-90：归档判定要**归一化 sessionId + 按父链上溯**（两处根因都在真机上炸过）喵
import { archivedOwners, archivedViaChain, normalizeArchivedSet } from './archived.js'

/**
 * 每项检查的**建议动作**（`humanReport` 的第三段，交给馆员执行）喵。
 *
 * **§9-32 硬口径**：建议要么指向一个**可执行**的机制（写明工具名/配置项），
 * 要么明写「需人工处理（当前无自动机制）」—— 实测教训是 `doc_tags_stale` 曾建议"由产出者或馆员更新头部"，
 * 而那两方当时都没有对应步骤，告警**天生无解**（FIX-25 已补 `librarian_tags`）喵。
 */
export const SUGGESTIONS = {
  missing_doc: '由主代理重新派 `contract_delegate_<角色>` 补档；若该任务确实无产出义务 → 需人工处理（当前无自动机制）',
  over_budget: '三级档用 `doc_emit` 重写压到 250~300 字；契约片段超预算属装配问题 → 需人工处理（当前无自动机制）',
  unfilled_slot: '需人工处理（当前无自动机制）：检查契约装配的槽位取值来源，补齐后重跑',
  stale_progress: '用 `progress_upsert` 重写该进度档（≤400 字，覆盖到当前进度）',
  cross_vendor: '给对抗审查配一个异源模型路由（`modelRoutes.adversary`）—— 改配置即可，无需改代码',
  ghost_run: '需人工处理（当前无自动机制）：确认该次 run 是否本应落档；若无需落档请在上层说明',
  orphan_task: '需人工处理（当前无自动机制）：结掉任务，或把成员状态从 released 回退',
  unreleased_run: '需人工处理（当前无自动机制）：补释放记录，或确认该成员是否仍需要常驻',
  doc_misfiled: '需人工处理（当前无自动迁移机制）：由图书管理员手工移到对应类目录（改名 + 更新引用 + 留痕）',
  doc_meta_missing: '`librarian_patrol` 补固定小节占位；缺 front-matter 用 `ledger_backfill --auto`（都会留痕）',
  doc_tags_stale: '用 `librarian_tags` 重算 keywords（只增不删，支持 dryRun/限量；无新词时仅盖章复核）',
  archive_suggest: '用 `librarian_archive` 按 archive/<分片>/ 归档（移动 + 更新引用 + 留痕）',
  task_file_missing: '跑一次 `ledger_rebuild` 重建台账（磁盘才是事实；**不要手删**这条记录 —— 删除不可逆），或把任务文件补回 任务/ 目录',
  bookkeeping_untraced: '需人工处理（当前无自动机制）：确认该馆员这次到底做了什么；真的没做事就该追问，做了事却没留痕要查写入路径',
  legacy_archive_pending: '用 `librarian_sweep` 一轮治理批量补标注（只动 front-matter、正文零改动）',
  doc_file_missing: '跑一次 `ledger_rebuild` 重建台账（同上：只报不删），或确认这篇档是不是被移动/重命名了',
  doc_kind_mismatch: '用 `librarian_sweep` 一轮治理按类型归位（只移动/改名、不改正文）；也可直接把文件名后缀改成与目录一致',
  stray_non_md: '用 `librarian_sweep` 一轮治理把非 .md 搬到临时目录（**只搬不删**）；写的时候也别再往类别目录里放',
  legacy_caret: '用 `librarian_sweep` 一轮治理去掉 `^` 前缀并在元数据写 `archived: true`（只改名、不改正文）',
  missing_progressive_link: '用 `doc_emit` 重发该档（会自动写指针），或让馆员跑一轮治理统一补',
  dirty_related_path: '需人工处理（当前无自动清洗机制）：把 relatedFiles 改成可解析的绝对路径（doc_emit 的 relatedFiles 参数）',
  // FIX-100 ①：绕过契约的派单 —— 两条路：走契约，或**先提权**（提权后标「已提权」、不再报黄）喵
  body_caret_title: '跑一轮治理（`librarian_sweep` 的存量清理会**只**去掉标题行开头的 `^`，该行其余一字不动；dryRun 先给"将改 N 处"）',
  null_frontmatter: '用 `librarian_sweep` 一轮治理清掉（收尾会自动清，dryRun 先给"将清 N 处"；**只删那段头，正文一字不动**，留痕仍在台账）',
  missing_kind_index: '跑一轮索引重建（让图书管理员跑 `librarian_indexes` 即可；机器区块由派生器生成，零模型调用）',
  uncontracted_dispatch: '后续请走契约派单（`contract_delegate_*`）；**确需绕过**（契约工具不可用 / 宿主限制）'
    + '就先调 `contract_request_escalation` 说明理由，再用普通派单 —— 提权后本项会标「已提权」且不计红黄',
  occupancy_conflict: '需人工处理（当前无自动机制）：建议**串行**这两个任务或改分工，'
    + '并把各自的作业登记卡「占用文件或资源」段改成实际模式（改完本条即消）',
}

/** 结果里每项的排序权重（红在前）喵。 */
const LEVEL_ORDER = { red: 0, yellow: 1 }

/**
 * 跑一次审计喵。
 *
 * @param args.store - 台账 store喵。
 * @param args.project - `resolveProject()` 结果喵。
 * @param args.config - 插件配置（读 `audit.checks` 与 `audit.archiveAfterDays`）喵。
 * @param args.now - 注入时钟（测试用）喵。
 * @returns `{ level, items, humanReport, counts, failedChecks }`喵。
 * @throws 未知的 `audit.checks` 项（配置错误，必须报错）喵。
 */
export async function auditScan({ store, project, config, now = Date.now(), archivedSessionIds = null, parentOf = null, sessions = null }) {
  // FIX-84：**用户归档掉的会话**（宿主侧状态）不该再被审计扫出来 —— 归档 = 明确说"这些不用管了"喵。
  // 拿不到归档信息（宿主没挂 workspaceRegistry）⇒ 传 null ⇒ 行为与今天一致（静默降级）喵
  const archived = normalizeArchivedSet(archivedSessionIds)
  const allMembers = store.listMembers()
  // FIX-90：**归一化 + 按父链上溯** —— 用户归档的常是**父会话**（顶层 session-<uuid>），而被扫的是子会话（裸 uuid）喵
  // FIX-101：改用共享的 `archivedOwners()`（名字集合 + 成员清单），下游还要用它滤**任务/文档**类的条目喵
  const archivedInfo = archivedOwners({ store, archivedSessionIds: archivedSessionIds, parentOf })
  const archivedMembers = archivedInfo.members
  const archivedNames = archivedInfo.names
  const enabled = assertKnownChecks(config)
  const items = []
  const failedChecks = []
  // FIX-101：被"源自归档对话"滤掉的条目（只留痕，不告警；报告里能说明白它们去哪了）喵
  const archivedFiltered = []

  let contracts = []
  const needsContracts = enabled.includes('over_budget') || enabled.includes('unfilled_slot')
  if (needsContracts) {
    try {
      contracts = await collectContracts({ store, project, config })
    } catch {
      contracts = []
    }
  }

  for (const id of enabled) {
    const run = CHECK_IMPLEMENTATIONS[id]
    try {
      const found = await run({ store, project, config, contracts, now, archivedSessionIds: archived, parentOf, sessions })
      for (const row of found) {
        // 检查项可以**逐条覆盖**严重度（FIX-68：写写冲突比"一写一读"更重 ⇒ 同一条检查里 red/yellow 并存）喵
        items.push({ check: id, level: row.level || CHECK_LEVELS[id] || 'yellow', target: row.target, detail: row.detail })
      }
    } catch (error) {
      // 单项检查自己炸了不该带塌整轮审计；记下来为准喵
      failedChecks.push({ check: id, error: String(error && error.message ? error.message : error) })
    }
  }

  // FIX-30：观察项（`level: 'info'`，仅记录不告警）——进 items 供面板/馆员看，
  // 但下面统计红黄时**刻意跳过**它们（观察项不该把"全绿"染成"有告警"）喵
  // FIX-64：观察项要读任务卡，所以把 `project` 一并传下去（读不到就整项跳过，绝不带塌审计）喵
  for (const item of await collectObservations({ store, project })) items.push(item)

  /**
   * FIX-101：**源自归档对话的条目一律不进清单**喵（真机："审计区还会引用源自归档的对话"）。
   *
   * 只按成员名过滤是不够的：`task_file_missing` / `doc_file_missing` / `orphan_task` 这类条目的 target 是
   * **任务号或路径**，而它们同样来自那些对话 ⇒ 得顺着 owner 回溯到成员，再看那个成员是不是已归档喵。
   * 判据（不改、不删、只过滤）：target 是成员名 / 是 taskId（用任务的 owner）/ 是文档路径（用文档的 owner）喵。
   */
  if (archivedNames.size) {
    const ownedByArchived = (target) => {
      const key = String(target || '')
      if (!key) return false
      if (archivedNames.has(key)) return true
      const task = store.getTask(key)
      if (task && task.owner && archivedNames.has(String(task.owner))) return true
      const doc = store.getDoc(key) || store.listDocs().find((row) => row.path === key)
      if (doc && doc.owner && archivedNames.has(String(doc.owner))) return true
      return false
    }
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (ownedByArchived(items[index].target)) {
        // 归类的留痕：面板 tooltip 与报告里能看到"哪些被归档滤掉了"，不是凭空消失喵
        archivedFiltered.push({ check: items[index].check, target: String(items[index].target) })
        items.splice(index, 1)
      }
    }
  }

  items.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || a.check.localeCompare(b.check))

  const counts = { red: 0, yellow: 0, byCheck: {} }
  for (const item of items) {
    if (item.level !== 'red' && item.level !== 'yellow') continue
    counts[item.level] = (counts[item.level] || 0) + 1
    counts.byCheck[item.check] = (counts.byCheck[item.check] || 0) + 1
  }
  const level = counts.red > 0 ? 'red' : (counts.yellow > 0 ? 'yellow' : 'green')

  return {
    level, items, counts, failedChecks, archivedFiltered,
    // FIX-84 ③：已归档会话**单列一段**（不计红黄）—— 让用户知道"这些我看过了"而不是凭空消失喵
    // FIX-90 ④：按**父会话**归并（用户对号入座："我归档的那个会话下面这些成员都不用管了"）喵
    archived: {
      count: archivedMembers.length,
      members: archivedMembers.map((row) => row.member.name),
      byParent: archivedMembers.reduce((acc, row) => {
        const key = String(row.via)
        acc[key] = acc[key] || []
        acc[key].push(row.member.name)
        return acc
      }, {}),
    },
    humanReport: renderHumanReport({ level, items, enabled, failedChecks, archivedFiltered, archived: archivedMembers.map((row) => ({ ...row.member, via: row.via })) }),
  }
}

/**
 * 人话报告喵：按严重度排序，每条给「路径 + 一句话原因 + 建议动作」，最后附「给主代理的待办清单」喵。
 */
export function renderHumanReport({ level, items, enabled, failedChecks = [], archived = [], archivedFiltered = [] }) {
  // FIX-59：告警清单只放**真告警**（红/黄）——观察项（`info`）不许出现在这里被标成"[黄]"，
  // 否则"无法判定（缺模型数据）"这类**不确定**会被读成**已判定有问题**；它们单独有下面那一段喵
  const warnings = items.filter((item) => item.level === 'red' || item.level === 'yellow')
  const head = level === 'green'
    ? `审计通过（绿）：${enabled.length} 项检查全部无异常。`
    : `审计结果：${level === 'red' ? '红' : '黄'} —— 共 ${warnings.length} 条待处理（检查项 ${enabled.length} 项）。`
  const lines = [head]

  if (warnings.length) {
    lines.push('', '待处理清单（按严重度）：')
    warnings.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.level === 'red' ? '红' : '黄'}] ${item.target}`)
      lines.push(`   原因：${item.detail}`)
      lines.push(`   建议：${SUGGESTIONS[item.check] || '由馆员核实后处理'}`)
    })
  }

  if (failedChecks.length) {
    lines.push('', '检查项执行失败（已跳过，不影响其它项）：')
    for (const row of failedChecks) lines.push(`- ${row.check}：${row.error}`)
  }

  // FIX-71：**「台账 vs 磁盘」两条排一起**并给一行总建议 —— 它们同一个病根（台账是缓存），
  // 分散在清单里读者得自己拼；放一块儿 + 一句"跑一次 ledger_rebuild"才是可执行的喵
  const ledgerMismatch = items.filter((item) => LEDGER_MISMATCH_CHECKS.includes(item.check))
  if (ledgerMismatch.length) {
    lines.push('', `台账与磁盘不一致（${ledgerMismatch.length} 条，都**只报不删**）：`)
    for (const item of ledgerMismatch) lines.push(`- ${item.target}：${item.detail}`)
    lines.push('总建议：**台账是缓存，磁盘才是事实** —— 跑一次 `ledger_rebuild` 即可对齐喵')
  }

  // FIX-84 ③：**已归档会话**单列一段（不计红黄）—— 它们不是"消失了"，而是"用户已经归档、不用管"喵
  // FIX-101：**源自归档对话的其它条目**（任务号 / 文档路径那两类 target）也一并滤掉了，这里明说数量，
  // 免得用户以为"报着报着少了几条"（过滤必须留痕，不能凭空消失）喵
  if (archivedFiltered.length) {
    lines.push('', `另有 ${archivedFiltered.length} 条**源自已归档对话**的条目已过滤（不计红黄）：`
      + `${archivedFiltered.slice(0, 6).map((row) => `${row.check}:${row.target}`).join('、')}`
      + `${archivedFiltered.length > 6 ? ' …' : ''}`)
  }
  if (archived.length) {
    // FIX-90 ④：**按父会话归并**显示 —— 让用户一眼对号入座（"我归档的那个会话下面这些都不用管了"）喵
    const byParent = new Map()
    for (const member of archived) {
      const key = String(member.via || '(自身会话)') 
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(member.name)
    }
    lines.push('', `已归档会话（不计红黄）${archived.length} 个成员，归并到 ${byParent.size} 个归档会话：`)
    for (const [parent, names] of [...byParent.entries()].slice(0, 10)) {
      lines.push(`- ${parent}：${names.slice(0, 8).join('、')}${names.length > 8 ? ' …' : ''}`)
    }
  }
  // FIX-30：观察项单独一段（**不告警**，别让人以为要处理）喵
  const observed = items.filter((item) => item.level !== 'red' && item.level !== 'yellow')
  if (observed.length) {
    lines.push('', '观察（仅记录，不告警）：')
    for (const item of observed) lines.push(`- ${item.target}：${item.detail}`)
  }

  return lines.join('\n')
}

export { CHECK_IDS }
