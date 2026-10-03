# REVIEW-M2.5-M4 核验报告 —— 检索层（M2.5）+ 审计/馆员/归档（M4）

> 依据 `D:\DSH插件\dsh-agent-contract\docs\REVIEW-M2.5-M4.md` 的报告格式交付。
> 铁律遵守：① 未放宽/删除任何断言 ② 未修改既有**源码**或**插件仓库文档**；**项目文档的改动仅限用户明确授权的 B4 一轮治理，已在文末单列副作用** ③ 拿不到前提标「未核验 + 原因」 ④ C 组只记录用户答复，未代判。
> 核验时点：2026-10-03 00:0x。

---

## 0. 版本闸门（动态口径）—— ✅ 通过，无漂移

```
现场读工作树 package.json version = 0.2.3
contract_status 插件版本          = 0.2.3        → 一致
已注册工具（18）                  = 逐字含顺序一致
```

工作树注册项：`src/tools.js` **13** 个（`contract_status, doc_emit, progress_upsert, bugfix_note, ledger_rebuild, librarian_patrol, librarian_backfill, ledger_backfill, librarian_sweep, librarian_glossary, librarian_archive, audit_scan, doc_search`）+ `contract_delegate_*` 通道 **5** 个 = **18**，与运行时清单**逐字含顺序一致**。

基线哈希（全程未变，插件仓库我一个字节都没动）：

| 文件 | SHA256 前 8 位 |
|---|---|
| `package.json` | `AD9691AC` |
| `src/tools.js` | `CFE12F57` |
| `src/client/tab.js` | `B0664FB8` |
| `src/panel/snapshot.js` | `B8F968EB` |
| `scripts/verify.mjs` | `7797EB46` |

**版本漂移：无。**（期望值按动态口径现场读取，未沿用历史基准号。）

---

## A 组 · 机器核验（硬门槛）

### M2.5

**A1 `doc_search` 形状 —— ✅ 通过**

```
src/tools.js（name: 'doc_search'）
parameters: query(required) / taskId? / role? / tier? / limit?
output.schema: results[] / suggest[] / scanned / filtered / strategy   （均 required）
src/search/doc_search.js:178-186 结果行字段
  rank: rank + 1, path: row.doc.path, tier: row.doc.tier, taskId: row.doc.taskId,
  chars: row.chars, keywords: row.doc.keywords || [], snippets: row.snippets,
  score: row.score, hitReason: row.hitReason
```
入参 5 项、出参 3 组 + 结果行 9 字段，与判据逐项对齐。

**A2 先过滤后匹配 —— ✅ 通过**

```
verify.mjs:1055  const filteredHits = await search.execute({ query: '分裂炮台', taskId: 'T-102' })
verify.mjs:1056  assert.equal(filteredHits.filtered, 1, 'M2.5-1：taskId 过滤后只应剩 1 篇候选')
verify.mjs:1057  assert.ok(filteredHits.filtered < filteredHits.scanned, 'M2.5-1：必须先过滤再匹配')
```
插桩式断言：`filtered = 1` 远小于 `scanned`，且 taskId 收窄先行 → 非全库扫描。

**A3 泛词纪律 —— ✅ 通过**

```
verify.mjs:869   hitReason 里不得出现泛词
verify.mjs:876   'FIX-2：关键词全是泛词时不得召回任何文档'
verify.mjs:1064  assert.deepEqual(searchGenericOnly.results, [], 'M2.5-1：纯泛词查询必须零召回')
```
`hitReason` 只允许实词 + 纯泛词零召回，双向都断言。

**A4 `suggest` 形态 —— ✅ 通过**

```
verify.mjs:1049  assert.ok(hits.suggest.every((item) => item.includes('#')), 'M2.5-1：suggest 形如 <路径>#小节')
verify.mjs:1050  assert.ok(hits.suggest.some((item) => item.startsWith(hitDoc.path) && item.includes('#结论')))
```
即 `<绝对路径>#结论`。

**A5 检索阶梯入角色卡 —— ✅ 通过**

```
verify.mjs:1000  const LADDER_ORDER = ['doc_search','glob','grep','read','session_search']
verify.mjs:1003  每个角色卡必须提到每个层级
verify.mjs:1005  positions = LADDER_ORDER.map((l) => role.persona.indexOf(l))
verify.mjs:1009  顺序必须递增
verify.mjs:1014  覆盖 persona 后阶梯仍须存在
```
五个角色卡全含 L0~L4 且顺序正确；配置覆盖 persona 也挂得住。

