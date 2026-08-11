import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"MCP 工具","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/mcp.md","filePath":"zh/guide/mcp.md"}');
const _sfc_main = { name: "zh/guide/mcp.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="mcp-工具" tabindex="-1">MCP 工具 <a class="header-anchor" href="#mcp-工具" aria-label="Permalink to &quot;MCP 工具&quot;">​</a></h1><p>侧栏 → <strong>工具</strong> → 新建</p><p><a href="https://modelcontextprotocol.io/" target="_blank" rel="noreferrer">Model Context Protocol（MCP）</a> 让 Agent 通过标准协议调用外部工具。sbot 支持 stdio、HTTP、SSE 三种传输方式，并提供内置预设、全局共享服务器与 Agent 专属服务器。</p><h2 id="添加服务器" tabindex="-1">添加服务器 <a class="header-anchor" href="#添加服务器" aria-label="Permalink to &quot;添加服务器&quot;">​</a></h2><ul><li><strong>stdio</strong> —— 命令 + 参数（如 <code>npx -y some-mcp-package</code>）；可按服务器配置环境变量</li><li><strong>http</strong> —— 远程 MCP Endpoint URL + 可选请求头</li><li><strong>sse</strong> —— 远程 URL + 可选请求头（用于托管的 MCP 服务）</li></ul><h2 id="配置" tabindex="-1">配置 <a class="header-anchor" href="#配置" aria-label="Permalink to &quot;配置&quot;">​</a></h2><ul><li><strong>内置预设</strong> —— Playwright、Markitdown、Exa 以及本地内置工具组会出现在同一个 MCP 列表中</li><li><strong>全局服务器</strong> —— 所有 Agent 共享</li><li><strong>Agent 专属服务器</strong> —— 打开 Agent → MCP 标签页，可启用全局提供者，也可添加仅该 Agent 使用的 MCP 服务器</li><li><strong>故障自动重启</strong> —— stdio 服务器异常退出后自动重新拉起</li><li><strong>懒启动</strong> —— 服务器仅在使用它的 Agent 运行时才启动</li><li><strong>工具超时</strong> —— 可覆盖慢工具的单次调用超时时间</li><li><strong>Prompt / Resource 工具</strong> —— 可选把 MCP prompts 和 resources 包装成辅助工具供 Agent 调用</li></ul><h2 id="使用方式" tabindex="-1">使用方式 <a class="header-anchor" href="#使用方式" aria-label="Permalink to &quot;使用方式&quot;">​</a></h2><p>挂载到 Agent 后，MCP 工具会在每轮对话中暴露给模型。Web UI 可查看某个提供者暴露的工具、Prompts、Resources 和 Resource Templates；工具结果会被回传到对话中。</p><h2 id="提示" tabindex="-1">提示 <a class="header-anchor" href="#提示" aria-label="Permalink to &quot;提示&quot;">​</a></h2><ul><li>对于需要 Node 工具链的本地命令，使用 <code>npx -y</code> 形式可免去预安装麻烦</li><li>当 MCP 服务器是远程的或被多个 sbot 实例共享时，使用 HTTP 或 SSE 传输</li><li>环境变量中的敏感凭据在日志中会被脱敏</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/mcp.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const mcp = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  mcp as default
};
