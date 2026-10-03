/**
 * 待办文件的**写通道**喵（FIX-41）喵 —— 面板第一次"可写"，护栏必须齐喵。
 *
 * 为什么需要一条宿主路由：client 侧的 `remote.workspaceFiles` **没有任何写操作**（M4 调查已确认，
 * 其 README 原文 "The service exposes no mutation operation"），而 `typert` 已裁定不引入 ⇒
 * 面板要写唯一那个可写目标（配置里的待办文件），只能走 DESIGN §5.6 **早已预留的备选 (b)**：
 * 宿主 `ctx.webServer.register()` 自注册一条 HTTP 路由（better-sidebar 的 `/sidebar/api/*` 就是同款做法）喵。
 * **读**仍然走只读 remote（FIX-29/38 那条链路不动），这条路由**只写**、且只写一个路径喵。
 *
 * 八条护栏（对应 FIX-41 的 ③④⑤⑥⑦）喵：
 * ① **只允许写白名单路径**：必须严格等于 `project.panel.todoFile`，别的一律 403 `path-not-allowed`喵
 * ② **不破坏人工内容**：勾选走**行级外科手术**（只翻那一行的 `[ ]`↔`[x]`），其余字节一字不动喵
 * ③ **可回退**：写入前走 `writeWithBackup()`（备份到 `.agent-contract/backups/<时间戳>/…`），
 *    备份失败即**中止写入**（返回 5xx，不落盘）喵
 * ④ **不覆盖他人改动**：请求带 `baseHash`（client 渲染时那份内容的指纹），与当前文件不符 → 409 `stale-file`喵
 * ⑤ 方法/路径/请求体不合法一律显式报错，**不静默**（面板据此显示原因）喵
 * ⑥ 路由带 **Host 回环栅栏**（同 better-sidebar 的 trust-fence / 网关 fence 语义：DNS-rebinding 防御）喵
 * ⑦ **只写不读**：不提供任何读接口（读仍归只读 remote）喵
 * ⑧ 全程不碰台账与其它文件（B 区、审计区仍只读）喵
 */
import { readFile } from 'node:fs/promises'
import { writeWithBackup } from '../librarian/backup.js'
// FIX-96 ②：强制刷新与 `audit_scan` / 启动自愈**同源**（共用一句回执文案）喵
import { refreshReceiptText } from './refresh.js'

/** 待办写路由的路径喵（client 用同一条相对 URL POST 过来）喵。 */
export const TODO_ROUTE_PATH = '/agent-contract/api/todo'

/** 勾选框行的形状喵：`- [ ] xxx` / `* [x] xxx`（允许行首缩进）喵。 */
const CHECKBOX_RE = /^(\s*[-*]\s+\[)( |x|X)(\])/

/**
 * 文本指纹喵（FNV-1a 32 位，**按 UTF-16 code unit** 逐位算）喵。
 *
 * 为什么不用 sha256：冲突检测发生在 **client**，浏览器里同步算 sha256 需要 `crypto.subtle`（异步 + 仅安全上下文）；
 * 而 FNV-1a 纯算术即可，两边实现逐位一致（套件里有**交叉比对**断言守着，防漂移）喵。
 * 它只用来判"文件在我操作期间有没有被改过"，不是密码学用途喵。
 *
 * **注意：算之前一定要过 `normalizeHashInput()`**（见下），否则会踩宿主读通道的尾换行差异喵。
 */
