# Release Notes

This release expands sbot's reach: three new chat channels, a built-in tunnel so the local server can be exposed to the internet without a separate reverse proxy, a desktop helper for channel logins that need an embedded browser, and a more resilient MCP integration.

### New channels

- **Xiaoai (Mi smart speaker)** — talk to your bot through a Mi/Xiaoai speaker, with configurable polling interval.
- **DingTalk** — first-class DingTalk channel for enterprise group chat.
- **QQ via OneBot v11** — connect any OneBot-compatible QQ bot framework.

### Built-in tunnel

A new tunnel service exposes the local server to the public internet from the admin UI, with three providers to choose from: Cloudflare Quick (zero-config), Cloudflare Token (your own named tunnel), and Localtunnel. The required `cloudflared` binary is downloaded automatically on first use.

### Helper desktop app

A new Tauri-based desktop helper handles channel logins that require an embedded browser. The first flow it ships is Xiaoai cookie login — sign in once in the helper window and sbot picks up the session.

### More reliable MCP

Remote MCP servers (HTTP / SSE / streamable HTTP) often drop sessions when restarted or under network instability. sbot now detects these stale connections and transparently reconnects, so tool calls keep working without surfacing transient failures to the agent.

### Tool output handling

Oversized tool outputs are now truncated before they reach the model, with per-agent control over the limit. The `read` file tool has been reworked alongside this so large files behave predictably in long conversations.

### Lark improvements

Added a get-group-list capability for managing Lark group conversations from the agent.

### Scheduler

Scheduled jobs can now be disabled without deleting them, making it easier to pause and resume recurring tasks.

### Unified channel tools

Every channel now exposes the same set of tools to the agent — list channels/sessions/users, send a message, send a file — so multi-channel agents behave consistently regardless of which platform they're talking to.

### Documentation

The documentation site has been overhauled with a refreshed theme and a complete Chinese translation covering every guide page (Agents, Channels, Tools, MCP, Memory, Skills, Wiki, Heartbeat, Insight, Note, Savers, and more).