**A6 索引订阅 —— ✅ 通过**

```
verify.mjs:1079  events == 1000
verify.mjs:1080  flushes == 5（按 200 事件阈值）
verify.mjs:1081  flushes * 50 < 1000        ← 写入次数 ≪ 事件数（节流）
                 idemSync.record('same.md') ×10 → pending == 1, events == 10   ← 幂等
                 windowSync：过 flushMs 窗口即 isDue；drain() == ['a.md']      ← 按 value.path 入队
                 eventIndex.snapshot() === autoLedger.index.snapshot()          ← 事件累积 == 全量 rebuild
```

**A7 目录分类配置 —— ✅ 通过**

```
index.js:23  docsDirs: Schema.array(...)
index.js:25  archiveDir: Schema.string().default('')
index.js:27  docKinds: Schema.dict(Schema.string()).default({})
index.js:61  checks / :63 archiveAfterDays: Schema.number().default(90)     ← 均有声明
cordis.patch.yml:19-22   四类正式源：仓库/docs/研究、坑、修改、核心数据库
cordis.patch.yml:23      # deprecated（过渡源）：旧档尚未迁完…            ← 过渡源 + 注释
cordis.patch.yml:26      archiveDir: '仓库/docs/archive'
cordis.patch.yml:28-33   docKinds 六类映射
cordis.patch.yml:62      - doc_misfiled                                  ← 在 checks 列
cordis.patch.yml:68      archiveAfterDays: 90
```

### M4

**A8 `audit_scan` 12 项正反例 —— ✅ 通过**：`verify.mjs:1414-1508` 的 M4-1 区块，逐项「命中/不命中」各一（缺失档、超长、残留槽位、进度超长、异源、幽灵 run、孤儿任务、未释放、放错目录、缺元数据、标签过期、归档建议），另 L1461-1474 断言 level/counts/item 形状与「未开启项不执行」。

**A9 警告制 —— ✅ 通过**（运行时真跑，非夹具）

```
仓库/docs   179 files / 1248025 bytes  →  179 files / 1248025 bytes   SAME
[Agent进度] 2 files / 1333 bytes       →  2 files / 1333 bytes        SAME
仓库/src    757 files / 1461044 bytes  →  757 files / 1461044 bytes   SAME
audit_scan 返回：红 3 / 黄 26，共 29 条，不抛错
```
条目数与字节数**逐目录完全一致**。

**A10 未知检查项必须报错 —— ✅ 通过**

```
THREW: agent-contract: 未知的 audit.checks 项 bogus_check_xyz
      （可用项：missing_doc、ghost_run、orphan_task、over_budget、unfilled_slot、stale_progress、
        cross_vendor、unreleased_run、doc_misfiled、doc_meta_missing、doc_tags_stale、archive_suggest）
```
方法说明：**未改动任何配置文件**（运行配置由宿主启动时读入，改文件对运行中进程无效且属既有文件），改为把同一 config 对象喂给同一入口 `auditScan`；因此**不存在需要还原的残留**。

**A11 `humanReport` —— ✅ 通过**（2 条原文）

```
1. [黄] D:\Blockdustry\仓库\docs\^修改-钻头侧面贴图应用.md
   原因：docs 根目录散文件
   建议：由图书管理员迁移到对应类目录（改名 + 更新引用 + 留痕）
2. [黄] D:\Blockdustry\仓库\docs\^单位工厂与单位.md
   原因：docs 根目录散文件
   建议：由图书管理员迁移到对应类目录（改名 + 更新引用 + 留痕）
```
路径 + `原因：` + `建议：` 三段齐。

**A12 误报回归位 —— ✅ 通过**

```
verify.mjs:1483  unfilled_slot({ contracts: realNamePoison }) === []   '[Agent进度] 这类真实目录名不得误报'
verify.mjs:1503  hasTarget('doc_meta_missing','旧档.md') === false     'legacy 不参与'
verify.mjs:1504  hasTarget('doc_meta_missing','T-611_fix.md') === false 'tier0 不参与'
```

**A13 `doc_misfiled` 只报不动 —— ✅ 通过**：运行时报告 **22 条** doc_misfiled，而 `仓库/docs` 跑前跑后 `179 files / 1248025 bytes` **完全一致**（文件一个字节没动）。

