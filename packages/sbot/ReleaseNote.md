## v0.0.9

### New Features

- **Multimodal Messages**: Full multimodal support across all channels — Lark/WeChat/WeCom/Web can send and receive images; Web UI supports drag-drop and paste image input with lightbox preview; agents process image content from MCP tool results
- **WeChat Channel**: New `channel.wechat` package with full WeChat integration — API client, QR code login, file sending/receiving
- **Mobile Responsive Web UI**: All web dashboard views now support mobile display
- **Global MCP & Skills**: Support for global MCP skills configuration and agent-level MCP/Skill management
- **Shared Conversation History**: Agents can now share conversation history across sessions
- **Auto Start**: Server auto-start capability with startup configuration

### Architecture Changes

- **Multimodal Content Pipeline**: `MessageContent` supports both string and multipart array formats; extracted shared `MessageList` component and `messageRender.ts` utility for unified rendering of text, images, tool calls, and streaming
- **WebSocket Refactoring**: Reorganized `WebSocketUserService`, unified event types, expanded `createProcessAIHandler` processing pipeline
- **SkillService No-Cache**: Switched to no-cache mode for real-time skill updates
- **Code Cleanup**: Removed unused `CommandDecorators`, simplified redundant chat components

### Improvements

- **Channel File & Image Support**: WeChat/WeCom support file sending/receiving and mixed image-text content
- **Channel Password Auth**: Channel management UI now supports password/auth configuration
- **Various Bug Fixes**: Fixes across Lark/Slack session handlers, message serializer, model config, and embedding types
