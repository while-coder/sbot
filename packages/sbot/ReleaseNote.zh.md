## v0.0.9

### 新功能

- **多模态消息**: 全渠道图文混合消息支持 — 飞书/微信/企微/Web 均可收发图片；Web UI 支持拖拽粘贴图片、图片灯箱预览下载；Agent 可处理 MCP 工具返回的图片内容
- **微信渠道**: 新增 `channel.wechat` 包，完整微信集成 — API 客户端、扫码登录、文件收发
- **移动端适配**: Web 管理后台所有页面全面支持移动端显示
- **全局 MCP 与 Skills**: 支持全局 MCP Skills 配置及 Agent 级别的 MCP/Skill 管理
- **共享对话历史**: Agent 支持跨会话共享对话历史记录
- **自动启动**: 服务器支持开机自启动配置

### 架构变更

- **多模态内容管线**: `MessageContent` 支持字符串和多段数组两种格式；提取公共 `MessageList` 组件和 `messageRender.ts`，统一文本、图片、工具调用的渲染路径
- **WebSocket 重构**: 重新整理 `WebSocketUserService`，统一事件类型，扩展 `createProcessAIHandler` 处理流程
- **SkillService 无缓存**: 切换为无缓存模式，支持 Skill 实时更新
- **代码清理**: 移除未使用的 `CommandDecorators`，精简冗余聊天组件

### 改进

- **渠道文件与图片**: 微信/企微支持文件收发和图文混排
- **渠道密码认证**: 渠道管理界面支持密码/认证配置
- **多项 Bug 修复**: 修复 Lark/Slack SessionHandler、消息序列化器、模型配置、Embedding 类型等问题
