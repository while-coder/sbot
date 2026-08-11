import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Agent 商店","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/agent-store.md","filePath":"zh/guide/agent-store.md"}');
const _sfc_main = { name: "zh/guide/agent-store.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="agent-商店" tabindex="-1">Agent 商店 <a class="header-anchor" href="#agent-商店" aria-label="Permalink to &quot;Agent 商店&quot;">​</a></h1><p>侧栏 → <strong>Agent 商店</strong></p><p>Agent 商店让你从可配置的注册源浏览并一键安装预打包 Agent。每个安装包包含模型选择、系统提示词、技能与 MCP 服务器配置，免去手动配置流程。</p><h2 id="安装" tabindex="-1">安装 <a class="header-anchor" href="#安装" aria-label="Permalink to &quot;安装&quot;">​</a></h2><ol><li>打开侧栏中的 <strong>Agent 商店</strong></li><li>浏览 / 搜索安装包</li><li>点击 <strong>安装</strong> —— sbot 将： <ul><li>把该 Agent 添加到 <strong>Agent 管理</strong></li><li>拉取所需的 <a href="./skills.html">技能</a>（已存在则跳过）</li><li>添加所需的 <a href="./mcp.html">MCP 服务器</a>（缺失的 API Key 会保留占位符）</li></ul></li><li>打开已安装的 Agent，补齐缺失的凭据（API Key、MCP 环境变量）</li></ol><p>安装好的 Agent 与手动创建的 Agent 完全等价 —— 你可以照常编辑、复制或删除。</p><h2 id="注册源" tabindex="-1">注册源 <a class="header-anchor" href="#注册源" aria-label="Permalink to &quot;注册源&quot;">​</a></h2><p>侧栏 → <strong>设置</strong> → Agent 商店注册源</p><p>添加自定义注册源 URL，可拉取自有目录（团队内部 Agent、私有安装包）。</p><p>注册源是通过 HTTPS 提供的 JSON 清单，列出可用安装包。具体 schema 可参考项目仓库文档。</p><h2 id="编写安装包" tabindex="-1">编写安装包 <a class="header-anchor" href="#编写安装包" aria-label="Permalink to &quot;编写安装包&quot;">​</a></h2><p>一个安装包是一个 JSON 文档，包含：</p><ul><li>展示元信息（名称、描述、图标、标签）</li><li>默认模型 + 系统提示词</li><li>必需 / 推荐技能</li><li>必需 MCP 服务器 + 环境变量占位符</li></ul><p>发布到注册源后，凡是把 sbot 指向该注册源的人都可以一键安装。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/agent-store.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const agentStore = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  agentStore as default
};
