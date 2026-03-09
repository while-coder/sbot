# sbot-cli Design Document

**Date:** 2026-03-09
**Project:** `E:\WMTools\sbot-cli`
**Status:** Approved

---

## Overview

A terminal TUI CLI tool that connects to a local sbot AI server (`http://127.0.0.1:5500`) and provides an interactive chat interface. Built with TypeScript + React + Ink, following the patterns established in `E:\WMTools\winning.code`.

---

## Architecture

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict, ES modules) |
| UI Framework | React 18 |
| Terminal Renderer | Ink 5 |
| Build | tsc |
| Dev | tsx |

### Directory Structure

```
E:\WMTools\sbot-cli/
├── src/
│   ├── config/
│   │   └── localConfig.ts        # Read/write .sbot/settings.json in CWD
│   ├── api/
│   │   └── sbotClient.ts         # HTTP client: GET /api/settings, POST /api/chat (SSE)
│   ├── ui/
│   │   ├── components/
│   │   │   ├── InputPrompt.tsx    # Multi-line input (Shift+Enter for newline)
│   │   │   ├── MessageList.tsx   # Scrollable chat history
│   │   │   ├── ToolCallItem.tsx  # Collapsible tool_call display
│   │   │   ├── StreamMessage.tsx # Real-time streaming text
│   │   │   └── SetupWizard.tsx   # First-run agent/saver/memory selector
│   │   ├── hooks/
│   │   │   ├── useChat.ts        # SSE stream management, message state
│   │   │   └── useKeypress.ts    # Global keypress pub-sub (from winning.code pattern)
│   │   ├── App.tsx
│   │   └── colors.ts
│   └── main.tsx                  # Entry: check local config → wizard or chat
├── package.json                  # bin: { "sbot-cli": "dist/main.js" }
├── tsconfig.json
└── docs/
    └── plans/
        └── 2026-03-09-sbot-cli-design.md
```

---

## Startup Flow

```
Launch sbot-cli
    │
    ▼
Read CWD/.sbot/settings.json
    │
    ├─ Exists ──→ Enter chat mode directly (show session info in header)
    │
    └─ Not found ──→ Check sbot online (GET /api/settings)
                        │
                        ├─ Offline ──→ Show error, exit
                        │
                        └─ Online ──→ Run Setup Wizard (TUI)
                                        Step 1: Select Agent   (arrow keys)
                                        Step 2: Select Saver   (arrow keys)
                                        Step 3: Select Memory  (arrow keys, "none" option)
                                            │
                                            ▼
                                        POST /api/settings/sessions
                                        { name: "cli-<uuid>", agentName, saverName, memoryName }
                                            │
                                            ▼
                                        Save to CWD/.sbot/settings.json
                                        { sessionId, baseUrl, agentName, saverName, memoryName }
                                            │
                                            ▼
                                        Enter chat mode
```

### Local Config Format (`CWD/.sbot/settings.json`)

```json
{
  "sessionId": "cli-<uuid>",
  "baseUrl": "http://127.0.0.1:5500",
  "agentName": "my-agent",
  "saverName": "saver-sqlite",
  "memoryName": "memory-1"
}
```

---

## Chat Data Flow (SSE)

```
User presses Enter
    │
    ▼
POST /api/chat  { query, sessionId }
    │
    ├─ data: { type: "stream", content: "..." }   → Append to current message (real-time)
    ├─ data: { type: "tool_call", name, args }    → Insert collapsible ToolCallItem
    ├─ data: { type: "message", role, content }  → Complete message (non-streaming)
    ├─ data: { type: "error", message }           → Show error message
    └─ data: { type: "done" }                     → End stream, restore input
```

---

## TUI Layout

```
┌─ sbot-cli ──────────────────────────────────────────────┐
│ Session: cli-abc123  Agent: my-agent  Saver: sqlite      │  ← Header
├──────────────────────────────────────────────────────────┤
│                                                          │
│  You: 帮我写一个 Python 排序函数                           │  ← Message History
│                                                          │     (scrollable)
│  Assistant: 好的，以下是...                               │
│                                                          │
│  ▶ [tool_call] read_file { path: "..." }  ← collapsed    │
│    ▼ expanded shows full args/result                     │
│                                                          │
│  Assistant: 这里是完整代码...                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ > Your message (Shift+Enter for newline)                  │  ← Input
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Enter send  Ctrl+C cancel/exit  Ctrl+L clear  Tab fold   │  ← Footer
└──────────────────────────────────────────────────────────┘
```

### Key Bindings

| Key | Behavior |
|-----|----------|
| `Enter` | Send message |
| `Shift+Enter` | Insert newline in input |
| `Ctrl+C` | While streaming: cancel request; while idle: exit |
| `Ctrl+L` | Clear screen history |
| `↑/↓` (empty input) | Scroll message history |
| `↑/↓` (with input) | Navigate input history |
| `Tab` | Toggle fold/unfold tool_call under cursor |

### tool_call Display

```
▶ [tool_call] read_file          ← collapsed (default)
▼ [tool_call] read_file          ← expanded (Tab to toggle)
  args: { "path": "/foo/bar.ts" }
```

---

## API Reference

### sbot Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/settings` | GET | Fetch agents, savers, memories for wizard |
| `/api/settings/sessions` | POST | Create new session binding |
| `/api/chat` | POST | Send message, receive SSE stream |

### Chat Request

```json
{
  "query": "User message text",
  "sessionId": "cli-<uuid>"
}
```

### SSE Events

```typescript
{ type: 'stream',    content: string }
{ type: 'message',  role: string, content: string, tool_calls?: any[] }
{ type: 'tool_call', name: string, args: object }
{ type: 'error',    message: string }
{ type: 'done' }
```

---

## Package Configuration

```json
{
  "name": "sbot-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sbot-cli": "dist/main.js" },
  "scripts": {
    "dev": "tsx src/main.tsx",
    "build": "tsc",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "react": "^18.3.1",
    "ink": "^5.1.0",
    "ink-spinner": "^5.0.0",
    "chalk": "^5.3.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "@types/react": "^18.3.0",
    "@types/node": "^22.0.0",
    "rimraf": "^6.0.0"
  }
}
```
