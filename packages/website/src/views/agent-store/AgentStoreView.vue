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
interface AgentPackageVersion {
  version: string
  agent: { type: string; model?: string; systemPrompt?: string; skills?: string[]; agents?: { id: string }[]; mcp?: string[]; [k: string]: any }
  agentMcp?: { mcpServers: Record<string, unknown> }
  globalMcp?: { mcpServers: Record<string, unknown> }
}

interface AgentPackage {
  id: string
  name: string
  description?: string
  author?: string
  tags?: string[]
  versions: AgentPackageVersion[]
}

interface BrowsedAgent {
  sourceUrl: string
  sourceName?: string
  installed: boolean
  pkg: AgentPackage
}

interface AgentSourceEntry {
  url: string
  name?: string
}

// ── State ──
const agents = ref<BrowsedAgent[]>([])
const sources = ref<AgentSourceEntry[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedSource = ref('__all__')

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

const depsTotal = (agent: AgentPackageVersion['agent']): number => {
  return (agent.skills?.length || 0) + (agent.agents?.length || 0)
}

const depsSummary = (agent: AgentPackageVersion['agent']): string => {
  const parts: string[] = []
  if (agent.skills?.length) parts.push(`${agent.skills.length} skill${agent.skills.length > 1 ? 's' : ''}`)
  if (agent.agents?.length) parts.push(`${agent.agents.length} agent${agent.agents.length > 1 ? 's' : ''}`)
  return parts.join(', ')
}

function isInstalled(pkgId: string): boolean {
  return pkgId in (store.settings.agents ?? {})
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
    const results: BrowsedAgent[] = []
    await Promise.all(sources.value.map(async (src) => {
      try {
        const remote: { name?: string; agents?: AgentPackage[] } = await apiFetch(
          `/api/agent-store/proxy?url=${encodeURIComponent(src.url)}`,
        )
        const pkgs = remote?.agents
        if (!Array.isArray(pkgs)) return
        for (const pkg of pkgs) {
          if (!pkg.id) continue
          results.push({
            sourceUrl: src.url,
            sourceName: src.name ?? remote.name,
            installed: isInstalled(pkg.id),
            pkg,
          })
        }
      } catch { /* skip unreachable source */ }
    }))
    agents.value = results
  } catch (e: any) {
    show(t('agentStore.fetch_error'), 'error')
  } finally {
    loading.value = false
  }
}

