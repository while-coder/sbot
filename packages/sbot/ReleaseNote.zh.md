# 发布说明

本次更新重点：UI 刷新、更清晰的管理后台与运行时结构、更强的聊天工作区能力、重构的 Todo 流程，以及更灵活的渠道与 Agent 配置。

### 重点变化

- 重建管理后台，采用按领域组织的导航和共享组件。
- chat-ui 新增文件浏览器与 Git 浏览器，提升工作区查看和操作体验。
- Todo 改为基于每轮对话后的自动提取，并使用会话级存储。
- 意图分类、工具描述、对话压缩等 prompt 外置，可在运行时定制。
- 渠道审批/提问流程和 Agent 内置工具的参数化更加灵活。

### 新增

- chat-ui 文件浏览器和 Git 浏览器（文件树、内容预览、Git 状态/差异）。
- chat-ui 会话命名与重命名。
- `scorpio.ai` 新增 Todo 自动提取服务，取代原有的显式 create/done 工具。
- SkillHub.cn 仓库支持。
- 渠道审批与提问超时配置。
- Agent 内置工具按需传参（含 FileSystem 只读模式）。
- 意图分类 prompt 外置。
- 扩充 `sbot-ui` 组件集合（表格、弹窗、表单、Tab、树、工具栏、确认框等），完善设计 Token 与深色主题。

### 变更

- 管理后台视图按 admin、agents、chat、memory、models、runtime、savers 重新组织。
- admin 与 chat-ui 切换到 `sbot-ui` 组件，移除自建的弹窗、表格、输入框和下拉选择。
- 重整 chat-ui 布局与消息列表，优化工具调用展示与内容片段渲染。
- 重构管理后台的调度器（Scheduler）视图，提供更丰富的任务与心跳管理。
- 优化会话搜索工具（session_search）的 prompt 与参数。
- 优化 ACP 代理服务的生命周期管理与稳定性。
- 规范 file、memory、SQLite、Postgres saver 接口。
- 内置工具描述（memory、wiki、sleep、time、mcp、session_search）迁移到运行时加载的 prompt 文件。
- `packages/desktop` 更名为 `packages/app`，并更新 Tauri 元数据。
- 改进 WebSocket 会话处理与消息分发。
- 更新中英文 README，使其匹配当前包结构和功能状态。

### 移除

- 移除旧的显式 Todo create/done 工具及数据库内的 todo 表结构。
- 移除已由 `sbot-ui` 替代的旧管理后台控件。
- 清理过期的生成产物和构建产物。

### 维护

- 升级 `ws` 并刷新 lockfile 相关条目。
- 更新 workspace 构建配置、shared assets 和 PWA docs 资源。
- 新增 `maxImageSize`，支持配置出站图片缩放阈值。
