# VERIFY.md — 写入链与台账核验清单（执行方：dsh 主代理 + 子智能体）

> 动手前先读 **[`EXECUTOR-RULES.md`](EXECUTOR-RULES.md)**（执行方行为准则：先看清、再动手、留后路、留痕迹）。

> 用途：在「存储键规范」修复后，对**写入链、台账、闸门、派生器**做一次可复现的核验。
> 执行方须逐条交付**命令/工具调用 + 原始输出 + 涉及文件的绝对路径**；"看代码觉得没问题"不作为证据。
> 相关设计：`DESIGN.md` §5.2（装配/瘦身）、§5.4（产出工具）、§5.5（台账/键规范/派生器）、§5.7（审计）。
> 工程根：`D:\DSH插件\dsh-agent-contract`　项目根：`D:\Blockdustry`　宿主存储：`C:\Users\flafk\.dsh\storages\`

---

## 1. 本次核验要盯的缺陷（背景，勿重新调查）

| 编号 | 缺陷 | 现象 |
|---|---|---|
| D1 | per-record 键 = `${project}:${logicalId}`，而逻辑键本身含中文/Windows 路径/冒号 → 违反后端 path-safe 校验 `^[a-zA-Z0-9_-]+$` | 三处写入全炸：`ledger_rebuild`、`ledger_backfill --auto`、`progress_upsert`（报 `... is not path-safe`） |
| D2 | 测试桩 `fakeStorageDomain`（内存 Map）未复刻键校验 | **套件 29 项全绿，而线上一个字都写不进**（绿灯撒谎） |
| D3 | `librarian_patrol` 闸门与 `librarian_backfill --dryRun` 两口径 | 闸门报"清单为空"（空转），dryRun 报 204 条 needs_librarian |

**期望修法**（DESIGN §5.5「存储键规范（勘误）」）：统一 `keyOf(project, table, logicalId)`；人类可读字段只进**值**；批量失败隔离；闸门与预演同源；**桩必须复刻真后端校验**。

---

## 2. A 层 · 纯函数与单测（零副作用，必须 100% 通过）

**A1 `keyOf()` 合法性（脏输入矩阵）**
- 断言 `keyOf(project, table, logicalId)` 输出**全部**匹配 `^[a-zA-Z0-9_-]+$`
- project 维度：`blockdustry` / `block dustry` / `blockdustry:` / `区块链项目` / `PROJ-1` / 空串
- logicalId 维度：`T52_待办路线图研究` / `D:\Blockdustry\仓库\docs\子agent\P2_多智能体契约插件设计.md` / `T-001` / 含空格 / 含换行 / 超长（>1000 字符）
- 另需断言：**幂等**（同输入同输出）；**无碰撞**（随机 1000 组不同输入 → 键互不相同）

**A2 桩必须复刻真后端校验（D2 的回归位）**
- 向 `fakeStorageDomain` 写入键含 `:` / `\` / `/` / 中文 的记录 → **必须抛错**
- 通过标准：抛出的错误信息与真后端同类（含 `path-safe` 或等价措辞）

**A3 批量失败隔离**
- 造 10 条批量写入，其中第 5 条 logicalId 非法 → 断言：**9 条成功入库 + 1 条进失败清单**，且**整个过程不 abort**

**A4 口径一致（D3 的回归位）**
- 同一 fixture（含若干不合规档）下：`librarian_patrol` 闸门判定的 `needs_librarian` 条数 **===** `librarian_backfill --dryRun` 报告的条数（且二者调用同一函数）

---

## 3. B 层 · 仓库内集成（临时目录沙箱，可自动化）

| 项 | 步骤 | 通过标准 |
|---|---|---|
| **B1** 四处写入点 | 对 `ledger_rebuild` / `ledger_backfill(auto)` / `progress_upsert` / `doc_emit`(台账侧) 各执行一次 | ① 不抛 `path-safe` ② 记录可读回 ③ 记录内 `project` 字段正确 |
| **B2** 台账可重建 | 写入 → 台账目录改名或清空 → `ledger_rebuild` | 记录数/关键字段与清空前**一致** |
| **B3** dryRun 不落盘 | 目标档先记 sha256 → `--dryRun` → 再记 sha256 → 然后 `auto` | dryRun 前后 sha256 **不变**；auto 后 sha256 **变化** |
| **B4** legacy 语义 | 对无 front-matter 旧档回填 | 回填后 `legacy=false`、`tier=0`，因而**不参与** `doc_meta_missing` |
| **B5** 派生器零模型 | 调 `doc_emit` 写一份档 | front-matter 六字段齐（`taskId/tier/role/createdAt/chars/relatedFiles/keywords`），`keywords` **非空** |
| **B6** 正文零改动 | 馆员直修一份破损档（前后各记正文 sha256） | 正文 sha256 **不变**；仅 front-matter / 固定小节占位变化；留痕字段与核心数据库 changelog 均写入 |
| **B7** 装配瘦身 | 用一份 >5000 字符的任务文件做 fixture，装配一次 | 除 `mandate` 外合计 **≤2500 字符**；任务文件正文**不出现在**装配文本里；泛词（研究/产出/只读/docs/md/png/文件/仓库）**不得**作为切片命中原因 |

---

## 4. C 层 · 应用运行时（需完整重启应用 + 工作区指向 `D:\Blockdustry`）

| 项 | 做法 | 通过标准 |
|---|---|---|
| **C1** 配置一致 | 调用 `contract_status` | 输出的 `docsDirs` / 目录体检 / 预算 / 审计项与 `cordis.patch.yml` 一致 |
| **C2** 写入真落盘（**替代"套件绿"的硬证据**） | 派一个子智能体跑一次 `progress_upsert` | `D:\Blockdustry\[Agent进度]\*.md` 出现；且 `C:\Users\flafk\.dsh\storages\agent_contract_*/` 出现记录 |
| **C3** 键形态可读 | 列 `C:\Users\flafk\.dsh\storages\` 并抽 1 条 JSON 记录 | 文件名/键**只含** `[A-Za-z0-9_-]`；记录内能读到人类可读的 project/path |
| **C4** 闸门空转 | 合规状态下触发一次馆员巡检 | **空转**：无写入、无新增 changelog |
| **C5** 闸门放行 | 手动放一个不合规档（无 front-matter、文件名无 `_L3` 后缀）→ 再巡检 | 馆员被唤醒并直修（留痕 + 正文不动）；闸门与 dryRun 条数一致 |
| **C6** 端到端 | 派一个前台研究发现子智能体，产出三档档 | front-matter 自动生成；台账收录；谱系树可见该节点 |

---

## 5. 证据与报告格式（每条核验项都按此交）

```
[编号] 通过 / 失败
命令或工具调用: <原样>
原始输出: <≤20 行，保留报错原文>
涉及文件: <绝对路径，一行一个>
备注: <阻塞、例外、可疑点>
```
最后附：**汇总表（A/B/C 各层通过数）** + **未能核验的项及原因**（例："C2 需应用重启，当前未重启"）。

---

## 6. 判罚标准

- **A 层必须 100% 通过**；任一条失败 → 整批判 **FAIL**（键规范是地基，A2/A4 是本次缺陷的直接回归位）
- B 层允许"未覆盖"，但必须列明；**B2/C2 必须真写盘**，不接受"测试通过"当作"功能可用"
- C 层缺失 → 标注"未在运行时核验"，不得含糊为"通过"

## 7. 禁止事项

- 不得为了让测试通过而**放宽断言**（尤其：把键校验改成不校验、把 A2/A4 删掉）
- 不得修改既有源码或文档（只报告；修复需用户另行指示）
- 不得把 dryRun 报告当落盘证据

---

## 附录 A · 脏输入矩阵（A1 建议直接照抄成 fixture）

```
projects   = ['blockdustry', 'block dustry', 'blockdustry:', '区块链项目', 'PROJ-1', '', 'a'*300]
logicalIds = ['T52_待办路线图研究', 'D:\\Blockdustry\\仓库\\docs\\子agent\\P2_多智能体契约插件设计.md',
              'T-001', 'has space', 'has\nnewline', 'x'*1200, '', '中文/斜杠\\反斜杠:冒号']