**A14 归档阈值单调 —— ✅ 通过**（受控夹具）

```
archiveAfterDays=90 -> 1 条: T-700_old_L3.md
archiveAfterDays=1  -> 2 条: T-700_old_L3.md, T-700_mid_L3.md
```
（真实项目上 90/1 均 0 条，因为 `rebuildLedger` 把任务统一记为 `open`，而归档条件要求「任务已结」—— 数据前提不满足，非阈值失效。）

**A15 馆员职责 —— ✅ 通过**（五工具齐 + 运行时一轮治理实测，详见 B4）

| 判据 | 结果 |
|---|---|
| 五工具齐 | ✅ `librarian_sweep` / `librarian_glossary` / `librarian_archive` / `librarian_patrol` / `librarian_backfill` 均在运行时工具目录 |
| 命名规范化 | ✅ 候选 4 / 改名 4（**但名字有 bug，见新缺陷 FIX-29**） |
| **改引用** | ✅ 反馈 6 处引用更新（核心数据库 changelog 逐条可查），被改档正文末尾的「附：一级/二级文档」已指向新路径 |
| 去重保留最新 | ✅ 套件 M4-2 断言（本次真实项目去重 0 篇，无重复档） |
| 归档落分片 | ✅ 见 B6 夹具：落 `archive/2026-03/` |
| 核心数据库保留原 changelog | ⚠️ **运行时无法验证**：`仓库/docs/研究/核心数据库.md` 在本轮是**新建**（此前该目录为空），故无「原段」可保留；只能以套件 M4-2/M4-3 断言作证 |
| 坑库 README 索引 | ✅ 生成 `仓库/docs/坑/README.md`（16 条） |
| 术语表写入 | ✅ 工具在（`librarian_glossary`）；本轮只报缺口未写词条 |
| **幂等** | ✅ 第二轮 `候选 0 / 改名 0 / 归档 0 / 去重 0`；核心数据库 changelog 条数 10 → 10 未增长 |
| **正文零改动** | ✅ 成立，**含 M4 明列的允许例外**：3 篇追加了「附：一级/二级文档」小节，其余正文字节未动；第 4 篇正文完全未动（详见 B4） |
| 留痕 | ✅ 含 `librarianTouchedAt` 的档 3 → 7；`librarianChanges` 记改名明细 |

**A16 面板徽章真值 —— ✅ 通过**

```
verify.mjs:1747  缺三档 → badges.docs === 'missing'（面板渲染 ✗）
verify.mjs:1762  client 侧取到真审计结论
verify.mjs:1763  hasAudit === true（不再 pending）
verify.mjs:1764  三档徽章 pending === false
verify.mjs:1770  schemaVersion 999 → badges.docs === 'unknown'（降级不猜）
verify.mjs:1781  补齐 L1/L2/L3 后 → badges.docs === 'ok'（复原）
verify.mjs:1783  client 侧同样复原
```
运行时交叉：真实 `panel.json` 里 `T99…-reviewer` 的 `contract/docs/progress/budget = ok`（**真值，不是一排 unknown**）；用户 C1 确认面板显示为文字结论。

**A17 归档策略文档化 —— ✅ 通过**

```
DESIGN.md:396  **采用时间分片**：`archive/<YYYY-MM>/<原文件名>`（按文档自身时间戳的 UTC 年月分片），**与批次解耦**
DESIGN.md:397  **触发阈值可配**：`audit.archiveAfterDays`（默认 90 天）；命中条件 = 档龄超阈值 **且** 所属任务已结
DESIGN.md:411  | 归档 | `仓库/docs/archive/<YYYY-MM>/` | **时间分片定稿**
```

### A18 M3 遗留三项（**单列，不计入 A 组硬门槛**）

| 项 | 状态 | 证据 |
|---|---|---|
| `FIX-6` 可检索 | ❌ **未修** | `Select-String -Pattern "FIX-6" scripts\verify.mjs` → **0 命中**（其余 FIX-7/11/12/13/15/16 全部命中） |
| `FIX-27` 成员按 `sessionId` 建索引 | ❌ **未修** | `src/panel/snapshot.js` 仍 `members[name] = …`；`src/client/tab.js` 的 `applyPanelBadges` 仍 `rows[node.name]`；实测见 B5 |
| `FIX-28` 标签补齐 | ❌ **未修** | 同 FIX-6（两者是同一件事） |

