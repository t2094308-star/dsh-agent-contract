/**
 * **工具面的角色闸门**喵（FIX-63）喵。
 *
 * 病根（dsh 主代理的反思，原话）：「工具面没有闸门。`librarian_sweep` / `librarian_archive` / `librarian_patrol`
 * 这些工具直接暴露给我，描述写的是『图书管理员的归档动作』，但**没有一条写『主代理不得直调、必须委派』**……
 * 我照字面读，唯一空着的椅子就是执行者，于是我坐了上去」喵。
 *
 * 本质：这些活**属于馆员**，因为馆员角色卡带着纪律（dryRun 先行 / 判不准上报 / 引用同步 / 留痕）——
 * 而纪律只活在**角色卡文本**里，工具门是敞开的 ⇒ 主代理直调 = **绕过全部纪律**喵。
 *
 * 三条口径喵：
 * ① **描述里明写归属**（工具面自己表达"这活该由谁干"，不靠人记）喵
 * ② **主代理（层 0）直调 → 回执附明确警告**（默认"警告制"，与全局口径一致）喵
 * ③ 可选 `delegation.strictRoleGate: true` → **直接拒绝**并给正确姿势；**馆员自己调用不受影响**喵
 *
 * 身份解析不出来时**一律放行**（fail-open）—— 闸门是提醒纪律的，不是拿"猜身份"去堵路喵。
 */

/** 馆员作业面的工具名（这些工具该由 `contract_delegate_librarian` 委派执行）喵。 */
export const ROLE_GATE_TOOLS = [
  'librarian_patrol', 'librarian_backfill', 'librarian_archive',
  'librarian_sweep', 'librarian_glossary', 'librarian_tags', 'ledger_backfill',
]

/** 工具描述里要附的**归属句**喵（工具面自己表达归属，别指望读文档的人记住）喵。 */
export const OWNERSHIP_SENTENCE = '**该工具面向图书管理员角色；主代理应通过 `contract_delegate_librarian` 委派，不得直调**。'

/** 主代理直调时回执里附的警告喵。 */
export const ROLE_GATE_WARNING = '这是图书管理员的作业面；请改用 `contract_delegate_librarian` 委派'
  + '（直调会绕过馆员角色卡的纪律与留痕口径：dryRun 先行 / 判不准上报 / 引用同步 / 改动留痕）喵。'

/** 严格模式下拒绝调用时的报错文案喵。 */
export const ROLE_GATE_REJECT = 'agent-contract: 已启用严格角色闸门（delegation.strictRoleGate）——'
  + '图书管理员的作业面必须经 `contract_delegate_librarian` 委派，不能由主代理直调喵。'

/**
 * 调用方在谱系里的层数喵（`exec.agent.session.header.delegationDepth`；拿不到返回 null）喵。
 * @returns 层数（主代理 0）或 null（身份不可解析）喵。
 */
export function callerLayerOf(exec) {
  const header = exec && exec.agent && exec.agent.session ? exec.agent.session.header : null
  if (!header) return null
  const depth = Number(header.delegationDepth)
  return Number.isFinite(depth) && depth >= 0 ? depth : null
}

/**
 * 判一次调用该不该被闸门拦喵（纯函数，便于断言）喵。
 * @returns `{ level, message }`：`ok`（照常）/ `warn`（附警告）/ `reject`（拒绝）喵。
 */
export function roleGate({ exec, config, toolName } = {}) {
  if (!ROLE_GATE_TOOLS.includes(String(toolName))) return { level: 'ok', message: '' }
  const layer = callerLayerOf(exec)
  // 身份解析不出来就不猜（fail-open）：闸门是提醒纪律的，不是靠猜身份堵路的喵
  if (layer === null) return { level: 'ok', message: '' }
  // 子代理一律放行 —— **馆员自己调用绝不能受影响**（它的活就是把这条路走通）喵
  if (layer > 0) return { level: 'ok', message: '' }
  const strict = Boolean(config && config.delegation && config.delegation.strictRoleGate)
  return strict ? { level: 'reject', message: ROLE_GATE_REJECT } : { level: 'warn', message: ROLE_GATE_WARNING }
}

/**
 * 把闸门套在一个工具定义上喵：描述附归属句 · 主代理直调附警告（渲染里也看得见）· 严格模式直接拒喵。
 * 只对 `ROLE_GATE_TOOLS` 生效，其余工具原样返回（零开销、零行为变化）喵。
 */
export function withRoleGate(definition, { config } = {}) {
  if (!ROLE_GATE_TOOLS.includes(definition.name)) return definition
  const inner = definition.execute
  const innerRender = definition.output && definition.output.render
  return {
    ...definition,
    description: `${definition.description}\n${OWNERSHIP_SENTENCE}`,
    async execute(args, exec) {
      const gate = roleGate({ exec, config, toolName: definition.name })
      if (gate.level === 'reject') throw new Error(gate.message)
      const value = await inner(args, exec)
      return gate.level === 'warn' && value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value, roleGateWarning: gate.message }
        : value
    },
    ...(innerRender
      ? {
        output: {
          ...definition.output,
          render: (args, value) => {
            const blocks = innerRender(args, value)
            if (!value || !value.roleGateWarning) return blocks
            const list = Array.isArray(blocks) ? blocks : [blocks]
            // 回执里必须**明写**（只塞字段没人看得见 —— 与 DESIGN §9-23 "警告必须渲染出来"同规）喵
            return [...list, { type: 'text', text: `警告：${value.roleGateWarning}` }]
          },
        },
      }
      : {}),
  }
}
