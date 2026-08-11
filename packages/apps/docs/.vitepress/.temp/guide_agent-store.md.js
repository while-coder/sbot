import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Agent Store","description":"","frontmatter":{},"headers":[],"relativePath":"guide/agent-store.md","filePath":"guide/agent-store.md"}');
const _sfc_main = { name: "guide/agent-store.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="agent-store" tabindex="-1">Agent Store <a class="header-anchor" href="#agent-store" aria-label="Permalink to &quot;Agent Store&quot;">​</a></h1><p>Sidebar → <strong>Agent Store</strong></p><p>The Agent Store lets you browse and one-click install pre-packaged agents from configurable registries. Each package bundles model selection, system prompt, skills, and MCP server configuration — saving the manual setup walkthrough.</p><h2 id="installing" tabindex="-1">Installing <a class="header-anchor" href="#installing" aria-label="Permalink to &quot;Installing&quot;">​</a></h2><ol><li>Open <strong>Agent Store</strong> in the sidebar</li><li>Browse / search packages</li><li>Click <strong>Install</strong> — sbot: <ul><li>Adds the agent to <strong>Agent Management</strong></li><li>Pulls in any required <a href="./skills.html">skills</a> it doesn&#39;t already have</li><li>Adds any <a href="./mcp.html">MCP servers</a> it depends on (with placeholders for missing API keys)</li></ul></li><li>Open the installed agent and fill in any missing credentials (API keys, MCP env vars)</li></ol><p>Installed agents are normal agents — you can edit, fork, or delete them like any hand-built one.</p><h2 id="adding-custom-registries" tabindex="-1">Adding Custom Registries <a class="header-anchor" href="#adding-custom-registries" aria-label="Permalink to &quot;Adding Custom Registries&quot;">​</a></h2><p>Sidebar → <strong>Settings</strong> → Agent Store registries</p><p>Add custom registry URLs to pull from your own catalog (team-internal agents, private bundles).</p><p>A registry is a JSON manifest listing available packages, served over HTTPS. The exact schema is documented in the project repo.</p><h2 id="authoring-a-package" tabindex="-1">Authoring a Package <a class="header-anchor" href="#authoring-a-package" aria-label="Permalink to &quot;Authoring a Package&quot;">​</a></h2><p>A package is a JSON document with:</p><ul><li>Display metadata (name, description, icon, tags)</li><li>Default model + system prompt</li><li>Required / suggested skills</li><li>Required MCP servers + env-var placeholders</li></ul><p>Once published to a registry, anyone pointing sbot at that registry can install it with one click.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/agent-store.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const agentStore = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  agentStore as default
};
