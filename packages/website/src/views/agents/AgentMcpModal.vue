<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from '@/composables/useToast'
import type { McpEntry, McpTool } from '@/types'
import { serverAddr } from '@/utils/mcpSchema'
import { sourceBadgeStyle } from '@/utils/badges'
import McpToolsModal from '@/components/McpToolsModal.vue'

const { t } = useI18n()

const { show } = useToast()

const visible    = ref(false)
const agentName  = ref('')
const agentDisplayName = computed(() => (store.settings.agents?.[agentName.value] as any)?.name || agentName.value)

const servers       = ref<Record<string, McpEntry>>({})
const useAllMcp     = ref(false)
const origUseAll    = ref(false)
const agentGlobals  = ref<string[]>([])
const activeTab     = ref('all')
const selectedGlobals = ref<string[]>([])
const mcpSearch     = ref('')

const globalsChanged = computed(() => {
  if (useAllMcp.value !== origUseAll.value) return true
  if (useAllMcp.value) return false
  const a = [...selectedGlobals.value].sort().join(',')
  const b = [...agentGlobals.value].sort().join(',')
  return a !== b
})

// ── Source tabs (mirrors AgentSkillsModal pattern) ────────────────
const sources = computed(() => {
  const seen = new Set<string>()
  for (const m of store.allMcps) if (m.source) seen.add(m.source)
  return Array.from(seen)
})