---

## B 组 · 运行时核验

**B1 版本与工具面 —— ✅ 通过**：见 §0，工作树 `0.2.3` / `contract_status` `0.2.3` / 18 项逐字含顺序一致。

**B2 审计真跑 + 红黄清单 —— ✅ 通过**

```
触发: audit_scan（运行时工具）
返回: 审计结果：红 —— 共 29 条待处理（检查项 12 项）
跑前/跑后快照：仓库/docs 179/1248025 · [Agent进度] 2/1333 · 仓库/src 757/1461044  →  全部 SAME
```

按检查项分类统计（29 条 = 3 红 + 26 黄）：

| 类别 | 检查项 | 条数 | 代表条目 |
|---|---|---|---|
| 幽灵 run | `ghost_run`（红） | 2 | `AC-VERIFY-C6-researcher`、`T99_契约流程冒烟测试-researcher` |
| 缺档 | `missing_doc`（红） | 1 | `AC-VERIFY-C6-researcher`（任务无任何三档档） |
| 放错目录 | `doc_misfiled`（黄） | 22 | `仓库/docs/^研究-*.md` 等 docs 根散档 |
| 超长 | `over_budget`（黄） | 1 | `…冒烟测试审查者通道回报-高度概括_L3.md`（584 > 300 字） |
| 缺进度 | `stale_progress`（黄） | 1 | `[Agent进度]\T52_待办路线图研究.md` |
| 未释放 | `unreleased_run`（黄） | 2 | 上述两个一次性成员 |
| 缺元数据 | `doc_meta_missing` | **0** | legacy/tier0 按设计不参与 |
| 归档建议 | `archive_suggest` | **0** | 真实项目无「已结任务 + 超阈值」档 |
| legacy 相关 | — | **0** | 100 篇 legacy 全部正确豁免 |

**B3 快照刷新 —— ✅ 通过**

```
panel.json  mtime 2026-10-02T23:50:38.0657947+08:00 → 2026-10-03T00:00:42.3322866+08:00
sha256      0227639EAFD9610B → BC814BBD6A4A9007
audit       {"level":"red","red":3,"yellow":26}   ← 与 29 条一致
members     6 键（reviewer / AC-VERIFY-C6-researcher / researcher / T52… / T-999… / implementer）
```
**回面板**：用户确认「徽章是具体值，底部**不再**出现『数据源待接』」。

**B4 馆员一轮治理 —— ✅ 通过**（用户已授权执行；本节是全轮唯一改动项目文档的动作）

```
1) dryRun  → 待办清单 29 条；试算「归档 0 / 去重 0 / 命名候选 0」        （未落盘）
2) 执行 1 轮 → 归档 0 · 去重 0 · 命名候选 4 / 改名 4 · 核心数据库 → 仓库/docs/研究/核心数据库.md
             · 坑库索引 → 仓库/docs/坑/README.md · 术语表缺口 10 词
3) 第二轮   → 归档 0 · 去重 0 · 命名候选 0 / 改名 0                      （幂等 ✔）
             核心数据库 changelog 条数 10 → 10 未增长；路径变化 0
```

**正文零改动（逐字节比对，181 → 182 篇）**：

```
正文指纹多重集差异：消失 4 / 新增 5
  → 其中 1 个新增 = 新建的 仓库/docs/研究/核心数据库.md
  → 另 3 个新增 = 3 篇被改档**追加了「附：一级文档…；二级文档…」小节**
     （M4 验收原文允许的例外：「正文零改动（除补固定小节占位/关联文档小节外）」）
  → 第 4 篇 T99…研究员回报_L3.md 正文指纹完全未变（无 L1/L2 兄弟可引）
```
判定：**正文零改动成立（含允许例外）**，未发现任何越界改写。

**留痕**：含 `librarianTouchedAt` 的档 3 → 7；被改档 front-matter 的 `librarianChanges` 逐条记录了改名明细。

**B5 同名多会话成员（FIX-27）—— ❌ 未通过（缺陷坐实）**

夹具 `.review-tmp/fix27-probe.mjs`（用套件同款方式加载 client + 真实 `panel.json`）：

