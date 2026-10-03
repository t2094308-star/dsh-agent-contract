/**
 * **全局共享文件**清单喵（FIX-99 ④）喵 —— 一个项目一份、谁写谁覆盖的那些文件喵。
 *
 * 为什么需要它（真机实证）喵：宿主**不给**跨会话共享常驻子会话
 * （`packages/subagent/subagent/src/continuation-activation.ts:309/475`：
 * `subagent "<childId>" belongs to another parent session`）⇒ "一个常驻馆员服务所有会话"在宿主层面
 * **不可能**。于是"跨会话同时改同一批全局文件"就没人拦了 —— 插件自己踩过：`坑/README.md` 被整篇覆盖且无备份 ✗。
 * 宿主的实例模型改不了，就只能**自己立机制**：把全局文件登记成"占用"，谁写谁先在作业登记卡里声明，
 * 审计按占用冲突（`occupancy_conflict`）报出来喵。
 */
import { joinUnderRoot } from '../project.js'
import { CORE_INDEX_FILE, coreDbDir, coreIndexPath, pitfallIndexPath } from './duties.js'

/**
 * 该项目的全局共享文件清单喵（**不是**类别目录里的普通文档）喵。
 * @returns `[{ key, path, why }]`喵。
 */
export function globalSharedFiles(project) {
  if (!project || !project.root) return []
  const rows = [
    { key: '坑库索引', path: pitfallIndexPath(project), why: '所有坑档的汇总索引（追加式）' },
    { key: '核心数据库目录', path: coreDbDir(project), why: '核心数据库的索引与 changelog' },
    { key: '派生态索引', path: coreIndexPath(project), why: `派生态文档索引（${CORE_INDEX_FILE}）` },
  ]
  if (project.archiveDir) rows.push({ key: '归档目录', path: project.archiveDir, why: '归档分片目录（移动/改名）' })
  // 派生态面板快照也全局一份（派生写，谁写谁覆盖）喵
  rows.push({ key: '面板快照', path: joinUnderRoot(project.root, '.agent-contract/panel.json'), why: '面板派生快照（可重建）' })
  return rows.filter((row) => row.path)
}

/** 一行话（契约 / 回执里用）喵：把全局文件与"写前先查占用"的规矩一起说清喵。 */
export function globalSharedFilesText(project) {
  const rows = globalSharedFiles(project)
  if (!rows.length) return ''
  return '全局共享文件（**跨会话同时写会互相覆盖**，写前先查占用、必要时排队）：'
    + rows.map((row) => `${row.key} \`${row.path}\``).join('；')
}
