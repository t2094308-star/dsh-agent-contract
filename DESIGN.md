# dsh-agent-contract — 详细实施设计书

> 面向对象：实现本插件的 Coding Agent（如 Claude Code）。
> 工作目录：`D:\DSH插件\dsh-agent-contract`（Windows；WSL 侧对应 `/mnt/d/DSH插件/dsh-agent-contract`）
> 上游设计摘要：`D:\Blockdustry\仓库\docs\子agent\P2_dsh多智能体契约插件设计v1.md`（本文件是其**可实施化**版本，冲突时以本文件为准）
> **设计冻结（2026-10-02）**：本文件不再新增设计/机制；后续只做**实现同步**（打勾、改数字、勘误）。
> 文档加深（细化到可教学/可交接的粒度）**留待全部里程碑实现完成后**再统一进行。
> 版本：v1（2026-10-02）　状态：M0 ✓、M1 ✓（契约装配引擎 + 每角色委派通道）；M2 起由 Coding Agent 继续

---

## 0. 开工提示词（可直接粘贴给 Coding Agent）

> 你在 `D:\DSH插件\dsh-agent-contract` 工作。这是一个 DeepSeek Harness（dsh）插件，把一套"多智能体契约工作流"机制化。
> 请先完整阅读 `DESIGN.md`（本文件）与 `README.zh.md`，然后按 **M1 → M5** 顺序实现。
> 每个里程碑完成后：① 跑 `bash scripts/verify.sh`（必须全绿）② 更新 `README.zh.md` 与 `DESIGN.md` 的进度 ③ 报告改动文件清单与验证输出。
> **不要**重新做架构决策（第 3 节的硬约束与第 9 节的禁令都是实测结论，已定稿）；需要偏离时必须先提问。
> 不要引入构建步骤（ESM 直写）；不要 emoji；术语统一用"子智能体/成员/主代理"。

---

## 1. 目标

把 [1] 总纲（见附录 A）的提示词约束工作流从"靠模型自觉"升级为"**机制约束 + 自动审计**"：

- **契约注入**：每次派生子智能体时，现场装配一份恰好该角色需要的提示词（[1]~[2] 完整实例 + 角色卡 + 任务切面 + 文档切片 + 状态槽 + 能力配置）
- **产出契约**：三档文档 / 进度文件 / 异常总结由工具落盘并做字数校验
- **台账与任务板**：成员/任务/文档三张表，可检索、可告警
- **审计（警告制）**：对账缺档/超字数/漏槽位/异源/幽灵 run 等，输出红黄绿
- **面板**：独立侧栏 tab（谱系图 + 合规徽章 + 跳转 + 配色标签 + 隐藏已完成）
- **图书管理员**：专职维护核心数据库/索引/待办

**通用化定位**：本插件是**引擎**，项目是**配置实例**。禁止把 `D:\Blockdustry` 或任何项目路径写进代码逻辑。

---

## 2. 系统全景

```
┌ 面板层 (M3) ────────────────────────────────────────────────┐
│  自注册侧栏 tab「契约」：谱系图 + 任务板 + 合规徽章            │
│  数据源: session-query(血缘) + 台账(SQLite) + 审计结果         │
└──────────────────────┬─────────────────────────────────────┘
┌ 审计层 (M4) ─────────┴─────────────────────────────────────┐
│  audit_scan(警告制) → 红黄绿清单 → 图书管理员整理人话报告      │
└──────────────────────┬─────────────────────────────────────┘
┌ 协作层 (M2) ─────────┴─────────────────────────────────────┐
│  台账/任务板(三表) · doc_emit · progress_upsert · bugfix_note │
└──────────────────────┬─────────────────────────────────────┘
┌ 契约层 (M1) ─────────┴─────────────────────────────────────┐
│  多实例委派通道(每角色一条) + 契约装配引擎(注入)               │
└──────────────────────┬─────────────────────────────────────┘
┌ 底座（现成，勿造）──────────────────────────────────────────┐
│  dsh-subagent 服务 + tool-subagent / -fork / -control        │
│  + list-agents；session-query(血缘)；better-sidebar(tab 服务)  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 硬约束与已验证事实（**不得重新推翻**）

| # | 事实 | 来源 |
|---|---|---|
| 1 | **官方 team 层已从 profile 移除**（`@deepseek-ai/dsh-experimental-agent-team-profile`）。原因：它的 patch 会 `disabled: tool-subagent-control` → 续聊断链；Team 版 `send_message(target)` 只认 roster 成员，对 subagent id 投递必失败；官方定位是"替换"而非"并存" | 实测 end-to-end |
| 2 | 机制层（**本项目底座**）：`tool-subagent`（委派）/ `tool-subagent-fork`（嵌套+血缘）/ `tool-subagent-control`（`send_message(agent_id)` / `interrupt_agent`）/ 独立 `list-agents` | 官方源码 |
| 3 | **前台(one-shot)**：创建 → 跑一个 turn → 产出文本 → 结束 → **释放**；**完成后不可再派活** | 实测 |
| 4 | **后台(continuable)**：返回 id，可续派/唤醒；结算通知 "…unless you send it more." | 实测 |
| 5 | `backgroundMode: 'one-shot' \| 'continuable'` 是 `tool-subagent` 的**插件级配置**；**可挂多个实例** → 每角色一条专属通道（persona/工具权限/深度/模式各自独立） | 官方源码 |
| 6 | **相邻寻址**：`send_message` 只能目标**直接层级**（父↔直接子）；子→父要求自身处于常驻可续接态 | 官方 invariant 原文 |
| 7 | **谱系口径**：`parentSession` + subagent origin，任意深度；**fork 不入 lineage**（需单独标注） | 官方 README |
| 8 | 释放语义：宿主释放**连带后代**；Publication 后 caller 必须 dispose | 官方 README |
| 9 | 深度/并发：profile `cordis.patch.yml` 的 `id: subagent` config（当前 `maxDepth: 3` / `maxActiveSubagents: 15`） | 本机配置 |
| 10 | 权限：子智能体与主智能体**平权**（工作区内读写、区外只读）→ "共享文件只归主代理写"只能=**软约束 + 审计** | 实测（win.ini 可读不可写） |
| 11 | 官方会向子智能体注入 `subagent:delegation` 权限声明（范围固定、不可自扩、被拒须回报）→ 我们的契约**接在它之后**，不重复权限说明 | 官方 README |
| 12 | 术语：官方用「**子智能体**」（bundle 内 37 处），"子代理/子agent"是民间叫法 | 实测扫描 |
| 13 | 面板：better-sidebar 的「任务管理」页已有子代理拓扑；**不 fork 它**，我们**注册独立 tab**（`ctx.betterSidebar.registerTab`） | 已定决策 |
| 14 | `@deepseek-ai/dsh-experimental-auto-review` **保留**（权限审批，与契约审查无关） | 已定决策 |
| 15 | 审计 = **警告制**（不拦截）；预算 = 软上限 + 硬上限，**超软限 ≤30% 仅提醒** | 已定决策 |
| 16 | 插件可 `inject: ['subagents']` 直接调官方 spawn 服务：`start(provider, req)` / `startContinuable(spec)` / `sendMessage` / `interrupt` / `listChildren(parentId)` / `listDescendants(rootId)` / `getProvider` / `resolveMaxDepth` | 官方源码 |

---

## 4. 目录结构与模块职责

```
dsh-agent-contract/
├─ package.json              插件清单（ESM、无构建、peer 用 *）
├─ cordis.patch.yml          bundle patch + 项目配置（config 段）
├─ index.js                  插件入口：name / inject / Config / apply
├─ README.zh.md              使用说明（持续更新进度）
├─ DESIGN.md                 本文件
├─ scripts/
│  ├─ verify-node.mjs        模块级验证（canonical test 的**唯一实现**，纯 Node，免 bash）
│  ├─ verify.sh              薄包装（一行 node 调用；沙箱禁命名管道时的兼容入口）
│  └─ verify.mjs             断言集
└─ src/
   ├─ project.js             [M0✓] 配置解析 + 目录体检（跨平台路径规范化）
   ├─ tools.js               [M0✓] contract_status；[M2✓] 产出契约三工具 + ledger_rebuild + 馆员工具；[M2.5✓] doc_search
   ├─ contract/              [M1✓] 契约装配引擎
   │  ├─ mandate.js          [1]~[2] 逐字模板 + 槽位渲染 + 残留槽位扫描
   │  ├─ roles.js            角色卡定义（内置 5 个，可被项目配置逐字段覆盖）
   │  ├─ slices.js           任务切面 / 文档切片检索
   │  └─ assemble.js         装配 + 预算计算（软/硬限 + 30% 规则）
   ├─ delegation/            [M1✓] 委派通道
   │  └─ channels.js         每角色一个 contract_delegate_<roleId> 工具的注册与调用
   ├─ ledger/                [M2✓] 台账与任务板（走宿主 storageDomain 领域，**非 SQLite**）
   │  ├─ domains.js          三个领域 members/tasks/docs + schema 校验
   │  ├─ keys.js             [M2✓] 存储键生成唯一入口 keyOf()（path-safe，人类可读信息只进值字段）
   │  ├─ fs.js               [M2✓] 台账层共用的目录/文件读取小工具
   │  ├─ store.js            领域 CRUD + 内存索引/联查
   │  ├─ rebuild.js          ledger_rebuild：扫磁盘重建三表（磁盘才是真相）
   │  ├─ derive.js           [M2✓] 元数据自动派生器（术语表展开 / 路径抓取 / needs_librarian）
   │  ├─ naming.js           命名规范：成员 <任务号>-<角色>；文档 <任务号>_<标题>_L1|L2|L3.md
   │  ├─ docmeta.js          文档形态：front-matter 渲染/解析 + 固定小节校验 + 长度分级
   │  ├─ index-sync.js        [M2.5✓] 订阅 domain/changed 节流更新派生索引（与 rebuild 互补）
   │  ├─ placement.js         [M2.5✓] 文档目录归属判定（doc_misfiled，只报不动）
   │  └─ state.js            状态机（成员/任务）
   ├─ search/                [M2.5✓] 检索（**只补原生做不到的那层，不替代 glob/grep/read**）
   │  └─ doc_search.js       L0 层：台账过滤 + snippets/score/hitReason + suggest 指路
   ├─ audit/                 [M4✓] 审计
   │  ├─ checks.js            [M4✓] 12 项检查（每项正反用例，警告制，未知项报错）
   │  └─ report.js            [M4✓] 红黄绿 + 人话报告（路径 + 原因 + 建议动作）
   ├─ librarian/             [M4✓ 全量] 图书管理员（簿记专职：索引 / 格式直修 / 回填 / 归档 / 检索答疑）
   │  ├─ duties.js            [M2✓] 格式面巡检 + 核心数据库 changelog + legacy 回填试跑
   │  ├─ fixer.js             [M2✓] 格式面直修（front-matter / 小节名 / 路径回贴）+ 强留痕
   │  └─（检索答疑不单设模块：由 `doc_search` 工具承担，见 §5.5 检索设计）
   ├─ panel/                 [M3✓] 面板的 host 侧只读数据源
   │  ├─ query.js            buildSnapshot()：成员/谱系树/计数/审计摘要（占位），空与坏数据全降级
   │  └─ snapshot.js         [M4✓] 派生快照 .agent-contract/panel.json（schemaVersion + generatedAt）
   └─ client/                [M3 部分✓] 客户端（web 面板）
      └─ tab.js              **经典脚本**（`window.__ModuleLoader__.load` + CJS factory）：注册「契约」tab
```

---

## 5. 详细规格

### 5.1 配置层（M0 ✓ / M1 ✓ 扩展）

配置来源：`cordis.patch.yml` 的 `insert[].config`（将来可加设置 UI）。字段（**以 `index.js` 的 `Config` 为准，本段已按 M1 实际实现更新**）：

```yaml
project:
  name: Blockdustry
  root: 'D:\Blockdustry'   # 必填
  brief: ''                # M1 新增：项目简介，注入契约「任务切面」；通用引擎不猜项目文档位置
paths:                       # 目录约定（相对 project.root 或绝对路径）
  tasksDir: '任务'
  progressDir: '[Agent进度]'
  deliverablesDir: '仓库/docs/子agent'      # [位置]
  docsDirs:                                 # 检索源：每类一个文件夹，禁止混放
    - '仓库/docs/研究'
    - '仓库/docs/坑'
    - '仓库/docs/修改'
    - '仓库/docs/核心数据库'
  archiveDir: '仓库/docs/archive'           # 归档分片（M4）
  docKinds:                                 # 类别 → 目录（审计/馆员据此判"是否放错"）
    研究: '仓库/docs/研究'
    坑: '仓库/docs/坑'
    修改: '仓库/docs/修改'
    核心数据库: '仓库/docs/核心数据库'
    产出档: '仓库/docs/子agent'
    归档: '仓库/docs/archive'
delegation:                # M1 新增
  provider: spawn          # 委派用的 subagent provider
  maxDepth:                # 可选；留空 = 沿用宿主 profile 的 subagent 配置
roles:                     # M1：同 id 逐字段覆盖内置角色卡，新 id 追加自定义角色
  - id: researcher         # 内置: researcher/implementer/reviewer/adversary/librarian
    title: 研究员
    mode: one-shot         # one-shot(前台) | continuable(后台)
    modelRoute: default
    tools: [read, glob, grep, write, todo_write]   # 必须用宿主真实工具名，否则委派会 start 失败
    budgetChars: 800
    deliverable: ''        # 产出契约文案（进工具描述与能力配置）
    forbidden: ''          # 禁止事项文案
    persona: ''            # 可覆盖角色卡正文
budgets:                   # M1 修正：总限按"总纲本体 ≈ 千字"重设，否则任何合规装配都必然超限
  softLimit: 6000          # 总装配软限
  hardLimit: 9000          # 总装配硬限
  warnOverSoftPct: 30
  mandateSoft: 1500        # 总纲本体单独的软限
  mandateHard: 2400        # 总纲本体单独的硬限
  mandateNoClip: true      # mandate 片段永不裁剪；超限只警告，该例外优先于其它片段
modelRoutes: {}            # 角色→路由（字符串按 model 解释，或 { provider, model, reasoningEffort }）；密钥走 dsh 凭据，禁止写入配置
audit: { checks: [missing_doc, over_budget, unfilled_slot, stale_progress, cross_vendor, ghost_run, orphan_task, unreleased_run] }
```

约束：
- `project.root` 为空 → 抛错（已实现）
- 路径一律经 `src/project.js` 的 `resolveProject()` 解析为绝对路径；**禁止**在别处手拼路径
- 相对路径以为 `root` 基准；Windows 风格根用 `\`、POSIX 根用 `/`（已实现 `canonicalRoot`/`joinUnderRoot`，勿回退）

### 5.2 契约装配引擎（M1）

**装配顺序**（拼接成子智能体的初始提示词主体；官方 delegation-scope 声明之后）：

1. `[1] 总纲 + 2』状态` 实例（附录 A 原文，**逐字**，槽位已填）
2. 角色卡（内置或配置覆盖；≤800 字）
3. 任务切面：**任务号 + 任务文件绝对路径 + 上级补充指令（只给 delta，不抄任务文件正文）** + 项目简介（`config.project.brief`）+ debug 文件清单
   - **禁止**把任务文件的正文/简报摘录塞进来：总纲第 4 条已要求子智能体自己读任务文件，重复搬运纯属浪费
   - 上级补充指令若与任务文件重复，只保留"本次新增或覆盖"的部分
4. 文档切片：**只给「路径 + 命中原因（哪些关键词命中）+ readHints（建议读哪几节）」**，默认**不给正文**
   - 例外：命中项高度相关且引文 ≤200 字符时才可附摘录；其余一律"指路"
   - 泛词（研究/产出/只读/docs/md/png/文件）必须进停用词表，不得作为命中原因
5. 状态槽：`[Agent进度]` `[任务]` `[位置]` `[上级]` `[层数]` `[总Agent数]`
6. 能力配置：工具白名单 / effort / maxTurns / 模式

**装配瘦身预算（目标，M2.5 起纳入验收）**：除 `mandate` 外的五段合计 **≤ 2500 字符**（其中 `task` 段 **≤ 300 字符**：只给路径，不抄正文）；
超出即判为"搬运失控"——审计记 `over_budget` 并指出超出的段落。**总纲（mandate）不计入此预算**（传递性要求逐字下发）。
**裁定（2026-10-02）**：`mandate` **保持全文注入**，不采用「引用文件 + sha256 校验」模式——不引入新的失败模式（漏读即契约失效）；该块开销视为固定成本。

**内容来源与过滤边界（重要，勿混）**：
- 片段内容分两类：**上级/用户手写**（任务切面里的「上级补充指令」「readHints」）与**自动召回**（文档切片、台账摘录）
- 手写内容 = **原样透传**：不去重、不做长度门控、不因"路径不存在 / 属于 write-target"被剔除；渲染时标注来源（例："（上级口述）"），且不要拼进「禁止事项」尾部
- 过滤/去重/截断**只作用于自动召回集合**：不存在的文件、本任务产出与所有 write-target、泛词命中项、超长截断
- 任务切面支持 `readHints`：上级指定"哪些文档不要全读 / 只读哪几节"的结构化入口（省 token 的正式通道，别塞进禁止事项）

**API 约定**（M1 实际实现；`buildContract` 为 **async**，因为要读任务文件与文档切片）：

```js
// src/contract/assemble.js
export async function buildContract({ config, roleId, task, parent, layer, totalAgents, project })
// task = { id, brief }；project 可选（省略时内部 resolveProject）
// → { text, segments: [{ id, chars, soft, hard }], warnings: string[], overflow: bool, totalChars: number }

