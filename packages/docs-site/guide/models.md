# Models

Sidebar → **Language Models** → New

Fill in provider, API key, base URL, and model name. The same connection can be used by multiple agents.

## Supported Providers

| Provider | Notes |
|----------|-------|
| OpenAI | GPT-4o, GPT-4.1, o-series, etc. |
| Anthropic | Claude 4.x, 3.x series |
| Google Gemini | Gemini 2.0 / 2.5 Pro, Flash |
| Ollama | Local models via Ollama runtime |
| OpenAI-compatible | Azure OpenAI, Groq, Mistral, DeepSeek, Qwen, Together, etc. |

Any endpoint that implements the OpenAI chat completions API can be used as a provider — pick **OpenAI-compatible** and override the base URL.

## Resilience

- Automatic retry with exponential backoff on transient failures (5xx, network, rate limit)
- Optional response caching with hit/miss metrics for repeated identical prompts
- Per-model token usage tracking visible in the **Token Usage** page

## Embedding Models

Sidebar → **Embedding Models** → New

Embeddings are required for vector-based features ([Notes](./note), [Wiki](./wiki) semantic search, [Memory](./memory) hybrid search). Supported: OpenAI, Google, Ollama, Cohere, VoyageAI.
