<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, SButton, SModal, SBadge } from 'sbot-ui'

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

const visible = ref(false)
const memoryId = ref('')
const labelOverride = ref('')

const tab = ref<'memories' | 'jobs'>('memories')
const loading = ref(false)
const jobsLoading = ref(false)
const bodyLoading = ref(false)
const running = ref(false)
const consolidating = ref(false)

const rows = ref<MemorySummary[]>([])
const jobs = ref<MemoryJob[]>([])
const selectedSlug = ref('')
const selectedBody = ref('')

const selected = computed(() => rows.value.find(m => m.slug === selectedSlug.value) || null)

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
  if (memoryId.value) await refresh()
  else { rows.value = []; jobs.value = []; selectedSlug.value = ''; selectedBody.value = '' }
}

async function refresh() {
  if (!memoryId.value) return
  await Promise.all([loadMemories(), loadJobs()])
}

async function loadMemories() {
  if (!memoryId.value) return
  loading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/list`)
    const list = (res.data?.memories || []) as MemorySummary[]
    rows.value = list
    const nextSlug = list.find(r => r.slug === selectedSlug.value)?.slug || list[0]?.slug || ''
    selectedSlug.value = nextSlug
    if (nextSlug) await loadBody(nextSlug)
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
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/jobs?limit=50`)
    jobs.value = (res.data?.jobs || []) as MemoryJob[]
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    jobsLoading.value = false
  }
}

async function selectMemory(slug: string) {
  if (selectedSlug.value === slug && selectedBody.value) return
  selectedSlug.value = slug
  await loadBody(slug)
}

async function loadBody(slug: string) {
  if (!memoryId.value || !slug) return
  bodyLoading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/entries/${encodeURIComponent(slug)}`)
    selectedBody.value = res.data?.row?.body || ''
  } catch (e: any) {
    selectedBody.value = ''
    show(e.message, 'error')
  } finally {
    bodyLoading.value = false
  }
}

async function runExtract() {
  if (!memoryId.value || running.value) return
  running.value = true
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/extract/run`, 'POST', {})
    show(t('memory_profiles.extract_done'))
    await refresh()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    running.value = false
  }
}

async function runConsolidate() {
  if (!memoryId.value || consolidating.value) return
  consolidating.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memoryId.value)}/consolidate/run`, 'POST', {})
    show(t('memory_profiles.consolidate_queued', { id: res.data?.jobId ?? '-' }))
    await refresh()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    consolidating.value = false
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

defineExpose({ openByMemoryId })
</script>

<template>
  <SModal v-model:visible="visible" :title="title" width="xl">
    <div class="memory-viewer">
      <div class="memory-viewer-toolbar">
        <div class="memory-tabs">
          <SButton :type="tab === 'memories' ? 'primary' : 'outline'" size="sm" @click="tab = 'memories'">
            {{ t('memory_profiles.viewer_memories') }}
          </SButton>
          <SButton :type="tab === 'jobs' ? 'primary' : 'outline'" size="sm" @click="tab = 'jobs'">
            {{ t('memory_profiles.viewer_jobs') }}
          </SButton>
        </div>
        <div class="memory-actions">
          <SButton type="outline" size="sm" :loading="loading || jobsLoading" @click="refresh">{{ t('common.refresh') }}</SButton>
          <SButton type="outline" size="sm" :loading="running" @click="runExtract">{{ t('memory_profiles.run_extract') }}</SButton>
          <SButton type="outline" size="sm" :loading="consolidating" @click="runConsolidate">{{ t('memory_profiles.run_consolidate') }}</SButton>
        </div>
      </div>

      <div v-if="tab === 'memories'" class="memory-pane">
        <aside class="memory-list">
          <div v-if="loading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
          <div v-else-if="rows.length === 0" class="memory-empty">{{ t('memory_profiles.no_memories') }}</div>
          <button
            v-for="m in rows"
            v-else
            :key="m.slug"
            class="memory-row"
            :class="{ active: m.slug === selectedSlug }"
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
          <div v-if="selected" class="memory-detail-head">
            <div>
              <div class="memory-detail-title">{{ selected.title }}</div>
              <div class="memory-detail-slug">{{ selected.slug }}</div>
            </div>
            <div class="memory-detail-badges">
              <SBadge :variant="kindVariant(selected.kind)" size="sm">{{ selected.kind }}</SBadge>
              <SBadge variant="neutral" size="sm">{{ t('memory_profiles.evidence') }} {{ selected.evidenceCount }}</SBadge>
              <SBadge variant="neutral" size="sm">{{ t('memory_profiles.read_count') }} {{ selected.readCount }}</SBadge>
            </div>
          </div>
          <div v-if="selected" class="memory-detail-meta">
            <span>{{ t('memory_profiles.updated_at') }}: {{ fmtTime(selected.updatedAt) }}</span>
            <span>{{ t('memory_profiles.created_at') }}: {{ fmtTime(selected.createdAt) }}</span>
          </div>
          <pre class="memory-body">{{ bodyLoading ? t('memory_profiles.loading') : (selectedBody || t('memory_profiles.no_body')) }}</pre>
        </section>
      </div>

      <div v-else class="memory-jobs">
        <div v-if="jobsLoading" class="memory-empty">{{ t('memory_profiles.loading') }}</div>
        <div v-else-if="jobs.length === 0" class="memory-empty">{{ t('memory_profiles.no_jobs') }}</div>
        <div v-for="job in jobs" v-else :key="job.id" class="memory-job">
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
</template>

<style scoped>
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
