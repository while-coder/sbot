This release includes the following main changes:

### Added

1. Added `sbot update`, which updates sbot to the latest version and stops the running service first when needed.
2. Added more built-in chat commands, including `/status`, `/workpath`, `/agent`, `/saver`, `/note`, `/wiki`, `/memory`, `/agenda`, `/autoapprove`, `/tokens`, `/version`, and `/history`.
3. Added richer Agenda trigger controls: fire a trigger manually, delete a trigger, choose the delivery session per trigger, and mark routines as per-fire check-ins.
4. Added DingTalk file sending, plus session recovery from saved metadata so proactive messages can still be delivered after a restart.
5. Added ReAct sub-task tracking with task listing, resumable task state, optional parent-context injection, and nested-depth protection.
6. Added Agent management helpers for reference counts, unused-Agent hints, skill exclusions in "use all" mode, and generated sub-agent capability descriptions.

### Improved

1. Improved channel send/list guidance so the AI can look up a person or group by name before sending messages or files.
2. Improved Lark message history with sender names and clearer pagination instructions.
3. Improved generated-file delivery links so files saved in nested working-directory paths can be shared correctly.
4. Simplified Agenda concepts by replacing category/completion-mode combinations with a clearer check-in switch.
5. Slimmed down release tooling by removing the old helper package flow and pointing XiaoAI credential setup to sbox.

### Fixed

1. Fixed Agenda trigger startup and reload races that could drop schedules or cause duplicate firing.
2. Fixed multi-trigger Agenda items being marked done too early; an item now completes only after all active triggers are exhausted.
3. Fixed Agenda delivery target storage and channel session metadata, improving reminder and proactive-message delivery after restarts.
4. Fixed Windows command execution and process cleanup sometimes opening a console window.
5. Fixed built-in command results being treated as ordinary AI replies in chat.
6. Fixed embedded-client file downloads and terminal connections in environments where direct browser links or sockets are unavailable.
