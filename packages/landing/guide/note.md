# Notes

Sidebar → **Notes** → New

A note repository lets agents recall content across conversations using vector-embedding semantic search. It is a manually-curated knowledge store — drop chunks of text in, retrieve them later by semantic similarity.

## Prerequisites

An embedding model is required first: sidebar → **Embeddings** → New.

## Configuration

| Field | Description |
|-------|-------------|
| Name  | Display name |
| Embedding | Embedding model for semantic search (OpenAI, Azure, Ollama) |

## How It Works

1. **Add** — Insert a chunk of text via the admin UI or `note_search` tool
2. **Embed** — Each chunk is converted to a vector
3. **Search** — Relevant notes are retrieved via semantic similarity (with time-decay scoring)
4. **Dedup** — Near-duplicate inserts are auto-merged
