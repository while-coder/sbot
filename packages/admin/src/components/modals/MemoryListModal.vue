<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SModal, SBadge, SSelect, STabBar, STab } from 'sbot-ui'

interface MemorySummary {
  slug: string
  kind: string
  title: string
  evidenceCount: number
  createdAt: number
  updatedAt: number
  lastReadAt: number | null
  readCount: number
  scope: 'global' | 'workspace'
}

interface WorkspaceScope { key: string; path: string }

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

const visible = ref(false)
const memoryId = ref('')
const labelOverride = ref('')
const workspaceScopes = ref<WorkspaceScope[]>([])
const selectedWorkPath = ref('')

const tab = ref<'memories' | 'jobs'>('memories')
const loading = ref(false)
const jobsLoading = ref(false)
const bodyLoading = ref(false)
const consolidating = ref(false)
const reconciling = ref(false)
const deleting = ref(false)
const retryingJobId = ref<number | null>(null)
const deletingJobId = ref<number | null>(null)

const rows = ref<MemorySummary[]>([])
const jobs = ref<MemoryJob[]>([])
const selectedKey = ref('')
const selectedBody = ref('')

const rowKey = (m: Pick<MemorySummary, 'scope' | 'slug'>) => `${m.scope}:${m.slug}`
const selected = computed(() => rows.value.find(m => rowKey(m) === selectedKey.value) || null)
const viewQuery = computed(() => selectedWorkPath.value
  ? `viewScope=workspace&workPath=${encodeURIComponent(selectedWorkPath.value)}`
  : 'viewScope=global')

const title = computed(() => {
  const profiles: any = store.settings.memoryProfiles || {}
  const name = labelOverride.value || profiles[memoryId.value]?.name || memoryId.value
  return t('memory_profiles.viewer_title', { name })
})

async function openByMemoryId(id: string | null | undefined, label?: string) {
  memoryId.value = id ? String(id) : ''
  labelOverride.value = label || ''
  tab.value = 'memories'
  visible.value = true
  selectedWorkPath.value = ''
  if (memoryId.value) {
    await loadScopes()
    await loadMemories()
  } else { rows.value = []; jobs.value = []; selectedKey.value = ''; selectedBody.value = '' }
}

async function loadScopes() {
  const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/scopes`)
  workspaceScopes.value = (res.data?.workspaces || []) as WorkspaceScope[]
}

async function changeScope() {
  selectedKey.value = ''
  selectedBody.value = ''
  await refreshCurrentTab()
}

async function refreshCurrentTab() {
  if (!memoryId.value) return
  if (tab.value === 'memories') await loadMemories()
  else await loadJobs()
}

async function loadMemories() {
  if (!memoryId.value) return
  loading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/list?${viewQuery.value}`)
    const list = (res.data?.memories || []) as MemorySummary[]
    rows.value = list
    const next = list.find(r => rowKey(r) === selectedKey.value) || list[0]
    selectedKey.value = next ? rowKey(next) : ''
    if (next) await loadBody(next)
    else selectedBody.value = ''
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function loadJobs() {
  if (!memoryId.value) return
  jobsLoading.value = true
  try {
    const query = [viewQuery.value, 'limit=50'].join('&')
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/jobs?${query}`)
    jobs.value = (res.data?.jobs || []) as MemoryJob[]
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    jobsLoading.value = false
  }
}

async function selectMemory(memory: MemorySummary) {
  const key = rowKey(memory)
  if (selectedKey.value === key && selectedBody.value) return
  selectedKey.value = key
  await loadBody(memory)
}

async function loadBody(memory: MemorySummary) {
  if (!memoryId.value || !memory.slug) return
  bodyLoading.value = true
  try {
    const query = [viewQuery.value, `entryScope=${memory.scope}`].join('&')
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/entries/${encodeURIComponent(memory.slug)}?${query}`)
    selectedBody.value = res.data?.row?.body || ''
  } catch (e: any) {
    selectedBody.value = ''
    show(e.message, 'error')
  } finally {
    bodyLoading.value = false
  }
}

async function runConsolidate() {
  if (!memoryId.value || consolidating.value) return
  consolidating.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/consolidate/run?${viewQuery.value}`, 'POST', {})
    show(t('memory_profiles.consolidate_queued', { id: res.data?.jobId ?? '-' }))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    consolidating.value = false
  }
}

async function runReconcile() {
  if (!memoryId.value || reconciling.value) return
  reconciling.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/reconcile/run?${viewQuery.value}`, 'POST', {})
    show(t('memory_profiles.reconcile_queued', { id: res.data?.jobId ?? '-' }))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    reconciling.value = false
  }
}

