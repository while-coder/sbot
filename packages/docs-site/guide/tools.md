# Built-in Tools

These tools are available as built-in providers without installing external packages. Toggle them per-agent in the agent edit page; a few tools also depend on the current saver or channel context.

## Command Execution

- Shell commands and scripts (bash / pwsh / cmd)
- Inline Python and PowerShell execution
- File-referenced script execution
- Configurable timeout per command

## File System

- Read, write, edit files
- Search with regex (grep)
- Find files by pattern (glob)
- Directory listing, create, remove, move, copy
- Read media files (images, etc.)
- Optional read-only mode per agent

## Archive

- Create and extract ZIP archives
- List ZIP contents
- Read files directly from within ZIP archives

## Web

- Fetch URLs and convert HTML to clean Markdown
- Download files from the web

## Sleep

- Pause execution for a bounded number of seconds
- Useful when an agent needs to wait for an external process, file, or service

## Session Search

- Search previous conversation history when the active Saver supports archive search
- Match multiple keyword groups and return compact previews with role and timestamp

## Channel Tools

- List configured channels, channel sessions, and known users
- Send a message to another channel session or user from an agent workflow

## Built-in MCP Presets

The MCP page also lists built-in presets such as Playwright, Markitdown, and Exa. They are configured like MCP servers rather than local tools, so enable them from [MCP Tools](./mcp) or the agent's MCP tab.

## Knowledge & Memory

When [Notes](./note), [Wiki](./wiki), [Memory](./memory), or [Agenda](./agenda) is enabled for the session/channel, the agent automatically gets the matching tools:

- **Notes** — `note_search` to recall vector-indexed notes
- **Wiki** — `wiki_search` / `wiki_read` to search and read assigned wiki pages
- **Memory** — `search_memory` / `read_memory` to recall background-extracted long-term memories
- **Agenda** — `agenda_create` / `agenda_list` / `agenda_update` / `agenda_complete` / `agenda_cancel` / `agenda_trigger` to manage reminders and schedules
