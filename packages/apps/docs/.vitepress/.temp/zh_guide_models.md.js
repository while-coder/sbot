import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"模型","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/models.md","filePath":"zh/guide/models.md"}');
const _sfc_main = { name: "zh/guide/models.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="模型" tabindex="-1">模型 <a class="header-anchor" href="#模型" aria-label="Permalink to &quot;模型&quot;">​</a></h1><p>侧栏 → <strong>语言模型</strong> → 新建</p><p>填写 provider、API Key、Base URL 和模型名。同一个模型连接可被多个 Agent 复用。</p><h2 id="支持的供应商" tabindex="-1">支持的供应商 <a class="header-anchor" href="#支持的供应商" aria-label="Permalink to &quot;支持的供应商&quot;">​</a></h2><table tabindex="0"><thead><tr><th>供应商</th><th>备注</th></tr></thead><tbody><tr><td>OpenAI</td><td>OpenAI Chat Completions 兼容模型</td></tr><tr><td>OpenAI Responses</td><td>OpenAI Responses API 模型</td></tr><tr><td>Anthropic</td><td>Claude 4.x、3.x 系列</td></tr><tr><td>Google Gemini</td><td>Gemini 2.0 / 2.5 Pro、Flash</td></tr><tr><td>Gemini Image</td><td>Gemini 图像生成模型</td></tr><tr><td>Ollama</td><td>通过 Ollama 运行时使用本地模型</td></tr><tr><td>OpenAI 兼容</td><td>Azure OpenAI、Groq、Mistral、DeepSeek、Qwen、Together 等</td></tr></tbody></table><p>任何实现了 OpenAI Chat Completions 接口的服务都可以作为供应商使用 —— 选择 <strong>OpenAI 兼容</strong> 并覆盖 Base URL 即可。</p><h2 id="稳定性" tabindex="-1">稳定性 <a class="header-anchor" href="#稳定性" aria-label="Permalink to &quot;稳定性&quot;">​</a></h2><ul><li>网络抖动（5xx、网络异常、限流）时自动指数退避重试</li><li>可选模型响应缓存，重复相同提示时显示命中 / 未命中指标</li><li><strong>Token 用量</strong> 页面按模型统计消耗</li></ul><h2 id="高级选项" tabindex="-1">高级选项 <a class="header-anchor" href="#高级选项" aria-label="Permalink to &quot;高级选项&quot;">​</a></h2><ul><li><strong>上下文窗口 / 最大输出 token</strong> —— 当供应商没有明确返回限制时，可手动覆盖</li><li><strong>最大工具数</strong> —— 限制每轮发送给模型的工具数量</li><li><strong>Anthropic thinking</strong> —— 可选择不开启、自适应或始终开启，并配置预算</li><li><strong>Anthropic Prompt Cache</strong> —— 启用供应商侧 Prompt 缓存提示</li><li><strong>Gemini API Version</strong> —— 需要时覆盖 Gemini API 版本</li></ul><h2 id="向量模型-embedding" tabindex="-1">向量模型（Embedding） <a class="header-anchor" href="#向量模型-embedding" aria-label="Permalink to &quot;向量模型（Embedding）&quot;">​</a></h2><p>侧栏 → <strong>向量模型</strong> → 新建</p><p>向量模型是基于向量的功能（<a href="./note.html">Notes</a>、<a href="./wiki.html">Wiki</a> 语义检索、<a href="./memory.html">Memory</a> 混合检索）的前置依赖。支持：OpenAI、Gemini、Ollama、Cohere、VoyageAI。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/models.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const models = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  models as default
};
