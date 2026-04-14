<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

// ── Types ──
interface AgentRequires {
  skills?: string[]
  mcpServers?: string[]
  subAgents?: string[]
}

interface AgentPackage {
  id: string
  name: string
  description?: string
  version: string
  author?: string
  tags?: string[]
  agent: { type: string; model?: string; systemPrompt?: string; [k: string]: any }
  requires?: AgentRequires
}

interface BrowsedAgent {
  sourceUrl: string
  sourceName?: string
  installed: boolean
  installedId?: string
  hasUpdate: boolean
  pkg: AgentPackage
}

interface AgentSourceEntry {
  url: string
  name?: string
}

interface AgentUpdateDiff {
  id: string
  oldVersion: string
  newVersion: string
  changes?: string
  pkg: AgentPackage
}

// ── State ──
const agents = ref<BrowsedAgent[]>([])
const sources = ref<AgentSourceEntry[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedSource = ref('__all__')
const updateDiffs = ref<Map<string, AgentUpdateDiff>>(new Map())

// ── Computed ──
const filteredAgents = computed(() => {
  let list = agents.value
  if (selectedSource.value !== '__all__') {
    list = list.filter(a => a.sourceUrl === selectedSource.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(a =>
    a.pkg.name.toLowerCase().includes(q)
    || a.pkg.id.toLowerCase().includes(q)
    || (a.pkg.description || '').toLowerCase().includes(q)
    || (a.pkg.tags || []).some(tag => tag.toLowerCase().includes(q))
  )
})

const requiresTotal = (r?: AgentRequires): number => {
  if (!r) return 0
  return (r.skills?.length || 0) + (r.mcpServers?.length || 0) + (r.subAgents?.length || 0)
}

const requiresSummary = (r?: AgentRequires): string => {
  if (!r) return ''
  const parts: string[] = []
  if (r.skills?.length) parts.push(`${r.skills.length} skill${r.skills.length > 1 ? 's' : ''}`)
  if (r.mcpServers?.length) parts.push(`${r.mcpServers.length} MCP`)
  if (r.subAgents?.length) parts.push(`${r.subAgents.length} agent${r.subAgents.length > 1 ? 's' : ''}`)
  return parts.join(', ')
}

// ── Data loading ──
async function loadSources() {
  try {
    const res = await apiFetch('/api/agent-store/sources')
    sources.value = Array.isArray(res) ? res : (res.data ?? [])
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadAgents() {
  loading.value = true
  try {
    const res = await apiFetch('/api/agent-store/browse')
    agents.value = Array.isArray(res) ? res : (res.data ?? [])
  } catch (e: any) {
    show(t('agentStore.fetch_error'), 'error')
  } finally {
    loading.value = false
  }
}

async function reload() {
  await Promise.all([loadSources(), loadAgents()])
}

// ── Source management modal ──
const showSourceModal = ref(false)
const sourceUrl = ref('')
const sourceName = ref('')
const sourceAdding = ref(false)

function openAddSource() {
  sourceUrl.value = ''
  sourceName.value = ''
  showSourceModal.value = true
}

async function addSource() {
  const url = sourceUrl.value.trim()
  if (!url) return
  sourceAdding.value = true
  try {
    await apiFetch('/api/agent-store/sources', 'POST', {
      url,
      name: sourceName.value.trim() || undefined,
    })
    show(t('agentStore.source_added'))
    showSourceModal.value = false
    await reload()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    sourceAdding.value = false
  }
}

async function removeSource(index: number) {
  if (!confirm(t('agentStore.source_removed') + '?')) return
  try {
    await apiFetch(`/api/agent-store/sources/${index}`, 'DELETE')
    show(t('agentStore.source_removed'))
    await reload()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Install ──
const showInstallModal = ref(false)
const installTarget = ref<BrowsedAgent | null>(null)
const installOverwrite = ref(false)
const installing = ref(false)

function openInstall(agent: BrowsedAgent) {
  installTarget.value = agent
  installOverwrite.value = false
  showInstallModal.value = true
}

async function confirmInstall() {
  if (!installTarget.value) return
  installing.value = true
  try {
    const res = await apiFetch('/api/agent-store/install', 'POST', {
      pkg: installTarget.value.pkg,
      overwrite: installOverwrite.value,
      sourceUrl: installTarget.value.sourceUrl,
    })
    if (res.data?.settings) Object.assign(store.settings, res.data.settings)
    show(t('agentStore.install_success'))
    showInstallModal.value = false
    await loadAgents()
  } catch (e: any) {
    // If conflict, prompt overwrite
    if (e.message && e.message.includes('exist')) {
      installOverwrite.value = true
      show(t('agentStore.confirm_overwrite', { id: installTarget.value.pkg.id }), 'error')
    } else {
      show(e.message, 'error')
    }
  } finally {
    installing.value = false
  }
}

// ── Update ──
const checkingUpdates = ref(false)

async function checkUpdates() {
  checkingUpdates.value = true
  try {
    const res = await apiFetch('/api/agent-store/check-updates', 'POST')
    const diffs: AgentUpdateDiff[] = Array.isArray(res) ? res : (res.data ?? [])
    updateDiffs.value = new Map(diffs.map(d => [d.id, d]))
    if (diffs.length === 0) {
      show(t('agentStore.no_updates'))
    } else {
      show(t('agentStore.updates_found', { count: diffs.length }))
      // Mark hasUpdate on agents
      for (const a of agents.value) {
        if (updateDiffs.value.has(a.pkg.id)) {
          a.hasUpdate = true
        }
      }
    }
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    checkingUpdates.value = false
  }
}

const showUpdateModal = ref(false)
const updateTarget = ref<BrowsedAgent | null>(null)
const updating = ref(false)

function openUpdate(agent: BrowsedAgent) {
  updateTarget.value = agent
  showUpdateModal.value = true
}

async function confirmUpdate() {
  if (!updateTarget.value) return
  updating.value = true
  try {
    const res = await apiFetch(
      `/api/agent-store/update/${encodeURIComponent(updateTarget.value.pkg.id)}`,
      'POST',
      { pkg: updateTarget.value.pkg },
    )
    if (res.data?.settings) Object.assign(store.settings, res.data.settings)
    show(t('agentStore.update_success'))
    showUpdateModal.value = false
    updateDiffs.value.delete(updateTarget.value.pkg.id)
    await loadAgents()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    updating.value = false
  }
}

// ── Import dropdown ──
const showImportMenu = ref(false)

function toggleImportMenu() {
  showImportMenu.value = !showImportMenu.value
}

function closeImportMenu() {
  showImportMenu.value = false
}

// ── Import from file ──
const showFilePreview = ref(false)
const filePkg = ref<AgentPackage | null>(null)
const fileImporting = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerFileImport() {
  closeImportMenu()
  fileInputRef.value?.click()
}

function onFileSelected(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string)
      filePkg.value = data
      showFilePreview.value = true
    } catch {
      show('Invalid JSON file', 'error')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

async function confirmFileImport() {
  if (!filePkg.value) return
  fileImporting.value = true
  try {
    const res = await apiFetch('/api/agent-store/import', 'POST', filePkg.value)
    if (res.data?.settings) Object.assign(store.settings, res.data.settings)
    show(t('agentStore.import_success'))
    showFilePreview.value = false
    await loadAgents()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    fileImporting.value = false
  }
}

// ── Import from URL ──
const showUrlModal = ref(false)
const importUrl = ref('')
const urlPkg = ref<AgentPackage | null>(null)
const urlFetching = ref(false)
const urlImporting = ref(false)

function openUrlImport() {
  closeImportMenu()
  importUrl.value = ''
  urlPkg.value = null
  showUrlModal.value = true
}

async function fetchUrlPkg() {
  const url = importUrl.value.trim()
  if (!url) return
  urlFetching.value = true
  try {
    const res = await apiFetch('/api/agent-store/import-url', 'POST', { url })
    urlPkg.value = res.data ?? res
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    urlFetching.value = false
  }
}

async function confirmUrlImport() {
  if (!urlPkg.value) return
  urlImporting.value = true
  try {
    const res = await apiFetch('/api/agent-store/install', 'POST', { pkg: urlPkg.value })
    if (res.data?.settings) Object.assign(store.settings, res.data.settings)
    show(t('agentStore.import_success'))
    showUrlModal.value = false
    await loadAgents()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    urlImporting.value = false
  }
}

// ── Init ──
onMounted(reload)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="openAddSource">{{ t('agentStore.add_source') }}</button>
      <button class="btn-outline btn-sm" :disabled="checkingUpdates" @click="checkUpdates">
        {{ checkingUpdates ? t('agentStore.loading') : t('agentStore.check_updates') }}
      </button>
      <!-- Import dropdown -->
      <div class="row-dropdown" style="position:relative">
        <button class="btn-primary btn-sm" @click="toggleImportMenu">
          Import &#x25BE;
        </button>
        <div v-if="showImportMenu" class="row-dropdown-menu" style="min-width:140px">
          <button @click="triggerFileImport">{{ t('agentStore.import_file') }}</button>
          <button @click="openUrlImport">{{ t('agentStore.import_url') }}</button>
        </div>
      </div>
      <input
        ref="fileInputRef"
        type="file"
        accept=".json"
        style="display:none"
        @change="onFileSelected"
      />
    </div>

    <!-- Source tabs + Search -->
    <div style="display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #e8e6e3;background:#fff;gap:0;flex-shrink:0;flex-wrap:wrap">
      <button
        @click="selectedSource = '__all__'"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
        :style="selectedSource === '__all__' ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ t('agentStore.source_all') }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="selectedSource === '__all__' ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ agents.length }}</span>
      </button>
      <button
        v-for="(src, idx) in sources"
        :key="src.url"
        @click="selectedSource = src.url"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s;display:flex;align-items:center;gap:4px"
        :style="selectedSource === src.url ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ src.name || src.url }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="selectedSource === src.url ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ agents.filter(a => a.sourceUrl === src.url).length }}</span>
        <span
          @click.stop="removeSource(idx)"
          style="margin-left:2px;font-size:14px;color:#9b9b9b;cursor:pointer;line-height:1"
          title="Remove source"
        >&times;</span>
      </button>
      <div style="flex:1" />
      <input
        v-model="searchQuery"
        :placeholder="t('agentStore.search_placeholder')"
        style="width:220px;padding:5px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;color:#1c1c1c;outline:none;background:#fafaf9"
        @focus="($event.target as HTMLInputElement).style.borderColor='#1c1c1c'"
        @blur="($event.target as HTMLInputElement).style.borderColor='#e8e6e3'"
      />
    </div>

    <!-- Content area -->
    <div class="page-content">
      <!-- Loading -->
      <div v-if="loading" style="text-align:center;color:#94a3b8;padding:60px;font-size:14px">
        {{ t('agentStore.loading') }}
      </div>

      <!-- No sources hint -->
      <div v-else-if="sources.length === 0 && agents.length === 0" style="text-align:center;padding:60px;color:#94a3b8">
        <div style="font-size:14px;margin-bottom:8px">{{ t('agentStore.no_sources') }}</div>
        <div style="font-size:13px">{{ t('agentStore.add_source_hint') }}</div>
        <button class="btn-primary btn-sm" style="margin-top:16px" @click="openAddSource">{{ t('agentStore.add_source') }}</button>
      </div>

      <!-- No agents -->
      <div v-else-if="filteredAgents.length === 0" style="text-align:center;padding:60px;color:#94a3b8;font-size:14px">
        {{ t('agentStore.no_agents') }}
      </div>

      <!-- Agent grid -->
      <div v-else class="store-grid">
        <div v-for="a in filteredAgents" :key="a.sourceUrl + ':' + a.pkg.id" class="store-card">
          <!-- Header -->
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:600;color:#1c1c1c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ a.pkg.name }}</div>
              <div style="font-family:monospace;font-size:11px;color:#9b9b9b;margin-top:2px">{{ a.pkg.id }}</div>
            </div>
            <span :class="'agent-type-badge agent-type-' + a.pkg.agent.type">{{ a.pkg.agent.type }}</span>
          </div>

          <!-- Version & Author -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:#6b6b6b">
            <span>v{{ a.pkg.version }}</span>
            <span v-if="a.pkg.author" style="color:#9b9b9b">@{{ a.pkg.author }}</span>
          </div>

          <!-- Description -->
          <div style="font-size:13px;color:#475569;line-height:1.5;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:39px">
            {{ a.pkg.description || '-' }}
          </div>

          <!-- Tags -->
          <div v-if="a.pkg.tags?.length" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">
            <span
              v-for="tag in a.pkg.tags"
              :key="tag"
              style="font-size:10px;padding:1px 6px;border-radius:8px;background:#f0efed;color:#6b6b6b;font-weight:500"
            >{{ tag }}</span>
          </div>

          <!-- Requires -->
          <div style="font-size:12px;color:#9b9b9b;margin-bottom:12px">
            <template v-if="requiresTotal(a.pkg.requires) > 0">
              {{ t('agentStore.requires') }}: {{ requiresSummary(a.pkg.requires) }}
            </template>
            <template v-else>
              {{ t('agentStore.no_deps') }}
            </template>
          </div>

          <!-- Action button -->
          <div style="display:flex;gap:6px">
            <template v-if="a.installed && a.hasUpdate">
              <span class="store-installed-badge">{{ t('agentStore.installed') }}</span>
              <button class="btn-primary btn-sm" @click="openUpdate(a)">{{ t('agentStore.update') }}</button>
            </template>
            <template v-else-if="a.installed">
              <span class="store-installed-badge">{{ t('agentStore.installed') }}</span>
            </template>
            <template v-else>
              <button class="btn-primary btn-sm" @click="openInstall(a)">{{ t('agentStore.install') }}</button>
            </template>
          </div>

          <!-- Update available dot -->
          <div v-if="a.hasUpdate && a.installed" class="store-update-dot" :title="t('agentStore.has_update')"></div>
        </div>
      </div>
    </div>

    <!-- ── Add Source Modal ── -->
    <div v-if="showSourceModal" class="modal-overlay" @click.self="showSourceModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('agentStore.add_source') }}</h3>
          <button class="modal-close" @click="showSourceModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('agentStore.source_url') }}</label>
            <input
              v-model="sourceUrl"
              placeholder="https://example.com/agents.json"
              @keydown.enter="addSource"
            />
          </div>
          <div class="form-group">
            <label>{{ t('agentStore.source_name') }}</label>
            <input
              v-model="sourceName"
              :placeholder="t('agentStore.source_name')"
              @keydown.enter="addSource"
            />
          </div>
          <!-- Existing sources list -->
          <div v-if="sources.length > 0" style="margin-top:16px;border-top:1px solid #e8e6e3;padding-top:12px">
            <div style="font-size:12px;font-weight:600;color:#6b6b6b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">
              {{ t('agentStore.source_all') }}
            </div>
            <div v-for="(src, idx) in sources" :key="src.url" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0efed">
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;color:#1c1c1c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ src.name || src.url }}</div>
                <div v-if="src.name" style="font-size:11px;color:#9b9b9b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ src.url }}</div>
              </div>
              <button class="btn-danger btn-sm" @click="removeSource(idx)">{{ t('common.delete') }}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showSourceModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="sourceAdding || !sourceUrl.trim()" @click="addSource">
            {{ sourceAdding ? t('agentStore.loading') : t('agentStore.add_source') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Install Confirm Modal ── -->
    <div v-if="showInstallModal && installTarget" class="modal-overlay" @click.self="showInstallModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('agentStore.install') }}</h3>
          <button class="modal-close" @click="showInstallModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ installTarget.pkg.name }}</span>
              <span :class="'agent-type-badge agent-type-' + installTarget.pkg.agent.type">{{ installTarget.pkg.agent.type }}</span>
            </div>
            <div style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ installTarget.pkg.id }} v{{ installTarget.pkg.version }}</div>
          </div>
          <div v-if="installTarget.pkg.description" style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5">{{ installTarget.pkg.description }}</div>
          <div v-if="requiresTotal(installTarget.pkg.requires) > 0" style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            {{ t('agentStore.requires') }}: {{ requiresSummary(installTarget.pkg.requires) }}
          </div>
          <div v-if="installTarget.installed" style="padding:10px 12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;margin-bottom:12px">
            {{ t('agentStore.confirm_overwrite', { id: installTarget.pkg.id }) }}
          </div>
          <label v-if="installTarget.installed" style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" v-model="installOverwrite" />
            {{ t('agentStore.confirm_overwrite', { id: installTarget.pkg.id }) }}
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showInstallModal = false">{{ t('common.cancel') }}</button>
          <button
            class="btn-primary"
            :disabled="installing || (installTarget.installed && !installOverwrite)"
            @click="confirmInstall"
          >
            {{ installing ? t('agentStore.loading') : t('agentStore.install') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Update Confirm Modal ── -->
    <div v-if="showUpdateModal && updateTarget" class="modal-overlay" @click.self="showUpdateModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('agentStore.update') }}</h3>
          <button class="modal-close" @click="showUpdateModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ updateTarget.pkg.name }}</span>
              <span :class="'agent-type-badge agent-type-' + updateTarget.pkg.agent.type">{{ updateTarget.pkg.agent.type }}</span>
            </div>
            <div style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ updateTarget.pkg.id }}</div>
          </div>
          <!-- Version change -->
          <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px;display:flex;align-items:center;gap:8px">
            <span v-if="updateDiffs.get(updateTarget.pkg.id)">
              v{{ updateDiffs.get(updateTarget.pkg.id)!.oldVersion }}
            </span>
            <span style="color:#9b9b9b">&rarr;</span>
            <span style="font-weight:600;color:#1c1c1c">v{{ updateTarget.pkg.version }}</span>
          </div>
          <!-- Changes -->
          <div v-if="updateDiffs.get(updateTarget.pkg.id)?.changes" style="margin-bottom:12px">
            <div style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:6px">{{ t('agentStore.changes') }}</div>
            <pre style="margin:0;padding:10px;background:#fafaf9;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#1e293b;max-height:200px;overflow:auto">{{ updateDiffs.get(updateTarget.pkg.id)!.changes }}</pre>
          </div>
          <div style="font-size:13px;color:#475569">{{ t('agentStore.confirm_update') }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showUpdateModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="updating" @click="confirmUpdate">
            {{ updating ? t('agentStore.loading') : t('agentStore.update') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── File Import Preview Modal ── -->
    <div v-if="showFilePreview && filePkg" class="modal-overlay" @click.self="showFilePreview = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('agentStore.import_file') }}</h3>
          <button class="modal-close" @click="showFilePreview = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ filePkg.name }}</span>
              <span v-if="filePkg.agent?.type" :class="'agent-type-badge agent-type-' + filePkg.agent.type">{{ filePkg.agent.type }}</span>
            </div>
            <div style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ filePkg.id }} v{{ filePkg.version }}</div>
          </div>
          <div v-if="filePkg.description" style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5">{{ filePkg.description }}</div>
          <div v-if="filePkg.author" style="font-size:12px;color:#6b6b6b;margin-bottom:12px">{{ t('agentStore.author') }}: {{ filePkg.author }}</div>
          <div v-if="requiresTotal(filePkg.requires) > 0" style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            {{ t('agentStore.requires') }}: {{ requiresSummary(filePkg.requires) }}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showFilePreview = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="fileImporting" @click="confirmFileImport">
            {{ fileImporting ? t('agentStore.loading') : t('agentStore.install') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── URL Import Modal ── -->
    <div v-if="showUrlModal" class="modal-overlay" @click.self="showUrlModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('agentStore.import_url') }}</h3>
          <button class="modal-close" @click="showUrlModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>URL</label>
            <input
              v-model="importUrl"
              :placeholder="t('agentStore.import_url_placeholder')"
              @keydown.enter="fetchUrlPkg"
            />
          </div>
          <button
            class="btn-primary btn-sm"
            :disabled="urlFetching || !importUrl.trim()"
            style="margin-bottom:16px"
            @click="fetchUrlPkg"
          >
            {{ urlFetching ? t('agentStore.loading') : t('common.view') }}
          </button>

          <!-- Preview -->
          <div v-if="urlPkg" style="border-top:1px solid #e8e6e3;padding-top:12px">
            <div style="margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ urlPkg.name }}</span>
                <span v-if="urlPkg.agent?.type" :class="'agent-type-badge agent-type-' + urlPkg.agent.type">{{ urlPkg.agent.type }}</span>
              </div>
              <div style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ urlPkg.id }} v{{ urlPkg.version }}</div>
            </div>
            <div v-if="urlPkg.description" style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5">{{ urlPkg.description }}</div>
            <div v-if="urlPkg.author" style="font-size:12px;color:#6b6b6b;margin-bottom:12px">{{ t('agentStore.author') }}: {{ urlPkg.author }}</div>
            <div v-if="requiresTotal(urlPkg.requires) > 0" style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
              {{ t('agentStore.requires') }}: {{ requiresSummary(urlPkg.requires) }}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showUrlModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="urlImporting || !urlPkg" @click="confirmUrlImport">
            {{ urlImporting ? t('agentStore.loading') : t('agentStore.install') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.store-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.store-card {
  position: relative;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 16px 20px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s, border-color 0.15s;
}
.store-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border-color: #d6d4d0;
}

.store-installed-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
  background: #dcfce7;
  color: #166534;
}

.store-update-dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}

.agent-type-badge {
  display: inline-block;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}
.agent-type-react {
  background: #ede9fe;
  color: #6d28d9;
}
.agent-type-single {
  background: #f0f4f8;
  color: #64748b;
}

@media (max-width: 1024px) {
  .store-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .store-grid {
    grid-template-columns: 1fr;
  }
}
</style>
