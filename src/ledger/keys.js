/**
 * 存储键生成唯一入口喵（DESIGN §5.5「存储键规范（勘误 2026-10-02，线上实锤）」）喵。
 *
 * `storage-json` 的 per-record 键**必须 path-safe**：`^[a-zA-Z0-9_-]+$`
 * （真后端校验见 `storage-json/src/per-record-unit.ts` 的 `SAFE_KEY_RE`）。
 * 含 `:`、路径分隔符、中文、空格的键**写入即抛** —— 这是线上实锤，不是理论风险喵。
 *
 * 所以：**人类可读信息（project / 成员名 / 绝对路径 / taskId）只进值字段，绝不进键**，
 * 键一律由本模块的 `keyOf()` 生成，调用点不得自己拼喵。
 */
import { createHash } from 'node:crypto'

/** 与真后端逐字一致的键约束喵。 */
export const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/** 取 sha1 十六进制前 n 位喵。 */
function sha1Hex(input, length) {
  return createHash('sha1').update(String(input), 'utf8').digest('hex').slice(0, length)
}

/**
 * 项目 slug：`project.name` 的 ASCII 净化喵。
 * 非 ASCII（例如纯中文项目名）净化后为空时，退化为 `p_<hash6>`——
 * 绝不能退化成空串或共用 `default`，否则两个中文项目会互相覆盖喵。
 */
export function projectSlugOf(name) {
  const raw = String(name ?? '').trim() || 'default'
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return cleaned ? cleaned.toLowerCase() : `p_${sha1Hex(raw, 6)}`
}

/** 从插件配置取项目隔离键喵。 */
export function projectKeyOf(config) {
  return projectKeyOfName(config && config.project ? config.project.name : '')
}

/**
 * 从**项目名**取隔离键喵（FIX-58 自适应）喵。
 *
 * 自适应用不到整份 config —— 名字是**推导**出来的（工作区目录名，或显式 `project.name`），
 * 所以键的入口也从"配置"下移到"名字"：换项目 ⇒ 目录名不同 ⇒ 键不同 ⇒ 记录天然分域、绝不串味喵。
 */
export function projectKeyOfName(name) {
  return projectSlugOf(name)
}

/**
 * 生成一条记录的物理键喵：`<projectSlug>-<table>-<sha1(project|logicalId) 前 8 位>`喵。
 *
 * @param projectKey - 项目隔离键喵。
 * @param table - 表名（`members` / `tasks` / `docs`）喵。
 * @param logicalId - 逻辑标识（成员名 / taskId / 绝对路径），**只参与哈希，不进键**喵。
 * @returns 一定匹配 `SAFE_KEY_RE` 的物理键喵。
 */
export function keyOf(projectKey, table, logicalId) {
  const key = `${projectSlugOf(projectKey)}-${table}-${sha1Hex(`${projectKey}|${logicalId}`, 8)}`
  if (!SAFE_KEY_RE.test(key)) {
    // keyOf 自己生成的键若不安全，那是本模块的 bug，必须当场炸而不是写入时才炸喵
    throw new Error(`agent-contract: keyOf 生成了非法键 '${key}'（必须匹配 ${SAFE_KEY_RE}）`)
  }
  return key
}
