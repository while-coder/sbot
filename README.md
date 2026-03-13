# sbot

Self-hosted AI agent server with multi-channel support, persistent memory, and extensible tools.

---

## LLM Providers

- **OpenAI** — GPT series models
- **Anthropic** — Claude series models
- **Azure OpenAI** — Azure-hosted deployments
- **Ollama** — Local models (no API key required)
- **OpenAI-compatible APIs** — Groq, Mistral, DeepSeek, and any provider that exposes an OpenAI-compatible endpoint

Each model can be independently configured with its own API key, base URL, temperature, and token limits.

---

## Agent Modes

### Single Agent
One LLM with tools and skills attached. Suitable for general-purpose assistants.

### ReAct (Multi-Agent Orchestration)
A thinking model analyzes the task and dispatches sub-tasks to specialized sub-agents. Sub-agents can be composed recursively. Each sub-agent operates with read-only access to shared memory.

---

## Memory

Long-term memory with a full extract → evaluate → compress pipeline:

- **Extraction** — Automatically identifies salient facts from conversations
- **Evaluation** — Scores memory importance on a 0–1 scale
- **Compression** — Merges related memories to reduce redundancy
- **Retrieval** — Semantic search via vector embeddings
- **Auto-cleanup** — Configurable age limit and automatic expiry

Memory modes: read-only, human messages only, or full conversation.

---

## Conversation Persistence

Four backends for storing conversation history:

| Backend | Description |
|---|---|
| Memory | In-process only, no disk writes |
| SQLite | Local SQLite database per saver instance |
| PostgreSQL | External database for production deployments |
| File | JSON files per conversation thread |

---

## Channels

### Lark / Feishu
Enterprise IM integration with event deduplication, interactive card support, and per-user context preservation.

### Web UI
Browser-based chat interface with real-time streaming, attachment upload, and agent/session switching.

### HTTP + WebSocket
REST API and WebSocket endpoint for programmatic access or custom clients.

### CLI
Terminal UI with interactive setup wizard and real-time streaming output.

---

## Tools

### Built-in Tool Groups

**Command Execution**
- Shell commands and scripts
- Inline Python and PowerShell execution
- File-referenced script execution
- Configurable timeout per command

**File System**
- Read, write, edit files
- Search with regex (grep)
- Find files by pattern (glob)
- Directory listing, create, remove, move, copy

**Scheduler**
- List, create, and delete scheduled tasks
- Cron expression format

### MCP (Model Context Protocol)

Full MCP support for connecting external tool servers:

- `stdio` transport — child process via stdin/stdout
- `http` transport — remote HTTP/SSE servers
- Global MCP servers shared across agents
- Per-agent MCP server overrides
- Auto-restart on failure

---

## Skills

Skills are self-contained prompt modules that extend agent capabilities for specific domains or workflows. They can be:

- Loaded from the global skills directory
- Scoped to individual agents
- Discovered and installed from remote skill hubs (Clawhub, skills.sh, and others)

Bundled skills include workflows for brainstorming, planning, debugging, TDD, code review, multi-agent coordination, and more.

---

## Scheduler

Cron-based task scheduler with persistent storage:

- Standard 5-field cron expressions
- Survives server restarts (tasks resume automatically)
- Optional maximum run count with auto-cleanup
- Tasks can target a channel user, a web session, or a working directory

---

## Embeddings

For memory semantic search, the following embedding providers are supported:

- **OpenAI** — text-embedding-ada-002, text-embedding-3-small, text-embedding-3-large
- **Azure OpenAI** — Azure-hosted embeddings
- **Ollama** — Local embeddings

---

## Configuration

All configuration lives in a single `settings.json` file. Supports three levels of override:

1. **Global** — applies to all agents and channels
2. **Directory** — per-project override via a local `.sbot/settings.json`
3. **Session** — per-session model, saver, and memory overrides via the web or CLI

Auto-generated example configs are created on first run.
