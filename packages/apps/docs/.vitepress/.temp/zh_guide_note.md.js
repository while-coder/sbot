import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Notes（记忆）","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/note.md","filePath":"zh/guide/note.md"}');
const _sfc_main = { name: "zh/guide/note.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="notes-记忆" tabindex="-1">Notes（记忆） <a class="header-anchor" href="#notes-记忆" aria-label="Permalink to &quot;Notes（记忆）&quot;">​</a></h1><p>侧栏 → <strong>Notes</strong> → 新建</p><p>Note 仓库是供 Agent 召回的人工维护知识库。你可以在 Web UI 中加入稳定事实，再把 Note 分配给会话 / 渠道；sbot 会在每轮对话前注入相关笔记，同时也提供 <code>note_search</code> 工具供 Agent 主动检索。</p><h2 id="前置条件" tabindex="-1">前置条件 <a class="header-anchor" href="#前置条件" aria-label="Permalink to &quot;前置条件&quot;">​</a></h2><p>需要先创建向量模型：侧栏 → <strong>向量模型</strong> → 新建。详见 <a href="./models.html">模型</a>。</p><h2 id="配置项" tabindex="-1">配置项 <a class="header-anchor" href="#配置项" aria-label="Permalink to &quot;配置项&quot;">​</a></h2><table tabindex="0"><thead><tr><th>字段</th><th>说明</th></tr></thead><tbody><tr><td>名称</td><td>该笔记本的显示名称</td></tr><tr><td>向量模型</td><td>用于语义检索的模型（OpenAI、Google、Ollama、Cohere、VoyageAI）</td></tr></tbody></table><h2 id="工作原理" tabindex="-1">工作原理 <a class="header-anchor" href="#工作原理" aria-label="Permalink to &quot;工作原理&quot;">​</a></h2><ol><li><strong>添加</strong> —— 在 Notes 页面手动添加内容；长文本可自动切分</li><li><strong>索引</strong> —— 配置向量模型时建立向量索引；未配置时使用 BM25 关键词检索</li><li><strong>召回</strong> —— 每轮对话前自动注入相关笔记，也可通过 <code>note_search</code> 主动检索</li><li><strong>排序</strong> —— 结果叠加语义 / 关键词得分、时间衰减与访问次数加权</li><li><strong>去重</strong> —— 配置向量模型时，近似重复内容会自动合并，避免存储膨胀</li></ol><h2 id="分配" tabindex="-1">分配 <a class="header-anchor" href="#分配" aria-label="Permalink to &quot;分配&quot;">​</a></h2><p>Note 可在多个层级分配（最具体的优先）：</p><ul><li><strong>Agent 级默认值</strong> —— 使用此 Agent 的所有会话 / 渠道继承</li><li><strong>会话级</strong> —— 在聊天会话中覆盖</li><li><strong>渠道级</strong> —— 在渠道中覆盖</li></ul><h2 id="notes-vs-wiki-vs-memory" tabindex="-1">Notes vs Wiki vs Memory <a class="header-anchor" href="#notes-vs-wiki-vs-memory" aria-label="Permalink to &quot;Notes vs Wiki vs Memory&quot;">​</a></h2><table tabindex="0"><thead><tr><th>概念</th><th>写入方</th><th>适用场景</th></tr></thead><tbody><tr><td><a href="./note.html">Notes</a></td><td>人 / 运维者</td><td>Agent 通过语义或关键词召回的自由格式事实</td></tr><tr><td><a href="./wiki.html">Wiki</a></td><td>人 / Wiki 数据源插件</td><td>带标题与标签的结构化知识页</td></tr><tr><td><a href="./memory.html">Memory</a></td><td>后台 MemoryLLM</td><td>从过往对话中提炼的长期知识</td></tr></tbody></table></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/note.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const note = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  note as default
};
