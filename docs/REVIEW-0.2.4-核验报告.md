# 核验报告 · 0.2.4（版本闸门 / C2 徽章可辨 / C4 审计入口 / FIX-17 同名不串）

> 执行时点：2026-10-03 00:2x。铁律：C 组只记录用户答复，不代判；拿不到前提标「未核验 + 原因」。
> **影响面声明（§1/§3）**：本轮**未修改任何既有源码或文档**。项目侧唯一写入是核验 ③ 时按规程触发的 `audit_scan`，它按插件自身职责重写了派生物 `D:\Blockdustry\.agent-contract\panel.json`（`schemaVersion 1 → 2`，mtime `00:13:48 → 00:25:49`）。其余写入只有 `.review-tmp\` 下 2 个探针脚本。

---

## ① 版本闸门 —— ✅ 通过

```
现场读工作树 package.json version = 0.2.4
contract_status 插件版本          = 0.2.4        → 一致
已注册工具（18）                  = 与基准逐字含顺序一致
```

18 项：`contract_status, doc_emit, progress_upsert, bugfix_note, ledger_rebuild, librarian_patrol, librarian_backfill, ledger_backfill, librarian_sweep, librarian_glossary, librarian_archive, audit_scan, doc_search` + `contract_delegate_{researcher,implementer,reviewer,adversary,librarian}`（13 + 5 = 18）。

基线哈希：`package.json 36DE5E24` / `src\tools.js 8AB46929` / `src\client\tab.js A2945E0F` / `src\panel\snapshot.js 8E08BBBC` / `scripts\verify.mjs A8349A3C`。

套件（0.2.4）：`node scripts/verify-node.mjs` → **68 项 ALL CHECKS PASSED**，其中新增
`OK 61 FIX-29 改名不重复前置任务号 / 幂等 / dryRun 给旧名→新名`、
`OK 62 FIX-17=FIX-27 members 按 sessionId 建索引：同名成员徽章不串 / 旧会话 id 不丢 / 按名退化必须留痕`、
`OK 63 FIX-6 工具名以宿主为准 + 装配期只警告不剔除（显式接回标签）`、
`OK 64 FIX-20 徽章可辨性：四类符号两两不同（灰度可分）…`、
`OK 65 FIX-21 审计入口：快照带清单（路径+原因+建议，与 SUGGESTIONS 同源）/ 摘要条写中文红黄计数 / 可展开 / 血缘为空时仍在`。

---

## ② C2 徽章可辨 —— ✅ 通过

机器侧（探针 `.review-tmp\probe-0.2.4.mjs`，用套件同款 `vm` 方式加载 client）：

```
ok       symbol="✓"  label="正常"    badgeText="✓ 正常"  cell="✓ 正常"
warn     symbol="⚠"  label="警告"    badgeText="⚠ 警告"  cell="⚠ 警告"
missing  symbol="✗"  label="缺失"    badgeText="✗ 缺失"  cell="✗ 缺失"
unknown  symbol="?"  label="未知"    badgeText="? 未知"  cell="? 未知"
na       symbol="—"  label="不适用"  badgeText="— 不适用" cell="—"
五态符号两两不同 = true (✓ ⚠ ✗ ? —)
```

- 五态符号**两两不同**，不依赖颜色即可区分；颜色退化为辅助信息 ✓
- 列表格子为**紧凑形态**：`badgeCell(value)`，且 `na` 在格子里只留 `—`（`tab.js:130`），完整文案留在 tooltip 与图例 ✓
- 用户肉眼确认：**「能两两区分（✓ ⚠ ✗ ? — 一眼看得出不同）」** ✓（由用户肉眼确认）

## ③ C4 审计入口 —— ✅ 通过

机器侧：

```
快照未到(placeholder) -> "审计：数据源待接"
快照未到(null)        -> "审计：数据源待接"          ← 不写 0 红 0 黄 ✓
红3黄26               -> "审计：红 3 / 黄 26"
0红0黄                -> "审计：全绿（0 红 / 0 黄）"
audit.items[0] 原始字段 = {check,level,target,detail,suggestion}   ← 建议来自 SUGGESTIONS，非兜底
auditLines(audit) 条数 = 33
首条 = "[红] AC-VERIFY-C6-researcher｜ghost_run｜原因：一次性节点已结束但没有落档（跑完即释放，产出已不可追）｜建议：确认该次 run 是否本应落档…"
清单含 路径/check/原因/建议 = true true true true ｜ 落到兜底建议的条目 = 0
auditOpen 持久化回读 = true（复位后 false）
```

- 常驻摘要条 + 可展开清单（`[级别] 路径｜check｜原因｜建议`）✓
- 快照未到时写「数据源待接」而非 0 红 0 黄 ✓
- 展开态持久化回读 ✓
- 用户肉眼确认（答复原文）：**「这是两个复制下来的，应该是正常的」**并贴出两行清单：
  `[红] AC-VERIFY-C6-researcher｜missing_doc｜原因：成员已 completed，但任务 AC-VERIFY-C6 没有任何三档文档｜建议：让产出者补三档档，或由主代理确认该任务确实无产出义务`
  `[黄] D:\Blockdustry\仓库\docs\^修改-钻头侧面贴图应用.md｜doc_misfiled｜原因：docs 根目录散文件｜建议：由图书管理员迁移到对应类目录（改名 + 更新引用 + 留痕）`
- 重启保持：用户答复 **「保持展开（重启后就开着）」** ✓（由用户肉眼确认）
- 「血缘为空时也显示」：**未核验**（当前会话血缘非空，用户未构造到空态场景）；代码层有 `EMPTY_STATES` 分支，但我没有拿到运行时空态证据，不代判。

## ④ FIX-17 同名不串 —— ✅ 机器通过（含退化路径留痕）；用户未看到告警

真实 `panel.json`（v2）：`membersById` **4 条**、`members`（按名退化）**6 条**、`audit.items` 33 条。

三个真实同名 reviewer 会话（`ee01e951` / `7a50e9dd` / `e778758c`）跑 client 侧贴回：

```
ee01e951  hasAudit=true  badgeFallback=true   badges={contract:ok,docs:ok,progress:ok,budget:ok,crossVendor:unknown}
7a50e9dd  hasAudit=true  badgeFallback=true   badges={…同上…}
e778758c  hasAudit=true  badgeFallback=false  badges={…同上…}
membersById 命中数 = 1 / 3
```

判定：

- **退化路径按规范留痕** ✓：`applyPanelBadges` 先按 `sessionId` 取（`membersById`），取不到才按名退化并置 `node.badgeFallback = true`（`tab.js:545-558`）。
- **为什么只有 1/3 命中**：台账本身按**成员名**保存（`T99_契约流程冒烟测试-reviewer` 只有一条记录），所以只有最后一个会话在 `membersById` 里有 id；另两个必然走退化路径 —— 这正是你 ⑤ 提到的「升级前按名写的旧记录残留」。
- 三者的徽章值此刻相同，是因为三档/进度/预算本就是**按任务**算的；差异风险只在成员记录本身不同步时显形。
- **用户肉眼答复（原样）**：**「悬停时显示的是子agent的UUID」** → 未看到「同名成员可能串」告警。

**观察（只报告，不改代码）**：该告警只挂在**五枚徽章各自的 `title`** 上（列表 `tab.js:1072`、拓扑 `tab.js:1279`），而卡片/名字的 tooltip 是 `node.sessionId`（UUID）。所以「悬停卡片看到 UUID、看不到告警」是**当前实现的必然结果**，属**可发现性问题**：若要让人一眼看到，建议把告警同时挂到卡片/名字的 tooltip，或在节点旁加一个 ⚠ 小角标。是否改由你定。

## ⑤ 可选净化 —— ⏸ **用户决定：先不净化**

按 §1 先做了 dryRun（空内存桩模拟，**未碰真实 storages**）：

```
重建摘要: docs=106  tasks=54  membersAdded=3  membersTotal=3
重建后成员（3 条，全部 derived=true、id=""、status=unknown）:
  T99_契约流程冒烟测试-reviewer / T99_契约流程冒烟测试-researcher / T52_待办路线图研究-researcher
