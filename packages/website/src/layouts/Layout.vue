<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const route = useRoute()
const { show } = useToast()

const menuGroups = [
  {
    group: '聊天',
    items: [
      { label: '聊天', key: '/chat' },
      { label: '目录', key: '/directory' },
      { label: '频道管理', key: '/channels' },
    ],
  },
  {
    group: '基础',
    items: [
      { label: '基本设置', key: '/settings' },
    ],
  },
  {
    group: '模型',
    items: [
      { label: '语言模型', key: '/models' },
      { label: '向量模型', key: '/embeddings' },
    ],
  },
  {
    group: '智能体',
    items: [
      { label: '智能体管理', key: '/agents' },
      { label: '会话存储', key: '/savers' },
      { label: '记忆配置', key: '/memories' },
      { label: '工具管理', key: '/mcp' },
      { label: '技能管理', key: '/skills' },
    ],
  },
  {
    group: '管理',
    items: [
      { label: '计时器管理', key: '/scheduler' },
      { label: '关于', key: '/about' },
    ],
  },
]

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/agents/')) return '/agents'
  if (p.startsWith('/agent/mcp/')) return '/mcp'
  if (p.startsWith('/savers/') && p.endsWith('/view')) return '/savers'
  if (p.startsWith('/memories/') && p.endsWith('/view')) return '/memories'
  return p
})

