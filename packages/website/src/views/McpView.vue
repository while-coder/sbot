<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from '@/composables/useToast'
import type { McpEntry, McpTool } from '@/types'
import { serverAddr } from '@/utils/mcpSchema'
import McpToolsModal from '@/components/McpToolsModal.vue'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

// ── Search & tab filter ──
const searchQuery = ref('')
const activeTab = ref('all')

const sources = computed(() => {
  const seen = new Set<string>()
  for (const m of store.allMcps) if (m.source) seen.add(m.source)
  return Array.from(seen)
})

const filteredMcps = computed(() => {
  const list = activeTab.value === 'all'
    ? store.allMcps
    : store.allMcps.filter(m => m.source === activeTab.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(m =>
    (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
  )
})

async function load() {
  try {
    const res = await apiFetch('/api/mcp')
    applyMcpList(res.data || [])
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Tools viewer ──
const showToolsModal = ref(false)
const toolsTitle = ref('')
const toolsList = ref<McpTool[]>([])
const toolsLoading = ref(false)

async function viewTools(id: string) {
  toolsTitle.value = store.allMcps.find(m => m.id === id)?.name || id
  toolsList.value = []
  toolsLoading.value = true
  showToolsModal.value = true
  try {
    const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/tools`, 'GET')
    toolsList.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
  }
}

// ── Auto-approve tools ──
function isAutoApproved(toolName: string): boolean {
  return (store.settings.autoApproveTools ?? []).includes(toolName)
}

const allToolsApproved = computed(() =>
  toolsList.value.length > 0 && toolsList.value.every(tool => isAutoApproved(tool.name))
)

async function saveAutoApprove(next: string[]) {
  try {
    const res = await apiFetch('/api/settings/general', 'PUT', { autoApproveTools: next })
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function toggleAutoApprove(toolName: string) {
  const current = store.settings.autoApproveTools ?? []
  const next = current.includes(toolName)
    ? current.filter((n: string) => n !== toolName)
    : [...current, toolName]
  await saveAutoApprove(next)
}

async function approveAll() {
  const names = toolsList.value.map(t => t.name)
  const current = store.settings.autoApproveTools ?? []
  const next = Array.from(new Set([...current, ...names]))
  await saveAutoApprove(next)
}

async function revokeAll() {
  const names = new Set(toolsList.value.map(t => t.name))
  const next = (store.settings.autoApproveTools ?? []).filter((n: string) => !names.has(n))
  await saveAutoApprove(next)
}

// ── Edit / Add modal ──
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: '', type: 'http', url: '',
  headers: {} as Record<string, string>,
  command: '', args: [] as string[],
  env: {} as Record<string, string>,
  cwd: '', toolTimeout: '',
})
const headerRows = ref<{ key: string; value: string }[]>([])
const argsList = ref<string[]>([])
const envRows = ref<{ key: string; value: string }[]>([])

function syncFromForm() {
  headerRows.value = Object.entries(form.value.headers).map(([key, value]) => ({ key, value }))
  argsList.value = [...form.value.args]
  envRows.value = Object.entries(form.value.env).map(([key, value]) => ({ key, value }))
}
function syncToForm() {
  form.value.headers = Object.fromEntries(headerRows.value.filter(r => r.key).map(r => [r.key, r.value]))
  form.value.args = argsList.value.filter(a => a)
  form.value.env = Object.fromEntries(envRows.value.filter(r => r.key).map(r => [r.key, r.value]))
}

function openAdd() {
  editingId.value = null
  form.value = { name: '', type: 'http', url: '', headers: {}, command: '', args: [], env: {}, cwd: '', toolTimeout: '' }
  syncFromForm()
  showModal.value = true
}

function openEdit(id: string) {
  const m: any = store.allMcps.find(m => m.id === id)
  editingId.value = id
  form.value = {
    name: m?.name || id, type: m?.type || 'http', url: m?.url || '',
    headers: { ...(m?.headers || {}) }, command: m?.command || '',
    args: [...(m?.args || [])], env: { ...(m?.env || {}) },
    cwd: m?.cwd || '', toolTimeout: m?.toolTimeout ? String(m.toolTimeout) : '',
  }
  syncFromForm()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  syncToForm()
  try {
    const { name, type, url, headers, command, args, env, cwd, toolTimeout } = form.value
    const config: McpEntry = { type, name: name.trim() } as any
    if (type === 'http') {
      if (!url.trim()) { show(t('mcp.error_url'), 'error'); return }
      config.url = url.trim()
      if (Object.keys(headers).length > 0) config.headers = headers
    } else {
      if (!command.trim()) { show(t('mcp.error_command'), 'error'); return }
      config.command = command.trim()
      if (args.length > 0) config.args = args
      if (Object.keys(env).length > 0) config.env = env
      if (cwd.trim()) config.cwd = cwd.trim()
    }
    if (toolTimeout) config.toolTimeout = parseInt(toolTimeout)
    if (editingId.value) {
      await apiFetch(`/api/mcp/${encodeURIComponent(editingId.value)}`, 'PUT', config)
    } else {
      await apiFetch('/api/mcp', 'POST', config)
    }
    show(t('common.saved'))
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const displayName = store.allMcps.find(m => m.id === id)?.name || id
  if (!confirm(t('mcp.confirm_delete', { name: displayName }))) return
  try {
    await apiFetch(`/api/mcp/${encodeURIComponent(id)}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('mcp.add') }}</button>
    </div>

    <!-- Tab bar + search -->
    <div style="display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #e8e6e3;background:#fff;gap:0;flex-shrink:0">
      <button
        key="all"
        @click="activeTab = 'all'"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
        :style="activeTab === 'all' ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ t('common.all') }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="activeTab === 'all' ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ store.allMcps.length }}</span>
      </button>
      <button
        v-for="src in sources"
        :key="src"
        @click="activeTab = src"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
        :style="activeTab === src ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ src }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="activeTab === src ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ store.allMcps.filter(m => m.source === src).length }}</span>
      </button>
      <div style="flex:1" />
      <input
        v-model="searchQuery"
        :placeholder="t('mcp.search_placeholder')"
        style="width:220px;padding:5px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;color:#1c1c1c;outline:none;background:#fafaf9"
        @focus="($event.target as HTMLInputElement).style.borderColor='#1c1c1c'"
        @blur="($event.target as HTMLInputElement).style.borderColor='#e8e6e3'"
      />
    </div>

    <div class="page-content">
      <table style="table-layout:fixed;width:100%">
        <colgroup>
          <col style="width:220px" />
          <col />
          <col style="width:260px" />
          <col style="width:190px" />
        </colgroup>
        <thead>
          <tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('mcp.address_col') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="filteredMcps.length === 0">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">
              {{ searchQuery.trim() ? t('mcp.no_match') : t('mcp.empty') }}
            </td>
          </tr>
          <tr v-for="m in filteredMcps" :key="m.id">
            <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(m.source)}`">{{ m.source }}</span>{{ m.name }}
            </td>
            <td style="color:#64748b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.description || '—' }}</td>
            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px">{{ serverAddr(m as any) || '—' }}</td>
            <td style="white-space:nowrap">
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="viewTools(m.id)">{{ t('common.view') }}</button>
                <button v-if="m.source !== '内置'" class="btn-outline btn-sm" @click="openEdit(m.id)">{{ t('common.edit') }}</button>
                <button v-if="m.source !== '内置'" class="btn-danger btn-sm" @click="remove(m.id)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit / Add MCP Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingId ? t('mcp.edit_title') : t('mcp.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>{{ t('common.name') }} *</label><input v-model="form.name" :placeholder="t('mcp.name_placeholder')" /></div>
          <div class="form-group"><label>{{ t('mcp.transport_type') }} *</label><select v-model="form.type"><option value="http">{{ t('mcp.transport_http') }}</option><option value="stdio">{{ t('mcp.transport_stdio') }}</option></select></div>
          <template v-if="form.type === 'http'">
            <div class="form-group"><label>{{ t('mcp.url_label') }} *</label><input v-model="form.url" placeholder="http://example.com/mcp" /></div>
            <div class="form-section">
              <div class="form-section-title">{{ t('mcp.headers_section') }}</div>
              <div v-for="(row, i) in headerRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="row.key" placeholder="Key" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <input v-model="row.value" placeholder="Value" style="flex:2;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="headerRows.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="headerRows.push({key:'',value:''})">+ Header</button>
            </div>
          </template>
          <template v-else>
            <div class="form-group"><label>{{ t('mcp.command_label') }} *</label><input v-model="form.command" :placeholder="t('mcp.command_placeholder')" /></div>
            <div class="form-section">
              <div class="form-section-title">{{ t('mcp.args_section') }}</div>
              <div v-for="(_arg, i) in argsList" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="argsList[i]" :placeholder="t('mcp.arg_placeholder')" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="argsList.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="argsList.push('')">{{ t('mcp.add_arg') }}</button>
            </div>
            <div class="form-section">
              <div class="form-section-title">{{ t('mcp.env_section') }}</div>
              <div v-for="(row, i) in envRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="row.key" placeholder="Key" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <input v-model="row.value" placeholder="Value" style="flex:2;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="envRows.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="envRows.push({key:'',value:''})">+ Env</button>
            </div>
            <div class="form-group"><label>{{ t('mcp.cwd_label') }}</label><input v-model="form.cwd" :placeholder="t('mcp.cwd_placeholder')" /></div>
          </template>
          <div class="form-section">
            <div class="form-section-title">高级设置</div>
            <div class="form-group"><label>{{ t('mcp.tool_timeout') }}</label><input v-model="form.toolTimeout" type="number" :placeholder="t('mcp.timeout_placeholder')" /><div class="hint">{{ t('mcp.timeout_hint') }}</div></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <McpToolsModal
      :visible="showToolsModal"
      :title="toolsTitle"
      :tools="toolsList"
      :loading="toolsLoading"
      :auto-approved-tools="store.settings.autoApproveTools ?? []"
      :all-approved="allToolsApproved"
      @update:visible="showToolsModal = $event"
      @toggle-auto-approve="toggleAutoApprove"
      @approve-all="approveAll"
      @revoke-all="revokeAll"
    />
  </div>
</template>
