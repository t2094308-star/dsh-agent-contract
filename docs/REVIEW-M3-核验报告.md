# REVIEW-M3 核验报告 —— 「契约」面板（M3）覆盖性核验

> 依据 `D:\DSH插件\dsh-agent-contract\docs\REVIEW-M3.md` 的报告格式交付（该单取代 `REVIEW-M3M4.md` 的 M3 部分与旧 §6 C 组）。
> 铁律遵守：① 未放宽/删除任何断言 ② 未修改任何既有源码或项目文档（只新建 `.review-tmp/` 下夹具与本文）③ 拿不到前提一律标「未核验 + 原因」④ C 组只记录用户答复，未代判。
> 核验时点：2026-10-02 23:5x。

---

## 0. 版本闸门（动态口径）—— ✅ 通过

```
工作树版本（现场读 package.json） = 0.2.3
contract_status 版本            = 0.2.3      → 一致
已注册工具数                     = 18         → 与基准清单逐字一致
```

- 期望值按动态口径**现场读取**（不沿用历史基准号 0.1.3），读取命令与结果：

```
> (Get-Content "D:\DSH插件\dsh-agent-contract\package.json" -Raw | ConvertFrom-Json).version
0.2.3
```

- 18 项清单（`contract_status` 首两行原文）：

```
插件版本: 0.2.3
已注册工具（18）: contract_status, doc_emit, progress_upsert, bugfix_note, ledger_rebuild,
librarian_patrol, librarian_backfill, ledger_backfill, librarian_sweep, librarian_glossary,
librarian_archive, audit_scan, doc_search, contract_delegate_researcher,
contract_delegate_implementer, contract_delegate_reviewer, contract_delegate_adversary,
contract_delegate_librarian
```

- **运行时工具清单 vs 工作树 18 项比对**：工作树 `src/tools.js` 注册 **13** 个（`contract_status, doc_emit, progress_upsert, bugfix_note, ledger_rebuild, librarian_patrol, librarian_backfill, ledger_backfill, librarian_sweep, librarian_glossary, librarian_archive, audit_scan, doc_search`）+ `contract_delegate_*` 通道 **5** 个 = **18**，与运行时清单**逐字一致**（顺序也一致）。
- **版本漂移情况：无。** 与第 2 轮不同，本轮运行时与工作树完全对齐（版本号、工具名、条数三项全中）。上一轮用户给的期望号 `0.1.3` 落后于实际树 `0.2.3`，已按用户确认「以 0.2.3 为准」执行，闸门通过，B 组正常进行。
- 基线冻结确认：开跑前用户确认「已冻结」，且本轮全程工作树未再变动（见文末基线哈希复核）。

---

## A 组 · 机器核验

### A1 canonical 套件 —— ✅ 通过

