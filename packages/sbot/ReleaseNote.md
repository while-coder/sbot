### New Features

- **Interrupt Support**: Agents can now be interrupted mid-execution; interrupt flow integrated into both Web and Lark channels
- **Unified Ask Flow**: Standardized ask interaction handling; Lark now supports ask interactions with improved state machine logic
- **Tool Auto-Approval**: Added support for configuring automatic tool execution approval
- **CLI Mode**: New command-line interaction mode with `clear` command support
- **Update Detection**: Added automatic version update detection
- **User Avatars**: Persist Lark user avatars
- **Improved Prompts**: Refined system prompt and scheduler tool instructions; refactored UserService and AgentRunner internals

### Bug Fixes

- Fixed tool argument parsing
- Adjusted default tool execution timeout