```
panel.json 里 members 的键数 = 6
reviewer 相关键 = T99_契约流程冒烟测试-reviewer          ← 三个会话只剩 1 个键
该键的 sessionId = e778758c-…（最后一轮）               ← 前两个 id 已丢失
每个 reviewer 节点实际拿到的徽章：
  ee01e951  hasAudit=true  {"contract":"ok","docs":"missing","progress":"missing","budget":"warn",...}
  7a50e9dd  hasAudit=true  {"contract":"ok","docs":"missing","progress":"missing","budget":"warn",...}
  e778758c  hasAudit=true  {"contract":"ok","docs":"missing","progress":"missing","budget":"warn",...}
三个同名节点徽章完全相同 = true
```
**同名节点的徽章必然相同**（同一份 `members[name]` 被贴给所有同名节点），且旧会话 id 在台账/快照中已不可查。

**B6 归档建议落地抽查 —— ✅ 通过（受控夹具级）**

真实项目 0 条归档建议（无已结任务），故用临时夹具走完整链路：

```
1) 跑前 archive_suggest = 1 条: T-900_旧档_L3.md
2) archiveDocs = {"moved":1,"refsUpdated":1,"failed":[]}
3) deliverables 现有: T-900_引用档_L3.md                ← 已移出产出目录
4) archive 目录: 2026-03/T-900_旧档_L3.md               ← 落时间分片 ✔
5) 引用行: 参见 D:\…\仓库\docs\archive\2026-03\T-900_旧档_L3.md。   ← 引用已更新 ✔
6) 再跑 archive_suggest = 0 条                          ← 不再建议 ✔
```

---

## C 组 · 肉眼核验（**用户答复原样记录**，未代判）

| # | 请用户确认 | 用户答复原文 |
|---|---|---|
| C1 | 徽章已为真值（三档/进度不再「待接」；预算/异源可为 unknown 且能看出是 unknown） | **「白色和绿色字区别」**（补充：上一轮曾确认「徽章是具体值，底部不再出现『数据源待接』」）。**未明确回答**「unknown 能否辨认」，按未明确记录 |
| C2 | 灰度/色弱下仍可分辨（不单靠颜色） | **「已完成/运行中-绿/白只有这两个状态，我打算再加上几个」**；并曾答复 **「我手动把这条砍了，只用颜色区分」** |
| C3 | 同名多节点各自徽章不串 | **「有同名节点，应该说除了reviewer和impleme区别之外都是一个名字，但是没有串」** |
| C4 | 审计结果界面可读（红黄数量/清单入口） | **「都没看到」** |

**关于 C3 的机器侧事实（只并列，不代判）**：用户观察到「没有串」；夹具则证明**同名节点必然共享同一份 `members[name]` 徽章**。两者**并不必然矛盾**——当前同名节点本就应显示同样的三档/进度/预算（这三枚是按**任务**算的），只有当同名成员的台账记录本身不同步时差异才会显形。因此我按用户原话记录，同时保留机器侧结论，请上层据此裁定 FIX-27 的优先级。

---

## 新缺陷

### FIX-29（**中高**）任务号自身含下划线时，命名规范化会重复拼任务号

- **现象**：真实项目 4 篇被改名，且新名字里任务号被拼了两遍：
  `T99_契约流程冒烟测试_T99-冒烟测试审查者通道回报-高度概括_L3.md`
  → `T99_契约流程冒烟测试_契约流程冒烟测试_T99-冒烟测试审查者通道回报-高度概括_L3.md`
- **根因**：标题提取只按**第一个 `_`** 切掉一段，而任务号本身含下划线 → 剩下的 `契约流程冒烟测试_T99-…` 被当成标题，再前置完整任务号 → 重复。
- **涉及文件**：`src/ledger/naming.js`（文档名派生/规范化）、`src/librarian/duties.js`（命名规范化调用点）
- **修法**：按已知 `taskId` 的**完整前缀**剥离（`basename.startsWith(taskId + '_') ? basename.slice(taskId.length + 1) : basename`），再重新拼 `<taskId>_<标题>_L<n>.md`；剥离后为空则不加前缀。
- **验收断言**：任务号含下划线时，对**已合规**的 `<taskId>_<标题>_L3.md` 做一轮规范化 → 文件名**不变**（changed=false），且绝不出现两个相同任务号片段。
- **最小复现（已跑）**：夹具 `sweepfix2.mjs`，任务号 `T-800_A`、文件 `T-800_A_报告与结论_L3.md` → 一轮 sweep 后变成 **`T-800_A_A_报告与结论_L3.md`**（候选 1 / 改名 1）。

