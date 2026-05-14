### 新功能

- **ACP Agent 支持**: 完整的 Agent Client Protocol 集成 — 支持持久化和临时两种 ACP Agent 模式、Agent 连接池管理、权限处理和 ACP 流式响应
- **对话压缩**: 当 Token 使用量超过阈值时自动压缩对话摘要，在减少 Token 消耗的同时保持上下文连续性
- **OneBot 渠道**: 新增渠道，支持 QQ 及其他兼容 OneBot 协议的平台
- **小爱渠道**: 新增小米 AI 音箱渠道 — 账号登录、设备发现、TTS 播放和轮询式对话
- **Token 用量统计**: 按模型统计 Token 使用量，管理后台提供可视化面板
- **会话搜索工具**: 新增工具允许 Agent 搜索历史会话记录

### 架构变更

- **静态/动态 Prompt 系统**: Prompt 分为静态环境上下文和动态逐轮上下文，支持 frontmatter 变量声明
- **ACP Agent 架构**: 新增 `ACPAgentServiceBase` 基类，派生 `PersistentACPAgentService`（长驻进程、Session 复用）和 `TransientACPAgentService`（按请求生命周期）
- **混合搜索**: 新增 `HybridSearcher`，结合关键词匹配和 Embedding 语义搜索，用于技能检索
- **模型重试代理**: `RetryModelServiceProxy` 对瞬态错误（限流、超时、连接重置）支持指数退避重试
- **Skill 服务重构**: `SkillService` 重写，优化生命周期管理和解析逻辑

### 改进

- **渠道消息合并**: 同一用户的连续消息在处理前自动合并
- **渠道工具配置**: 渠道插件支持按需配置工具白名单
- **渠道主动发送**: 渠道支持主动推送消息（不仅限于响应）
- **Claude Thinking 支持**: Anthropic 模型服务支持配置扩展思考 (Extended Thinking)
- **生成式模型自动截取**: Generative Agent 输入超出上下文窗口时自动截取
- **图片自动缩放**: 图片在发送给模型前按可配置最大尺寸自动缩放
- **Prompt Frontmatter**: PromptLoader 支持 YAML frontmatter 及变量元数据，供管理 API 使用
- **管理后台**: 新增进程管理、Token 用量页面；优化渠道、Prompt、Agent 管理界面
- **异步模块加载**: 服务端模块异步加载，加快启动速度
- **微信扫码登录**: 微信渠道支持扫码登录
- **缓存统计**: 模型响应缓存支持命中/未命中统计
