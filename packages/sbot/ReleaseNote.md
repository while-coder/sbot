### New Features

- **VSCode Extension**: Full-featured VSCode plugin — chat with sbot directly in the IDE, built-in server picker, working directory selector, reads connection info from CLI config
- **Unified Chat UI Component Library**: Refactored chat interface into a standalone `chat-ui` package shared across VSCode extension, PWA, and Web (ChatView, SessionBar, ConfigToolbar, StatusBar, etc.)
- **PWA Application**: Added PWA build support for offline-capable installation; new server connection picker
- **Zip Skill Installation**: Support installing Skill packages via zip file upload
- **Agent Abort Signal**: Agent execution supports cancellation (AbortSignal) — model calls and tool execution can be aborted
- **Model Timeout Configuration**: Global and per-agent model call timeout settings
- **Sleep Tool**: New sleep tool allowing agents to pause during execution
- **MP4 Support**: `readMediaFile` now supports reading MP4 video files

### Architecture Changes

- **Chat UI Component Split**: `ChatApp` decomposed into `ChatView`, `ChatArea`, `AskForm`, `MessageList`, `SessionBar`, `ConfigToolbar`, `StatusBar`, `ToolApprovalBar`, `ThinkDrawer` and other independent components
- **WebSocket Transport Layer**: New standalone `WebSocketTransport` class unifying WebSocket connection management across all platforms
- **IModelService Interface**: All model service methods now accept AbortSignal parameter
- **Shared Assets Package**: New `shared-assets` package for unified management of logos, icons, and static resources

### Improvements

- **Unified Theme System**: Added theme-dark, theme-light, theme-vscode, theme-pwa theme files for consistent styling across platforms
- **Lark Channel**: Improved history handling, fixed message flow, excluded at-mention noise
- **Intent Classification**: Fixed classification logic issues
- **Empty Message Filtering**: Fixed handling of empty content messages
- **Attachment Handling**: Improved Web UI attachment upload experience
- **Code Cleanup**: Removed dead code and types, deleted redundant dev-dist files
- **Logo Update**: Unified brand logo across the entire project
