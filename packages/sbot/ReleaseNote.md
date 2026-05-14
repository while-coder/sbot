### New Features

- **ACP Agent Support**: Full Agent Client Protocol integration — persistent and transient ACP agent modes, agent pool management, permission handling, and streaming responses via ACP
- **Conversation Compaction**: Automatic conversation summarization when token usage exceeds threshold, preserving context continuity while reducing token consumption
- **OneBot Channel**: New channel supporting QQ and other OneBot-compatible platforms
- **XiaoAI Channel**: New channel for Xiaomi AI speakers — account login, device discovery, TTS playback, and polling-based conversation
- **Token Usage Tracking**: Per-model token usage statistics with admin dashboard visualization
- **Session Search Tool**: New tool allowing agents to search across session history

### Architecture Changes

- **Static / Dynamic Prompt System**: Prompts split into static environment context and dynamic per-turn context, with frontmatter variable declarations
- **ACP Agent Architecture**: New `ACPAgentServiceBase` with `PersistentACPAgentService` (long-lived process, session reuse) and `TransientACPAgentService` (per-request lifecycle)
- **Hybrid Search**: New `HybridSearcher` combining keyword matching with embedding-based semantic search for skill retrieval
- **Model Retry Proxy**: `RetryModelServiceProxy` with exponential backoff for transient errors (rate limits, timeouts, connection resets)
- **Skill Service Refactor**: `SkillService` rewritten with cleaner lifecycle and parsing logic

### Improvements

- **Channel Message Merging**: Consecutive messages from the same user are merged before processing
- **Channel Tools Configuration**: Channels support configurable tool whitelists per plugin
- **Channel Proactive Send**: Channels can now send messages proactively (not just in response)
- **Claude Thinking Support**: Anthropic model service supports configurable extended thinking
- **Generative Model Auto-Truncation**: Generative agent automatically truncates input when exceeding context window
- **Image Auto-Scaling**: Images auto-resized to configurable max dimensions before sending to model
- **Prompt Frontmatter**: PromptLoader supports YAML frontmatter with variable metadata, used by admin API
- **Admin Panel**: New ProcessesView, TokenUsageView pages; enhanced Channels, Prompts, and Agents management
- **Async Module Loading**: Server modules loaded asynchronously for faster startup
- **WeChat QR Login**: WeChat channel supports QR code based login
- **Cache Statistics**: Model response caching with hit/miss statistics
