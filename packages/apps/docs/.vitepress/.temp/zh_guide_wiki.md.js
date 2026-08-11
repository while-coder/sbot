import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Wiki 知识库","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/wiki.md","filePath":"zh/guide/wiki.md"}');
const _sfc_main = { name: "zh/guide/wiki.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="wiki-知识库" tabindex="-1">Wiki 知识库 <a class="header-anchor" href="#wiki-知识库" aria-label="Permalink to &quot;Wiki 知识库&quot;">​</a></h1><p>侧栏 → <strong>知识库（文档）</strong> → 新建</p><p>Wiki 是结构化的知识页面库（标题 + 内容 + 标签）。Agent 在对话中可以搜索和读取已分配的 Wiki；本地文件等可写数据源则通过 Web UI 管理页面内容。它适合项目文档、值班手册、FAQ 和团队共享参考资料。</p><h2 id="配置项" tabindex="-1">配置项 <a class="header-anchor" href="#配置项" aria-label="Permalink to &quot;配置项&quot;">​</a></h2><table tabindex="0"><thead><tr><th>字段</th><th>说明</th></tr></thead><tbody><tr><td>名称</td><td>Wiki 标识</td></tr><tr><td>数据源类型</td><td>Wiki 数据源插件，例如本地文件或 Google Drive</td></tr><tr><td>数据源配置</td><td>当前数据源需要的额外字段</td></tr><tr><td>向量模型</td><td>可选 —— 设置后启用关键词 + 语义混合检索；不设置则退回到纯关键词检索</td></tr></tbody></table><h2 id="数据源" tabindex="-1">数据源 <a class="header-anchor" href="#数据源" aria-label="Permalink to &quot;数据源&quot;">​</a></h2><p>Wiki 数据源基于插件扩展：</p><ul><li><strong>本地文件</strong> —— 默认可写数据源，页面以 Markdown 文件保存到该 Wiki 的缓存目录</li><li><strong>Google Drive</strong> —— 只读数据源，把一个 Drive 文件夹视为 Wiki 目录，并把 Docs / Sheets / Slides 导出为可读文本</li><li><strong>第三方插件</strong> —— 可通过插件系统加载更多 Wiki 来源</li></ul><p>只读数据源会在 Web UI 中隐藏新增、编辑和删除入口。</p><h2 id="工作原理" tabindex="-1">工作原理 <a class="header-anchor" href="#工作原理" aria-label="Permalink to &quot;工作原理&quot;">​</a></h2><p>页面通过两种方式建立索引：</p><ol><li><strong>关键词</strong>（始终可用）—— 标题 + 内容 + 标签全文匹配</li><li><strong>语义</strong>（配置向量模型时）—— 向量相似度，用于模糊 / 概念查询</li></ol><p>查询时两种信号会合并 —— 因此 Agent 搜索 &quot;deploy steps&quot; 时，既能命中标题完全匹配的页面，也能命中语义相关的 &quot;release procedure&quot; 页面。</p><h2 id="agent-工具" tabindex="-1">Agent 工具 <a class="header-anchor" href="#agent-工具" aria-label="Permalink to &quot;Agent 工具&quot;">​</a></h2><p>Wiki 被分配到会话 / 渠道后，Agent 自动获得以下工具：</p><ul><li><code>wiki_search</code> —— 按关键词与 / 或语义相似度查询</li><li><code>wiki_read</code> —— 按 id 读取整页</li></ul><p>页面新增、编辑、删除通过 Web UI 的 Wiki 页面完成，仅适用于可写数据源。</p><h2 id="分配" tabindex="-1">分配 <a class="header-anchor" href="#分配" aria-label="Permalink to &quot;分配&quot;">​</a></h2><p>Wiki 可在多个层级分配（最具体的优先）：</p><ul><li><strong>Agent 级默认值</strong> —— 使用此 Agent 的所有会话 / 渠道继承</li><li><strong>会话级</strong> —— 在聊天会话中覆盖</li><li><strong>渠道级</strong> —— 在渠道中覆盖</li></ul><h2 id="wiki-vs-notes-vs-memory" tabindex="-1">Wiki vs Notes vs Memory <a class="header-anchor" href="#wiki-vs-notes-vs-memory" aria-label="Permalink to &quot;Wiki vs Notes vs Memory&quot;">​</a></h2><p>参见 <a href="./note.html#notes-vs-wiki-vs-memory">Notes</a> 中的对比表。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/wiki.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const wiki = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  wiki as default
};
