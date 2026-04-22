## v0.0.10

### 新功能

- **Wiki 知识库**: 全新知识库系统 — 支持文档存储、自动提取、语义搜索，Agent 对话中可自动引用知识库内容；Web UI 新增知识库管理页面
- **Todo 待办**: 内置待办事项模块 — Agent 可创建/完成/查询待办，Web UI 新增 Todo 管理页面
- **意图过滤**: 新增意图分类系统，支持按渠道配置消息意图过滤规则，自动识别并分流用户消息
- **Token 消耗统计**: 新增 Token 用量追踪与统计，侧边栏实时显示消耗情况，聊天页面展示对话 Token 详情
- **上下文窗口进度**: 聊天界面显示上下文窗口使用进度，模型目录支持上下文窗口大小查询
- **Generative Agent**: 新增生成式 Agent 类型，支持多模态内容处理
- **Skill Hub 重构**: 全新 Skill 管理体验 — 支持 skills.sh 集成，重构 Skill 浏览/查看弹窗
- **Memory 搜索**: Memory 模块新增工具提供者，支持搜索记忆内容
- **启动命令配置**: 设置页面支持配置服务器启动命令

### 架构变更

- **代码目录重组**: `UserService` → `Session`，`Channel/classifyIntent` → `Processing/classifyIntent`，职责更清晰
- **移除内容评估器**: 删除 `MemoryEvaluator`，简化 Memory 服务架构
- **Agent 配置迁移**: Agent 配置从文件迁移至数据库存储，支持动态管理
- **WebSocket 重命名**: `WebSocketUserService` → `WebSocketSessionHandler`
- **流式输出配置化**: 支持按渠道配置是否启用流式输出

### 改进

- **多模态增强**: Agent 级别多模态模型配置；`readBinaryFile` 升级为 `readMediaFile`；客户端多模态消息渲染优化
- **ThinkDrawer 优化**: 思考过程展示组件 UI 改进
- **Lark 渠道**: 修复 `chat_id` 处理，优化 LarkService 消息流程
- **调度器修复**: 修复 SchedulerService 运行异常
- **依赖升级**: 升级 scorpio.ai、website 等核心包版本
- **代码清理**: 移除无用代码、精简 AgentStore 逻辑、清理冗余导出