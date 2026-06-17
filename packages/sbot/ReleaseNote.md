This release includes the following main changes:

### Added

1. Added the Agenda system, a unified replacement for the previous Scheduler and Todo features. You can create, list, update, complete, cancel, and manually trigger agendas, with editing supported in both the chat and the management page.
2. Added Smart Heartbeat. The AI decides whether the current moment is appropriate to reach out, instead of sending on a fixed interval.
3. Added hybrid search for notes, combining keyword and semantic retrieval for more accurate results.
4. Added a Settings API and a Memories management API in the web UI.

### Improved

1. Reworked the Memory system with a new storage and service architecture, more reliable writes, automatic retry on failure, and clearer reader/writer prompts.
2. Switched the dependency injection container to synchronous initialization for faster and more predictable startup.
3. Improved the Heartbeat module with throttling and a shared context builder, reducing redundant triggers.
4. Improved the Web fetch tool with better content extraction and error handling.
5. Improved time handling by consolidating time utilities and removing the explicit time-zone field from agendas.
6. Improved channel data sync flow and error reporting.
7. Slimmed down the agenda prompts and tools for clearer model behavior and lower token usage.

### Fixed

1. Fixed several agenda synchronization issues, including incorrect state after edits and missed triggers.
2. Fixed inconsistent "current time" / "today's date" reported in tool calls.
3. Fixed image resize edge cases when handling large or non-standard inputs.
4. Fixed channel prompt loading in some configurations.
