# M3+M4 合并审查报告（审查方：主代理 / reviewer 视角，未动手修）

> 依据 `D:\DSH插件\dsh-agent-contract\docs\REVIEW-M3M4.md` 的报告格式交付。
> 铁律遵守声明：① 未放宽/删除任何断言 ② 未修改任何既有源码或项目文档（本轮只新建 `.review-tmp/` 下的夹具与本文）③ 拿不到的前提一律标「未核验 + 原因」。
> 审查时点：2026-10-02 22:1x。工作树 = `D:\DSH插件\dsh-agent-contract`（`C:\Users\flafk\.dsh\profiles\desktop\node_modules\dsh-agent-contract` 是指向它的**符号链接**，两者同一份文件，已用 SHA256 比对确认）。

**审查基线（哈希锚点，审查期间未漂移）**：审查开始与结束两次取样一致，故本报告对以下修订有效。

| 文件 | SHA256 前 8 位 | mtime |
|---|---|---|
| `src/contract/roles.js` | `E1F10E45` | 21:58:28 |
| `src/delegation/channels.js` | `A8D9669C` | 20:09:24 |
| `src/client/tab.js` | `FE2B5A86` | 22:02:56 |
| `src/tools.js` | `4FB20707` | 22:02:29 |
| `src/panel/snapshot.js` | `B8F968EB` | 22:02:03 |
| `scripts/verify.mjs` | `939F887C` | 22:03:43 |

（注意：这些写入时间集中在本轮审查开始前几分钟，而宿主的插件加载早于其中部分写入 → 见 A7 附注 FIX-11。）

---

## A 组 · 机器核验

### A1 canonical 套件 —— ✅ 通过（但有断言缺口）

```
命令: node scripts/verify-node.mjs    （workdir D:\DSH插件\dsh-agent-contract）
exit code: 0
OK 1 插件四件套 … OK 46 cordis.patch.yml 可解析 + 关键值
ALL CHECKS PASSED
```

- 报告项数：**46**（套件内 `ok()` 调用数 46，与输出逐条对齐）。
- 新增断言归属：OK 30–33 → FIX-1~FIX-4；OK 34–37 → M2.5；OK 38–39 → M3；OK 40–43 → M4 四项交付物；OK 45 → FIX-5；OK 46 → 配置可解析。
- **缺口（记入新缺陷）**：在 `scripts/verify.mjs` 中检索 `FIX-6|FIX-7|unknown global tool|显示全部` → **0 命中**。FIX-6、FIX-7 各自的「验收（补测试）」三项**全部没有落地**。套件绿灯不能作为这两项修好的证据。

### A2 警告制（跑前后条目数+字数完全一致）—— ✅ 通过

```
命令: node .review-tmp\a2a3a4a6.mjs   （内存台账桩 + 真实项目 D:\Blockdustry，只读磁盘）
SAME  仓库/docs    files 179->179  bytes 1248025->1248025
SAME  [Agent进度]  files 2->2      bytes 1308->1308
SAME  仓库/src     files 757->757  bytes 1461044->1461044
level=yellow red=0 yellow=25 items=25 failedChecks=0
byCheck= {"doc_misfiled":22,"over_budget":1,"stale_progress":2}
```

条目数与字节数**逐目录完全一致**，未抛错。方法说明：`audit_scan` 未在运行时注册（见 A7 附注），故按插件自身代码路径在进程内运行**同一个** `auditScan`，对**真实项目**取样；store 为内存桩，全程无写盘。

### A3 未知检查项必须报错 —— ✅ 通过

```
=== A3 未知检查项 ===
THREW: agent-contract: 未知的 audit.checks 项 bogus_check_xyz
       （可用项：missing_doc、ghost_run、orphan_task、over_budget、unfilled_slot、stale_progress、
         cross_vendor、unreleased_run、doc_misfiled、doc_meta_missing、doc_tags_stale、archive_suggest）
```

