This release includes the following main changes:

### Added

1. Added the Remote Agent Client channel. External IDEs, debuggers, and agents can connect through WebSocket or HTTP + SSE and provide per-session prompts, tools, and attachments, while sbot continues to manage models, conversation history, and memory.
2. Long-term memory now has global and workspace scopes. Project knowledge is stored and searched separately by `workPath`, and the Admin UI can switch between scopes when viewing memories and background jobs.
3. Added the `remember_memory` tool for immediately queueing information that the user explicitly asks to save, with an exact global or workspace target. Memory Profiles can also use a separate Selector model to find relevant memories.
4. Agenda now supports detailed lookup, atomic editing, and closing, with complete states including done, cancelled, and expired. Agenda synchronization jobs and failure details are available in the Admin UI.
5. A single XiaoAI channel can now connect multiple speakers. Each speaker keeps an independent conversation and replies are played only on the device that started it.
6. Added an Agent capability plugin API for static and dynamic prompts, tools, end-of-turn hooks, and optional inheritance by sub-agents.

### Improved

1. Memory extraction now matches the global and workspace catalogs before the Writer reads candidate bodies, improving relevance and token usage for large memory stores. Duplicate merging, evidence counting, and search output are also improved.
2. Agenda synchronization selects relevant items in batches when conversations or item collections are large. Lists use compact previews and load full details on demand, making complex schedule recognition and editing more reliable.
3. Memory and Agenda background jobs now have clearer status views, and failed memory jobs can be retried or removed directly.
4. Group-chat intent filtering now considers recent conversation history, improving follow-up recognition. Lark group chats also preserve the displayed names of mentioned members.
5. XiaoAI speakers can be selected by name, alias, deviceID, or miotDID, and sessions remain continuous after a device is renamed.
6. The Web UI, desktop app, CLI, VS Code extension, and Remote Agent channel now share a consistent message and attachment format, improving text, image, and file handling across clients.
7. Agent and conversation-storage selectors in chat now use a consistent dropdown interaction for clearer configuration.

### Fixed

1. Fixed HTTP + SSE Remote Agent responses closing before processing had actually completed, with reliable cleanup for errors and long-idle requests.
2. Fixed memory creation failing when a new entry reused an existing slug, and consolidation jobs incorrectly increasing evidence counts without a new conversation.
3. Fixed incorrect states after one-time or limited Agenda schedules completed normally, missed their time window, or exhausted their retries.
