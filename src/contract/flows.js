/**
 * **内置流程**喵（FIX-89 ③）喵 —— 让主代理"照流程派单"，不必自己设计步骤、也不必自己侦察喵。
 *
 * 用户口径原话喵：「给主 agent 的工作还是太重了，它只用做一共**甩手掌柜**，交给下级完成绝大部分即可，
 * 因为主 agent 模型和子 agent 模型是一个等级的，只不过主 agent 思考强度更高」喵。
 *
 * 每条流程给出**可执行的步骤序列**：派哪个角色 → 产出什么 → **何时停下等用户确认**喵。
 * 步骤里的 `stopForUser: true` = 这一步之后**必须**等用户拍板（不许自己往下走）喵。
 */

/** 三条内置流程（键名即 `contract_flow` 的入参）喵。 */
export const BUILTIN_FLOWS = {
  'organize-docs': {
    title: '整理文档（盘点 → 预演 → 确认 → 落地 → 验收）',
    steps: [
      { role: 'researcher', action: '盘点现状（数目录/数非 .md/找旧标记/数引用），只出清单不下结论', output: '研究档（含盘点清单）' },
      { role: null, action: '主代理汇总盘点结果给用户看（**这一步是你的活**）', output: '一句话汇报 + 待确认项', stopForUser: true },
      { role: 'librarian', action: '按盘点结论出 **dryRun 预演**（将移动/将改名/影响引用几处）', output: '预演报告（未落盘）' },
      { role: null, action: '把预演给用户确认（**不许跳过**）', output: '用户拍板', stopForUser: true },
      { role: 'librarian', action: '落地（搬移 / 归位 / 补标注 / 修引用），走备份 + 留痕 + 回滚清单', output: '验收报告（动作清单 + 正文指纹 + 引用残留 + 审计前后）' },
    ],
  },
  implement: {
    title: '实现一个功能（调研 → 实现 → 审查 → 对抗 → 收档）',
    steps: [
      { role: 'researcher', action: '调研现状与相关机制，给出可选方案与风险', output: '研究档' },
      { role: 'implementer', action: '按范围实现并自测，写三档文档', output: 'L1/L2/L3 + 进度' },
      { role: 'reviewer', action: '按严重度审查改动物，只读不改', output: '审查意见' },
      { role: 'adversary', action: '换异源模型尝试证伪（可选：用户要求"真对抗"时才派）', output: '对抗结论' },
      { role: 'librarian', action: '收档：补头部 / 归位 / 更新索引 / 归档', output: '验收报告' },
    ],
  },
  research: {
    title: '做一个调研（调研 → 复核 → 归档）',
    steps: [
      { role: 'researcher', action: '按问题检索与考证，产出研究档（含结论/依据/风险）', output: '研究档' },
      { role: 'reviewer', action: '复核结论与依据，指出不确定处', output: '审查意见' },
      { role: 'librarian', action: '归档旧档 + 维护目录索引', output: '索引更新 + 验收报告' },
    ],
  },
}

/** 列出全部流程名与一句话标题（给 `contract_status` / 工具描述用）喵。 */
export function listFlows() {
  return Object.entries(BUILTIN_FLOWS).map(([name, flow]) => ({ name, title: flow.title, steps: flow.steps.length }))
}

/** 取一条流程；名字不认识 ⇒ 抛错并列出可用名（**不许静默**）喵。 */
export function getFlow(name) {
  const key = String(name || '').trim()
  const flow = BUILTIN_FLOWS[key]
  if (!flow) {
    throw new Error(`agent-contract: 未知流程「${key}」—— 可用流程：${Object.keys(BUILTIN_FLOWS).join(' / ')}喵`)
  }
  return { name: key, ...flow }
}
