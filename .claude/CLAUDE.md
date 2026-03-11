# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sbot is a self-hosted AI agent server written in TypeScript. It orchestrates LLM-powered agents with tool-calling, memory, skill management, and multi-channel communication (Lark/Feishu, WebSocket, HTTP/SSE). The codebase is primarily commented in Chinese (Simplified).

## Build & Run Commands

```bash
# Full build (server + website)
npm run build

# Server-only build (compile TS + bundle local deps)
npm run debug

# Run the compiled server
node dist/index.js

# Run website dev server (proxies API to localhost:5500)
npm run client
```

There are no tests, no linter, and no formatter configured.

## Project Structure (Three Sub-projects)

| Sub-project | Path | Stack | Output |
|-------------|------|-------|--------|
| **Server** | `src/` | TypeScript, Express 5, Sequelize/SQLite | `dist/` (CommonJS) |
| **Web UI** | `website/` | Vue 3, Vite, TypeScript | `webui/` (served at `/webui/`) |
| **CLI** | `cli/` | React + Ink (terminal UI), TypeScript | ESM |

## Local Dependencies

Two sibling repos are linked via `file:` protocol in package.json and TypeScript project references:

- **`scorpio.ai`** (`../WMTools/scorpio.ai`) — Core AI agent framework: `AgentServiceBase`, `SingleAgentService`, `ReActAgentService`, `SupervisorAgentService`, `ServiceContainer` (DI), MCP tool support, memory services, savers, skills, embeddings
- **`winning.ai`** (`../WMTools/winning.ai`) — Lark/Feishu SDK integration: `LarkService`, `LarkUserServiceBase`, `UserServiceBase`

The `scripts/postbuild.js` script copies their compiled outputs into `dist/` for self-contained deployment.

## Architecture

### Startup Sequence (`src/index.ts`)
1. Initialize Logger (log4js) → 2. Database (SQLite) → 3. Register global tools → 4. Register global skills → 5. Init channels (Lark) → 6. Start HTTP server → 7. Start scheduler

### Key Modules

- **`src/Agent/`** — Agent lifecycle. `AgentFactory` creates agents in three modes: Single, ReAct (think/act/observe loop), Supervisor (multi-agent orchestration). `AgentRunner` wires up memory/saver services via `ServiceContainer` (DI) and streams responses.

- **`src/Tools/`** — Built-in LLM tools using LangChain's `DynamicStructuredTool` with Zod schemas, returning `MCPToolResult` format:
  - `Command/` — 17 tools for executing scripts (Python, Node, Shell, PowerShell, etc.)
  - `FileSystem/` — 15 tools for file operations (read, write, edit with fuzzy matching, search, grep)
  - `Fetch/` — URL fetching with HTML→Markdown (Readability + Turndown), robots.txt compliance
  - `Scheduler/` — Cron task CRUD from within LLM conversations

- **`src/Server/HttpServer.ts`** — Express 5 REST API. Full CRUD for settings, agents, sessions, MCP servers, skills, savers, memories, timers, users. Chat via `POST /api/chat` (SSE) and `ws://host/ws/chat` (WebSocket).

- **`src/UserService/`** — Message routing. `UserService` dispatches to context-specific handlers: `LarkUserService`, `WebSocketUserService`, `HttpUserService`. Each delegates to `AgentRunner.run()`.

- **`src/Channel/`** — Plugin-style channel management. Currently Lark/Feishu only. Event deduplication via the `message` DB table.

- **`src/Scheduler/`** — Cron-based task execution stored in SQLite. Tasks can deliver via Lark channel or run headlessly.

- **`src/SkillHub/`** — Aggregates three external skill marketplaces (clawhub.ai, skills.sh, skillsmp.com) for unified search/install.

- **`src/Core/`** — Singletons: `Config` (reads `~/.sbot/settings.json`), `Database` (Sequelize/SQLite with 4 tables: message, state, user, scheduler), `LoggerService` (log4js with rotating files).

### Patterns

- **Singletons** — Core services (`config`, `database`, `httpServer`, `channelManager`, `schedulerService`, `userService`, `globalAgentToolService`, `globalSkillService`) are module-level singleton exports.
- **Dependency Injection** — `ServiceContainer` from scorpio.ai with token-based registration for model, memory, saver, tool, and skill services.
- **Factory Pattern** — `AgentFactory.create()` produces different agent types from config.
- **TypeScript Decorators** — Command parsing uses `@Command`, `@Arg`, `@Option` decorators (see `BuiltInCommands.ts`).
- **SKILL.md Convention** — Skills are directories with a `SKILL.md` frontmatter file (name, description, prompt) and optional reference documents. Built-in skills live in `skills/`, user skills in `~/.sbot/skills/`.

### Data Storage

All runtime data lives under `~/.sbot/`:
- `settings.json` — Main configuration (models, embeddings, agents, sessions, channels)
- `mcp.json` — MCP server configurations
- `skills/` — User-installed skills
- `logs/` — Rotating log files
- SQLite database for messages, state, users, scheduler tasks

## TypeScript Configuration

- Target: ES2017, Module: CommonJS
- Strict mode enabled
- Experimental decorators + decorator metadata enabled
- Source maps enabled
