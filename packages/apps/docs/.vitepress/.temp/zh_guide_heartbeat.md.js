import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"心跳唤醒（Heartbeat）","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/heartbeat.md","filePath":"zh/guide/heartbeat.md"}');
const _sfc_main = { name: "zh/guide/heartbeat.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="心跳唤醒-heartbeat" tabindex="-1">心跳唤醒（Heartbeat） <a class="header-anchor" href="#心跳唤醒-heartbeat" aria-label="Permalink to &quot;心跳唤醒（Heartbeat）&quot;">​</a></h1><p>侧栏 → <strong>心跳</strong> → 新建</p><p>心跳让 Agent 按固定间隔自我唤醒并执行一段提示词，无需任何用户消息 —— 适合监控、每日汇总、定时主动推送等&quot;周期性检查并执行 X&quot;的工作流。</p><h2 id="心跳-vs-agenda-何时使用" tabindex="-1">心跳 vs Agenda：何时使用？ <a class="header-anchor" href="#心跳-vs-agenda-何时使用" aria-label="Permalink to &quot;心跳 vs Agenda：何时使用？&quot;">​</a></h2><table tabindex="0"><thead><tr><th>需求</th><th>使用</th></tr></thead><tbody><tr><td>每隔 N 秒 / 分钟运行固定提示词</td><td><strong>心跳</strong></td></tr><tr><td>从对话中跟踪提醒、周期事项或一次性任务</td><td><a href="./agenda.html">Agenda</a></td></tr><tr><td>按 cron 运行（如工作日早上 9 点）且保留事项状态与触发历史</td><td><a href="./agenda.html">Agenda</a></td></tr></tbody></table><p>心跳是挂在 Agent + 目标上的固定间隔循环；Agenda 是用于提醒、周期事项和 cron 触发器的有状态调度系统。</p><h2 id="配置项" tabindex="-1">配置项 <a class="header-anchor" href="#配置项" aria-label="Permalink to &quot;配置项&quot;">​</a></h2><table tabindex="0"><thead><tr><th>字段</th><th>说明</th></tr></thead><tbody><tr><td>名称</td><td>显示名称</td></tr><tr><td>Agent</td><td>每次触发时使用的 Agent</td></tr><tr><td>目标</td><td>具体的渠道用户、Web 会话或工作目录</td></tr><tr><td>间隔</td><td>触发周期（秒 / 分钟 / 小时）</td></tr><tr><td>提示词</td><td>每次触发时 Agent 收到的提示词模板</td></tr><tr><td>启用</td><td>切换状态而不删除配置</td></tr></tbody></table><h2 id="示例" tabindex="-1">示例 <a class="header-anchor" href="#示例" aria-label="Permalink to &quot;示例&quot;">​</a></h2><ul><li><strong>状态摘要</strong> —— 每 1 小时汇总繁忙的 Lark 群中新消息，并把摘要发到 &quot;summary&quot; 话题</li><li><strong>看门狗</strong> —— 每 5 分钟通过 Web 工具查询健康检查接口，仅在失败时通知你</li><li><strong>站会助手</strong> —— 每个工作日早上询问昨天的进展，并写入笔记</li></ul><h2 id="注意" tabindex="-1">注意 <a class="header-anchor" href="#注意" aria-label="Permalink to &quot;注意&quot;">​</a></h2><ul><li>每个心跳目标拥有独立的对话线程（隔离历史）</li><li>与 <a href="./memory.html">Memory</a> 配合，让 Agent 从每次触发中学习</li><li>若需由对话内容驱动的有状态提醒 / 日程，请改用 <a href="./agenda.html">Agenda</a></li><li>禁用心跳可暂停而不丢失配置</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/heartbeat.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const heartbeat = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  heartbeat as default
};
