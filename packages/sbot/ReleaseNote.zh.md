## v0.0.7

### 新功能

- **压缩文件工具**：新增内置 ZIP 压缩工具 — 支持压缩、解压、列出内容及读取压缩包内文件
- **二进制文件读取工具**：新增 `read_binary_file` 工具，支持在 Agent 工作流中读取二进制文件
- **Lark 文件/图片支持**：Lark 渠道现支持发送和接收图片、文件及其他媒体内容
- **find-skills Skill**：新增内置 Skill，用于发现 skills 目录中可用的技能
- **多份 Memory 支持**：Agent 现可同时加载多个 memory 来源；`getSystemMessage()` 替换为 `getMemories()`，返回带评分的结果
- **Memory 管理界面**：Web 管理面板支持查看和管理单条 memory 内容，改进了弹窗界面
- **Docker 支持**：新增 Dockerfile 及辅助脚本，支持容器化部署
- **聊天粘贴支持**：Web 聊天面板现支持从剪贴板直接粘贴图片和文件

### 架构变更

- **Saver 重构**：移除所有 Saver 实现（File、SQLite、Postgres、Memory）中的 `threadId`，每个 Saver 直接操作单一文件/表。新增 `getAllMessagesWithTime()` 方法，通过 `SaverMessage` 类型返回带创建时间的消息
- **Memory 存储重构**：移除 `MemorySqliteDatabase` 和 `IMemoryDatabase` 中的 `threadId`，改为单文件存储并支持懒初始化。评分逻辑（时间衰减 + 重要性 + 近期度 + 访问频次）移入 `MemorySqliteDatabase.searchWithTimeDecay()`。移除 `T_MemorySystemPromptTemplate` token
- **UserService 结构调整**：渠道用户服务移至 `channels/` 和 `web/` 子目录。提取通用渠道消息处理逻辑为 `ChannelMessageMixin`，消除 Lark、Slack、WeCom 服务间的代码重复
- **Session Manager 重构**：统一审批（approval）和问答（ask）状态管理。`PendingToolInfo` 重命名为 `ApprovalInfo`，新增 `WaitingAsk` 会话状态。提取 `SessionService` 类型至独立文件，状态根据待处理操作自动同步
- **DI Token 清理**：移除 `T_ThreadId` token；新增 `T_DBTable` 用于 Postgres Saver

### 改进

- **大小写不敏感搜索**：`glob` 和 `grep` 工具现使用大小写不敏感匹配（`--iglob` 和正则 `i` 标志）
- **定时任务工具**：简化 `scheduler_create`，移除 `name` 参数；精简输出信息
- **Skill 工具自动审批**：Skill 相关工具（`read_skill_file`、`execute_skill_script`、`list_skill_files`）及 `send_file` 现自动通过，无需用户确认
- **Memory 检索**：`IMemoryService.getMemories()` 现返回 `MemoryResult[]`（含 `decayedScore`），由调用方自行控制格式化和过滤
- **Web 管理面板**：新增 `MultiSelect` 组件；改进渠道、Memory、Saver、定时任务、用户等页面；优化国际化支持
- **数据库懒初始化**：SQLite 的 Saver 和 Memory 数据库现在首次访问时才创建连接和表，并自动创建目录
- **Prompt 优化**：优化了各渠道在询问和发送文件场景下的提示词
- **AgentRunner**：清理内部 Agent 执行流程，改进提示词处理逻辑
- **Skills 目录**：新增对 skills 目录级别描述的支持，便于技能发现

### Bug 修复

- 修复渠道注册问题
- 修复网页端客户端显示问题
- 修复二进制文件读取工具输出（移除响应中多余的 `filePath` 字段）
- 移除调试日志
- 修复工具返回结果处理

