<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const route = useRoute()
const { show } = useToast()

const menuItems = [
  { label: '基本设置', key: '/settings' },
  { label: '聊天', key: '/chat' },
  { label: 'Agent 管理', key: '/agents' },
  { label: '模型管理', key: '/models' },
  { label: 'Embedding 管理', key: '/embeddings' },
  { label: '会话存储', key: '/savers' },
  { label: '记忆配置', key: '/memories' },
  { label: 'MCP 服务', key: '/mcp' },
  { label: 'Skills 管理', key: '/skills' },
]

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/agents/') && p.endsWith('/skills')) return '/agents'
  if (p.startsWith('/mcp/agent/')) return '/mcp'
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

// Initial load
async function init() {
  try {
    const [settingsRes, mcpRes, skillRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/mcp'),
      apiFetch('/api/skills'),
    ])
    Object.assign(store.settings, settingsRes.data)
    store.mcpServers = mcpRes.data?.servers || {}
    store.mcpBuiltins = mcpRes.data?.builtins || []
    store.skillBuiltins = skillRes.data?.builtins || []
    store.globalSkills = skillRes.data?.skills || []
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
        <div
          v-for="item in menuItems"
          :key="item.key"
          class="sidebar-item"
          :class="{ active: activeKey === item.key }"
          @click="router.push(item.key)"
        >
          {{ item.label }}
        </div>
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #1e293b;
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
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  flex-shrink: 0;
}
.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
}
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.sidebar {
  width: 168px;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 8px 0;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar-item {
  padding: 9px 16px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  border-radius: 0;
  user-select: none;
}
.sidebar-item:hover { background: #e2e8f0; color: #1e293b; }
.sidebar-item.active { background: #e0e7ff; color: #4f46e5; font-weight: 600; }
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
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.page-toolbar-title {
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
}
.page-content {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: #fff;
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
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
  color: #374151;
}
.form-group input,
.form-group select,
.form-group textarea {
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  color: #1e293b;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus { border-color: #6366f1; }
.form-group textarea { resize: vertical; }
.form-group input:disabled { background: #f1f5f9; color: #94a3b8; }
.form-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}
.form-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint { font-size: 11px; color: #94a3b8; margin-top: 2px; }
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
button:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #6366f1; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #4f46e5; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-outline { background: transparent; border: 1px solid #cbd5e1; color: #374151; }
.btn-outline:hover:not(:disabled) { background: #f1f5f9; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Table */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
table th, table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
}
table th {
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
table tr:hover td { background: #f8fafc; }
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
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
}
.modal-box.wide { width: 660px; }
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.modal-header h3 { font-size: 15px; font-weight: 600; color: #1e293b; }
.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal-close:hover { color: #374151; }
.modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}

/* Check items */
.check-row { display: flex; flex-wrap: wrap; gap: 8px; }
.check-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: #f8fafc;
  user-select: none;
}
.check-item:hover { background: #e2e8f0; }
.check-item input[type=checkbox] { cursor: pointer; }
.section-disabled { opacity: 0.4; pointer-events: none; user-select: none; }
.section-disabled * { pointer-events: none; }

/* MCP Tools Viewer */
.tools-loading { text-align:center; color:#94a3b8; padding:40px 0; font-size:14px; }
.tools-count { font-size:12px; color:#94a3b8; font-weight:400; margin-left:8px; }
.tools-list { list-style:none; margin:0; padding:0; }
.tools-list li { padding:12px 20px; border-bottom:1px solid #f1f5f9; }
.tools-list li:last-child { border-bottom:none; }
.tools-list li:hover { background:#f8fafc; }
.tool-header { display:flex; align-items:center; gap:8px; }
.tool-header .tool-name { flex:1; }
.tool-name { font-size:13px; font-weight:600; color:#1e293b; font-family:'Consolas','Monaco',monospace; cursor:pointer; user-select:none; }
.tool-name::before { content:'\25B6'; font-size:9px; margin-right:6px; color:#94a3b8; display:inline-block; transition:transform .15s; }
.tool-name.expanded::before { transform:rotate(90deg); }
.tool-desc { font-size:12px; color:#64748b; margin-top:3px; line-height:1.5; }
.tool-params { display:none; margin-top:8px; border-left:2px solid #e2e8f0; padding-left:12px; }
.tool-params.show { display:block; }
.tool-param { padding:5px 0; font-size:12px; line-height:1.5; }
.tool-param + .tool-param { border-top:1px solid #f8fafc; }
.param-name { font-family:'Consolas','Monaco',monospace; font-weight:600; color:#1e293b; }
.param-type { color:#8b5cf6; font-size:11px; margin-left:4px; }
.param-required { color:#ef4444; font-size:10px; font-weight:600; margin-left:4px; }
.param-desc { color:#64748b; margin-top:1px; }
.param-enum { color:#0891b2; font-size:11px; font-family:'Consolas','Monaco',monospace; }
.param-default { color:#94a3b8; font-size:11px; }
.tool-no-params { font-size:12px; color:#94a3b8; font-style:italic; padding:4px 0; }

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
  background: #1e293b;
  color: #fff;
  z-index: 9999;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  pointer-events: none;
}
.toast.error { background: #ef4444; }

/* Sub-agent */
.sub-agent-item {
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
}
.sub-agent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-agent-item-name { font-size: 13px; font-weight: 500; font-family: monospace; }
.sub-agent-item-desc { font-size: 11px; color: #64748b; margin-top: 3px; }

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
.msg-ts { font-size: 11px; color: #94a3b8; }
.msg-bubble {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-bubble.human { background: #6366f1; color: #fff; border-bottom-right-radius: 3px; }
.msg-bubble.ai { background: #f1f5f9; color: #1e293b; border-bottom-left-radius: 3px; }
.msg-bubble.tool { background: #fefce8; color: #713f12; font-family: monospace; font-size: 12px; }
.msg-bubble.streaming { opacity: 0.85; }
.msg-role {
  font-size: 10px;
  font-weight: 700;
  margin-bottom: 4px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.msg-tool-calls {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 6px;
  font-size: 12px;
  max-width: 520px;
  min-width: 200px;
}
.tool-call-item { border: 1px solid #e2e8f0; border-radius: 6px; margin-top: 6px; overflow: hidden; }
.tool-call-header {
  padding: 6px 10px;
  background: #f1f5f9;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
  user-select: none;
}
.tool-call-header::after { content: '▶'; font-size: 10px; color: #94a3b8; }
.tool-call-header.expanded::after { content: '▼'; }
.tool-call-name { font-family: monospace; color: #6366f1; font-size: 12px; }
.tool-call-detail { display: none; padding: 8px 10px; }
.tool-call-detail.show { display: block; }
.tool-call-args {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: #374151;
  background: #f8fafc;
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
}
.tool-call-result { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0; }
.tool-call-result-label { font-weight: 600; color: #475569; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; }
.chat-input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
  flex-shrink: 0;
}
.chat-input-bar textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  resize: none;
  max-height: 160px;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
}
.chat-input-bar textarea:focus { border-color: #6366f1; }
.chat-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid #e2e8f0;
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
.chat-queue-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #374151; }
.chat-queue-del { background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 16px; padding: 0; line-height: 1; }
</style>
