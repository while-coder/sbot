# sbot — Self-hosted AI Agent Server

**English** | [中文](https://github.com/while-coder/sbot/blob/main/README.zh.md)

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open-source, self-hosted AI agent framework.** Modular by design: models, memory, tools, and channels are independent building blocks you mix and match to assemble agents — run on your own server with multi-channel integrations, MCP tool support, and a built-in web UI, no vendor lock-in.

📖 **[Full documentation →](https://while-coder.github.io/sbot/)**

---

## Quick Start

### npm

```bash
# Install
npm install -g @qingfeng346/sbot

# Start (foreground), then open http://localhost:5500
sbot

# Start in the background (survives terminal close)
sbot -d

# Start on a specific port (when 5500 is taken; -p and -d can be combined)
sbot -p 3000
sbot -d -p 3000

# Save the port only, do not start
sbot port 3000
```

Full command reference:

| Command | Description |
|---------|-------------|
| `sbot` | Start the service (foreground) |
| `sbot -d` / `--daemon` | Start in the background (survives terminal close) |
| `sbot -p <port>` / `--port` | Start on the given port, e.g. `sbot -p 3000` |
| `sbot port <port>` | Save the port without starting |
| `sbot stop` | Stop the running service |
| `sbot status` | Show running state, port, auto-start, version, config directory |
| `sbot update` | Update to the latest version (stops the service first if running) |
| `sbot -v` / `--version` | Show version and check for updates |
| `sbot startup enable` | Enable launch at boot |
| `sbot startup disable` | Disable launch at boot |
| `sbot startup status` | Check auto-start status |

<details>
<summary>Permission error on macOS (EACCES)?</summary>

If `npm install -g` fails with `EACCES: permission denied`, **don't fix it with `sudo`** — it leads to tangled file ownership later. The clean fix is to point npm at a directory inside your home folder, so global installs never touch system paths.

**One-liner** (recommended, auto-detects zsh / bash — paste the whole block into your terminal):

```bash
mkdir -p ~/.npm-global && \
npm config set prefix '~/.npm-global' && \
RC_FILE=$([ "${SHELL##*/}" = "bash" ] && echo ~/.bash_profile || echo ~/.zshrc) && \
grep -q '.npm-global/bin' "$RC_FILE" 2>/dev/null || echo 'export PATH=~/.npm-global/bin:$PATH' >> "$RC_FILE" && \
source "$RC_FILE" && \
echo "✓ Done. You can now run: npm install -g @qingfeng346/sbot"
```

**Manual steps** (if you want to understand each step):

```bash
# 1. Create a user-level global directory
mkdir ~/.npm-global

# 2. Point npm to it (so global installs go here instead of system paths)
npm config set prefix '~/.npm-global'

# 3. Add it to your PATH so the shell can find global commands
#    zsh (default on macOS):
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
#    bash:
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bash_profile && source ~/.bash_profile
```

Then re-run `npm install -g @qingfeng346/sbot`.

</details>

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

### Docker Compose

For long-running deployments where you want pinned versions and one-command upgrades. Create `docker-compose.yml`:

```yaml
services:
  sbot:
    image: qingfeng346/sbot
    container_name: sbot
    ports:
      - "5500:5500"
    volumes:
      - ~/.sbot:/root/.sbot
    environment:
      - TZ=Asia/Shanghai
      - LOG_LEVEL=INFO
    restart: unless-stopped
```

Common commands:

```bash
docker compose up -d            # start in background
docker compose logs -f          # follow logs
docker compose down             # stop & remove container (data stays in ~/.sbot)
docker compose pull && docker compose up -d   # upgrade to latest image
```

---

## Features

- **Modular composition** — Models, memory, tools, channels, and skills are independent building blocks you mix and match to assemble agents
- **One-command deployment** — `npm install -g` or `docker run`, native cross-platform with no extra system dependencies
- **Full Web UI management** — All configuration done in the browser, no manual file editing required
- **Multiple LLM providers** — OpenAI, Anthropic Claude, Google Gemini, Ollama, and any OpenAI-compatible API (Azure OpenAI, Groq, Mistral, DeepSeek, etc.); automatic retry with exponential backoff on transient failures
- **Multi-agent orchestration** — Single, ReAct (recursive task decomposition), and Generative (multimodal) modes; agents can be nested and composed
- **ACP agent support** — Agent Client Protocol integration with persistent and transient agent modes
- **Knowledge base** — Built-in wiki system with hybrid keyword + semantic search, referenced by agents during conversations
- **Long-term memory** — Vector-embedding semantic search for persistent context recall (OpenAI, Google, Ollama, Cohere, VoyageAI)
- **Conversation compaction** — Automatic conversation summarization when token usage exceeds threshold, preserving continuity while reducing consumption
- **Memory** — Per-agent automatic long-term memory: a background MemoryLLM distills durable knowledge after each conversation idles, read back via `search_memory` / `read_memory` with consolidate/reconcile maintenance
- **Agenda** — Conversation-driven reminders, schedules, and routines with absolute / interval / cron triggers; optionally synced from the conversation after every turn and delivered to any session or channel
- **Heartbeat** — Configurable periodic self-activation lets agents run scheduled prompts proactively across any channel
- **MCP tools** — Standard MCP protocol (stdio/SSE), connect to any MCP tool ecosystem; per-agent and global servers with auto-restart
- **Multiple channels** — Web UI, CLI, Lark/Feishu, Slack, WeCom, WeChat, DingTalk, QQ (official bot), OneBot (v11 reverse WebSocket), XiaoAI, REST API, WebSocket
- **Built-in tools** — Shell execution, file system, archive operations, media file read, Python/PowerShell inline execution, web fetch/download, cron scheduler, todo, ask
- **Skills** — Installable prompt modules with remote install from Clawhub, skills.sh, and skillhub.cn
- **Agent Store** — Browse and install pre-packaged agents (model + prompt + tools + skills + MCP servers) from configurable sources
- **Token usage tracking** — Per-model consumption statistics, model response caching with hit/miss metrics
- **Unattended-session safety** — Configurable approval and ask timeouts on channels for autonomous operation
- **Flexible config** — Global and per-session overrides from a single `settings.json`; customizable prompts with hot reload

---

## Documentation

Full guide, with step-by-step setup and per-feature reference, lives at
**[while-coder.github.io/sbot](https://while-coder.github.io/sbot/)**:

- **Get started** — [Getting Started](https://while-coder.github.io/sbot/guide/getting-started) · [Features](https://while-coder.github.io/sbot/guide/features)
- **Models & agents** — [Models](https://while-coder.github.io/sbot/guide/models) · [Agents](https://while-coder.github.io/sbot/guide/agents) · [Agent Store](https://while-coder.github.io/sbot/guide/agent-store)
- **Storage & knowledge** — [Savers](https://while-coder.github.io/sbot/guide/savers) · [Notes](https://while-coder.github.io/sbot/guide/note) · [Wiki](https://while-coder.github.io/sbot/guide/wiki)
- **Automation** — [Memory](https://while-coder.github.io/sbot/guide/memory) · [Agenda](https://while-coder.github.io/sbot/guide/agenda) · [Heartbeat](https://while-coder.github.io/sbot/guide/heartbeat)
- **Tools & skills** — [Built-in Tools](https://while-coder.github.io/sbot/guide/tools) · [MCP Tools](https://while-coder.github.io/sbot/guide/mcp) · [Skills](https://while-coder.github.io/sbot/guide/skills)
- **Channels** — [Channels](https://while-coder.github.io/sbot/guide/channels) (Lark/Feishu · Slack · WeCom · WeChat · DingTalk · QQ · OneBot · XiaoAI)

---

## Keywords

`ai agent` `self-hosted` `llm server` `open source` `mcp` `acp` `model context protocol` `multi-agent` `react agent` `openai` `claude` `anthropic` `gemini` `ollama` `chatbot` `lark` `feishu` `onebot` `qq` `long-term memory` `vector search` `typescript` `node.js`