async function retryFailedJob(job: MemoryJob) {
  if (!memoryId.value || job.status !== 'failed' || retryingJobId.value !== null) return
  retryingJobId.value = job.id
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/jobs/${job.id}/retry?${viewQuery.value}`, 'POST', {})
    show(t('memory_profiles.retry_job_done'))
    await loadJobs()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    retryingJobId.value = null
  }
}

async function deleteFailedJob(job: MemoryJob) {
  if (!memoryId.value || job.status !== 'failed' || deletingJobId.value !== null) return
  if (!await confirm(t('memory_profiles.confirm_delete_job', { id: job.id }), { danger: true })) return
  deletingJobId.value = job.id
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/jobs/${job.id}?${viewQuery.value}`, 'DELETE')
    show(t('memory_profiles.delete_job_done'))
    await loadJobs()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    deletingJobId.value = null
  }
}

async function deleteMemory(memory: MemorySummary) {
  if (!memoryId.value || !memory.slug || deleting.value) return
  if (!await confirm(t('memory_profiles.confirm_delete_memory', { slug: memory.slug }), { danger: true })) return
  deleting.value = true
  try {
    const query = [viewQuery.value, `entryScope=${memory.scope}`].join('&')
    await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/entries/${encodeURIComponent(memory.slug)}?${query}`, 'DELETE')
    show(t('memory_profiles.delete_memory_done'))
    if (selectedKey.value === rowKey(memory)) {
      selectedKey.value = ''
      selectedBody.value = ''
    }
    await loadMemories()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    deleting.value = false
  }
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
  if (type === 'reconcile') return t('memory_profiles.job_type_reconcile')
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

watch(tab, value => {
  if (!visible.value || !memoryId.value) return
  if (value === 'memories') loadMemories()
  else loadJobs()
})

defineExpose({ openByMemoryId })
</script>

<template>
  <SModal v-model:visible="visible" :title="title" width="xl">
    <div class="memory-viewer">
      <STabBar v-model="tab" class="memory-tabs">
        <STab name="memories">{{ t('memory_profiles.viewer_memories') }}</STab>
        <STab name="jobs">{{ t('memory_profiles.viewer_jobs') }}</STab>
      </STabBar>

      <div v-if="tab === 'memories'" class="memory-tab-pane">
        <div class="memory-tab-toolbar">
          <SSelect v-model="selectedWorkPath" size="sm" @change="changeScope">
            <option value="">{{ t('memory_profiles.scope_global') }}</option>
            <option v-for="scope in workspaceScopes" :key="scope.key" :value="scope.path">
              {{ t('memory_profiles.scope_workspace_context', { path: scope.path }) }}
            </option>
          </SSelect>
          <div class="memory-actions">
            <SBadge variant="info" size="sm">
              {{ t(selectedWorkPath ? 'memory_profiles.operation_scope_workspace' : 'memory_profiles.operation_scope_global') }}
            </SBadge>
            <SButton type="outline" size="sm" :loading="loading" @click="loadMemories">{{ t('common.refresh') }}</SButton>
            <SButton type="outline" size="sm" :loading="reconciling" @click="runReconcile">{{ t('memory_profiles.run_reconcile') }}</SButton>
            <SButton type="outline" size="sm" :loading="consolidating" @click="runConsolidate">{{ t('memory_profiles.run_consolidate') }}</SButton>
          </div>
        </div>

        <div class="memory-pane">
          <aside class="memory-list">
            <div v-if="loading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
            <div v-else-if="rows.length === 0" class="memory-empty">{{ t('memory_profiles.no_memories') }}</div>
            <button
              v-for="m in rows"
              v-else
              :key="rowKey(m)"
              class="memory-row"
              :class="{ active: rowKey(m) === selectedKey }"
              @click="selectMemory(m)"
            >
              <div class="memory-row-head">
                <div class="memory-row-badges">
                  <SBadge variant="neutral" size="xs">{{ m.scope }}</SBadge>
                  <SBadge :variant="kindVariant(m.kind)" size="xs">{{ m.kind }}</SBadge>
                </div>
                <span class="memory-row-slug">{{ m.slug }}</span>
              </div>
              <div class="memory-row-title">{{ m.title }}</div>
              <div class="memory-row-meta">
                <span>{{ t('memory_profiles.evidence') }} {{ m.evidenceCount }}</span>
                <span>{{ fmtTime(m.updatedAt) }}</span>
              </div>
            </button>
          </aside>

          <section class="memory-detail">
            <div v-if="selected" class="memory-detail-head">
              <div>
                <div class="memory-detail-title">{{ selected.title }}</div>
                <div class="memory-detail-slug">{{ selected.slug }}</div>
              </div>
              <div class="memory-detail-badges">
                <SBadge variant="neutral" size="sm">{{ selected.scope }}</SBadge>
                <SBadge :variant="kindVariant(selected.kind)" size="sm">{{ selected.kind }}</SBadge>
                <SBadge variant="neutral" size="sm">{{ t('memory_profiles.evidence') }} {{ selected.evidenceCount }}</SBadge>
                <SBadge variant="neutral" size="sm">{{ t('memory_profiles.read_count') }} {{ selected.readCount }}</SBadge>
                <SButton type="danger" size="sm" :loading="deleting" @click="deleteMemory(selected)">
                  {{ t('memory_profiles.delete_memory') }}
                </SButton>
              </div>
            </div>
            <div v-if="selected" class="memory-detail-meta">
              <span>{{ t('memory_profiles.updated_at') }}: {{ fmtTime(selected.updatedAt) }}</span>
              <span>{{ t('memory_profiles.created_at') }}: {{ fmtTime(selected.createdAt) }}</span>
            </div>
            <pre class="memory-body">{{ bodyLoading ? t('memory_profiles.loading') : (selectedBody || t('memory_profiles.no_body')) }}</pre>
          </section>
        </div>
      </div>

      <div v-else class="memory-tab-pane">
        <div class="memory-tab-toolbar">
          <SSelect v-model="selectedWorkPath" size="sm" @change="changeScope">
            <option value="">{{ t('memory_profiles.scope_global') }}</option>
            <option v-for="scope in workspaceScopes" :key="scope.key" :value="scope.path">
              {{ t('memory_profiles.scope_workspace_context', { path: scope.path }) }}
            </option>
          </SSelect>
          <SButton type="outline" size="sm" :loading="jobsLoading" @click="loadJobs">{{ t('common.refresh') }}</SButton>
        </div>

        <div class="memory-jobs">
          <div v-if="jobsLoading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
          <div v-else-if="jobs.length === 0" class="memory-empty">{{ t('memory_profiles.no_jobs') }}</div>
          <div v-for="job in jobs" v-else :key="job.id" class="memory-job">
            <div class="memory-job-head">
              <div class="memory-job-id">#{{ job.id }}</div>
              <div class="memory-job-actions">
                <SButton
                  v-if="job.status === 'failed'"
                  type="outline"
                  size="sm"
                  :loading="retryingJobId === job.id"
                  @click="retryFailedJob(job)"
                >
                  {{ t('memory_profiles.retry_job') }}
                </SButton>
                <SButton
                  v-if="job.status === 'failed'"
                  type="danger"
                  size="sm"
                  :loading="deletingJobId === job.id"
                  @click="deleteFailedJob(job)"
                >
                  {{ t('memory_profiles.delete_job') }}
                </SButton>
                <SBadge :variant="jobVariant(job.status)" size="sm">{{ jobStatusLabel(job.status) }}</SBadge>
              </div>
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
    </div>
  </SModal>
</template>

<style scoped>
.memory-viewer {
  display: flex;
  flex-direction: column;
  min-height: 560px;
  max-height: 72vh;
  overflow: hidden;
}

.memory-tabs {
  padding: 0;
  background: transparent;
}

.memory-tab-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.memory-tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border-subtle);
}

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
.memory-row-badges,
.memory-row-meta,
.memory-detail-badges,
.memory-job-head,
.memory-job-actions {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
}

.memory-row-head,
.memory-job-head {
  justify-content: space-between;
}

.memory-job-actions {
  justify-content: flex-end;
  white-space: nowrap;
}

.memory-row-slug,
.memory-detail-slug,
.memory-job-grid code {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
}

/* title 是唯一标签，最长 150 字符——列表里裁到两行，全文在右侧详情区 */
.memory-row-title {
  font-weight: 600;
  margin-top: var(--sui-sp-2);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
  .memory-tab-toolbar,
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