- **未改动任何配置文件，因此无「还原」动作**（本项无需还原，也不存在残留）。
- 方法说明：运行配置来自插件自带的 `cordis.patch.yml`，由宿主**启动时**读入——改文件对运行中的进程无效，且该文件属既有文件（铁律②）。故改为把同一 config 对象喂给同一入口 `auditScan` / `assertKnownChecks`，语义等价。
- 交叉证据：套件 `verify.mjs:1329` 同断言（`M4-1：未知检查项必须报错`）。

### A4 humanReport 可读（2 条原文）—— ✅ 通过

```
审计结果：黄 —— 共 25 条待处理（检查项 12 项）。

待处理清单（按严重度）：
1. [黄] D:\Blockdustry\仓库\docs\^修改-钻头侧面贴图应用.md
   原因：docs 根目录散文件
   建议：由图书管理员迁移到对应类目录（改名 + 更新引用 + 留痕）
2. [黄] D:\Blockdustry\仓库\docs\^单位工厂与单位.md
   原因：docs 根目录散文件
   建议：由图书管理员迁移到对应类目录（改名 + 更新引用 + 留痕）
```

路径 + `原因：` + `建议：` 三段齐备。

### A5 12 项检查正反例 —— ✅ 通过（引用套件断言）

`CHECK_IDS.length === 12`（`verify.mjs:1331`）。逐项正反例（断言名 → 行号）：

| # | 检查项 | 正例（命中） | 负例（不命中） |
|---|---|---|---|
| ① | missing_doc | `hasTarget('missing_doc','T-601-impl')` L1416 | `T-602/T-603-impl` 有档不报 L1417-1418 |
| ② | over_budget | `T-608_long_L3.md` L1420 / `T-609_huge_L1.md` L1421 | `T-602_a_L3.md` L1422 |
| ③ | unfilled_slot | 毒契约 `假契约` L1428 | 真实契约 0 条 L1424；`[Agent进度]` 真目录名不误报 L1431 |
| ④ | stale_progress | `T-601.md` 500 字 L1433 | `T-602.md` 短进度 L1434 |
| ⑤ | cross_vendor | 同模型 `T-604-adversary` L1436 | 异源 `T-605-adversary` L1437 |
| ⑥ | ghost_run | one-shot 无产出 `T-601-impl` L1439 | 常驻 `T-602-impl` L1440 |
| ⑦ | orphan_task | `T-606-rev` + 任务 running L1442 | `T-607-rev` 任务已结 L1443 |
| ⑧ | unreleased_run | 未 released `T-601-impl` L1445 | 已 released `T-603-impl` L1446 |
| ⑨ | doc_misfiled | docs 根散档 `散档.md` L1448 | （只报正例，不动文件） |
| ⑩ | doc_meta_missing | 缺小节 `T-610_meta_L3.md` L1450 | legacy L1451 / tier0 L1452 不参与 |
| ⑪ | doc_tags_stale | `T-613_stale_L3.md` L1454 | `T-614_fresh_L3.md` L1455 |
| ⑫ | archive_suggest | 200 天前 + 任务已结 L1457 | 新档 L1458 |

补充：L1461-1474 另有 level/counts/item 形状、humanReport 含原因+建议、跑前后快照一致、不抛错、未开启项不执行等断言。

### A6 阈值可配 —— ✅ 通过

```
命令: node .review-tmp\a6snap.mjs   （临时项目根 .review-tmp\proj）
archiveAfterDays=90 -> 1 条: T-700_old_L3.md
archiveAfterDays=1  -> 2 条: T-700_old_L3.md, T-700_mid_L3.md
```

调小阈值 → 归档建议增多（10 天档被纳入），单调性成立；夹具用后清理。

**观察（非缺陷，但需注意）**：在**真实项目**上 90 与 1 都返回 0 条。原因是 `rebuildLedger` 对所有任务统一写 `taskRecord({status:'open'})`，而 `archive_suggest` 要求「任务已结」——真实数据上没有任务处于已结态，故该检查在真实项目上**恒不触发**。阈值本身没问题，是数据前提不满足。

