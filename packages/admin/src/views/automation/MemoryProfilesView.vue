<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'

interface MemoryProfileForm {
  name: string
  enabled: boolean
  writerModel: string
  writerPromptFile: string
  readPromptFile: string
  writerMemoryMenuMaxEntries: number
}

interface MemorySummary {
  slug: string
  kind: string
  title: string
  description: string
  evidenceCount: number
  createdAt: number
  updatedAt: number
  lastReadAt: number | null
  readCount: number
}

interface MemoryJob {
  id: number
  type: string
  status: string
  attemptCount: number
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const profiles = computed(() => store.settings.memoryProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id })),
)

const columns = computed<STableColumn[]>(() => [
  { key: 'name',         label: t('common.name'),                primary: true },
  { key: 'enabled',      label: t('common.enabled'),             width: '100px', align: 'center' },
  { key: 'writerModel',  label: t('memory_profiles.writer_model'), width: '200px' },
  { key: 'ops',          label: t('common.ops'),                 ops: true, width: '390px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const running = ref<Record<string, boolean>>({})
const consolidating = ref<Record<string, boolean>>({})
const showMemoryViewer = ref(false)
const memoryViewerId = ref('')
const memoryViewerTab = ref<'memories' | 'jobs'>('memories')
const memoryLoading = ref(false)
const memoryJobsLoading = ref(false)
const memoryBodyLoading = ref(false)
const memoryRows = ref<MemorySummary[]>([])
const memoryJobs = ref<MemoryJob[]>([])
const selectedMemorySlug = ref('')
const selectedMemoryBody = ref('')

const selectedMemory = computed(() => memoryRows.value.find(m => m.slug === selectedMemorySlug.value) || null)
const memoryViewerTitle = computed(() => profileLabel(memoryViewerId.value))

function emptyForm(): MemoryProfileForm {
  return {
    name: '',
    enabled: true,
    writerModel: '',
    writerPromptFile: '',
    readPromptFile: '',
    writerMemoryMenuMaxEntries: 200,
  }
}

const form = ref<MemoryProfileForm>(emptyForm())

const promptFiles = ref<{ path: string }[]>([])
const writerPromptFiles = computed(() => filterPromptFiles('write', form.value.writerPromptFile))
const readPromptFiles = computed(() => filterPromptFiles('read', form.value.readPromptFile))

async function loadPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=memory')
    promptFiles.value = res.data || []
  } catch { promptFiles.value = [] }
}

function filterPromptFiles(kind: 'write' | 'read', selectedPath: string): { path: string }[] {
  const prefix = kind === 'write' ? 'memory/writer/' : 'memory/reader/'
  const out = promptFiles.value.filter(p => p.path.replace(/\\/g, '/').startsWith(prefix))
  if (selectedPath && !out.some(p => p.path === selectedPath)) out.unshift({ path: selectedPath })
  return out
}

function openAdd() {
  editingId.value = null
  form.value = emptyForm()
  loadPrompts()
  showModal.value = true
}

function openEdit(id: string) {
  const p: any = profiles.value[id]
  editingId.value = id
  form.value = {
    name: p.name || '',
    enabled: !!p.enabled,
    writerModel: p.writerModel || '',
    writerPromptFile: p.writerPromptFile || '',
    readPromptFile: p.readPromptFile || '',
    writerMemoryMenuMaxEntries: p.writerMemoryMenuMaxEntries ?? 200,
  }
  loadPrompts()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (form.value.enabled) {
    if (!form.value.writerModel) { show(t('memory_profiles.error_writer_model'), 'error'); return }
  }
  try {
    const body: any = {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
      writerModel: form.value.writerModel,
      writerMemoryMenuMaxEntries: form.value.writerMemoryMenuMaxEntries,
    }
    if (form.value.writerPromptFile) body.writerPromptFile = form.value.writerPromptFile
    if (form.value.readPromptFile)   body.readPromptFile   = form.value.readPromptFile
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/memoryProfiles', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const p: any = profiles.value[id]
  const label = p?.name || id
  if (!await confirm(t('memory_profiles.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function runExtract(id: string) {
  if (running.value[id]) return
  running.value[id] = true
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(id)}/extract/run`, 'POST', {})
    show(t('memory_profiles.extract_done'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    running.value[id] = false
  }
}

async function runConsolidate(id: string) {
  if (consolidating.value[id]) return
  consolidating.value[id] = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/consolidate/run`, 'POST', {})
    show(t('memory_profiles.consolidate_queued', { id: res.data?.jobId ?? '-' }))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    consolidating.value[id] = false
  }
}

async function openMemoryViewer(id: string) {
  memoryViewerId.value = id
  memoryViewerTab.value = 'memories'
  showMemoryViewer.value = true
  await refreshMemoryViewer()
}

async function refreshMemoryViewer() {
  const id = memoryViewerId.value
  if (!id) return
  await Promise.all([
    loadMemories(id),
    loadMemoryJobs(id),
  ])
}

async function loadMemories(id = memoryViewerId.value) {
  if (!id) return
  memoryLoading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/list`)
    const rows = (res.data?.memories || []) as MemorySummary[]
    memoryRows.value = rows
    const nextSlug = rows.find(r => r.slug === selectedMemorySlug.value)?.slug || rows[0]?.slug || ''
    selectedMemorySlug.value = nextSlug
    if (nextSlug) await loadMemoryBody(nextSlug)
    else selectedMemoryBody.value = ''
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    memoryLoading.value = false
  }
}

async function loadMemoryJobs(id = memoryViewerId.value) {
  if (!id) return
  memoryJobsLoading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/jobs?limit=50`)
    memoryJobs.value = (res.data?.jobs || []) as MemoryJob[]
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    memoryJobsLoading.value = false
  }
}