```
命令: node scripts/verify-node.mjs      （workdir D:\DSH插件\dsh-agent-contract）
exit code: 0
OK 46 FIX-7 面板 mode：settled continuable 默认可见 / one-shot 默认隐藏 / 投影缺失 unknown 且可见 / subagentCatalog 同源 / 显示全部自救
OK 47 FIX-11 版本可核对：contract_status 打印 pluginVersion + 已注册工具清单（与 tools.js 一致）
OK 48 FIX-15 client 注入 remote 服务名：inject 齐 remote.session/workspaceFiles / remote 缺失走 failed 不伪装 / 空列表走 sourceEmpty
OK 49 FIX-14 快照诊断：未能定位项目根 ≠ 对方未写出 / 未尝试读取与已尝试读取互斥 / 回退 scope 自身 cwd
OK 50 FIX-16 remote 只在注入 ctx 上访问：props.ctx 不带 inject / 数据加载走 remoteCtx / 血缘与快照分步归因 / inject 回归
OK 51 FIX-17 remote 信封解包：{ok,value}/{ok,error} 都处理 / 血缘与快照各自归因 / 裸值兼容
OK 52 FIX-18 运行三修：read 传 sessionId 字符串 / 投影按普通对象取值（label+mode 生效）/ 跳转走 uiWorkspace.openSession / 树形指引
OK 53 FIX-19 面板可读性：全中文名（与角色卡交叉比对）/ 五枚徽章带说明+主代理 na / 定宽列对齐 / 拓扑图布局与切换
OK 54 FIX-20 拓扑交互：卡片底色按角色 / 可拖拽平移 / 徽章说明可折叠 / 视图状态经 tab.meta 持久化（跨 remount 与重载）
OK 55 FIX-21 交互细节：拖拽不选字 / 徽章说明默认收起且更紧凑 / 异源对非对抗角色显示 —（未知仍保留 ?）
OK 56 FIX-22 拓扑视口：fitViewport 纯函数（居中/封顶/下限）/ transform 平移 / 非 passive 滚轮缩放 / 点击与拖动分离 / 缩放控制簇
OK 57 FIX-23 空白利用 + 整卡双击：画布吃掉剩余高度 / 量真实视口 / 双击任意区域跳转且不与背景自适应打架
OK 58 FIX-24 视图变换持久化：clampTf 夹取与校验 / 挂载读回 tf / 手势防抖落盘（滚轮·拖动·按钮）/ 与视图图例同一份 tab.meta
OK 59 FIX-25 UI 状态主存 localStorage（localStorage > tab.meta，冲突以 localStorage 为准）/ 徽章去符号只留彩色文字 + 状态词进 tooltip
OK 60 FIX-26 双击卡片不选字：卡片与文字子节点直接标不可选中 / mousedown preventDefault / 跳转前放下残留选区（失败不干扰跳转）
OK 63 cordis.patch.yml 可解析 + 关键值（含 M2.5 目录分类配置）
ALL CHECKS PASSED
```

- **实际项数 = 63**（第 2 轮为 50，本轮 **+13**）。
- 新增项归属：`FIX-12…FIX-26` 这一批（面板相关的新单修复项）；FIX-13/14/15/16 属本轮 M3 覆盖单直接相关。

### A2 M3 专项断言可检索 —— ❌ **失败（字面口径，1/7 缺）**

```
命令: Select-String -Path scripts\verify.mjs -Pattern "ok\('FIX-"
```

| 要求可检索 | 结果 |
|---|---|
| `FIX-7` | ✅ L1900 |
| `FIX-11` | ✅ L1918 |
| `FIX-12` | ✅ L1376 |
| `FIX-13` | ✅ L1857 |
| `FIX-15` | ✅ L1958 |
| `FIX-16` | ✅ L2056 |
| **`FIX-6`** | ❌ **0 命中**（`Select-String -Pattern "FIX-6"` 在整个 `verify.mjs` 里**无任何匹配**） |

- 事实：FIX-6 的断言面**已被 FIX-13 块接管**（`verify.mjs:1791-1857` 的注释明写「FIX-13【critical】工具白名单 fail-open + 平台解析」），其覆盖强度不低于原 FIX-6；但**字符串 `FIX-6` 在套件里已彻底消失**，按 A2 的字面判据无法检索到。
- 定性：这是**可追溯性（命名）缺口，不是覆盖缺口**。按铁律①「不得放宽断言」，我不把它判成通过；是否需要因此把 A 组整组判 FAIL，**请上层裁定**（改法很轻：在 FIX-13 块首注释补一行「本块取代原 FIX-6」，或补一条 `ok('FIX-6 …')`）。

### A3 fail-open 回归位 —— ✅ 通过

