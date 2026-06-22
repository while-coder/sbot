# Wiki Knowledge Base

Sidebar → **Knowledge (Docs)** → New

A Wiki is a structured, human-curated knowledge base of pages (title + content + tags). Agents can search, read, write, and update pages via built-in tools — making it a great fit for project documentation, runbooks, FAQs, and team-shared references.

## Configuration

| Field | Description |
|-------|-------------|
| Name | Wiki identifier |
| Embedding | Optional — when set, enables hybrid keyword + semantic search; without it, falls back to keyword-only search |

## How It Works

Pages are indexed by:

1. **Keyword** (always available) — title + content + tags full-text match
2. **Semantic** (when embedding configured) — vector similarity for fuzzy/concept queries

Both signals are merged at query time, so an agent searching for "deploy steps" matches both an exact-title hit and a semantically-related "release procedure" page.

## Agent Tools

Once a Wiki is assigned to a session/channel, the agent automatically gets:

- `wiki_search` — query by keyword and/or semantic similarity
- `wiki_read` — read a full page by id
- `wiki_create` — add a new page (title, content, tags)
- `wiki_update` — patch an existing page
- `wiki_delete` — remove a page

## Assignment

Wikis can be assigned at multiple scopes (most specific wins):

- **Default per agent** — every session/channel using this agent inherits it
- **Per session** — override on the chat session
- **Per channel** — override per channel

## Wiki vs Notes vs Memory

See [Notes](./note#notes-vs-wiki-vs-memory) for a comparison table.
