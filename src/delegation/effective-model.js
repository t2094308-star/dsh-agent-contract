/**
 * 「这次派单**实际跑在哪个模型上**」喵（FIX-59）喵。
 *
 * 病根（真机数据 + 代码双向确认）喵：`panel.json` 里 6 条成员 `model` **全是 null**——
 * 我们只在**显式配了路由**时写 `agentOptions.model`（如 `adversary → glm-5.3-flash`），
 * **继承默认模型的角色（实现者等）一律记 null**。而审计 `cross_vendor` 的判据是
 * "两边都有模型名且相同" ⇒ 实现者那侧永远是 null ⇒ **这条审计在真机是哑的**：
 * "没报"被当成"合格"，其实只是**没有可比数据**喵。
 *
 * 所以这里把"生效的模型选择"解析出来。**顺序即权威度**（先拿到谁就用谁）喵：
 * ① `route`：我们自己下发的显式路由（`modelRoutes[role]` → `agentOptions.model`）
 * ② `child-agent`：**宿主解析后的子智能体选项**（`run.localAgent.options`）——
 *    宿主的 `resolveChildAgentOptions()` 会把"父路由 ⊕ 本次覆盖"合出来，这是最贴近事实的一份
 * ③ `child-session`：子会话的**请求头**（`session.requestHeader().config.model`，子智能体跑过一轮后才有）
 *    → 再退到**会话投影** `sessionProjections.stateOf(session,'modelSelection')` 的 `lastUsed`/`pending`
 * ④ `parent-route`：**父智能体**自己的路由（`session.requestHeader().config` → `agent.options`）——
 *    没配路由的子智能体在宿主里就是**继承父路由**（`resolveChildAgentOptions` 的语义），
 *    所以这一步等于"把宿主那条继承规则自己算一遍"
 * ⑤ `deployment-default`：宿主部署默认模型 `ctx.agentDefaultModel.currentSelection()`
 * ⑥ 全拿不到 ⇒ `model: null` + `source: 'unknown'`：**未知就是未知**，绝不编一个值糊过去
 *    （审计的观察项 `cross_vendor_undecidable` 会明写"无法判定"）喵
 *
 * 全部探测都包在 try 里：这是**记账**，绝不能因为拿不到模型就让派单本身失败喵。
 */

/**
 * 来源的可读说法喵（回执与断言共用一份词表，免得两处说法漂移）喵。
 * 键与 `resolveEffectiveModel()` 返回的 `source` 一一对应喵。
 */
export const MODEL_SOURCE_TEXT = {
  route: '显式路由 modelRoutes',
  'child-agent': '宿主解析后的子智能体选项',
  'child-session': '子会话请求头',
  'child-projection': '子会话模型投影',
  'parent-route': '继承父智能体的路由',
  'deployment-default': '宿主部署默认模型',
  unknown: '未知（宿主没给出模型信息）',
}

/** 取来源的可读说法喵。 */
export function modelSourceText(source) {
  return MODEL_SOURCE_TEXT[String(source || '')] || String(source || '未知')
}

/** 从一份 `AgentOptions` / `LlmCallConfig` 形状里取 `{ provider, model }`喵。 */export function modelFromOptions(options) {
  if (!options || typeof options !== 'object') return null
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : null
  if (!model) return null
  const provider = typeof options.provider === 'string' && options.provider.trim() ? options.provider.trim() : null
  return { model, provider }
}

/** 子/父会话的**请求头**里的模型（`session.requestHeader()` 是宿主公开面）喵。 */
export function requestHeaderModel(session) {
  try {
    if (!session || typeof session.requestHeader !== 'function') return null
    const header = session.requestHeader()
    return modelFromOptions(header && header.config)
  } catch {
    return null
  }
}

/** 会话**投影**里的模型选择（`modelSelection` → `lastUsed` / `pending`）喵。 */
export function projectionModel(ctx, session) {
  try {
    const projections = ctx && typeof ctx.get === 'function' ? ctx.get('sessionProjections') : null
    if (!projections || typeof projections.stateOf !== 'function' || !session) return null
    const state = projections.stateOf(session, 'modelSelection')
    // 优先"最近真正用过的那次"（lastUsed），只有待生效的（pending）时才用它喵
    return modelFromOptions(state && (state.lastUsed || state.pending))
  } catch {
    return null
  }
}

/**
 * 一个智能体**自己**当前跑在哪个模型上喵：先看会话已记录的请求头，再退回创建期 `agent.options`。
 * 口径与宿主 `parentAgentOptionsForDelegation()` 一致（FIX-59 的"继承默认也要拿到"就靠它）喵。
 */
export function agentRouteModel(agent) {
  const session = agent && agent.session
  const fromSession = requestHeaderModel(session)
  if (fromSession) return fromSession
  return modelFromOptions(agent && agent.options)
}

/** 宿主**部署默认**模型（`ctx.agentDefaultModel.currentSelection()`）喵。 */
export function deploymentDefaultModel(ctx) {
  try {
    const service = ctx && typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
    if (!service || typeof service.currentSelection !== 'function') return null
    return modelFromOptions(service.currentSelection())
  } catch {
    return null
  }
}

/** 按 sessionId 取会话对象（拿不到就 null，绝不抛）喵。 */
function sessionById(ctx, sessionId) {
  if (!sessionId) return null
  try {
    const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
    return sessions && typeof sessions.get === 'function' ? (sessions.get(sessionId) || null) : null
  } catch {
    return null
  }
}

/**
 * 解析"这次派单的生效模型"喵。
 *
 * @param args.explicitModel - 我们下发给宿主的 `agentOptions.model`（显式路由；没有就是 undefined）喵。
 * @param args.childAgent - `run.localAgent`（宿主**已解析**的子智能体；非本地 provider 时为 undefined）喵。
 * @param args.childSessionId - `startContinuable` 返回的 `childId`（常驻子智能体只有这个）喵。
 * @returns `{ model, provider, source, tried }`：`tried` 是逐步探测的痕迹（诊断用，值都是字符串/布尔）喵。
 */
export function resolveEffectiveModel({ ctx, parent, explicitModel, childAgent, childSessionId } = {}) {
  const tried = []
  const explicit = modelFromOptions({ model: explicitModel })
  if (explicit) return { ...explicit, source: 'route', tried }

  const childOptions = modelFromOptions(childAgent && childAgent.options)
  tried.push(`child-agent=${childOptions ? childOptions.model : '(无)'}`)
  if (childOptions) return { ...childOptions, source: 'child-agent', tried }

  const childSession = sessionById(ctx, childSessionId)
  const childHeader = requestHeaderModel(childSession)
  tried.push(`child-session=${childHeader ? childHeader.model : '(无)'}`)
  if (childHeader) return { ...childHeader, source: 'child-session', tried }
  const childProjection = projectionModel(ctx, childSession)
  tried.push(`child-projection=${childProjection ? childProjection.model : '(无)'}`)
  if (childProjection) return { ...childProjection, source: 'child-projection', tried }

  // 没配路由的子智能体在宿主里**继承父路由**（`resolveChildAgentOptions(parent, undefined, depth)`）喵
  const parentRoute = agentRouteModel(parent)
  tried.push(`parent-route=${parentRoute ? parentRoute.model : '(无)'}`)
  if (parentRoute) return { ...parentRoute, source: 'parent-route', tried }

  const fallback = deploymentDefaultModel(ctx)
  tried.push(`deployment-default=${fallback ? fallback.model : '(无)'}`)
  if (fallback) return { ...fallback, source: 'deployment-default', tried }

  return { model: null, provider: null, source: 'unknown', tried }
}