### A7 FIX-6 —— ❌ 失败

**① 工具名是否全部存在于宿主工具目录**

核对方式：取**运行时** known global tools（宿主在 `tools.restrict()` 报错里逐字给出）∪ 当前 `src/tools.js` 注册的 13 个插件工具名，与每个内置角色 `roles[].tools` 求差集。

运行时宿主工具目录（原文，节选）：

```
ask_user_question, bugfix_note, contract_delegate_adversary, contract_delegate_implementer,
contract_delegate_librarian, contract_delegate_researcher, contract_delegate_reviewer,
contract_status, create_goal, create_skill, doc_emit, doc_search, edit, exit_plan_mode, get_goal,
glob, grep, image_generate_88api, image_key_88api, image_model_88api, interrupt_agent, job_kill,
job_list, job_output, ledger_backfill, ledger_rebuild, librarian_backfill, librarian_patrol,
list_agents, load_workspace_dependencies, present, progress_upsert, pwsh, read, read_image,
send_message, sidebar_open, skill, subagent_fork, todo_write, update_goal,
vision_toolkit_activate, web_fetch, web_search, workflow, write
```

插件当前注册的 13 个工具（`src/tools.js`）：`contract_status, doc_emit, progress_upsert, bugfix_note, ledger_rebuild, librarian_patrol, librarian_backfill, ledger_backfill, librarian_sweep, librarian_glossary, librarian_archive, audit_scan, doc_search`。

差集结果：

| 角色 | 不存在的工具名 | 判定 |
|---|---|---|
| researcher | （无） | ✅ |
| implementer | **`bash`** | ❌ 既不在宿主目录，也不在插件工具表 → 永久错误 |
| reviewer | （无） | ✅ |
| adversary | **`session_search`** | ❌ 同上；且 `roles.js:37` 的「检索阶梯」第 5 条仍在教子智能体用这个不存在的工具 |
| librarian | `librarian_archive` / `librarian_sweep` / `librarian_glossary` | ⚠️ 在**运行时**目录里没有，但在**当前工作树** `tools.js` 里已注册 → 属宿主未重载（见附注），非源码错误 |

**② 注入不存在的工具名 → 只 warning、通道仍能 start**

- 代码核对：全仓只有一处 `toolFilter`（`src/delegation/channels.js:241`）：
  `...(role.tools && role.tools.length ? { toolFilter: { allow: [...role.tools] } } : {})`
  —— **原样下发，无求交集、无 warning 分支**。全仓检索 `未知工具|unknownTool|toolNames|剔除` 在工具白名单语境下 0 命中。
- 运行时实证：派后台实现者 → `Error: tools.restrict() names unknown global tool "bash"`（硬失败，复现 2 次，见 B3）。

**结论：修法 1（改正名字）与修法 2（装配期校验防线）两层都没做 → A7 ❌ 失败。**

### A7 附注（本轮最重要的方法论事实）：运行中的宿主加载的是**旧版插件**

铁证三条：

1. 运行时 known global tools **缺** `audit_scan` / `librarian_sweep` / `librarian_glossary` / `librarian_archive`，而这 4 个都已在当前 `src/tools.js` 注册；
2. 触发运行时的 `ledger_rebuild` **没有**生成 `.agent-contract/panel.json`（见 B1），而当前源码 `tools.js:413` 明确调用了 `writePanelSnapshot`；
3. 文件时间线吻合：`cordis.patch.yml` 21:53 → `roles.js` 21:58 → `tools.js`/`tab.js`/`snapshot.js`/`verify.mjs` 22:02~22:03，宿主启动早于 22:02 这一批写入。

**推论：所有 B 组运行时证据测的都是旧版插件，必须重启 DSH 后重测，否则 A7/B1/B3/B5 的运行时结论只代表旧版。**

### A8 FIX-7 —— ❌ 失败

