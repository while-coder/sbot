# Wiki Knowledge Base

Sidebar → **Knowledge (Docs)** → New

A Wiki is a structured knowledge base of pages (title + content + tags). Agents can search and read assigned wikis during conversations, while the Web UI manages writable sources such as local files. This makes it a good fit for project documentation, runbooks, FAQs, and team-shared references.

## Configuration

| Field | Description |
|-------|-------------|
| Name | Wiki identifier |
| Source Type | Data source plugin, such as local files or Google Drive |
| Source Config | Extra fields required by the selected source |
| Embedding | Optional — when set, enables hybrid keyword + semantic search; without it, falls back to keyword-only search |

## Data Sources

Wiki sources are plugin-based:

- **Local files** — the default writable source; pages are stored as Markdown under the wiki cache directory
- **Google Drive** — a read-only source that treats a Drive folder as a wiki directory and exports Docs/Sheets/Slides into readable text
- **Third-party plugins** — additional wiki providers can be loaded through the plugin system

Read-only sources hide page creation, editing, and deletion in the Web UI.

## How It Works

Pages are indexed by:

1. **Keyword** (always available) — title + content + tags full-text match
2. **Semantic** (when embedding configured) — vector similarity for fuzzy/concept queries

Both signals are merged at query time, so an agent searching for "deploy steps" matches both an exact-title hit and a semantically-related "release procedure" page.

## Agent Tools

Once a Wiki is assigned to a session/channel, the agent automatically gets:

- `wiki_search` — query by keyword and/or semantic similarity
- `wiki_read` — read a full page by id

Page creation, editing, and deletion are managed from the Wiki page in the Web UI for writable sources.

## Assignment

Wikis can be assigned at multiple scopes (most specific wins):

- **Default per agent** — every session/channel using this agent inherits it
- **Per session** — override on the chat session
- **Per channel** — override per channel

## Wiki vs Notes vs Memory

See [Notes](./note#notes-vs-wiki-vs-memory) for a comparison table.
