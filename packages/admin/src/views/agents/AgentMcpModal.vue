<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from 'sbot-ui'
import { McpTransport } from '@/types'
import type { McpEntry, McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/types'
import { serverAddr } from '@/utils/mcpSchema'
import { sourceBadgeStyle } from '@/utils/badges'
import McpToolsModal from '@/components/McpToolsModal.vue'
import { SModal, SButton, SInput, SSelect, SFormItem, SFormSection, STabBar, STab, SCheckCard } from 'sbot-ui'

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
    await apiFetch(
      `/api/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, mcp: mcpValue },
    )
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
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
  promptsList.value = []
  resourcesList.value = []
  resourceTemplatesList.value = []
  toolsLoading.value = true

  showToolsModal.value = true
  try {
    const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/details`, 'GET')
    toolsList.value = res.data?.tools || []
    promptsList.value = res.data?.prompts || []
    resourcesList.value = res.data?.resources || []
    resourceTemplatesList.value = res.data?.resourceTemplates || []
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
  name: '', type: McpTransport.Http, url: '',
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
  form.value = { name: '', type: McpTransport.Http, url: '', headers: {}, command: '', args: [], env: {}, cwd: '', toolTimeout: '', description: '' }
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
    if (type === McpTransport.Http || type === McpTransport.Sse) {
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
    await apiFetch(
      `/api/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, autoApproveTools: next },
    )
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
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
const promptsList    = ref<McpPrompt[]>([])
const resourcesList  = ref<McpResource[]>([])
const resourceTemplatesList = ref<McpResourceTemplate[]>([])
const toolsLoading   = ref(false)

async function viewTools(id: string) {
  toolsTitle.value = (servers.value[id] as any)?.name || id
  toolsList.value = []
  promptsList.value = []
  resourcesList.value = []
  resourceTemplatesList.value = []
  toolsLoading.value = true

  showToolsModal.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName.value)}/mcp/${encodeURIComponent(id)}/details`, 'GET')
    toolsList.value = res.data?.tools || []
    promptsList.value = res.data?.prompts || []
    resourcesList.value = res.data?.resources || []
    resourceTemplatesList.value = res.data?.resourceTemplates || []
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
    <SModal v-model:visible="visible" width="xl">
      <template #header>
        <h3 class="s-modal-title">{{ agentDisplayName }} — {{ t('agents.mcp_title') }}</h3>
        <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      </template>

      <!-- Tab bar -->
      <template #toolbar>
        <STabBar v-model="activeTab" style="padding:0;border:none;background:transparent">
          <STab name="all" :count="store.allMcps.length">{{ t('common.all') }}</STab>
          <STab
            v-for="src in sources"
            :key="src"
            :name="src"
            :count="store.allMcps.filter((m: { source?: string }) => m.source === src).length"
          >{{ src }}</STab>
          <STab :name="t('agents.mcp_exclusive_tab')" :count="Object.keys(servers).length">{{ t('agents.mcp_exclusive_tab') }}</STab>
        </STabBar>
      </template>

      <div style="height:62vh;overflow:auto">
        <!-- Global MCPs tab -->
        <template v-if="activeTab !== t('agents.mcp_exclusive_tab')">
          <div class="picker-toolbar">
            <SCheckCard v-model="useAllMcp">{{ t('agents.use_all') }}</SCheckCard>
            <SInput v-if="!useAllMcp" v-model="mcpSearch" :placeholder="t('mcp.search_placeholder')" size="sm" style="flex:1" />
            <div v-else style="flex:1" />
            <SButton type="primary" size="sm" :disabled="!globalsChanged" @click="saveGlobals">{{ t('common.save') }}</SButton>
            <span v-if="globalsChanged" class="picker-unsaved">{{ t('common.unsaved_changes') }}</span>
          </div>
          <div v-if="store.allMcps.length === 0" class="picker-empty">{{ t('mcp.no_global') }}</div>
          <div v-else class="picker-list">
            <div v-if="filteredGlobalMcps.length === 0" class="picker-list-empty">{{ t('mcp.no_match') }}</div>
            <label
              v-for="m in filteredGlobalMcps" :key="m.id"
              class="picker-row"
              :class="{ checked: selectedGlobals.includes(m.id) }"
            >
              <input type="checkbox" :value="m.id" v-model="selectedGlobals" :disabled="useAllMcp" :checked="useAllMcp || selectedGlobals.includes(m.id)" />
              <span :style="`flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(m.source)}`">{{ m.source }}</span>
              <span class="picker-row-name">{{ m.name }}</span>
              <span class="picker-row-desc">{{ m.description || '-' }}</span>
              <SButton type="outline" size="sm" @click.prevent="viewGlobalTools(m.id)">{{ t('common.view') }}</SButton>
            </label>
          </div>
        </template>

        <!-- Private servers tab -->
        <template v-else>
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <SButton type="primary" size="sm" @click="openAdd">{{ t('mcp.add') }}</SButton>
          </div>
          <div v-if="Object.keys(servers).length === 0" class="picker-empty">{{ t('mcp.no_exclusive') }}</div>
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
                <td style="font-family:var(--sui-font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (s as any).name || id }}</td>
                <td style="color:var(--sui-fg-muted);font-size:var(--sui-fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (s as any).description || '—' }}</td>
                <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sui-fg-disabled);font-size:var(--sui-fs-sm)">{{ serverAddr(s) }}</td>
                <td style="white-space:nowrap">
                  <div class="ops-cell">
                    <SButton type="outline" size="sm" @click="viewTools(id as string)">{{ t('common.view') }}</SButton>
                    <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
                    <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </SModal>

    <!-- ── MCP Edit sub-modal ─────────────────────────────────── -->
    <SModal v-model:visible="showModal" :title="editingName ? t('mcp.edit_title') : t('mcp.add_title')" width="md" nested>
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('mcp.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('mcp.transport_type') + ' *'">
        <SSelect v-model="form.type">
          <option :value="McpTransport.Http">{{ t('mcp.transport_http') }}</option>
          <option :value="McpTransport.Sse">{{ t('mcp.transport_sse') }}</option>
          <option :value="McpTransport.Stdio">{{ t('mcp.transport_stdio') }}</option>
        </SSelect>
      </SFormItem>
      <template v-if="form.type === McpTransport.Http || form.type === McpTransport.Sse">
        <SFormItem :label="t('mcp.url_label') + ' *'">
          <SInput v-model="form.url" placeholder="http://example.com/mcp" />
        </SFormItem>
        <SFormSection :title="t('mcp.headers_section')">
          <div v-for="(row, i) in headerRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
            <SInput v-model="row.key" placeholder="Key" size="sm" style="flex:1" />
            <SInput v-model="row.value" placeholder="Value" size="sm" style="flex:2" />
            <SButton type="danger" size="sm" @click="headerRows.splice(i,1)">×</SButton>
          </div>
          <SButton type="outline" size="sm" @click="headerRows.push({key:'',value:''})">+ Header</SButton>
        </SFormSection>
      </template>
      <template v-else>
        <SFormItem :label="t('mcp.command_label') + ' *'">
          <SInput v-model="form.command" :placeholder="t('mcp.command_placeholder')" />
        </SFormItem>
        <SFormSection :title="t('mcp.args_section')">
          <div v-for="(_arg, i) in argsList" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
            <SInput v-model="argsList[i]" :placeholder="t('mcp.arg_placeholder')" size="sm" style="flex:1" />
            <SButton type="danger" size="sm" @click="argsList.splice(i,1)">×</SButton>
          </div>
          <SButton type="outline" size="sm" @click="argsList.push('')">{{ t('mcp.add_arg') }}</SButton>
        </SFormSection>
        <SFormSection :title="t('mcp.env_section')">
          <div v-for="(row, i) in envRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
            <SInput v-model="row.key" placeholder="Key" size="sm" style="flex:1" />
            <SInput v-model="row.value" placeholder="Value" size="sm" style="flex:2" />
            <SButton type="danger" size="sm" @click="envRows.splice(i,1)">×</SButton>
          </div>
          <SButton type="outline" size="sm" @click="envRows.push({key:'',value:''})">+ Env</SButton>
        </SFormSection>
        <SFormItem :label="t('mcp.cwd_label')">
          <SInput v-model="form.cwd" :placeholder="t('mcp.cwd_placeholder')" />
        </SFormItem>
      </template>
      <SFormItem :label="t('common.description')">
        <SInput v-model="form.description" placeholder="服务描述（可选）" />
      </SFormItem>
      <SFormSection title="高级设置">
        <SFormItem :label="t('mcp.tool_timeout')">
          <SInput v-model="form.toolTimeout" type="number" :placeholder="t('mcp.timeout_placeholder')" />
        </SFormItem>
      </SFormSection>

      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <McpToolsModal
      :visible="showToolsModal"
      :title="toolsTitle"
      :tools="toolsList"
      :prompts="promptsList"
      :resources="resourcesList"
      :resource-templates="resourceTemplatesList"
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

<style scoped>
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
}
.picker-unsaved {
  font-size: var(--sui-fs-sm);
  color: var(--sui-warning);
  white-space: nowrap;
}
.picker-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.picker-list {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  overflow: hidden;
}
.picker-list-empty {
  padding: 20px;
  text-align: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-4);
  padding: var(--sui-sp-3) var(--sui-sp-5);
  cursor: pointer;
  border-bottom: 1px solid var(--sui-border-subtle);
  font-size: var(--sui-fs-md);
}
.picker-row:last-child { border-bottom: none; }
.picker-row.checked { background: var(--sui-bg-subtle); }
.picker-row input[type="checkbox"] { cursor: pointer; flex-shrink: 0; width: 14px; height: 14px; }
.picker-row-name {
  font-family: var(--sui-font-mono);
  font-weight: 500;
  width: 200px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-row-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
</style>