- **断言**：套件无 FIX-7 断言（0 命中）。
- **实测/代码**：
  1. **mode 仍用近似，未改权威来源**：`src/client/tab.js:132-137`
     ```js
     function deriveMode(row, info) {
       if (info && (info.mode === 'one-shot' || info.mode === 'continuable')) return info.mode
       if (!row) return 'unknown'
       if (row.origin !== 'subagent') return 'continuable'
       return row.agentAvailable === true ? 'continuable' : 'one-shot'   // ← 正是 FIX-7 禁止的近似
     }
     ```
     全仓检索 `subagentCatalog` → **0 命中**。修法①未做。已结算的 continuable（`agentAvailable=false`）仍被判成 `one-shot`。
  2. **空态无自救入口**：`tab.js:465` 只渲染一行文字 `'当前过滤条件下没有可显示的节点。'`，**没有「显示全部」按钮**。修法②未做。
  3. **投影缺失不保 unknown**：`deriveMode` 对 subagent 行永不返回 `'unknown'`，必落 `one-shot`/`continuable`。修法③未做。
- **最小复现（已跑，实测输出）**：夹具 `.review-tmp/c2mech.mjs` 用套件同款 `vm` 方式加载 client：
  ```
  A items=[]            : roots=0 members=0 过滤后行数=0 空态=true
  B items 不含 scope    : roots=0 members=0 过滤后行数=0 空态=true
  C 血缘正常(无投影)    : roots=1 members=2 过滤后行数=1 空态=false   ← FIX-7 机制坐实
  C2 血缘正常(有投影)   : roots=1 members=2 过滤后行数=2 空态=false
  ```
  C 行即「投影拿不到 → 已结算 continuable 被判 one-shot → 默认过滤吃掉」；C2 行说明投影在时不会。
- ⚠️ **但用户实测的「什么也没有」并不是这条机制，见下方 C2 与 FIX-12**：截图显示面板头部是 **「成员 0」**，而 `成员数 = flattenNodes(roots).length`（`tab.js:238, 456`）是在**过滤之前**算的 —— 成员 0 意味着 `roots` 本身就是空的，与 `hideDoneOneShot` 无关。FIX-7 即使修好，面板**仍然会是空的**。

---

## B 组 · 运行时核验

### B1 快照真生成 —— ❌ 失败（未生成）

```
触发: 调用运行时 ledger_rebuild
回执: 台账已重建：文档 106 篇（删除 0，legacy 100）· 任务 54 条（删除 0）· 成员新增 0（共 5）

检查: Test-Path D:\Blockdustry\.agent-contract\panel.json  ->  False
      Get-ChildItem D:\Blockdustry\.agent-contract           ->  目录不存在
```

- `audit_scan` 在运行时**未注册**，无法作为触发器；`ledger_rebuild` 是唯一可达触发器。
- 路径正确性已单独核验（排除「路径算错」）：`resolveProject(root=D:\Blockdustry)` + `joinUnderRoot(root,'.agent-contract/panel.json')` → `D:\Blockdustry\.agent-contract\panel.json`（exists=false）。路径是对的，是**没人写**。
- 根因：运行中的 `ledger_rebuild` 早于当前源码（`tools.js:413` 才有该调用）→ 见 A7 附注。
- **文件头部 30 行：无法提供**，因为文件不存在（不伪造）。

**B1 附（函数级旁证，非运行时）**：把 `writePanelSnapshot` 直调在临时项目根上：

```
ok=true path=D:\Blockdustry\.review-tmp\proj\.agent-contract\panel.json error=(none)
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-02T14:11:31.030Z",
  "project": { "name": "ReviewFixture", "root": "D:\\Blockdustry\\.review-tmp\\proj" },
  "audit": { "level": "yellow", "red": 0, "yellow": 1 },
  "counts": { "members": 1, "tasks": 1, "docs": 2 },
  "members": {
    "T-700-implementer": {
      "sessionId": "sess-700",
      "role": "implementer",
      "taskId": "T-700",
      "badges": { "contract": "ok", ...
```

