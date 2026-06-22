# Notes (Memory)

Sidebar → **Notes** → New

A note repository is the agent's long-term memory: a vector store the agent can write to and search via tool calls. Use it to recall facts across conversations — user preferences, project context, prior decisions — without bloating the system prompt.

## Prerequisites

An embedding model is required first: sidebar → **Embedding Models** → New. See [Models](./models).

## Configuration

| Field | Description |
|-------|-------------|
| Name  | Display name for this notebook |
| Embedding | Embedding model used for semantic search (OpenAI, Google, Ollama, Cohere, VoyageAI) |

## How It Works

1. **Add** — The agent inserts text via the `note_add` tool, or you add chunks manually in the UI
2. **Embed** — Each chunk is converted to a vector
3. **Search** — On retrieval, relevant notes are ranked by semantic similarity with **time-decay weighting** (recent entries score higher)
4. **Dedup** — Near-duplicate inserts are auto-merged so the store doesn't bloat

## Assignment

Notes can be assigned at multiple scopes (most specific wins):

- **Default per agent** — every session/channel using this agent inherits it
- **Per session** — override on the chat session
- **Per channel** — override per channel

## Notes vs Wiki vs Memory

| Concept | Owner | Best for |
|---------|-------|----------|
| [Notes](./note) | Agent (auto-write) | Free-form facts the agent recalls semantically |
| [Wiki](./wiki) | Human-curated (with optional embeddings) | Structured knowledge pages with titles + tags |
| [Memory](./memory) | Background MemoryLLM | Distilled long-term knowledge from past conversations |
