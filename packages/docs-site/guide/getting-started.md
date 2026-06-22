# Getting Started

## Install via npm

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

### Command Reference

| Command | Description |
|---------|-------------|
| `sbot` | Start the service (foreground) |
| `sbot -d` / `--daemon` | Start in the background (survives terminal close) |
| `sbot -p <port>` / `--port` | Start on the given port, e.g. `sbot -p 3000` |
| `sbot port <port>` | Save the port without starting |
| `sbot stop` | Stop the running service |
| `sbot status` | Show running state, port, auto-start, version, config directory |
| `sbot -v` / `--version` | Show version and check for updates |
| `sbot startup enable` | Enable launch at boot |
| `sbot startup disable` | Disable launch at boot |
| `sbot startup status` | Check auto-start status |

### Permission error on macOS (EACCES)?

If `npm install -g` fails with `EACCES: permission denied`, **don't fix it with `sudo`** — it leads to tangled file ownership later. The clean fix is to point npm at a directory inside your home folder.

```bash
mkdir -p ~/.npm-global && \
npm config set prefix '~/.npm-global' && \
RC_FILE=$([ "${SHELL##*/}" = "bash" ] && echo ~/.bash_profile || echo ~/.zshrc) && \
grep -q '.npm-global/bin' "$RC_FILE" 2>/dev/null || echo 'export PATH=~/.npm-global/bin:$PATH' >> "$RC_FILE" && \
source "$RC_FILE" && \
echo "Done. You can now run: npm install -g @qingfeng346/sbot"
```

Then re-run `npm install -g @qingfeng346/sbot`.

## Install via Docker

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

## First Steps

Open `http://localhost:5500` after starting sbot. Follow these steps in order:

1. **Add a Model** — sidebar → **Language Models** → New. See [Models](./models)
2. **Create a Saver** — sidebar → **Chat Storage** → New. See [Savers](./savers)
3. **Create an Agent** — sidebar → **Agent Management** → New. See [Agents](./agents)
4. **Start chatting** — sidebar → **Chat** → New Session

Optional next steps:

- **Connect a channel** — sidebar → **Channels** for Lark/Slack/WeCom/WeChat/DingTalk/QQ/OneBot/XiaoAI. See [Channels](./channels)
- **Enable Wiki** — long-term knowledge base. See [Wiki](./wiki)
- **Enable Notes** — vector-recall memory. See [Notes](./note)
- **Enable Memory** — automatic long-term memory extracted by a background MemoryLLM. See [Memory](./memory)
- **Enable Agenda** — conversation-driven reminders / schedules. See [Agenda](./agenda)
- **Install pre-built agents** — sidebar → **Agent Store**. See [Agent Store](./agent-store)