→ 快照**代码**可用（schemaVersion/generatedAt/members 与徽章真值齐备）；**运行时触发**不可用。两者不是一回事，判 B1 失败但根因是宿主版本漂移。

### B2 快照可被面板读取的前提 —— ✅ 通过（部分）

- 落点由 `joinUnderRoot(project.root, '.agent-contract/panel.json')` 推出，`project.root = D:\Blockdustry` → **在工作区内**，client 的 `remote.workspaceFiles.read` 够得着 ✅。
- 本项目是否 git 仓库：`Test-Path D:\Blockdustry\.git` → **False**，**不是 git 仓库**（按特别关注 #2 记录该事实，`.gitignore` 条目跳过；若将来 init 请带上 `.agent-contract/`）。
- 遗留：文件本身当前不存在 → 「读回」前提不成立（见 B1/B5）。

### B3 FIX-6 实测 —— ❌ 失败（复现）

```
调用: contract_delegate_implementer(taskId=T99_契约流程冒烟测试)   ×2（本轮 1 次 + 本会话早前 1 次）
输出: Error: tools.restrict() names unknown global tool "bash";
      known global tools: ask_user_question, ..., pwsh, ..., write
结果: 子智能体从未启动，零改动。
```

两次一致，确定性失败，非偶发。

### B4 FIX-7 实测（前台研究员 + 后台成员）—— ❌ 失败（用户肉眼判据：C2「什么也没有」）

