# Built-in Tools

## Command Execution

- Shell commands and scripts
- Inline Python and PowerShell execution
- File-referenced script execution
- Configurable timeout per command

## File System

- Read, write, edit files
- Search with regex (grep)
- Find files by pattern (glob)
- Directory listing, create, remove, move, copy
- Read media files (images, etc.)

## Archive

- Compress and extract archive files
- List archive contents
- Read files directly from within archives

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