tables     = ['members', 'tasks', 'docs']
```

## 附录 B · 关键路径常量

```
工程根      D:\DSH插件\dsh-agent-contract
项目根      D:\Blockdustry
台账存储    C:\Users\flafk\.dsh\storages\agent_contract_{members,tasks,docs}\
宿主会话    C:\Users\flafk\.dsh\sessions\<工作区转义名>\
profile     C:\Users\flafk\.dsh\profiles\desktop\（package.json / cordis.patch.yml）
canonical   bash scripts/verify.sh   或   npm test
```

---

## 8. 核验期行为规则（2026-10-02 追加）

1. **不得改动运行时状态**：清空/重建台账、删除或改写 runtime 记录、修改 profile 配置等，一律禁止。
2. **不得改动既有项目文档**：包括往 `核心数据库.md`、`坑/README.md` 等追加"本次核验记录"。留痕请写进**你自己的核验报告**或临时目录；如确实建议长期保留，写进报告的"建议"段。
3. **拿不到前提 → 标未核验**：若某项需要"合规状态""干净工作区""应用重启"等前提而当前不具备，直接标 `未核验 + 原因`；**不许**自造前提（例如临时清空台账）来使其可测。
4. **串行核验**：批量/落盘类核验不要与运行时活动（子智能体、巡检）并发——并发会读到中间态（本次 B3 曾出现假失败）。
5. **夹具必须可还原**：临时写入的夹具、临时派发的成员、临时产出的档，核验后按 sha256 或清单逐一还原/删除，并在报告"收尾"段交代。
6. **套件入口**：优先用纯 Node 入口（`node scripts/verify-node.mjs`）；若只有 bash 入口且沙箱禁命名管道，报告该阻塞，**不要**为跑通而改脚本或放宽断言。
