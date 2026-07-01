This release includes the following main changes:

### Added

1. Added Agenda trigger fire history: every trigger records its past fires, viewable from the admin panel, with a retention cap.
2. Reworked the Agenda management page with a dedicated trigger edit modal and trigger field editor for clearer management.
3. Added resource reference display: see which objects reference an Agent, Memory, Note, Wiki, Saver, or channel, with hints for unused items.
4. Added log downloads from the admin panel.
5. Added parallel tool-call execution for faster responses in multi-tool scenarios.
6. Added a `disableWorkspaceMcp` setting to turn off the workspace MCP.

### Improved

1. Simplified Agenda concepts by removing occurrences in favor of clearer trigger fire records; the auto-extraction pass no longer completes or cancels items, leaving item termination entirely to the user's in-conversation tools.
2. Unified channel loading behind a pluggable model, added the `sbot.plugin` config-field package, and gave config fields conditional visibility (showWhen) and multi-line (Textarea) input.

### Fixed

1. Fixed inaccurate Saver resource reference counts.
2. Fixed several Agenda storage and trigger-scheduling issues.
