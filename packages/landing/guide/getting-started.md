# Getting Started

## npm

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

## Docker

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

## First Steps

Open `http://localhost:5500` after starting sbot, then:

1. **Add a Model** — sidebar → **Models** → New
2. **Create a Saver** — sidebar → **Savers** → New
3. **Create an Agent** — sidebar → **Agents** → New
4. **Start chatting** — sidebar → **Chat** → New Session