### FIX-27（重申，**未修**）同名多会话成员徽章串味、旧 sessionId 丢失

- 现象、涉及文件、修法、验收断言、最小复现同上一轮报告（本轮 B5 已用真实 `panel.json` + 三个真实 reviewer 会话再次坐实：三个同名节点徽章**完全相同**，前两个 sessionId 已不可查）。
- 追加建议：既然 A16 已把徽章定位成「按成员贴回」，就该把键从 `name` 换成 `sessionId`（台账成员记录里本来就存了 id）。

### 观察（不计缺陷）

1. **派生索引非字节幂等**：第二轮 sweep 虽无任何文档动作，但仍重写了 `仓库/docs/研究/核心数据库.md` 与 `仓库/docs/坑/README.md`（其「最后更新」时间戳变化）。语义幂等成立，字节幂等不成立。
2. **`relatedFiles` 出现游离反引号**：被改档的 front-matter 里存在 `"D:\…_详细归纳_L1.md\`"` 这种**反引号紧贴闭合引号**的值（疑似引用更新写出非法 YAML 值）。来源未验证（无改动前的副本可 diff），仅记录现象与文件路径。
3. **术语表缺口候选质量**：把 `java(62)、com(18)、blockdustry(44)、64(9)、16(9)` 这类词列为术语候选，建议加长度/停用词过滤。

---

## 汇总

```
0  版本闸门：工作树 0.2.3 / contract_status 0.2.3 / 工具数 18（逐字含顺序一致）→ 通过，无漂移
A  通过 17 / 17（硬门槛全绿）：A1✅ A2✅ A3✅ A4✅ A5✅ A6✅ A7✅ A8✅ A9✅ A10✅ A11✅ A12✅ A13✅ A14✅ A15✅ A16✅ A17✅
   A18 M3 遗留三项：FIX-6 ❌未修 · FIX-27 ❌未修 · FIX-28 ❌未修   （单列，不计硬门槛）
B  通过 5 / 6：B1✅ B2✅ B3✅ B4✅ B6✅ ｜ B5❌（FIX-27 未修）
C  已记录 4 / 4：C1 未明确 · C2 未通过（只靠颜色） · C3 用户称「没串」（机器侧相反，已并列） · C4 未通过（看不到审计汇总）
新缺陷：1 条新增（FIX-29 中高） + 1 条重申未修（FIX-27） + 3 条观察
```

**判定：A 组硬门槛 ✅ 全绿（17/17），M2.5 与 M4 的机器面达标。**
**唯一功能性失败在 B5**：FIX-27 未修，同名多会话成员的徽章会串、旧 sessionId 丢失。
**最值得马上修的是 FIX-29**：它已经真实污染了项目的文件名（4 篇），且会随每轮治理继续扩散。

---

## ⚠️ 副作用声明（B4 授权的实际改动，需要你知晓）

按你的授权，`librarian_sweep` **真实执行了一轮**，对项目产生了以下改动：

1. **4 篇文档被改名**（名字因 FIX-29 而不理想）：
   - `T99_契约流程冒烟测试_T99-冒烟测试审查者通道回报-{高度概括_L3, 扩充细节_L2, 详细归纳_L1}.md`
   - `T99_契约流程冒烟测试_T99-冒烟测试研究员回报_L3.md`
   → 全部变成 `T99_契约流程冒烟测试_契约流程冒烟测试_…`（任务号重复两次）
2. **3 篇追加了「附：一级/二级文档…」小节**（M4 允许的例外，正文其余未动）
3. **新建/更新 2 个派生物**：`仓库/docs/研究/核心数据库.md`、`仓库/docs/坑/README.md`
4. 4 篇的 front-matter 增加 `librarianTouchedAt` / `librarianChanges`

新旧文件名我都有完整记录，**可以随时把 4 篇改名回滚**（连引用一起改回去）。要回滚的话说一声。

## 审查方未做/未能做

- 未修改插件仓库任何源码或文档（哈希已复核，与开跑前一致）。
- 未在 GUI 内确认 C 组项，全部按用户答复原样记录。
- `A15` 的「核心数据库**保留原** changelog」在真实项目上**无法核验**（该文件本轮系新建，无「原段」），已标原因并以套件断言作证。
- `B6` 采用受控夹具（真实项目 0 条归档建议，且移动真实档需另行授权），已明确标注为夹具级。
