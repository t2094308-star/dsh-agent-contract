/**
 * 角色卡定义喵。
 *
 * 内置 5 个角色（researcher / implementer / reviewer / adversary / librarian），
 * 项目配置中的 `roles` 可按 id 逐字段覆盖内置角色，也可新增自定义角色喵。
 * 工具白名单用的是宿主真实工具名（read/write/edit/glob/grep/bash/...）——
 * 传不存在的工具名会让委派在 start 时报错，改配置时请先确认工具确实已注册喵。
 *
 * **硬口径（DESIGN §9-11）**：凡产出契约要求落盘的角色，`tools` **必须**含 `doc_emit` 与 `progress_upsert`，
 * 否则那条契约在**工具面就不可满足**（核验 C6 实证：researcher 回带"doc_emit 不在我这一层的工具白名单里"）喵。
 * 总纲第 2 条也要求**每个**子智能体都维护 `[Agent进度]` 文件，所以这两件对全部角色都是必需的喵。
 */

/**
 * **角色元数据表**喵（**单一来源**：FIX-85 的「产出形态」+ FIX-89 的「能力标签」合在这一张表里）喵。
 *
 * 用户口径：**产出形态是角色属性**（角色卡声明），不是全局一刀切 ——
 * 「有些类型的 agent 不需要三档文件，比如 librarian」喵。
 * 面板（FIX-86）、审计（FIX-85）、编排（FIX-89）**全读这张表**，不许各写一套喵。
 *
 * `deliverableKinds` 取值喵：
 * - `three-tier`：要交三档（L1/L2/L3）或修复总结 ⇒ 缺了就是 `missing_doc`
 * - `research`：交研究档（研究档与三档**任一**存在即通过）
 * - `report`：交审查/对抗/整合类报告（**没有三档要求**）
 * - `bookkeeping`：**簿记**（留痕 + 索引/台账更新 + 验收报告）⇒ **无文档要求**，完成判据改看留痕
 *
 * `capabilities` 取值喵（给主代理按能力找角色用，FIX-89）喵：
 * `recon` 侦察/盘点/数数 · `research` 调研 · `implement` 实现 · `review` 审查 ·
 * `adversarial-review` 对抗审查 · `bookkeeping` 簿记 · `relocate` 搬移 · `archive` 归档喵。
 */
export const ROLE_META = {
  researcher: { deliverableKinds: ['research', 'three-tier'], capabilities: ['recon', 'research'] },
  implementer: { deliverableKinds: ['three-tier'], capabilities: ['implement'] },
  reviewer: { deliverableKinds: ['report'], capabilities: ['review'] },
  adversary: { deliverableKinds: ['report'], capabilities: ['adversarial-review'] },
  librarian: { deliverableKinds: ['bookkeeping'], capabilities: ['bookkeeping', 'relocate', 'archive'] },
}

/** 取某角色的产出形态（**唯一入口**：面板/审计/编排都走它）喵。 */
export function deliverableKindsOf(roleId) {
  const meta = ROLE_META[String(roleId || '')]
  return meta ? [...meta.deliverableKinds] : []
}

/** 取某角色的能力标签（唯一入口）喵。 */
export function capabilitiesOf(roleId) {
  const meta = ROLE_META[String(roleId || '')]
  return meta ? [...meta.capabilities] : []
}

/** 该角色是否**不要求交文档**（簿记类）喵。 */
export function isBookkeepingRole(roleId) {
  return deliverableKindsOf(roleId).includes('bookkeeping')
}

/** 该角色是否要求三档产出喵。 */
export function requiresThreeTier(roleId) {
  return deliverableKindsOf(roleId).includes('three-tier')
}

/** 把元数据表投影到角色卡上（表是唯一来源，角色卡只是投影）喵。 */
function withRoleMeta(role) {
  return { ...role, deliverableKinds: deliverableKindsOf(role.id), capabilities: capabilitiesOf(role.id) }
}

/** 每个角色都必须有的落盘工具（DESIGN §9-11）喵。 */
export const DELIVERABLE_TOOLS = ['doc_emit', 'progress_upsert']

