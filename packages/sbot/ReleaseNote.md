# Release Notes

This release significantly expands sbot's surface: a new workflow engine, three new chat channels, a built-in tunnel that exposes the local server to the internet without a separate reverse proxy, a cross-platform desktop & Android Helper app for channel logins that need an embedded browser, and a more resilient MCP integration.

### Workflow engine

A new workflow system lets you orchestrate multi-step agent tasks with deterministic control flow. Workflow errors are now captured and surfaced cleanly instead of crashing the run.

### New channels

- **Xiaoai (Mi smart speaker)** — talk to your bot through a Mi/Xiaoai speaker, with configurable polling interval.
- **DingTalk** — first-class DingTalk channel for enterprise group chat.
- **QQ via OneBot v11** — connect any OneBot-compatible QQ bot framework.

### Built-in tunnel

A new tunnel service exposes the local server to the public internet from the admin UI, with three providers to choose from: Cloudflare Quick (zero-config), Cloudflare Token (your own named tunnel), and Localtunnel. The required `cloudflared` binary is downloaded automatically on first use.

### Helper desktop & Android app

A new Tauri-based Helper app handles channel logins that require an embedded browser, now available on desktop **and** Android. It ships with built-in auto-update, signed release builds, and the first supported login flow — Xiaoai cookie login: sign in once in the Helper window and sbot picks up the session.

### WebSocket transport

sbot now exposes a WebSocket interface alongside the existing HTTP API, enabling lower-latency push from server to client and powering the new admin UI live updates.

### VSCode session integration

When sbot is launched from VSCode, the working directory of the active session is now tracked and updated automatically — switching files or workspaces is reflected in the agent's context without manual intervention.

### Message compression

Long conversations are now compressed before being sent to the model, keeping context usage down on extended chats without losing the thread.

### More reliable MCP

Remote MCP servers (HTTP / SSE / streamable HTTP) often drop sessions when restarted or under network instability. sbot now detects these stale connections and transparently reconnects, so tool calls keep working without surfacing transient failures to the agent.

### Tool output handling

Oversized tool outputs are now truncated before they reach the model, with per-agent control over the limit. The `read` file tool has been reworked alongside this so large files behave predictably in long conversations. Working-path handling has also been hardened.

### Lark improvements

Card-update failures (timeouts, message-too-old, etc.) are now caught — and when configured, the reply automatically falls back to sending a file instead of dropping the response.

### Scheduler

Scheduled jobs can now be disabled without deleting them, making it easier to pause and resume recurring tasks.

### Unified channel tools

Every channel now exposes the same set of tools to the agent — list channels/sessions/users, send a message, send a file — so multi-channel agents behave consistently regardless of which platform they're talking to.

### Documentation

The documentation site has been overhauled with a refreshed theme and a complete Chinese translation covering every guide page (Agents, Channels, Tools, MCP, Memory, Skills, Wiki, Heartbeat, Insight, Note, Savers, and more).