// 纯函数（不读盘），单测直接打三分支：
export function assembleSegments(parts, budgets)   // parts = [{ id, text, soft, hard }]
export function classifyChars(chars, soft, hard, warnPct)   // → 'ok' | 'warn' | 'overflow'
export function truncateToChars(text, limit)       // → { text, chars }，chars 恰好 = limit（按忽略空白的字符数）
```

片段 id 固定为 6 段：`mandate` / `role` / `task` / `slices` / `slots` / `capability`。

**槽位取值口径（M1 实测修正）**：`[上级]` **绝不能用裸 session id**（会渲染成「发给 `session-89606ced-…` 级 Agent」，
既不像人话也不是身份）。口径为：顶层调用方 = `主代理`；其余用我们派活时写进 catalog 的 `label`
（正好是 §8 的成员名 `<任务号>-<角色>`，经 `ctx.subagents.listChildren(上级的父会话)` 反查）。
目录不可用（缺 `sessionQuery`）或没有父会话时，退化为 `子智能体（层 N）` —— 仍然可读且不泄露内部 id。
`[层数]` 取 `agent.session.header.delegationDepth + 1`；`[总Agent数]` 取 `listDescendants(根会话)` 长度 + 1，统计失败时退化为层数并告警。

**槽位与审计的坑**（M4 的 `unfilled_slot` 务必沿用同一口径）：
`findUnfilledSlots(text, ignore)` 只匹配本插件定义的 6 个 token（不会把总纲里的 `[1]`/`[2]`/`[]` 误判），
且**必须把已替换进去的取值传进 `ignore`** —— 因为 `paths.progressDir` 的真实目录名就叫 `[Agent进度]`，
不剔除就会出现"永远报未填槽位"的假阳性。另外「状态槽」片段刻意不写 token 字面量（只写汇总），否则会自触审计。

**预算规则**（务必实现，M1 即可测）：
- 每片段有 `soft` 与 `hard` 字符上限；总装配另有总软/硬限
- `chars > soft` 且 `chars <= soft * (1 + warnOverSoftPct/100)` → **仅 warning**（计入 `warnings`）
- `chars > hard`（或超软限 30% 以上）→ 标记 `overflow=true` 并**裁剪到 hard**，warning 说明裁剪量
- **例外：`mandate` 片段永不裁剪**（`mandateNoClip: true`）——[1]~[2] 的"传递性"要求逐字完整下发，超限**只警告**；该例外优先于其它片段
- 不做精确 token 计算（宿主有 dsh-context 面板做真实计量；我们只做字符级软硬闸）

### 5.3 委派通道（M1）——自研工具 + 复用官方 spawn 服务

**决策（已定，勿改）**：**不要**用"挂多实例官方 `tool-subagent`"。那样契约只能静态塞进 persona，
无法按任务现场装配（任务切面 / 文档切片 / 槽位填充就全废了）。
改为**自研委派工具**，内部调用官方 `ctx.subagents` 服务完成真正的 spawn（不重造 spawn 机制）：

```js
export const inject = ['tools', 'subagents']
// ctx.subagents.start(provider, req)        // 前台 one-shot
// ctx.subagents.startContinuable(spec)      // 后台 continuable → 返回 child id
// ctx.subagents.sendMessage / interrupt / listChildren(parentId) / listDescendants(rootId)
```

工具命名：`contract_delegate_<roleId>`（例 `contract_delegate_researcher`）。
每个工具的执行流程一致：
1. `buildContract({...})` 现场装配提示词（§5.2）
2. 前台角色 → `ctx.subagents.start(provider, {...})`；后台角色 → `ctx.subagents.startContinuable({...})`
3. 成员写入台账（M2）：id / 名字 / 角色 / 模式 / 层数 / 上级 / 模型路由
4. `output.render` 回传：child id / 模式 / "先落盘后收工"的产出提醒

参考官方同款调用：`D:\DSH插件\deepseek-harness\packages\subagent\tool-subagent\src\index.ts`（约 530 / 550 / 563 行）

**禁止**：把契约文本交给模型自己拼进调用参数（会失去确定性注入）。

- 角色 → 模式映射：

| 角色 | 模式 | 备注 |
|---|---|---|
| researcher | one-shot | 产出研究档后释放；**必须先 doc_emit 再返回** |
| implementer | continuable | 便于审查退回后复跑 |
| reviewer | continuable | 同级审查，只读 |
| adversary | continuable | **异源模型路由**（`modelRoutes.adversary`），只读+搜索 |
| librarian | continuable | 闲置唤醒 |

- 工具描述里必须写明：该通道的角色、产出契约、禁止事项（如 implementer 只写独立新文件；reviewer 只读）
- `modelRoutes` 未配置时退化为主模型，并在审计中标注"非异源"

### 5.4 产出契约工具（M2）

统一用 `defineTool`（形状见 §6.1）。三个工具：

| 工具 | 参数 | 语义 |
|---|---|---|
| `doc_emit` | `level`(3/2/1, 必填) · `title` · `taskId` · `body` | 写三档文档到 `paths.deliverablesDir`；**三级 250~300 字**、一级 ≤3000 字；超限仅警告不拒写（警告制）；返回绝对路径 |
| `progress_upsert` | `taskId` · `body` | 写/更新 `paths.progressDir/<任务名>.md`；**>400 字警告**；返回绝对路径与字数 |
| `bugfix_note` | `title` · `cause` · `fix` · `files[]` | 写修复总结到 `paths.deliverablesDir`；返回绝对路径 |

共同要求：
- 落盘前自动目录补建（`mkdir -p`）
- 返回值里**必须带绝对路径**（供三级文档回贴引用，这是总纲的硬要求）
- 文件名规范：`<任务号>_<标题>.md`；同任务多档用后缀区分（如 `_L3` / `_L2` / `_L1`）
- **一次性 run 的先落盘纪律**：工具描述中要求子智能体"结束前必须产出档"

### 5.5 台账与任务板（M2）

存储（已定）：**走宿主 `ctx.storageDomain`（schema 校验的 KV 领域）+ 已在挂的 `json` 后端**——
`dsh-base` 已挂 `@deepseek-ai/dsh-storage` / `-storage-json`（root = `$DSH_HOME/storages`）/ `-storage-domain`（backend: json），零安装、零兼容风险。
- 收益：读同步返回内存态 · 写完成即持久 · 按序 `domain/changed`（M3 面板可直接订阅，实时树/徽章）
- **不自建 SQLite、不拿 JSONL 当权威**；量大或需全文检索时，仅把 profile 后端换成 `@deepseek-ai/dsh-storage-sqlite`（业务代码零改动）
- 三个领域：`members`（key = `<任务号>-<角色>`）/ `tasks`（key = taskId）/ `docs`（key = 绝对路径）；联查与依赖遍历在内存做
  - **实现补充**：领域名实际加前缀 —— `agent_contract_members` / `agent_contract_tasks` / `agent_contract_docs`。
    原因是 storage-domain 对领域名做**全局单开**（重名直接 open 失败），`docs` 这种通用名很容易被别的插件先占用喵
  - 领域声明**不 import** `@deepseek-ai/dsh-storage-domain` 的 `defineDomain`/`domainTable`：它们是纯身份助手，
    用对象字面量 + 本地校验重建，省掉一个宿主私有包的解析风险喵
- 范例：`packages/session/session-projection-cache`（per-record 布局 + 节流写 200 事件 / 5s）
- 下方 SQL 仅作**逻辑模型**参考（字段语义），实际以领域记录实现
- **记录必须带 `project` 字段**（例 `project: blockdustry`）：`storages/` 按 **profile** 隔离、**不随工作区分区**，
  多项目并存时全靠该字段隔离与过滤；查询一律先按 `project` 收窄

**存储键规范（勘误 2026-10-02，线上实锤）**：`storage-json` 的 per-record 键**必须 path-safe**：`^[a-zA-Z0-9_-]+$`
——**不得**含 `:`、路径分隔符、中文、空格，否则写入即抛 `... is not path-safe`。
- **键生成唯一入口** `keyOf(project, table, logicalId)` → `<projectSlug>-<table>-<sha1(project|logicalId) 前 8 位>`
  - `projectSlug` = `project.name` 的 ASCII 净化；非 ASCII 退化为 `p_<hash6>`
  - **人类可读信息（project / 成员名 / 绝对路径 / taskId）只进值字段，不进键**
  - 调用点必须共用：`ledger_rebuild` / `ledger_backfill` / `progress_upsert` / `doc_emit` 的台账写入
- **失败隔离**：批量写遇单条非法键 → 跳过并记录，**不得整批 abort**
- **口径一致**：`librarian_patrol` 的闸门与 `--dryRun` 必须调用**同一函数**算 `needs_librarian`（否则会出现"闸门空转 / 预演 204 条"的两口径）
- **测试要求（防"绿灯撒谎"）**：`fakeStorageDomain` 必须**复刻真后端的键校验**（非法键即抛）；
  另加纯函数单测：中文任务号 / Windows 绝对路径 / 含冒号或空格的 project 名 → `keyOf()` 输出**全部**匹配 `^[a-zA-Z0-9_-]+$`

**元数据自动派生优先（原则：能用确定性代码派生的，绝不叫模型）**：

| 字段 | 自动来源 |
|---|---|
| `taskId` | 文件名 `<任务号>_…` 解析（回退：`doc_emit` 调用参数） |
| `tier` | 文件名 `_L1/_L2/_L3` 后缀 |
| `role` | 写档成员的台账记录（谁调的 `doc_emit`） |
| `createdAt` | 文件 mtime / 工具调用时间 |
| `chars` | 直接统计 |
| `relatedFiles` | 正文中出现的路径（正则抓取） |
| `keywords` | 标题 + 固定小节名内的名词 + **术语表同义词展开**（术语表由人/馆员维护，展开全自动） |
| 索引/计数 | 台账聚合 + 目录扫描（坑库 README / 核心数据库进度 / 待办勾选） |

- **派生失败清单**：派生器输出 `needs_librarian[]`（例：legacy 档无档级后缀、判不出 `taskId`、关键词全为泛词、疑似重复档）
  → **只有该清单非空时才唤醒馆员**（省唤醒、省 token）
- **批量入口**：`ledger_backfill --auto`——全量扫描自动补元数据 + 输出 `needs_librarian` 报告，**不调用模型**

**台账 = 可从磁盘重建的索引（重要原则）**：磁盘文档才是真相，台账只是缓存/索引。
必须提供 `ledger_rebuild`（扫描 `paths.deliverablesDir` / `tasksDir` / `progressDir` 重建三表）——换后端、丢数据、跨机器都无风险。

```sql
-- 成员
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,          -- session id
  name TEXT NOT NULL,           -- <任务号>-<角色> kebab-case
  role TEXT NOT NULL,
  mode TEXT NOT NULL,           -- one-shot | continuable
  layer INTEGER NOT NULL,
  parent TEXT,                  -- 上级成员 id
  status TEXT NOT NULL,         -- running | idle | completed | failed | released
  model TEXT, route TEXT,
  costUsd REAL,
  latestDeliverable TEXT,       -- 绝对路径
  lastActiveAt TEXT
);
-- 任务
CREATE TABLE IF NOT EXISTS tasks (
  taskId TEXT PRIMARY KEY, status TEXT NOT NULL, owner TEXT,
  occupiedFiles TEXT,           -- JSON 数组
  dependsOn TEXT,               -- JSON 数组
  deliverable TEXT, updatedAt TEXT
);
-- 文档
CREATE TABLE IF NOT EXISTS docs (
  path TEXT PRIMARY KEY, tier INTEGER, owner TEXT, taskId TEXT,
  chars INTEGER, title TEXT, updatedAt TEXT
);
```

约束映射：
- 相邻寻址 → 上报/下发只走直接层级；跨层沟通靠文档转贴（审计检查"跨层直发"）
- 释放 → 成员状态置 `released`，其未结任务 → `orphan_task` 警告
- 名册只增不减（team 的 roster 特性不再适用；我们的台账以 harness 的真实 session 状态为准）

**文档增长策略（战略级，M2 起生效）**：文档数量与单篇长度都会爆炸式增长（详细档可达十万字符级），
而"LLM 读大文档本身不吃亏"——所以策略是 **不省字数，省查找**：
- **注入负责"指路"，不负责"搬运"**：契约默认给 路径 + 摘要 + `readHints`（读哪几节），**不整篇塞进子智能体提示词**（避免稀释注意力与 token 灾难）
- **长度限制分级**：三级文档（给上级的摘要）**必须短**（250~300 字，硬要求）；二级/一级**放开**，超限只记 `oversize_doc` 警告，不拒写
- **命名与分片**：`<任务号>_<标题>_L1|L2|L3.md` + 按批次/模块分目录，杜绝目录腐烂
- **检索演进**：M2 用元数据 + 关键词倒排（JSON，文档量 <1e3 够用）；文档数超 ~1500 条或需要加权/模糊检索时，切 `storage-sqlite` 后端并引入全文索引（FTS）
- **归档**：按批次/时间归档旧档（类比待办 >100 行归档区），审计给 `archive_suggest` 建议而非强制

**归档分片策略（M4 定稿）**：
- **采用时间分片**：`archive/<YYYY-MM>/<原文件名>`（按文档自身时间戳的 UTC 年月分片），**与批次解耦**——批次 id 不是每份档都有的稳定维度，时间戳一定有
- **触发阈值可配**：`audit.archiveAfterDays`（默认 90 天）；命中条件 = 档龄超阈值 **且** 所属任务已结（任务缺失视为已结）
- **审计只建议**：`archive_suggest` 只报，不动手
- **馆员执行**（`librarian_archive`）：一次归档做四件事 —— **移动 → 留痕（`librarianTouchedAt` / `librarianChanges`）→ 更新引用（别的档里提到旧绝对路径的一起改，且同样留痕）→ 更新台账（删旧路径记录、写新路径记录）**；每篇单独兜错，一篇失败不影响其余
- **批次分片不采用**：需要为每个"批次"引入新的全局标识，属新增设计；若将来确有需要，另开设计条目

**文档目录分类规范（每类一个文件夹，禁止混放）**：

| 类别 | 目录 | 内容 |
|---|---|---|
| 产出档（[位置]） | `仓库/docs/子agent/` | `<任务号>_<标题>_L1\|L2\|L3.md` 与 `_fix.md` |
| 研究 | `仓库/docs/研究/` | 原 `^研究-*.md`（Mindustry 原版考证 / 机制研究） |
| 坑 | `仓库/docs/坑/` | 踩坑库 + `README.md` 索引 |
| 修改 | `仓库/docs/修改/` | 原 `^修改-*.md`（重构 / 迁移记录） |
| 核心数据库 | `仓库/docs/核心数据库/` | 总地图：`README.md` + `进度.md` + `行号索引.md` + `阻塞清单.md` |
| 归档 | `仓库/docs/archive/<YYYY-MM>/` | **时间分片定稿**（见下） |

规则：
- **`仓库/docs/` 根目录不再新增散文件**：新文档必须落进上表某一类
- 存量散文件由**图书管理员**迁移（移动 + 改名 + **更新引用** + 留痕）；归属不明者进 `needs_librarian`
- 审计新增 **`doc_misfiled`**：文档不在规定目录 / 根目录残留散 `.md` → 警告（警告制，只报不动）
- `docsDirs`（检索源）与上表同步；`archiveDir` 单独配置项

**检索设计（重点，M2 起）** —— 原则：**能用原生工具的绝不自造**；本插件只补原生做不到的那层（元数据 / 索引 / 排序 / 指路建议）。

检索阶梯（子智能体按成本递增使用，写进角色卡）：

| 层 | 手段 | 归属 | 用途 |
|---|---|---|---|
| L0 | `doc_search`（台账 docs 表：任务号 / 角色 / 档级 / 标签 / 关键词） | 本插件 | 先缩小范围，拿候选 路径 + 摘要 |
| L1 | 原生 `glob` | 宿主 | 按命名规范找文件（例 `<任务号>_*_L3.md`） |
| L2 | 原生 `grep` | 宿主 | 全文正则定位到 **文件 + 行号** |
| L3 | 原生 `read`（按 `readHints`） | 宿主 | 精读指定小节 |
| L4 | `session-query` **服务**（注意：本机**没有**名为 `session_search` 的工具被任何 bundle 挂载） | 宿主 | 跨会话检索（"上次同类任务怎么做的""谁说过什么"）——审计与图书管理员也要用。**阶梯是纪律文案，不构成工具授权**：写入 `roles[].tools` 前必须确认该工具**真被挂载**，否则 fail-open 下会硬失败 |
| L5 | FTS / BM25 / 向量 | 到量再加 | 加权、模糊、语义检索 |

**让文档天然可检索**（产出侧硬规范，`doc_emit` 强制）：
- 每份产出档头部必须有 **YAML front-matter**：`taskId` / `role` / `tier` / `keywords[]` / `relatedFiles[]` / `createdAt`
- **固定小节名**（供 `readHints` 精确指路）：`## 结论` / `## 依据` / `## 风险与待确认` / `## 下一步`
- `keywords` 必须含**同义词**（例 "分裂炮台 / scatter / 分裂炮"）——因为 L1/L2 靠字面命中
- 三级文档末尾必须附 一级/二级文档的**绝对路径**（总纲要求）

**`doc_search` 工具规格（薄，勿重造 grep）**：
- 入参：`query`(关键词/正则) · `taskId?` · `role?` · `tier?` · `limit?`
- 出参：`[{ path, tier, taskId, chars, keywords, snippets: [{ line, text }], score }]` + `suggest`（建议 read 哪几节）
- 实现：先查 docs 台账做 L0 过滤 → 只对候选做轻量匹配 → 排序；**不替代 grep**
- 索引维护：订阅 `domain/changed` 节流更新（参考 `session-projection-cache`）；`ledger_rebuild` 全量重扫
- 演进：docs > ~1500 条 或需要权重/模糊 → 内部切 FTS5 实现，**工具签名不变**

**审计新增**：`doc_meta_missing`（缺 front-matter / 固定小节）· `doc_tags_stale`（正文改了但 keywords 没更新）· `archive_suggest`

### 5.6 面板（M3）

- **可读性硬要求（FIX-28）**：紧凑化**不得砍标签**——卡片/列表每枚徽章都要能对上含义（极短标签 1~2 字），列表**列头常驻**，面板底部一行**图例**（五枚徽章含义 + 五种状态符号 `✓ ⚠ ✗ ? —`）
- **可写边界（FIX-41，唯一例外）**：面板**默认只读**；唯一可写目标是配置里的**待办文件**（`panel.todoFile`）。写通道用宿主公开 API（自注册 HTTP 路由，better-sidebar 同款）；**单文件白名单**（解析后必须位于项目根内且等于配置值）；勾选为**行级最小编辑**（只翻 `- [ ]`↔`- [x]`，不重排不动他行）；写前**备份 + 指纹校验（乐观锁）**，冲突则拒绝并提示刷新；失败必须明示、不得静默
- **空白区利用（FIX-29）**：列表下方放「**待做任务列表**」——优先展示派生态 `todos[]`（未结任务 / 审计红黄 / 缺失产出，每项带 `path` 可定位）；可选渲染 `panel.todoFile`（默认 `<project.root>/待办.md`，路径由 **host 在快照里给出**，解决客户端拿不到项目根）原文，用**自实现 md 子集渲染**（零构建、**只读**、超长截断可展开）

```js
// 客户端插件入口声明（package.json）
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "inject": ["@deepseek-ai/dsh-client-ui-settings"], "platform": "web" } }

// 注册 tab（在 client 侧）
ctx.effect(() => ctx.betterSidebar.registerTab({
  id: 'agent-contract',
  title: '契约',
  icon: /* 主题色 glyph，无 emoji */,
  // dedupeKey / createTab / badge / settings.render 按 better-sidebar 的 TabDescriptor 实现
}))
```

功能点（本次需求）：
1. **点击卡片跳转到该子智能体会话**（抓手：客户端 `ui-session` 的会话切换能力；先在 `lib/types` 里找现成 API）
2. **角色配色标签**：主代理/成员/子智能体 + 角色色（审查、对抗审查各一色）+ 状态 + 前台/后台
3. **隐藏已完成与一次性节点**（过滤开关，默认隐藏已完成的一次性 run）
4. **合规徽章**：契约✓ · 三档✗ · 进度✗ · 预算超限⚠ · 异源✓/✗

与官方「任务管理」页并存：命名/图标区分，并在设置提示"关闭它的自动展开"。

**实现注记（M3 收口，2026-10-02，勘误级）**：
- `TabDescriptor` 要点：必填 `component(props: TabComponentProps)`；可选 `id/title/description/icon/order/hidden/available/single/dedupeKey/createTab/urlTarget/settings/badge/onOpen/onActivate/onClose`
- **白捡 API**：`TabComponentProps.onSubagentJump(childSessionId)` = 跳转子智能体会话（正好用于"点击节点跳转"）；`settings.pluginToggles` = 插件私有持久化键（落 `pluginSettings[<tab id>]`，**读回在组件侧无公开 API**）
- **访问 remote 只能用"注入后的 ctx"**：`props.ctx`（组件渲染期子上下文）**不带本模块的 inject** → 访问 `ctx.remote.<ns>` 会抛 `cannot get property "…" without inject`。正确姿势：模块 `inject` + `apply(ctx)` 的 ctx，或 `ctx.inject([...], scope => …)` 嵌套（官方范式见 `ui-sidebar-documentpreview/src/client/office/index.ts`）。**失败归因必须分步**（读血缘 / 读快照各自 try），不许共用一个 catch 文案
- **client 必须显式注入 remote 服务名**：`ctx.remote.<ns>` 只有在该 client 模块导出的 `inject` 里声明了 `'remote'` / `'remote.<ns>'` 才可用（官方 client 模块声明为 `['connection','fileUpload','typert','remote','remote.commands','remote.session','remote.subagents']`）。**`package.json` 的 `dsh.client.inject` 只是到达顺序提示，不是服务注入**——实测踩过：只 inject `betterSidebar` → `ctx.remote` 为 undefined → 面板恒定"数据源为空"
- **client bundle 形态（硬要求）**：经典脚本（非 ESM）→ `window.__ModuleLoader__.load({ id: <包名>, factory })` + CJS factory；`dsh.client.platform='web'` + `exports["./client"]`；`inject` 用**服务名**（`['betterSidebar']`）
- **host 数据通道（关键约束）**：client 取 host 数据只能走宿主既有 gateway remote（`ctx.remote.<ns>`）；发布自有 namespace 需 `TypertRemoteService` + `@Remote` 装饰器（宿主私有包 + 装饰器垫片）→ **M3 不引入**
- **M3 数据源裁定（B 方案）**：面板用宿主现成 `remote.session.*`（血缘）渲染**谱系树 + 状态 + 角色配色 + 过滤 + 可推导徽章（契约/异源）**；台账派生项（三档/进度徽章、计数）**推迟到 M4**
- **M4 前置调查（已执行，2026-10-02）**：① 宿主**已有**只读文件/工作区读取 remote —— **走①，不需要 typert**
  - `@deepseek-ai/dsh-api-workspace-files`（`packages/api/workspace-files`），namespace = **`workspaceFiles`**，由 `@deepseek-ai/dsh-web-app` bundle 挂载（`packages/bundle/web-app/cordis.patch.yml:132`）
  - client 调用形态：`remote.workspaceFiles.{read|readBytes|stat|list|changes}(sessionScope, path, …, signal)`；`read` 按页读 UTF-8 文本、`readBytes` 读字节窗口、`list` 列目录、`changes` 订阅文件/目录变更（stream）
  - **服务不暴露任何写操作**（README 原文 "The service exposes no mutation operation"）；`read`/`stat` **可读工作区之外**的路径，`list`/`changes` 限于工作区
  - 结论：面板要拿台账/审计派生数据，可由 host 侧产出一份**派生快照文件**再让 client 用 `workspaceFiles.read` 读回，**零新依赖、零构建步骤**（快照落点与产物形态待 M4 定）
- 携带未闭合项：**3.3 开关读回链路**（写侧已按 `pluginToggles` 声明，读侧缺公开 API → 暂 best-effort 读 `tab.meta.prefs` 退回默认，待 M4 通道定了再补实）
- **M4 数据通道裁定（2026-10-02）**：走 **(a) 派生快照 + 宿主只读文件 remote**
  - 通道：`@deepseek-ai/dsh-api-workspace-files`（namespace `workspaceFiles`，由 `dsh-web-app` bundle 挂载）；方法 `read/readBytes/stat/list/changes`；`read/stat` 可读工作区外、`list/changes` 限工作区内；**无任何写操作**（天然满足"面板只读"）
  - host 在**审计完成 / 台账变更（节流）**后重写派生快照 `<project.root>/.agent-contract/panel.json`（含 `schemaVersion` + `generatedAt`）；client 用 `workspaceFiles.read` 读、`changes` 订阅刷新；版本不兼容 → client 降级 `unknown`
  - **派生物定性**：可从台账/磁盘重建、**不是真相**、不进审计、不进文档体系、可随时删除；建议加 `.gitignore`
  - **边界（FIX-41 修订）**：面板**默认只读**；**唯一可写目标是配置里的待办文件**（`panel.todoFile`）。
    写快照的仍是 host 侧；待办文件的写入走**宿主自注册的 HTTP 路由**（备选 (b)，见下）——
    本插件**不再往读通道里塞写操作**：`workspaceFiles` 保持零写、台账与其它文档仍由 host 的 tool 路径写喵。
  - 备选 (b)：自注册 HTTP 路由（`ctx.webServer.register`，better-sidebar 同款）——仅在 (a) 受阻时启用

