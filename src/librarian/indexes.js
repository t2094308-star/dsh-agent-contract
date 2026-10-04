/**
 * **各类别索引**喵（FIX-103）喵 —— 每个类别目录一份 `<类别目录>/索引.md`，机器区块由**派生器**生成喵。
 *
 * 为什么要它（真机盘点 2026-10-04）喵：`派生态索引.md` 只覆盖产出档 ⇒ **研究 23 篇 / 修改 1 篇没有索引**，
 * 人和 agent 都看不到"这一类都有哪些档"，检索只能靠扫盘 ✗。
 *
 * 三条纪律喵：
 * ① **单一来源**：内容全部取自 `documentCensus()`（与 `doc_census` 工具、派生态索引同一份派生结果）；
 * ② **只在标记区块内增删**（沿用 §9-28 的幂等口径），区块外一个字节不动；
 * ③ **幂等**：内容没变就不写（两遍跑 sha 不变）喵。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { joinUnderRoot } from '../project.js'
import { censusRowLine } from '../ledger/census.js'
import { INDEX_BLOCK_END, INDEX_BLOCK_START } from './merge.js'

/** 类别索引的文件名喵（固定名，别再各写一套）喵。 */
export const KIND_INDEX_FILE = '索引.md'

/** 各类别的**表头**（FIX-103 ③：不同类别看不同字段）喵。 */
export const KIND_INDEX_HEADERS = {
  产出档: '档级 · 任务号 · 角色 · 标题',
  研究: '主题 · 关键词 · 相关档案',
  坑: '主题 · 关键词 · 相关档案',
  修改: '主题 · 关键词 · 相关档案',
  审查: '主题 · 关键词 · 结论',
  整合清单: '覆盖的任务号',
  核心数据库: '条目 · 关键词',
  归档: '归档月 · 原路径',
}

/**
 * 渲染一个类别的索引**机器区块**喵（纯函数：给定行 → 文本，便于断言）喵。
 * @returns 完整区块文本（含标记；空类别写「（空）」）喵。
 */
export function renderKindIndexBlock({ kind, rows = [], now = null }) {
  const lines = [
    INDEX_BLOCK_START,
    `## ${kind}索引（机器区块，由插件派生器生成 —— 只在本区块内增删）`,
    '',
    `- 字段：${KIND_INDEX_HEADERS[kind] || '路径 · 任务号 · 标题'}`,
    // **刻意不写生成时间**：写进去就成了"每次都变"的内容 ⇒ 幂等失效、白写一遍（§9-28 的口径）✗
    // 时间留在回执/返回里（`scannedAt` / `files[].wrote`）就够喵
    `- 篇数：${rows.length}`,
    '',
  ]
  if (!rows.length) lines.push('- （空）')
  for (const row of rows) lines.push(censusRowLine(row))
  lines.push(INDEX_BLOCK_END)
  return lines.join('\n')
}

/** 把新区块合并进既有文本：区块外一字不动；没有标记就**追加**（绝不重排历史手工内容）喵。 */
export function mergeKindIndexBlock(existing, block) {
  const text = String(existing || '')
  const start = text.indexOf(INDEX_BLOCK_START)
  const end = text.indexOf(INDEX_BLOCK_END)
  if (start === -1 || end === -1 || end < start) {
    const head = text.trim() ? `${text.replace(/\s+$/, '')}\n\n` : `# 索引\n\n`
    return `${head}${block}\n`
  }
  return `${text.slice(0, start)}${block}${text.slice(end + INDEX_BLOCK_END.length)}`
}

/**
 * 写各类别索引喵（**幂等**：内容没变就不写）喵。
 * @returns `{ files: [{ kind, path, items, wrote }], failed }`喵。
 */
