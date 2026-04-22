# sbot — Self-hosted AI Agent Server

**English** | [中文](https://github.com/while-coder/sbot/blob/main/README.zh.md)

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open-source, self-hosted AI agent framework.** Run LLM-powered agents on your own server with persistent memory, multi-channel integrations, MCP tool support, and a built-in web UI — no vendor lock-in.

| Chat | Image Generation | Models |
|:---:|:---:|:---:|
| ![Chat](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-chat.png) | ![Image Generation](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-image.png) | ![Models](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-models.png) |

| Agents | Channels | MCP Tools |
|:---:|:---:|:---:|
| ![Agents](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-agents.png) | ![Channels](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-channels.png) | ![MCP Tools](https://raw.githubusercontent.com/while-coder/sbot/main/docs/screenshot-tools.png) |

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

## Features

- **Multiple LLM providers** — OpenAI, Anthropic Claude, Google Gemini, Ollama, and any OpenAI-compatible API (Azure OpenAI, Groq, Mistral, DeepSeek, etc.). Each model has its own API key, base URL, temperature, and token limits.
- **Multi-agent orchestration** — ReAct mode: a thinking model decomposes tasks and dispatches to specialized sub-agents recursively; Generative mode: multimodal content generation
- **Knowledge base** — Built-in wiki system with document storage, automatic extraction, and semantic search; agents can reference wiki content during conversations
- **Long-term memory** — Full extract → compress pipeline with vector-embedding semantic search
- **MCP support** — Connect external tool servers via stdio or HTTP/SSE transport
- **Multiple channels** — Web UI, CLI, Lark/Feishu, Slack, WeCom, REST API, WebSocket
- **Built-in tools** — Shell execution, file system, archive operations, media file read, Python/PowerShell inline execution, cron scheduler, todo tasks
- **Skills** — Installable prompt modules for brainstorming, TDD, code review, multi-agent coordination, and more
- **Flexible config** — Global, per-directory, and per-session overrides from a single `settings.json`

---

## Usage Guide

Open `http://localhost:5500` after starting sbot. Follow these steps:

**1. Add a Model** — sidebar → **Models** → New

Fill in provider, API key, base URL, and model name. Supported providers: OpenAI, Anthropic, Google Gemini, Ollama, and any OpenAI-compatible endpoint (Azure OpenAI, Groq, Mistral, DeepSeek, etc.).

---

**2. Create a Saver** — sidebar → **Savers** → New

Choose a backend for storing conversation history:

| Backend | Description |
|---|---|
| Memory | In-process only, no disk writes |
| SQLite | Local SQLite database per saver instance (recommended) |
| PostgreSQL | External database for production deployments |
| File | JSON files per conversation thread |

---

**3. Create an Agent** — sidebar → **Agents** → New

Choose a mode:
- **Single** — select a model, write a system prompt, optionally attach MCP tools and skills
- **ReAct** — select a think model, then add sub-agents (each with an id and description for task dispatch). The think model decomposes tasks and dispatches sub-tasks recursively; each sub-agent has read-only access to shared memory
- **Generative** — select a multimodal model for mixed text and image content generation

→ [MCP Tools](#add-mcp-tools) · [Skills](#manage-skills)

---

**4. Start chatting** — choose your entry point

- **Session** — sidebar → **Chat** → New Session, select agent + saver + memory
- **Directory** — sidebar → **Directory**, register a local path, then configure agent/saver/memory for it
- **Channel** (IM) — sidebar → **Channels** → New → [Channel Setup](#channel-setup)

---

**5. (Optional) Enable Memory** — sidebar → **Memories** → New

Requires an embedding model first (sidebar → **Embeddings** → New). Then assign the memory to a session, directory, or channel.

| Field | Description |
|-------|-------------|
| Mode | `read_only` / `human_only` (user messages) / `human_and_ai` (full conversation) |
| Max age (days) | Auto-expire memories after N days |
| Embedding | Embedding model for semantic search (OpenAI, Azure, Ollama) |
| Extractor | Extracts key facts from conversation |
| Compressor | Merges similar memories to reduce redundancy |
| Shared | Off = per-thread memory; On = shared across all threads |

---

### Add MCP Tools

Sidebar → **MCP** → New

Add a server:
- **stdio** — command + args (e.g. `npx -y some-mcp-package`)
- **http** — remote URL + optional headers

Supports global servers shared across all agents and per-agent overrides. Servers auto-restart on failure. Then open an agent → MCP tab to attach the servers you want it to use.

---

### Manage Skills

Sidebar → **Skills**

Skill files (Markdown) are stored in `~/.sbot/skills/`. Install them from the Skills page or drop files manually. In an agent → Skills tab, select specific skills to load, or leave empty to load all.

Built-in skills: `brainstorming`, `planning`, `debugging`, `tdd`, `code-review`, `multi-agent`. Use the `find-skills` skill to discover and install from remote hubs (Clawhub, skills.sh).

---

### Customize Prompts

Sidebar → **Prompts**

View and edit any built-in prompt. Saved overrides are stored in `~/.sbot/prompts/` and take precedence over the defaults.

| Prompt | Purpose |
|--------|---------|
| `system/init.txt` | Prepended to all agents' system prompt |
| `skills/system.txt` | Skills subsystem prompt template |
| `agent/react_system.txt` | ReAct think node system prompt |
| `agent/react_subnode.txt` | ReAct sub-agent task prompt template |

Prompts support `{varName}` placeholders substituted at runtime.

---

### Channel Setup

In **Channels → New**, select the type and fill in the credentials, then assign agent + saver + memory. Every user/group chat is isolated automatically.

| Type | Required fields |
|------|----------------|
| Lark / Feishu | App ID, App Secret |
| Slack | Bot Token (`xoxb-...`), App Token (`xapp-...`) |
| WeCom | Bot ID, Secret |
| WeChat | QR code login (credentials auto-populated) |

**Setting up Lark / Feishu:**
1. Create a bot app in the [Feishu Developer Console](https://open.feishu.cn) (or [Lark Developer Console](https://open.larksuite.com/) for international)
2. Enable **Bot** capability
3. Grant the following permissions under **Permissions & Scopes** (or use **Batch Import** with the JSON below):

| Permission | Description |
|------------|-------------|
| `im:message:send_as_bot` | Send messages as bot |
| `im:message.p2p_msg:readonly` | Receive direct messages |
| `im:message.group_at_msg:readonly` | Receive group @bot messages |
| `im:message.group_msg` | Receive all group messages |
| `im:message:readonly` | Read message content |
| `im:chat:readonly` | Read chat/group info |
| `im:resource` | Read files and images in messages |
| `contact:user.base:readonly` | Read basic user info |
| `contact:contact.base:readonly` | Read basic contact info |

<details>
<summary>Batch import JSON</summary>

```json
{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "im:chat:readonly",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": []
  }
}
```

</details>

4. Under **Events & Callbacks**, set the subscription mode to **Long Connection**
5. In Web UI → **Channels**, create a Lark channel and fill in **App ID** and **App Secret**

Supports event deduplication, interactive cards, per-user context isolation, and file/image send and receive.

**Setting up WeCom:**
1. Create an AI app in the [WeCom Admin Console](https://work.weixin.qq.com) and obtain the **Bot ID** and **Secret**
2. In Web UI → **Channels**, create a WeCom channel and fill in Bot ID and Secret

Connects via WebSocket for real-time messaging, with file and image support.

**Setting up WeChat:**
1. In Web UI → **Channels**, create a WeChat channel
2. Click QR login and scan the code with WeChat to authenticate
3. Credentials are saved automatically once authenticated, and the channel goes live immediately

WeChat integration connects via the iLink Bot API, with file and image support.

---

## Built-in Tools

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
- Read media files (images, etc.)

**Archive**
- Compress and extract archive files
- List archive contents
- Read files directly from within archives

**Scheduler**
- Standard 6-field cron expressions (`second minute hour day month weekday`), persisted across restarts
- Tasks can target a channel user, a web session, or a working directory
- Optional max run count with auto-cleanup
- Manageable via the Web UI or by asking the agent directly

**Todo**
- Agents can create, complete, and query todo tasks
- Web UI provides a Todo management page

**Ask**
- Agents can pause mid-task and ask the user structured questions
- Supported question types: single-select, multi-select, text input
- Works across Web UI and Lark; the agent resumes automatically after the user responds

---

## Keywords

`ai agent` `self-hosted` `llm server` `open source` `mcp` `model context protocol` `multi-agent` `react agent` `openai` `claude` `anthropic` `ollama` `chatbot` `lark` `feishu` `long-term memory` `vector search` `typescript` `node.js`
