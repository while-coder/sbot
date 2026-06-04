# MCP 工具

侧栏 → **工具** → 新建

[Model Context Protocol（MCP）](https://modelcontextprotocol.io/) 让 Agent 通过标准协议调用外部工具。sbot 同时支持 stdio 和 SSE 两种传输方式，提供全局共享服务器与 Agent 级覆盖。

## 添加服务器

- **stdio** —— 命令 + 参数（如 `npx -y some-mcp-package`）；可按服务器配置环境变量
- **sse** —— 远程 URL + 可选请求头（用于托管的 MCP 服务）

## 配置

- **全局服务器** —— 所有 Agent 共享
- **Agent 级覆盖** —— 打开 Agent → MCP 标签页 → 启用特定服务器
- **故障自动重启** —— stdio 服务器异常退出后自动重新拉起
- **懒启动** —— 服务器仅在使用它的 Agent 运行时才启动

## 使用方式

挂载到 Agent 后，MCP 工具会在每轮对话中暴露给模型。Agent 自动发现可用工具并调用；工具结果会被回传到对话中。

## 提示

- 对于需要 Node 工具链的本地命令，使用 `npx -y` 形式可免去预安装麻烦
- 当 MCP 服务器是远程的或被多个 sbot 实例共享时，使用 SSE 传输
- 环境变量中的敏感凭据在日志中会被脱敏
