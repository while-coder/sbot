## v0.0.7

### New Features

- **Archive Tools**: Built-in tools for ZIP archive operations — compress, extract, list contents, and read files within archives
- **Binary File Read Tool**: Added `read_binary_file` tool for reading binary files in agent workflows
- **Lark File/Image Support**: Lark channel now supports sending and receiving images, files, and other media
- **find-skills Skill**: Built-in skill for discovering available skills in the skills directory
- **Multiple Memory Support**: Agent can now load and use multiple memory sources simultaneously per session; `getSystemMessage()` replaced with `getMemories()` returning scored results
- **Memory Management UI**: Web dashboard supports viewing and managing individual memory entries with improved modal
- **Docker Support**: Added Dockerfile and helper scripts for containerized deployment
- **Chat Paste Support**: Web chat panel now supports pasting images and files directly from clipboard

### Architecture Changes

- **Saver Refactoring**: Removed `threadId` from all saver implementations (File, SQLite, Postgres, Memory). Each saver now operates on a single file/table directly. Added `getAllMessagesWithTime()` for retrieving messages with creation timestamps via new `SaverMessage` type
- **Memory Storage Refactoring**: Removed `threadId` from `MemorySqliteDatabase` and `IMemoryDatabase`. Memory databases now use single-file storage with lazy initialization. Scoring logic (time decay + importance + recency + access frequency) moved into `MemorySqliteDatabase.searchWithTimeDecay()`. Removed `T_MemorySystemPromptTemplate` token
- **UserService Restructuring**: Channel-specific user services moved into `channels/` and `web/` subdirectories. Extracted common channel message processing logic into `ChannelMessageMixin` to eliminate code duplication across Lark, Slack, and WeCom services
- **Session Manager Refactoring**: Unified approval and ask state management. Renamed `PendingToolInfo` to `ApprovalInfo`, added `WaitingAsk` session status. Extracted `SessionService` type into its own file. Status is now automatically synced based on pending operations
- **DI Token Cleanup**: Removed `T_ThreadId` token; added `T_DBTable` for Postgres saver

### Improvements

- **Case-Insensitive Search**: `glob` and `grep` tools now use case-insensitive matching (`--iglob` flag and `i` regex flag)
- **Scheduler Tool**: Simplified `scheduler_create` by removing the `name` parameter; streamlined output messages
- **Skill Tools Auto-Approval**: Skill-related tools (`read_skill_file`, `execute_skill_script`, `list_skill_files`) and `send_file` are now auto-approved without user confirmation
- **Memory Retrieval**: `IMemoryService.getMemories()` now returns `MemoryResult[]` with `decayedScore`, giving consumers full control over formatting and filtering
- **Web Dashboard**: Added `MultiSelect` component; improved Channels, Memories, Savers, Scheduler, and Users views; better i18n support
- **Lazy Database Initialization**: SQLite-based saver and memory databases now lazily create connections and tables on first access, with automatic directory creation
- **Prompt Refinements**: Refined channel-specific prompts for ask and send-file interactions
- **AgentRunner**: Cleaned up internal agent execution flow and improved prompt handling
- **Skills Directory**: Added directory-level description support for skills discovery

### Bug Fixes

- Fixed channel registration issue
- Fixed website client display
- Fixed binary file read tool output (removed redundant `filePath` from response)
- Removed debug logging
- Fixed tool result handling

