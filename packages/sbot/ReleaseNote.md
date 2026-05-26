# Release Notes

This release focuses on a UI refresh, a cleaner admin/runtime structure, richer chat workspace tooling, a redesigned todo pipeline, and more configurable channel and agent behavior.

### Highlights

- Rebuilt the admin console with domain-based navigation and shared components.
- Added file and Git explorer panels in chat-ui for richer workspace inspection.
- Redesigned todo handling around post-turn extraction and session-scoped storage.
- Externalized intent classification, tool descriptions, and compaction prompts for runtime customization.
- Made channel approval/ask flows and per-agent built-in tools more configurable.

### Added

- File explorer and Git explorer panels in chat-ui (file tree, content preview, Git status/diff).
- Session naming and renaming in chat-ui.
- Todo auto-extraction service in `scorpio.ai`, replacing the previous explicit create/done tools.
- SkillHub.cn registry support.
- Channel approval and ask-timeout configuration.
- Per-agent built-in tool parameters (including readonly FileSystem mode).
- Externalized intent classification prompt.
- Expanded `sbot-ui` component set (table, modal, form, tabs, tree, toolbar, confirm, etc.) with refined design tokens and dark theme.

### Changed

- Reorganized admin views into focused domains: admin, agents, chat, memory, models, runtime, savers.
- Migrated admin and chat-ui to `sbot-ui` components, removing bespoke modals, tables, inputs, and selects.
- Reworked chat-ui layout, message list, and content-part rendering with cleaner tool-call formatting.
- Rebuilt the admin Scheduler view with richer task and heartbeat management.
- Refined the session search tool's prompt and parameters.
- Refined ACP agent services for better lifecycle handling and stability.
- Normalized saver interfaces across file, memory, SQLite, and Postgres backends.
- Moved built-in tool descriptions (memory, wiki, sleep, time, mcp, session search) into runtime-loaded prompt files.
- Renamed `packages/desktop` to `packages/app` and updated Tauri metadata.
- Improved WebSocket session handling and message dispatch.
- Updated README files to match the current package layout.

### Removed

- Old explicit todo `create`/`done` tools and the in-database todo schema.
- Legacy admin widgets replaced by `sbot-ui`.
- Obsolete generated and build artifacts.

### Maintenance

- Upgraded `ws` and refreshed lockfile entries.
- Updated workspace build configuration, shared assets, and PWA docs assets.
- Added `maxImageSize` for configurable outbound image scaling.
