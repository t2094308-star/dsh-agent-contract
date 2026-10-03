/**
 * 模型路由的**默认值与合并口径**喵（裁决 B，2026-10-03）喵。
 *
 * 背景喵：`modelRoutes` 现在是 **volatile** 字段（由设置页管理、不吃配置文件）——
 * 宿主只允许写 `schema.meta.volatile` 的字段，而 volatile 字段又不参与配置文件解析 ✗。
 * 于是"路由的默认值"必须落在**插件里**，而且必须**只有一份口径**：
 * 派单（`channels.js` 的 `routeOptions()`）与契约文案（`assemble.js` 的 `routeNoteFor()`）都走这里，
 * 否则会出现"契约写着非异源、实际派单却是异源"的自相矛盾喵。
 *
 * 护栏（用户裁决②）喵：**空对象 / 缺键 = 继承默认** ——
 * 用户把 `modelRoutes` 写成 `{}` 时，adversary 仍必须拿到 `glm-5.3-flash`，
 * 绝不允许"真异源静默失效"（那是看不见的失效，比报错更糟）喵。
 */
export const DEFAULT_MODEL_ROUTES = { adversary: 'glm-5.3-flash' }

/**
 * 合并出**生效路由**喵：内置默认 ⊕ 配置/设置页给的值。
 * 单独抽出来是为了让"默认值"这件事只有一个入口（与 `index.js` 里 schema 的 `.default()` 同值）喵。
 */
export function mergeModelRoutes(config) {
  const provided = (config && config.modelRoutes) || {}
  return { ...DEFAULT_MODEL_ROUTES, ...(provided && typeof provided === 'object' ? provided : {}) }
}
