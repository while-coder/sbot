# Savers (Chat Storage)

Sidebar → **Chat Storage** → New

A Saver is the storage backend for conversation history — every chat session and channel must reference one. Pick a backend that matches the lifetime and durability you want.

## Backends

| Backend | Description | Best for |
|---------|-------------|----------|
| **File** | One JSON file per conversation thread under `~/.sbot/savers/<saver-id>/` | Default choice; durable, easy to inspect or back up |
| **SQLite** | Single SQLite database file | Many concurrent threads, faster searches |
| **Memory** | In-process, cleared when the session ends | One-off Q&A, stateless assistants |

## Configuration

| Field | Description |
|-------|-------------|
| Name | Display name |
| Type | `File` / `SQLite` / `Memory` |
| Path | Storage location for File / SQLite (defaults to `~/.sbot/savers/<id>/`) |

## Conversation Compaction

When a conversation exceeds a configurable token threshold, sbot automatically summarizes earlier messages and replaces them with a compact recap — preserving continuity while keeping per-turn token cost bounded. This compaction is independent of the saver backend; the full untrimmed transcript stays on disk while the agent sees only the active window.

## Assignment

Savers are picked per-session or per-channel. The same Saver can be reused across many sessions — each conversation thread is stored independently.

## Tips

- For a personal assistant you'll come back to: use **File**
- For a high-volume IM channel: use **SQLite**
- For an "ask once and forget" REST integration: use **Memory**
