import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"核心特性","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/features.md","filePath":"zh/guide/features.md"}');
const _sfc_main = { name: "zh/guide/features.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="核心特性" tabindex="-1">核心特性 <a class="header-anchor" href="#核心特性" aria-label="Permalink to &quot;核心特性&quot;">​</a></h1><ul><li><strong>模块化组合</strong> —— 模型、记忆、工具、渠道、技能均为独立模块，可自由搭配组装 Agent</li><li><strong>一条命令部署</strong> —— <code>npm install -g</code> 或 <code>docker run</code>，跨平台原生运行，无额外系统依赖</li><li><strong>全 Web UI 管理</strong> —— 所有配置在浏览器中完成，无需手动编辑文件</li><li><strong>多 LLM 供应商</strong> —— OpenAI、Anthropic Claude、Google Gemini、xAI Grok、Ollama，以及任何 OpenAI 兼容接口（Azure OpenAI、Groq、Mistral、DeepSeek 等）；网络抖动自动指数退避重试</li><li><strong>多 Agent 编排</strong> —— Single、ReAct（递归任务分解）、Generative（多模态）三种模式，Agent 可嵌套组合</li><li><strong>ACP Agent 支持</strong> —— Agent Client Protocol 集成，支持持久化与临时两种 Agent 模式</li><li><strong>知识库</strong> —— 可插拔 Wiki 数据源（本地文件、Google Drive 与第三方来源），支持关键词与可选语义检索</li><li><strong>长期记忆</strong> —— 基于向量 Embedding 的语义检索，持久化上下文召回（OpenAI、Gemini、Ollama、Cohere、VoyageAI）</li><li><strong>对话压缩</strong> —— Token 用量超阈值时自动摘要早期消息，保持上下文连续性同时降低消耗</li><li><strong>记忆（Memory）</strong> —— Agent 级自动长期记忆：会话空闲后由后台 MemoryLLM 提炼持久知识，主 Agent 通过 <code>search_memory</code> / <code>read_memory</code> 召回，并有 consolidate / reconcile 维护任务</li><li><strong>日程（Agenda）</strong> —— 由对话驱动的提醒、日程与周期任务，支持 absolute / interval / cron 触发器；可每轮对话后从对话自动同步，并投递到任意会话或渠道</li><li><strong>心跳唤醒</strong> —— 可配置的周期性自激活，让 Agent 在任意渠道主动执行预定提示词</li><li><strong>MCP 工具</strong> —— 标准 MCP 协议（stdio / HTTP / SSE），接入任意 MCP 工具生态；支持 Agent 级与全局服务器，故障自动重启</li><li><strong>多渠道</strong> —— Web UI、CLI、飞书 / Lark、Slack、企业微信、微信、钉钉、QQ（官方机器人）、腾讯元宝、OneBot（QQ）、小爱、REST API、WebSocket</li><li><strong>内置工具</strong> —— Shell 执行、文件系统、归档操作、媒体文件读取、Python / PowerShell 内联执行、Web 抓取 / 下载、等待、会话搜索、跨渠道发消息</li><li><strong>内置 MCP 预设</strong> —— Playwright、Markitdown、Exa 可在 MCP 工具列表中与自定义 MCP 服务器一起启用</li><li><strong>技能系统</strong> —— 可安装的 Prompt 模块，支持从 Clawhub、skills.sh、skillhub.cn 远程安装</li><li><strong>Agent 商店</strong> —— 浏览并一键安装预打包 Agent（模型 + 提示词 + 工具 + 技能 + MCP 服务器），支持自定义源</li><li><strong>Token 用量追踪</strong> —— 按模型统计消耗，模型响应缓存命中率可视化</li><li><strong>无人值守安全</strong> —— 渠道支持审批与提问超时配置，长时间自主运行更可靠</li><li><strong>灵活配置</strong> —— 单个 <code>settings.json</code> 支持全局与会话两级覆盖；提示词热更新无需重启</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/features.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const features = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  features as default
};