export async function writeKindIndexes({ project, census, dryRun = false, now = new Date().toISOString(), read = readFile, write = writeFile } = {}) {
  const files = []
  const failed = []
  const kinds = (project && project.docKinds) || {}
  for (const [kind, dir] of Object.entries(kinds)) {
    if (!dir) continue
    const rows = (census && census.byKind ? census.byKind[kind] : null) || []
    const path = joinUnderRoot(dir, KIND_INDEX_FILE)
    const block = renderKindIndexBlock({ kind, rows, now })
    let existing = ''
    // FIX-106 诊断（用户点名）：把"读失败被吞成空串"这件事**记下来** —— 否则它一眼看去与"文件不存在"一样，
    // 于是"读失败 ⇒ existing='' ⇒ 必然重写"就成了永远查不出来的假重写 ✗ 喵
    let readFailed = null
    try {
      existing = String(await read(path, 'utf8'))
    } catch (error) {
      existing = ''
      readFailed = String((error && error.message) || error)
    }
    /**
     * FIX-111 诊断：定位"哪一次写入把目录前缀多拼了一遍"喵。
     * **纪律**：探针整体包 try/catch ⇒ 探针自己出错**只打一行 warning、绝不崩套件**；
     * 而且必须放在 `existing` 读出来**之后**（放前面会 TDZ，套件直接崩在 OK 45 —— 上一版就是这么错的）喵。
     */
    if (process.env.F106_WHO) {
      try {
        const t3 = rows.find((row) => String(row.path || '').includes('T-3_又污染'))
        const short = new Error().stack.split('\n').slice(1, 4).map((line) => (line.trim().split(' ')[1] || '?')).join('<')
        console.log('[WHO] ' + short + ' kind=' + kind + ' rows=' + rows.length
          + ' row0=' + JSON.stringify(rows[0] ? rows[0].path : null)
          + ' t3=' + JSON.stringify(t3 ? t3.path : null)
          + ' existingLen=' + existing.length)
      } catch (error) {
        console.warn('[WHO] 探针自己出错（已忽略，不影响套件）：' + ((error && error.message) || error))
      }
    }
    const merged = mergeKindIndexBlock(existing, block)
    // FIX-106 诊断：**首次创建**（原文件不存在）与"内容变化的重写"是两回事 —— 分开记，别混成一个 wrote 喵
    const firstCreate = existing === ''
    const wrote = merged !== existing
    if (!wrote) {
      files.push({ kind, path, items: rows.length, wrote: false, readFailed, firstCreate, existingLen: existing.length, mergedLen: merged.length, previousText: existing })
      continue
    }
    if (dryRun) {
      files.push({ kind, path, items: rows.length, wrote: false, wouldWrite: true, readFailed, firstCreate, existingLen: existing.length, mergedLen: merged.length })
      continue
    }
    try {
      await mkdir(dir, { recursive: true })
      await write(path, merged, 'utf8')
      files.push({ kind, path, items: rows.length, wrote: true, readFailed, firstCreate, existingLen: existing.length, mergedLen: merged.length, previousText: existing, writtenText: merged })
    } catch (error) {
      failed.push({ kind, path, error: String((error && error.message) || error), readFailed, firstCreate })
    }
  }
  return { files, failed }
}

/**
 * 哪些类别**缺索引 / 索引与磁盘对不上**喵（FIX-103 ④ 的审计判据）喵。
 * @returns `[{ kind, path, items, disk, reason }]`喵。
 */
export async function kindIndexGaps({ project, census, read = readFile } = {}) {
  const gaps = []
  const kinds = (project && project.docKinds) || {}
  for (const [kind, dir] of Object.entries(kinds)) {
    if (!dir) continue
    const rows = (census && census.byKind ? census.byKind[kind] : null) || []
    if (!rows.length) continue              // 空类别不报（FIX-103：空类别可只写「（空）」）喵
    const path = joinUnderRoot(dir, KIND_INDEX_FILE)
    let text = null
    try {
      text = String(await read(path, 'utf8'))
    } catch {
      text = null
    }
    if (text === null) {
      gaps.push({ kind, path, items: 0, disk: rows.length, reason: '这一类还没有索引（人/agent 看不到"这一类都有哪些档"）' })
      continue
    }
    // 只数**条目行**（渲染出来每行都以路径开头）；`- 字段：…` / `- 篇数：…` 这类表头不算喵
    const items = (text.match(/^- .*[\\/]/gm) || []).length
    if (items !== rows.length) {
      gaps.push({ kind, path, items, disk: rows.length, reason: `索引条目数与磁盘篇数不符（索引 ${items} vs 磁盘 ${rows.length}）` })
    }
  }
  return gaps
}