const filteredGlobalMcps = computed(() => {
  const list = activeTab.value === 'all'
    ? store.allMcps
    : store.allMcps.filter(m => m.source === activeTab.value)
  const q = mcpSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(m =>
    (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
  )
})

function apiBase() {
  return `/api/agents/${encodeURIComponent(agentName.value)}/mcp`
}

async function load() {
  try {
    const agent = (store.settings.agents || {})[agentName.value]
    const isAll = agent?.mcp === '*'
    useAllMcp.value  = isAll
    origUseAll.value = isAll
    const [res, globalRes] = await Promise.all([
      apiFetch(apiBase()),
      apiFetch('/api/mcp'),
    ])
    const rawServers: any[] = res.data?.servers || []
    servers.value = Object.fromEntries(rawServers.map(({ id, source: _s, ...rest }: any) => [id, rest]))
    const globalsFromApi: string[] = (res.data?.globals || []).map((m: any) => m.id)
    agentGlobals.value = isAll ? [] : globalsFromApi
    selectedGlobals.value = isAll ? [] : [...globalsFromApi]
    applyMcpList(globalRes.data || [])
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function saveGlobals() {
  try {
    const existing = (store.settings.agents || {})[agentName.value] || {}
    const mcpValue = useAllMcp.value ? '*' : selectedGlobals.value
    const res = await apiFetch(
      `/api/settings/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, mcp: mcpValue },
    )
    Object.assign(store.settings, res.data)
    origUseAll.value = useAllMcp.value
    agentGlobals.value = useAllMcp.value ? [] : [...selectedGlobals.value]
    show(t('common.saved'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function viewGlobalTools(id: string) {
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

// ── MCP Edit Modal ───────────────────────────────────────────────
const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref({
  name: '', type: 'http', url: '',
  headers: {} as Record<string, string>,
  command: '', args: [] as string[],
  env: {} as Record<string, string>,
  cwd: '', toolTimeout: '', description: '',
})
const headerRows = ref<{ key: string; value: string }[]>([])
const argsList   = ref<string[]>([])
const envRows    = ref<{ key: string; value: string }[]>([])

function syncFromForm() {
  headerRows.value = Object.entries(form.value.headers).map(([key, value]) => ({ key, value }))
  argsList.value   = [...form.value.args]
  envRows.value    = Object.entries(form.value.env).map(([key, value]) => ({ key, value }))
}
function syncToForm() {
  form.value.headers = Object.fromEntries(headerRows.value.filter(r => r.key).map(r => [r.key, r.value]))
  form.value.args    = argsList.value.filter(a => a)
  form.value.env     = Object.fromEntries(envRows.value.filter(r => r.key).map(r => [r.key, r.value]))
}
function openAdd() {
  editingName.value = null
  form.value = { name: '', type: 'http', url: '', headers: {}, command: '', args: [], env: {}, cwd: '', toolTimeout: '', description: '' }
  syncFromForm()
  showModal.value = true
}
function openEdit(id: string) {
  const s = servers.value[id]
  editingName.value = id
  form.value = {
    name: (s as any).name || id, type: s.type || 'http', url: s.url || '',
    headers: { ...(s.headers || {}) }, command: s.command || '',
    args: [...(s.args || [])], env: { ...(s.env || {}) },
    cwd: s.cwd || '', toolTimeout: s.toolTimeout ? String(s.toolTimeout) : '',
    description: (s as any).description || '',
  }
  syncFromForm()
  showModal.value = true
}
async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  syncToForm()
  try {
    const { name, type, url, headers, command, args, env, cwd, toolTimeout, description } = form.value
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
    if (description.trim()) (config as any).description = description.trim()
    if (editingName.value) {
      await apiFetch(`${apiBase()}/${encodeURIComponent(editingName.value)}`, 'PUT', config)
    } else {
      await apiFetch(apiBase(), 'POST', config)
    }
    show(t('common.saved'))
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}
async function remove(id: string) {
  const displayName = (servers.value[id] as any)?.name || id
  if (!window.confirm(t('mcp.confirm_delete', { name: displayName }))) return
  try {
    await apiFetch(`${apiBase()}/${encodeURIComponent(id)}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Auto-approve tools (agent-level) ────────────────────────────
function getAgentAutoApproveTools(): string[] {
  return ((store.settings.agents || {})[agentName.value] as any)?.autoApproveTools ?? []
}

function isAutoApproved(toolName: string): boolean {
  return getAgentAutoApproveTools().includes(toolName)
}

const allToolsApproved = computed(() =>
  toolsList.value.length > 0 && toolsList.value.every(tool => isAutoApproved(tool.name))
)

async function saveAutoApprove(next: string[]) {
  try {
    const existing = (store.settings.agents || {})[agentName.value] || {}
    const res = await apiFetch(
      `/api/settings/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, autoApproveTools: next },
    )
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function toggleAutoApprove(toolName: string) {
  const current = getAgentAutoApproveTools()
  const next = current.includes(toolName)
    ? current.filter((n: string) => n !== toolName)
    : [...current, toolName]
  await saveAutoApprove(next)
}

async function approveAll() {
  const names = toolsList.value.map(t => t.name)
  const current = getAgentAutoApproveTools()
  const next = Array.from(new Set([...current, ...names]))
  await saveAutoApprove(next)
}

async function revokeAll() {
  const names = new Set(toolsList.value.map(t => t.name))
  const next = getAgentAutoApproveTools().filter((n: string) => !names.has(n))
  await saveAutoApprove(next)
}

// ── Tools Viewer ─────────────────────────────────────────────────
const showToolsModal = ref(false)
const toolsTitle     = ref('')
const toolsList      = ref<McpTool[]>([])
const toolsLoading   = ref(false)

async function viewTools(id: string) {
  toolsTitle.value = (servers.value[id] as any)?.name || id
  toolsList.value = []
  toolsLoading.value = true

  showToolsModal.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName.value)}/mcp/${encodeURIComponent(id)}/tools`, 'GET')
    toolsList.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
  }
}

// ── Public API ───────────────────────────────────────────────────
function open(name: string) {
  agentName.value       = name
  servers.value         = {}
  agentGlobals.value    = []
  selectedGlobals.value = []
  activeTab.value       = 'all'
  mcpSearch.value       = ''
  visible.value         = true
  load()
}

defineExpose({ open })
</script>

<template>
  <template v-if="visible">
    <!-- ── Main modal ──────────────────────────────────────────── -->
    <div class="modal-overlay" @click.self="visible = false">
      <div class="modal-box" style="width:90vw;max-width:1100px;height:82vh;display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="modal-header" style="padding:14px 20px;flex-shrink:0">
          <h3>{{ agentDisplayName }} — {{ t('agents.mcp_title') }}</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
            <button class="modal-close" @click="visible = false">&times;</button>
          </div>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#fff;padding:0 20px;flex-shrink:0">
          <button
            @click="activeTab = 'all'"
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
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
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
            :style="activeTab === src ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
          >
            {{ src }}
            <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
              :style="activeTab === src ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
            >{{ store.allMcps.filter((m: { source?: string }) => m.source === src).length }}</span>
          </button>
          <button
            @click="activeTab = t('agents.mcp_exclusive_tab')"
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
            :style="activeTab === t('agents.mcp_exclusive_tab') ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
          >
            {{ t('agents.mcp_exclusive_tab') }}
            <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
              :style="activeTab === t('agents.mcp_exclusive_tab') ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
            >{{ Object.keys(servers).length }}</span>
          </button>
        </div>

        <!-- Content -->
        <div style="flex:1;overflow:auto;padding:16px 20px">

          <!-- Global MCPs tab -->
          <template v-if="activeTab !== t('agents.mcp_exclusive_tab')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;flex-shrink:0;padding:4px 10px;background:#f8fafc;border:1px solid #e8e6e3;border-radius:6px">
                <input type="checkbox" v-model="useAllMcp" style="width:14px;height:14px;cursor:pointer" />
                {{ t('agents.use_all') }}
              </label>
              <input v-if="!useAllMcp" v-model="mcpSearch" :placeholder="t('mcp.search_placeholder')" style="flex:1;padding:6px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;outline:none" />
              <div v-else style="flex:1" />
              <button class="btn-primary btn-sm" :disabled="!globalsChanged" @click="saveGlobals">{{ t('common.save') }}</button>
              <span v-if="globalsChanged" style="font-size:12px;color:#f59e0b;white-space:nowrap">{{ t('common.unsaved_changes') }}</span>
            </div>
            <div v-if="store.allMcps.length === 0" style="text-align:center;color:#94a3b8;padding:40px">{{ t('mcp.no_global') }}</div>
            <div v-else style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden">
              <div v-if="filteredGlobalMcps.length === 0" style="padding:20px;text-align:center;color:#9b9b9b;font-size:13px">{{ t('mcp.no_match') }}</div>
              <label
                v-for="m in filteredGlobalMcps" :key="m.id"
                style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:13px"
                :style="selectedGlobals.includes(m.id) ? 'background:#fafaf9' : ''"
              >
                <input type="checkbox" :value="m.id" v-model="selectedGlobals" :disabled="useAllMcp" :checked="useAllMcp || selectedGlobals.includes(m.id)" style="cursor:pointer;flex-shrink:0;width:14px;height:14px" />
                <span :style="`flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(m.source)}`">{{ m.source }}</span>
                <span style="font-family:monospace;font-weight:500;width:200px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.name }}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#64748b">{{ m.description || '-' }}</span>
                <button class="btn-outline btn-sm" style="flex-shrink:0;padding:2px 8px;font-size:11px" @click.prevent="viewGlobalTools(m.id)">{{ t('common.view') }}</button>
              </label>
            </div>
          </template>

          <!-- Private servers tab -->
          <template v-else>
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
              <button class="btn-primary btn-sm" @click="openAdd">{{ t('mcp.add') }}</button>
            </div>
            <div v-if="Object.keys(servers).length === 0" style="text-align:center;color:#94a3b8;padding:40px">{{ t('mcp.no_exclusive') }}</div>
            <table v-else style="table-layout:fixed;width:100%">
              <colgroup>
                <col style="width:200px" />
                <col />
                <col style="width:220px" />
                <col style="width:190px" />
              </colgroup>
              <thead><tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('mcp.address_col') }}</th><th>{{ t('common.ops') }}</th></tr></thead>
              <tbody>
                <tr v-for="(s, id) in servers" :key="id">
                  <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (s as any).name || id }}</td>
                  <td style="color:#64748b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (s as any).description || '—' }}</td>
                  <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px">{{ serverAddr(s) }}</td>
                  <td style="white-space:nowrap">
                    <div class="ops-cell">
                      <button class="btn-outline btn-sm" @click="viewTools(id as string)">{{ t('common.view') }}</button>
                      <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                      <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>

    <!-- ── MCP Edit sub-modal ─────────────────────────────────── -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName ? t('mcp.edit_title') : t('mcp.add_title') }}</h3>
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
          <div class="form-group"><label>{{ t('common.description') }}</label><input v-model="form.description" placeholder="服务描述（可选）" /></div>
          <div class="form-section">
            <div class="form-section-title">高级设置</div>
            <div class="form-group"><label>{{ t('mcp.tool_timeout') }}</label><input v-model="form.toolTimeout" type="number" :placeholder="t('mcp.timeout_placeholder')" /></div>
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
      :auto-approved-tools="getAgentAutoApproveTools()"
      :all-approved="allToolsApproved"
      @update:visible="showToolsModal = $event"
      @toggle-auto-approve="toggleAutoApprove"
      @approve-all="approveAll"
      @revoke-all="revokeAll"
    />
  </template>
</template>
