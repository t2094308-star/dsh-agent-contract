# RELEASE.md — 提交前清单（dsh-agent-contract）

> 用途：M2.5/M4 修完后的收尾与提交。目标是把"**必须绿**"与"**可作已知限制随版发布**"分开，避免小问题拖成阻塞。

---

## 0. 提交形态（需拍板）

| 选项 | 说明 |
|---|---|
| (a) 本地定稿 | 当前形态：`~/.dsh/profiles/desktop` 里 `link:D:\DSH插件\dsh-agent-contract`，自己用 |
| (b) 打 tarball / 复制到发布目录 | 便于备份与分发，不改挂载方式 |
| (c) 推 npm | 需定包名、license、README 是否要英文版；`peerDependencies: *` 已有 |
| (d) 纳入 git | 当前**无仓库**（插件目录与项目目录都不是 git 仓库）；要版本化需 `git init` |

---

## 1. 必须绿（硬门槛，缺一不可）

1. `npm test`（`node scripts/verify-node.mjs`）**全绿**，记录实际项数
2. **版本闸门**：`contract_status` 的插件版本 == 工作树 `package.json` 版本；工具清单逐字一致
3. **M5 端到端跑通一次**：研究 → 实现 → 审查 → 对抗审查 → 修复 → 收档，全程审计黄绿可读（这是唯一还没跑过的整体验收）
4. **无临时产物残留**：`probe*/`、`.review-tmp/`、`tmp-*`、沙箱脚本、调试 `console.log`
5. **与开工前 git 基线对账**（`D:\Blockdustry\仓库` 是 git 仓库，基线提交 `11f890e`）：`git status --short docs` 与 `git diff --stat HEAD -- docs` 必须只剩**有意产出**（新增文档/追加 changelog），不得有覆盖式改动；6. **配置与设计一致**：`docsDirs`（四类正式源 + 过渡源）、`archiveDir`、`docKinds`、`audit.checks`、`archiveAfterDays`

---

## 2. 提交物（文档也是交付的一部分）

| 文件 | 要求 |
|---|---|
| `DESIGN.md` | §7 里程碑全 ✓；**§7.5 未闭合项清单**清空或在 README 里标为"已知限制" |
| `README.zh.md` | 安装/挂载、配置项（`project.root`/`paths`/`budgets`/`modelRoutes`）、用法（委派/产出/检索/审计/馆员/面板）、**已知限制** |
| `FIX.md` | 全部条目标绿（含 FIX-17/18） |
| `docs/REVIEW-*.md` | 各轮审查报告归档齐（M3/M2.5/M4 等） |
| `CHANGELOG.md`（建议） | 0.1.0 → 当前版本的关键修复（键规范、fail-open、注入、血缘根、快照等） |
| `cordis.patch.yml` | 与 DESIGN §5.1 完全一致；过渡源一行标 deprecated |

---

## 3. 已知限制（可随版发布，但**必须写进 README**）

- **3.3 面板开关读回**：写侧走 `settings.pluginToggles`，读侧宿主无公开 API → best-effort（切开关后本会话生效，重启后以宿主渲染为准）
- **对抗审查依赖异源模型配置**：未配 `modelRoutes.adversary` 时「异源」徽章为 `unknown`，且审计会给 `cross_vendor` 提醒
- **归档 / 归位是"人或馆员触发"**，不是自动后台任务
- **面板数据来自派生快照** `<项目根>/.agent-contract/panel.json`（可重建、非真相、可随时删；建议 `.gitignore`）
- **Windows 终端工具名是 `pwsh`**（不是 `bash`）；插件内部已按平台解析

---

## 4. 提交前最后三步

1. 清掉临时产物 → 跑 `npm test` 全绿
2. **完整重启**（托盘 Quit）→ 跑 **M5 端到端**
3. 让 dsh 出「提交前终检」：版本闸门 + M5 记录 + §7.5 遗留清单逐条状态 + 已知限制是否已写进 README

---

## 5. 遗留小问题的分流原则

- **功能缺陷**（如 FIX-17 同类）→ 必须修，不随版发布
- **宿主限制导致的"部分完成"**（3.3 读回）→ 写进「已知限制」，随版发布
- **验证欠账**（C4 闸门空转需干净工作区）→ 记录在案，不阻塞提交，但要在 README/§7.5 写明"未核验"
- **迁移/治理类**（MIGRATE 22 篇、归档执行）→ 属运维动作，可与提交解耦，单独排期
