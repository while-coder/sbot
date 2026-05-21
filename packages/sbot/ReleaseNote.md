### New Features

- **ACP Agent Support**: Full Agent Client Protocol integration — persistent and transient ACP agent modes, agent pool management, permission handling, and streaming responses via ACP
- **MCP Tool Management**: MCP server configuration supports SSE transport, new utility tools (`MCPUtilityTools`), enhanced admin panel for MCP tool inspection and per-agent MCP binding
- **Insight System Overhaul**: Rebuilt `InsightService` — simplified extraction pipeline, integrated with `UsageTracker`, removed redundant prompt-based tools in favor of direct service calls
- **Conversation Compaction**: Automatic conversation summarization when token usage exceeds threshold, preserving context continuity while reducing token consumption
- **OneBot Channel**: New channel supporting QQ and other OneBot-compatible platforms
- **XiaoAI Channel**: New channel for Xiaomi AI speakers — account login, device discovery, TTS playback, and polling-based conversation
- **Token Usage Tracking**: Per-model token usage statistics with admin dashboard visualization
- **Session Search Tool**: New tool allowing agents to search across session history
- **Heartbeat System**: Configurable periodic agent self-activation — supports custom intervals, prompt templates, and target channels; managed via admin panel
- **Middleware Pipeline**: New `MiddlewarePipeline` with intent-based filtering for session message processing
- **Timer Executor**: Extracted `TimerExecutor` utility for unified scheduled task execution (heartbeat, scheduler, wiki indexing)
- **Workspace Prompt Discovery**: `ContextFileDiscovery` supports loading workspace-level prompt files
- **Parameterized Built-in Tools**: Built-in tool providers (FileSystem, Scheduler, Todo, MCP) accept per-agent parameters via `mcpParams` — e.g. FileSystem `readonly` mode to expose only read tools
- **Channel Approval / Ask Timeout**: New `approvalTimeout`, `approvalTimeoutValue` (allow/deny), `askTimeout`, `askTimeoutMessage` settings on `ChannelConfig` and `ChannelSession` for unattended-session safety
- **SkillHub.cn Provider**: New `SkillhubCnSkillHubService` for the skillhub.cn registry, joining the existing Clawhub and skills.sh providers

### Architecture Changes

- **Static / Dynamic Prompt System**: Prompts split into static environment context and dynamic per-turn context, with frontmatter variable declarations; directory reorganized (`static_environment.txt` → `environment.txt`, `init.txt` → `instruction.txt`)
- **ACP Agent Architecture**: New `ACPAgentServiceBase` with `PersistentACPAgentService` (long-lived process, session reuse) and `TransientACPAgentService` (per-request lifecycle)
- **Memory / Wiki Simplification**: Removed `MemoryCompressor`, `MemoryExtractor`, `WikiExtractor`, `ReadOnlyMemoryService`; consolidated memory and wiki into lightweight CRUD services backed by `HybridSearcher`
- **HybridSearcher Enhancement**: Rewritten `HybridSearcher` combining keyword matching with embedding-based semantic search, configurable strategies, better scoring, and wiki auto-indexing
- **Model Retry Proxy**: `RetryModelServiceProxy` with exponential backoff for transient errors (rate limits, timeouts, connection resets)
- **Skill Service Refactor**: `SkillService` rewritten with cleaner lifecycle and parsing logic
- **DI Parent Scope**: `ServiceContainer` supports parent scope resolution for hierarchical DI
- **Agent Insight Integration**: Insight extraction moved from agent service internals to `AgentRunner` orchestration layer
- **Shared UI Library (`sbot-ui`)**: New package extracting reusable Vue components (`SButton`, `SCard`, `SModal`, `STable`, `STree`, `STab`, `SInput`, `SSelect`, `SSwitch`, `SToast`, etc.) plus design tokens and dark theme — consumed by admin and chat-ui
- **Admin Refactor on `sbot-ui`**: Admin panel rebuilt on top of the shared component library — modals reorganized under `components/modals/`, legacy bespoke widgets removed
- **Tool & Prompt Externalization**: Built-in tool descriptions and intent / compact prompts moved out of source code into `prompts/` text files (`intent/default.txt`, `compact/post_message.txt`, `compact/post_continuation.txt`, `tools/{sleep,time,mcp,memory,wiki}/*.txt`) and loaded via `loadPrompt`

### Improvements

- **MCP SSE Support**: MCP server connections support Server-Sent Events transport in addition to stdio
- **Channel Message Merging**: Consecutive messages from the same user are merged before processing
- **Channel Tools Configuration**: Channels support configurable tool whitelists per plugin
- **Channel Proactive Send**: Channels can now send messages proactively (not just in response)
- **Claude Thinking Support**: Anthropic model service supports configurable extended thinking
- **Generative Model Auto-Truncation**: Generative agent automatically truncates input when exceeding context window
- **Image Auto-Scaling**: Images auto-resized to configurable max dimensions before sending to model
- **Prompt Frontmatter**: PromptLoader supports YAML frontmatter with variable metadata, used by admin API
- **Admin Panel**: New ProcessesView, TokenUsageView pages; redesigned Memory/Wiki management with detail modals and batch operations; heartbeat config editing; agent prompt assignment and creation
- **Async Module Loading**: Server modules loaded asynchronously for faster startup
- **WeChat QR Login**: WeChat channel supports QR code based login
- **Cache Statistics**: Model response caching with hit/miss statistics
- **Lark Session Handler**: Added session handling support for Lark channel
- **Wiki Auto-Context**: Wiki service injects relevant entries into dynamic context automatically
- **Chat UI Refresh**: Reworked `ChatView`, `ChatArea`, `MessageList`, `AskForm`, and `ConfigToolbar` for cleaner layout and unified styling on top of `sbot-ui`
- **Configurable Image Max Size**: `maxImageSize` setting controls auto-scaling threshold for outbound images
- **Code Cleanup**: Removed `PromptInjectionDetector`, unused i18n entries, legacy memory/wiki types, and admin's bespoke `MultiSelect`/`Toast`/`McpToolsModal`/`SkillHubModal` (replaced by `sbot-ui` equivalents)
