## v0.0.7

### New Features

- **Archive Tools**: New built-in tools for archive file operations — compress, extract, list contents, and read files within archives
- **Binary File Read Tool**: Added tool for reading binary files in agent workflows
- **Lark File/Image Sending**: Lark channel now supports sending images and files to users
- **Lark File/Image Receiving**: Lark channel now supports receiving images, files, and other media from users
- **find-skills Skill**: Built-in skill for discovering available skills in the skills directory
- **Multiple Memory Support**: Agent can now load and use multiple memory files simultaneously per user/session
- **Memory Management UI**: Web UI now supports viewing and managing individual memory entries
- **Docker Support**: Added containerized deployment support

### Improvements

- **Saver Format**: Updated `AgentFileSaver` save format for cleaner file output
- **Prompt Refinements**: Refined channel-specific prompts for ask and send-file interactions
- **UserService Refactoring**: Unified and cleaned up user service across all channels
- **AgentRunner**: Cleaned up internal agent execution flow and improved prompt handling
- **Skills Directory**: Added directory-level description support for skills discovery
- **Memory as Array**: Refactored memory storage to use array format for multi-memory support

### Bug Fixes

- Fixed channel registration issue
- Fixed website client display

