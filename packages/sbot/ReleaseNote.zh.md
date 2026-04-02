## v0.0.8

### 新功能

- **Gemini 模型支持**: 新增 `GeminiModelService` 和 `GeminiImageModelService`，支持 Google Gemini 系列模型（含图像生成）
- **OpenAI Response 模型**: 新增 `OpenAIResponseModelService`，支持 OpenAI Response API 格式
- **Channel 插件系统**: 引入 `ChannelPlugin` 抽象和 `PluginLoader`，各渠道（Lark、Slack、WeCom）均改为插件化注册方式
- **Think 思考过程展示**: Web UI 新增 `ThinkDrawer` 组件，支持查看 AI 推理的思考过程
- **日志查看页面**: Web 管理后台新增 `LogsView` 日志查看页面

### 架构变更

- **Session 重构**: 大规模重构 Session 管理，引入消息队列机制；`UserService` 重命名为 `SessionManager`；移除 `BaseWebUserService`、`HttpUserService` 及各渠道独立的 UserService（Lark/Slack/WeCom），统一由 `ChannelSessionHandler` 处理。`SessionService` 大幅扩展并继承 `MessageDispatcher`
- **Channel 插件化架构**: 新增 `AbstractChatProvider` 抽象基类；`ChannelManager` 大幅精简，拆分出 `PluginLoader` 和 `createProcessAIHandler`；各渠道 `UserServiceBase` 重命名为 `SessionHandler`；每个渠道新增 `plugin.ts` 实现自注册。channel.base 中 `SessionManager` 改为抽象类
- **Saver 重构**: 新增 `messageConverter.ts` 统一消息转换逻辑；精简 `messageSerializer.ts`；Saver 接口（`IAgentSaverService`）大幅扩展，支持 think 内容存储
- **移除 Azure 模型**: 移除 `AzureModelService`，统一使用 OpenAI 兼容接口

### 改进

- **Memory 内容分割**: Memory 内容支持分段存储和检索
- **Saver 支持 Think**: 对话历史保存支持记录 AI 思考过程
- **Anthropic 模型增强**: `AnthropicModelService` 功能扩展，支持更多配置选项

