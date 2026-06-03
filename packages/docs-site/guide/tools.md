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

## Notes & Wiki

When a [Notes](./note) or [Wiki](./wiki) is assigned to the session/channel, the agent automatically gets matching tools to read, write, search, and update entries.
