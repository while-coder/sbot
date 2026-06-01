# Release Notes

This release focuses on a UI refresh, a cleaner admin/runtime structure, richer chat workspace tooling, a redesigned todo pipeline, persistent ReAct sub-agent sessions, and more configurable channel and agent behavior.

### Highlights

- Rebuilt the admin console with domain-based navigation and shared `sbot-ui` components.
- Added file explorer, Git explorer, and inline file editing in chat-ui for richer workspace inspection.
- Redesigned todo handling around post-turn extraction and session-scoped storage.
- Externalized intent classification, tool descriptions, and compaction prompts for runtime customization.
- Persistent saver-backed sub-sessions for ReAct agents, with unified `IAgentSaverService` across file/memory/SQLite/Postgres backends.
- Async and timeout-aware `grep`/`glob`/process tools, with shell/python/skill execution unified under `scorpio.ai`'s Process module.
- Made channel approval/ask flows and per-agent built-in tools more configurable.

### Added

- File explorer, Git explorer, and code viewer/editor in chat-ui (file tree, content preview, inline editing, Git status/diff).
- Path picker modal with workspace-aware path selection across admin, chat-ui, and the VSCode extension.
- Session naming, renaming, and auto-generated session names.
- Todo auto-extraction service in `scorpio.ai`, replacing the previous explicit create/done tools.
- SkillHub.cn registry support and a reusable `SkillViewerModal` shared between admin and chat-ui.
- Skill `ls` / `execute_skill_script` tools moved into `scorpio.ai`, with shared `walkTree` utility and externalized prompts.
- Channel approval and ask-timeout configuration.
- Per-agent built-in tool parameters (including readonly FileSystem mode) and per-agent `maxTools` cap.
- Memory entry editing in the admin Memory view.
- Persistent saver-backed sessions for ReAct sub-nodes via `IAgentSaverService`, with new `AgentFileSaver`, `AgentMemorySaver`, `AgentSqliteSaver`, `AgentPostgresSaver`, and `TaskBackedSaver` implementations.
- Task ID propagation through saver, message dispatch, and chat-ui (think drawer scoped per task).
- Externalized intent classification and todo extractor prompts.
- Expanded `sbot-ui` component set (table, modal, form, tabs, tree, toolbar, confirm, etc.) with refined design tokens and dark theme.
- App theme menu and Tauri Windows multi-language metadata.
- Source map support and a bundle script for the `sbot` package.

### Changed

- Reorganized admin views into focused domains: admin, agents, chat, memory, models, runtime, savers.
- Migrated admin and chat-ui to `sbot-ui` components, removing bespoke modals, tables, inputs, and selects.
- Reworked chat-ui layout, message list, and content-part rendering with cleaner tool-call formatting.
- Rebuilt the admin Scheduler view with richer task and heartbeat management; extracted shared scheduler utilities.
- Refined the session search tool's prompt and parameters.
- Refined ACP agent services for better lifecycle handling and stability.
- Normalized saver interfaces across file, memory, SQLite, and Postgres backends.
- Moved built-in tool descriptions (memory, wiki, sleep, time, mcp, session search) into runtime-loaded prompt files.
- Renamed `packages/desktop` to `packages/app` and updated Tauri metadata and configuration.
- Improved WebSocket session handling and message dispatch via a shared `dispatchToSession` helper.
- Reworked shell/python/powershell command tools and consolidated process execution under `scorpio.ai/src/Tools/Process` (`runner`, `shell`, `scriptTool`, `paths`).
- Made `grep` and `glob` asynchronous and added timeout parameters to keep tool calls bounded.
- ReAct agent integrates the saver layer for persistent sub-task sessions; task tool reports task IDs.
- Tightened tool execution logging in `SingleAgentService`.
- Updated README files to match the current package layout.

### Removed

- Old explicit todo `create`/`done` tools and the in-database todo schema.
- Legacy admin widgets replaced by `sbot-ui`.
- Audio and document content parts temporarily filtered out of model input.
- Obsolete generated and build artifacts.

### Maintenance

- Upgraded `ws` and refreshed lockfile entries.
- Updated workspace build configuration, shared assets, and PWA docs assets.
- Added `maxImageSize` for configurable outbound image scaling.
- Trimmed `sbot.commons` dependencies and tidied app/Tauri Cargo configuration.