- 数据面证据（宿主持久化台账 `C:\Users\flafk\.dsh\storages\agent_contract_members\`，5 名成员）：
  - `T99_契约流程冒烟测试-researcher`：mode=`one-shot`，status=`completed`
  - `T99_契约流程冒烟测试-reviewer`：mode=`continuable`，status=`running`（子智能体其实早已结算，台账未回写状态——附带观察）
  - 另有 `AC-VERIFY-C6-researcher`(one-shot) / `T52_待办路线图研究-researcher`(derived) / `T-999-researcher`(derived)
- 后台**实现者**因 B3 无法派出，故「后台成员」只能用 reviewer 代替观察。
- 「面板应显示后台成员」属 GUI 观察：用户答复「什么也没有」+ 截图「成员 0」→ **未显示**，判失败。
- 机制说明：**不是** FIX-7 的过滤机制（见 A8 末尾与 FIX-12）。截图里 `成员 0` ⇒ `roots` 为空 ⇒ 血缘数据源/作用域先从根上就空了，连主代理节点都没进来。

### B5 面板链路端到端（快照→读回→pending 消失）—— ❌ 失败（前提缺失）；最终以 C5 肉眼为准

- 无 GUI，**不由我猜**。给出的是代码路径判定：
  - client 只在 `remote.workspaceFiles.read` 成功 **且** `schemaVersion === PANEL_SNAPSHOT_SCHEMA_VERSION(1)` 时执行 `applyPanelBadges` 并置 `node.hasAudit = true`（`tab.js:207-217, 289-302`）；
  - `badgeRow` 的 `pending = !(node.hasAudit === true)`（`tab.js:375`）→ 未接快照时三档/进度/预算渲染成半透明「待接」；
  - 未接快照时 `audit` 为 `{red:0,yellow:0,green:0, placeholder:true}` 且 `notes` 追加 `PENDING_SOURCE_NOTE`（`tab.js:250-254`，`tab.js:58` 版本常量 = 1，与 host `snapshot.js:17` 一致 ✅）。
- 前提 B1 未成立（快照不存在）→ 当前**不可能**出现「pending 消失 / hasAudit=true」。
- **用户截图确认（C5）**：面板底部原样显示 —— `三档 / 进度 / 预算 徽章：数据源待接（对方未写出派生快照 .agent-contract/panel.json）`。即快照接回链路**未生效**，与 B1 一致。
- 另：因面板里没有任何节点（成员 0），五枚徽章**根本没有被渲染出来**，所以「pending 是否消失」在界面上无法逐枚观察，只能靠这行说明判定。判 **B5 失败（前提缺失，已由用户肉眼交叉确认）**。

---

## C 组 · 肉眼核验（用户答复**原样记录**，未代答）

| # | 请用户确认 | 用户答复 / 截图证据（原样记录，未代答） | 判定 |
|---|---|---|---|
| C1 | 右侧栏有「契约」tab，与「任务管理」能区分 | 文字答复 **「有，能区分」**；截图亦可见两个并列 tab「任务管理」「契约」，选中的是「契约」 | ✅ 确认通过 |
| C2 | 树层级默认隐藏已完成一次性 +「显示全部」 | 文字答复 **「什么也没有」**；截图：头部 `契约  成员 0`，正文 `当前过滤条件下没有可显示的节点。`，**没有任何「显示全部」按钮** | ❌ 未通过（树为空 + 无自救入口） |
| C3 | 点节点名跳转 / 悬停看 session id | 答复 **「见图」**；截图里面板**没有任何节点**，无从点击或悬停 | ⚠️ **无法核验**（原因：面板成员 0，无节点可操作） |
| C4 | 五角色配色肉眼可区分 | 未答；截图里没有任何节点被渲染，看不到角色色点与角色标签 | ⚠️ **无法核验**（原因：无节点渲染，配色无处可看） |
| C5 | 五枚徽章都在；三档/进度不再是「待接」灰 | 未答；截图底部原样：`三档 / 进度 / 预算 徽章：数据源待接（对方未写出派生快照 .agent-contract/panel.json）` | ❌ 未通过（仍是「待接」；且无节点，徽章未渲染） |

C 组**直接确认通过 1 项（C1）**，**确认未通过 2 项（C2、C5）**，**无法核验 2 项（C3、C4，均为「面板成员 0、无节点渲染」所致）**，无一项由审查方代答。

---

## 新缺陷（FIX 条目格式）

### FIX-8 FIX-6 未被实施：白名单仍含不存在的工具名，且无装配期校验

- **现象**：`roles.js` 的 implementer 仍写 `bash`、adversary 仍写 `session_search`；`channels.js:241` 把 `role.tools` 原样作为 `toolFilter.allow` 下发，无求交集、无 warning。实测派后台实现者 → `tools.restrict() names unknown global tool "bash"`，通道在 start 阶段硬失败；adversary / librarian 通道按同机制预计同样失败。
- **涉及文件**：`src/contract/roles.js`（L71、L103，另 L119）、`src/delegation/channels.js`（L241）
- **修法**：① `bash` → `pwsh`；`session_search` 删除（宿主无此工具，且 `roles.js:37` 检索阶梯第 5 条要一并改口径）；② 按 FIX-6 修法 2，在 `channels.js` 下发 `toolFilter` 前与宿主实际工具目录求交集，未知名字**剔除 + 记 warning**（进 `warnings` 返回值），不得让 start 硬失败。
- **验收断言**：a) 断言所有内置角色 `tools` ⊆ 宿主工具目录 fixture；b) 注入不存在工具名 → 仅 warning、通道仍能 start；c) 回归：应用内派后台实现者成功。
- **最小复现**：`contract_delegate_implementer(taskId='T99_契约流程冒烟测试')` → 立刻抛 `unknown global tool "bash"`。

### FIX-9 FIX-7 未被实施：mode 仍用 agentAvailable 近似、空态无「显示全部」、投影缺失不保 unknown

- **现象**：已结算的 continuable 成员（`agentAvailable=false` + `completed`）被判成 `one-shot` → 命中默认过滤 `hideDoneOneShot` → 面板空态「当前过滤条件下没有可显示的节点。」；用户实测「什么也没有」。空态无自救按钮；`deriveMode` 对 subagent 行永不返回 `unknown`。全仓无 `subagentCatalog` 引用。
- **涉及文件**：`src/client/tab.js`（L132-137 派生、L343-350 过滤、L458-465 空态）、`src/panel/query.js`（投影字段若需在此装配）
- **修法**：按 FIX-7 三条原样执行：① `deriveMode` 改读 `projections.values.subagentCatalog` 的权威 `mode`，**禁止**再用 `agentAvailable` 近似，缺失时保留 `unknown`；② 空态渲染说明 +「显示全部」按钮（组件内部 override 过滤，不依赖 prefs 读回）；③ `unknown` 默认可见。
- **验收断言**：a) `settled continuable` 默认可见；b) `one-shot + completed` 默认隐藏、关开关或点「显示全部」后可见；c) 投影缺失 → `mode='unknown'` 且默认可见；d) 空态文案 + 按钮存在，点击后树出现。
- **最小复现**：`filterTree([{name:'x',role:'reviewer',mode:'one-shot',status:'completed'}], {hideDoneOneShot:true})` → `[]`；或直接看本会话：真实存在的 continuable `reviewer` 子会话在面板里不可见。

### FIX-10 套件对 FIX-6 / FIX-7 零断言（验收没补成测试）

- **现象**：`scripts/verify.mjs` 46 项全绿，但检索 `FIX-6|FIX-7|unknown global tool|显示全部` → 0 命中；`DESIGN.md` §7 的 M4 行也只声称「46 项全绿」，未提这两条。绿灯被当成修好的证据。
- **涉及文件**：`scripts/verify.mjs`、`DESIGN.md` §7（口径行）
- **修法**：把 FIX-6/FIX-7 的验收断言（见 FIX-8/FIX-9 的验收项）补进套件；`DESIGN.md` §7 补两行状态，未达标不得写 ✓。
- **验收断言**：套件出现 `OK FIX-6 …` 与 `OK FIX-7 …` 两项，且故意回退实现时该两项变红。
- **最小复现**：`Select-String scripts\verify.mjs -Pattern 'FIX-6|FIX-7'` → 无输出。

### FIX-11（流程级）运行中的宿主与工作树版本漂移，运行时证据全部失真

- **现象**：工作树 22:02 已加入 `audit_scan`/`librarian_sweep`/`librarian_glossary`/`librarian_archive` 与 `writePanelSnapshot` 调用，但运行时 known global tools 里没有这 4 个工具，运行时 `ledger_rebuild` 也不写快照。B 组五条里三条因此失效。
- **涉及文件**：`D:\DSH插件\dsh-agent-contract\src\tools.js`、`src\panel\snapshot.js`（宿主加载时机问题，非源码错误）
- **修法**：B 组核验前**重启 DSH** 让插件重新加载；并在报告/文档里注明「运行时证据必须标注宿主加载版本」。
- **验收断言**：重启后 `audit_scan` 出现在运行时工具目录；跑 `ledger_rebuild` 或 `audit_scan` 后 `D:\Blockdustry\.agent-contract\panel.json` 存在且含 `schemaVersion`/`generatedAt`。
- **最小复现**：派任意角色触发 `tools.restrict()` 报错，读其中的 known global tools 列表，对比 `src/tools.js` 的注册名。

### FIX-12（**本轮新发现，比 FIX-7 更靠前**）面板「成员 0」：血缘树从根上就是空的，FIX-7 修好也不够

- **现象**：用户截图显示 `契约  成员 0` + `当前过滤条件下没有可显示的节点。`。而 `成员数 = flattenNodes(roots).length`（`tab.js:238` 计算、`tab.js:456` 渲染）是**在默认过滤之前**算的 —— 成员 0 只能意味着 `roots` 本身就是空数组。也就是说：**面板里连主代理节点都没有进来**，这与 `hideDoneOneShot` 完全无关。
- **机理（已实测复现）**：`rootOf(items, scope.sessionId)`（`tab.js:81-92`）在 `items` 里找不到该 sessionId 时**原样返回 sessionId**；随后 `subtreeOf`（`tab.js:95-113`）因 `byId.has(rootId)` 为假返回 `[]` ⇒ `roots=[]` ⇒ 成员 0、空态。触发前提有两个，都还没排除：① `ctx.remote.session.list({})` 返回的 `items` 为空；② `scope.sessionId` 与 `items` 里的会话 id **不是同一个口径**（面板作用域 id ≠ host 会话 id）。
- **额外害处（可诊断性）**：`tab.js:447-450` 的「暂时读不到会话数据 / 当前会话不在可见血缘里」两个降级分支**在这条路径上根本走不到**，全部退化成了「当前过滤条件下没有可显示的节点」这句**误导性**文案，把「数据源空」伪装成「被过滤掉了」，直接指错了排查方向（本轮初判就差点被带偏）。
- **涉及文件**：`src/client/tab.js`（`rootOf` L81-92、`subtreeOf` L95-113、`loadPanel` L310-329、`ContractTab` L446-465）
- **修法**：① 核对 `scope.sessionId` 与 `remote.session.list` 的 id 口径，保证当前会话必然出现在 items 里；② `items.length === 0` 或 `rootOf` 落空时给出**区分性**文案（「读不到会话数据」/「当前会话不在可见血缘里」），不得再落进「过滤后为空」分支；③ 这条不通，C2/C3/C4 都无法真正核验（没有节点就没有层级、没有跳转、没有配色）。
- **验收断言**：a) `items` 不含 `scope.sessionId` → 必须给出「不在可见血缘里」类说明，而**不是**「当前过滤条件下没有可显示的节点」；b) `items` 含 `scope.sessionId` → `成员数 > 0`；c) 真实应用里面板头部成员数 ≥ 1。
- **最小复现（已跑）**：见 A8 末尾夹具输出 A/B 两行 —— `roots=0 members=0`，与截图「成员 0」逐字吻合。

---

## 汇总

| 组 | 结果 |
|---|---|
| **A 组（硬门槛）** | 通过 6 / 8 → **A7、A8 失败** ⇒ **A 组 FAIL** |
| A 明细 | A1 ✅ A2 ✅ A3 ✅ A4 ✅ A5 ✅ A6 ✅ ｜ A7 ❌ A8 ❌ |
| **B 组** | 通过 1（B2 部分）/ 失败 4（B1、B3、B4、B5）——B1/B5 的根因是 FIX-11 版本漂移，B4 由用户截图佐证 |
| **C 组** | 直接确认通过 1（C1）／确认未通过 2（C2、C5）／无法核验 2（C3、C4，因面板成员 0 无节点渲染） |
| **新缺陷** | 5 条（FIX-8、FIX-9、FIX-10、FIX-11、**FIX-12**） |

**总判：FAIL。** 硬门槛 A7（FIX-6）与 A8（FIX-7）均未实施，且套件对这两条零断言，绿灯不构成达标证据。
M4 的四项交付物本体（audit_scan 12 项正反例 + 警告制 + humanReport + 归档阈值 + 馆员一轮治理 + 面板快照**代码**）在 A1~A6 层面**是达标的**；不合格的是 FIX-6 / FIX-7 这两条修复本身。
B 组五条里只有 B2 站得住——B1/B5 受 FIX-11（宿主未重载）阻塞，B3 是 FIX-8 的直接复现，B4 被 FIX-12 拦住。
**另外提醒：FIX-12 尚未被列入任何修复单**，且它是当前用户可见症状（面板空白）的第一因；只修 FIX-7 不会让面板出现任何节点。

### 复核建议顺序

1. 实施 FIX-12（先让面板有节点，否则后面几条肉眼项永远测不了）
2. 实施 FIX-8、FIX-9（源码层）
3. 补 FIX-10 的套件断言 + `DESIGN.md` §7 口径
4. 重启 DSH（解 FIX-11）
5. 重测 B1 / B3 / B4 / B5，并请用户复核 C2~C5

### 审查方未做/未能做

- 未修改任何既有源码或文档（只新建 `.review-tmp/` 夹具与本文）
- 未代答 C 组
- B5 未在 GUI 内确认（无 GUI 通道），按 REVIEW 要求标「需用户肉眼确认」，未猜