async function selectMemory(slug: string) {
  if (selectedMemorySlug.value === slug && selectedMemoryBody.value) return
  selectedMemorySlug.value = slug
  await loadMemoryBody(slug)
}

async function loadMemoryBody(slug: string) {
  const id = memoryViewerId.value
  if (!id || !slug) return
  memoryBodyLoading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/entries/${encodeURIComponent(slug)}`)
    selectedMemoryBody.value = res.data?.row?.body || ''
  } catch (e: any) {
    selectedMemoryBody.value = ''
    show(e.message, 'error')
  } finally {
    memoryBodyLoading.value = false
  }
}

async function runExtractFromViewer() {
  if (!memoryViewerId.value) return
  await runExtract(memoryViewerId.value)
  await refreshMemoryViewer()
}

async function runConsolidateFromViewer() {
  if (!memoryViewerId.value) return
  await runConsolidate(memoryViewerId.value)
  await refreshMemoryViewer()
}

function modelLabel(id: string | undefined | null): string {
  if (!id) return '-'
  return modelOptions.value.find(m => m.id === id)?.label || id
}

function profileLabel(id: string): string {
  const p: any = profiles.value[id]
  return p?.name || id
}

function fmtTime(value: number | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function kindVariant(kind: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (kind === 'preference') return 'success'
  if (kind === 'workflow') return 'info'
  if (kind === 'decision') return 'warning'
  if (kind === 'project') return 'danger'
  return 'neutral'
}

function jobTypeLabel(type: string): string {
  if (type === 'extract') return t('memory_profiles.job_type_extract')
  if (type === 'consolidate') return t('memory_profiles.job_type_consolidate')
  return type
}

function jobStatusLabel(status: string): string {
  if (status === 'pending') return t('memory_profiles.job_status_pending')
  if (status === 'failed') return t('memory_profiles.job_status_failed')
  return status
}

function jobVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (status === 'failed') return 'danger'
  if (status === 'pending') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('memory_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        :empty-text="t('memory_profiles.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #enabled="{ row }">
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" pill>
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
        </template>
        <template #writerModel="{ row }">{{ modelLabel(row.writerModel) }}</template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="openMemoryViewer(row.id)">{{ t('memory_profiles.view_memories') }}</SButton>
            <SButton type="outline" size="sm" :loading="running[row.id]" @click="runExtract(row.id)">{{ t('memory_profiles.run_extract') }}</SButton>
            <SButton type="outline" size="sm" :loading="consolidating[row.id]" @click="runConsolidate(row.id)">{{ t('memory_profiles.run_consolidate') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingId !== null ? t('memory_profiles.edit_title') : t('memory_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('memory_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :model-value="form.enabled ? 'true' : 'false'" @update:model-value="(v: any) => (form.enabled = v === 'true')">
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_model') + ' *'">
        <SSelect v-model="form.writerModel">
          <option value="" disabled>{{ t('memory_profiles.writer_model_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_prompt')">
        <SSelect v-model="form.writerPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in writerPromptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.read_prompt')">
        <SSelect v-model="form.readPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in readPromptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_memory_menu_max_entries')">
        <SInput type="number" :model-value="form.writerMemoryMenuMaxEntries" @update:model-value="(v: any) => (form.writerMemoryMenuMaxEntries = Number(v) || 100)" />
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <SModal v-model:visible="showMemoryViewer" :title="t('memory_profiles.viewer_title', { name: memoryViewerTitle })" width="xl">
      <div class="memory-viewer">
        <div class="memory-viewer-toolbar">
          <div class="memory-tabs">
            <SButton :type="memoryViewerTab === 'memories' ? 'primary' : 'outline'" size="sm" @click="memoryViewerTab = 'memories'">
              {{ t('memory_profiles.viewer_memories') }}
            </SButton>
            <SButton :type="memoryViewerTab === 'jobs' ? 'primary' : 'outline'" size="sm" @click="memoryViewerTab = 'jobs'">
              {{ t('memory_profiles.viewer_jobs') }}
            </SButton>
          </div>
          <div class="memory-actions">
            <SButton type="outline" size="sm" :loading="memoryLoading || memoryJobsLoading" @click="refreshMemoryViewer">{{ t('common.refresh') }}</SButton>
            <SButton type="outline" size="sm" :loading="running[memoryViewerId]" @click="runExtractFromViewer">{{ t('memory_profiles.run_extract') }}</SButton>
            <SButton type="outline" size="sm" :loading="consolidating[memoryViewerId]" @click="runConsolidateFromViewer">{{ t('memory_profiles.run_consolidate') }}</SButton>
          </div>
        </div>

        <div v-if="memoryViewerTab === 'memories'" class="memory-pane">
          <aside class="memory-list">
            <div v-if="memoryLoading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
            <div v-else-if="memoryRows.length === 0" class="memory-empty">{{ t('memory_profiles.no_memories') }}</div>
            <button
              v-for="m in memoryRows"
              v-else
              :key="m.slug"
              class="memory-row"
              :class="{ active: m.slug === selectedMemorySlug }"
              @click="selectMemory(m.slug)"
            >
              <div class="memory-row-head">
                <SBadge :variant="kindVariant(m.kind)" size="xs">{{ m.kind }}</SBadge>
                <span class="memory-row-slug">{{ m.slug }}</span>
              </div>
              <div class="memory-row-title">{{ m.title }}</div>
              <div class="memory-row-desc">{{ m.description }}</div>
              <div class="memory-row-meta">
                <span>{{ t('memory_profiles.evidence') }} {{ m.evidenceCount }}</span>
                <span>{{ fmtTime(m.updatedAt) }}</span>
              </div>
            </button>
          </aside>

          <section class="memory-detail">
            <div v-if="selectedMemory" class="memory-detail-head">
              <div>
                <div class="memory-detail-title">{{ selectedMemory.title }}</div>
                <div class="memory-detail-slug">{{ selectedMemory.slug }}</div>
              </div>
              <div class="memory-detail-badges">
                <SBadge :variant="kindVariant(selectedMemory.kind)" size="sm">{{ selectedMemory.kind }}</SBadge>
                <SBadge variant="neutral" size="sm">{{ t('memory_profiles.evidence') }} {{ selectedMemory.evidenceCount }}</SBadge>
                <SBadge variant="neutral" size="sm">{{ t('memory_profiles.read_count') }} {{ selectedMemory.readCount }}</SBadge>
              </div>
            </div>
            <div v-if="selectedMemory" class="memory-detail-meta">
              <span>{{ t('memory_profiles.updated_at') }}: {{ fmtTime(selectedMemory.updatedAt) }}</span>
              <span>{{ t('memory_profiles.created_at') }}: {{ fmtTime(selectedMemory.createdAt) }}</span>
            </div>
            <pre class="memory-body">{{ memoryBodyLoading ? t('memory_profiles.loading') : (selectedMemoryBody || t('memory_profiles.no_body')) }}</pre>
          </section>
        </div>

        <div v-else class="memory-jobs">
          <div v-if="memoryJobsLoading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
          <div v-else-if="memoryJobs.length === 0" class="memory-empty">{{ t('memory_profiles.no_jobs') }}</div>
          <div v-for="job in memoryJobs" v-else :key="job.id" class="memory-job">
            <div class="memory-job-head">
              <div class="memory-job-id">#{{ job.id }}</div>
              <SBadge :variant="jobVariant(job.status)" size="sm">{{ jobStatusLabel(job.status) }}</SBadge>
            </div>
            <div class="memory-job-grid">
              <span>{{ t('memory_profiles.job_type') }}</span><code>{{ jobTypeLabel(job.type) }}</code>
              <span>{{ t('memory_profiles.attempt_count') }}</span><code>{{ job.attemptCount }}</code>
              <span>{{ t('memory_profiles.created_at') }}</span><code>{{ fmtTime(job.createdAt) }}</code>
              <span>{{ t('memory_profiles.updated_at') }}</span><code>{{ fmtTime(job.updatedAt) }}</code>
              <span>{{ t('memory_profiles.error_message') }}</span><code>{{ job.errorMessage || '-' }}</code>
            </div>
          </div>
        </div>
      </div>
    </SModal>
  </div>
</template>

<style scoped>
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}

.memory-viewer {
  display: flex;
  flex-direction: column;
  min-height: 560px;
  max-height: 72vh;
  overflow: hidden;
}

.memory-viewer-toolbar {
  display: flex;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding-bottom: var(--sui-sp-3);
  border-bottom: 1px solid var(--sui-border-subtle);
}

.memory-tabs,
.memory-actions {
  display: inline-flex;
  gap: var(--sui-sp-2);
  align-items: center;
  white-space: nowrap;
}

.memory-pane {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 38%) minmax(0, 1fr);
  gap: var(--sui-sp-3);
  padding-top: var(--sui-sp-3);
  overflow: hidden;
}

.memory-list {
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--sui-border-subtle);
  padding-right: var(--sui-sp-3);
}

.memory-row {
  width: 100%;
  display: block;
  text-align: left;
  padding: var(--sui-sp-3);
  border: 1px solid var(--sui-border-subtle);
  background: var(--sui-bg);
  color: var(--sui-fg);
  border-radius: var(--sui-radius-sm);
  margin-bottom: var(--sui-sp-2);
  cursor: pointer;
}

.memory-row:hover,
.memory-row.active {
  border-color: var(--sui-color-primary);
}

.memory-row-head,
.memory-row-meta,
.memory-detail-badges,
.memory-job-head {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
}

.memory-row-head,
.memory-job-head {
  justify-content: space-between;
}

.memory-row-slug,
.memory-detail-slug,
.memory-job-grid code {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
}

.memory-row-title {
  font-weight: 600;
  margin-top: var(--sui-sp-2);
}

.memory-row-desc {
  margin-top: var(--sui-sp-1);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  line-height: 1.4;
}

.memory-row-meta {
  justify-content: space-between;
  margin-top: var(--sui-sp-2);
  color: var(--sui-fg-subtle);
  font-size: var(--sui-fs-xs);
}

.memory-detail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.memory-detail-head {
  display: flex;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  align-items: flex-start;
}

.memory-detail-title {
  font-size: var(--sui-fs-lg);
  font-weight: 700;
}

.memory-detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sui-sp-2);
  margin: var(--sui-sp-3) 0;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}

.memory-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: var(--sui-sp-3);
  border: 1px solid var(--sui-border-subtle);
  border-radius: var(--sui-radius-sm);
  background: var(--sui-bg-subtle);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--sui-fs-sm);
  line-height: 1.5;
}

.memory-jobs {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-top: var(--sui-sp-3);
}

.memory-job {
  border: 1px solid var(--sui-border-subtle);
  border-radius: var(--sui-radius-sm);
  padding: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-2);
}

.memory-job-id {
  font-weight: 700;
}

.memory-job-grid {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: var(--sui-sp-2);
  margin-top: var(--sui-sp-3);
  font-size: var(--sui-fs-sm);
}

.memory-job-grid span {
  color: var(--sui-fg-muted);
}

.memory-job-grid code {
  overflow-wrap: anywhere;
}

.memory-empty {
  color: var(--sui-fg-muted);
  padding: var(--sui-sp-4);
  text-align: center;
}

@media (max-width: 900px) {
  .memory-viewer-toolbar,
  .memory-detail-head {
    flex-direction: column;
    align-items: stretch;
  }

  .memory-pane {
    grid-template-columns: 1fr;
  }

  .memory-list {
    border-right: 0;
    border-bottom: 1px solid var(--sui-border-subtle);
    padding-right: 0;
    padding-bottom: var(--sui-sp-3);
    max-height: 280px;
  }

  .memory-detail-meta,
  .memory-job-grid {
    grid-template-columns: 1fr;
  }
}
</style>
