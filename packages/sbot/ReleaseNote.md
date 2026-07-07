This release includes the following main changes:

### Added

1. Added intent filter modes for channels and sessions: Auto, Off, and Filter all, while keeping session-level inheritance from channel defaults.
2. Added structured-output method options so model calls can use Function Calling, JSON Mode, or JSON Schema, with strict mode support where available, improving compatibility with OpenAI-compatible models.

### Improved

1. The admin channel and session configuration pages can now display and edit intent filter mode; when Off or Filter all is selected, model, prompt, and threshold fields are hidden and cleared.
2. Intent classification now uses JSON Mode with explicit JSON-only instructions; logs also include the model ID and resolved session name, making filtering and compatibility issues easier to diagnose.
3. App release workflow titles now use `app v<version>` to avoid confusion with sbot package releases.

### Fixed

1. Fixed incomplete saving and updating of intent-filter fields in session configuration.
2. Fixed intent filtering using the thread ID as session context; it now resolves the actual session for logging and classification.
