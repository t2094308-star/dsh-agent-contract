/**
 * [1] 总纲 + 2』状态 的本体模板与槽位渲染喵。
 *
 * 模板逐字迁移自 DESIGN.md 附录 A，属于上游规范正文（引用内容），
 * 因此**不在模板内部添加任何额外文字**（包括本仓库的注释用喵字约定），
 * 以保证「逐字迁移」这一硬要求不被破坏喵。
 */

/** token → slots 字段名 的映射喵。 */
const SLOT_KEYS = {
  '[Agent进度]': 'progressDir',
  '[任务]': 'task',
  '[位置]': 'location',
  '[上级]': 'parent',
  '[层数]': 'layer',
  '[总Agent数]': 'totalAgents',
}

/** 契约中需要运行时填值的全部槽位 token 喵。 */
export const SLOT_TOKENS = Object.keys(SLOT_KEYS)

/** 总纲与状态信息本体（逐字，未填槽）喵。 */
export const MANDATE_TEMPLATE = `### [1] 总纲

1. **核心原则与传递性**：本提示词内容具有传递性。创建子 Agent 时，必须将 [1] 至 [2] 中的所有内容作为初始提示词完整提供给子 Agent。子 Agent 必须严格遵守 [1] 至 [2] 中的所有内容。
2. **进度管理**：在 \`[Agent进度]\` 目录下建立并维护 \`.md\` 文件，文件名为任务名。该文件用于描述子任务并实时推进任务进度。文件总字数不得超过 400 字。
3. **前期调研与阅读**：执行任务前，阅读 \`[任务]\` 的通用剧情摘要和项目简介。初步探索项目后，阅读 \`[位置]\` 文件夹下的 debug 文件，并根据初步判断选择并阅读相关文件。
4. **任务执行**：阅读上级 Agent 所指定的任务文件。
5. **产出规范**：任务完成后，需清理并产出三档文档，信息库维度由小到大依次递增：
   - 5.1 **第三级文档**（高度概括）：主要信息、改变、成果精简。字数限制：250~300 字。
   - 5.2 **第二级文档**（扩充细节）：在第三级文档基础上，增加变量、物品及状态等内容，并保存。
   - 5.3 **第一级文档**（详细归纳）：作为任务详细归纳，保存于 \`[位置]\`。无字数限制，原则上不多于 3000 字。
6. **文档流转**：第三级文档以文字信息形式直接发给上级 Agent。第二级文档发给 \`[上级]\` 级 Agent。
7. **异常处理**：若遇严重 Bug 或上级 Agent 指定修改的 Bug，在修改成功后，需将修改总结生成 \`.md\` 文件，并存于 \`[位置]\`。
8. **子 Agent 管理**：若该层 Agent 数量 ≤4 且总 Agent 数量 ≤20，遇到过于复杂的问题时应分裂子 Agent。你应为下一级子 Agent 配置所有该提示词中方括号 \`[]\` 内的信息。

### 2』状态信息

- 当前层数：\`[层数]\`
- 当前总 Agent 数：\`[总Agent数]\`
`

/**
 * 用运行时值填充总纲本体中的全部槽位喵。
 * 缺值统一渲染成 (未提供)，绝不留下原始 token——残留会触发 unfilled_slot 审计喵。
 * @param slots - 槽位值对象，键见 SLOT_KEYS 的取值喵。
 * @returns 填槽后的总纲正文喵。
 */
export function renderMandate(slots) {
  let text = MANDATE_TEMPLATE
  for (const token of SLOT_TOKENS) {
    const raw = slots ? slots[SLOT_KEYS[token]] : undefined
    const value = raw === undefined || raw === null || raw === '' ? '(未提供)' : String(raw)
    text = text.split(token).join(value)
  }
  return text
}

/**
 * 扫描文本中残留的未填槽位喵。
 * 只匹配本插件定义的槽位 token，因此不会把总纲里的 [1] / [2] / `[]` 误判成槽位喵。
 * @param text - 待检查文本喵。
 * @param ignore - 已成功替换进去的值列表；先把它从文本里剔掉再扫，
 *   否则「进度目录本身就叫 [Agent进度]」这类合法取值会被误报成未填槽位喵。
 * @returns 残留的 token 数组（空数组 = 全部已填）喵。
 */
export function findUnfilledSlots(text, ignore = []) {
  let value = String(text ?? '')
  for (const item of ignore) {
    const replacement = String(item ?? '')
    if (replacement) value = value.split(replacement).join('')
  }
  return SLOT_TOKENS.filter((token) => value.includes(token))
}
