import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"技能（Skills）","description":"","frontmatter":{},"headers":[],"relativePath":"zh/guide/skills.md","filePath":"zh/guide/skills.md"}');
const _sfc_main = { name: "zh/guide/skills.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="技能-skills" tabindex="-1">技能（Skills） <a class="header-anchor" href="#技能-skills" aria-label="Permalink to &quot;技能（Skills）&quot;">​</a></h1><p>侧栏 → <strong>技能</strong></p><p>技能是可安装的 Markdown 提示词模块，用于扩展 Agent 在专项知识或工作流上的能力。它们仅在模型判断相关时才被加载到系统提示词中，闲置时不占用上下文成本。</p><h2 id="存储位置" tabindex="-1">存储位置 <a class="header-anchor" href="#存储位置" aria-label="Permalink to &quot;存储位置&quot;">​</a></h2><p>技能文件存于 <code>~/.sbot/skills/</code>。每个技能是一份 <code>SKILL.md</code> 文件，包含 frontmatter（<code>name</code>、<code>description</code>）以及正文。</p><h2 id="安装" tabindex="-1">安装 <a class="header-anchor" href="#安装" aria-label="Permalink to &quot;安装&quot;">​</a></h2><p>添加方式：</p><ul><li><strong>从市场搜索安装</strong> —— 内置注册源：Clawhub、skills.sh、skillhub.cn</li><li><strong>通过 URL 安装</strong> —— 粘贴受支持的 Skill Hub 地址</li><li><strong>通过 ZIP 安装</strong> —— 上传一个或多个包含 <code>SKILL.md</code> 的 <code>.zip</code> 文件</li><li><strong>手动放入</strong> —— 直接把 <code>SKILL.md</code> 文件放入 <code>~/.sbot/skills/</code></li></ul><h2 id="分配" tabindex="-1">分配 <a class="header-anchor" href="#分配" aria-label="Permalink to &quot;分配&quot;">​</a></h2><p>进入 Agent → <strong>技能</strong> 标签页：</p><ul><li>选择具体的技能加载</li><li>或留空表示加载 <strong>所有</strong> 可用技能（由 Agent 按轮次自行选择）</li></ul><h2 id="编写" tabindex="-1">编写 <a class="header-anchor" href="#编写" aria-label="Permalink to &quot;编写&quot;">​</a></h2><p>最小示例：</p><div class="language-markdown vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">markdown</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">---</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#22863A", "--shiki-dark": "#85E89D" })}">name</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">: </span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">web-scraper</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#22863A", "--shiki-dark": "#85E89D" })}">description</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">: </span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">当用户要求从网页提取结构化数据时使用</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">---</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-light-font-weight": "bold", "--shiki-dark": "#79B8FF", "--shiki-dark-font-weight": "bold" })}"># Web Scraper</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">当用户提供 URL 时...</span></span></code></pre></div><p><code>description</code> 是触发该技能的关键 —— 写得越具体，模型就越容易判断何时调用。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("zh/guide/skills.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const skills = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  skills as default
};
