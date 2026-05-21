<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()

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

const agents = ref<BrowsedAgent[]>([])
const sources = ref<AgentSourceEntry[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedSource = ref('__all__')

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

async function loadSources() {
  try {
    const res = await apiFetch('/api/agent-store/list')
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
        const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(src.url)}`)
        if (!proxyRes.ok) return
        const remote: { name?: string; agents?: AgentPackage[] } = await proxyRes.json()
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
    if (tempSourceAgents.value.length) {
      tempSourceAgents.value = tempSourceAgents.value.map(a => ({
        ...a,
        installed: isInstalled(a.pkg.id),
      }))
      agents.value = [...results, ...tempSourceAgents.value]
    } else {
      agents.value = results
    }
  } catch {
    show(t('agentStore.fetch_error'), 'error')
  } finally {
    loading.value = false
  }
}

async function reload() {
  await loadSources()
  await loadAgents()
}

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
    await apiFetch('/api/agent-store/add', 'POST', {
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
    await apiFetch('/api/agent-store/remove', 'POST', { index })
    show(t('agentStore.source_removed'))
    await reload()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

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

async function installOne(pkg: AgentPackage, version: string, overwrite: boolean) {
  const res = await apiFetch('/api/agent-store/install', 'POST', { pkg, version, overwrite })
  if (res.data?.settings) Object.assign(store.settings, res.data.settings)
  return res
}

function resolveSubAgents(ver: AgentPackageVersion): { resolved: { pkg: AgentPackage; version: string }[]; missing: string[] } {
  const subIds = ver.agent.agents?.map(a => a.id) ?? []
  const resolved: { pkg: AgentPackage; version: string }[] = []
  const missing: string[] = []
  for (const id of subIds) {
    if (isInstalled(id)) continue
    const browsed = agents.value.find(a => a.pkg.id === id)
    if (browsed) {
      resolved.push({ pkg: browsed.pkg, version: browsed.pkg.versions[0].version })
    } else {
      missing.push(id)
    }
  }
  return { resolved, missing }
}

async function confirmInstall() {
  if (!installTarget.value) return
  installing.value = true
  try {
    const pkg = installTarget.value.pkg
    const ver = pkg.versions[selectedVersionIndex.value]
    if (!ver) return

    const { resolved, missing } = resolveSubAgents(ver)
    if (missing.length) {
      show(`Missing sub-agents: ${missing.join(', ')}`, 'error')
    }

    for (const sub of resolved) {
      try {
        await installOne(sub.pkg, sub.version, false)
      } catch { /* skip failed sub-agent */ }
    }

    await installOne(pkg, ver.version, installOverwrite.value)
    show(t('agentStore.install_success'))
    showInstallModal.value = false
    await loadAgents()
  } catch (e: any) {
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
      }))
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

onMounted(reload)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="openAddSource">{{ t('agentStore.add_source') }}</SButton>
      <SButton type="primary" size="sm" @click="triggerFileLoad">{{ t('agentStore.import_file') }}</SButton>
      <input
        ref="fileInputRef"
        type="file"
        accept=".json"
        style="display:none"
        @change="onFileSelected"
      />
    </SPageToolbar>

    <!-- Source tabs + Search -->
    <div class="src-tab-bar">
      <button
        class="src-tab"
        :class="{ active: selectedSource === '__all__' }"
        @click="selectedSource = '__all__'"
      >
        {{ t('agentStore.source_all') }}
        <span class="src-tab-count" :class="{ active: selectedSource === '__all__' }">{{ agents.length }}</span>
      </button>
      <button
        v-for="(src, idx) in sources"
        :key="src.url"
        class="src-tab"
        :class="{ active: selectedSource === src.url }"
        @click="selectedSource = src.url"
      >
        {{ src.name || src.url }}
        <span class="src-tab-count" :class="{ active: selectedSource === src.url }">{{ agents.filter(a => a.sourceUrl === src.url).length }}</span>
        <span class="src-tab-close" @click.stop="removeSource(idx)" title="Remove source">&times;</span>
      </button>
      <button
        v-if="tempSourceName"
        class="src-tab src-tab-temp"
        :class="{ active: selectedSource === '__file__:' + tempSourceName }"
        @click="selectedSource = '__file__:' + tempSourceName"
      >
        {{ tempSourceName }}
        <span class="src-tab-count src-tab-count-temp" :class="{ active: selectedSource === '__file__:' + tempSourceName }">{{ tempSourceAgents.length }}</span>
        <span class="src-tab-close src-tab-close-temp" @click.stop="closeTempSource" title="Close">&times;</span>
      </button>
      <div class="src-tab-spacer" />
      <SInput v-model="searchQuery" size="sm" :placeholder="t('agentStore.search_placeholder')" class="src-search-input" />
    </div>

    <SPageContent>
      <div v-if="loading" class="store-loading">{{ t('agentStore.loading') }}</div>

      <div v-else-if="sources.length === 0 && agents.length === 0" class="store-empty-hint">
        <div class="store-empty-text">{{ t('agentStore.no_sources') }}</div>
        <div class="store-empty-sub">{{ t('agentStore.add_source_hint') }}</div>
        <SButton type="primary" size="sm" class="store-empty-action" @click="openAddSource">{{ t('agentStore.add_source') }}</SButton>
      </div>

      <div v-else-if="filteredAgents.length === 0" class="store-loading">
        {{ t('agentStore.no_agents') }}
      </div>

      <div v-else class="store-grid">
        <div v-for="a in filteredAgents" :key="a.sourceUrl + ':' + a.pkg.id" class="store-card">
          <div class="store-card-head">
            <div class="store-card-head-text">
              <div class="store-card-name">{{ a.pkg.name }}</div>
              <div class="store-card-id">{{ a.pkg.id }}</div>
            </div>
            <span :class="'agent-type-badge agent-type-' + a.pkg.versions[0]?.agent.type">{{ a.pkg.versions[0]?.agent.type }}</span>
          </div>

          <div class="store-card-meta">
            <span>v{{ a.pkg.versions[0]?.version }}</span>
            <span v-if="a.pkg.versions.length > 1" class="store-card-meta-sub">({{ a.pkg.versions.length }} versions)</span>
            <span v-if="a.pkg.author" class="store-card-meta-sub">@{{ a.pkg.author }}</span>
          </div>

          <div class="store-card-desc">{{ a.pkg.description || '-' }}</div>

          <div v-if="a.pkg.tags?.length" class="store-card-tags">
            <span v-for="tag in a.pkg.tags" :key="tag" class="store-card-tag">{{ tag }}</span>
          </div>

          <div class="store-card-requires">
            <template v-if="a.pkg.versions[0] && depsTotal(a.pkg.versions[0].agent) > 0">
              {{ t('agentStore.requires') }}: {{ depsSummary(a.pkg.versions[0].agent) }}
            </template>
            <template v-else>
              {{ t('agentStore.no_deps') }}
            </template>
          </div>

          <div class="store-card-actions">
            <SBadge v-if="a.installed" variant="success">{{ t('agentStore.installed') }}</SBadge>
            <SButton v-else type="primary" size="sm" @click="openInstall(a)">{{ t('agentStore.install') }}</SButton>
          </div>
        </div>
      </div>
    </SPageContent>

    <!-- Add Source Modal -->
    <SModal v-model:visible="showSourceModal" :title="t('agentStore.add_source')" width="md">
      <SFormItem :label="t('agentStore.source_url')">
        <SInput v-model="sourceUrl" placeholder="https://example.com/agents.json" @keydown.enter="addSource" />
      </SFormItem>
      <SFormItem :label="t('agentStore.source_name')">
        <SInput v-model="sourceName" :placeholder="t('agentStore.source_name')" @keydown.enter="addSource" />
      </SFormItem>
      <div v-if="sources.length > 0" class="src-list-wrap">
        <div class="src-list-label">{{ t('agentStore.source_all') }}</div>
        <div v-for="(src, idx) in sources" :key="src.url" class="src-list-item">
          <div class="src-list-item-text">
            <div class="src-list-item-name">{{ src.name || src.url }}</div>
            <div v-if="src.name" class="src-list-item-url">{{ src.url }}</div>
          </div>
          <SButton type="danger" size="sm" @click="removeSource(idx)">{{ t('common.delete') }}</SButton>
        </div>
      </div>
      <template #footer>
        <SButton type="outline" @click="showSourceModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" :disabled="sourceAdding || !sourceUrl.trim()" @click="addSource">
          {{ sourceAdding ? t('agentStore.loading') : t('agentStore.add_source') }}
        </SButton>
      </template>
    </SModal>

    <!-- Install Confirm Modal -->
    <SModal v-if="installTarget" v-model:visible="showInstallModal" :title="t('agentStore.install')" width="md">
      <div class="install-head">
        <div class="install-head-row">
          <span class="install-pkg-name">{{ installTarget.pkg.name }}</span>
          <span v-if="installTarget.pkg.versions[selectedVersionIndex]" :class="'agent-type-badge agent-type-' + installTarget.pkg.versions[selectedVersionIndex].agent.type">{{ installTarget.pkg.versions[selectedVersionIndex].agent.type }}</span>
        </div>
        <div class="install-pkg-id">{{ installTarget.pkg.id }} v{{ installTarget.pkg.versions[selectedVersionIndex]?.version }}</div>
      </div>
      <SFormItem v-if="installTarget.pkg.versions.length > 1" :label="t('agentStore.select_version')">
        <SSelect v-model.number="selectedVersionIndex">
          <option v-for="(ver, idx) in installTarget.pkg.versions" :key="idx" :value="idx">
            v{{ ver.version }}{{ idx === 0 ? ' (latest)' : '' }}
          </option>
        </SSelect>
      </SFormItem>
      <div v-if="installTarget.pkg.description" class="install-desc">{{ installTarget.pkg.description }}</div>
      <div v-if="installTarget.pkg.versions[selectedVersionIndex] && depsTotal(installTarget.pkg.versions[selectedVersionIndex].agent) > 0" class="install-info-panel">
        {{ t('agentStore.requires') }}: {{ depsSummary(installTarget.pkg.versions[selectedVersionIndex].agent) }}
      </div>
      <div v-if="installTarget.installed" class="install-warn-panel">
        {{ t('agentStore.confirm_overwrite', { id: installTarget.pkg.id }) }}
      </div>
      <label v-if="installTarget.installed" class="install-overwrite-label">
        <input type="checkbox" v-model="installOverwrite" />
        {{ t('agentStore.confirm_overwrite', { id: installTarget.pkg.id }) }}
      </label>
      <template #footer>
        <SButton type="outline" @click="showInstallModal = false">{{ t('common.cancel') }}</SButton>
        <SButton
          type="primary"
          :disabled="installing || (installTarget.installed && !installOverwrite)"
          @click="confirmInstall"
        >
          {{ installing ? t('agentStore.loading') : t('agentStore.install') }}
        </SButton>
      </template>
    </SModal>
  </div>
</template>

<style scoped>
.store-loading {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 60px;
  font-size: var(--sui-fs-lg);
}
.store-empty-hint {
  text-align: center;
  padding: 60px;
  color: var(--sui-fg-disabled);
}
.store-empty-text { font-size: var(--sui-fs-lg); margin-bottom: var(--sui-sp-3); }
.store-empty-sub { font-size: var(--sui-fs-md); }
.store-empty-action { margin-top: var(--sui-sp-5); }

.store-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sui-sp-5);
}
.store-card {
  position: relative;
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  padding: var(--sui-sp-5) var(--sui-sp-6);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
  transition: box-shadow 0.15s, border-color 0.15s;
}
.store-card:hover {
  box-shadow: var(--sui-shadow-md);
  border-color: var(--sui-border-strong);
}

.agent-type-badge {
  display: inline-block;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--sui-radius-sm);
  flex-shrink: 0;
}
.agent-type-react { background: #ede9fe; color: #6d28d9; }
.agent-type-single { background: var(--sui-bg-soft); color: var(--sui-fg-muted); }

@media (max-width: 1024px) {
  .store-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .store-grid { grid-template-columns: 1fr; }
}

/* Source tabs */
.src-tab-bar {
  display: flex;
  align-items: center;
  padding: 0 var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.src-tab-spacer { flex: 1; }
.src-tab {
  padding: 10px 14px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--sui-fs-md);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--sui-fg-disabled);
  transition: color .15s;
  font-family: inherit;
}
.src-tab.active { color: var(--sui-fg); border-bottom-color: var(--sui-fg); }
.src-tab-count {
  margin-left: 4px;
  font-size: var(--sui-fs-xs);
  padding: 0 5px;
  border-radius: 10px;
  font-weight: 600;
  background: var(--sui-bg-soft);
  color: var(--sui-fg-muted);
}
.src-tab-count.active { background: var(--sui-fg); color: var(--sui-bg); }
.src-tab-close {
  margin-left: 2px;
  font-size: 14px;
  color: var(--sui-fg-disabled);
  cursor: pointer;
  line-height: 1;
}
.src-tab-temp { color: var(--sui-warning); opacity: .6; }
.src-tab-temp.active { color: var(--sui-warning); opacity: 1; border-bottom-color: var(--sui-warning); }
.src-tab-count-temp { background: #fef3c7; color: #b45309; }
.src-tab-count-temp.active { background: var(--sui-warning); color: #fff; }
.src-tab-close-temp { color: var(--sui-warning); }
.src-search-input { width: 220px; }

/* Card body */
.store-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sui-sp-3); margin-bottom: var(--sui-sp-3); }
.store-card-head-text { flex: 1; min-width: 0; }
.store-card-name { font-size: var(--sui-fs-lg); font-weight: 600; color: var(--sui-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.store-card-id { font-family: var(--sui-font-mono); font-size: var(--sui-fs-xs); color: var(--sui-fg-disabled); margin-top: 2px; }
.store-card-meta { display: flex; align-items: center; gap: var(--sui-sp-3); margin-bottom: var(--sui-sp-3); font-size: var(--sui-fs-sm); color: var(--sui-fg-muted); }
.store-card-meta-sub { color: var(--sui-fg-disabled); }
.store-card-desc { font-size: var(--sui-fs-md); color: var(--sui-fg-secondary); line-height: 1.5; margin-bottom: 10px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 39px; }
.store-card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.store-card-tag { font-size: var(--sui-fs-xs); padding: 1px 6px; border-radius: 8px; background: var(--sui-bg-soft); color: var(--sui-fg-muted); font-weight: 500; }
.store-card-requires { font-size: var(--sui-fs-sm); color: var(--sui-fg-disabled); margin-bottom: var(--sui-sp-4); }
.store-card-actions { display: flex; gap: var(--sui-sp-2); }

/* Source list (in modal) */
.src-list-wrap { margin-top: var(--sui-sp-5); border-top: 1px solid var(--sui-border); padding-top: var(--sui-sp-4); }
.src-list-label { font-size: var(--sui-fs-sm); font-weight: 600; color: var(--sui-fg-muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: var(--sui-sp-3); }
.src-list-item { display: flex; align-items: center; gap: var(--sui-sp-3); padding: var(--sui-sp-2) 0; border-bottom: 1px solid var(--sui-border); }
.src-list-item-text { flex: 1; min-width: 0; }
.src-list-item-name { font-size: var(--sui-fs-md); font-weight: 500; color: var(--sui-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-list-item-url { font-size: var(--sui-fs-xs); color: var(--sui-fg-disabled); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Install modal */
.install-head { margin-bottom: var(--sui-sp-4); }
.install-head-row { display: flex; align-items: center; gap: var(--sui-sp-3); margin-bottom: 4px; }
.install-pkg-name { font-family: var(--sui-font-mono); font-size: var(--sui-fs-xl); font-weight: 600; color: var(--sui-fg); }
.install-pkg-id { font-size: var(--sui-fs-sm); color: var(--sui-fg-disabled); font-family: var(--sui-font-mono); }
.install-desc { font-size: var(--sui-fs-md); color: var(--sui-fg-secondary); margin-bottom: var(--sui-sp-4); line-height: 1.5; }
.install-info-panel { padding: 10px 12px; background: var(--sui-bg-subtle); border-radius: var(--sui-radius-md); font-size: var(--sui-fs-md); color: var(--sui-fg-secondary); margin-bottom: var(--sui-sp-4); }
.install-warn-panel { padding: 10px 12px; background: #fef3c7; border-radius: var(--sui-radius-md); font-size: var(--sui-fs-md); color: #92400e; margin-bottom: var(--sui-sp-4); }
.install-overwrite-label { display: flex; align-items: center; gap: var(--sui-sp-3); font-size: var(--sui-fs-md); cursor: pointer; }

/* Dark theme */
html[data-theme="dark"] .agent-type-react { background: #3b2d5c; color: #c4b5fd; }
html[data-theme="dark"] .src-tab-count-temp { background: #422006; color: #fdba74; }
html[data-theme="dark"] .install-warn-panel { background: #422006; color: #fcd34d; }
</style>
