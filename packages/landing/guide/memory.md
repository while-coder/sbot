# Memory

Sidebar → **Memories** → New

Long-term memory enables agents to remember context across conversations using vector-embedding semantic search.

## Prerequisites

An embedding model is required first: sidebar → **Embeddings** → New.

## Configuration

| Field | Description |
|-------|-------------|
| Mode | `read_only` / `human_only` (user messages) / `human_and_ai` (full conversation) |
| Max age (days) | Auto-expire memories after N days |
| Embedding | Embedding model for semantic search (OpenAI, Azure, Ollama) |
| Extractor | Extracts key facts from conversation |
| Compressor | Merges similar memories to reduce redundancy |
| Shared | Off = per-thread memory; On = shared across all threads |

## How It Works

1. **Extract** — Key facts are extracted from conversations
2. **Embed** — Facts are converted to vector embeddings
3. **Search** — Relevant memories are retrieved via semantic similarity
4. **Compress** — Similar memories are merged over time to reduce noise
