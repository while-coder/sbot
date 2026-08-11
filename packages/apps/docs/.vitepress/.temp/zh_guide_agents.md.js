import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Agent","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/agents.md","filePath":"zh/guide/agents.md"}');
const _sfc_main = { name: "zh/guide/agents.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="agent" tabindex="-1">Agent <a class="header-anchor" href="#agent" aria-label="Permalink to &quot;Agent&quot;">​</a></h1><p>侧栏 → <strong>Agent 管理</strong> → 新建</p><p>一个 Agent 把模型、系统提示词，以及它能调用的工具 / 技能 / 知识打包在一起，然后被分配给聊天会话或渠道使用。</p><h2 id="agent-模式" tabindex="-1">Agent 模式 <a class="header-anchor" href="#agent-模式" aria-label="Permalink to &quot;Agent 模式&quot;">​</a></h2><h3 id="single" tabindex="-1">Single <a class="header-anchor" href="#single" aria-label="Permalink to &quot;Single&quot;">​</a></h3><p>选择一个模型、写系统提示词，可选挂载 MCP 工具与技能。这是最常用的单一职能助手模式。</p><h3 id="react" tabindex="-1">ReAct <a class="header-anchor" href="#react" aria-label="Permalink to &quot;ReAct&quot;">​</a></h3><p>选择一个 <strong>Think 模型</strong>，然后添加子 Agent（每个子 Agent 需要 id 和描述用于任务调度）。Think 模型递归拆解用户请求并分发子任务；每个子 Agent 对共享记忆只读。</p><p>适合在以下场景使用 ReAct：</p><ul><li>任务开放（&quot;端到端规划并执行 X&quot;）</li><li>希望由调度模型动态选择专家 Agent</li></ul><p>每个派发的子任务可继承父对话的上下文（<code>none</code> —— 干净起步，默认；<code>state</code> —— 父对话近期消息的有界快照；<code>full</code> —— 完整克隆父历史）。递归深度有护栏，防止失控嵌套。</p><h3 id="generative" tabindex="-1">Generative <a class="header-anchor" href="#generative" aria-label="Permalink to &quot;Generative&quot;">​</a></h3><p>选择多模态模型，用于文本 + 图像混合内容生成。</p><h3 id="acp" tabindex="-1">ACP <a class="header-anchor" href="#acp" aria-label="Permalink to &quot;ACP&quot;">​</a></h3><p>把外部 Agent Client Protocol 进程作为 Agent 运行。后台提供 Claude Code、Codex、OpenCode、Cline、Qwen Code 等快速填充预设，也可以自定义启动命令、参数、环境变量、会话模式和初始化超时。</p><p><strong>Persistent</strong> 模式会让外部进程在多轮对话间常驻复用；<strong>Transient</strong> 模式则在每轮结束后关闭会话。</p><h2 id="配置项" tabindex="-1">配置项 <a class="header-anchor" href="#配置项" aria-label="Permalink to &quot;配置项&quot;">​</a></h2><table tabindex="0"><thead><tr><th>区块</th><th>用途</th></tr></thead><tbody><tr><td>模型</td><td>该 Agent 的主 LLM</td></tr><tr><td>系统提示词</td><td>角色、能力、回复风格</td></tr><tr><td>MCP 工具</td><td>Agent 级启用的 <a href="./mcp.html">MCP 服务器</a> 列表</td></tr><tr><td>技能</td><td>Agent 级 <a href="./skills.html">技能</a> 选择（留空表示加载全部）</td></tr><tr><td>笔记</td><td>使用此 Agent 的会话默认 <a href="./note.html">Notes</a>（向量库）</td></tr><tr><td>Wiki</td><td>会话默认的 <a href="./wiki.html">wiki / 知识库</a></td></tr><tr><td>记忆</td><td>Agent 级长期记忆，由后台 MemoryLLM 提取 —— 详见 <a href="./memory.html">Memory</a></td></tr><tr><td>日程</td><td>Agent 级提醒 / 日程，可从对话自动同步 —— 详见 <a href="./agenda.html">Agenda</a></td></tr><tr><td>心跳</td><td>周期性自激活 —— 详见 <a href="./heartbeat.html">Heartbeat</a></td></tr><tr><td>ACP 启动配置</td><td>ACP Agent 的外部进程命令、参数、环境变量、会话模式和初始化超时</td></tr></tbody></table><h2 id="预制-agent" tabindex="-1">预制 Agent <a class="header-anchor" href="#预制-agent" aria-label="Permalink to &quot;预制 Agent&quot;">​</a></h2><p>不想手动配置？可前往 <a href="./agent-store.html">Agent 商店</a> 浏览即装即用的整套包（模型 + 提示词 + 工具 + 技能 + MCP 服务器）。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/agents.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const agents = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  agents as default
};