带 sessionId 的成员数 = 0 → membersById 将有 0 条
```

**结论：台账可从磁盘重建（106 文档 / 54 任务），但代价不止计数** —— 4 条带 `sessionId` 的实时成员记录只存在于 storages（磁盘上没有），清掉即永久丢失；`membersById` 归零后**所有节点**都走按名退化路径；成员数 6 → 3。且 storages 在 `C:\Users\flafk\.dsh\`，**不在 `仓库/.git` 内，git 恢复不到**（按 §2 需先备份）。

用户答复：**「先不净化（推荐）」** → 本次未做任何清空动作。

---

## 附：本轮引入的一个后续项（如实交代）

我上一轮为完成回滚补回了 L2/L3 尾部的「附：…」段，**正文 mtime 因此变新**（`16:23:28`），而 `keywords` 最后更新停在 `16:03:56` → 本轮审计新增 4 条 `doc_tags_stale`（黄）：L1/L2/L3/研究员回报各一条，内容为「正文被改过，但 keywords 最后一次更新是 …」。这不是缺陷，是我那次合法写操作的副作用；如需消掉，让馆员刷一次 keywords 即可（需你授权，我未动手）。

## §6 收尾：留下了什么 / 清掉了什么

- **清掉**：无（本轮无临时目录产生）。
- **留下**（均在 `D:\Blockdustry\.review-tmp\`，与本轮有关）：`probe-0.2.4.mjs`（②③④ 探针）、`dryrun-clean-storages.mjs`（⑤ dryRun）。
- **项目侧唯一变化**：派生物 `D:\Blockdustry\.agent-contract\panel.json`（v1→v2，可随时由 `audit_scan`/`ledger_rebuild` 重建）。
- **未做**：③ 的「血缘为空空态」未取得运行时空态证据（标未核验）；⑤ 净化未执行；④ 的告警位置未改动（只报告）。