```
verify.mjs:1793  assert.ok(fix13WinRole.tools.includes('pwsh'), 'FIX-13：win32 的终端工具必须解析成 pwsh')
verify.mjs:1795  assert.equal(fix13WinRole.tools.includes('bash'), false, 'FIX-13：win32 上不得再留着 bash（宿主已 disabled）')
verify.mjs:1797  assert.ok(fix13NixRole.tools.includes('bash'), 'FIX-13：非 win32 必须解析成 bash')
verify.mjs:1798  assert.equal(fix13NixRole.tools.includes('pwsh'), false, 'FIX-13：非 win32 上不得留着 pwsh')
verify.mjs:1799  assert.deepEqual(... .filter((n) => n === 'bash' || n === 'pwsh')), ['pwsh'], 'FIX-13：解析后终端名只能有一个')
verify.mjs:1807  assert.deepEqual(resolveToolFilter({tools: declared}, undefined).allow, declared, 'FIX-13：没有目录 → 原样下发')
verify.mjs:1808  assert.deepEqual(resolveToolFilter({tools: declared}, new Set()).allow, declared, 'FIX-13：空目录 → 原样下发')
verify.mjs:1811  assert.deepEqual(fix13Incomplete.allow, declared, 'FIX-13：**不完整目录下不得剔除任何声明名**')
verify.mjs:1821  assert.ok(allow.includes('read') && allow.includes('write'), 'FIX-13：宿主内建工具必须留在 allow 里')
verify.mjs:1831  assert.deepEqual(fix13Allow, fix13Expected, 'FIX-13：allow 必须等于声明名（经平台解析），一个都不许少')
verify.mjs:1833  assert.equal(warnings.some((t) => t.includes('已剔除')), false, 'FIX-13：不得再出现"已剔除"这类静默降级')
```

- **空/不完整目录下 `allow === 声明名`** ✅；**不完整目录正是真机 `schemas()` 的视野**（`PLUGIN_SCOPE_ONLY_TOOLS`）已单列为回归位 ✅
- **平台解析**：win32 → 仅 `pwsh`；非 win32（linux）→ 仅 `bash` ✅
- 运行时交叉证据：见 B2（实调拿到 `pwsh`，且**没有** `bash`）。

### A4 血缘/过滤回归位 —— ✅ 通过

```
verify.mjs:1357  assert.ok(fallbackForest.roots.length >= 1, 'FIX-12：items 不含 scope 时 roots 必须 >=1')
verify.mjs:1367  assert.ok(snapshotFromSessions(sessionItems, {}, 'x').roots.length >= 1, 'FIX-12：items 不含 scope → roots>=1')
verify.mjs:1878  assert.equal(view.isHidden(...children[1], view.defaultPrefs()), true, 'FIX-7：one-shot+completed 默认隐藏')
verify.mjs:1882  assert.equal(fix7Bare.roots[0].children[0].mode, 'unknown', 'FIX-7：投影缺失必须保留 unknown，不得猜')
verify.mjs:1883  assert.equal(view.isHidden(...children[0], view.defaultPrefs()), false, 'FIX-7：unknown 默认可见')
（L1860 段另有 settled continuable 默认可见的直接回归位）
```

四项齐全：`items 不含 scope → roots ≥ 1` ✅ / `settled continuable` 默认**可见** ✅ / `one-shot + completed` 默认**隐藏** ✅ / `unknown` 默认**可见** ✅。

### A5 remote 访问回归位 —— ✅ 通过

```
verify.mjs:2026  assert.equal(fix16WithInjected.failed, undefined, 'FIX-16：用注入后的 ctx 必须能正常加载（不得 failed）')
verify.mjs:2027  assert.equal(fix16WithInjected.source, 'remote.session + panel.json', 'FIX-16：注入 ctx 上必须能真读到派生快照')
verify.mjs:2028  assert.equal(fix16WithInjected.notes.length, 0, 'FIX-16：读到快照后不该有降级提示')
verify.mjs:2031  assert.equal(fix16WithPropsLike.failed, undefined, 'FIX-16：快照读不到不整轮 failed（血缘已成功）')
verify.mjs:2034  assert.ok(..., 'FIX-16：快照那一步失败必须点名')
verify.mjs:2037  assert.equal(/loadPanel\(props\.ctx/.test(clientSource), false, 'FIX-16：不得再用 props.ctx 访问 remote')
verify.mjs:2038  assert.ok(clientSource.includes('remoteCtx: injectedCtx'), 'FIX-16：必须把 apply(ctx) 的注入 ctx 传成 remoteCtx')
```

