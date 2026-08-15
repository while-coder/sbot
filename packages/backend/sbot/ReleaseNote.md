This release includes the following main changes:

### Added

1. Added the Tencent Yuanbao channel for connecting sbot to Yuanbao bots, with reliable text, image, and file exchange in conversations.
2. Long-term memory can now use Git to manage version history, making knowledge changes easier to track and restore.
3. Added server process lifecycle logs for startup, normal exits, unexpected exits, and leftover running instances. The Admin UI now shows application and lifecycle logs separately.

### Improved

1. Memory now keeps high-priority entries and adds summaries that are relevant to the current query, avoiding unrelated context while leaving full entries available on demand.
2. Agent capabilities such as Memory, Agenda, Notes, Wiki, and Skills are now composable plugins with clearer extension and configuration boundaries.
3. Model, embedding, and conversation-storage capabilities are separated into independent providers for more flexible configuration and future extensions.
4. Docker environments now prepare Git automatically, so Git-managed memory works without extra runtime setup.

### Fixed

1. Fixed model streams with no renderable content or tool calls being treated as successful responses. They now return a clear error that points to thinking or token settings.
2. Improved Tencent Yuanbao token handling, reconnection, and media transfer to reduce message interruptions caused by transient network or authentication failures.
