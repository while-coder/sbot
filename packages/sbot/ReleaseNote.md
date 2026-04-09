## v0.0.9

### New Features

- **WeChat Channel**: New `channel.wechat` package with full WeChat integration — API client, chat provider, session handler, QR code login, file sending/receiving
- **Mobile Responsive Web UI**: All web dashboard views (Agents, Channels, Chat, Memories, Savers, Models, Embeddings, MCP, Skills, Scheduler, Users, etc.) now support mobile display
- **Global MCP & Skills**: Support for global MCP skills configuration and agent-level MCP/Skill management in the web UI
- **Shared Conversation History**: Agents can now share conversation history across sessions
- **Auto Start**: Server auto-start capability with startup configuration

### Architecture Changes

- **WebSocket Refactoring**: Reorganized `WebSocketUserService` and expanded `createProcessAIHandler` for cleaner request processing pipeline
- **SkillService No-Cache**: `SkillService` switched to no-cache mode for real-time skill updates
- **Code Cleanup**: Removed unused `CommandDecorators`, simplified redundant chat components, cleaned up Wecom session handler

### Improvements

- **WeChat/WeCom File Support**: Both WeChat and WeCom channels support sending and receiving files
- **WeCom Image & Mixed Content**: WeCom channel now supports image messages and mixed image-text content
- **Channel Password Auth**: Channel management UI now supports password/auth configuration
- **WebSocket Event Cleanup**: Unified and simplified WebSocket event types and handling
- **Various Bug Fixes**: Fixes across Lark/Slack session handlers, message serializer, model config, and embedding types

