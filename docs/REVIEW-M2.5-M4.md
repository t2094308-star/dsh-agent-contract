# REVIEW-M2.5-M4.md — 检索层（M2.5）+ 审计/馆员/归档（M4）合并核验（执行方：dsh 主代理）

> 铁律：① 不得放宽或删除断言 ② 不得修改既有源码或项目文档（发现问题只报告）③ 拿不到前提 → 标 **未核验 + 原因**，不许自造前提 ④ C 组只记录用户答复，**不得代判**。
> 设计口径：`DESIGN.md` §5.5（检索设计 / 文档目录分类 / 增长策略）、§5.7（审计）、§5.8（图书管理员）、§5.1（paths）。
> 交付单：`docs/M2.5.md`、`docs/M4.md`；修复单：`docs/FIX.md`。

---

## 0. 版本闸门（**动态口径**）

- 期望值 = **现场读** `D:\DSH插件\dsh-agent-contract\package.json` 的 `version`（实现方可能又跳档，**不得**沿用历史基准号）。
- 比对 `contract_status` 的 `插件版本` 与 `已注册工具（N）` 清单（与工作树注册项**逐字含顺序**一致）。
- 不一致 → 标「**未核验（版本漂移）**」并**停止 B 组**；排查：托盘 Quit 重启 → 第二个 app 实例 → link 存活 → 重新 `add link:`。
- 闸门只挡运行时核验，**不挡代码阅读与机器核验**。

---

## A 组 · 机器核验（硬门槛）

### M2.5

| # | 项 | 判据 |
|---|---|---|
| A1 | `doc_search` 形状 | 入参 `query`(必填)/`taskId?`/`role?`/`tier?`/`limit?`；出参含 `results[{path,tier,taskId,chars,keywords,snippets,score,hitReason}]` + `suggest` + `scanned/filtered/strategy` |
| A2 | **先过滤后匹配** | `filtered` 明显小于 `scanned`（不得全库扫描）；断言或插桩证明过滤先行 |
| A3 | 泛词纪律 | `hitReason` **不含**泛词（研究/产出/只读/docs/md/png/文件/仓库/待办/任务）；纯泛词检索 **零召回** |
| A4 | `suggest` 形态 | 形如 `<绝对路径>#结论`（小节级 readHints） |
| A5 | 检索阶梯入角色卡 | 每个角色卡含 L0~L4 且**顺序正确**（`doc_search`→`glob`→`grep`→`read`→`session_search` 文案） |
| A6 | 索引订阅 | 节流生效（写入次数 ≪ 事件数）· 幂等（重复投递无副作用）· 事件累积结果 == `ledger_rebuild` 结果 · 按 `value.path` 增量定位 |
| A7 | 目录分类配置 | `docsDirs` = 四类正式源 + 过渡源（注释标 deprecated）；`archiveDir`/`docKinds` 在 Config 中**有声明**；`audit.checks` 含 `doc_misfiled`；`audit.archiveAfterDays` 存在 |

### M4

| # | 项 | 判据 |
|---|---|---|
| A8 | `audit_scan` 12 项 | 逐项**正反例**（命中/不命中各一） |
| A9 | **警告制** | 跑前跑后 `仓库/docs`、`[Agent进度]`、`仓库/src` 的**条目数 + 字节数完全一致**；不抛错、不阻断 |
| A10 | 未知检查项 | 临时加一个不存在的 `audit.checks` 项 → **必须报错**；验证后还原并说明 |
| A11 | `humanReport` | 含 路径 + 「原因：」 + 「建议：」（抽 2 条原文） |
| A12 | 误报回归位 | `legacy=true` 与 `tier=0` 的档**不参与** `doc_meta_missing`；`[Agent进度]` 这类真实目录名**不误报** `unfilled_slot` |
| A13 | `doc_misfiled` | **只报不动**（跑前后文件字节不变） |
| A14 | 归档阈值 | `audit.archiveAfterDays` 调小 → 建议数**单调增加** |
| A15 | 馆员职责 | `librarian_sweep` / `librarian_glossary` / `librarian_archive` / `librarian_patrol` / `librarian_backfill` 齐；命名规范化**改引用**、去重保留最新、归档落分片、核心数据库更新**保留原变更日志段**、坑库 README 索引、术语表写入；**幂等**（第二轮 moved/duplicates=0）；**正文零改动**；留痕 `librarianTouchedAt`/`librarianChanges` |
| A16 | 面板徽章真值 | host 快照 + client 贴回；`schemaVersion` 不认识 → `unknown`；缺三档 → `missing`（渲染 ✗）；补齐后复原 |
| A17 | 归档策略文档化 | 时间分片 `archive/<YYYY-MM>/` 已写进 `DESIGN.md` §5.5 |
| A18 | **M3 遗留标签** | `FIX-6` 可检索（A2 of 上轮）、`FIX-27`（成员按 `sessionId` 建索引）、`FIX-28`（标签补齐）是否已修；未修则**单列状态**，不算 A 组失败 |

---

## B 组 · 运行时核验（版本闸门通过后）

| # | 项 | 做法与判据 |
|---|---|---|
| B1 | 版本与工具面 | `contract_status` 首两行与工作树逐字一致 |
| B2 | **审计真跑 + 红黄清单** | 对真实项目跑 `audit_scan` → 导出全部 item 并**分类统计**（legacy / 缺元数据 / 放错目录 / 超长 / 缺进度 / 归档建议…）；同时给跑前后目录快照（须一致） |
| B3 | 快照刷新 | 触发后 `panel.json` mtime 与 sha 变化、内容正确；回面板徽章**不再是“待接”** |
| B4 | **馆员一轮治理** | 先 `dryRun` 出清单 → 限量执行 → 核对：命名/引用更新、归档落分片、核心数据库 changelog 追加、**正文 sha256 不变**；第二轮 `changed=false`（幂等） |
| B5 | **同名多会话成员（FIX-27）** | 找/造两个同名成员 → 各自徽章**按 `sessionId` 不串**；旧会话 id 不得丢失 |
| B6 | 归档建议落地抽查 | 取 1 篇被建议归档的档 → 执行后进 `archive/<分片>/`、引用已更新、再跑不再建议 |

---

## C 组 · 肉眼核验（由用户看；dsh 逐条记录答复）

| # | 请用户确认 |
|---|---|
| C1 | 面板徽章已为**真值**（三档/进度不再是“待接”；预算/异源可为 unknown 且能看出是 unknown） |
| C2 | 徽章状态在**灰度/色弱**下仍可分辨（不单靠颜色） |
| C3 | 同名多节点各自的徽章**不串**（FIX-27 修好后） |
| C4 | 审计结果在界面上可读（红黄数量/清单入口） |

---

## 报告格式

```
0 版本闸门：工作树版本 / contract_status 版本 / 工具数 → 通过 or 漂移（漂移则停 B 组）
A 逐条：通过/失败 + 命令 + ≤20 行原始输出（含 M3 遗留三项单列）
B 逐条：通过/失败/未核验(原因) + 证据（命令与输出、绝对路径）
C 用户答复原样记录 + 标注「由用户肉眼确认」
新缺陷：现象 / 涉及文件 / 修法 / 验收断言 / 最小复现
汇总：A 通过率 · B 通过/未核验 · C 已确认 · 新缺陷数
```

**判罚**：A 组为硬门槛（`A18` 的 M3 遗留项**不计入**，单列）；`B2/B3/B4` 必须有运行时证据，缺则标未核验；C 组不得代答；版本漂移必须写明。