async function reload() {
  await loadSources()
  await loadAgents()
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
const selectedVersionIndex = ref(0)

function openInstall(agent: BrowsedAgent) {
  installTarget.value = agent
  installOverwrite.value = false
  selectedVersionIndex.value = 0
  showInstallModal.value = true
}

async function confirmInstall() {
  if (!installTarget.value) return
  installing.value = true
  try {
    const target = installTarget.value as BrowsedAgent & { _localAgents?: AgentPackage[] }
    const isFileSource = target.sourceUrl.startsWith('__file__:')
    const res = await apiFetch('/api/agent-store/install', 'POST', {
      pkg: target.pkg,
      overwrite: installOverwrite.value,
      versionIndex: selectedVersionIndex.value,
      sourceUrl: isFileSource ? undefined : target.sourceUrl,
      localAgents: isFileSource ? (target._localAgents ?? tempSourceAgents.value.map(a => a.pkg)) : undefined,
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

// ── Load from file (temporary source) ──
const fileInputRef = ref<HTMLInputElement | null>(null)
const tempSourceName = ref('')
const tempSourceAgents = ref<BrowsedAgent[]>([])

function triggerFileLoad() {
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
      // Accept source format: { name?, agents: [...] }
      const sourceAgents: AgentPackage[] = Array.isArray(data.agents) ? data.agents : []
      if (!sourceAgents.length) {
        show(t('agentStore.no_agents'), 'error')
        return
      }
      const sourceName = data.name || file.name.replace(/\.json$/, '')
      const sourceUrl = `__file__:${sourceName}`
      tempSourceName.value = sourceName
      tempSourceAgents.value = sourceAgents.map(pkg => ({
        sourceUrl,
        sourceName: sourceName,
        installed: isInstalled(pkg.id),
        pkg,
        _localAgents: sourceAgents,
      } as BrowsedAgent & { _localAgents?: AgentPackage[] }))
      // Merge into agents list
      agents.value = [...agents.value.filter(a => !a.sourceUrl.startsWith('__file__:')), ...tempSourceAgents.value]
      selectedSource.value = sourceUrl
    } catch {
      show('Invalid JSON file', 'error')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

function closeTempSource() {
  agents.value = agents.value.filter(a => !a.sourceUrl.startsWith('__file__:'))
  tempSourceName.value = ''
  tempSourceAgents.value = []
  selectedSource.value = '__all__'
}

// ── Init ──
onMounted(reload)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="openAddSource">{{ t('agentStore.add_source') }}</button>
      <button class="btn-primary btn-sm" @click="triggerFileLoad">{{ t('agentStore.import_file') }}</button>
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
      <!-- Temp file source tab -->
      <button
        v-if="tempSourceName"
        @click="selectedSource = '__file__:' + tempSourceName"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s;display:flex;align-items:center;gap:4px"
        :style="selectedSource === '__file__:' + tempSourceName ? 'color:#e67e22;border-bottom-color:#e67e22' : 'color:#e67e22;opacity:.6'"
      >
        {{ tempSourceName }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="selectedSource === '__file__:' + tempSourceName ? 'background:#e67e22;color:#fff' : 'background:#fef3c7;color:#e67e22'"
        >{{ tempSourceAgents.length }}</span>
        <span
          @click.stop="closeTempSource"
          style="margin-left:2px;font-size:14px;color:#e67e22;cursor:pointer;line-height:1"
          title="Close"
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
            <span :class="'agent-type-badge agent-type-' + a.pkg.versions[0]?.agent.type">{{ a.pkg.versions[0]?.agent.type }}</span>
          </div>

          <!-- Version & Author -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:#6b6b6b">
            <span>v{{ a.pkg.versions[0]?.version }}</span>
            <span v-if="a.pkg.versions.length > 1" style="color:#9b9b9b">({{ a.pkg.versions.length }} versions)</span>
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
            <template v-if="a.pkg.versions[0] && depsTotal(a.pkg.versions[0].agent) > 0">
              {{ t('agentStore.requires') }}: {{ depsSummary(a.pkg.versions[0].agent) }}
            </template>
            <template v-else>
              {{ t('agentStore.no_deps') }}
            </template>
          </div>

          <!-- Action button -->
          <div style="display:flex;gap:6px">
            <template v-if="a.installed">
              <span class="store-installed-badge">{{ t('agentStore.installed') }}</span>
            </template>
            <template v-else>
              <button class="btn-primary btn-sm" @click="openInstall(a)">{{ t('agentStore.install') }}</button>
            </template>
          </div>
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
              <span v-if="installTarget.pkg.versions[selectedVersionIndex]" :class="'agent-type-badge agent-type-' + installTarget.pkg.versions[selectedVersionIndex].agent.type">{{ installTarget.pkg.versions[selectedVersionIndex].agent.type }}</span>
            </div>
            <div style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ installTarget.pkg.id }} v{{ installTarget.pkg.versions[selectedVersionIndex]?.version }}</div>
          </div>
          <!-- Version selector (multi-version) -->
          <div v-if="installTarget.pkg.versions.length > 1" class="form-group" style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:4px;display:block">{{ t('agentStore.select_version') }}</label>
            <select v-model="selectedVersionIndex" style="width:100%;padding:6px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:13px;color:#1c1c1c;background:#fafaf9">
              <option v-for="(ver, idx) in installTarget.pkg.versions" :key="idx" :value="idx">
                v{{ ver.version }}{{ idx === 0 ? ' (latest)' : '' }}
              </option>
            </select>
          </div>
          <div v-if="installTarget.pkg.description" style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5">{{ installTarget.pkg.description }}</div>
          <div v-if="installTarget.pkg.versions[selectedVersionIndex] && depsTotal(installTarget.pkg.versions[selectedVersionIndex].agent) > 0" style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            {{ t('agentStore.requires') }}: {{ depsSummary(installTarget.pkg.versions[selectedVersionIndex].agent) }}
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
