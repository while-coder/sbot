## v0.0.10

### New Features

- **Wiki Knowledge Base**: Full knowledge base system — document storage, automatic extraction, semantic search; agents can reference wiki content during conversations; new Wiki management page in Web UI
- **Todo Module**: Built-in todo/task module — agents can create/complete/query todos; new Todo management page in Web UI
- **Intent Classification**: New intent classification system with per-channel message filtering rules, automatically identifies and routes user messages
- **Token Usage Statistics**: Token consumption tracking and statistics — real-time usage display in sidebar, per-conversation token details in chat view
- **Context Window Progress**: Chat interface shows context window usage progress; model catalog supports context window size queries
- **Generative Agent**: New generative agent type with multimodal content processing support
- **Skill Hub Refactoring**: Revamped skill management — skills.sh integration, redesigned skill browsing and viewer modals
- **Memory Search**: Memory module now includes a tool provider for searching memory content
- **Startup Command Configuration**: Settings page supports configuring server startup commands

### Architecture Changes

- **Code Directory Restructuring**: `UserService` → `Session`, `Channel/classifyIntent` → `Processing/classifyIntent` for clearer separation of concerns
- **Memory Evaluator Removal**: Removed `MemoryEvaluator`, simplified memory service architecture
- **Agent Config Migration**: Agent configurations migrated from file-based to database storage for dynamic management
- **WebSocket Rename**: `WebSocketUserService` → `WebSocketSessionHandler`
- **Configurable Streaming Output**: Per-channel streaming output configuration support

### Improvements

- **Multimodal Enhancements**: Agent-level multimodal model configuration; `readBinaryFile` upgraded to `readMediaFile`; improved client-side multimodal message rendering
- **ThinkDrawer Improvements**: Enhanced thinking process display component UI
- **Lark Channel**: Fixed `chat_id` handling, optimized LarkService message flow
- **Scheduler Fix**: Fixed SchedulerService runtime issues
- **Dependency Upgrades**: Upgraded core package versions for scorpio.ai, website, and others
- **Code Cleanup**: Removed dead code, streamlined AgentStore logic, cleaned up redundant exports