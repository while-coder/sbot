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

## Usage Guide

Open `http://localhost:5500` after starting sbot. Follow these steps:

**1. Add a Model** — sidebar → **Models** → New

Fill in provider, API key, base URL, and model name. Supported providers: OpenAI, Anthropic, Azure OpenAI, Ollama, and any OpenAI-compatible endpoint (Groq, Mistral, DeepSeek, etc.).

---

**2. Create a Saver** — sidebar → **Savers** → New

Choose `sqlite` (recommended) or `file`. The saver controls how conversation history is persisted.

---

**3. Create an Agent** — sidebar → **Agents** → New

Choose a mode:
- **Single** — select a model, write a system prompt, optionally attach MCP tools and skills
- **ReAct** — select a think model, then add sub-agents (each with an id and description for task dispatch)

→ [MCP Tools](#mcp-tools) · [Skills](#skills)

---

**4. Start chatting** — choose your entry point

- **Session** — sidebar → **Chat** → New Session, select agent + saver + memory
- **Directory** — sidebar → **Directory**, register a local path, then configure agent/saver/memory for it
- **Channel** (IM) — sidebar → **Channels** → New → [Channel Setup](#channel-setup)

---

**5. (Optional) Enable Memory** — sidebar → **Memories** → New

Requires an embedding model first (sidebar → **Embeddings** → New). Then assign the memory to a session, directory, or channel.
→ [Memory Options](#memory-options)

---

**6. (Optional) Add MCP Tools** — sidebar → **MCP** → New

Add stdio or HTTP tool servers. Then open an agent and attach them under the MCP tab.
→ [MCP Tools](#mcp-tools)

---

**7. (Optional) Manage Skills** — sidebar → **Skills**

Install or remove prompt modules. Assign specific skills to an agent under the Skills tab, or leave unset to load all.
→ [Skills](#skills)

---

**8. (Optional) Customize Prompts** — sidebar → **Prompts**

Override any built-in prompt. Changes take effect immediately without restart.
→ [Prompts](#prompts)

---

### Channel Setup

In **Channels → New**, select the type and fill in the credentials, then assign agent + saver + memory. Every user/group chat is isolated automatically.

| Type | Required fields |
|------|----------------|
| Lark / Feishu | App ID, App Secret |
| Slack | Bot Token (`xoxb-...`), App Token (`xapp-...`) |
| WeCom | Bot ID, Secret |

---

### Memory Options

In **Memories → New**, configure the pipeline components:

| Field | Description |
|-------|-------------|
| Mode | `read_only` / `human_only` (user messages) / `human_and_ai` (full conversation) |
| Max age (days) | Auto-expire memories after N days |
| Embedding | Embedding model for semantic search |
| Evaluator | Scores memory importance (0–1) |
| Extractor | Extracts key facts from conversation |
| Compressor | Merges similar memories to reduce redundancy |
| Shared | Off = per-thread memory; On = shared across all threads |

---

### MCP Tools

In **MCP → New**, add a server:
- **stdio** — command + args (e.g. `npx -y some-mcp-package`)
- **http** — remote URL + optional headers

Then open an agent → MCP tab to attach the servers you want it to use.

---

### Skills

Skill files (Markdown) are stored in `~/.sbot/skills/`. You can install them from the Skills page or drop files manually.

In an agent → Skills tab, select specific skills to load, or leave empty to load all. Built-in skills include: `brainstorming`, `planning`, `debugging`, `tdd`, `code-review`, `multi-agent`. Use the `find-skills` skill to discover and install from remote hubs (Clawhub, skills.sh).

---

### Prompts

In **Prompts**, you can view and edit any built-in prompt. Saved overrides are stored in `~/.sbot/prompts/` and take precedence over the defaults.

| Prompt | Purpose |
|--------|---------|
| `system/init.txt` | Prepended to all agents' system prompt |
| `skills/system.txt` | Skills subsystem prompt template |
| `agent/react_system.txt` | ReAct think node system prompt |
| `agent/react_subnode.txt` | ReAct sub-agent task prompt template |

Prompts support `{varName}` placeholders substituted at runtime.

---

## Keywords

`ai agent` `self-hosted` `llm server` `open source` `mcp` `model context protocol` `multi-agent` `react agent` `openai` `claude` `anthropic` `ollama` `chatbot` `lark` `feishu` `long-term memory` `vector search` `typescript` `node.js`
