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

每个派发的子任务可继承父对话的上下文（`none` —— 干净起步，默认；`state` —— 父对话近期消息的有界快照；`full` —— 完整克隆父历史）。递归深度有护栏，防止失控嵌套。

### Generative

选择多模态模型，用于文本 + 图像混合内容生成。

### ACP

把外部 Agent Client Protocol 进程作为 Agent 运行。后台提供 Claude Code、Codex、OpenCode、Cline、Qwen Code 等快速填充预设，也可以自定义启动命令、参数、环境变量、会话模式和初始化超时。

**Persistent** 模式会让外部进程在多轮对话间常驻复用；**Transient** 模式则在每轮结束后关闭会话。

## 配置项

| 区块 | 用途 |
|---------|---------|
| 模型 | 该 Agent 的主 LLM |
| 系统提示词 | 角色、能力、回复风格 |
| MCP 工具 | Agent 级启用的 [MCP 服务器](./mcp) 列表 |
| 技能 | Agent 级 [技能](./skills) 选择（留空表示加载全部） |
| 笔记 | 使用此 Agent 的会话默认 [Notes](./note)（向量库） |
| Wiki | 会话默认的 [wiki / 知识库](./wiki) |
| 记忆 | Agent 级长期记忆，由后台 MemoryLLM 提取 —— 详见 [Memory](./memory) |
| 日程 | Agent 级提醒 / 日程，可从对话自动同步 —— 详见 [Agenda](./agenda) |
| 心跳 | 周期性自激活 —— 详见 [Heartbeat](./heartbeat) |
| ACP 启动配置 | ACP Agent 的外部进程命令、参数、环境变量、会话模式和初始化超时 |

## 预制 Agent

不想手动配置？可前往 [Agent 商店](./agent-store) 浏览即装即用的整套包（模型 + 提示词 + 工具 + 技能 + MCP 服务器）。
