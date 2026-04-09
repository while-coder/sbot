## v0.0.9

### 新功能

- **微信渠道**: 新增 `channel.wechat` 包，完整微信集成 — API 客户端、聊天 Provider、Session Handler、扫码登录、文件收发
- **移动端适配**: Web 管理后台所有页面（Agents、Channels、Chat、Memories、Savers、Models、Embeddings、MCP、Skills、Scheduler、Users 等）全面支持移动端显示
- **全局 MCP 与 Skills**: 支持全局 MCP Skills 配置，Web UI 中支持 Agent 级别的 MCP/Skill 管理
- **共享对话历史**: Agent 支持跨会话共享对话历史记录
- **自动启动**: 服务器自启动能力，支持开机启动配置

### 架构变更

- **WebSocket 重构**: 重新整理 `WebSocketUserService`，扩展 `createProcessAIHandler` 以构建更清晰的请求处理流程
- **SkillService 无缓存**: `SkillService` 切换为无缓存模式，支持 Skill 实时更新
- **代码清理**: 移除未使用的 `CommandDecorators`，精简冗余聊天组件，清理 WeCom SessionHandler

### 改进

- **微信/企微文件支持**: 微信和企业微信渠道均支持文件收发
- **企微图片与图文混排**: 企业微信渠道支持图片消息和图文混排内容
- **渠道密码认证**: 渠道管理界面支持密码/认证配置
- **WebSocket 事件整理**: 统一并简化 WebSocket 事件类型和处理逻辑
- **多项 Bug 修复**: 修复 Lark/Slack SessionHandler、消息序列化器、模型配置、Embedding 类型等多处问题

