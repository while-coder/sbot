import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Models","description":"","frontmatter":{},"headers":[],"relativePath":"guide/models.md","filePath":"guide/models.md"}');
const _sfc_main = { name: "guide/models.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="models" tabindex="-1">Models <a class="header-anchor" href="#models" aria-label="Permalink to &quot;Models&quot;">​</a></h1><p>Sidebar → <strong>Language Models</strong> → New</p><p>Fill in provider, API key, base URL, and model name. The same connection can be used by multiple agents.</p><h2 id="supported-providers" tabindex="-1">Supported Providers <a class="header-anchor" href="#supported-providers" aria-label="Permalink to &quot;Supported Providers&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Provider</th><th>Notes</th></tr></thead><tbody><tr><td>OpenAI</td><td>Chat Completions-compatible OpenAI models</td></tr><tr><td>OpenAI Responses</td><td>OpenAI Responses API models</td></tr><tr><td>Anthropic</td><td>Claude 4.x, 3.x series</td></tr><tr><td>Google Gemini</td><td>Gemini 2.0 / 2.5 Pro, Flash</td></tr><tr><td>Gemini Image</td><td>Gemini image-generation models</td></tr><tr><td>Ollama</td><td>Local models via Ollama runtime</td></tr><tr><td>OpenAI-compatible</td><td>Azure OpenAI, Groq, Mistral, DeepSeek, Qwen, Together, etc.</td></tr></tbody></table><p>Any endpoint that implements the OpenAI chat completions API can be used as a provider — pick <strong>OpenAI-compatible</strong> and override the base URL.</p><h2 id="resilience" tabindex="-1">Resilience <a class="header-anchor" href="#resilience" aria-label="Permalink to &quot;Resilience&quot;">​</a></h2><ul><li>Automatic retry with exponential backoff on transient failures (5xx, network, rate limit)</li><li>Optional response caching with hit/miss metrics for repeated identical prompts</li><li>Per-model token usage tracking visible in the <strong>Token Usage</strong> page</li></ul><h2 id="advanced-options" tabindex="-1">Advanced Options <a class="header-anchor" href="#advanced-options" aria-label="Permalink to &quot;Advanced Options&quot;">​</a></h2><ul><li><strong>Context window / max tokens</strong> — override model limits when the provider does not report them clearly</li><li><strong>Max tools</strong> — cap how many tools are sent to the model</li><li><strong>Anthropic thinking</strong> — choose none, adaptive, or always-on thinking, with an optional budget</li><li><strong>Anthropic prompt caching</strong> — enable provider-side prompt cache hints</li><li><strong>Gemini API version</strong> — override the Gemini API version when needed</li></ul><h2 id="embedding-models" tabindex="-1">Embedding Models <a class="header-anchor" href="#embedding-models" aria-label="Permalink to &quot;Embedding Models&quot;">​</a></h2><p>Sidebar → <strong>Embedding Models</strong> → New</p><p>Embeddings are required for vector-based features (<a href="./note.html">Notes</a>, <a href="./wiki.html">Wiki</a> semantic search, <a href="./memory.html">Memory</a> hybrid search). Supported: OpenAI, Google, Ollama, Cohere, VoyageAI.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/models.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const models = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  models as default
};