- `props.ctx` 无 `remote.workspaceFiles`、注入 ctx 有 → **仍能读到快照** ✅（L2027 `source === 'remote.session + panel.json'`）
- **「读血缘失败」与「读快照失败」文案不同** ✅（L2034 点名快照那一步；L2031 血缘成功时不得整轮 failed）

### A6 空态三分类 —— ✅ 通过

```
verify.mjs:1371  assert.ok(view.EMPTY_STATES.sourceEmpty.includes('数据源为空'))
verify.mjs:1372  assert.ok(view.EMPTY_STATES.filteredOut.includes('过滤后无可见节点'))
verify.mjs:1373  assert.ok(view.EMPTY_STATES.failed.includes('加载失败'))
verify.mjs:1374  assert.equal(new Set([...三者的].size, 3, 'FIX-12：三种空态不许混')
verify.mjs:1930  assert.equal(fix13FailedState.kind, 'failed', 'FIX-15：ctx.remote 缺失 → 走到 failed 空态')
verify.mjs:1931  assert.ok(fix13FailedState.reason.includes('remote'), 'FIX-15：failed 空态要带上 remote 原因')
verify.mjs:1941  assert.equal(panelViewState(...).kind, 'emptySource', 'FIX-15：空列表走 sourceEmpty 空态')
```

三类文案互不相同 ✅；`failed` 带 remote 原因 ✅。

### A7 host 侧快照 —— ✅ 通过

文件 `D:\Blockdustry\.agent-contract\panel.json`（2274 bytes，mtime 23:50:38）逐项核对：

| 要求字段 | 实际 |
|---|---|
| `schemaVersion` | `1` ✅ |
| `generatedAt` | `"2026-10-02T15:50:38.062Z"` ✅ |
| `members` | 6 个键（`T99…-reviewer` / `AC-VERIFY-C6-researcher` / `T99…-researcher` / `T52…-researcher` / `T-999-researcher` / `T99…-implementer`）✅ |
| `audit` | `{"level":"red","red":3,"yellow":27}` ✅（与同次审计 30 条 = 3 红 + 27 黄 对得上） |
| `counts` | `{"members":6,"tasks":54,"docs":106}` ✅ |
| **徽章为真值** | `T99…-reviewer`：`contract:"ok", docs:"ok", progress:"ok", budget:"ok", crossVendor:"unknown"` —— **不是一排 unknown** ✅ |

### A8 委派回执可见性 —— ✅ 通过

本轮两次派单的**回执原文**（均含「警告：」且逐条列出）：

```
已派出后台子智能体 73a4c66e-772e-4c9f-b8a8-51b37d8f5454（角色 implementer）
契约 4108 字
警告：
- 片段 slices 超软限：1598 > 1500 字（未超 30% 提醒区间，保留全文）
- 装配瘦身预算超限：除 mandate 外合计 3245 > 2500 字符（搬运失控，M4 审计将记 over_budget）

已派出后台子智能体 e778758c-ee78-4b35-82b2-4d3a80ab03e5（角色 reviewer）
契约 3843 字
警告：
- 片段 slices 超软限：1557 > 1500 字（未超 30% 提醒区间，保留全文）
- 装配瘦身预算超限：除 mandate 外合计 2980 > 2500 字符（搬运失控，M4 审计将记 over_budget）
```

套件侧同断言：`verify.mjs:1840` 回执必须含「警告：」、`1841` 每条都要可见、`1843` 无 warning 时不额外输出。

---

## B 组 · 运行时核验

### B1 版本与工具面 —— ✅ 通过

见 §0：工作树 `0.2.3` == `contract_status` `0.2.3`；18 项清单**逐字一致**（且与工作树 13+5 的构成一致）。

