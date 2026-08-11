import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"MCP Tools","description":"","frontmatter":{},"headers":[],"relativePath":"guide/mcp.md","filePath":"guide/mcp.md"}');
const _sfc_main = { name: "guide/mcp.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="mcp-tools" tabindex="-1">MCP Tools <a class="header-anchor" href="#mcp-tools" aria-label="Permalink to &quot;MCP Tools&quot;">​</a></h1><p>Sidebar → <strong>Tools</strong> → New</p><p><a href="https://modelcontextprotocol.io/" target="_blank" rel="noreferrer">Model Context Protocol (MCP)</a> lets agents call external tools through a standard protocol. sbot supports stdio, HTTP, and SSE transports, with built-in presets, global servers shared across agents, and per-agent servers.</p><h2 id="adding-a-server" tabindex="-1">Adding a Server <a class="header-anchor" href="#adding-a-server" aria-label="Permalink to &quot;Adding a Server&quot;">​</a></h2><ul><li><strong>stdio</strong> — command + args (e.g. <code>npx -y some-mcp-package</code>); environment variables can be configured per server</li><li><strong>http</strong> — remote MCP endpoint URL + optional headers</li><li><strong>sse</strong> — remote URL + optional headers (for hosted MCP services)</li></ul><h2 id="configuration" tabindex="-1">Configuration <a class="header-anchor" href="#configuration" aria-label="Permalink to &quot;Configuration&quot;">​</a></h2><ul><li><strong>Built-in presets</strong> — Playwright, Markitdown, Exa, and local built-in tool groups are listed from the same MCP screen</li><li><strong>Global servers</strong> — shared across every agent</li><li><strong>Per-agent servers</strong> — open an agent → MCP tab to enable global providers or add agent-only MCP servers</li><li><strong>Auto-restart</strong> — failed stdio servers are automatically respawned</li><li><strong>Lazy start</strong> — servers boot only when an agent that uses them runs</li><li><strong>Tool timeout</strong> — override the per-call timeout for slow tools</li><li><strong>Prompt / Resource tools</strong> — optionally expose MCP prompts and resources through generated helper tools</li></ul><h2 id="usage" tabindex="-1">Usage <a class="header-anchor" href="#usage" aria-label="Permalink to &quot;Usage&quot;">​</a></h2><p>Once attached to an agent, MCP tools are advertised to the model on every turn. The Web UI can inspect a provider&#39;s tools, prompts, resources, and resource templates, and tool results are fed back into the conversation.</p><h2 id="tips" tabindex="-1">Tips <a class="header-anchor" href="#tips" aria-label="Permalink to &quot;Tips&quot;">​</a></h2><ul><li>For local commands that need a Node toolchain, use the <code>npx -y</code> form to avoid pre-install hassle</li><li>Use HTTP or SSE transport when the MCP server is remote or shared across multiple sbot instances</li><li>Sensitive secrets in env vars are masked in logs</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/mcp.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const mcp = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  mcp as default
};