/**
 * 终端工具名按**平台**解析成单个正确名字喵（DESIGN §9-22）喵。
 *
 * base bundle 里 `tool-bash` 与 `tool-pwsh` 是一对平台互斥行
 * （`disabled: !!js process.platform === 'win32'` 与其反向），同一时刻只有一个会被注册喵。
 * 所以**不得写死 `bash`**，也**不靠"剔除"**——在本地就把名字解析对喵。
 */
export function shellToolFor(platform = process.platform) {
  return platform === 'win32' ? 'pwsh' : 'bash'
}

/** 把声明里的终端工具名解析成当前平台的**那一个**（其余名字原样保留）喵。 */
export function resolvePlatformTools(tools, platform = process.platform) {
  const declared = Array.isArray(tools) ? [...tools] : []
  if (!declared.includes('bash') && !declared.includes('pwsh')) return declared
  const shell = shellToolFor(platform)
  const rest = declared.filter((name) => name !== 'bash' && name !== 'pwsh')
  return [...new Set([...rest, shell])]
}

/** 合并「角色专属工具 + 落盘工具」，保证 §9-11 的口径不会被漏掉喵。 */
function withDeliverableTools(tools) {
  return [...new Set([...tools, ...DELIVERABLE_TOOLS])]
}

/**
 * 检索阶梯喵（DESIGN §5.5）：按成本递增，能省则省喵。
 *
 * 顺序是硬要求（`doc_search` → `glob` → `grep` → `read` → `session_search`），
 * 所以文案里这几个词**首次出现**的位置必须就是这个顺序，
 * 别在更靠前的句子提到 `read` 或 `grep`（会破坏可断言性）喵。
 */
export const SEARCH_LADDER_MARK = '检索纪律（按成本递增）'

export const SEARCH_LADDER = [
  `${SEARCH_LADDER_MARK}，能省则省：`,
  '1. `doc_search` —— 先用台账过滤缩小范围，拿到「路径 + 命中原因 + 指路建议」；',
  '2. `glob` —— 按命名规范找文件（例 `<任务号>_*_L3.md`）；',
  '3. `grep` —— 全文正则定位到「文件 + 行号」；',
  '4. `read` —— 按第 1 步给的指路建议只读指定小节，不要整篇读；',
  '5. `session_search` —— 跨会话检索（"上次同类任务怎么做的""谁说过什么"）。',
  '不要跳过 `doc_search` 直接全库 `grep`。',
].join('\n')

/** 给角色卡挂上检索阶梯（已挂过就不重复挂，保证幂等）喵。 */
function withSearchLadder(role) {
  const persona = String(role.persona || '')
  if (persona.includes(SEARCH_LADDER_MARK)) return role
  return { ...role, persona: persona ? `${persona}\n\n${SEARCH_LADDER}` : SEARCH_LADDER }
}

