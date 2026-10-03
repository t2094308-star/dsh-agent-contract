/**
 * **一次扫描，四处共用**喵（FIX-102 / FIX-103；用户硬要求"单一来源"）喵。
 *
 * 谁用它喵：
 * - `doc_census` 工具（FIX-102）：一次给全部档的**机读元数据**，别再靠"一篇篇读全文"建索引；
 * - 各类别索引（FIX-103）：`<类别目录>/索引.md` 的机器区块，由这里的派生结果直接渲染；
 * - 派生态索引（`核心数据库/派生态索引.md`）与契约里的「文档规范」段（FIX-101）——
 *   它们读的是**同一个 `project` 视图 + 同一份派生器**，路径与类别不再各算一套喵。
 *
 * 纪律（写进注释就是纪律）喵：索引需要的字段（路径 / 类别 / 档级 / 任务号 / 标题 / 字数 / 关键词 /
 * relatedFiles / legacy / 归档 / 指针）**全都是机读的**，一律由 `deriveFromFile()`（零模型调用）算出来；
 * **不要**为了建索引去读正文 —— 那会白烧一到两个数量级的上下文（真机实证：馆员连读几十篇全文）喵。
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { deriveFromFile } from './derive.js'
import { scanDocAreas } from './docarea.js'
import { joinUnderRoot } from '../project.js'

/** 索引/普查里出现的字段（单一来源：渲染与断言都看这份表）喵。 */
export const CENSUS_FIELDS = [
  'path', 'name', 'kind', 'tier', 'taskId', 'title', 'chars', 'keywords',
  'relatedFiles', 'legacy', 'archived', 'needsLibrarian', 'updatedAt',
]

/** 归档档的 front-matter 标记（FIX-69 起用元数据而不是文件名前缀）喵。 */
const ARCHIVED_RE = /^archived:\s*true\s*$/mi

/**
 * 扫一遍项目里的文档，产出一份**机读普查表**喵。
 *
 * @param args.project - 项目视图（`docKinds` 决定扫哪些目录）喵。
 * @param args.read - 读文件（注入便于断言；默认 `fs.readFile`）喵。
 * @param args.readdirImpl - 列目录（注入便于断言）喵。
 * @param args.withArchive - 是否连 `归档` 目录一起扫（默认 true；索引要覆盖八类）喵。
 * @returns `{ rows, byKind, counts, scannedAt }`喵。
 */
export async function documentCensus({ project, read = readFile, readdirImpl = readdir, withArchive = true } = {}) {
  const scanned = await scanDocAreas({ project, readdirImpl })
  const archiveDir = project && project.archiveDir ? String(project.archiveDir) : null
  const rows = []
  const pushRow = async (path, name, kind, tier) => {
    try {
      const text = await read(path, 'utf8')
      const { legacy, derived } = deriveFromFile({
        fileName: name,
        text: String(text),
        mtime: undefined,
        glossary: [],
      })
      rows.push({
        path,
        name,
        kind,
        tier: Number.isFinite(tier) && tier ? tier : (derived.tier || 0),
        taskId: derived.taskId || null,
        title: derived.title || String(name).replace(/\.md$/i, ''),
        chars: derived.chars || 0,
        keywords: derived.keywords || [],
        relatedFiles: derived.relatedFiles || [],
        legacy,
        archived: ARCHIVED_RE.test(String(text)),
        needsLibrarian: (derived.needsLibrarian || []).map((item) => item.code),
        updatedAt: derived.createdAt || null,
      })
    } catch {
      /* 单篇读不到就跳过它，绝不带塌整份普查喵 */
    }
  }
  for (const row of scanned) {
    if (row.nonMd) continue
    if (basename(row.path).toLowerCase() === '索引.md') continue   // 索引自身不算一篇档喵
    await pushRow(row.path, row.name, row.kind, row.tier)
  }
  // 归档目录（`<archiveDir>/<YYYY-MM>/…`）单独收：scanDocAreas 刻意不扫它（它不是"类别目录"）喵
  if (withArchive && archiveDir) {
    let shards = []
    try {
      shards = await readdirImpl(archiveDir, { withFileTypes: true })
    } catch {
      shards = []
    }
    for (const shard of shards) {
      if (!shard.isDirectory()) continue
      const shardDir = joinUnderRoot(archiveDir, shard.name)
      let files = []
      try {
        files = await readdirImpl(shardDir, { withFileTypes: true })
      } catch {
        files = []
      }
      for (const file of files) {
        if (file.isDirectory() || !file.name.toLowerCase().endsWith('.md')) continue
        await pushRow(joinUnderRoot(shardDir, file.name), file.name, '归档', null)
      }
    }
  }
  const byKind = {}
  for (const row of rows) {
    if (!byKind[row.kind]) byKind[row.kind] = []
    byKind[row.kind].push(row)
  }
  for (const list of Object.values(byKind)) list.sort((a, b) => String(a.path).localeCompare(String(b.path)))
  return {
    rows,
    byKind,
    counts: Object.fromEntries(Object.entries(byKind).map(([kind, list]) => [kind, list.length])),
    scannedAt: new Date().toISOString(),
  }
}

/** 一眼看得出的紧凑行（`doc_census` 与索引区块共用同一种渲染）喵。 */
export function censusRowLine(row) {
  const bits = [row.tier ? `L${row.tier}` : null, row.taskId || null, row.title]
    .filter(Boolean).join(' ')
  const tail = [
    `${row.chars} 字`,
    row.keywords && row.keywords.length ? `关键词 ${row.keywords.slice(0, 4).join('、')}` : null,
    row.legacy ? 'legacy' : null,
    row.archived ? 'archived' : null,
    row.needsLibrarian && row.needsLibrarian.length ? `待办 ${row.needsLibrarian.join('/')}` : null,
  ].filter(Boolean).join(' · ')
  return `- ${row.path} — ${bits}（${tail}）`
}
