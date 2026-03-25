# sbot — Self-hosted AI Agent Server

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open-source, self-hosted AI agent framework.** Run LLM-powered agents on your own server with persistent memory, multi-channel integrations, MCP tool support, and a built-in web UI — no vendor lock-in.

---

## Quick Start

### npm

```bash
npm install -g @qingfeng346/sbot
sbot
# Open http://localhost:5500
```

If port 5500 is already in use, change it with:

```bash
sbot port 3000        # save port and exit
sbot --port 3000      # save port and start
```

---

### Docker

```bash
docker pull qingfeng346/sbot
docker run -d \
  -p 5500:5500 \
  -v ~/.sbot:/root/.sbot \
  --name sbot \
  qingfeng346/sbot
# Open http://localhost:5500
```

Configuration and data are persisted in `~/.sbot` on the host.

---

## Usage

### Web UI

Open `http://localhost:5500` after starting sbot. Use the sidebar to:

- **Models** — add LLM providers (API key, base URL, model name)
- **Agents** — create agents, assign model/tools/skills
- **Sessions** — create chat sessions bound to an agent
- **Chat** — switch sessions, send messages, interrupt running tasks
- **Channels** — configure Lark integrations
- **Scheduler** — view and manage scheduled tasks

### Configure Lark / Feishu

1. Create a bot app in the [Feishu Developer Console](https://open.feishu.cn)
2. Enable **Bot** capability and subscribe to **message.receive** events
3. In Web UI → **Channels**, create a Lark channel and fill in **App ID** and **App Secret**

---

## Features

- **Multiple LLM providers** — OpenAI, Anthropic Claude, Azure OpenAI, Ollama, and any OpenAI-compatible API (Groq, Mistral, DeepSeek, etc.)
- **Multi-agent orchestration** — ReAct mode: a thinking model decomposes tasks and dispatches to specialized sub-agents recursively
- **Long-term memory** — Full extract → evaluate → compress pipeline with vector-embedding semantic search
- **MCP support** — Connect external tool servers via stdio or HTTP/SSE transport
- **Multiple channels** — Web UI, CLI, Lark/Feishu, REST API, WebSocket
- **Built-in tools** — Shell execution, file system, archive operations, binary file read, Python/PowerShell inline execution, cron scheduler
- **Skills** — Installable prompt modules for brainstorming, TDD, code review, multi-agent coordination, and more
- **Flexible config** — Global, per-directory, and per-session overrides from a single `settings.json`

---

## LLM Providers

- **OpenAI** — GPT series models
- **Anthropic** — Claude series models
- **Azure OpenAI** — Azure-hosted deployments
- **Ollama** — Local models (no API key required)
- **OpenAI-compatible APIs** — Groq, Mistral, DeepSeek, and any provider exposing an OpenAI-compatible endpoint

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
- **Retrieval** — Semantic search via vector embeddings (OpenAI, Azure, Ollama)
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
Enterprise IM integration with event deduplication, interactive card support, per-user context preservation, and file/image send and receive.

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
- Read binary files

**Archive**
- Compress and extract archive files
- List archive contents
- Read files directly from within archives

**Scheduler**
- Standard 6-field cron expressions (`second minute hour day month weekday`), persisted across restarts
- Tasks can target a channel user, a web session, or a working directory
- Optional max run count with auto-cleanup
- Manageable via the Web UI or by asking the agent directly

**Ask**
- Agents can pause mid-task and ask the user structured questions
- Supported question types: single-select, multi-select, text input, toggle
- Works across Web UI and Lark; the agent resumes automatically after the user responds

### MCP (Model Context Protocol)

Full MCP support for connecting external tool servers:

- `stdio` transport — child process via stdin/stdout
- `http` transport — remote HTTP/SSE servers
- Global MCP servers shared across agents
- Per-agent MCP server overrides
- Auto-restart on failure

---

## Skills

Skills are self-contained prompt modules that extend agent capabilities for specific domains or workflows:

- Loaded from the global skills directory
- Scoped to individual agents
- Discovered and installed from remote skill hubs (Clawhub, skills.sh, and others)

Bundled skills include workflows for brainstorming, planning, debugging, TDD, code review, multi-agent coordination, and more. A built-in `find-skills` skill lets agents discover available skills at runtime.

---

## Configuration

All configuration lives in a single `settings.json` file. Supports three levels of override:

1. **Global** — applies to all agents and channels
2. **Directory** — per-project override via a local `.sbot/settings.json`
3. **Session** — per-session model, saver, and memory overrides via the web or CLI

Auto-generated example configs are created on first run.

---

## Keywords

`ai agent` `self-hosted` `llm server` `open source` `mcp` `model context protocol` `multi-agent` `react agent` `openai` `claude` `anthropic` `ollama` `chatbot` `lark` `feishu` `long-term memory` `vector search` `typescript` `node.js`
