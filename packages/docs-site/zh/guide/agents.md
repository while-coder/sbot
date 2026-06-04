# Agent

侧栏 → **Agent 管理** → 新建

一个 Agent 把模型、系统提示词，以及它能调用的工具 / 技能 / 知识打包在一起，然后被分配给聊天会话或渠道使用。

## Agent 模式

### Single

选择一个模型、写系统提示词，可选挂载 MCP 工具与技能。这是最常用的单一职能助手模式。

### ReAct

选择一个 **Think 模型**，然后添加子 Agent（每个子 Agent 需要 id 和描述用于任务调度）。Think 模型递归拆解用户请求并分发子任务；每个子 Agent 对共享记忆只读。

适合在以下场景使用 ReAct：
- 任务开放（"端到端规划并执行 X"）
- 希望由调度模型动态选择专家 Agent

### Generative

选择多模态模型，用于文本 + 图像混合内容生成。

## 配置项

| 区块 | 用途 |
|---------|---------|
| 模型 | 该 Agent 的主 LLM |
| 系统提示词 | 角色、能力、回复风格 |
| MCP 工具 | Agent 级启用的 [MCP 服务器](./mcp) 列表 |
| 技能 | Agent 级 [技能](./skills) 选择（留空表示加载全部） |
| 记忆 | 使用此 Agent 的会话默认 [notes / 记忆](./note) |
| Wiki | 会话默认的 [wiki / 知识库](./wiki) |
| Insight | Agent 级静默后置提取器 —— 详见 [Insight](./insight) |
| 心跳 | 周期性自激活 —— 详见 [Heartbeat](./heartbeat) |

## 预制 Agent

不想手动配置？可前往 [Agent 商店](./agent-store) 浏览即装即用的整套包（模型 + 提示词 + 工具 + 技能 + MCP 服务器）。
