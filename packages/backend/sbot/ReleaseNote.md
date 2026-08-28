This release includes the following main changes:

### Added

1. Added image input (vision) support: models that accept images can now exchange them directly in conversations. Support is detected automatically from the model catalog and can be overridden per model in its configuration; unsupported models gracefully fall back to text handling with a notice.
2. The model list in the Admin UI now shows capability badges (such as image input), making model support easy to see at a glance.

### Improved

1. Reworked the model integration layer: OpenAI, Gemini, Anthropic, and Ollama channels now use the official native SDKs, reducing intermediate dependencies and aligning behavior with the official APIs.
2. MCP tools now connect through the official native SDK with more stable connections and automatic recovery after disconnects.
3. Better gateway compatibility: supports OpenAI endpoints that only accept the new token parameter, as well as various OpenAI and Anthropic gateways, so third-party proxies work out of the box.
4. Updated the built-in model catalog so new models are recognized automatically; model and embedding lists and their configuration options have been tidied up accordingly.
5. Channel logs now carry a unified prefix, making it easier to tell sources apart when multiple channels run at once.
6. Improved the upgrade command's execution flow and feedback.

### Fixed

1. Fixed duplicated conversation content when using models via the OpenAI Responses API.
2. Fixed request failures caused by the new OpenAI token parameter not being accepted.
3. Fixed errors when an image was sent to a model without image support; it now falls back gracefully with a notice.
