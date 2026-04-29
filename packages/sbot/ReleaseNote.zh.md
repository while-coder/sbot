### 新功能

- **VSCode 扩展**: 全新 VSCode 插件 — 支持在 IDE 中直接与 sbot 对话，内置服务器选择、工作目录选择，支持从 CLI 配置读取连接信息
- **Chat UI 统一组件库**: 将聊天界面重构为独立 `chat-ui` 包，VSCode 插件、PWA、Web 三端共享同一套组件（ChatView、SessionBar、ConfigToolbar、StatusBar 等）
- **PWA 应用**: 新增 PWA 构建支持，可离线安装使用；新增服务器连接选择器
- **Zip 安装 Skill**: 支持通过 zip 文件上传安装 Skill 包
- **Agent 中断信号**: Agent 执行支持中断（AbortSignal），模型调用、工具执行均可取消
- **模型超时配置**: 支持全局和 Agent 级别的模型调用超时设置
- **Sleep 工具**: 新增 sleep 工具，Agent 可在执行中暂停等待
- **MP4 支持**: `readMediaFile` 支持读取 MP4 视频文件

### 架构变更

- **Chat UI 组件拆分**: `ChatApp` 拆为 `ChatView`、`ChatArea`、`AskForm`、`MessageList`、`SessionBar`、`ConfigToolbar`、`StatusBar`、`ToolApprovalBar`、`ThinkDrawer` 等独立组件
- **WebSocket 传输层**: 新增独立 `WebSocketTransport` 类，统一各端 WebSocket 连接管理
- **IModelService 接口**: 所有模型服务方法支持 AbortSignal 参数
- **共享资源包**: 新增 `shared-assets` 包统一管理 logo、图标等静态资源

### 改进

- **主题系统统一**: 新增 theme-dark、theme-light、theme-vscode、theme-pwa 主题文件，各端风格一致
- **Lark 渠道**: 优化历史记录处理、修复消息流程、排除 at 消息干扰
- **意图过滤**: 修复分类逻辑问题
- **空消息过滤**: 修正空内容消息的处理
- **附件处理**: Web UI 附件上传体验优化