### B2 工具实质验收（重点）—— ✅ 通过

派「实现者（后台）」`73a4c66e-772e-4c9f-b8a8-51b37d8f5454`，要求它自报清单 + 在 `D:\Blockdustry\.review-tmp\probe13\` 实测 read/write/pwsh。**它自报来源明确标注为「实调枚举 + 实调验证，不是照抄契约文本」**：

| 实测项 | 结果（原始） |
|---|---|
| `read`（probe-read.txt） | ✅ 成功，标记行原文 `内容标记：PROBE-READ-OK-0.2.3` |
| `write`（probe-write.txt） | ✅ 成功，返回 `Created file`，回读得 `PROBE-WRITE-OK` |
| `pwsh`（`Write-Output PROBE-PWSH-OK`） | ✅ 成功，stdout `PROBE-PWSH-OK`，无 stderr、无 exit code 标记 |
| `grep` | ✅ 成功（2 命中） |

**实际可调用工具清单（9 个）**：`read`、`write`、`edit`、`glob`、`grep`、`todo_write`、`doc_emit`、`progress_upsert`、`pwsh`。

**判据核对**：**不是**只剩 `doc_emit`/`progress_upsert`/`subagent` ✅ —— 第 2 轮的 FIX-13 事故已实质修复。
契约「能力配置」原文：`- 工具白名单：read、write、edit、glob、grep、todo_write、doc_emit、progress_upsert、pwsh` —— 与实调清单**一致**；且明确**不存在 `bash`**（这正是早期硬失败的根因，现已按平台解析掉）。

**reviewer 旁证**（`e778758c-ee78-4b35-82b2-4d3a80ab03e5`，纯只读通道）：

| 实测项 | 结果（原始） |
|---|---|
| `read` | ✅ 成功 |
| `glob`（`任务/T99_*.md`） | ✅ 1 命中 `任务\T99_契约流程冒烟测试.md` |
| `grep`（`工具白名单`） | ✅ 2 命中 |

实际清单 6 个：`read`、`glob`、`grep`、`doc_emit`、`progress_upsert`、`subagent`（与角色卡声明一致，且**按设计无 shell**）。

### B3 快照链路 —— ✅ 通过

```
触发: audit_scan（运行时工具，返回 30 条：3 红 + 27 黄）
panel.json  mtime BEFORE = 2026-10-02T22:41:18.4976969+08:00   sha256 = 679560CDDF09846B
panel.json  mtime AFTER  = 2026-10-02T23:50:38.0657947+08:00   sha256 = 0227639EAFD9610B  size 2274
```

mtime **刷新** ✅、内容正确（见 A7）✅、`audit` 真值与本次审计一致 ✅。
**回到面板**：用户确认 —— 「徽章是具体值（✓/⚠/✗ 或文字），底部**不再**出现『数据源待接』」✅

### B4 面板数据 —— ✅ 通过

- 运行时血缘数据面（`D:\Blockdustry` 工作区 15 个会话头，按 `parentSession` 分组）：我的会话 `session-159113a8…` 下有 **6 个子会话**：`a2c8110d`(研究员·一次性) / `ee01e951`(reviewer) / `76b0ab7b`(implementer) / `7a50e9dd`(reviewer) / `73a4c66e`(implementer) / `e778758c`(reviewer)；加上根节点 = **7 个成员**。
- 默认被隐藏的「已完成一次性」= **1 个**（`a2c8110d`，T99 研究员，one-shot + completed）；其余 5 个子会话均为 continuable → 按 FIX-7 默认**可见**。
- 推算：可见 = 7 − 1 = **6**。
- **用户肉眼确认**：「成员 7，能看到 6 个节点（主代理 + 5 个子）」✅ —— 与推算**逐数字吻合**，`成员总数 − 可见节点数 = 1 = 被默认隐藏的已完成一次性数` ✅

### B5 两个同名 reviewer 节点 —— ✅ 通过（无去重缺陷）

数据面三个同名 reviewer 会话的 `sessionId` **各不相同**：

| 节点 | sessionId | 来源 |
|---|---|---|
| reviewer #1 | `ee01e951-5873-4cb6-bada-a58c522fb479` | 第 1/2 轮派单 |
| reviewer #2 | `7a50e9dd-c62b-4d41-bff4-915d602d6a8a` | 第 2 轮派单 |
| reviewer #3 | `e778758c-ee78-4b35-82b2-4d3a80ab03e5` | 本轮派单 |

三者 id **均不同** ⇒ 属**多次派单的正常结果**，**去重缺陷不成立**。面板侧节点数与数据面一致（B4 的 6 个可见节点内含这 3 个 reviewer），未出现「同名同 id 的重复节点」。
（附带观察，见新缺陷 FIX-27：台账/快照按**成员名**归并，同名多会话只保留最后一条，导致 `panel.json` 里该名字的 `sessionId` 只剩 `e778758c`。）

### B6 跳转通道 —— ✅ 通过（源码 + 用户肉眼）

- 源码/套件：`verify.mjs:52` 段 `ok('FIX-18 … 跳转走 uiWorkspace.openSession …')`；FIX-23 另断言「整卡双击跳转」。
- 用户肉眼：「双击能跳到那个子智能体对话」✅；跳不动时的 session id 展示见 C5 备注。

---

## C 组 · 肉眼核验（**用户答复原样记录**，未代判，均标注「由用户肉眼确认」）

| # | 请用户确认 | 用户答复原文 |
|---|---|---|
| C1 | tab 并列可区分 + 列表/拓扑图切换 | **「并列可区分，且有「列表 / 拓扑图」切换」** |
| C2 | 拓扑层级 + 卡片字段 | **「层级对（主代理 L0 → 子节点 L1），卡片字段齐」** |
| C3 | 列表列头 + 颜色可区分 + 灰度/色弱可辨 | **「列头齐，且不靠颜色也能分辨（有文字/符号）」** |
| C4 | 默认隐藏已完成一次性 + 显示全部 + 重启保持 | **「现在没有一次性智能体，无法测试」**（补充：更早一轮用户已确认「有『显示全部』按钮」） |
| C5 | 双击跳转 / 跳不动时展示复制 session id | **「双击能跳到那个子智能体对话」** |
| C6 | 底部只读说明在位 | **「在位」** |

**关于 C4 的事实对照（只陈述、不代判）**：数据面上我的会话树里**确实存在 1 个** one-shot + completed 成员（`a2c8110d`，T99 研究员）。用户答复「没有一次性智能体」与此**并不矛盾**——若 FIX-7 的默认隐藏生效，该节点本就**不该出现在默认视图里**，用户自然看不到它。两种解释（「被正确隐藏」/「确实没有」）我不替用户选定，按未核验记录。

---

## 新缺陷

### FIX-27（minor）同名多会话成员在台账/快照里被按「成员名」归并，后到者覆盖先到者 → 徽章与 sessionId 串味

- **现象**：三个 reviewer 会话（`ee01e951` / `7a50e9dd` / `e778758c`）同名 `T99_契约流程冒烟测试-reviewer`，但台账与快照里只留一条记录：第 1 轮读到的 `id = ee01e951`，本轮 `panel.json` 里已变成 `e778758c` —— **先到者的 sessionId 被覆盖丢失**。而 `panel.json.members` 以成员名为键，client 的 `applyPanelBadges` 也按 `node.name` 取值，于是**所有同名节点共享最后一条记录的徽章**。
- **涉及文件**：`src/panel/snapshot.js`（`members[name] = …`，L49-55）、`src/client/tab.js`（`applyPanelBadges` 用 `rows[node.name]`）、`src/delegation/channels.js`（`recordDelegation` → `putMember`）
- **修法**：① 快照 `members` 改为按 `sessionId` 建索引（或双键：sessionId 为主、name 兜底），client 优先按 `node.sessionId` 取徽章；② 台账成员键若必须保持 `name`，至少把历史会话 id 记成数组，避免覆盖。
- **验收断言**：同名、不同 sessionId 的两个成员同时存在时，`panel.json` 能分别查到两者的 `sessionId`，且两个面板节点各取各的徽章（不得相同来源）。
- **最小复现**：连续两次派同一 `taskId` + 同一角色的后台子智能体 → 读 `panel.json`，`members['<task>-<role>'].sessionId` 只等于**后一次**的 id；第一次的 id 在台账里已不可查。

### FIX-28（traceability, minor）套件里 `FIX-6` 标签已消失，M3 专项断言不可检索

- **现象**：`REVIEW-M3.md` A2 要求套件能检索到 `FIX-6` 等相关断言名；实测 `Select-String -Pattern "FIX-6" scripts\verify.mjs` → **0 命中**（其余 6 项均命中）。FIX-6 的断言面已并入 `FIX-13` 块。
- **涉及文件**：`scripts/verify.mjs`（L1791 块注释与 L1857 的 `ok(...)` 标签）
- **修法**：在 FIX-13 块首注释补「本块取代原 FIX-6（工具名校验）」，或在其中补一条 `ok('FIX-6 …')` 便于检索。
- **验收断言**：`Select-String -Pattern "FIX-6" scripts\verify.mjs` 非空。
- **最小复现**：上述命令。

---

## 汇总

```
0  版本闸门：工作树 0.2.3 | contract_status 0.2.3 | 工具数 18（逐字一致）→ 通过，无漂移
A  通过 7 / 8：A1✅ A3✅ A4✅ A5✅ A6✅ A7✅ A8✅ ｜ A2❌（仅字面口径：FIX-6 标签不可检索）
B  通过 6 / 6：B1✅ B2✅ B3✅ B4✅ B5✅ B6✅（全部有运行时证据或用户肉眼证据）
C  已确认 5 / 6：C1✅ C2✅ C3✅ C5✅ C6✅ ｜ C4 未核验（用户答复「现在没有一次性智能体，无法测试」）
新缺陷 2 条：FIX-27（minor，同名归并串味）、FIX-28（traceability，FIX-6 标签缺失）
```

### 判定

- **A 组为硬门槛**：A2 按**字面**判据失败 ⇒ 严格口径下 **A 组 FAIL**。
- 但 A2 的失败是**标签/可追溯性问题**，不是覆盖缺失：FIX-6 的断言面由强度更高的 FIX-13 块接管，且 **B1–B6 全部通过**（含运行时工具实质验收与用户肉眼核验）。
- **因此：技术结论「M3 面板达标（含 FIX-13/14/15/16 全部实质通过）」成立；形式结论取决于上层如何看待 A2 的字面口径。** 只需补一个 `FIX-6` 标签即可转绿，建议顺手修 FIX-28 后重跑 A2。
- 其余未通过项只有 **C4**（用户无法构造该场景），已按未核验记录，未代为判定。

### 基线哈希复核（确认响应文件在核验期间未漂移）

```
AD9691AC  package.json          (0.2.3)
8DE60200  src/contract/roles.js
A1808CEA  src/delegation/channels.js
B0664FB8  src/client/tab.js
CFE12F57  src/tools.js
B8F968EB  src/panel/snapshot.js
7797EB46  scripts/verify.mjs
```

### 审查方本轮未做/未能做

- 未修改任何既有源码或项目文档；未触碰 `D:\DSH插件\...`；只新建 `.review-tmp/` 下的探针夹具与本文。
- C 组全部原样记录、未代判；C4 未核验已写明原因。
- B5 的「面板节点两两核对」由**数据面 + B4 计数吻合**佐证，未在 GUI 内逐节点悬停比对（无 GUI 通道）；如需绝对确认，请用户悬停两个同名 reviewer 节点读 id。