export function hashText(text) {
  const source = String(text ?? '')
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 指纹输入的**规范化**喵（FIX-42，根因已定位在宿主侧）喵。
 *
 * 真凶不在插件，而在 dsh harness 的 `packages/api/workspace-files/src/index.ts` 的 `cutPage()`喵：
 * 文件以 `\n` 结尾时，最后一个换行已经触发过 `complete()`，收尾那步 `if (current.length > 0) complete()`
 * 因为 `current === ''` **不再 push 尾空行** ⇒ `lines.join('\n')` 把**结尾换行吃掉**喵。
 * 而宿主写路由用的是 node `readFile()`，**保留**尾换行 ⇒
 * **只要待办文件以换行结尾（手写 markdown 几乎都是），client 送来的 baseHash 就永远对不上**，
 * 未改动也每次 409（保护逻辑没写错，是它比的两份文本不是同一份）喵。
 *
 * 所以：**比指纹前先把尾部换行统一去掉**（两端各去掉全部 `\r`/`\n` 尾巴）——
 * 这样"宿主读回来的文本"与"磁盘原文"必然得到同一个指纹，与换行数量的差异无关喵。
 *
 * **已知代价（写明不藏）**：只在**文件末尾**增删空行的外部改动，指纹不会变（这类改动不会被判成冲突）喵。
 * 值这个价：换来的是"未改动绝不误报"，而误报会把正常操作整条路堵死喵。
 */
export function normalizeHashInput(text) {
  return String(text ?? '').replace(/[\r\n]+$/, '')
}

/** 规范化后取指纹喵（**所有**比对与下发都用它，别直接调 `hashText`）喵。 */
export function hashOf(text) {
  return hashText(normalizeHashInput(text))
}

/**
 * 行级翻转一个勾选框喵（FIX-41 ④ 的核心）喵。
 *
 * **只改那一行的 `[ ]`↔`[x]` 三个字符**：格式、注释、缩进、顺序、其它条目一律原样喵。
 * @returns 新文本；越界或那一行不是勾选框 → `null`（调用方据此报 400）喵。
 */
export function toggleTodoLine(text, lineNumber) {
  const lines = String(text ?? '').split('\n')
  const index = Number(lineNumber)
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return null
  const line = lines[index]
  const match = CHECKBOX_RE.exec(line)
  if (!match) return null
  const flipped = `${match[1]}${match[2] === ' ' ? 'x' : ' '}${match[3]}`
  lines[index] = `${line.slice(0, match.index)}${flipped}${line.slice(match.index + match[0].length)}`
  return lines.join('\n')
}

/**
 * 保存时**保住文件的换行约定**喵（FIX-42 的配套）喵。
 *
 * client 读回来的文本天然少了尾换行（宿主 `cutPage()` 的锅，见上），用户若没动结尾，
 * 保存就不该悄悄把文件的尾换行删掉 ⇒ 原文件以换行结尾、而新内容没有时，**补回一个**喵。
 * 代价写明：若文件原本以**多个**空行结尾，保存后会只剩一个（这类"末尾空行"差异不做逐字节保留）喵。
 */
export function preserveTrailingNewline(current, next) {
  if (typeof current !== 'string' || typeof next !== 'string') return next
  if (/\n$/.test(current) && !/\n$/.test(next)) return `${next}\n`
  return next
}

/**
 * 白名单：只认**本项目**配置里的那一个待办文件（FIX-41 ③）喵。
 *
 * FIX-58 起一个实例可能同时服务多个项目（根跟着工作区走）⇒ 第一个参数可以是
 * **单个项目**，也可以是**项目数组**（登记簿里所有已解析过的项目）；只要命中其中**任何**一个
 * 项目自己声明的 `panel.todoFile` 就算在内 —— 仍然**不是**"任意路径"，白名单边界没松喵。
 */
export function isTodoPathAllowed(projectOrList, path) {
  if (!path) return false
  const list = Array.isArray(projectOrList) ? projectOrList : [projectOrList]
  for (const project of list) {
    const allowed = project && project.panel ? project.panel.todoFile : null
    if (allowed && String(path) === String(allowed)) return true
  }
  return false
}

/** 用请求里的绝对路径**反查**它属于哪个已登记项目（多个都不认领就返回 null）喵。 */
export function projectForTodoPath(projectOrList, path) {
  const list = Array.isArray(projectOrList) ? projectOrList : [projectOrList]
  return list.find((project) => isTodoPathAllowed(project, path)) || null
}

/** 写 `{ ok, error }` 信封喵（与宿主 remote 同款形状，客户端好处理）喵。 */
function sendJson(res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  } catch {
    /* 连接已经断了就算了喵 */
  }
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/** 读请求体（有上限，别让一条请求把内存吃光）喵。 */
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Host 回环栅栏喵（FIX-41 ⑥）喵。
 *
 * 与 better-sidebar 的 `trust-fence.ts` / 网关 `api-request-trust` **同语义**：
 * Host 头必须是回环（localhost / 127.x / [::1]）或在 `trustedHosts` 里；
 * 显式声明跨站的 `sec-fetch-site: cross-site` 与不匹配的 `Origin` 一律拒绝，`Origin: null` 同样拒绝喵。
 * 这是 DNS-rebinding / 跨站写防御，不是身份认证（本地面板本来就没有会话凭据）喵。
 */
export function isTrustedLocalRequest(headers, trustedHosts = []) {
  const header = (name) => (headers && typeof headers[name] === 'string' ? headers[name] : undefined)
  const host = header('host')
  if (!host) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const loopback = hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]'
    || /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostUrl.hostname)
  const trusted = (trustedHosts || []).some((entry) => {
    try {
      const url = new URL(`http://${entry}`)
      return url.hostname === hostUrl.hostname
    } catch {
      return false
    }
  })
  if (!loopback && !trusted) return false
  if (header('sec-fetch-site') === 'cross-site') return false
  const origin = header('origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}

/**
 * 造路由处理器喵（纯工厂，便于单测：`fence` / `write` 都可注入）喵。
 *
 * 请求：`POST { path, baseHash, action: 'toggle' | 'save', line?, content? }`喵。
 * 响应：成功 `{ ok: true, value: { hash, backupPath, changed } }`；
 * 失败 `{ ok: false, error: { code, message } }`，code ∈
 * `forbidden` / `method-error` / `bad-request` / `path-not-allowed` / `stale-file` / `not-a-checkbox` / `write-failed`喵。
 */
export function createTodoHandler({
  getProject, getProjects, fence = () => true, write = writeWithBackup, read = readFile,
  now = () => new Date().toISOString(), readBodyImpl = readBody,
  // FIX-96：面板「强制刷新」的实现（跑审计 + 重写快照，与 `audit_scan` 同源）与该项目的 store 取法喵
  refresh = null, storeFor = null,
} = {}) {
  /** 候选项目清单：登记簿里的全部项目（FIX-58 多项目）+ 配置兜底的那个喵。 */
  const candidates = () => {
    const rows = typeof getProjects === 'function' ? getProjects() : getProjects
    const list = Array.isArray(rows) ? rows.filter(Boolean) : []
    const fallback = typeof getProject === 'function' ? getProject() : getProject
    if (fallback && !list.includes(fallback)) list.push(fallback)
    return list
  }
  return async function todoHandler(req, res) {
    if (!fence(req)) {
      fail(res, 403, 'forbidden', '请求未通过本地栅栏（Host/Origin 不是本机）')
      return
    }
    if (req.method !== 'POST') {
      fail(res, 405, 'method-error', '待办写通道只接受 POST')
      return
    }
    let payload
    try {
      payload = JSON.parse(await readBodyImpl(req))
    } catch (error) {
      fail(res, 400, 'bad-request', `请求体不是合法 JSON：${error && error.message ? error.message : error}`)
      return
    }
    const list = candidates()
    const path = payload && payload.path
    // ③ 白名单：写任何其它路径都必须被拒（这是"面板默认只读"的边界）喵
    if (!isTodoPathAllowed(list, path)) {
      const allowed = list.map((row) => (row && row.panel ? row.panel.todoFile : null)).filter(Boolean)
      fail(res, 403, 'path-not-allowed', `只允许写已登记项目的待办文件（${allowed.join('、') || '(未登记)'}）`)
      return
    }
    // 反查到**这个路径所属的项目**：备份落在它自己的 `.agent-contract/backups/` 下喵
    const project = projectForTodoPath(list, path) || list[list.length - 1]
    let current
    try {
      current = await read(path, 'utf8')
    } catch {
      // 文件不存在：只有"整篇保存"才有意义（勾选无从谈起）喵
      current = null
    }
    // ④ 冲突检测：client 渲染时那份内容的指纹与当前不符 ⇒ 拒绝覆盖，让它刷新重试喵
    if (payload.baseHash !== undefined && payload.baseHash !== null) {
      const actual = current === null ? null : hashOf(current)
      if (String(payload.baseHash) !== String(actual)) {
        // FIX-45 ①：把**宿主侧的实际值**回带出去 —— 这类"两侧读法不同"一次对比就能定位喵
        sendJson(res, 409, {
          ok: false,
          error: {
            code: 'stale-file',
            message: '待办文件已被外部改动，请刷新后重试',
          },
          actualHash: actual,
          actualLength: current === null ? 0 : current.length,
        })
        return
      }
    }
    // FIX-45 **治本**：读取与哈希同源 —— 面板的待办原文也从这条路由读（`action: 'read'`），
    // client 只负责显示、不再各读各的；`hash` 就是宿主对**同一份文本**算出来的权威指纹喵。
    // （刻意不做成 GET：GET 在这条路由上一律 405，读与写在同一个 POST 动作面上，暴露面不变）喵
    if (payload.action === 'read') {
      sendJson(res, 200, {
        ok: true,
        value: {
          text: current,
          hash: current === null ? null : hashOf(current),
          length: current === null ? 0 : current.length,
        },
      })
      return
    }
    // FIX-96 ①②（用户提议）：**强制刷新** —— 人自己走的那条路，等价于"主代理跑一次 `audit_scan`"。
    // 白名单与栅栏沿用上面的同一套（仍然只认已登记项目的待办路径 ⇒ 没有新增暴露面）；
    // **实现与 `audit_scan` 工具、启动自愈完全同源**（`src/panel/refresh.js` 那一个 `refreshPanel`）喵
    if (payload.action === 'force-refresh') {
      if (typeof refresh !== 'function') {
        fail(res, 500, 'no-refresh', '本进程没有可用的"跑审计 + 重写快照"实现（面板数据这次没法重算）')
        return
      }
      try {
        const store = typeof storeFor === 'function' ? storeFor(project) : null
        if (!store) {
          fail(res, 500, 'no-store', `项目 ${project.name || project.root} 的台账 store 未绑定，无法重写面板数据`)
          return
        }
        const result = await refresh({ project, store })
        const report = result && result.report ? result.report : null
        if (!report) {
          fail(res, 500, 'refresh-failed', '审计没有返回结果（快照未重写）')
          return
        }
        // 写快照失败**必须可见**（审计算出来了但落盘失败 = 面板还是旧的）喵
        if (result.written && result.written.ok === false) {
          fail(res, 500, 'snapshot-write-failed', `审计已完成但快照写入失败：${result.written.error || '未知原因'}`)
          return
        }
        sendJson(res, 200, {
          ok: true,
          value: {
            level: report.level || 'unknown',
            red: (report.counts ? report.counts.red : 0) || 0,
            yellow: (report.counts ? report.counts.yellow : 0) || 0,
            items: Array.isArray(report.items) ? report.items.length : 0,
            receipt: refreshReceiptText(report),
            generatedAt: now(),
          },
        })
      } catch (error) {
        fail(res, 500, 'refresh-failed', `强制刷新失败：${error && error.message ? error.message : error}`)
      }
      return
    }
    let next
    if (payload.action === 'toggle') {
      if (current === null) {
        fail(res, 400, 'bad-request', '待办文件还不存在，无法勾选（请先保存一次内容）')
        return
      }
      next = toggleTodoLine(current, payload.line)
      if (next === null) {
        fail(res, 400, 'not-a-checkbox', `第 ${payload.line} 行不是可勾选的待办条目`)
        return
      }
    } else if (payload.action === 'save') {
      next = preserveTrailingNewline(current, String(payload.content ?? ''))
    } else {
      fail(res, 400, 'bad-request', `未知的 action：${payload.action}`)
      return
    }
    if (current !== null && next === current) {
      sendJson(res, 200, { ok: true, value: { hash: hashOf(current), backupPath: null, changed: false } })
      return
    }
    // ⑤ 可回退：写前备份；备份失败即中止（`writeWithBackup` 保证不落盘）喵
    const written = await write({ project, path, text: next, stampIso: now() })
    if (!written || written.ok !== true) {
      fail(res, 500, 'write-failed', `写入失败（已中止，未覆盖）：${written && written.error ? written.error : '未知原因'}`)
      return
    }
    sendJson(res, 200, {
      ok: true,
      value: { hash: hashOf(next), backupPath: written.backupPath || null, changed: true },
    })
  }
}

/**
 * 把写路由注册到宿主 webServer 上喵（拿不到 `webServer` / `webRuntime` 就静默跳过 —— 编辑功能在面板上降级为不可用）喵。
 * @returns 注销函数或 null喵。
 */
export function registerTodoRoute(ctx, { getProject, getProjects, trustedHosts, refresh = null, storeFor = null } = {}) {
  try {
    if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== 'function') return null
    // `webRuntime` 是**可选**依赖：访问未注入的服务在 cordis 里会抛错，所以探测必须包在 try 里喵
    const hostsOf = () => {
      if (typeof trustedHosts === 'function') return trustedHosts()
      if (Array.isArray(trustedHosts)) return trustedHosts
      try {
        const runtime = ctx.webRuntime
        return runtime && Array.isArray(runtime.trustedHosts) ? runtime.trustedHosts : []
      } catch {
        return []
      }
    }
    return ctx.webServer.register({
      kind: 'exact',
      path: TODO_ROUTE_PATH,
      handler: createTodoHandler({
        getProject,
        getProjects,
        fence: (req) => isTrustedLocalRequest(req && req.headers ? req.headers : {}, hostsOf()),
        // FIX-96：把"跑审计 + 重写快照"的实现与"按项目取 store"一起交给路由喵
        refresh,
        storeFor,
      }),
    })
  } catch {
    return null
  }
}
