# Built-in Tools

These tools are available to every agent without any configuration. Toggle them per-agent in the agent edit page.

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

- Compress and extract archive files (zip, tar, gz, etc.)
- List archive contents
- Read files directly from within archives

## Web

- Fetch URLs and convert HTML to clean Markdown
- Download files from the web

## Scheduler

- Standard 6-field cron expressions (`second minute hour day month weekday`)
- Persisted across restarts
- Tasks can target a channel user, a web session, or a working directory
- Optional max run count with auto-cleanup
- Manageable via the Web UI or by asking the agent directly

## Todo

- Agents can create, complete, and query todo tasks
- Web UI provides a Todo management page

## Ask

- Agents can pause mid-task and ask the user structured questions
- Supported question types: single-select, multi-select, text input
- Works across Web UI and Lark; the agent resumes automatically after the user responds

## Knowledge & Memory

When [Notes](./note), [Wiki](./wiki), [Memory](./memory), or [Agenda](./agenda) is enabled for the session/channel, the agent automatically gets the matching tools:

- **Notes / Wiki** — read, write, search, and update entries
- **Memory** — `search_memory` / `read_memory` to recall background-extracted long-term memories
- **Agenda** — `agenda_create` / `agenda_list` / `agenda_update` / `agenda_complete` / `agenda_cancel` / `agenda_trigger` to manage reminders and schedules