**实现注记（核验轮 FIX-17/20/21，2026-10-03）**：
- **成员索引按 `sessionId`（FIX-17 = 报告 FIX-27）**：此前 `members` 按**成员名**建键 → 同名多轮成员（`T99-…-reviewer` × 3，sessionId 各不相同）在**存储层**就被压成一条，后到者覆盖先到者、旧会话 id 直接丢失。现在：① 存储逻辑键 = `sessionId`（无 id 的派生成员退回名字，见 §9-29）② 快照同时产出按名的 `members`（退化用）与按 id 的 `membersById`（**主索引**）③ client **优先按 sessionId 取徽章**，取不到才按名退化，且退化时给节点打 `badgeFallback` 并在 tooltip 写明"同名可能串"。快照 `schemaVersion` → **2**（结构变化，老版本 client 一律降级 `unknown`）
- **徽章恢复「符号 + 文案」（FIX-20）**：DESIGN 功能点 4 原文就是 `契约✓ · 三档✗ · 预算超限⚠`；上一轮"去符号只留彩色文字"的决定**作废**（实测反馈：只能靠颜色分辨，且五态里只剩两个可见）。四类取值符号两两不同（`✓ ⚠ ✗ ?`，`—` 不适用），渲染成 `✓ 正常 / ⚠ 警告 / ✗ 缺失 / ? 未知 / — 不适用`（列表格子只有 40px 定宽，`— 不适用` 放不下 → 格子里只留符号，完整文案进 tooltip 与图例），颜色仅作辅助；图例给出取值对照 + 固定顺序（格子窄，徽章名进 tooltip）。状态集合覆盖 `running/idle/completed/failed/released`（失败与已释放只有宿主知道 → 宿主给了状态词就以它为准，不认识的词退回旧的 `running/agentAvailable` 近似）
- **审计入口（FIX-21）**：只把红黄计数做进徽章 = 用户「都没看到」。快照 `audit` 增加 **`items`**（`{check, level, target, detail, suggestion}`，`suggestion` 与 `SUGGESTIONS` 同源）；面板顶部常驻**摘要条**`审计：红 N / 黄 M` + 可展开清单（路径 + 原因 + 建议），展开态持久化；**血缘为空时同样显示**（快照是另一条数据源，且那正是最需要看审计的时候）。快照没到时明说"数据源待接"，**不写 0 红 0 黄**（那等于谎报全绿）。清单条目**整行按等级着色**（红 `#f85149` / 黄 `#d29922`），不在行首拼 `[红]/[黄]` 前缀；等级词留在 tooltip 里，作为颜色之外的一条可读线索喵
- **文档改名不再重复前置任务号（FIX-19 = 报告 FIX-29，命名规范见 §5.5、禁令见 §9-32）**：反解按**已知任务号**（front-matter 的 `taskId`，权威）精确剥离前缀；改名计划幂等，重复前置形态一律拦下只报不改

**实现注记（覆盖事故防线 + 可用性，FIX-24/28/29，2026-10-03）**：
- **退化告警要挂对地方（FIX-24）**：同名成员的 `badgeFallback` 原先只挂在五枚徽章各自的 tooltip 上，而卡片/名字的 tooltip 是 session UUID → 用户悬停卡片**根本看不到告警**。现在卡片与名字的 tooltip = `id + 告警`，另加 `⚠` 角标（灰度可辨）喵。
- **徽章要"念得出来"（FIX-28）**：格子里是 **`徽章名 + 符号`**（`契约✓`，1~2 字标签本就够窄）；列表**列头 sticky 常驻**并写出五枚的顺序；底部**常驻一行**五态符号图例（`✓ 正常 / ⚠ 警告 / ✗ 缺失 / ? 未知 / — 不适用`）。验收口径：**不看 tooltip** 也能说出"哪枚是哪个、什么状态"喵。
- **列表下方 = 待做任务（FIX-29）**：快照新增 `todos[]`（未结任务 / 审计红黄 / 缺失产出，每条带 `path`，红在前，与 `audit_scan` 同源）+ `paths.todoFile`（绝对路径；默认 `<项目根>/待办.md`，可配 `panel.todoFile`）。client 渲染**派生态清单优先**，再用**自实现的 md 子集**（标题/列表/复选框/粗体/行内代码/链接，零依赖零构建）渲染待办原文——**只读**（面板永不带写路径）、超长按前 80 行截断并可展开、空则「（无待办）」。`paths.todoFile` 由 host 放进快照，正是为了绕开"client 拿不到项目根"的鸡生蛋喵。
- **点行跳会话（FIX-30）**：待办行与审计行都带 `sessionId`（host 按「成员名 → 成员 / 文档 owner → 成员 / 任务 owner → 成员」反解）；**只有解得出来的行才可点**（解不出即 `null`，不给可点的假象），点击复用卡片那条 `uiWorkspace.openSession` 链路。审计行同时改为**整行按等级着色**（红 `#f85149` / 黄 `#d29922`），等级词退到 tooltip 作为颜色之外的可读线索喵。

### 5.7 审计（M4，警告制）

| 检查项 | 判定 |
|---|---|
| `missing_doc` | 成员有产出义务但 `deliverablesDir` 无对应文件 |
| `over_budget` | 片段/文档超软限（≤30% 仅提醒）或超硬限 |
| `unfilled_slot` | 契约实例存在未替换的 `[xxx]` 槽位 |
| `stale_progress` | 进度文件 >400 字，或最后更新早于成员最后活动 |
| `cross_vendor` | `adversary` 的模型家族与 `implementer` 相同（= 非真对抗） |
| `ghost_run` | 谱系中有 one-shot 节点但无产出档 |
| `orphan_task` | 成员 `released` 但任务未结 |
| `unreleased_run` | 有活动但无释放记录的 run |

输出：`{ level: 'red'|'yellow'|'green', items: [...], humanReport: string }`；`humanReport` 交给图书管理员整理。

**核验轮补充（FIX-21）**：`items` 同时**随派生快照下发**（每条补 `suggestion`，取自 `SUGGESTIONS`），面板据此渲染「红黄摘要条 + 可展开清单」——审计结论只有抵达界面才算落地，光有 `humanReport` 等于用户看不到喵。

### 5.8 图书管理员（M4）——专职簿记

**分工原则（重要）**：任务子智能体只对**内容**负责；一切**格式、索引、归档、回填、汇总、检索答疑**归图书管理员。
目的：不让内容 agent 把配额与注意力耗在簿记上，也不因格式问题把它退回返工。

- 触发：① 批次完成 ② `audit_scan` 出现红/黄 ③ 单个任务收档时的一次轻量巡检
- 模式：后台（continuable）闲置唤醒；模型走便宜档；常驻可续接
- 权限：写 = `paths.docsDirs`（含索引文件 / 核心数据库 / 待办 / `archive/`）+ 台账三领域的标记字段；
  读 = 全部；**绝不碰 `src/`**，也不改任务子智能体产出档的正文（只动元数据与格式）
- 职责清单：
  1. 索引维护：坑库 README · 核心数据库（进度计数/行号/阻塞清单）· 待办勾选
  2. **格式面验收与直修**：front-matter 完整性、固定小节名、keywords 同义词、三级档字数、绝对路径回贴 —— 不合规**直接修**；只有内容问题才回退给任务 agent / 审查者
  3. **legacy 回填**：给存量旧档补 front-matter 与 keywords（分批、可暂停）
  4. **命名与档级规范化**：按 `<任务号>_<标题>_L1|L2|L3.md` 改名/移动，并更新引用
  5. **归档与去重**：待办 >100 行归档、重复档合并、按批次/时间移入 `archive/`（分片策略 M4 定）
  6. **审计报告人话化**：把 `audit_scan` 的原始红黄绿整理成可执行报告 + "给主代理的待办清单"
  7. **检索答疑（项目记忆官）**（**不单设模块**：由 `doc_search` 工具承担）：响应"以前有没有类似研究 / 这个坑踩过吗" → 用 L0~L4 返回 路径 + 小节 + 摘要，省掉任务 agent 自己扫库
  8. 术语表维护：统一关键术语与命名（例 scatter / 分裂炮台），提升 grep 命中率
  9. （可选）成本汇总：把每批 token/费用记进台账，供主代理决策
- 工具集：`doc_search` / `ledger_*`（含 legacy / archived 标记）/ 宿主 `read`·`glob`·`grep`·`write`·`edit`；
  **不注册任何委派工具**（馆员不派单）
- **直修留痕（强制）**：馆员改动任何产出档时，必须在该档 front-matter 写 `librarianTouchedAt` 与 `librarianChanges[]`（改了什么），
  并在核心数据库留一条 changelog —— 正文结论一律不动，避免"谁改了我的结论"无从追查

**实现注记（FIX-26，2026-10-03，勘误级）**：
- **真身与派生物彻底分家**：`appendChangelog()` 的目标恒为**真身** `coreDbPath()`，`rebuildCoreDatabase()` 写**另一个文件** `coreIndexPath()` = `<docKinds['核心数据库']>/派生态索引.md`。此前两者共用 `docsDirs[0]/核心数据库.md` → 馆员 changelog 被写进**派生物副本**、真身反而空白，且整篇重写会冲掉真身正文（实测两份同名档并存：真身 74KB / 副本 20KB）喵。
- **真身定位（迁移期两布局都认）**：家目录 = `paths.docKinds['核心数据库']`（没配则退回 `docsDirs` 的公共父目录）；真身在 `<家目录>/核心数据库.md`（MIGRATE 后）或**家目录的父目录**（迁移前，即 docs 根）。两份都存在时以"已迁移"的那份为准（判定单调，不会来回跳）喵。
- **派生物自述**：`派生态索引.md` 头部必须含 `派生物` + `可重建` 两词，并写明真身路径 —— 一眼分清"哪份是真的"（§9-27/34）喵。
- **迁移期只读不写**：`findStrayCoreDbs()` 找出错位的同名档并上报（`hasOwnIdentity` 标出有没有自述身份）；馆员的任何写入都**碰不到**它们，等用户/迁移脚本清理（§9-26 的备份规则）喵。
- **变更日志分子区**（§9-35）：真身里 `## 变更日志` 下分 `### 迁移批次` 与 `### 文档治理记录`；`appendChangelog({ section })` 默认写治理子区，且**只加行**（历史行一个字不改，删行恒为 0）。标题按 `变更日志` **宽容匹配**（真身实况是 `## 九、变更日志（由执行方/馆员追加；历史行不改写）`）——只认字面写法会在真身末尾另起平行章节；子区边界认 `###` **与** `##`，免得把日志插进后续章节喵。
- **写前备份是硬闸门（FIX-22）**：所有会**改写/覆盖既有文件**的动作（索引重建、命名规范化/归档、格式直修、回填、tags 复核、changelog 追加、引用改写）统一走 `src/librarian/backup.js` 的 `writeWithBackup()` —— 先复制到 `<项目根>/.agent-contract/backups/<时间戳>/<相对路径>`，**备份失败即返回 `ok:false` 并跳过该文件**（调用方记 warning，绝不无退路地覆盖）。`--dryRun` 给「将覆盖（含旧指纹 sha 前 12）/ 将新建 / 将改名」三类明细。实测教训：一轮治理覆盖了人工 `坑/README.md`，无 git 无备份 → 不可恢复喵。
- **索引只在标记区块内合并（FIX-23）**：`src/librarian/merge.js` 的 `mergeIndexBlock()` —— 机器内容只活在 `<!-- agent-contract:index:start/end -->` 之间；**区块外一个字节都不动**，历史手工档（无标记）只把区块**追加**到文末、绝不重排；`+N/-M` 行级 diff 里 `-M>0` 必须列出被删内容；同内容不重写（两遍幂等）喵。
- **tags 步骤 + 盖章（FIX-25，配合 §9-32/33）**：`refreshStaleTags()` / `librarian_tags` 对"正文新于头部"的档重算 keywords（判据 `isTagsStale()` 与审计**同源**、词源与派生器同源），**只增不删**，且**即使无词可加也盖章**（"复核过"同样是事实）；审计建议必须指向真机制，否则明写「需人工处理（当前无自动机制）」喵。注意：盖章**不改台账 `updatedAt`** —— 档龄算的是内容年龄，否则会把待归档的老档"洗白"喵。

**分阶段边界（这一轮做到哪，勿越界实现）**：
- **M2（本轮）**：**先自动化，馆员兜底**——`doc_emit`/`ledger_rebuild` 内置**自动派生器**（front-matter 各字段、档级、任务号、角色、时间、字数、relatedFiles、索引，全部机器派生，零模型调用）；
  馆员只做**骨架**，且**仅在派生器报出 `needs_librarian` 非空时**被唤醒（含留痕的格式直修 + 需要判断的补全）。
  工具：宿主 `read`/`glob`/`grep`/`write`/`edit` + `ledger_*`，**不含 `doc_search`**（M2.5 才有）
- **M2.5**：接上**检索答疑**（`doc_search` 到位后启用 `ask.js`）
- **M4**：接上**审计人话化** + 核心数据库/索引维护 + 命名规范化 + 归档去重 + 术语表 + legacy 全量回填（依赖审计与分片策略）
- **触发限定**：M2 阶段馆员只由「单任务收档」的轻量巡检唤醒；"批次完成 / 审计红黄"触发等 M4 生效

## 6. 接口参考（已核实，勿重新调研）

