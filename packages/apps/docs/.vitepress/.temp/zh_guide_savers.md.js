import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Savers（对话存储）","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/savers.md","filePath":"zh/guide/savers.md"}');
const _sfc_main = { name: "zh/guide/savers.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="savers-对话存储" tabindex="-1">Savers（对话存储） <a class="header-anchor" href="#savers-对话存储" aria-label="Permalink to &quot;Savers（对话存储）&quot;">​</a></h1><p>侧栏 → <strong>对话存储</strong> → 新建</p><p>Saver 是对话历史的持久化后端 —— 每个聊天会话和渠道都必须引用一个。根据所需的存活时间和持久化要求选择对应的后端。</p><h2 id="后端类型" tabindex="-1">后端类型 <a class="header-anchor" href="#后端类型" aria-label="Permalink to &quot;后端类型&quot;">​</a></h2><table tabindex="0"><thead><tr><th>后端</th><th>说明</th><th>适用场景</th></tr></thead><tbody><tr><td><strong>文件</strong></td><td>每个会话线程一个 JSON 文件，存于 <code>~/.sbot/savers/&lt;saver-id&gt;/</code></td><td>默认选择，持久化、便于查看与备份</td></tr><tr><td><strong>SQLite</strong></td><td>单个 SQLite 数据库文件</td><td>大量并发线程，搜索更快</td></tr><tr><td><strong>内存</strong></td><td>进程内存储，会话结束即清空</td><td>一次性 Q&amp;A、无状态助手</td></tr></tbody></table><h2 id="配置项" tabindex="-1">配置项 <a class="header-anchor" href="#配置项" aria-label="Permalink to &quot;配置项&quot;">​</a></h2><table tabindex="0"><thead><tr><th>字段</th><th>说明</th></tr></thead><tbody><tr><td>名称</td><td>显示名称</td></tr><tr><td>类型</td><td><code>文件</code> / <code>SQLite</code> / <code>内存</code></td></tr><tr><td>路径</td><td>文件 / SQLite 的存储位置（默认 <code>~/.sbot/savers/&lt;id&gt;/</code>）</td></tr></tbody></table><h2 id="对话压缩" tabindex="-1">对话压缩 <a class="header-anchor" href="#对话压缩" aria-label="Permalink to &quot;对话压缩&quot;">​</a></h2><p>当对话超过可配置的 token 阈值时，sbot 会自动摘要早期消息并替换为压缩摘要 —— 既保持上下文连续性，又控制单轮 token 成本。压缩与 Saver 后端独立：完整未裁剪的对话仍然保存在磁盘上，Agent 看到的只是当前活跃窗口。</p><h2 id="分配" tabindex="-1">分配 <a class="header-anchor" href="#分配" aria-label="Permalink to &quot;分配&quot;">​</a></h2><p>Saver 按会话或按渠道选择。同一个 Saver 可被多个会话复用 —— 每个对话线程独立存储。</p><h2 id="提示" tabindex="-1">提示 <a class="header-anchor" href="#提示" aria-label="Permalink to &quot;提示&quot;">​</a></h2><ul><li>个人助手、需要长期回顾：用 <strong>文件</strong></li><li>高频 IM 渠道：用 <strong>SQLite</strong></li><li>&quot;问完即忘&quot;的 REST 集成：用 <strong>内存</strong></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/savers.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const savers = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  savers as default
};
