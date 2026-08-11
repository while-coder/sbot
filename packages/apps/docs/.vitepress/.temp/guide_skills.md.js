import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Skills","description":"","frontmatter":{},"headers":[],"relativePath":"guide/skills.md","filePath":"guide/skills.md"}');
const _sfc_main = { name: "guide/skills.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="skills" tabindex="-1">Skills <a class="header-anchor" href="#skills" aria-label="Permalink to &quot;Skills&quot;">​</a></h1><p>Sidebar → <strong>Skills</strong></p><p>Skills are installable Markdown prompt modules that extend agent capabilities with specialized knowledge or workflows. They are loaded into the system prompt only when the model decides a skill is relevant, keeping idle context cost low.</p><h2 id="storage" tabindex="-1">Storage <a class="header-anchor" href="#storage" aria-label="Permalink to &quot;Storage&quot;">​</a></h2><p>Skill files live in <code>~/.sbot/skills/</code>. Each skill is a <code>SKILL.md</code> file with frontmatter (<code>name</code>, <code>description</code>) plus body.</p><h2 id="installation" tabindex="-1">Installation <a class="header-anchor" href="#installation" aria-label="Permalink to &quot;Installation&quot;">​</a></h2><p>Ways to add skills:</p><ul><li><strong>Search &amp; install from a hub</strong> — built-in registries: Clawhub, skills.sh, skillhub.cn</li><li><strong>Install by URL</strong> — paste a supported skill URL from a hub</li><li><strong>Install from ZIP</strong> — upload one or more <code>.zip</code> files that contain <code>SKILL.md</code></li><li><strong>Manual</strong> — drop <code>SKILL.md</code> files into <code>~/.sbot/skills/</code> directly</li></ul><h2 id="assignment" tabindex="-1">Assignment <a class="header-anchor" href="#assignment" aria-label="Permalink to &quot;Assignment&quot;">​</a></h2><p>In an agent → <strong>Skills</strong> tab:</p><ul><li>Select specific skills to load</li><li>Or leave empty to load <strong>all</strong> available skills (the agent picks per turn)</li></ul><h2 id="authoring" tabindex="-1">Authoring <a class="header-anchor" href="#authoring" aria-label="Permalink to &quot;Authoring&quot;">​</a></h2><p>Minimal example:</p><div class="language-markdown vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">markdown</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">---</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#22863A", "--shiki-dark": "#85E89D" })}">name</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">: </span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">web-scraper</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#22863A", "--shiki-dark": "#85E89D" })}">description</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">: </span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">Use when the user asks to extract structured data from a webpage</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">---</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-light-font-weight": "bold", "--shiki-dark": "#79B8FF", "--shiki-dark-font-weight": "bold" })}"># Web Scraper</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">When the user provides a URL...</span></span></code></pre></div><p>The <code>description</code> is what triggers the skill — make it specific so the model can decide when to invoke it.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/skills.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const skills = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  skills as default
};