### 6.1 工具定义（抄 `dsh-plugin-88api-image`）

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'contract_status',
  description: '…',
  parameters: { verbose: { type: 'boolean', description: '…' } },
  output: {
    schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } },
    render: (_args, value) => [{ type: 'text', text: '…' }],
  },
  async execute(args, exec) { return { ok: true } },
  presentCall: () => ({ card: 'generic', title: '…', kind: 'read' }),
}))
```

**`exec` 形状（M1 已核实）**：`exec.agent?: Agent`（可选，agent loop 代其运行时才有）、**`exec.signal: AbortSignal`（必填）**、
`exec.callId` / `exec.name` / `exec.arguments` / `exec.token` / `exec.deferContext()` / `exec.concludeTurn()`。
**没有 `exec.session`** —— 会话走 `exec.agent.session`。`presentCall` 的 `kind` 合法值：
`read | edit | delete | move | search | execute | fetch | other`；`card` 为 `generic | terminal | diff`。
`output.schema` 的对象节点**必须写 `additionalProperties`**；`required` 以每个属性上的 `required: true` 表达。
工具名**全局唯一**，重名直接抛错；工具实现里禁止 `console.log`，要记日志用 `ctx.logger`。

### 6.2 插件入口

```js
import Schema from '@deepseek-ai/schemastery'
export const name = 'agent-contract'
export const inject = ['tools', 'subagents']   // 面板能力在 M3 追加 client 侧注册
export const Config = Schema.object({ /* 见 §5.1 */ })
export function apply(ctx, config) { /* 注册工具/服务 */ }
```

### 6.3 package.json（当前）

```json
{
  "name": "dsh-agent-contract", "version": "0.0.2", "private": true, "type": "module",
  "main": "index.js",
  "scripts": { "test": "bash scripts/verify.sh" },
  "exports": { ".": "./index.js", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/dsh-tools": "*" },
  "dependencies": { "@deepseek-ai/schemastery": "^3.18.1" }
}
```
**peer 版本一律用 `*`**（硬 pin 会撞 dsh 兼容性守卫）。
**不需要**把 `@deepseek-ai/dsh-subagent` 写进依赖：委派走 `ctx.subagents` 运行时服务，
只在 `inject` 里声明服务名即可（源码里也就没有该包的 import，验证脚本无需桩它）。

### 6.4 安装 / 生效 / 验证

```bash
# 依赖：link 安装时 pnpm 不会给插件源码目录装依赖，必须自己装一次
cd "D:\DSH插件\dsh-agent-contract"
npm install --omit=dev --legacy-peer-deps     # 装 @deepseek-ai/schemastery（+ cosmokit 传递依赖）
                                              # 不装会直接 "failed to import"：见下方坑 0

# 安装（link，dev 迭代免重装；已装过则改代码即时生效）
cd "/mnt/d/DeepSeek Harness/resources/runtime/cli/bin"
cmd.exe /c "dsh.cmd plugin --profile desktop add link:D:\DSH插件\dsh-agent-contract"

# 模块级验证（canonical）
bash scripts/verify.sh          # 或 npm test（15 项断言；末尾 ALL CHECKS PASSED 即通过）
# 脚本会自动探测 profile 的 node_modules（WSL 用 /mnt/c/...、Git Bash 用 /c/...；
# 可用 DSH_PROFILE_NM 覆盖），并用 profile 里的 `yaml` 包顺带校验 cordis.patch.yml

# 生效：桌面应用完整重启（托盘 Quit → 重开）
# 应用内验收：会话工作区指向项目根 → 调用 contract_status 体检，再调用 contract_delegate_<角色> 派活
```

**坑 0（M1 实测，必读）**：宿主只提供 `@deepseek-ai/dsh-tools` 这类私有包（通过它自己的模块加载器，
本机 profile 的 `node_modules/@deepseek-ai/` 下**没有** dsh-tools，只有 `schemastery` 和 `cosmokit`）；
而 `@deepseek-ai/schemastery` 必须作为**真实 node 包**从插件路径可解析。
`link:` 安装时 pnpm 不会替插件源码目录装依赖，因此漏装会表现为应用内弹「组件启用失败 … failed to import」，
且**默认 node 解析下报的正是 `Cannot find package '@deepseek-ai/schemastery'`**。
修法就是在插件源码目录跑一次 `npm install`（`node_modules/` 已 gitignore）。
诊断命令：`node --input-type=module -e "await import('file:///D:/DSH插件/dsh-agent-contract/index.js')"` ——
报 `schemastery` = 漏装依赖；报 `dsh-tools` = 正常（该包由宿主提供，离线复现必然报它）。

### 6.5 可参考的现成资产（本机）

| 用途 | 路径 |
|---|---|
| 工具插件模板 | `C:\Users\flafk\.dsh\profiles\desktop\node_modules\dsh-plugin-88api-image`（`index.js` + `src/tools.js`） |
| 客户端插件模板（settings/bundle） | 同目录 `dsh-network-proxy`（含 `dsh.client.inject` 写法） |
| better-sidebar 的 `registerTab` 类型 | 同目录 `dsh-better-sidebar/lib/types/client/service.d.ts` |
| 官方源码（subagent / session-query / agent-team 历史） | `D:\DSH插件\deepseek-harness`（`packages/subagent/*`、`packages/session-query/*`） |
| 桌面 profile / 日志 | `C:\Users\flafk\.dsh\profiles\desktop`（`.plugin-manager/logs/` 排错） |

---

## 7. 里程碑与验收标准

| 里程碑 | 内容 | Done 定义 |
|---|---|---|
| **M0 ✓** | 骨架 + 配置层 + `contract_status` | `scripts/verify.sh` 全绿；应用内 `contract_status` 返回项目配置与目录体检 |
| **M1 ✓** | 自研委派工具 + 契约装配引擎 | `scripts/verify.sh` 15 项全绿：槽位全填（`[上级]` 为可读身份、非裸 session id）、预算软/硬/30% 三分支 + mandate 免裁、角色覆盖、前后台通道、释放语义、降级。**唯一未完成项**：Done 定义要求的"真实研究→实现链路并产档"需在应用内验收，且"产档"依赖 M2 的 `doc_emit`（M1 阶段以子智能体直接用宿主 `write` 落盘替代） |
| **M2 ✓** | 产出契约三工具 + 三领域台账 + `ledger_rebuild` | ① 三工具落盘且返回**绝对路径**，强制 front-matter + 固定小节名 ② 文档命名 `<任务号>_<标题>_L1\|L2\|L3.md` ③ 三领域 CRUD 单测 ④ `ledger_rebuild` 可用（删台账后能重建）⑤ 长度分级：三级**强警告**（250~300），二/一级只记 `oversize_doc`，**均不拒写** ⑥ 存量旧档标 `legacy`、不报警 —— **以上六条 `scripts/verify.sh` 21 项全绿逐条覆盖**。实现补充：领域名加 `agent_contract_` 前缀（storage-domain 全局单开，`docs` 这类通用名易撞）；front-matter 由 `doc_emit` 自动写入（结构性强制，模型无法产出缺头部的新档）；`[上级]` 口径见 §5.2 ⑦ **馆员骨架（本轮补做）**：可被唤醒并完成一次格式直修（含 `librarianTouchedAt`/`librarianChanges[]` 留痕）⑧ `legacy` 回填**试跑**（限量 + 报告，不全量） —— **⑦⑧ 已由 `scripts/verify.sh` 第 20~23 项覆盖**（25 项全绿）：`librarian_patrol` 直修破损档（补 keywords、补固定小节占位、三级档回贴绝对路径）+ 留痕 + 核心数据库 changelog、且**正文零改动**；`librarian_backfill` 试跑限量、留痕、回填后 `legacy=false` 但 `tier=0` 故不参与 `doc_meta_missing`；馆员角色确认「后台常驻 + 便宜档 + 不注册委派工具」 ⑨ **元数据自动派生器（本轮追加）**：`doc_emit`/`ledger_rebuild` 内置机器派生（front-matter 各字段 / 档级 / 任务号 / 角色 / 时间 / 字数 / relatedFiles / 关键词术语表展开），**零模型调用**；派生失败进 `needs_librarian[]`，**馆员仅在该清单非空时唤醒**（取代「收档即巡检」）；批量入口 `ledger_backfill --auto`（不调模型） —— **⑨ 已由 `scripts/verify.sh` 第 19、22、24~26 项覆盖**（29 项全绿）：派生器单测（术语表同义词展开、正文路径抓取去碎片、档级/任务号/时间/字数全部机器派生、失败落 `needs_librarian`、同任务号同档级同标题判重复）；`project` 记录章 + 读路径收窄 + KV 键 `<project>:<逻辑键>` 互不覆盖；`librarian_patrol` 闸门（清单空则空转不读不改，非空才唤醒）；`ledger_backfill --auto` 支持 `dryRun`、不带 `auto` 拒绝执行 ⑩ **存储键勘误修复（2026-10-02 线上实锤）**：`keyOf()` 成为键生成唯一入口（`<projectSlug>-<table>-<sha1前8位>`，全部 path-safe），store 三表物理键一律走它，`ledger_rebuild` / `ledger_backfill` / `progress_upsert` / `doc_emit` 四处写入共用；批量写失败隔离（跳过并记录，不整批 abort）；`librarian_patrol` 闸门与 `--dryRun` 统一走 `scanNeedsLibrarian()`。**`fakeStorageDomain` 已复刻真后端 `SAFE_KEY_RE` 校验**（非法键即抛），另有 keyOf 纯函数单测（中文任务号 / Windows 绝对路径 / 含冒号或空格的 project 名全部匹配 `^[a-zA-Z0-9_-]+$`）—— 见 `scripts/verify.sh` 第 19、28 项 |
| **M2.5 ✓** | 检索 L0 + 阶梯 | `doc_search` 可用（L0 台账过滤 + snippets + score + hitReason + suggest 建议）；检索阶梯 L0~L4 写进**每个**角色卡且顺序可断言；索引订阅 `domain/changed` 节流更新（200 事件 / 5s，幂等，与 rebuild 一致）；文档目录分类配置同步（`archiveDir` / `docKinds` / `doc_misfiled`）—— **`scripts/verify.sh` 40 项全绿，见第 34~37 项**。**未做**：`librarian/ask.js`（M2.5 交接单 `docs/M2.5.md` 的四项交付物里没有它；§7 本行原先写的「馆员检索答疑上线」与本单冲突，按 M2.5.md 执行并在此标注） |
| **M3 ✓（B 方案收口）** | 面板（独立 tab） | 交付物 1/2/3 全部落地，`scripts/verify.sh` 42 项全绿（第 38、39 项）。数据源改为宿主**现成**通道：`ctx.remote.session.list`（血缘/运行态）+ 逐会话 `remote.session.projections`（label/mode/模型），**不引入 typert、不自造 IPC**；能现算的徽章 = 契约（子智能体 ✓）与异源（adversary 与同层 implementer 模型对比）；**三档/进度徽章与 docs/tasks 计数显示 `unknown` 并显式标注「数据源待接」**；3.3 开关读回 best-effort（写侧 `pluginToggles`，读侧缺公开 API）标为部分完成。client 入口为**经典脚本**（`window.__ModuleLoader__.load` + CJS factory），已按宿主加载方式在沙箱验证 |
| **M4 ✓** | 审计 + 图书管理员 | `scripts/verify.sh` 46 项全绿（第 40~43 项）。①`audit_scan` 12 项检查全部**正反用例**、警告制（跑前后目录快照一致、不抛错、不改文件）、未知 `audit.checks` 项**报错**、`legacy`/`tier=0` 不参与 `doc_meta_missing`、`[Agent进度]` 不误报 `unfilled_slot`；②馆员一轮治理（`librarian_sweep`）：待办清单 + 命名规范化 + 去重归档 + 核心数据库/坑库索引 + 术语表缺口，幂等、`dryRun` 不落盘；③**归档分片定稿为时间分片** `archive/<YYYY-MM>/`，阈值 `audit.archiveAfterDays`（默认 90 天），归档动作（移动 + 留痕 + 更新引用 + 台账同步）由 `librarian_archive` 执行；④面板徽章接真审计：host 写出派生快照 `<project.root>/.agent-contract/panel.json`（带 `schemaVersion` + `generatedAt`），client 经宿主现成的 `remote.workspaceFiles.read` 读回，版本不匹配即降级 `unknown`。**未做**：`librarian/ask.js` 未单独建模块（其职责由 `doc_search` 直接承担，M2.5 交接单也未列该交付物） ⑪ **核验轮修复（2026-10-03）**：FIX-19 改名不再重复前置任务号（按已知任务号精确剥离 + 幂等 + 重复前置拦下只报）／FIX-17 成员改按 `sessionId` 建键 + 快照 `membersById` 主索引（`schemaVersion`→2）／FIX-18 `FIX-6` 标签接回套件（可检索）／FIX-20 徽章恢复「符号 + 文案」并覆盖五态／FIX-21 快照带审计清单（路径+原因+建议）+ 面板红黄摘要条与可展开清单；FIX-26 核心数据库**真身唯一 + 派生物分家**（changelog 只写真身、索引独立文件名并自述派生身份、错位同名档只读不写）；**FIX-22~29（覆盖事故防线 + 面板可用性）**：写前备份并失败即中止 + dryRun 三类明细、索引只在标记区块内合并（`+N/-M`、删行列出、两遍幂等）、退化告警挂卡片 tooltip + ⚠ 角标、馆员 tags 步骤（只增不删 + 盖章）+ 审计建议指向真机制、`failed` 分支也有审计条、徽章 `名+符号` + sticky 列头 + 常驻图例、列表下方待做任务区（快照 `todos[]` + md 子集只读渲染）；**FIX-30/31/32**：产出工具同名重发接备份闸门（`overwrote` 可见、`progress_upsert` 豁免并写明理由、观察项 `doc_overwritten` 只记录不告警）、待办/审计**点行跳会话**、`stale_progress` 时间比较补 `MTIME_TOLERANCE_MS` 容差（终检回归）；**FIX-39/40/41（面板自更新 · 两类待办分区 · 首次可写）**：快照挂 `domain/changed` 节流自更新（沿用上次审计并标 `asOf`，无数据写 placeholder）、A 区大方向待办与 B 区 agent 执行队列各自独立、A 区可勾可编（唯一可写目标 + 行级翻转 + 写前备份 + 指纹冲突 409 + 状态明示，写通道走宿主 HTTP 路由）；**FIX-42/43**：跳转后把 tab 补进目标会话域、面板撤掉说明性文字（能力不减） ；**FIX-57/58（"通用引擎"的最后一块）**：套件从"写死 Blockdustry"改成**自适应规则 + 形状一致性**校验（换任意项目仍绿、故意制造不一致必红、设计值不随项目变），插件从"一实例一项目、换项目手改配置"改成**零配置自适应**（根随工作区/会话、结构按候选清单探测既有目录、探不到自建默认结构且只新建不覆盖、`project_init` 默认 dryRun 预览、`project.json` 随项目走、一个实例服务多项目且账本/索引/快照按项目分域不串）；**FIX-59（"没报≠合格"）**：派单即记账**生效模型**（六源解析链，继承默认也有 model）、审计 `cross_vendor` 写出两边模型名、缺数据时新增观察项 `cross_vendor_undecidable`「无法判定（缺模型数据）」、徽章同步不再把"没报"渲染成 ✓ —— **套件 116 项全绿** |
| **M5** | 端到端 | 用一批真实迁移任务跑通：研究→实现→审查→对抗审查→修复→收档，全程审计黄绿可读 |

---

## 7.5 未闭合项清单（每次进入下一里程碑前先看这里）

| 项 | 状态 | 说明 |
|---|---|---|
| MIGRATE 存量归位（22 篇） | ⏳ 待执行 | 单子：`docs/MIGRATE.md`（只移动不改名；判不准留原地进 needs_librarian） |
| C4 闸门空转核验 | ⏳ 需干净工作区 | 当前 `子agent/` 100+ 篇 legacy，前提天然不成立 |
| 3.3 面板开关读回 | ⚠️ 部分完成 | 写侧按 `pluginToggles`；读侧无公开 API，暂 best-effort |
| M5 端到端实跑 | ⏳ 待 | 面板 + 审计就绪后才跑 |
| 两个 `T99…-reviewer` 节点 | ✅ 已定位（FIX-17） | 确为**同名多轮派单**（sessionId 各不相同）；此前台账按成员名建键，把三条压成一条 → 已改为按 `sessionId` 建键 + 快照 `membersById` 主索引 |

## 8. 工程约定

- ESM 直写、**无构建步骤**；不改 `dist/lib` 之类产物
- 命名：成员 `<任务号>-<角色>`（kebab-case）；文件 `<任务号>_<标题>.md`
- 注释、文档、面板文案**一律简体中文**；**只用官方术语**（子智能体/成员/主代理）
- 无 emoji（面板图标用主题色 glyph / FA 风格矢量）
- 每个里程碑必须让 `scripts/verify.sh` 覆盖新增逻辑（可在 `scripts/verify.mjs` 内追加断言；需要真实文件系统时用 `mkdtemp` 临时目录并在结束时清理）
- 日志：用 dsh 的 `logger`/`ctx` 能力，禁止 `console.log` 污染宿主输出（工具 `presentCall` 之外的 UI 输出走面板）
- 提交粒度：一个里程碑一组改动；改动后更新 `README.zh.md` 的进度与本节表格

---

## 9. 禁令与已知坑

> **编号纪律（2026-10-03）**：本条清单**只追加、不重排**（外部文档按号引用）。历史遗留的同号条目以 `NN-b`、`NN-c` 后缀区分（同族但后追加）。


1. **禁止**装回 `@deepseek-ai/dsh-experimental-agent-team-profile`（会禁 `tool-subagent-control` → 续聊/血缘断链）
2. **禁止** fork 或改写 `dsh-better-sidebar`；只通过 `ctx.betterSidebar.registerTab` 扩展
3. **禁止**把任何项目路径写死在代码里（一切走 `resolveProject()`）
4. **禁止**跨层 `send_message`（相邻寻址）；跨层只能靠文档转贴
5. **禁止**假设 one-shot 子智能体可以被二次唤醒（跑完即释放）
6. 子智能体权限与主智能体平权 → "共享文件只归主代理写"是**纪律**，靠契约 + 审计，不靠机制
7. 子智能体写入受**会话工作区**限制 → 未把工作区指向项目根时，产档会失败（落地检查项）
8. 深度上限来自 profile（`maxDepth: 3` = 根+3 层 ≤4，正好对应总纲"≤4 层"）；不要自行提升
9. 预算按**字符**计；不精确换算 token（宿主已有 dsh-context 做真实计量）
10. 不要 emoji、不要繁体、不要把"子代理/子agent"写进面向模型的文案
11. **有产出义务的角色，`tools` 必须含 `doc_emit` 与 `progress_upsert`** —— 否则"产出研究档并落盘"这条契约在**工具面就不可满足**（核验 C6 实证：researcher 回带"doc_emit 不在我这一层的工具白名单里"，最后靠主代理代劳）
12. **任务切面禁止搬运任务文件正文**（含"截断到 N 字"的变体）——只有"路径"才是注入内容；核验 B7 实测 task 段常驻 2150 字，除 mandate 外合计 2915/3256 > 2500 预算，属"搬运失控"
13. **停用词表要足够宽**：`研究/产出/只读/docs/md/png/文件/仓库/待办/任务` 一律不得作为切片命中原因（核验 B7-g 实测只拦了 `docs` 一个）
14. **front-matter 必须往返一致（round-trip）**：列表值（`relatedFiles` 等）按 `- ` 行解析，**不得**按第一个冒号切分——核验 C5 实测含 `D:\...` 绝对路径的列表被写坏成 `relatedFiles: null` + 孤立行
15. **核验期行为规则**：核验**不得**改动运行时状态（清空/重建台账等）或既有项目文档；需要"干净前提"而拿不到时 → 标**未核验 + 原因**，不许自造前提（核验 C5 曾自行清空台账后还原、并往 `核心数据库.md` 追加记录——本次接受并保留该记录，但此后按本条执行）
22. **禁止把 `ctx.tools.schemas()` 当"宿主工具目录"**：在插件自己的上下文里它**只枚举到本插件注册的工具**（实测：据此剔除，把 `read/write/edit/glob/grep/pwsh/todo_write` 全剔光 → 子智能体"能派活、不能干活"，比报错更危险）。规则：**默认 fail-open**（声明的名字原样下发），终端工具按平台**解析成单个正确名字**（win32→`pwsh`，其他→`bash`）而非靠剔除；只有在能拿到**权威**目录（须写明来源）时才允许校验
23. **委派回执必须渲染 `warnings`**：只打印"已派出…契约 N 字"会让"已剔除：read、write…"这类 warning 完全不可见（实测盲区）
29. **修复项与既有实现冲突时，以本文件原文为准，并标注"反转"**：本次实例——某轮按"去符号只留颜色"改了徽章，与本文件 §5.6 功能点 4「契约✓ · 三档✗ · 预算超限⚠」冲突；正确做法是**回到本文件**并在断言注释里写明这是反转（不许悄悄改口径）
36. **解析既有文件禁止依赖字面格式**：人工维护的文件标题/命名**写法不受我们摆布**（实测：真身标题是 `## 九、变更日志（由执行方/馆员追加；历史行不改写）`，若只认字面 `## 变更日志`，下次写入会在末尾**另起平行章节**把账劈成两半；子区边界同时要认 `###` 与 `##`）。规则：**宽容匹配**（关键词出现在任意层级标题内即命中）+ **用真实样本做纯内存预演**（先在真身 580 行输入上跑一遍，确认"行数+1、丢历史 0、章节数仍为 1"再落盘）
39. **不得信任派生缓存里的过期字段**：命名/解析/展示一律以**当前文件 + 权威 front-matter**为准；台账等派生缓存里的旧值（如陈旧的 `title`）只能当提示，**不可作为拼装依据**——实测：`planNaming` 读台账陈旧 `title` 拼出重复任务号形态，跑一轮就会污染 4 篇
40. **守卫按语义判，不按字面**：防重复前辍这类守卫不得只匹配"字面双份"（`taskId_taskId`），要按**语义**判——"剥离已知前缀后剩余部分是否仍以该前缀开头"；否则形态一变就绕过
38. **领域版本号策略（依据宿主 `storage-domain/spec.ts`）**：① **增量字段（带默认值、向后兼容）不递增** `version`（旧记录读到即补默认值，实测正确做法）② **破坏性结构变更必须递增** `version` **并在 `compatibleVersions` 里列出旧版本**——宿主对 `version` 不匹配的记录会 `version-mismatch` **丢弃**，列出旧版本才会读；**写入永远盖新版本** ③ **绝不允许"只递增、不列 compatibleVersions"**（等于丢数据）④ 领域名不变就不会另开领域
37. **断言用"旧行逐条仍在"而非行数**：行数会因结构行（子标题/空行/占位句）变化而误导；"历史行逐条仍在"才是硬证据（FIX-26 已采用）
35. **真身是唯一历史账本，按子区分写**：核心数据库真身的变更日志分「迁移批次」与「**文档治理记录**」两个子区；馆员动作（命名/引用/回滚/复核）**全量**记入治理子区，**不得只记结果不记动作**（否则只看到"回滚"却看不到"改过什么"，历史断链）
34. **核心数据库：真身唯一，changelog 只写真身**：`仓库/docs/核心数据库.md` 是唯一权威（MIGRATE 后移入 `核心数据库/核心数据库.md`）；派生态索引**不得复用真身文件名**（否则"哪个是真的"无法分辨，实测出现过两份同名文件、changelog 写到副本而真身空白）
32. **审计建议必须指向已有机制**：每条审计项的建议要么对应一个**可执行**的动作（工具 + 参数），要么明确写"需人工处理（当前无自动机制）"——**禁止给出无法执行的建议**（实测：`doc_tags_stale` 建议"由产出者或馆员更新头部"，但产出者与馆员都没有对应步骤，告警天生无解）
33. **任何对档的合法写都要盖章**：改了档（哪怕只补一段引用）就要写 `librarianTouchedAt`/`librarianChanges`，否则审计会把它记成"未盖章的改动"，并在下次审计里刷出噪声告警
31. **"台账可重建"有边界（修正）**：`ledger_rebuild` 能从磁盘重建 `docs`/`tasks` 与**派生成员**，但 **members 的实时身份（`sessionId` / `status`）只活在宿主 `storages` 里**，磁盘上没有 → 清空领域目录会丢失这些记录（`membersById` 归零），且 `storages` 在 `~/.dsh`、**不在项目 git 覆盖范围**。故：**清理前必须先备份 storages，并接受"所有节点退化为按名匹配"**；不得把"可重建"当成"随便删"
30. **台账是缓存，键必须稳定唯一**：成员/文档等记录键用**稳定 ID（如 `sessionId`）**，名字只作退化路径；按名建键会让同名多轮成员在**存储层**被压成一条（后到覆盖先到）。升级后如残留旧键记录，可清空领域目录后 `ledger_rebuild` 重建（不变量"members 绝不删除"仍成立）
28. **索引/派生物不得整篇重写既有文件**：目标文件已存在时**必须"保留人工段落 + 指定区块内增量合并"**（例：只在 `## 索引` 表里补行）；dryRun 显示 `+N/-M`，**删除行数 > 0 时必须列出被删内容**并要确认；同一索引跑两遍必须幂等。实测教训：整篇重建把 34 行的人工索引（任务类型对照表 + 使用规则）压成 20 行机器列表
26. **覆盖既有文件前必须先备份（硬规则，含豁免）**：任何会**改写/覆盖既有文件**的动作（索引重建、命名规范化、归档、格式直修、回填、tags 复核、changelog 追加、引用改写、`doc_emit`/`bugfix_note` 的同名重发），写前必须把原文件复制到 `<项目根>/.agent-contract/backups/<时间戳>/<相对路径>`；**备份失败即中止该文件的写入**（返回 `ok:false` + 记 warning，绝不在没有退路的情况下覆盖）。`--dryRun` 必须列出三类明细——**将覆盖**（含旧指纹 sha 前 12）/ **将新建** / **将改名**，且每条带 `+N/-M`、`-M>0` 时列出被删内容（见 §9-38）。覆盖类写入要在返回值里标 `overwrote: true`，让"覆盖"成为**可见事件**（§9-41）。**豁免：`progress_upsert`**——它是**活态单写者文件**（实时推进、≤400 字、高频改写），其历史由**会话记录**承载，逐次备份只会产生无价值副本；豁免理由必须写进文档与代码注释，否则后人会当成漏接。实测教训：一轮授权治理覆盖了 `坑/README.md`（无 git、无备份 → 内容不可恢复），并因改名 bug 污染了 4 篇档名
27. **派生物必须自述身份**：由馆员/审计生成的文件（索引、快照、核心数据库派生态）必须在头部写明"派生物，可重建"与生成时间；**不得**把派生物写进既有文档所在的类目录而造成"哪个是真的"混淆（实测：派生物 `研究/核心数据库.md` 与真身 `仓库/docs/核心数据库.md` 重复）
25. **"服务名"不是"工具名"**：`roles[].tools` 只能写**真被挂载的工具**。实测 `session_search` 在本机没有任何 bundle 挂载（只有 `session-query-sqlite` 服务）→ fail-open 下写进白名单会**硬失败**。检索阶梯（§5.5 L0~L5）是**纪律文案**，不构成工具授权；二者不得混用
24. **测试 fixture 不得假装是权威目录**：把"宿主工具目录"手写成 fixture 塞进 `ctx.tools.schemas`，会让"剔除越权"永远测不出来（fixture 撒谎）。回归位应断言：**空/不完整目录下不得剔除任何声明名**
21. **终端工具名按平台互斥对声明**：base bundle 里 `tool-bash` 与 `tool-pwsh` 互斥（win32 只有 `pwsh`）→ 插件不得写死 `bash`；工具白名单下发前必须用 `ctx.tools.schemas()` 求交集，未知名剔除 + warning（交集为空则跳过白名单；枚举不到则 fail-open + warning）
19. **运行版本必须可核对**：插件需暴露 `pluginVersion` 与**已注册工具清单**（`contract_status` 输出或随快照写出）；运行时核验前先比对"工作树 vs 运行中宿主"，不一致即标**未核验（版本漂移）**——实测过一次失真（宿主加载旧版，B 组证据全废）
20. **空态三分类，不许混**：面板空态必须区分 `数据源为空` / `过滤后无可见节点` / `加载失败`；把"数据源为空"写成"过滤后无可见节点"会直接带偏排查
18. **面板的 mode / status 只用权威来源**：子智能体的 `mode` 必须读 `subagentCatalog` 投影（与宿主 UI 同源）；**禁止**用 `agentAvailable` 之类近似推断（实测：已结算的后台成员被误判成 `one-shot`，再被默认过滤 `hideDoneOneShot` 吃掉，"可继续"成员整片不显示）。投影缺失 → `unknown` 且**默认可见**；面板空态必须给「显示全部」自救入口（不依赖 prefs 读回）
17. **工具名以宿主为准，且装配期必须校验**：`roles[].tools` 里的名字若不存在，`tools.restrict()` 会让 **start 直接硬失败**（实测 `unknown global tool "bash"`，本 Harness 终端叫 `pwsh`）。规则：① 名字逐个对照宿主真实工具目录；无法确证的一律删 ② 委派前求交集，未知名 **剔除 + warning**，不得硬失败
16. **canonical 套件必须能免 bash 运行**：dsh 沙箱禁命名管道，Git Bash/WSL 均 `couldn't create signal pipe` —— 需提供纯 Node 入口（`node scripts/verify-node.mjs`），`verify.sh` 退化为薄包装
29-c. **有 id 的实体，索引里就必须有 id**（FIX-17 = 报告 FIX-27）：成员记录曾按**名字**建键 → 同名多轮成员在**存储层**就被压成一条（后到者覆盖先到者，旧会话 id 丢失），面板自然"串徽章"。规则：`members` 逻辑键 = `sessionId`（派生成员退回名字）；快照出 `membersById` 主索引；client 按 sessionId 取，**按名退化必须留痕**。教训：**"同名"不等于"同一个"**
30-c. **合规徽章必须"符号 + 文案"**（FIX-20，§5.6 功能点 4 的原口径）：只靠颜色区分 = 灰度/色觉障碍下不可读，且状态集合会退化成"看得见的两个"。四类符号两两不同（`✓ ⚠ ✗ ?`）+ 中文状态词随行渲染，颜色只作辅助；状态集合覆盖 `running/idle/completed/failed/released`
31-c. **审计结论必须有界面入口**（FIX-21）：只把红黄计数做进徽章 = 用户「都没看到」。快照须带 `items`（路径 + 原因 + 建议，与 `SUGGESTIONS` 同源），面板常驻摘要条 + 可展开清单；**血缘为空时同样可见**（那时最需要它）；快照未到时写"数据源待接"，不得写 `0 红 0 黄`（等于谎报全绿）
32-c. **文档名反解按"已知任务号"剥离前缀，禁止按第一个下划线猜**（FIX-19 = 报告 FIX-29）：任务号含下划线（`T-800_A`）时，"首个下划线"把标题切成 `A_报告与结论`，拼名时又前置完整任务号 → `T-800_A_A_报告与结论_L3.md`，**每轮治理继续扩散**（已污染 4 篇）。规则：`startsWith(taskId + '_')` 精确剥离；改名**幂等**（新名 === 原名直接跳过）；新名不得是 `taskId_taskId…` 形态（撞上**只报不改**）
36-c. **面板徽章必须"念得出来"**（FIX-28）：格子里写 **`徽章名 + 符号`**（`契约✓`），列表**列头 sticky 常驻**并列出五枚固定顺序，底部**常驻一行**五态符号图例。验收是"**不看 tooltip** 也能说出哪枚是哪个、什么状态"——只给符号（看不出是哪枚）或只给彩色文字（看不出状态）都不算过
37-c. **列表下方不留白：待做任务区**（FIX-29）：快照带 `todos[]`（未结任务 / 审计红黄 / 缺失产出，每条带 `path`，红在前，与 `audit_scan` 同源）与 `paths.todoFile`（由 host 算**绝对路径**，绕开"client 拿不到项目根"的鸡生蛋）；client 用**自实现的 md 子集**渲染待办原文（零依赖零构建），**只读**、超长截断（默认前 ~80 行）+ 可展开、空则「（无待办）」
40-c. **能跳的行才给"可点"的样子**（FIX-31）：待办行/审计行由 host 解出 `sessionId`（成员名 / 文档 owner / 任务 owner → 成员），**解不出来就是 `null`**，client 不给手型光标与点击——宁可不可点，也不要点了跳到错的地方；审计清单等级用**整行着色**表达（不在行首拼 `[红]/[黄]`）
41. **产出工具的"覆盖"要可见**（FIX-30）：`doc_emit` / `bugfix_note` 同名重发走备份闸门（目标不存在则跳过备份，不留无谓副本），返回值带 `overwrote: true` + 旧版备份路径，并把覆盖次数记进台账（`overwriteCount` / `lastBackupPath`）——覆盖是**替换知识资产**，主代理必须看得见。审计另设**观察项** `doc_overwritten`：`level: 'info'`、**不进 `audit.checks` 开关、不计入红黄统计、不配建议动作**，只记录不告警
42. **同类时间判据必须共用同一容差**（FIX-32，终检回归）：`stale_progress` 曾把文件系统 `mtime`（可能被截断到秒：FAT 2s / 网络盘 / drvfs）与内存里的**毫秒级挂钟** `lastActiveAt` **裸比**，于是"刚写完的进度档"被假报 stale、端到端随机变红。规则：**任何 `mtime` vs 元数据时间戳的比较都要带 `MTIME_TOLERANCE_MS`（2s）**，与 `doc_tags_stale` 同源；容差只吸收时钟/精度抖动，真过期（超容差）照报
43. **改名只信"文件名 + 权威 taskId"，不信台账 `title`**（FIX-32，治本）：`doc.title` 是**派生缓存**，可能残留旧口径（"第一个下划线"）的脏值——拿它拼新名会把**本来合规的档**判成"该改名"（真机实测：4 篇 T99 档被一轮轮要求改名）。规则：`basename` 以权威 `taskId + '_'` 开头时才从**文件名**推标题（剥前缀 → 切 `_L1|_L2|_L3|_fix`）；名字里没带前缀（如 `乱七八糟.md`）才退回台账 title（那是唯一线索）。**重复前置是语义判**：剥前缀后标题仍以 `taskId_` 开头 → **拦下只报不改**；重算的标题要**回写台账**（治本，且必须在去重之前——去重也按 title 分组）
45. **派生快照必须能自证"陈旧"**：`schemaVersion` 相同但**字段缺失**（旧代码写的快照）会导致 client 静默显示 `0`/空列表（实测：面板"派生 0 条"）。规则：快照带**写入方插件版本**或**字段完备性标记**；client 把"版本不匹配 / 关键字段缺失 / 快照版本低于运行时"一律判为**陈旧**并显示"数据源待接（快照陈旧）"，**不得把缺失渲染成 0**
44. **写入预演的每一项都要有行数差**（FIX-33）：`将覆盖`/`将新建` 项必须带 `+N/-M`，`-M>0` 时**列出被删内容**；行数差**算不出**的（如 changelog 追加，条数取决于本轮动作）要如实写"取决于本轮动作"，**不得用 `+0/-0` 冒充"没有变化"**；预演只列**本轮真会写**的文件（不该虚报别处工具的目标）
45-b. **工具回执必须是 lossless JSON**（FIX-34，阻断级）：对象里只要有一个 `undefined`，宿主就会以 `value is not lossless JSON` **整条拒收回执** —— 写盘明明成功，调用方却什么都拿不到（实测 `librarian_sweep` 连两轮）。规则：可空字段一律给 `null`（写入结果统一走 `writeOutcome()`），脚本里对真跑回执做递归无损检查（`undefined` / 函数 / 非有限数 / `Map`·`Set`）并断言 JSON 往返不丢字段
46. **派生物必须字节级幂等**（FIX-35）：时间戳（「最后更新」）**不参与**"内容是否变化"的判定 —— 否则每轮都因时间戳变而整文件重写 → 每轮多备份 + `坑/README.md` 长期挂 `git status` 的 M。规则：先比**不含时间戳**的内容指纹，未变则**整文件不写**（时间戳保持上次真实变更值），内容真变才写并刷新；中性化只吃时间戳本身，那一行的其它文字仍参与比较
47. **陈旧快照必须能被识别，缺失绝不渲染成 0**（FIX-36）：快照要带**写入方 `pluginVersion`**；client 三条都查——`schemaVersion` 不匹配 / **关键字段缺失** / 写入方版本旧于本 client。命中即判**陈旧**：显示"数据源待接（快照陈旧，触发一次审计即可重建）"，`todos` 给 **`null`（未知）而非 `[]`（0 条）**，审计条给 placeholder。实测：`schemaVersion` 相同但缺 `todos`/`paths`（旧版插件写的快照）→ 面板静默显示「派生 0 条」，真值 83 条。client 硬编码版本须与 `package.json` 逐字一致（套件有断言）
48. **面板上的聚合数据要写明范围**（FIX-37）：审计/待办来自**项目级派生快照**（按项目根定位、同工作区内所有会话共享同一份），面板必须写一行「项目级，同工作区内共享」——否则用户看到"新对话里审计与另一对话一模一样"会误以为串了
49. **面板数据必须能自己刷新**（FIX-38）：**只在挂载时读一次**是不行的 —— 宿主重建 `panel.json` 后（审计/台账变更）面板不重读，用户只能重开 tab。规则：① 可见时**轮询**（默认 30s），且**只重读快照**（几 KB；不重拉 session 列表与投影那类昂贵调用），页面隐藏即跳过、卸载 `clearInterval`；② 面板给**手动「↻ 刷新」**（整轮重载：血缘 + 快照）；③ 三条路径（挂载 / 手动 / 轮询）**共用同一份"落状态"口径**，别各写各的
50. **跳转后要把本 tab 补进目标会话域**（FIX-44）：better-sidebar 的 tab 是**按会话分域**的（`openTab(seed, scope)` 的 `scope` 决定落到哪个会话的 store），而我们这枚 tab 只开在当前会话域 → 跳到别的会话后侧栏渲染目标的 tab 集合、里面没有它，用户看到的就是"侧栏被关掉了"。规则：`uiWorkspace.openSession(id)` 之后立刻 `openTab({ type: TAB_TYPE_ID }, { sessionId: id })` 补进目标域（同 type 已存在时宿主会 id 兜底 focus，不会重复开）；`TAB_TYPE_ID` 必须与 descriptor 的 `id` **共用同一常量**；补开**全程静默**（拿不到服务/旧版 API 都只退化，绝不影响跳转）
51. **面板数据不由"审计"驱动**（FIX-39）：快照原先只在 `audit_scan` / `ledger_rebuild` 两处重写 ⇒ 形成「想看待办得先跑一次审计」的别扭因果。规则：挂 `domain/changed`（三个领域任一变更，即派子智能体 / 落档 / 进度更新）→ **节流**（窗口合并 + 攒够事件立刻写）重写快照；非审计触发的重写**沿用上一份的 audit 块**并标 `asOf`，没有可沿用的一律写 `placeholder`（面板显示"数据源待接"）——**绝不用 `0 红 0 黄` 冒充"全绿"**；审计回归为"数据来源之一"，不再是刷新面板的唯一入口
52. **两类待办不许混在一格**（FIX-40）：**A · 待办任务（大方向）**= 配置里那个待办文件的**原文**（给人看的路线图），可勾可编；**B · agent 待办（执行队列）**= 未结任务 / 缺失产出 / 审计红黄（机器算的执行层条目），可点定位、**不渲染 md 原文**。两块各有**独立的折叠位与空态文案**；快照里**不得混入待办文件正文**（所以"只改文件"只动 A，"只发生执行层变化"只动 B）
53. **面板默认只读，唯一可写目标是待办文件**（FIX-41）：A 区可勾选（**行级翻转**：只翻那一行的 `[ ]`↔`[x]`，注释/缩进/顺序/其它条目一字不动）、可编辑保存。护栏八条：① 写通道**只认** `panel.todoFile`，别的路径一律 403；② 写前**备份旧版**（失败即中止）；③ 请求带 `baseHash`（client 渲染时那份内容的指纹），与当前文件不符 → 409 提示刷新重试，**绝不覆盖**；④ 保存成功/失败/冲突**都在面板明示**（不许静默）；⑤ 写通道走宿主自注册 HTTP 路由（§5.6 备选 (b)），读仍走只读 remote；⑥ 路由带 **Host 回环栅栏**（同 better-sidebar trust-fence 语义：DNS-rebinding 防御）；⑦ 指纹算法两边**共用同一实现**（client 与宿主各一份 FNV-1a，靠交叉断言防漂移）；⑧ B 区与审计区**仍只读**
55. **尾换行差异不许误报冲突**（FIX-42，根因在宿主 `cutPage()`）：宿主 `remote.workspaceFiles.read` 的 `cutPage()` 在文件以 `
` 结尾时**吃掉尾换行**（收尾 `if (current.length > 0) complete()` 不 push 尾空行），
    而本地写路由用 node `readFile()` 保留它 ⇒ 两侧指纹永远不同、**未改动也每次 409**。规则：**比指纹前先归一化**（`normalizeHashInput()` 去掉全部尾部 `
`/`
`，两端实现逐字一致并有交叉断言）——`hashOf()` 是唯一入口；
    保存时用 `preserveTrailingNewline()` 保住文件的换行约定（client 读回来的文本天然少一个尾换行，不能因此把它删掉）。已知代价写明：**只在文件末尾增删空行**的外部改动检测不到（值此价：误报会把正常操作整条堵死）
56. **文案不许声称界面位置**（FIX-43）：提示里写「面板右上「↻ 刷新」」而按钮实际在顶部左侧 ⇒ 改成不依赖位置的说法（「点顶部的「↻ 刷新」」）。界面一变位置就过期，可操作线索只说**叫什么**，不说**在哪**
57. **待办的读取与哈希必须同源**（FIX-45，真机假冲突治本）：冲突校验比的是"client 读到的文本" vs "宿主 `readFile` 读到的文本" —— 只要两条读路径有任何差异（尾换行、截断、BOM…），**未改动也会每次 409**。规则：**面板的待办读取也走宿主那条路由**（同一条 POST 路由的 `action: 'read'`，读与写同一个动作面、暴露面不变；GET 仍 405），client 只显示、不自己算 `baseHash`；拿不到权威指纹就**不发写入**（宁可"编辑不可用"，也不拿别的读法去比）。409 必须回带 `actualHash` + `actualLength`，一次对比即可定位这类差异
58. **验收口径按"实际链路"写准，别拿单一数字验收**（FIX-47）：快照链路 = 宿主 ≤2s 写 + 轮询 20s ⇒ **待办/徽章最坏 ≈22s**；成员树来自血缘、走**低频整轮重载**（每 3 拍 ≈60s，或用户点「↻ 刷新」立即）⇒ **成员树 ≈60s**。轮询以"只重读快照"为主，整轮重载是低频（重拉会话列表 + 逐会话投影最多 20 个请求）
59. **文档切片默认不附引文 + 单独设预算**（FIX-48）：切片只给 路径 + 命中原因 + readHints，正文让子代理按 readHints 自己去 `read`（禁搬运纪律）；例外通道收紧为"**强信号词 ≥2 且排进 Top-2**"，引文 ≤200 字符；切片段单独设 **≤1200 字符**预算，超限就整体丢引文。预算守卫必须**可注入预算**（`fitSlicesToBudget()`）——够不到的守卫等于摆设
60. **"到处都是"的词不配当命中原因**（FIX-50）：命中 ≥3 篇的词（**项目名**是典型）不得作为命中原因；一片里强信号词一个不剩就**不召回**它（宁缺勿滥）。命中原因取**最有区分度的 2~3 个**（按"命中文档数"升序、再按词长降序）。停用词补充遵循**单据内部冲突的裁决**：修法①把 `write/read/edit` 列为英文泛词，而验收②明确"工具名有区分度、不该被剔" ⇒ **按验收走**（工具名保留），确实嫌吵的项目用 `search.stopWords` 自己加。项目名从 `config.project.name` 自动进停用词（含紧凑形式）
61. **升级后不需要人工动作**（FIX-51）：插件启动时比对"现有快照的 `pluginVersion`"与"当前插件版本"，**不一致或快照缺失就直接重写一次**（沿用上次审计结论）—— 这个坑已经踩到第三次（0.3.3→0.3.4、0.4.0、0.4.0→0.4.1）。同时**失败原因必须具体**："没去读"要写成"快照未提供待办文件路径（陈旧或未生成）+ 怎么办"，**禁止**用"未知原因"把人晾在原地（与 §9-20 的空态三分类同源）
62. **设置页用宿主官方机制，不自造存储**（FIX-52）：分栏走 `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id, order, label, inject }, Component))`，值走 `ctx.configForms.get(<插件行 id>)`（`{getSnapshot,subscribe,set,unset}`）；`base` 是**底层**、`user` 是设置页那一层 ⇒ 「恢复默认」就是 `unset(field)`。
**裁决 B（2026-10-03）修正了口径**：宿主只允许写 **`schema.meta.volatile`** 的字段，而 volatile 字段**不参与配置文件解析**（实测：值被投影成 `{}`；投影后的值再进 schema 会 `TypeError: Cannot assign to read only property`）⇒ **"设置页可写"与"配置文件当默认层"不能并存**，于是改成按**键分组**管理喵：
- **设置页管（volatile，默认值写在 schema 的 `.default()` 里）**：`modelRoutes`（默认 `{adversary:'glm-5.3-flash'}`）＋ `panel.{hideDoneOneShot,autoRefresh,pollSeconds,defaultView,badgeLabels}`
- **仍归配置文件**：`project.*` / `paths.*`（含 `panel.todoFile`）/ `delegation.*` / `roles` / `budgets` / `audit.*`
- 配置文件里被接管的键**只作示例**（已注释并标注"由设置页管理"）—— **不许留未标注的失效值**
- **空对象/缺键 = 继承默认**（`channels.js` 的 `mergeModelRoutes()` 兜底 + 断言），绝不许"真异源静默失效"；
  客户端保存时对"空对象/缺键"发的是 **`unset`**（回落到默认）而不是把空值写下去
- **只解析一次**：volatile 投影过的 config **不得**再进 schema（插件代码里禁止出现 `Config(` 二次解析，套件有断言守着）**禁止**自造存储（旧通道 `settings.pluginToggles` 读不回来，已弃用）
63. **「调用 JSON」必须白名单 + 密钥红线**（FIX-52）：可改的顶层键**只有** `modelRoutes` / `panel`（路径、审计阈值这类要重建数据的配置仍在配置文件里，拒绝时要说明这一点）；模型值**字符串（模型名）与对象（provider/model/reasoningEffort/maxTokens）两种形态都吃**；键必须是内置角色 id。**密钥红线**：任意深度出现 `apiKey`/`key`/`token`/`secret`/`password`/`credential` 这类字段名一律拒收并提示"密钥由宿主/provider 账户持有"（凭证绝不进配置文件或设置存储）。校验器是**纯函数**（每条拒绝路径都能断言），错误必须**指到具体路径**
64. **面板开关与设置页是同一份值**（FIX-52）：面板的 prefs 不再用 `defaultPrefs()` 硬兜底（那会把设置页的值永远盖住），而是"tab 级 prefs → 设置页 → 内置默认"；面板内的「显示全部/恢复默认过滤」要**写回设置**（双向一致、重启后保持）；轮询间隔/总开关/默认视图/徽章文字标签都从设置页读；设置页的草稿在表单推送时不被冲掉（`dirty` 守卫）
65. **模块级组件不许跨作用域抓变量**（FIX-53，真机阻断）：`NodeRow`/`TopologyView` 这些**模块级**组件看不到 `ContractTab` 里的局部变量（如 `settings`）—— 真机表现为 `settings is not defined` → 面板**整块崩**。规则：需要的值一律**由调用方经 props 传下去**（`badgeLabels` 就是这么修的）；套件里有**跨作用域扫描**（只看代码、跳过字符串字面量，防误报）
66. **client bundle 必须有渲染冒烟**（FIX-54）：只验"能加载并注册"抓不到渲染期的 `ReferenceError`（`verify.mjs` 以前从不真渲染一次，与 FIX-11「静态绿 ≠ 运行时可用」同族）。规则：假 props **真渲染一遍**（列表 + 拓扑 + 徽章行 + A/B 区都走到），任何 `ReferenceError`/`TypeError` 判红；并且**把已知 bug 还原回去时冒烟必须红**（负控常驻，否则这条冒烟等于没接）。冒烟要自己**展开函数组件**（假 React 只造元素不调用组件）
67. **client 服务必须显式 inject**（FIX-52 真机补充）：`slots` / `configForms` 与 `remote.*` 同规 —— 不写进 `inject` 就直接访问抛错，而 try 探测会**静默吞掉**它 ⇒ 设置页那一栏永远不出现（真机踩过）。官方 client 插件（`ui-agent-preset` / `ui-chat` / `ui-settings-account`）的 inject 里都有这两个服务名，照抄即可
68. **成员列表只留有用的列**（用户口径）：「层 / 子」两栏已删（层级看缩进、子节点数看徽章行下方的树形指引）—— 具体层数与子节点数并入行 tooltip，**信息不丢、只是不占列**。定宽列从此是 角色 72 / 状态 64 / 模式 48 / 徽章 40（对齐要求不变）
69. **对抗审查的"真异源"要两件事都到位**（用户定稿）：① 配好 `modelRoutes.adversary`（本仓库默认 `glm-5.3-flash`，也可在设置页「调用 JSON」里改）＋ ② 宿主里有该 provider 的 **key**（key 只活在宿主 provider 账户里，插件不碰、也绝不写进任何文件或设置）。缺任一样 ⇒ 「异源」徽章 `unknown`（**不是"合格"**）＋ 审计报 `cross_vendor`；补齐后徽章 ✓、审计不再报。口径统一：**`assemble` 的"非异源"标注与审计 `cross_vendor` 必须同源**（没配路由才标/才报），所以"契约里没写非异源"就能推出"派单确实异源"
70. **任意新文件夹当仓库即自适应（零配置）**（FIX-58，产品级）：用户原话「我任意开一个新的文件夹作为仓库应该自适应这个仓库」——换项目**不该**要人改 `cordis.patch.yml`。规则四条：① **根自适应**：优先级 `显式 project.root` > **当前工作区**（`workspaceRegistry.resolveByPath(cwd)`，含"cwd 在某工作区之下 ⇒ 用那个祖先工作区"，免得在 `仓库/` 子里另起一套）> 会话 `header.cwd`；**一个来源都拿不到就早失败**（"推不出项目根"），绝不瞎猜目录；② **结构自适应**：按候选清单探测既有目录（`任务`/`tasks`、`[Agent进度]`/`progress`、`docs/{研究,坑,修改,核心数据库,子agent,archive}` 与 `仓库/docs/…` 变体），**命中即用、不动既有文件**；**命中了一个文档类目录后，缺失的兄弟目录按命中项的公共父目录补建**（老项目 `仓库/docs/坑` 命中 ⇒ 补 `仓库/docs/研究`，**不会**在根下另起 `docs/研究` 把两种布局混在一起）；③ **探不到就自建默认结构 + `待办.md`**：**只新建、绝不覆盖**，且**建的入口只有一个 = `project_init`**（FIX-61 收紧：显式动作、人点头；它 `dryRun` 默认只预览）——其余工具（含派单、`doc_emit`）**只提示不代建**，各自只补自己写的那一个目录，回执与面板**必须说明建了什么**；④ **项目名 = 工作区目录名**（可被 `project.name` 覆盖）⇒ 隔离键随项目变 ⇒ **一个实例天然服务多个项目**（`ledger.storeFor(key)` 分域；索引、面板快照、`doc_search` 全部按项目分家），取代替换掉此前"一实例一项目"的限制说明。落地与护栏：推导结果写 `<项目根>/.agent-contract/project.json`（**随项目走**的派生物，坏了/版本不符一律当没有并重新探测）；**所有解析出的路径必须落在项目根内**，越界当场抛错；出厂 `cordis.patch.yml` **不写 project/paths**（只留"取消注释即显式锁定"的示例），因为写了就会盖住自适应；面板找 `panel.json` 仍按**会话目录**推 ⇒ 「会话目录 = 项目根」时最稳，指到别处时面板会明说"数据源待接"（不给过期数字）。**点亮时机（2026-10-03 真机回归，已修）**：快照自愈不能只挂在"启动"上 —— 零配置下启动**推不出根**（宿主可能登记了多个工作区，没有会话就无从选择）⇒ 一次都不写，面板永远"数据源待接"，连 FIX-51 的"升级后不用人工动作"都做不到。规则：启动只在"能唯一确定项目"（显式锁定 / 唯一工作区）时预点亮；否则**认会话** —— 宿主全局事件 `session/created`（`packages/core/session/src/index.ts:55`）一来，就按该会话 cwd 推出项目根并补写它的快照（幂等：版本一致不重写；`ensure: false` ⇒ 只读探测，不建目录）
71. **"没报"不等于"合格"：审计必须能自证"判得了"**（FIX-59，真机实锤）：`cross_vendor` 的判据是"两边都有模型名且相同"，而真机上 6 条成员 `model` **全是 null**（只有显式配了路由的 adversary 才有值）⇒ 这条审计在真机上**完全是哑的**，却被读成"合格"（又一例"夹具绿 ≠ 真机有牙"：夹具自己塞了 model）。两条修法：① **派单即记账生效模型** —— `resolveEffectiveModel()` 按权威度解析 `显式路由 agentOptions.model` → `run.localAgent.options`（宿主 `resolveChildAgentOptions()` **解析后**的结果）→ 子会话 `requestHeader().config` → 子会话 `sessionProjections.stateOf(session,'modelSelection')` 的 `lastUsed`/`pending` → **父智能体路由**（没配路由的子智能体在宿主里就是继承父路由，这一步等于把宿主那条继承规则自己算一遍）→ 宿主部署默认 `ctx.agentDefaultModel.currentSelection()`；全拿不到就 **null + source:'unknown'**（绝不编值），回执里写「模型：xxx（来源 …）」/「模型：未知」；`member.model` 存**模型名**，`route` 仍存**路由名**（**不许拿路由名顶替模型名** —— 旧实现 `model || route` 让"异源"看起来永远成立）② **可判定性变成可见事实** —— 新增观察项 `cross_vendor_undecidable`（`level:'info'`，只记录不告警、不计红黄、不进 `audit.checks`）：存在 adversary 成员而任一可比侧的模型未知时，明写「无法判定（缺模型数据）：…**这一条"没报"不代表合格**」。配套：人话报告的"待处理清单"只放红/黄 —— 观察项**不得**被标成 `[黄]`（那是"已判定有问题"的意思），它们单独在"观察（仅记录，不告警）"一段
72. **角色卡是插件的"软约束"出口，必须与当前工具集同步、且不许写阶段快照**（FIX-60）：用户批评「硬性纪律应该是插件提供而不是你写」——他发现自己要在任务单里手抄一遍"先备份 / 只移不改 / 判不准留原地 / 留痕 / 更新引用"，这等于插件没做到"软约束变硬机制"。规则：① **通用纪律写进角色卡**（馆员卡里成段写"通用纪律"，并注明"**这些是准则，任务单无需重复**"）：dryRun 预演 → 判不准就上报（绝不猜着改）→ 改了位置就同步引用 → 归档边界（只归档"已结且超档龄"的档）→ 改动必须留痕；② **已由代码强制的要写明"无需你操心"**（写前备份/备份失败即中止、直修不碰正文结论、派生物没变就不写、原子落盘），避免子智能体重复设防；③ **职责用能力表述，不许写"本阶段只做 N 件事"**（阶段会过时、能力不会；实测馆员卡停留在 M2 的"只做两件事"，而它当时已有 7 个工具 ⇒ 子智能体读到会**拒绝或不认领**这些活）；④ **工具白名单必须与能力面一一对应**（`librarian_tags` 曾整轮缺席白名单），套件里按工具名逐个断言，防再漂移
73. **缺结构要主动提示，且建目录只有一个显式入口**（FIX-61）：FIX-58 之后探测是自动的、但**建目录**只有 `project_init` 会做，而插件不提示 ⇒ 用户不知道要叫它，主代理也想不到调。规则：① 解析出的项目里凡"该有而现在没有"的位置（任务 / 进度 / 产出 / 各类文档目录 / 归档 / 待办文件，判据是**文件系统事实**，不看有没有 `project.json`——初始化过不等于现在还在）⇒ 在 **`contract_status` / 派单回执 / 面板快照（`projectHint`，client 渲染一行）**三处给同一句可执行提示：「本工作区尚未初始化：缺少 … —— 调 `project_init` 可预览并建齐（只新建、不覆盖）」；② **结构齐 ⇒ 字段为 null，一处都不提示**（别变常驻噪音）；③ **只提示、不代建**：建目录唯一的入口是 `project_init`（`forceCreate`），其余所有工具（派单、`doc_emit`…）只补**自己写的那一个目录**，绝不代建整套结构——否则"缺结构"这件事会被静默抹掉，用户永远不知道发生过什么
74. **会动真实文件的活，派单与首次写动作都要先提"提交一次基线"**（FIX-62）：插件**不替用户提交**（提交是外向写操作），但也**不能只字不提**。规则：项目根是 git 仓库且工作区有未提交改动时，在① 会动文件的角色（白名单含 `write`/`edit`/`doc_emit`/`librarian_*`）的**派单回执**、② **首次写动作**（`doc_emit` / `bugfix_note` / `librarian_sweep` / `librarian_archive`，同项目只提一次）里写「建议先提交一次基线：当前有 N 个未提交改动（`git status --short`）」；非仓库 / 干净工作区**不提示**（别刷噪音）；提示归提示，**不硬拦**。**git 口径（用户 2026-10-03 拍板）**：**只读探测允许、写命令默认禁止** —— FIX-62 的验收④（"源码无 child_process 调 git"）与 FIX-67（要实现自动提交）、以及 FIX-62 自己的"要报 N 个改动"三者互斥 ⇒ 按此口径统一：`status` 这类**只读**命令可发，`add`/`commit`/`tag` 只在开关打开时发，**永不 push**
75. **工具面要有角色闸门：别让主代理坐上馆员的椅子**（FIX-63）：主代理的反思原话——「工具面没有闸门……我照字面读，唯一空着的椅子就是执行者，于是我坐了上去」。本质：`librarian_*` 这些活**属于馆员**（馆员角色卡带着 dryRun 先行 / 判不准上报 / 引用同步 / 留痕的纪律），而工具面对主代理敞开 ⇒ 直调 = **绕过全部纪律**。规则：① 馆员作业面（`librarian_*` + `ledger_backfill`）的**工具描述**里附归属句「面向图书管理员角色；主代理应通过 `contract_delegate_librarian` 委派，不得直调」；② 主代理（层 0）直调 ⇒ 回执附**警告并渲染出来**；③ 可选 `delegation.strictRoleGate: true` ⇒ 直接拒绝；④ **馆员自己（层 ≥1）与身份不可解析（fail-open）一律放行** —— 闸门是提醒纪律的，不是靠猜身份堵路的
76. **任务文件 = 子代理的作业登记卡**（FIX-64，口径按真机 55 张卡重定）：任务文件**不是需求单**，是子代理写自己那份作业登记卡（谁派的 / 占了哪些文件 / 状态 / 产出 / 异常）；"要什么"来自契约里的上级补充指令。必备字段 = 上级 / 占用文件或资源 / 状态 / 阶段产出 / 异常；推荐 = 占用时间 / 结论摘要 / 风险。插件**提供字段规范与可复制模板**（进契约的"能力配置"段，任务单不必再抄），**交付时**校验（`doc_emit` 回执给提示 + 审计观察项 `task_card_incomplete`，`level:'info'` 不告警）；**不做"派单前必须有卡"**（派单时可能尚不存在）
77. **占用文件/资源 → 并发冲突审计**（FIX-68）：任务卡里的占用段本来只是文字（55 张卡里 50 张有），现在解析成机读 `{任务号, 路径, 模式}`（模式 ∈ read / write / newFile / forbidden；路径归一化后 `D:\a\b` 与 `D:/a/b` 视为同一路径）。判定：两个**活跃**任务都声明写同一路径 ⇒ **红**（真会互相覆盖）；一写一读 ⇒ 黄（可能读到半成品）；写了声明为 `forbidden` 的路径 ⇒ 黄。**完成 / 已释放不参与**（否则历史卡永远互相冲突）。报告写出**两方任务号 + 路径 + 各自模式**并给"建议串行或改分工"；与 `doc_overwritten`（事实层面、事后）**口径分开**——这条看的是**声明层面**、事前可见
78. **验收报告由插件自动产出**（FIX-66）：用户批评「这些约束应该是插件提供的」——任务单里写着"正文零改动 / 引用无失效 / 红黄数 ≤ 基线 / 报告格式"，而数据插件全都有。规则：`librarian_sweep` / 归档类治理**结束时自动**给一份报告，含 ① 动作清单（移动/改名/引用/归档/待裁定，每条带路径与原因）② **正文零改动证明**（逐篇"前指纹 → 后指纹"，不一致的**单独列出**；指纹取**正文**而非整文件——治理本来就会改头部，拿整文件指纹会永远不等）③ 引用残留（改名/移位后全库检索旧路径）④ 审计前后红黄计数与条目 diff ⑤ `dryRun` 给**预演版**（动词用"将…"，并诚实写明"未落盘，故计数未变"）
79. **自动 git 提交：默认关 + 范围护栏**（FIX-67）：`git.autoCommit` 默认 `false`（关闭时行为 = FIX-62 的"只提示"）。打开后：**只 `add -- <本次动到的路径>`**（绝不 `-A`）· 提交前若工作区有**范围外改动** ⇒ **中止**并提示（避免把用户的 WIP 一起提交）· 提交信息含任务号 + 动作摘要 + 备份目录 · 可选 `git.autoTag` 打锚点 tag · **永不 push** · 失败**明示且不阻断**治理 · 一次治理最多一次提交。⚠ 实现细节坑：`status --porcelain` 给的是**仓库相对路径**而动作清单是绝对路径 ⇒ 比对前必须拼回绝对路径，否则**每个改动都会被当成"范围外"**（护栏退化成永远中止）
80. **面板刷新提速**（FIX-65，用户"自动刷新很慢"）：轮询 20s → **5s**（只重读快照，成本可忽略）· 整轮重载（血缘+快照，最贵）30s 一次（5s×6 拍；原来 3×20s=60s）· **页面重新可见时立刻 poll 一次**（`visibilitychange`；隐藏期间仍暂停，保 FIX-38 的"别白烧 IO"）· 节拍保持纯函数可单测
81. **渐进式披露：三档用元数据指针串联，终点是 L1**（FIX-70）：用户口径「L3、L2 文件的渐进式披露就是 L1」。规则：front-matter 增显式指针 —— L3 → `nextTier`(L2) + `fullDetail`(L1)；L2 → `fullDetail`(L1)；L1 → `detailLevel: 'full'`（**终点**）。`doc_emit` 自动写本档指针，并在兄弟档生成后**回填**（只动 front-matter，值没变就不写，写则走备份闸门）；正文首屏给**≤3 行机器生成的速览**（本项目做什么 / 本档给谁看 / 要细节去哪）；新审计项 `missing_progressive_link`（概括档缺指向 L1 的指针 —— **只有 `nextTier` 仍算缺**，因为终点只能是 L1）与 `dirty_related_path`（`relatedFiles` 里带反引号/截断/不成路径的脏项，现网数据里就有）；契约的文档切片读法明写"先读 L3，再按 front-matter 指针下钻"
82. **文档分门别类：两级目录 + 产出区硬限制 + `^` 搬进元数据**（FIX-69，用户拍板）：`abc 级`三档**不改名**（L1 详细归纳 / L2 扩充细节 / L3 高度概括）；目录**两级** —— **类型 → 目录**、**档级 → 子目录**：`docs/研究/` · `docs/审查/` · `docs/整合清单/` · `docs/产出/{L1,L2,L3}/`（另有 坑 / 修改 / 核心数据库 / archive）；命名后缀与**所在目录**必须一致（`_研究`/`_审查`/`_整合清单`/`_L<n>`）。规则：① **产出区是写动作层面的硬限制**（不是审计提醒）：`resolveDocArea()` 算落点并逐条卡住 —— 只收 `.md`、文件名不得含路径分隔符、类型档不许带档级、归档目录不许 `doc_emit` 直接写、类型目录没配就拒绝并说明；② `^` 前缀（旧的归档写法）**搬到元数据** `archived: true`（+`archivedAt`），文件名不再带 `^`，`archiveDocs` 也统一写这个字段（归档语义从此**读字段**，不看文件名）；③ **临时文件**（`.json`/`.tmp`/`.bak`…）统一去处 `paths.tempDir`（默认 `docs/_临时`，**非类别目录、审计排除**），迁移时**只搬不删**；④ 一轮治理新增**归位步骤**（`conformDocAreas`）：去 `^` 前缀 + 写 `archived` + 类型归位 + 非 .md 搬离，**判不准一律列「待人工裁定」**，每次移动都走既有引擎（写前备份 + 更新引用 + 留痕）；⑤ 三个新的**警告制**审计项：`doc_kind_mismatch`（后缀与目录不符；审查落研究/产出必报）、`stray_non_md`、`legacy_caret`。**实现里踩到两处**：产出档进了档级子目录 ⇒ 非递归的 `listMarkdown()` 在产出根下一篇都看不见（台账/派生器/切片全漏档）⇒ 新增 `listMarkdownDeep()` 并换到产出相关的扫描点；搬运引擎会给**任何**被移动的文件贴 front-matter ⇒ 非 `.md` 必须走**原样搬**的分支（否则 `.json` 被贴上 YAML 头部）
83. **记录与磁盘不一致必须有人管**（FIX-71，真机 T53 样本）：助手的任务单 `任务/T53_文档归位与规范化.md` 被移出仓库后，主代理**仍然"看到"它**并去读 ⇒ `FS_NOT_FOUND`（台账是缓存，文件移走记录不会自己消失；而原有 18 项检查里**没有一项**管这件事 —— `orphan_task` 管的是"成员已释放但任务未结"，不是这个）。新增两条**警告制**检查：`task_file_missing`（台账有**未结**任务记录、磁盘上没有 `<tasksDir>/<taskId>.md`；已结任务不要求文件还在，可能已归档）与 `doc_file_missing`（文档记录指向的路径在磁盘上不存在）。三条纪律：① **只报不删**（台账可重建，删除不可逆 —— 报告里明写"只报不删"）；② 报告里**两条排一起**并给一行总建议「台账是缓存，磁盘才是事实 —— 跑一次 `ledger_rebuild` 即可对齐」；③ **成员记录不进本检查**（members 有"绝不删除"的不变量：带 sessionId 的实时记录只在 storages）
84. **规范必须有 agent 可读形式**（FIX-72，真机实测）：主代理做对了 `ledger_rebuild` → `contract_status` → `audit_scan` 之后开始**满世界找规范**（glob 找 DESIGN.md → 读产出目录里的设计稿 → 定位 `app.asar` → 读插件源码）—— 根因是 `contract_status` 只给了「目录约定」+「类别→目录」，**没有命名后缀、必备头部字段、产出区硬限制、归档字段、临时文件去处、渐进式披露指针**。规则：① `contract_status` 增**「文档规范」段**（**一句话一条**，源就是实现口径本身：每类 = 目录 + 命名后缀 + 必备头部字段 `taskId/role/tier/keywords/relatedFiles/createdAt`；产出区只收 `.md`…；归档 = `archived: true`；临时文件去处；渐进式披露指针规则）＋**「下一步姿势」**一句话（这类活不必读正文/源码，用 `contract_delegate_librarian` 派单并先要 dryRun 预演）；② **篇数分两套标**：`台账 N 篇（只含产出档/任务/进度）` 与 `磁盘 M 篇（各类别目录递归数）`，并说明台账的**覆盖范围** —— 免得 106 vs 146 被误读成"漏档"（是否把 `docsDirs` 纳入台账是**单独决策**，本单不动）；③ 审计建议给**具体去向**（`doc_kind_mismatch` → 应放目录 + 正确文件名；`stray_non_md` → tempDir 路径；`legacy_caret` → 去前缀 + 写 `archived: true`）；④ 工具描述写明"了解规范读本工具即可，不需要读插件源码"
85. **记账不许静默 · 面板"待接"要能自解释**（FIX-73，真机"图书管理员居然是非长期性 agent"）：初稿写的"派单记账被静默吞掉"**证据不足已撤回**（盘上确实有记录，只是落盘/快照重写比面板读取晚了几十秒）；真问题是两条。① **快照成员投影丢字段**：`buildPanelSnapshot` 的成员投影只保留 `sessionId/name/role/taskId/badges`，丢了 `mode/status/model/derived/lastActiveAt` —— 而客户端 `deriveMode(row, info)` 恰恰要看 `info.mode`，拿不到就退化成"前台/未知"⇒ **常驻角色在面板上看起来不像长期性**。规则：投影带上这些字段，且**客户端要把它们落到节点上**（`applyPanelBadges` 里同步 `node.mode/status/modelRoute`）② **空窗期没有任何解释**：派单 → 记账落盘 → 快照重写之间，徽章只写"待接"，用户与主代理都不知道为什么。规则：树里有节点、快照里没它的记录 ⇒ 标 `notCounted`，徽章 tooltip 明说「该成员尚未记账（派单后需要几秒）—— 点「↻ 刷新」或等下一拍即可」，**与"数据源陈旧/未生成"在措辞上分开**；③ 记账结果**必须回到回执**：`recordDelegation()` 不再静默 `return`，store 未就绪或写失败都返回 `{ok:false, reason}`，调用方把「记账延后：…」写进 `warnings`（仍**不影响派单本身**）
86. **白名单漏一个工具就断一条链**（FIX-74）：真机实证——补充指令里写"先 `ledger_rebuild`"，馆员回报「不在我的工具白名单，第一步未执行」。规则：馆员的**簿记核心工具**（`ledger_rebuild` 这类"把台账对齐磁盘"的动作）必须在其白名单与角色卡能力面里；套件按 FIX-60 的清单逐个断言（加工具忘了同步就当场红）
87. **预算只限"主代理给子代理的任务切片"**（FIX-75，用户裁定）：用户原话「机器搬运反而不用限制，因为**可控**；**限主 agent 给子 agent 的任务切片长度**就可以了，像研究 agent 产出的研究文档交接给下一个 agent **写相对路径**」。① 废掉「除 mandate 外合计 2500 字 = 搬运失控」这条硬卡：它全是**插件自己生成**的内容（角色卡补全后必然触发），降级为 `info` 文案「**总量提示**」（不产生 warning、不进 `over_budget`，措辞里不许出现"失控"）；`role` / `capability` 段**不再设段限**（涨了是插件的事）；② **新增任务切片（brief）上限**：软 1000 / 硬 2000（`budgets.briefSoft/briefHard`），超硬限裁剪 + 回执警告 + 正确姿势「细节写进任务卡或文档，切片只留**指针**（路径 + 要看哪一节）」；③ **交接语境用相对项目根**（切片 / 任务切面 / 指针）：给 `（相对项目根：x/y.md）` 写法 + 一句「以上路径以 `<root>` 为基」；⚠ **但"请你自己 read 的文件"仍保留绝对路径** —— 子代理可能在**别的工作区**执行（真机已见：产出先落到 `default-workspace`），相对路径不能变成解析歧义
88. **馆员必须有"搬移的手"，否则闸门形同虚设**（FIX-76，架构级自相矛盾）：真机实证——主代理授权馆员落地后，馆员做了归档/归位/补头部/改引用，但**"分类归位（搬目录）"与"临时文件挪走"它做不了**（没 shell、没有通用移动工具）⇒ 主代理只能自己用 pwsh 搬了 **157 项**，绕过写前备份 / 引用更新 / 留痕三条链 ⇒ 搬完 `relatedFiles` 与交叉引用**全是旧路径**（连馆员刚写的 `archive/2026-10` 都因分片合并失效）。修法：新增 **`librarian_relocate`**（馆员的通用搬迁）—— 入参一批 `{from,to}`，**默认 dryRun**（"将移动 N / 冲突 C / 影响引用 R"）· 碰撞**拒收**（不覆盖）· 写前备份（与既有写入同源）· **引用同步（头部 `relatedFiles` + 指针字段 + 正文；原来只改正文 ✗）** · 留痕 · **回滚清单**（新 → 旧）· **正文 sha 不变**（逐篇给"前 → 后"指纹）；`librarian_sweep` 的归位步骤走同一能力，主代理侧仍被 FIX-63 的闸门挡
89. **搬完要收口：断引用修复 + legacy 待归档标注 + 错表述订正**（FIX-77）：① **引用一致性修复**（可独立复用）：全库扫"指向不存在路径的引用"（`relatedFiles` + 指针字段 + 正文里的 `.md` 路径），**两条策略**找唯一解 —— **文件名匹配**（换目录）或**任务号匹配**（改名，`T<号>` 对得上且仅一个候选）；唯一 ⇒ 自动修（dryRun 先出、落盘走备份 + 留痕），有歧义 ⇒ 列「待人工裁定」（**绝不猜**：指错比断着更坏）；报告分「存量断引用」与「本轮搬移造成的」。⚠ 扫描必须覆盖**磁盘**（台账只含产出档/任务/进度，研究/坑/核心数据库都不在台账里 ⇒ 只扫台账会漏掉一大半引用方）② **legacy 档补 `archivePending: true`**（批量、只动 front-matter、**不塞六个 null 占位**），配套审计项 `legacy_archive_pending`（缺 ⇒ 黄）；顺带把 `parseValue` 的布尔还原修了（`archivePending: true` 读回来曾是字符串 `'true'` ⇒ `=== true` 永远不成立）③ **订正"`^` = 完成标记"这类错表述**（上下文压缩污染的产物）：宽严拿捏成一句话替换 + 留痕 + 备份，且**作为"有意变更"单列**进 FIX-66 的验收报告（它不进"正文零改动"名单 —— 那是用户授权的正文订正）
90. **"等结果"是有代价的：会把常驻角色降级成一次性**（FIX-78，真机铁证）：真机成员记录显示 `T53_docs规范化整理-librarian → mode: "one-shot"`，而角色卡明明是 `continuable` —— 入口只有一处：`background = role.mode === 'continuable' && args.run_in_background !== false` ⇒ **调用方传了"等结果"**。为什么传：工具描述只写了「传 false 表示本次改为等待结果再返回」，**没写代价**；主代理为了先拿 dryRun 预演给用户确认，就把常驻馆员变成了一次性（宿主机 UI 也印证：「一次性子智能体记录 —— 不支持后续消息」）。规则：① `run_in_background` 的说明必须写**两面**（默认=后台常驻、不阻塞、之后可继续派活；传 false=等待结果但**一次性、之后不能再派活**），并放**描述开头**；② 给出「要结果 + 还要续派」的**两段式**：后台派 → 让它把预演**写进产出档** → 主代理读产出档 → 用户确认后**向同一个它续派**（同一角色的下一次调用即是续派）；③ 契约的「运行模式」照实标明"本次为一次性"还是"常驻"（子代理自己也该知道）
91. **图书管理员改为常驻单例 + 排队**（FIX-79，用户拍板）：用户原话「跨任务复用的常驻馆员（一个会话服务多个任务）因为**总是遇到 5、6 个任务同时开工，这么多的管理员更乱**」。**比"乱"更硬的理由（写进设计）**：馆员动的全是**全局共享文件**（坑库 README / `派生态索引.md` / 核心数据库索引 / 交叉引用 / 归档目录）⇒ 5 个任务各派一个馆员 = **多进程同时改同几个文件** = 不只是乱，而是**互相覆盖**（插件自己踩过：`坑/README.md` 被整篇覆盖且无备份）。规则：① **角色实例模型分两类** —— **常驻单例**（`librarian`：成员名固定 `librarian`、**不带任务号**）与**按任务实例**（researcher / implementer / reviewer / adversary，保持现状）；② 派单语义：常驻角色**首次=创建**，之后**向同一会话续派一条消息**（`ctx.subagents.sendMessage(parent, childId, …)`，**不新建实例**），回执标明 `created` / `continued`；③ **排队可见**：它忙时新派单**照样送达**（宿主在步边界接收，**绝不丢弃**）并在回执写「排队中：前面还有 N 条」（进程内计数，`subagent/end` 时 -1）；④ **记账按任务分流**：常驻成员**只有一条**记录（`mode: continuable`、无 `taskId`），任务/进度/产出归属仍由文档 front-matter 的 `taskId` 承载；⑤ **审计口径一起对齐**：`unreleased_run` 对"名字里没有任务号 + continuable"的常驻成员**跳过**（它每轮结束都是 completed，拿"未释放"判它是误报），`orphan_task` 天然跳过（无任务号）、`occupancy_conflict` 本就按任务卡判（不看成员）；面板上它是**长期节点**；⑥ 默认单例，日后吞吐不足可扩成**有上限的池**（池内串行访问全局文件），**不得**退回"每任务一个"
92. **写文件不得改动行尾**（FIX-80，真机实证）：回滚之后内容已完全回到 git 基线，但**行尾被整篇改写**（LF → CRLF）⇒ `git status` 报 397 处 M、`--stat` 报 16714 插入 / 16714 删除，而 `git diff --ignore-cr-at-eol` 显示改动 **0** ⇒ **假差异淹没真实改动**，"与开工前 git 基线对账"这条验收直接失效。规则：① **收口点只有一个** —— `writeWithBackup()`（所有"读改写"都走它）：读进来是什么行尾，写出去就是什么行尾；原文**统一**⇒用那一种，原文**混用**⇒**逐行保持**（内容在原文出现过的行用它原来那个行尾，新行/改过的行用多数派），末行的有无终止符也跟着原文；② **新建文件用 LF**（`paths.newFileEol` 可配 `crlf`；新建档用 CRLF 同样会制造后续假差异）；③ 验收报告（FIX-66）逐篇给"正文指纹 + **行尾风格**"，**"内容一致但行尾变了"单独列出**并注明"会污染 git 基线对账"（安全网：即便某条写入路径绕过了收口点，也会被报告抓出来）
93. **类别措辞不许泄漏内部档级**（FIX-81）：馆员往 `坑/` 落一篇档，回执写「已落盘 **0 级**文档」—— 而坑 / 研究 / 审查 / 整合清单**本来就没有档级**（L1/L2/L3 只是"三档产出"的概念），派生器判 `tier: 0` ⇒ 读起来像**掉级或缺陷**（真机报告方专门为此发问）。规则：回执按**类别**措辞 —— 三档产出写 `已落盘 L<n> 级文档：…`；其它类别写 `已落盘 <类别>档：…`（坑档 / 研究档 / 审查档…，与 FIX-69 的类别名同一套）；`tier: 0` 的内部语义保留（legacy / 非三档），但**不得泄漏到给人看的文案**喵
94. **派生布局（`project.json`）会过期，必须带版本并自动重探**（FIX-82，真机 Blockdustry 就是样本）：文件里的 `generatedAt` 是 16:53、内容是**旧的六类布局**（没有 FIX-69 新增的 审查 / 整合清单，也没有 `tempDir` 与 `产出/L1|L2|L3`）⇒ **插件已升级、旧项目还在用旧布局**（`contract_status` 的"文档规范"段与实际不符、类别判定按旧表走）。规则：① 元数据记录**布局定义版本** `layoutVersion`（`PROJECT_LAYOUT_VERSION`，布局定义变了就 +1）；② 加载时比对：不一致 ⇒ **自动重探**（**保留既有 root/name/key** —— 项目身份不该因为重探而变 —— 只重算 paths/docKinds/hits），并给一句说明（进 `contract_status` 的 notes，随快照进面板 tooltip）；③ **重探只读**（建目录仍由 `project_init` 显式落地）；④ 重探失败 ⇒ **沿用旧值** + 警告（不让一次重探把项目打回不可用）；⑤ 显式配置优先（显式分支不读缓存、不重探）。真机预期：升级重启后 `docKinds` 自动补成八类、`tempDir` 补上；若 `产出/` 尚未迁移则**仍指向 `子agent`**（那是磁盘事实），迁移后自动跟上
95. **重探 ≠ 持久化：布局重探必须写回 `project.json`**（FIX-83，真机只做了一半）：FIX-82 的重探跑了（快照 notes 明写"类别补成八类"），但**磁盘上一个字节没变**（`layoutVersion` 仍缺、`generatedAt` 仍是 16:53、`docKinds` 仍旧六类）⇒ 每次解析白重探一次，且**任何直接读该文件的人/代码都会被误导**（核对者本人就被它误导了一轮）。规则：① 重探成功后**必须写回**（含 `layoutVersion`/`generatedAt`/新 `docKinds`/`tempDir`，保留 root/name/key）；② 写回**原子**（先写 `.tmp` 再 `rename`，避免半截 JSON 把配置搞坏）；③ 写失败**不静默**（进 notes）且**下次继续重探**（不因为写失败就放弃重探）
96. **审计要认"已归档会话"**（FIX-84，用户原话「有一些被我归档的测试对话居然也被审计扫出来了」）：归档是**宿主侧状态**，插件没读它 ⇒ 119 条审计里约 31 条是用户早已归档的测试对话。规则：① 读宿主现成 API `ctx.workspaceRegistry.archivedSessionIds`（**可选服务，拿不到就静默降级 = 保持今天行为**）；② 归档成员的 `ghost_run` / `unreleased_run` / `missing_doc` / `orphan_task` **一律不报**（归档 = 明确说"这些不用管了"，与"警告制"精神一致）；③ 报告**单列一段**「已归档会话（不计红黄）」并给数量（让用户知道"这些我看过了"而不是凭空消失）；④ 面板给成员打「已归档」标；⑤ 归档状态**每次审计现读**（不缓存死）
97. **产出形态是角色属性**（FIX-85，用户原话「有些类型的 agent 不需要三档文件，比如 librarian」）：`missing_doc` 不看角色 ⇒ 真机 9 条里 **8 条是馆员** ✗。规则：**角色元数据表 `ROLE_META` 是唯一来源**（产出形态 `deliverableKinds` + 能力标签 `capabilities` **合在一张表**，FIX-89 也读它）：`librarian=bookkeeping`（**无文档要求**）· `researcher=research|three-tier` · `implementer=three-tier` · `reviewer|adversary=report`。`missing_doc` **按声明判**（未声明文档类形态 ⇒ 一律不报；声明多项 ⇒ **任一合法形态存在即通过**，且"研究档/报告档"要**扫磁盘**判 —— 那些类别不进台账）；`ghost_run` 不得拿"没落档"判簿记角色；馆员的完成判据换成**留痕**（新检查项 `bookkeeping_untraced`：最近一次作业之后全库无 `librarianTouchedAt`/`librarianChanges` ⇒ 报"簿记无留痕"）。**探到一处实现坑**：`hasKindDocForTask()` 是 async ⇒ 忘了 `await` 会拿到恒真的 Promise ⇒ 检查永远 continue（静默漏报）
98. **面板按角色形态适配**（FIX-86，用户原话「library 被识别成了成员」）：快照里的成员记录**完全正确**，是**展示层**两处按老假设取值：① 角色靠 `parseMemberName(label)` 解析 `<任务号>-<角色>`，而常驻单例的 label 就是 `librarian`（FIX-79 的设计）⇒ 解析失败退化成"成员"；② 徽章不看角色形态 ⇒ 簿记角色的三档显示 ✗（应为 `—` 不适用）。规则：**记录优先**取角色（`membersById[sessionId].role` → 退化到 label 解析 → 才显示"成员"）；徽章按**同一张** `ROLE_META` 表判"不适用(—)"（簿记/审查类不判三档；异源只判 adversary）；**"不适用(—)"与"未知(?)"必须区分**（前者是"该角色本就不产出"，后者是"数据没到"）
99. **任何动真实文件的工具都不许缺预演**（FIX-87）：真机事故的直接根因就是 `librarian_archive` **不可预演** + 分片按**运行时刻**算（3 篇正文标废日是 2026-08-13，却会落进 `2026-10`）。用户裁定：本轮用 `librarian_relocate` 搬进 `archive/2026-08/`（可预演、回滚可靠）+ 另行写 `archived: true`。机制补齐：① `librarian_archive` **默认 dryRun**（「将归档 N 篇 / 各自 → archive/<月>/ / 冲突 C 项」）；② **分片口径可控** `monthOf: 'obsolete'|'now'`，**默认 `obsolete`**（按该档被标废/被判定归档的月份：头部 `archivedAt` → 正文"废弃/作废"附近的日期 → 台账 `updatedAt` → 才退回 `now`）；③ 落盘时写 `archived: true` + **`archivedAt` = 标废日**（执行时刻进留痕 —— 两个时间事实都保留）+ changelog 只追加 + 只移动不删除
100. **`tempDir` 默认值必须与类别目录同源**（FIX-88）：默认写 `<root>/docs/_临时`，而真机类别全在 `<root>/仓库/docs/*` ⇒ 临时目录长到**另一棵树**上（agent 照规则真把它建出来了，主代理还专门来问"落哪棵树"）。规则：默认取 **`docKinds`/`docsDirs` 的公共父目录 + `_临时`**，拿不到公共父目录才退回 `<root>/docs/_临时`；**显式 `paths.tempDir` 优先**（自适应只负责"没写时同源"）；`_临时` 仍是**非类别目录**（不进 `docsDirs`、审计排除）
101. **主代理做"甩手掌柜"**（FIX-89，用户原话「它只用做一共甩手掌柜，交给下级完成绝大部分即可，因为主 agent 模型和子 agent 模型是一个等级的，只不过主 agent 思考强度更高」）：真机证据 —— 一轮 T53 的 52 次调用里**侦察类占约一半**（pwsh 列目录/数数、grep 找标记、read 任务卡/进度、交付后自己核查磁盘），而这些**同模型下级全能干**且更省主代理上下文。三层落地：① **指引**：`contract_status` 的「下一步姿势」扩成分工（盘点/侦察/数数/找标记派 `researcher`；文档整理/索引/归档派 `librarian`；实现派 `implementer`；审查与对抗各自派；**你只做判断·拍板·验收·汇报**，不要自己跑批量侦察）；② **能力声明**：`ROLE_META` 的 `capabilities`（recon/research/implement/review/adversarial-review/bookkeeping/relocate/archive）并打印「谁能干什么」对照表 ⇒ 按能力找角色；③ **流程预设**：新工具 `contract_flow` 内置三条可执行流程（`organize-docs` / `implement` / `research`），每步标明"派谁 → 产出什么 → 何时**停下等用户确认**"
102. **归档判定的两处硬伤：id 形态 + 父链**（FIX-90，真机 0.17.0 仍 119 条）：FIX-84 做了"认已归档会话"，但真机一条都没免疫，两处根因 —— ① **sessionId 形态不一致**：宿主 `archivedSessionIds` 是 `session-<uuid>`，而成员记录里的 `id` 是**裸 `<uuid>`**（子代理会话）⇒ 精确比对**永不命中**；② **只看成员自己的会话**：用户归档的正是这些成员的**父会话**（顶层 `session-<uuid>`）—— 归档父会话不会自动归档子会话。规则：① **两侧都归一化**（去/补 `session-` 前缀，大小写无关）再比；② **按父链上溯**：成员归属会话的**任一祖先**被归档 ⇒ 视为已归档；父链**优先问宿主**（`ctx.get('sessions').get(id).header.parentSession` —— 存量成员记录没记 `parentSessionId` 也能溯到），派单记账时也把**派单者的会话 id** 写进成员记录（`parentSessionId`）作兜底；③ **深度上限 8**，拿不到父链就退回"只看自身会话"（现状），**绝不报错**；④ 报告按**父会话归并**显示（用户对号入座），面板同一判定（快照也按父链打「已归档」标）
103. **占位不许"粘滞"，空态必须给动作**（FIX-91，真机 21:58 快照 `audit:{placeholder:true,items:[]}` 而待办有 57 条）：非审计触发的快照重写会"沿用上一份的 audit 块"，但**上一份本身可能是占位** ⇒ 一次占位 = 面板审计区**永久空**（除非有人手动跑审计）。规则：① **沿用前先认占位**（`audit.placeholder === true` ⇒ 一律不沿用，哪怕它数字齐全）——"占位"不是结论，没有可沿用性；② **占位自带动作文案**：写明「尚无审计结论」+ 可执行下一步（跑一次 `audit_scan` / 点「↻ 刷新」），**不许留空白、不许只说"待接"、不许拿 `0 红 0 黄` 冒充全绿**（FIX-39 口径保留）；③ **启动自愈时补算一次审计**（版本不一致 / 首份快照 / 无可沿用结论 ⇒ 现跑 `auditScan` 再落快照；补算失败退回占位并计数，**绝不让"面板空着"变成需要人工动作的事**）；④ 用户口径要一并写进文案与 README：**面板数据是"有动作（派单/审计/治理）时才写入"的，纯粹重启不会刷新** —— 用户对着一片空白最容易误会成坏了
104. **派生数据（缓存）的修正不受"要不要建目录"的门控**（FIX-92，真机 `project.json` 停在 16:53、无 `layoutVersion`）：FIX-83 规定"重探成功要写回"，但写回被包在 `if (ensure && !dryRun)` 里 —— 而启动那条"点亮面板快照"的解析路径是**只读解析**（`ensure:false`）⇒ 重探只在内存里发生，**磁盘永远不更新**：每次解析白重探一遍，且 `project.json` 与真实布局**长期不一致**（核对者被旧六类误导过一轮）。规则：① **`ensure` 只管"这次要不要新建目录"**，与"要不要修正一份**过期的派生物**"是两件事 —— 写回只受**显式 `dryRun`** 约束；② 选择不写回时**必须说明原因**（notes 写"本次为 dryRun ⇒ 未写回"，不许静默）；③ 写失败仍按 FIX-83（进 notes + 下次继续重探）
105. **常驻单例"没被复用"必须报出来，且任何路径都不许改它的名字**（FIX-93，真机成员表里既有常驻 `librarian`(continuable) 又冒出一个 `organize-docs-blockdustry-librarian`(one-shot)）：根因是**前台分支没看 `singleton`** —— 主代理按老习惯传 `run_in_background:false`（想要结果）⇒ 落到前台一次性分支 ⇒ 名字按 `<任务号>-<角色>` 拼、模式记 `one-shot` ⇒ 凭空多出"第二个馆员"（真机样本复现：把命名改回去就会长出 `organize-docs-blockdustry-librarian`）。规则：① 常驻角色的成员名**在任何派单路径**上都是固定名（= 角色名，不带任务号）；② **复用失败必须说明原因**（store 未绑定 / 角色元数据缺 `singleton` / 同名记录是一次性实例 / 记录无可用会话），不许静默新建；首次创建也要明说"这是第一个它"；③ 前台代跑**不许覆盖常驻记录的会话 id / 模式 / 状态**（覆盖了下次续派就发给一个已释放的会话）；④ 回执要分清「续派到既有常驻成员」/「首次创建」/「未能复用 + 原因 → 本次新建」三态，并给出"要结果又要续派"的两段式姿势
109. **给"落盘 schema"加字段必须带默认值，否则老记录会把整个插件黑掉**（0.20.0 真机定位，FIX-90 的回归）：FIX-90 为了让"归档父会话"能沿父链上溯，给成员记录加了 `parentSessionId`，写的是 `z.string().nullable()` —— **`.nullable()` 不带默认值**：缺这个字段就**校验失败**。而真机上 0.17.0 时代落盘的 20 条成员记录全都没有它 ⇒ 宿主 `storageDomain.open()` 逐条 `valueSchema.parse()` ⇒ `invalid-record` ⇒ `ledger.ready` **reject** ⇒ 插件里那条 `Promise.resolve(ledger.ready).then(…)` 链被**空 catch 吞掉** ⇒ 面板同步器从未挂上 ⇒ 快照从此一个字节不写、自愈全停、面板永久停在旧数据（用户看到的就是"重启也不更新"）✗✗。规则：① **加字段一律带默认值**（`.nullable().default(null)` / `.default(0)`）—— 读到即补值，这才是向后兼容；只有**破坏性**结构变更才递增领域版本；② 领域声明挂 **`invalidRecords: 'backup-and-skip'`**：真出现单条坏记录时，宿主把它挪到备份并打 error 日志，**而不是让整个领域打不开**（台账本就是可重建的派生物，为它黑掉整个插件是最坏的取舍）；③ **启动链路上的 catch 一律不许留空**：这类"同步器没挂上"的失败必须留痕（`contract_status` 回执 + 宿主日志），否则"面板不更新"会变成一个**查不到原因的黑洞**；④ 回归位要拿**真机形状的老记录**去撞每张表的 schema（成员/任务/文档各一条），一条不过就是又一次全站黑屏
110. **"数据不可信"不等于"路径不可用"**（0.20.0 真机）：陈旧快照整体判 `stale` 后，client 把 `paths` 一起丢了 ⇒ 面板「强制刷新」按钮报"拿不到待办文件路径" —— **正好在最需要它的时候失灵**（那条按钮存在的意义就是救陈旧快照）✗。规则：**事实类字段**（"待办文件在哪"）与**结论类字段**（红黄/计数/待办条目）分开对待：前者照旧带出去（取不到才是 null），后者才必须新鲜；取错路径的代价只是宿主路由 403（有明确原因），不会写错文件
111. **项目视图必须自带 `key`**（0.21.0 真机）：面板「强制刷新」走后端那条**只按待办路径反查项目**的路由 —— 它拿到的是项目**视图**，而视图里没有 `key` ⇒ 取不到该项目的台账 store ⇒ 按钮报「台账 store 未绑定（no-store）」，**而数据其实都好端端在** ✗（"报错但功能是好的"比报错更糟：会让人去修没坏的东西）。规则：**构建项目视图的地方就把 `key` 带上**（自适应那条 + 出厂配置那条，两条都要），别让任何一个调用方自己重推项目键；回归位要拿**解析器真的吐出来的那个视图**去跑路由，用常数桩 `storeFor` 会把这类 bug 整个盖住
112. **"运行版本 ≠ 磁盘版本"必须显眼，且领域打不开不许静默**（FIX-97，真机："所有契约工具一起废"却没人想到看版本）：现象链 —— 插件升级后**进程里跑的还是旧代码**（ESM 已加载完）⇒ 旧 schema 撞上新记录 ⇒ 宿主逐条 `parse` 抛 `invalid-record` ⇒ `ledger.ready` reject ⇒ 启动链被**空 catch** 吞掉 ⇒ 所有契约工具与面板同步器一起失效，而用户**无从判断该干什么** ✗。四条规则：① **版本漂移显式可见**：`contract_status` 同时报"进程里正在跑的版本"（模块加载期常量）与"磁盘版本"（现读），不一致就明说「请**完整重启应用**（只刷新窗口/页面不算）」；快照带 `runtimeVersion` 供面板同一判定；② **新增字段一律带默认值**（`.default(...)` / `.optional()`），套件按"每张表的每个字段：或在真机老记录里、或有默认值"逐字段守住 —— 这条规矩本文件早写过，这次是第二次撞上；③ **领域打不开不许静默**：工具回执要带**宿主原话 + 三条处置**（完整重启 / 看版本漂移 / 贴原因），并把原因**写进每个工作区的快照**（`notes` + `setupError`，**只动这两个字段，数据原样保留**）让面板页面直说 —— 面板只读文件，不写进去用户就只能看到"数据不新鲜"；④ 领域声明挂 `invalidRecords: 'backup-and-skip'`：坏记录只挪走那一条，别让整个插件黑屏
113. **临时目录的"同源"必须按已解析路径算，不能按"磁盘上有没有"算**（FIX-98，真机复验 FIX-88 没生效）：`tempDir` 原来取"文档类**命中项**（磁盘上确实存在的目录）的公共父目录"—— 回滚后的工作区里那些目录一个都不存在 ⇒ 算不出 ⇒ 悄悄退回 `<root>/docs/_临时`（**另一棵树**，正是要干掉的错值）✗。规则：① 公共父目录从**已解析的路径集合**（`docKinds` / `docsDirs` / `deliverablesDir`）算，**不看 `exists()`**；② 重探时对"磁盘上没命中"的位置**沿用 `project.json` 记的类别位置**（`prefer`）—— 缓存里的位置才是这个项目的事实，只按 `exists()` 推会把类别整批挪到另一棵树；③ 确实算不出才退回默认，且**在 notes 里说明原因**；④ **递增 `PROJECT_LAYOUT_VERSION`**：版本号一样就永远不重探 ⇒ 已经写回磁盘的错值会固化 ✗（递增后旧值被重算并写回）
114. **宿主的"单例"只到会话作用域，跨会话不可达时一律新建**（FIX-99，真机：整个项目的馆员一个都不可用）：宿主可续派子会话只接受**它自己的父会话**投递（`continuation-activation.ts:309/475`：`belongs to another parent session`）⇒ FIX-79 的"一个常驻实例服务所有任务"在**跨会话**时不可能；旧复用判据又只看"名字对 + 有会话 id" ⇒ 遇上"底层是一次性实例"仍判可复用 ⇒ 派单被拒、文档整理整条链卡死 ✗。规则：① **复用判据收紧**：名字对 + `mode: continuable` + 有会话 id + 会话**未被归档** + 会话**属于本会话**；其余（跨会话 / 一次性 / 已退役 / 无会话 id / owner 已归档）一律视为不可复用；② **绝不允许"被拒"**：不可复用或续派被宿主拒时 ⇒ **本会话新建**，并把旧实例标 `retired`（记录保留、`retiredReason`/`retiredAt` 留痕）；③ **一个角色在一个项目内最多一个 `active`**（新建前把同角色的其它活跃常驻退役；同名退役记录不得抢"在用那条"的位 —— 成员文档按 id 存，`getMember(name)` 会撞上退役那条）；④ **全局共享文件**（坑库索引 / 核心数据库目录 / 派生态索引 / 归档目录 / 面板快照）随派单回执带出并写进馆员角色卡（"写前先查占用"）；跨会话并存或同文件声明由 `occupancy_conflict` 报出（含"同角色多活跃常驻"这条新判据）
115. **绕过契约的派单必须能被检测；确需绕过先"提权"**（FIX-100，用户提议）：真机观察 —— 契约工具一不可用（馆员跨会话不可达 / 报错），主代理就改用**宿主的普通派单**绕过契约，而那条路**完全不留痕**：台账查不到、审计报不出、面板看不见 ⇒ "契约工作流"被静默架空 ✗。两条机制：① **检测**（警告制）：把**会话树里的子代理会话**（`sessions.list()` 的活会话，有 `parentSession` 的那些）与**台账成员记录**做差集，差集里的就是绕过契约派出去的 ⇒ `uncontracted_dispatch`（黄），报出能拿到的信息（会话 id / 父会话 / 时间）并给建议；归档会话同 FIX-84/90 口径跳过；② **显式降级通道**：新工具 `contract_request_escalation(reason, scope?, taskId?, until?)` —— 理由**必填**，写进第四个领域 `agent_contract_escalations`（留痕 + `contract_status` 的「提权申请」行看得见），覆盖规则写清：作用域 `session`（默认）/`task`（要 `taskId`）/`once`（只覆盖之后第一个），`until` 到期失效，且**只管它之后派出去的**；有提权 ⇒ 标「已提权」（`info`，不计红黄），没有 ⇒ 报黄；③ **规矩写在 agent 一定读得到的地方**（`contract_status` 的「下一步姿势」+ 提权工具描述 + 派单工具报错时的四条替代路径）：「所有子代理派单都走 `contract_delegate_*`；确需绕过先提权」—— 契约工具报错时必须给出"为什么 + 可以怎么办（重试 / 看版本漂移并完整重启 / 先提权再绕过）"，**别让主代理只能自己瞎试到偷偷绕过**
116. **"归档了但还在报"的两个盲区：父链的**数据源**与**过滤的粒度**（真机："审计区还会引用源自归档的对话"）：FIX-84/90 让审计认"用户归档的会话"，但真机上一条都没过滤掉 —— 两个盲区：① **父链只问活会话**（`sessions.get()` 是 `list()` 的活会话表，`packages/core/session/src/index.ts:1227`）—— 而**归档对话里的子代理会话早就不是活的了** ⇒ 子会话→父会话的链一断，存量成员就被当成"没归档"照旧报出来 ✗；**修正**：父链改从**会话持久化**建（`sessionPersistence.list()` 返回所有已落盘会话的 header，含已结束的），拿不到才退回活会话（降级不抛错）。② **只按成员名过滤**：`task_file_missing` / `doc_file_missing` / `orphan_task` 这类条目的 target 是**任务号或路径**，它们同样来自那些对话 ⇒ 得顺着 owner 回溯到成员再判；**修正**：审计条目统一过后置过滤（target 是成员名 / 是 taskId 取任务 owner / 是路径取文档 owner），面板待办（B 区）同样按 `archivedOwners` 滤掉归档对话的任务。**过滤必须留痕**：滤掉了什么要进 `archivedFiltered` 并在人话报告里写「另有 N 条源自已归档对话的条目已过滤」—— 不许让条目"报着报着少了几条"；三处（审计工具 / 面板刷新 / 启动自愈）共用同一份索引，别让谁还在用活会话那份
117. **规范/路径/索引/普查必须同源；续派只发增量**（FIX-101~104）：① **契约里也要有「文档规范」段**（与 `contract_status` **同一个** `docSpecLines()`）—— 真机根因不是"缺规范"而是 **agent 在仲裁矛盾**（"`project.json` 说 X、规范说 Y，哪个算数？"）⇒ 于是去 grep `app.asar`、读插件源码 ✗；治本三件套：**本轮解析结果（绝对路径）+ 权威顺序（① 契约 ② 显式配置 ③ 探测；派生物过期以①为准）+ 不一致的处置（按①执行并标注上报）**，禁令降级为说明（"不必读插件源码/宿主源码"）· ② **建索引不该读全文**：机读字段（路径/档级/任务号/标题/字数/关键词/relatedFiles/legacy/归档/待办码）派生器早算过 ⇒ 给 `doc_census` 一次拿全量；纪律写进角色卡（先普查 · 需要正文时先读头部 · 连续整篇读超 5 篇先回报）· ③ **每个类别都要有索引**：八类各一份 `<类别目录>/索引.md`，机器区块由派生器生成、**只在该区块内增删**、幂等；缺口由 `missing_kind_index` 报黄 · ④ **四者（doc_census / 各类索引 / 派生态索引 / 契约规范段）取同一份派生结果**（`documentCensus()`），源码级断言守着，不许各扫一遍盘 · ⑤ **续派只发任务切片**：常驻成员第一次已有完整契约 ⇒ 后续只发【本轮任务切片】（指纹 = 插件版本 + 契约格式版本 + 角色 + 项目；**指纹变了才**补发「契约已更新 + 变化段」），回执写明"只发切片 N 字"—— 契约软限 6000 字，续派 10 次 = 6 万字白烧 ✗
54. **面板不留说明性文字占版面**（FIX-45，用户口径）："只读视图…""徽章符号：…""数据源为空不是过滤造成的"这类**解释性文字**撤出页面（信息归 README / DESIGN），但**能力不减**——诊断（没读 vs 读了没有）挪进审计条的 tooltip，五态符号对照折叠在「徽章说明」里，跳转与徽章名仍在格内可视
106. **参数不许改变"实例模型"**（FIX-94，用户拍板 B）：真机链条是"主代理想拿结果 → 传 `run_in_background: false` → 落前台分支 → **另起一个没复用常驻会话的实例**"（FIX-93 只保住了名字与身份，没保住实例，白烧一份上下文）。规则：**常驻单例角色忽略 `run_in_background`** —— 传 `true`/`false`/不传一律走常驻路径（创建或续派），"一次性代跑"分支对单例**不可达**；"要结果"改走**派完读产出档**：描述与回执都要写明这轮落在哪个**产出档目录 / 进度档**、怎么确认它做完（读档 / `audit_scan`），并在调用方传了 `false` 时明确告知"该参数对常驻角色**无效（已忽略）**"。**已核宿主**：`sendMessage` 的 options 只有 `{ signal }`（`packages/subagent/subagent/src/types.ts:70`），返回**投递确认**而非答案 ⇒ **没有"等这一轮结束"的能力**，所以只能两段式（不许发明一个做不到的 `awaitCompletion`）
107. **"重启就好了"是最容易被用户误信的兜底**（FIX-95，真机 22:43 重启后 `panel.json` 一个字节没动）：自愈（"写入方版本 ≠ 当前版本 ⇒ 立刻重写"）原挂在**会话出现**上 —— 多工作区 + 零配置时，启动这一刻推不出"当前项目"（没有会话），用户重启后**还没开工**就一次都不触发 ✗。规则：① 启动自愈要**扫宿主已登记的全部工作区**（`workspaceRegistry.list()`），"谁的快照写入方版本旧就重写谁"——**这件事不需要会话**；② 只重写**已存在**的快照（没有快照的工作区**跳过**，启动自愈不许在别人的仓库里凭空造文件），版本已是最新则**不重写**（幂等）；③ 每一档结果（重写 / 已最新 / 跳过 / 失败）都要**留痕**并进 `contract_status` 回执（"重启为什么没恢复"必须一眼可查）；④ 空态文案要与行为**一致**：把"唯一可靠的动作"说在最前面（跑 `audit_scan` / 派一次活），重启只在"快照由旧版插件写入"时才补写 —— 不许让用户以为重启能解决一切
108. **三处同源：一个动作只能有一份实现**（FIX-96，用户明确约束）："跑审计 + 重写面板快照"有三个入口 —— 主代理的 `audit_scan` 工具 / 启动自愈的补算 / 面板「强制刷新」按钮。三处各写一套 ⇒ "面板上的红黄"与"工具回执里的红黄"迟早对不上（本项目因口径漂移返工过数轮）。规则：① 唯一实现在 `src/panel/refresh.js`（`runPanelAudit` 只算不写、`refreshPanel` 算完即写，归档会话与父链两个宿主事实也在这里统一注入）；② 三个调用点**只许调用**它，源码级断言守着（工具与自愈的源码里都不许再出现 `auditScan(`）；③ 人的那条路（面板「强制刷新」）走**已有的待办写路由**（`action: 'force-refresh'`）—— 白名单与 Host 栅栏**照旧**，不新增暴露面；④ 人的按钮要有：进行中**禁用** + 文案"正在跑…"、防连点最小间隔、成功一句回执（"审计完成：红 N / 黄 M；面板数据已重写"）并**立刻重读**、失败带 code 与原因**可见**；⑤ 两个按钮的文案必须分得开：「↻ 刷新」= **只重读**（不动数据），「强制刷新」= **跑审计 + 重写**（会改磁盘）

38-c. **索引只在标记区块内合并，且两遍幂等**（FIX-23 / §9-28 的落地口径）：机器内容只活在 `<!-- agent-contract:index:start/end -->` 之间，区块外一个字节不动；无标记的历史手工档只**追加**区块、绝不重排；`+N/-M` 里 `-M>0` 必须列出被删内容；内容没变就不写（免得备份目录被噪声塞满）
39-c. **"复核过"也是事实，必须盖章**（FIX-25 / §9-33 的落地口径）：tags 步骤即使一个关键词都不用加，也要写 `librarianTouchedAt`/`librarianChanges`，否则审计下轮报同一篇；但**不得改台账 `updatedAt`** —— 档龄算的是**内容**年龄，否则会把待归档的老档"洗白"
11-c. **link 安装的插件必须自己 `npm install`**（源码目录要有 `node_modules`）：`@deepseek-ai/schemastery` 是真实依赖，
    宿主不提供；只有 `@deepseek-ai/dsh-tools` 由宿主加载器提供。漏装表现为「组件启用失败 … failed to import」，
    排查见 §6.4 坑 0。**改 package.json 的依赖后要重跑一次 `npm install`**

---

74. **任务单的读者是「派单者」，不是「执行者」**（2026-10-03 实测翻车）：任务单只写"守哪套纪律"而不写"谁执行"，读者必然默认自己就是执行者（实测：主代理读了 T53，直接自己去跑馆员的 `librarian_sweep`）。规则：① 任务单**必备「执行者」段**（谁干 / 谁派 / 谁确认），步骤写成"**谁做**"而不是祈使句；② **角色专属工具必须在工具描述里声明归属**（"面向图书管理员；主代理应委派，不得直调"），主代理直调时回执要带明确警告（严格模式可拒绝）；③ 纪律写在角色卡里 ≠ 有人会去执行——**"谁"必须显式写出来**，否则"空着的椅子"会被最近的人坐下
85. **角色实例模型分两类（2026-10-03 用户拍板）**：`librarian` = **常驻单例**（一个会话服务所有任务；首次调用创建，之后一律**续派**；忙时**排队**且可见）；`researcher`/`implementer`/`reviewer`/`adversary` 保持**按任务实例**。**理由不是整齐，而是并发安全**：馆员动的全是**全局共享文件**（坑库 README、派生态索引、核心数据库索引、交叉引用、归档目录），多实例并行必然**互相覆盖**（插件自身踩过：`坑/README.md` 被整篇覆盖且无备份）。常驻成员的**成员记录只有一条**（无 `taskId`）；任务/进度/产出的归属仍由文档 front-matter 的 `taskId` 承载；依赖「成员—任务」绑定的审计口径（`ghost_run` / `orphan_task` / `unreleased_run` / `occupancy_conflict`）须按此重新对齐
102. **凡与"宿主侧事实"打交道的判定，先确认 id 形态与关系链（2026-10-03，第四次撞上）**：本插件已连续四次因"自己的记录/判定"与"宿主的真实事实"不一致而出错 —— FIX-59（成员记录缺实际模型 → 异源判不出）、FIX-71（台账有记录、磁盘无文件）、FIX-73（快照投影丢 mode → 面板显示"未知"）、FIX-84/90（归档判定：id 前缀不一致 + 只看自身会话、没按父链上溯）。规则：① 对接宿主任何 id 集合前，**先核对该 id 的形态**（顶层会话 `session-<uuid>` vs 子代理会话裸 `<uuid>`）；② 涉及"归属/继承"关系（父会话→子会话）时**按关系链上溯**，不要只看自身；③ 拿不到关系链时**降级为现状并给警告**，绝不静默变成"什么都没命中"
103. **派生物的三条自检（2026-10-03，FIX-91/92/93 同一轮真机暴露）**：面板快照、`project.json`、成员记录都是**派生物**，它们各自栽在同一种思维上 —— ① **占位被当成结论沿用**（快照的 `placeholder` 一代代传下去 ⇒ 一次占位 = 永久空）；② **修正被无关门控挡住**（"要不要建目录"的 `ensure` 挡住了"要不要修正过期派生物"，于是启动那条只读路径永远不写回）；③ **同一实体长出第二个身份**（前台一次性分支不看 `singleton` ⇒ 常驻馆员旁边多出一个带任务号的"一次性馆员"）。规则：派生物要**区分"没有结论"与"结论为 0"**（占位必须自带动作且不可沿用）· **写回/修正只受它自己的开关约束**（不写回必须说明原因）· **有唯一身份的实体在每条路径上都要先查再写**（复用失败要说原因，且不许覆盖既有身份的关键字段）
106. **派生物必须挂在"必然发生"的事件上刷新（2026-10-03，第五次同类问题的总结）**：今晚连续撞到同一模式 —— 插件侧的记录/派生数据（快照、台账、project.json）落后于事实，而"何时更新它"没有明确责任点：FIX-83/92（重探了但写回被 `ensure` 门控 ⇒ 磁盘永不更新）、FIX-91（占位被沿用 ⇒ 一次占位永久空）、FIX-95（版本不符也不重写 ⇒ 面板长期"数据源待接"）、FIX-84/90（归档判定缺父链上溯与 id 形态归一化）。**规则**：凡是"磁盘上的派生物"（快照 / 元数据 / 索引），刷新必须挂在**必然发生的事件**上 —— **插件注册完成、面板请求、自身版本变更、宿主事实变化**；**不得**只依赖"碰巧有动作时顺手写"（那样"没动作"就等于"永远不更新"，而用户只会看到"空/待接"，无从判断）
## 10. 开放问题（不阻塞 M1）

1. 对抗源接入方式（GLM/Qwen 路由与凭据）——先按 `modelRoutes` 留位
2. ~~台账存储最终选型~~ **已定**：宿主 `ctx.storageDomain` + `json` 后端（见 §5.5「存储（已定）」）
3. 配置的设置页 UI（M3 面板顺带做，或先手填 `cordis.patch.yml`）

---

## 附录 A：源规范（必须逐字迁移的本体）

### [1] 总纲

1. **核心原则与传递性**：本提示词内容具有传递性。创建子 Agent 时，必须将 [1] 至 [2] 中的所有内容作为初始提示词完整提供给子 Agent。子 Agent 必须严格遵守 [1] 至 [2] 中的所有内容。
2. **进度管理**：在 `[Agent进度]` 目录下建立并维护 `.md` 文件，文件名为任务名。该文件用于描述子任务并实时推进任务进度。文件总字数不得超过 400 字。
3. **前期调研与阅读**：执行任务前，阅读 `[任务]` 的通用剧情摘要和项目简介。初步探索项目后，阅读 `[位置]` 文件夹下的 debug 文件，并根据初步判断选择并阅读相关文件。
4. **任务执行**：阅读上级 Agent 所指定的任务文件。
5. **产出规范**：任务完成后，需清理并产出三档文档，信息库维度由小到大依次递增：
   - 5.1 **第三级文档**（高度概括）：主要信息、改变、成果精简。字数限制：250~300 字。
   - 5.2 **第二级文档**（扩充细节）：在第三级文档基础上，增加变量、物品及状态等内容，并保存。
   - 5.3 **第一级文档**（详细归纳）：作为任务详细归纳，保存于 `[位置]`。无字数限制，原则上不多于 3000 字。
6. **文档流转**：第三级文档以文字信息形式直接发给上级 Agent。第二级文档发给 `[上级]` 级 Agent。
7. **异常处理**：若遇严重 Bug 或上级 Agent 指定修改的 Bug，在修改成功后，需将修改总结生成 `.md` 文件，并存于 `[位置]`。
8. **子 Agent 管理**：若该层 Agent 数量 ≤4 且总 Agent 数量 ≤20，遇到过于复杂的问题时应分裂子 Agent。你应为下一级子 Agent 配置所有该提示词中方括号 `[]` 内的信息。

### 2』状态信息

- 当前层数：`[层数]`
- 当前总 Agent 数：`[总Agent数]`

### 补充约定（来自原始使用经验）

- 验证环境由上级 Agent 控制，上级由主 Agent 控制（验证环节灵活复杂，故不写进流程）
- 失败处理沿用宿主自带机制
- 上级可阅读下级三档文档；保存位置的**绝对路径统一贴在第三级文档**，上级一般不需要看最详细的一级文档
- 层级在模组迁移场景影响不大（任务天然模块化、连锁操作少）
