# Notes (Memory)

Sidebar → **Notes** → New

A note repository is a manually managed recall store for agents. Add durable facts in the Web UI, assign the note repository to sessions/channels, and sbot injects relevant notes into the agent context while also exposing a `note_search` tool for explicit lookup.

## Prerequisites

An embedding model is required first: sidebar → **Embedding Models** → New. See [Models](./models).

## Configuration

| Field | Description |
|-------|-------------|
| Name  | Display name for this notebook |
| Embedding | Embedding model used for semantic search (OpenAI, Google, Ollama, Cohere, VoyageAI) |

## How It Works

1. **Add** — You add chunks from the Notes page in the Web UI; long content can be split automatically
2. **Index** — Each chunk is indexed with the selected embedding model, or BM25 keyword search when no embedding is configured
3. **Recall** — Relevant notes are injected before each turn and can also be searched with `note_search`
4. **Rank** — Results combine semantic/keyword score with time-decay and access-count weighting
5. **Dedup** — Near-duplicate inserts are auto-merged when an embedding model is configured

## Assignment

Notes can be assigned at multiple scopes (most specific wins):

- **Default per agent** — every session/channel using this agent inherits it
- **Per session** — override on the chat session
- **Per channel** — override per channel

## Notes vs Wiki vs Memory

| Concept | Owner | Best for |
|---------|-------|----------|
| [Notes](./note) | Humans / operators | Free-form facts the agent recalls semantically or by keyword |
| [Wiki](./wiki) | Humans / wiki source plugins | Structured knowledge pages with titles + tags |
| [Memory](./memory) | Background MemoryLLM | Distilled long-term knowledge from past conversations |
