/**
 * 索引订阅喵（DESIGN §5.5：订阅 `domain/changed` 节流更新，参考宿主 `session-projection-cache`）喵。
 *
 * 与 `ledger_rebuild` 的分工喵：
 * - **事件驱动**做增量（节流：事件计数 + 时间窗，默认 200 事件 / 5s）喵
 * - **`ledger_rebuild`** 做全量兜底喵
 * 两者结果必须一致；重复投递同一变更不得产生副作用（幂等）喵。
 */
import { DOMAIN_NAMES } from './domains.js'

/** 默认节流参数：200 事件或 5 秒触发一次索引写入喵。 */
export const INDEX_FLUSH_DEFAULTS = { maxEvents: 200, flushMs: 5000 }

/**
 * 派生读模型：`path → 文档记录` 的搜索索引喵。
 * 它可以被全量 `build()`，也可以被事件增量 `upsert()`/`remove()`，两条路径结果必须一致喵。
 */
export function createSearchIndex() {
  const byPath = new Map()
  return {
    /** 全量重建（`ledger_rebuild` 路径）喵。 */
    build(records) {
      byPath.clear()
      for (const record of records || []) byPath.set(record.path, record)
      return byPath.size
    },
    /** 增量写入；同一个 path 重复投递只是覆盖，天然幂等喵。 */
    upsert(record) {
      byPath.set(record.path, record)
      return byPath.size
    },
    remove(path) {
      return byPath.delete(path)
    },
    has: (path) => byPath.has(path),
    list: () => [...byPath.values()],
    size: () => byPath.size,
    /** 稳定快照，供一致性比对喵（按 path 排序，与插入顺序无关）喵。 */
    snapshot() {
      return [...byPath.entries()]
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([path, record]) => ({ path, taskId: record.taskId, tier: record.tier, title: record.title }))
    },
  }
}

/**
 * 节流器喵：只负责**计数与判到期**，不自己做写入 —— 这样调用方可以精确控制什么时候落索引，便于测试喵。
 *
 * @param maxEvents - 攒够这么多条变更就到期喵。
 * @param flushMs - 或距上次刷写超过这么久也到期（时间窗）喵。
 * @param now - 注入时钟（测试用）喵。
 */
export function createIndexSync({ maxEvents = INDEX_FLUSH_DEFAULTS.maxEvents, flushMs = INDEX_FLUSH_DEFAULTS.flushMs, now = () => Date.now() } = {}) {
  const pending = new Set()
  let lastFlush = now()
  let events = 0
  let flushes = 0

  const isDue = () => pending.size >= maxEvents || (pending.size > 0 && now() - lastFlush >= flushMs)

  return {
    /** 记录一次变更；返回是否到期（到期后由调用方 `drain()`）喵。重复的 path 只入队一次喵。 */
    record(key) {
      events += 1
      pending.add(key)
      return isDue()
    },
    /** 取走待处理集合并记一次刷写喵。 */
    drain() {
      const keys = [...pending]
      pending.clear()
      lastFlush = now()
      flushes += 1
      return keys
    },
    isDue,
    stats: () => ({ events, flushes, pending: pending.size }),
  }
}

/**
 * 把「台账 + 事件 + 索引」接起来喵。
 *
 * 一个坑：`domain/changed` 的 `key` 是**物理键**（`keyOf()` 生成的哈希），不是逻辑路径，
 * 拿它去 `store.getDoc()` 必然查不到喵。所以：
 * - put/update 事件带 `value`，直接从 `value.path` 取逻辑路径（增量、精确）喵
 * - 只有删除事件既没 value 又只有物理键 —— 这时全量兜底重建一次（少见路径）喵
 *
 * @param ctx - 插件上下文（没有 `on` 时静默跳过订阅，方便测试）喵。
 * @param store - 台账 store喵。
 * @param index / sync - 可注入，便于测试与复用喵。
 * @returns `{ index, sync, applyIndex, rebuildIndex }`喵。
 */
export function attachIndexSync({ ctx, store, index = createSearchIndex(), sync = createIndexSync() }) {
  /** 全量兜底（与 `ledger_rebuild` 同步调用）喵。 */
  const rebuildIndex = () => index.build(store.listDocs())

  /** 把攒着的变更落到索引上；增量、幂等喵。 */
  const applyIndex = () => {
    const keys = sync.drain()
    let needsFull = false
    for (const key of keys) {
      const record = store.getDoc(key)
      if (record) {
        index.upsert(record)
        continue
      }
      if (String(key).includes('/') || String(key).includes('\\')) index.remove(key)
      else needsFull = true // 物理键 + 无 value ⇒ 删除事件，拿不到逻辑路径，全量兜底喵
    }
    if (needsFull) rebuildIndex()
    return index.size()
  }

  if (ctx && typeof ctx.on === 'function') {
    ctx.on('domain/changed', (change) => {
      if (!change || change.domain !== DOMAIN_NAMES.docs) return
      // FIX-58：一个实例服务多个项目 ⇒ 每个项目各有一份索引，各订阅一次这条总线。
      // 事件没带 `project` 字段（老 fixture / 老后端）时**照旧处理**，带了就必须对上号，
      // 否则 A 项目的变更会把 B 项目的索引整篇重建（白干活，且掩盖真实增量）喵。
      const owner = change.value && change.value.project
      if (owner && owner !== store.projectKey) return
      const logical = change.value && change.value.path ? change.value.path : change.key
      if (!logical) return
      if (sync.record(logical)) applyIndex()
    })
  }

  return { index, sync, applyIndex, rebuildIndex }
}
