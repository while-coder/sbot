# Wiki Knowledge Base

Sidebar → **Wiki** → New

Built-in knowledge base. Create pages manually (title + content + tags) or let the agent auto-extract knowledge from conversations.

## Configuration

| Field | Description |
|-------|-------------|
| Extractor | LLM model for auto-extracting knowledge from conversations |
| Auto-extract | When enabled, the agent extracts valuable knowledge after each reply |
| Shared | Off = per-thread wiki; On = shared across all threads |

## Usage

Assign wikis to a session or channel. Agents can:
- Search wiki pages by keyword
- Read full page content
- Create new pages from conversation context

Auto-extraction requires an extractor model configured in the wiki settings.
