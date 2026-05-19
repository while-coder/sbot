### 新功能

- **ACP Agent 支持**: 完整的 Agent Client Protocol 集成 — 支持持久化和临时两种 ACP Agent 模式、Agent 连接池管理、权限处理和 ACP 流式响应
- **MCP 工具管理**: MCP 服务器配置支持 SSE 传输协议，新增实用工具 (`MCPUtilityTools`)，管理后台增强 MCP 工具查看及 Agent 级 MCP 绑定
- **洞察系统重构**: 重建 `InsightService` — 简化提取流程，集成 `UsageTracker`，移除冗余的 prompt 工具调用，改为直接服务调用
- **对话压缩**: 当 Token 使用量超过阈值时自动压缩对话摘要，在减少 Token 消耗的同时保持上下文连续性
- **OneBot 渠道**: 新增渠道，支持 QQ 及其他兼容 OneBot 协议的平台
- **小爱渠道**: 新增小米 AI 音箱渠道 — 账号登录、设备发现、TTS 播放和轮询式对话
- **Token 用量统计**: 按模型统计 Token 使用量，管理后台提供可视化面板
- **会话搜索工具**: 新增工具允许 Agent 搜索历史会话记录
- **心跳系统**: 可配置的 Agent 定时自激活 — 支持自定义间隔、提示词模板和目标渠道，通过管理后台统一管理
- **中间件管道**: 新增 `MiddlewarePipeline`，支持基于意图的会话消息过滤
- **计时器执行器**: 抽取 `TimerExecutor` 统一调度工具（心跳、定时任务、Wiki 索引）
- **工作区提示词发现**: `ContextFileDiscovery` 支持加载工作区级别的 prompt 文件

### 架构变更

- **静态/动态 Prompt 系统**: Prompt 分为静态环境上下文和动态逐轮上下文，支持 frontmatter 变量声明；目录重新组织（`static_environment.txt` → `environment.txt`、`init.txt` → `instruction.txt`）
- **ACP Agent 架构**: 新增 `ACPAgentServiceBase` 基类，派生 `PersistentACPAgentService`（长驻进程、Session 复用）和 `TransientACPAgentService`（按请求生命周期）
- **Memory / Wiki 精简**: 移除 `MemoryCompressor`、`MemoryExtractor`、`WikiExtractor`、`ReadOnlyMemoryService`；将记忆和 Wiki 整合为基于 `HybridSearcher` 的轻量 CRUD 服务
- **HybridSearcher 增强**: 重写 `HybridSearcher`，结合关键词匹配和 Embedding 语义搜索，支持可配置策略、优化评分机制及 Wiki 自动索引
- **模型重试代理**: `RetryModelServiceProxy` 对瞬态错误（限流、超时、连接重置）支持指数退避重试
- **Skill 服务重构**: `SkillService` 重写，优化生命周期管理和解析逻辑
- **DI 父作用域**: `ServiceContainer` 支持父级作用域解析，实现层级式依赖注入
- **Agent 洞察集成**: 洞察提取从 Agent 服务内部移至 `AgentRunner` 编排层

### 改进

- **MCP SSE 支持**: MCP 服务器连接除 stdio 外新增 Server-Sent Events 传输支持
- **渠道消息合并**: 同一用户的连续消息在处理前自动合并
- **渠道工具配置**: 渠道插件支持按需配置工具白名单
- **渠道主动发送**: 渠道支持主动推送消息（不仅限于响应）
- **Claude Thinking 支持**: Anthropic 模型服务支持配置扩展思考 (Extended Thinking)
- **生成式模型自动截取**: Generative Agent 输入超出上下文窗口时自动截取
- **图片自动缩放**: 图片在发送给模型前按可配置最大尺寸自动缩放
- **Prompt Frontmatter**: PromptLoader 支持 YAML frontmatter 及变量元数据，供管理 API 使用
- **管理后台**: 新增进程管理、Token 用量页面；重新设计 Memory/Wiki 管理页面（详情弹窗、批量操作）；心跳配置编辑；Agent Prompt 分配与创建
- **异步模块加载**: 服务端模块异步加载，加快启动速度
- **微信扫码登录**: 微信渠道支持扫码登录
- **缓存统计**: 模型响应缓存支持命中/未命中统计
- **飞书会话处理**: 飞书渠道新增 Session 处理支持
- **Wiki 自动上下文**: Wiki 服务自动将相关条目注入动态上下文
- **代码清理**: 移除 `PromptInjectionDetector`、无用 i18n 条目及历史遗留的 memory/wiki 类型
