# 发布说明

本次更新引入共享的 SessionProfile 模型，将"会话身份"与"运行时配置"解耦；同时拆分单文件的 HttpServer 为按领域划分的路由模块，新增 saver 引用计数池，并为 Web 渠道集成内置终端。

### 重点变化

- 新增 `SessionProfile` 表，承载全部可覆盖配置、thread id 与 token 统计，多个会话（甚至跨渠道）可共享同一 profile，从而共享 thread。
- 拆分 `HttpServer`（~1800 行）为 `routes/` 与 `helpers/` 子模块，便于维护。
- 新增 `SaverPool`，按 dbPath 对 saver 实例做引用计数，避免并发持有同一文件/数据库的多个句柄。
- Web 渠道集成基于 WebSocket 的 `PtyService`（终端），自动识别 Windows/macOS/Linux 上的可用 shell。

### 新增

- `SessionProfile` 实体：承载 agent/saver/memories/wikis/workPath/intent/自动批准等可覆盖字段以及 token 统计；`ChannelSession` 退化为纯身份表，通过 `profileId` 引用 profile。
- 每个会话默认对应一个 auto profile（`autoForSessionId`），admin 不可见；用户可手动切换到 visible profile，从而在多个会话/渠道之间共享 thread 与配置。
- 管理后台新增 `SessionProfilesView`，并在渠道编辑器和 profile 编辑器之间共享 `SessionConfigOverridesEditor`。
- `SaverPool`（`Agent/SaverPool.ts`）：按 dbPath 单例 + 引用计数，归零即 dispose；Memory 类型不进池，每次 acquire 都新建。
- `Channel/web/PtyService.ts`：基于 `node-pty` 的 WebSocket PTY 服务，按平台识别 shell（Windows: PowerShell、cmd、pwsh 7、Git Bash、WSL；Unix: bash/zsh/fish 等）。
- `Channel/web/WebService.ts`：将 Web 渠道消息装配（交错的文本/图片 parts、附件落盘、图片自动缩放）从 `HttpServer` 拆出。
- `Server/routes/` 模块：`acp`、`agentStore`、`agents`、`chat`、`data`、`filesystem`、`heartbeats`、`logs`、`mcp`、`prompts`、`schedulers`、`settings`、`skillHub`、`skills`、`system`、`todos`、`users`。
- `Server/helpers/` 模块：`git`、`modelInfo`、`promptTree`、`settingsCrud`、`skillsHelpers`、`todoFile`。
- `BaseAgentEntry` 新增 `tags` 字段，便于在管理界面按标签过滤 Agent。
- `AgentSubNode` 新增 `name` 字段，便于识别子节点。
- 新增 `node-pty` 依赖以支持终端服务。

### 变更

- `UsageLogRow` 同时记录 `sessionId`（发送方）与 `profileId`（聚合维度），token 统计按 profile/thread 汇总。
- `threadId` 改为每次消息进入时按 `session.profileId` 现查 —— 用户切换 profile 后下一条消息立即生效，无需重启。
- `SessionManager.onReceiveChannelMessage` 和 `onTriggerChannelAction` 改为接收 `dbSessionId`，不再传入预先计算好的 `threadId`。
- `AgentRunner` 改从 `SaverPool` 取 saver，不再自行创建；saver 生命周期跟随引用计数而非会话。
- `ChannelManager` 与 `Database` 改为从关联的 `SessionProfile` 读取可覆盖配置，而不再读取 session 行。
- `HttpServer` 简化为接线和中间件，按领域处理逻辑迁移到新的 `routes/` 模块。
- 移除 `saver.share` 模式，由 pool 统一负责实例共享。
- 清理 `Channel`、`Core`、`Server` 模块中残留的 `as any` 断言。

### 维护

- 新增依赖 `node-pty ^1.1.0`。
- 数据库迁移：新增 `session_profile` 表，为 `channel_session` / `usage_logs` 增加 `profileId` 列（已有数据自动回填）。
