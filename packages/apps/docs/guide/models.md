# Models

Sidebar → **Language Models** → New

Fill in provider, API key, base URL, and model name. The same connection can be used by multiple agents.

## Supported Providers

| Provider | Notes |
|----------|-------|
| OpenAI | Chat Completions-compatible OpenAI models |
| OpenAI Responses | OpenAI Responses API models |
| Anthropic | Claude 4.x, 3.x series |
| Google Gemini | Gemini 2.0 / 2.5 Pro, Flash |
| Gemini Image | Gemini image-generation models |
| Ollama | Local models via Ollama runtime |
| OpenAI-compatible | Azure OpenAI, Groq, Mistral, DeepSeek, Qwen, Together, etc. |

Any endpoint that implements the OpenAI chat completions API can be used as a provider — pick **OpenAI-compatible** and override the base URL.

## Resilience

- Automatic retry with exponential backoff on transient failures (5xx, network, rate limit)
- Optional response caching with hit/miss metrics for repeated identical prompts
- Per-model token usage tracking visible in the **Token Usage** page

## Advanced Options

- **Context window / max tokens** — override model limits when the provider does not report them clearly
- **Max tools** — cap how many tools are sent to the model
- **Anthropic thinking** — choose none, adaptive, or always-on thinking, with an optional budget
- **Anthropic prompt caching** — enable provider-side prompt cache hints
- **Gemini API version** — override the Gemini API version when needed

## Embedding Models

Sidebar → **Embedding Models** → New

Embeddings are required for vector-based features ([Notes](./note), [Wiki](./wiki) semantic search, [Memory](./memory) hybrid search). Supported: OpenAI, Google, Ollama, Cohere, VoyageAI.
