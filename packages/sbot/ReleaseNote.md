# Release Notes

This release introduces a shared SessionProfile model that decouples session identity from runtime configuration, splits the monolithic HTTP server into focused route modules, adds a pooled saver layer, and brings a built-in terminal to the web channel.

### Highlights

- New `SessionProfile` table holds all overridable config, the thread id, and token stats — multiple sessions (across channels) can share one profile and therefore share a thread.
- `HttpServer` (~1800 lines) was split into `routes/` and `helpers/` modules for maintainability.
- New `SaverPool` reference-counts saver instances by dbPath so concurrent access to the same file/DB goes through a single handle.
- Web channel gained a WebSocket-backed `PtyService` (terminal) with auto shell detection on Windows/macOS/Linux.

### Added

- `SessionProfile` entity carrying agent/saver/memories/wikis/workPath/intent/auto-approve overrides plus token stats; `ChannelSession` is now identity-only and references a profile via `profileId`.
- Auto profile created per session (`autoForSessionId`); users can switch a session to a visible profile to share thread and config across sessions and channels.
- Admin `SessionProfilesView` for managing visible profiles, plus `SessionConfigOverridesEditor` shared between channel and profile editors.
- `SaverPool` (`Agent/SaverPool.ts`): per-dbPath singleton with refcount and lazy dispose; Memory savers are not pooled.
- `Channel/web/PtyService.ts`: WebSocket PTY service backed by `node-pty`, with platform-aware shell discovery (PowerShell, cmd, pwsh 7, Git Bash, WSL on Windows; bash/zsh/fish on Unix).
- `Channel/web/WebService.ts`: extracted Web-channel message composition (interleaved text/image parts, attachment file persistence, image auto-resize) out of `HttpServer`.
- `Server/routes/` modules: `acp`, `agentStore`, `agents`, `chat`, `data`, `filesystem`, `heartbeats`, `logs`, `mcp`, `prompts`, `schedulers`, `settings`, `skillHub`, `skills`, `system`, `todos`, `users`.
- `Server/helpers/` modules: `git`, `modelInfo`, `promptTree`, `settingsCrud`, `skillsHelpers`, `todoFile`.
- `tags` field on `BaseAgentEntry` for filtering agents in the admin UI.
- `name` field on `AgentSubNode` for clearer sub-agent identification.
- `node-pty` dependency for the new terminal service.

### Changed

- `UsageLogRow` now records both `sessionId` (sender) and `profileId` (aggregation key) so token stats roll up by profile/thread.
- `threadId` is now resolved per incoming message from `session.profileId` — switching a session's profile takes effect on the next message without restart.
- `SessionManager.onReceiveChannelMessage` and `onTriggerChannelAction` now take `dbSessionId` instead of a precomputed `threadId`.
- `AgentRunner` consumes savers from `SaverPool` instead of creating its own; saver lifecycle is tied to refcount, not session.
- `ChannelManager` and `Database` updated to read overridable config off the linked `SessionProfile` rather than the session row.
- `HttpServer` reduced to wiring/middleware; per-area handlers live in the new `routes/` modules.
- Removed `saver.share` mode now that pooling handles instance sharing.
- Cleaned up `as any` casts across `Channel`, `Core`, and `Server` modules.

### Maintenance

- Added `node-pty ^1.1.0` to dependencies.
- Database migration adds `session_profile` table and `profileId` columns on `channel_session` / `usage_logs` (with backfill for existing rows).
