/**
 * 运行版插件的版本号喵（FIX-11 起给 `contract_status` 用；FIX-36 起也给派生快照用）喵。
 *
 * 抽成独立模块的原因：`tools.js` 已经 import 了 `panel/snapshot.js`，
 * 若快照反过来 import tools 就成环了 —— 版本号是两边都要读的**中性信息**，单独放最省事喵。
 *
 * 读自己的 `package.json`（用 `createRequire` 绕开 ESM JSON import 的兼容性问题）；
 * 读不到就返回 `(unknown)` —— 核验脚本会把两者比对，版本漂移当场暴露喵。
 */
import { createRequire } from 'node:module'

/** 读一次磁盘上的版本号（读不到返回 `(unknown)`）喵。 */
function readVersion() {
  try {
    const require = createRequire(import.meta.url)
    // 本模块在 src/ 下，包根是上一级；套件副本里也可能被平铺 → 两个候选都试喵
    for (const rel of ['../package.json', './package.json']) {
      try {
        return String(require(rel).version || '(unknown)')
      } catch {
        /* 换下一个候选 */
      }
    }
    return '(unknown)'
  } catch {
    return '(unknown)'
  }
}

/**
 * **模块加载那一刻**读到的版本喵（FIX-97）喵 —— 也就是"**进程里正在跑的**那个版本"喵。
 *
 * 为什么需要一个加载期常量：`pluginVersion()` 是**每次现读磁盘**的，所以升级插件后它会立刻变成新版本号，
 * 而进程里跑的**还是旧代码**（ESM 已经加载完了）⇒ 真机上出现过"磁盘 0.22.0、跑的是旧 schema"这种
 * **版本漂移**，用户只看到"所有契约工具一起废"，完全想不到是版本问题 ✗。
 * 现在把加载期版本留着，两下一比就能明说「请完整重启应用（只刷新窗口/页面不算）」喵。
 */
const LOADED_VERSION = readVersion()

/** 当前插件的版本号喵（形如 `0.3.1`；读不到返回 `(unknown)`）喵 —— **每次现读磁盘**喵。 */
export function pluginVersion() {
  return readVersion()
}

/** 进程里**正在跑**的版本（模块加载时读到的那个）喵。 */
export function loadedVersion() {
  return LOADED_VERSION
}

/**
 * 版本漂移检测喵（FIX-97 ①）喵。
 * @returns `{ loaded, disk, drift }`：`drift` 为真 = **磁盘换了、进程里还是旧的** ⇒ 要完整重启喵。
 */
export function versionDrift() {
  const disk = readVersion()
  return { loaded: LOADED_VERSION, disk, drift: LOADED_VERSION !== disk && disk !== '(unknown)' && LOADED_VERSION !== '(unknown)' }
}
