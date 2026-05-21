<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store, applyMcpList } from '@/shared/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SFormSection, STabBar, STab, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import { McpTransport } from '@/shared/types'
import type { McpEntry, McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/shared/types'
import { serverAddr } from '@/utils/mcpSchema'
import McpToolsModal from '@/components/modals/McpToolsModal.vue'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

const searchQuery = ref('')
const activeTab = ref('all')

const columns = computed<STableColumn[]>(() => [
  { key: 'name',        label: t('common.name'),        primary: true, ellipsis: true, width: '220px' },
  { key: 'description', label: t('common.description'), ellipsis: true },
  { key: 'address',     label: t('mcp.address_col'),    ellipsis: true, width: '260px' },
  { key: 'ops',         label: t('common.ops'),         ops: true,     width: '190px' },
])

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

const showToolsModal = ref(false)
const toolsTitle = ref('')
const toolsList = ref<McpTool[]>([])
const promptsList = ref<McpPrompt[]>([])
const resourcesList = ref<McpResource[]>([])
const resourceTemplatesList = ref<McpResourceTemplate[]>([])
const toolsLoading = ref(false)

async function viewTools(id: string) {
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

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: '', type: McpTransport.Http, url: '',
  headers: {} as Record<string, string>,
  command: '', args: [] as string[],
  env: {} as Record<string, string>,
  cwd: '', toolTimeout: '',
  enablePromptTools: false, enableResourceTools: false,
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
  form.value = { name: '', type: McpTransport.Http, url: '', headers: {}, command: '', args: [], env: {}, cwd: '', toolTimeout: '', enablePromptTools: false, enableResourceTools: false }
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
    enablePromptTools: !!m?.enablePromptTools, enableResourceTools: !!m?.enableResourceTools,
  }
  syncFromForm()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  syncToForm()
  try {
    const { name, type, url, headers, command, args, env, cwd, toolTimeout, enablePromptTools, enableResourceTools } = form.value
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
    if (enablePromptTools) config.enablePromptTools = true
    if (enableResourceTools) config.enableResourceTools = true
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
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('mcp.add') }}</SButton>
    </SPageToolbar>

    <STabBar v-model="activeTab">
      <STab name="all" :count="store.allMcps.length">{{ t('common.all') }}</STab>
      <STab
        v-for="src in sources"
        :key="src"
        :name="src"
        :count="store.allMcps.filter(m => m.source === src).length"
      >{{ src }}</STab>
      <div class="tab-bar-spacer" />
      <SInput v-model="searchQuery" size="sm" :placeholder="t('mcp.search_placeholder')" class="mcp-search" />
    </STabBar>

    <SPageContent>
      <STable
        :columns="columns"
        :rows="filteredMcps"
        row-key="id"
        :empty-text="searchQuery.trim() ? t('mcp.no_match') : t('mcp.empty')"
      >
        <template #name="{ row }">
          <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(row.source)}`">{{ row.source }}</span>
          <span style="font-family:var(--sui-font-mono)">{{ row.name }}</span>
        </template>
        <template #description="{ row }">
          <span class="mcp-desc">{{ row.description || '—' }}</span>
        </template>
        <template #address="{ row }">
          <span class="mcp-addr">{{ serverAddr(row as any) || '—' }}</span>
        </template>
        <template #ops="{ row }">
          <div class="ops-cell">
            <SButton type="outline" size="sm" @click="viewTools(row.id)">{{ t('common.view') }}</SButton>
            <SButton v-if="row.source !== '内置'" type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton v-if="row.source !== '内置'" type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <!-- Edit / Add MCP Modal -->
    <SModal v-model:visible="showModal" :title="editingId ? t('mcp.edit_title') : t('mcp.add_title')" width="md">
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
          <div v-for="(row, i) in headerRows" :key="i" class="kv-row">
            <SInput v-model="row.key" size="sm" placeholder="Key" class="kv-key" />
            <SInput v-model="row.value" size="sm" placeholder="Value" class="kv-value" />
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
          <div v-for="(_arg, i) in argsList" :key="i" class="kv-row">
            <SInput v-model="argsList[i]" size="sm" :placeholder="t('mcp.arg_placeholder')" class="kv-flex" />
            <SButton type="danger" size="sm" @click="argsList.splice(i,1)">×</SButton>
          </div>
          <SButton type="outline" size="sm" @click="argsList.push('')">{{ t('mcp.add_arg') }}</SButton>
        </SFormSection>
        <SFormSection :title="t('mcp.env_section')">
          <div v-for="(row, i) in envRows" :key="i" class="kv-row">
            <SInput v-model="row.key" size="sm" placeholder="Key" class="kv-key" />
            <SInput v-model="row.value" size="sm" placeholder="Value" class="kv-value" />
            <SButton type="danger" size="sm" @click="envRows.splice(i,1)">×</SButton>
          </div>
          <SButton type="outline" size="sm" @click="envRows.push({key:'',value:''})">+ Env</SButton>
        </SFormSection>
        <SFormItem :label="t('mcp.cwd_label')">
          <SInput v-model="form.cwd" :placeholder="t('mcp.cwd_placeholder')" />
        </SFormItem>
      </template>
      <SFormSection title="高级设置">
        <SFormItem :label="t('mcp.tool_timeout')" :hint="t('mcp.timeout_hint')">
          <SInput v-model="form.toolTimeout" type="number" :placeholder="t('mcp.timeout_placeholder')" />
        </SFormItem>
        <div class="check-row">
          <label class="checkbox-label">
            <input v-model="form.enablePromptTools" type="checkbox" />
            <span>{{ t('mcp.enable_prompt_tools') }}</span>
          </label>
          <span class="check-hint">{{ t('mcp.enable_prompt_tools_hint') }}</span>
        </div>
        <div class="check-row">
          <label class="checkbox-label">
            <input v-model="form.enableResourceTools" type="checkbox" />
            <span>{{ t('mcp.enable_resource_tools') }}</span>
          </label>
          <span class="check-hint">{{ t('mcp.enable_resource_tools_hint') }}</span>
        </div>
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
      :auto-approved-tools="store.settings.autoApproveTools ?? []"
      :all-approved="allToolsApproved"
      @update:visible="showToolsModal = $event"
      @toggle-auto-approve="toggleAutoApprove"
      @approve-all="approveAll"
      @revoke-all="revokeAll"
    />
  </div>
</template>

<style scoped>
.tab-bar-spacer { flex: 1; }
.mcp-search { width: 220px; }
.mcp-desc {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.mcp-addr {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}

.kv-row {
  display: flex;
  gap: var(--sui-sp-3);
  align-items: center;
  margin-bottom: var(--sui-sp-2);
}
.kv-key { flex: 1; }
.kv-value { flex: 2; }
.kv-flex { flex: 1; }

.check-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-4);
  margin-bottom: var(--sui-sp-3);
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.check-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
</style>
