## v0.0.8

### New Features

- **Gemini Model Support**: Added `GeminiModelService` and `GeminiImageModelService` with full support for Google Gemini models including image generation
- **OpenAI Response Model**: Added `OpenAIResponseModelService` for OpenAI Response API format
- **Channel Plugin System**: Introduced `ChannelPlugin` abstraction and `PluginLoader`; all channels (Lark, Slack, WeCom) now register as plugins
- **Think Process Display**: New `ThinkDrawer` component in Web UI for viewing AI reasoning/thinking process
- **Logs View**: Added `LogsView` page to the web dashboard for viewing application logs

### Architecture Changes

- **Session Refactoring**: Major refactoring of session management with message queue mechanism; `UserService` renamed to `SessionManager`; removed `BaseWebUserService`, `HttpUserService`, and all channel-specific UserServices (Lark/Slack/WeCom), unified under `ChannelSessionHandler`. `SessionService` significantly expanded and now extends `MessageDispatcher`
- **Channel Plugin Architecture**: Added `AbstractChatProvider` base class; significantly simplified `ChannelManager` by extracting `PluginLoader` and `createProcessAIHandler`; channel `UserServiceBase` renamed to `SessionHandler`; each channel now exports a `plugin.ts` for self-registration. `SessionManager` in channel.base made abstract
- **Saver Refactoring**: Added `messageConverter.ts` for unified message conversion; simplified `messageSerializer.ts`; significantly expanded `IAgentSaverService` interface with think content storage support
- **Removed Azure Model**: Removed `AzureModelService`, unified under OpenAI-compatible interface

### Improvements

- **Memory Content Splitting**: Memory content now supports segmented storage and retrieval
- **Saver Think Support**: Conversation history saving now records AI thinking process
- **Anthropic Model Enhancement**: Extended `AnthropicModelService` with additional configuration options