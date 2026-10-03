/**
 * 已解析项目的**登记簿**喵（FIX-58）喵。
 *
 * 为什么需要它：自适应的根是**按调用方会话**推出来的（`exec.agent.session.header.cwd` / 工作区），
 * 而插件里有两处**拿不到会话**的组件 —— ① 面板快照同步器（挂在 `ctx` 上，由 `domain/changed` 触发）
 * ② 待办写路由（HTTP 请求，带的是绝对路径）。它们只能通过"这次调用解析出了哪个项目"来工作喵。
 *
 * 于是：**每次工具调用把解析结果登记一次**（key ⇒ 项目视图），两处组件按 key 反查。
 * 登记簿是**纯内存**的（派生态、可重建）：重启后第一次调用会重新登记，没登记的键就当没有该项目喵。
 */
export function createProjectRegistry() {
  const byKey = new Map()

  return {
    /** 记下"这个项目键对应这份视图"（同键后到者覆盖：项目结构可能刚被自建过）喵。 */
    remember(key, project) {
      if (!key || !project) return null
      byKey.set(String(key), project)
      return project
    },
    get: (key) => byKey.get(String(key || '')) || null,
    has: (key) => byKey.has(String(key || '')),
    keys: () => [...byKey.keys()],
    list: () => [...byKey.values()],
    size: () => byKey.size,
    /**
     * 登记簿里所有项目的**待办文件绝对路径**喵（待办写路由的白名单来源）喵。
     * 没登记过任何项目时返回空数组 —— 路由据此退回"配置里的那个项目"喵。
     */
    todoPaths() {
      const paths = []
      for (const project of byKey.values()) {
        const todo = project && project.panel ? project.panel.todoFile : null
        if (todo && !paths.includes(todo)) paths.push(todo)
      }
      return paths
    },
  }
}
