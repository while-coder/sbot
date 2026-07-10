This release includes the following main changes:

### Added

1. Memory Profiles can now retry failed memory extraction jobs directly from the job list.
2. Sync File Index now runs as a queued background job, so file/index refreshes are visible in the job list.

### Improved

1. Memory and Agenda background queues resume more reliably on startup and continue processing leftover jobs automatically.
2. Memory task logs now include the memory profile name, model details, and clearer failure messages for easier troubleshooting.
3. Structured output is more compatible across OpenAI-compatible, Anthropic, Gemini, and Ollama models, with automatic fallback between supported methods.

### Fixed

1. Fixed memory index sync, cleanup, and extraction jobs competing with each other during file or database writes.
2. Fixed failed memory extraction jobs being stuck without an admin retry path.
