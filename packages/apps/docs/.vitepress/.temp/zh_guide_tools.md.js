import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"内置工具","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/tools.md","filePath":"zh/guide/tools.md"}');
const _sfc_main = { name: "zh/guide/tools.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="内置工具" tabindex="-1">内置工具 <a class="header-anchor" href="#内置工具" aria-label="Permalink to &quot;内置工具&quot;">​</a></h1><p>这些工具以内置提供者形式开箱即用，无需安装额外包。可在 Agent 编辑页按需开关；少数工具还依赖当前 Saver 或渠道上下文。</p><h2 id="命令执行" tabindex="-1">命令执行 <a class="header-anchor" href="#命令执行" aria-label="Permalink to &quot;命令执行&quot;">​</a></h2><ul><li>Shell 命令与脚本（bash / pwsh / cmd）</li><li>Python 与 PowerShell 内联执行</li><li>引用磁盘脚本文件执行</li><li>每条命令可独立配置超时时间</li></ul><h2 id="文件系统" tabindex="-1">文件系统 <a class="header-anchor" href="#文件系统" aria-label="Permalink to &quot;文件系统&quot;">​</a></h2><ul><li>读取、写入、编辑文件</li><li>正则内容搜索（grep）</li><li>按模式匹配查找文件（glob）</li><li>目录列举、创建、删除、移动、复制</li><li>媒体文件读取（图片等）</li><li>支持按 Agent 启用只读模式</li></ul><h2 id="归档工具" tabindex="-1">归档工具 <a class="header-anchor" href="#归档工具" aria-label="Permalink to &quot;归档工具&quot;">​</a></h2><ul><li>创建与解压 ZIP 文件</li><li>列举 ZIP 内容</li><li>直接读取 ZIP 内部文件</li></ul><h2 id="web-工具" tabindex="-1">Web 工具 <a class="header-anchor" href="#web-工具" aria-label="Permalink to &quot;Web 工具&quot;">​</a></h2><ul><li>抓取网页 URL 并转换为干净的 Markdown</li><li>从网络下载文件</li></ul><h2 id="会话搜索" tabindex="-1">会话搜索 <a class="header-anchor" href="#会话搜索" aria-label="Permalink to &quot;会话搜索&quot;">​</a></h2><ul><li>当当前 Saver 支持历史归档检索时，搜索过往对话</li><li>支持多组关键词匹配，并返回角色、时间与内容预览</li></ul><h2 id="渠道工具" tabindex="-1">渠道工具 <a class="header-anchor" href="#渠道工具" aria-label="Permalink to &quot;渠道工具&quot;">​</a></h2><ul><li>查询已配置渠道、渠道会话和已知用户</li><li>让 Agent 工作流向其他渠道会话或用户发送消息</li></ul><h2 id="内置-mcp-预设" tabindex="-1">内置 MCP 预设 <a class="header-anchor" href="#内置-mcp-预设" aria-label="Permalink to &quot;内置 MCP 预设&quot;">​</a></h2><p>MCP 页面还会列出 Playwright、Markitdown、Exa 等内置预设。它们按 MCP 服务器方式管理，而不是本地工具；可在 <a href="./mcp.html">MCP 工具</a> 或 Agent 的 MCP 标签页中启用。</p><h2 id="知识与记忆" tabindex="-1">知识与记忆 <a class="header-anchor" href="#知识与记忆" aria-label="Permalink to &quot;知识与记忆&quot;">​</a></h2><p>当 <a href="./note.html">Notes</a>、<a href="./wiki.html">Wiki</a>、<a href="./memory.html">Memory</a> 或 <a href="./agenda.html">Agenda</a> 在会话 / 渠道中启用时，Agent 会自动获得对应的工具：</p><ul><li><strong>Notes</strong> —— <code>note_search</code>，召回向量索引中的笔记</li><li><strong>Wiki</strong> —— <code>wiki_search</code> / <code>wiki_read</code>，搜索并读取已分配的 Wiki 页面</li><li><strong>Memory</strong> —— <code>search_memory</code> / <code>read_memory</code>，召回后台提取的长期记忆</li><li><strong>Agenda</strong> —— <code>agenda_create</code> / <code>agenda_list</code> / <code>agenda_get</code> / <code>agenda_edit</code> / <code>agenda_close</code>，管理提醒与日程</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/tools.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const tools = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  tools as default
};