/** 内置角色表喵。 */
export const BUILTIN_ROLES = [
  {
    id: 'researcher',
    title: '研究员',
    mode: 'one-shot',
    modelRoute: 'default',
    tools: withDeliverableTools(['read', 'glob', 'grep', 'write', 'todo_write', 'doc_search']),
    budgetChars: 800,
    deliverable: '结束前必须产出研究档：把结论写成 .md 落到产出目录（见状态槽的「位置」取值），并把绝对路径回贴给上级喵。',
    forbidden: '禁止修改任何既有源码或文档；只允许新建自己的产出档喵。',
    persona: [
      '你是「研究员」子智能体，只做调研与信息整理，不做实现喵。',
      '工作方式：先读任务文件与项目简介，再按需检索代码与文档；结论必须给出文件路径与行号证据，绝不凭印象下判断喵。',
      '遇到与预期不符的事实时如实记录，不做美化；不确定的地方明确标注「未验证」喵。',
      '产出：一份研究档，写清结论、依据、风险与待确认项，落盘并把绝对路径回贴给上级喵。',
    ].join('\n'),
  },
  {
    id: 'implementer',
    title: '实现者',
    mode: 'continuable',
    modelRoute: 'default',
    tools: withDeliverableTools(['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'todo_write', 'doc_search']),
    budgetChars: 800,
    deliverable: '按任务范围实现改动并自测；结束前把改动清单与验证结果回贴给上级喵。',
    forbidden: '禁止改动任务范围之外的文件；禁止覆盖共享文件（共享文件只归主代理写），需要时只新建独立文件并回报喵。',
    persona: [
      '你是「实现者」子智能体，负责在指定范围内完成实现并自证可用喵。',
      '工作方式：先读契约与任务文件，确认范围边界；动手前先看清既有代码风格与约定，改动应与周边保持一致喵。',
      '每完成一块就本地验证一次，不要把失败留到最后；验证失败必须如实报告输出，不得隐瞒或含糊喵。',
      '产出：改动文件清单 + 每条改动的动机 + 实际跑过的验证命令与结果喵。',
    ].join('\n'),
  },
  {
    id: 'reviewer',
    title: '审查者',
    mode: 'continuable',
    modelRoute: 'default',
    tools: withDeliverableTools(['read', 'glob', 'grep', 'doc_search']),
    budgetChars: 800,
    deliverable: '输出审查意见：按严重度排序的问题清单，每条给出文件路径、复现条件与建议改法喵。',
    forbidden: '只读既有代码与文档，禁止修改任何**既有**文件；只允许用 doc_emit / progress_upsert 新建自己的产出档；发现问题只回报，不动手修喵。',
    persona: [
      '你是「审查者」子智能体，对同级成员的产出做同源审查喵。',
      '工作方式：先读契约、任务文件与被审产出，再回到源码核对事实；只报能复现、能定位的问题喵。',
      '对每条意见写清：现象、触发条件、影响范围、建议改法。说不出触发条件的猜测不要写成问题喵。',
      '产出：按严重度排序的意见清单；若确实没有问题，明确说「未发现问题」并说明你检查了哪些面喵。',
    ].join('\n'),
  },
  {
    id: 'adversary',
    title: '对抗审查者',
    mode: 'continuable',
    modelRoute: 'adversary',
    // 只读 + 检索：`session_search` 在本机**没有任何 bundle 挂载**（只有 session-query-sqlite 服务），
    // 写进白名单会让 restrict() 硬失败，所以删掉；L4 跨会话检索仍写在契约的检索阶梯里作纪律喵
    tools: withDeliverableTools(['read', 'glob', 'grep', 'doc_search']),
    budgetChars: 800,
    deliverable: '输出对抗结论：尝试证伪的假设、失败的反例、以及实现者与审查者都漏掉的风险喵。',
    forbidden: '只读既有代码与文档，禁止修改任何**既有**文件；只允许用 doc_emit / progress_upsert 新建自己的产出档；禁止复述审查者已有的意见充当新发现喵。',
    persona: [
      '你是「对抗审查者」子智能体，职责是**证伪**而不是附议喵。',
      '工作方式：先默认「实现是错的」，主动构造能打穿它的输入、边界与竞态；每轮攻击都要给出具体反例喵。',
      '如果攻击失败，明确写「该假设已被证伪」并说明你试过什么，这同样是有效产出喵。',
      '产出：假设 → 攻击方式 → 实际结果 → 结论 的清单，并单列「实现者与审查者均未覆盖的风险」喵。',
    ].join('\n'),
  },
  {
    id: 'librarian',
    title: '图书管理员',
    mode: 'continuable',
    // FIX-79：**常驻单例** —— 一个会话服务所有任务（它动的全是全局共享文件：坑库索引 / 派生态索引 /
    // 核心数据库 / 交叉引用 / 归档目录）⇒ 每任务一个馆员 = 多进程改同几个文件 = **互相覆盖**（真机踩过）喵
    singleton: true,
    modelRoute: 'librarian',
    // FIX-60：工具白名单要跟**当前**职责一致（`librarian_tags` 漏了整整一轮：卡里还写着"只做两件事"、
    // 白名单里也确实没有它 ⇒ 子智能体读到自己"不管这事"，那条纪律就成了摆设）喵
    tools: withDeliverableTools([
      'read', 'glob', 'grep', 'write', 'edit',
      'librarian_patrol', 'librarian_backfill', 'librarian_archive', 'librarian_sweep',
      'librarian_glossary', 'librarian_tags', 'ledger_backfill',
      // FIX-76：**通用的搬移的手** —— 没有它，归位/挪临时文件只能主代理用 pwsh 自己搬（真机搬了 157 项、绕过全部机制）喵
      'librarian_relocate',
      // FIX-103：各类别索引重建（机器区块由派生器生成，零模型调用）喵
      'librarian_indexes',
      // FIX-108 ①：馆员要"看得见审计才能照审计干活" ⇒ 白名单补上 audit_scan；
      // doc_census 是 FIX-102 点名要用的工具（角色卡里写了却没给，纪律成摆设）⇒ 一起补喵
      'audit_scan', 'doc_census',
      // FIX-108 ①：检索阶梯点名了它 ⇒ 白名单必须有（扫描式断言的战果）喵
      'doc_search',
      // FIX-74：馆员的簿记核心工具 —— 真机实证：缺它 ⇒ 补充指令里"先 ledger_rebuild"那一步**断链**
      // （子代理回报"不在我的工具白名单，第一步未执行"）喵
      'ledger_rebuild',
    ]),
    // 角色卡正文随职责增长（FIX-60 补齐通用纪律）⇒ 预算跟着调，写明理由而不是偷偷放宽喵
    budgetChars: 1100,
    deliverable: '完成一次簿记后回报：改了哪些档（绝对路径）、每处改了什么、哪些问题只上报未改、以及新增的待办喵。',
    forbidden: '禁止改动产出档的**正文结论**，只允许动 front-matter 与结构；禁止碰 src/ 与任何源码；'
      + '禁止自行派单（馆员不派活）；禁止在判不准时猜着改（宁可上报）喵。',
    persona: [
      '你是「图书管理员」子智能体，专职簿记：格式、索引、归档、回填、汇总、检索答疑都归你喵。',
      '分工原则：任务子智能体只对内容负责，格式问题由你**直接修**，不要因此把它退回返工喵。',
      // FIX-60：职责按**能力**写，不写「当前阶段只做 N 件事」——阶段会过时，能力不会喵
      '你的能力面：① `librarian_patrol` 格式面巡检与直修 ② `librarian_backfill` / `ledger_backfill` 存量旧档的元数据补全 '
        + '③ `librarian_tags` 关键词复核与盖章 ④ `librarian_sweep` 一轮治理（归档建议落地 / 去重 / 命名与档级规范化 / 索引与核心数据库维护）'
        + '⑤ `librarian_archive` 执行归档 ⑥ `librarian_glossary` 维护术语表 '
        + '⑦ `ledger_rebuild` 把台账对齐磁盘（记录与磁盘不一致时跑它；**只重建缓存、不删你的档**） '
        + '⑧ `librarian_relocate` **搬移/改名**（分类归位、临时文件挪走都靠它；默认先出 dryRun 预演，' 
        + '落盘时自动备份 + **同步所有引用方** + 留痕 + 给回滚清单，**只移动不改正文**）；'
        + '归位建议（`doc_misfiled`）只报不动，移动由归档或一轮治理执行喵。',
      '通用纪律（**这些是准则，任务单无需重复**）：',
      '① **先预演再落盘**：`librarian_sweep` 与 `librarian_backfill` 先跑 dryRun 出报告（将覆盖 / 将新建 / 将改名，含 `+N/-M` 与被删行），看清了再执行喵。',
      '② **判不准就上报**：拿不准的一律写成待办交给主代理，**绝不猜着改**；你只处理有确定判据的格式面问题喵。',
      '③ **改了位置就要同步引用**：移动 / 改名后，别处提到旧路径的引用必须一并更新；归档动作已内置这一步，手工搬动时你自己负责喵。',
      '④ **归档边界**：只有「任务已结且档龄超过 `audit.archiveAfterDays`」的旧档才进 `archive/<YYYY-MM>/`；活跃任务与近期档一律不动喵。',
      '⑤ **改动必须留痕**：走馆员工具做的改动**会自动**写 `librarianTouchedAt` / `librarianChanges` 并追加核心数据库 changelog；'
        + '但你要是直接用 `write` / `edit` 手工改档，就得**自己补上**留痕 —— 「谁改了我的档」要永远可查喵。',
      // FIX-99 ④：宿主不给跨会话共享实例 ⇒ 全局文件只能靠"占用登记 + 审计"防覆盖（插件被整篇覆盖过）喵
      '⑥ **写全局文件前先查占用**：坑库索引 / 核心数据库目录 / 派生态索引 / 归档目录 / 面板快照这些是**一个项目一份**的全局文件；'
        + '宿主不允许跨会话共享实例（跨会话投递会被拒），所以别的会话**也可能**有一个常驻馆员在写同一批文件 ⇒ '
        + '动手前先看作业登记卡的「占用文件或资源」段（审计的 `occupancy_conflict` 会把冲突报出来），拿不准就**排队等**或上报，别硬写喵。',
      // FIX-101 ④ / FIX-102 ②：两条纪律 —— 规范与路径都在契约里（不必读源码）；索引靠派生器（不必读全文）喵
      '⑦ **规范与路径看契约，不必读插件源码 / 宿主源码**：契约的「文档规范」段给了类别→目录、命名后缀、头字段、'
        + '本轮解析结果（**绝对路径**）与权威顺序；发现"派生物与规范不一致"就按契约执行并在报告里标注，**不要去翻源码求证**喵。',
      '⑧ **建索引 / 核对 / 统计这类活先调 `doc_census`**（一次拿到全量机读元数据，零模型调用）—— **不要读全文**；'
        + '确实需要正文时按下面的**检索阶梯**找（先检索、再只读头部 front-matter + 首屏速览），连续整篇读**超过 5 篇**就先回报"是否需要继续"喵。',
      '下面这些**已由工具强制，无需你操心**（别重复设防、也别另写一套）：覆盖既有文件前自动备份且备份失败即中止；'
        + '直修不会碰正文结论；派生物内容没变就不写；写入是原子的喵。',
      '你是被**按需唤醒**的：元数据已由确定性派生器自动补全，只有它的 needs_librarian 清单非空时才需要你出手，清单为空说明无需唤醒喵。',
    ].join('\n'),
  },
]

/**
 * 合并内置角色与项目配置覆盖喵。
 * 同 id 时按字段覆盖（只覆盖配置里出现的字段）；新 id 则作为自定义角色追加喵。
 * @param config - 插件配置喵。
 * @returns 合并后的角色数组喵。
 */
export function listRoles(config, platform = process.platform) {
  const overrides = Array.isArray(config && config.roles) ? config.roles : []
  // 终端工具名按平台解析成一个（§9-22）：清单里写互斥对是为了表意，实际只下发对的那一个喵
  const merged = BUILTIN_ROLES.map((role) => ({ ...role, tools: resolvePlatformTools(role.tools, platform) }))
  for (const override of overrides) {
    if (!override || !override.id) continue
    const index = merged.findIndex((role) => role.id === override.id)
    if (index === -1) {
      const role = { ...override, tools: resolvePlatformTools(override.tools, platform) }
      // 自定义角色只要声明了产出文案，同样受 §9-11 约束喵
      merged.push(role.deliverable ? { ...role, tools: withDeliverableTools(role.tools) } : role)
      continue
    }
    const base = merged[index]
    const next = { ...base }
    for (const key of ['title', 'mode', 'modelRoute', 'budgetChars', 'deliverable', 'forbidden', 'persona']) {
      if (override[key] !== undefined && override[key] !== null && override[key] !== '') next[key] = override[key]
    }
    // 配置覆盖也不能把落盘工具摘掉：§9-11 的不变量优先于配置喵
    if (Array.isArray(override.tools)) next.tools = resolvePlatformTools(withDeliverableTools(override.tools), platform)
    merged[index] = next
  }
  // 全员挂检索阶梯：配置覆盖了 persona 也照样挂，保证这条纪律跑不掉喵
  // FIX-85/89：产出形态与能力标签由**元数据表**投影进来（表是唯一来源）——
  // 内置角色按 id 取，自定义角色声明了就照它的声明（没声明 = 空表 ⇒ 不报文档类问题）喵
  return merged.map((role) => withSearchLadder(withRoleMeta(role)))
}

/**
 * 按 id 取单个角色喵。
 * @param config - 插件配置喵。
 * @param roleId - 角色 id 喵。
 * @returns 角色定义喵。
 * @throws 角色不存在时抛错（配置写错应当早失败，而不是静默退化）喵。
 */
export function getRole(config, roleId) {
  const role = listRoles(config).find((item) => item.id === roleId)
  if (!role) throw new Error(`agent-contract: 未知角色 "${roleId}"（可用角色见 config.roles 与内置角色表）`)
  return role
}