async function reloadConfig() {
  try {
    await apiFetch('/api/reload', 'POST')
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const mcpRes = await apiFetch('/api/mcp')
    store.mcpServers = mcpRes.data?.servers || {}
    store.mcpBuiltins = mcpRes.data?.builtins || []
    show('配置已重载')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const hasUpdate = ref(false)

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

async function checkUpdate(currentVersion: string) {
  try {
    const res = await fetch('https://api.github.com/repos/while-coder/sbot/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return
    const data = await res.json()
    const latest = (data.tag_name as string) || ''
    if (latest && compareSemver(currentVersion, latest) < 0) hasUpdate.value = true
  } catch {}
}

// Initial load
async function init() {
  try {
    const [settingsRes, mcpRes, skillRes, aboutRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/mcp'),
      apiFetch('/api/skills'),
      apiFetch('/api/about'),
    ])
    Object.assign(store.settings, settingsRes.data)
    store.mcpServers = mcpRes.data?.servers || {}
    store.mcpBuiltins = mcpRes.data?.builtins || []
    const allSkillsData = skillRes.data || []
    store.allSkills = allSkillsData
    if (aboutRes.data?.version) checkUpdate(aboutRes.data.version)
  } catch (_) {}
}

init()
</script>

<template>
  <div class="app-layout">
    <div class="topbar">
      <div class="topbar-title">SBot 设置</div>
      <button class="btn-outline btn-sm" @click="reloadConfig">重载配置</button>
    </div>
    <div class="app-body">
      <div class="sidebar">
        <template v-for="group in menuGroups" :key="group.group">
          <div class="sidebar-group-label">{{ group.group }}</div>
          <div
            v-for="item in group.items"
            :key="item.key"
            class="sidebar-item"
            :class="{ active: activeKey === item.key }"
            @click="router.push(item.key)"
          >
            {{ item.label }}
            <span v-if="item.key === '/about' && hasUpdate" class="update-dot"></span>
          </div>
        </template>
      </div>
      <div class="main-content">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body {
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: #1c1c1c;
  background: #fff;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid #e8e6e3;
  background: #fff;
  flex-shrink: 0;
}
.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1c;
}
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.sidebar {
  width: 168px;
  border-right: 1px solid #e8e6e3;
  background: #fff;
  padding: 8px;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar-group-label {
  padding: 16px 8px 5px;
  font-size: 12px;
  font-weight: 700;
  color: #3d3d3d;
  user-select: none;
  border-top: 1px solid #e8e6e3;
  margin-top: 4px;
}
.sidebar-group-label:first-of-type {
  padding-top: 6px;
  border-top: none;
  margin-top: 0;
}
.sidebar-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #6b6b6b;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  border-radius: 6px;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.update-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  margin-left: auto;
}
.sidebar-item:hover { background: #f5f4f2; color: #1c1c1c; }
.sidebar-item.active { background: #fafaf9; color: #1c1c1c; font-weight: 600; }
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Page layout */
.page-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid #e8e6e3;
  background: #fff;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.table-link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  font-family: monospace;
  color: #4f46e5;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color .15s, color .15s;
}
.table-link-btn:hover {
  color: #3730a3;
  text-decoration-color: #3730a3;
}
.chat-info-chip {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 3px 10px;
  background: #f4f3f1;
  border: 1px solid #e8e6e3;
  border-radius: 12px;
  color: #555;
  cursor: pointer;
  transition: background .15s, border-color .15s;
  white-space: nowrap;
}
.chat-info-chip:hover {
  background: #eceae6;
  border-color: #ccc;
}
.page-toolbar-title {
  font-weight: 600;
  font-size: 14px;
  color: #1c1c1c;
}
.page-content {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.card {
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b6b6b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* Forms */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #3d3d3d;
}
.form-group input,
.form-group select,
.form-group textarea {
  padding: 6px 10px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  font-size: 13px;
  color: #1c1c1c;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus { border-color: #1c1c1c; }
.form-group textarea { resize: vertical; }
.form-group input:disabled { background: #f5f4f2; color: #9b9b9b; }
.form-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e8e6e3;
}
.form-details {
  margin-top: 12px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  overflow: hidden;
}
.form-details-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #3b3a38;
  cursor: pointer;
  user-select: none;
  background: #fafaf9;
  list-style: none;
}
.form-details-summary::-webkit-details-marker { display: none; }
.form-details-summary::before { content: '▶'; font-size: 10px; color: #9b9b9b; transition: transform .15s; }
details[open] > .form-details-summary::before { transform: rotate(90deg); }
.form-details-badge {
  margin-left: 4px;
  background: #3b82f6;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
}
.form-details-body {
  padding: 12px;
  border-top: 1px solid #e8e6e3;
}
.form-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #6b6b6b;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
.inline-form { display: flex; gap: 16px; flex-wrap: wrap; }
.inline-form .form-group { flex: 1; min-width: 200px; }

/* Buttons */
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s, opacity 0.15s;
  font-family: inherit;
  line-height: 1.4;
}
button:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: #1c1c1c; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #333; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-outline { background: transparent; border: 1px solid #d6d4d0; color: #3d3d3d; }
.btn-outline:hover:not(:disabled) { background: #f5f4f2; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Table */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
table th, table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e8e6e3;
}
table th {
  font-weight: 600;
  color: #6b6b6b;
  background: #fafaf9;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
table tr:hover td { background: #fafaf9; }
.ops-cell { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-box {
  background: #fff;
  border-radius: 10px;
  width: 520px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
.modal-box.wide { width: 660px; }
.modal-box.xl   { width: min(92vw, 1040px); }
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.modal-header h3 { font-size: 15px; font-weight: 600; color: #1c1c1c; }
.modal-header-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #9b9b9b;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal-close:hover { color: #3d3d3d; }
.modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e8e6e3;
  flex-shrink: 0;
}

/* Check items */
.check-row { display: flex; flex-wrap: wrap; gap: 8px; }
.check-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: #fafaf9;
  user-select: none;
}
.check-item:hover { background: #ebe9e6; }
.check-item input[type=checkbox] { cursor: pointer; }
.tag-select-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 28px; }
.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #e8e6e3;
  border-radius: 4px;
  font-size: 12px;
  color: #3b3a38;
}
.tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: #888;
  padding: 0 1px;
}
.tag-remove:hover { color: #e53e3e; }
.tag-add-select {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px dashed #bbb;
  border-radius: 4px;
  background: #fafaf9;
  color: #555;
  cursor: pointer;
  height: 24px;
}
.section-disabled { opacity: 0.4; pointer-events: none; user-select: none; }
.section-disabled * { pointer-events: none; }

/* MCP Tools Viewer */
.tools-loading { text-align:center; color:#9b9b9b; padding:40px 0; font-size:14px; }
.tools-count { font-size:12px; color:#9b9b9b; font-weight:400; margin-left:8px; }
.tools-list { list-style:none; margin:0; padding:0; }
.tools-list li { padding:12px 20px; border-bottom:1px solid #f0efed; }
.tools-list li:last-child { border-bottom:none; }
.tools-list li:hover { background:#fafaf9; }
.tool-header { display:flex; align-items:center; gap:8px; }
.tool-header .tool-name { flex:1; }
.tool-name { font-size:13px; font-weight:600; color:#1c1c1c; font-family:'Consolas','Monaco',monospace; cursor:pointer; user-select:none; }
.tool-name::before { content:'\25B6'; font-size:9px; margin-right:6px; color:#9b9b9b; display:inline-block; transition:transform .15s; }
.tool-name.expanded::before { transform:rotate(90deg); }
.tool-desc { font-size:12px; color:#6b6b6b; margin-top:3px; line-height:1.5; }
.tool-params { display:none; margin-top:8px; border-left:2px solid #e8e6e3; padding-left:12px; }
.tool-params.show { display:block; }
.tool-param { padding:5px 0; font-size:12px; line-height:1.5; }
.tool-param + .tool-param { border-top:1px solid #f5f4f2; }
.param-name { font-family:'Consolas','Monaco',monospace; font-weight:600; color:#1c1c1c; }
.param-type { color:#8b5cf6; font-size:11px; margin-left:4px; }
.param-required { color:#ef4444; font-size:10px; font-weight:600; margin-left:4px; }
.param-desc { color:#6b6b6b; margin-top:1px; }
.param-enum { color:#0891b2; font-size:11px; font-family:'Consolas','Monaco',monospace; }
.param-default { color:#9b9b9b; font-size:11px; }
.tool-no-params { font-size:12px; color:#9b9b9b; font-style:italic; padding:4px 0; }

/* Toast */
.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: #1c1c1c;
  color: #fff;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  pointer-events: none;
}
.toast.error { background: #ef4444; }

/* Sub-agent */
.sub-agent-item {
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  background: #fafaf9;
}
.sub-agent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-agent-item-name { font-size: 13px; font-weight: 500; font-family: monospace; }
.sub-agent-item-desc { font-size: 11px; color: #6b6b6b; margin-top: 3px; }

/* Chat */
.history-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}
.msg-row { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }
.msg-row.human { align-self: flex-end; align-items: flex-end; }
.msg-row.ai { align-self: flex-start; align-items: flex-start; max-width: 90%; }
.msg-role-bar {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.msg-time {
  font-size: 10px;
  opacity: 0.5;
}
.msg-bubble.human .msg-time { color: #fff; }
.msg-bubble.ai    .msg-time { color: #3d3d3d; }
.msg-date-sep {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 8px;
  color: #b0aead;
  font-size: 12px;
}
.msg-date-sep::before,
.msg-date-sep::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #ebe9e6;
}
.msg-bubble {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-bubble.human { background: #1c1c1c; color: #fff; border-bottom-right-radius: 3px; }
.msg-bubble.ai { background: #f5f4f2; color: #1c1c1c; border-bottom-left-radius: 3px; }
.msg-bubble.tool { background: #fefce8; color: #713f12; font-family: monospace; font-size: 12px; }
.msg-bubble.streaming { opacity: 0.85; }
.md-content { white-space: normal; line-height: 1.65; }
.md-content p { margin: 0 0 8px; }
.md-content p:last-child { margin-bottom: 0; }
.md-content h1, .md-content h2, .md-content h3, .md-content h4 { margin: 10px 0 5px; font-weight: 700; line-height: 1.3; }
.md-content h1 { font-size: 1.2em; }
.md-content h2 { font-size: 1.1em; }
.md-content h3 { font-size: 1em; }
.md-content ul, .md-content ol { margin: 0 0 8px; padding-left: 20px; }
.md-content li { margin-bottom: 2px; }
.md-content pre { background: rgba(0,0,0,0.06); border-radius: 5px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.md-content code { font-family: 'Consolas','Monaco',monospace; font-size: 12px; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; }
.md-content pre code { background: none; padding: 0; font-size: 11px; }
.md-content blockquote { border-left: 3px solid #d6d4d0; margin: 6px 0; padding: 3px 10px; color: #6b6b6b; }
.md-content strong { font-weight: 700; }
.md-content em { font-style: italic; }
.md-content a { color: inherit; text-decoration: underline; }
.md-content hr { border: none; border-top: 1px solid #e8e6e3; margin: 10px 0; }
.md-content table { margin: 6px 0; font-size: 12px; }
.md-content table th, .md-content table td { padding: 4px 8px; border: 1px solid #e8e6e3; }
.md-content table th { background: #f5f4f2; font-weight: 600; }
.msg-role {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.msg-tool-calls {
  background: #fafaf9;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 6px;
  font-size: 12px;
  max-width: 520px;
  min-width: 200px;
}
.tool-call-item { border: 1px solid #e8e6e3; border-radius: 6px; margin-top: 6px; overflow: hidden; }
.tool-call-header {
  padding: 6px 10px;
  background: #f5f4f2;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
  user-select: none;
}
.tool-call-header::after { content: '▶'; font-size: 10px; color: #9b9b9b; }
.tool-call-header.expanded::after { content: '▼'; }
.tool-call-name { font-family: monospace; color: #1c1c1c; font-size: 12px; }
.tool-call-detail { display: none; padding: 8px 10px; }
.tool-call-detail.show { display: block; }
.tool-call-args {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: #3d3d3d;
  background: #fafaf9;
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
}
.tool-call-result { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e8e6e3; }
.tool-call-result-label { font-weight: 600; color: #6b6b6b; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; }
.chat-input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e8e6e3;
  background: #fff;
  flex-shrink: 0;
}
.chat-input-bar textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  font-size: 13px;
  resize: none;
  max-height: 160px;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
}
.chat-input-bar textarea:focus { border-color: #1c1c1c; }
.chat-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid #e8e6e3;
  background: #fffbeb;
  flex-shrink: 0;
}
.chat-queue-label { font-size: 12px; font-weight: 600; color: #92400e; }
.chat-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
}
.chat-queue-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3d3d3d; }
.chat-queue-del { background: none; border: none; cursor: pointer; color: #9b9b9b; font-size: 16px; padding: 0; line-height: 1; }

/* Row dropdown */
.row-dropdown {
  position: relative;
  display: inline-block;
}
.row-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 200;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.12);
  min-width: 90px;
  padding: 4px 0;
}
.row-dropdown-menu button {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-radius: 0;
  text-align: left;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #3d3d3d;
}
.row-dropdown-menu button:hover:not(:disabled) {
  background: #f5f4f2;
}
.row-dropdown-menu button:disabled {
  color: #b0b0b0;
  cursor: default;
}
</style>
