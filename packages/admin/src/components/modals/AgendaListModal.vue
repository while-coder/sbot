<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SBadge, SButton, SModal, STab, STabBar, useToast } from 'sbot-ui'
import AgendaBoard from '@/components/AgendaBoard.vue'
import AgendaTriggerEditModal from '@/components/modals/AgendaTriggerEditModal.vue'
import AgendaFiresModal from '@/components/modals/AgendaFiresModal.vue'
import { useAgendas, type AgendaRow, type AgendaTrigger } from '@/composables/useAgendas'
import { apiFetch } from '@/shared/api'

interface AgendaJob {
  id: number
  channelSessionId: number
  messageCount: number
  status: 'pending' | 'failed'
  attemptCount: number
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

const { t } = useI18n()
const { show } = useToast()

const visible = ref(false)
const agendaIdRef = ref('')
const sessionLabel = ref('')
const tab = ref<'items' | 'jobs'>('items')
const jobsLoading = ref(false)
const jobs = ref<AgendaJob[]>([])

const {
  loading,
  statusFilter,
  sortedAgendas,
  pendingCount,
  dueCount,
  cancelledCount,
  triggerCount,
  load,
  complete,
  cancel,
  reopen,
  remove,
  update,
  fireTrigger,
  cancelTrigger,
  reopenTrigger,
  removeTrigger,
  addTrigger,
  updateTrigger,
} = useAgendas({
  buildQuery: () => agendaIdRef.value ? `agendaId=${encodeURIComponent(agendaIdRef.value)}` : null,
  limit: 300,
})

const triggerEditModal = ref<InstanceType<typeof AgendaTriggerEditModal> | null>(null)
const firesModal = ref<InstanceType<typeof AgendaFiresModal> | null>(null)

function onAddTrigger(payload: { row: AgendaRow }): void {
  triggerEditModal.value?.openCreate(payload.row)
}

function onViewFires(payload: { row: AgendaRow; trigger: AgendaTrigger }): void {
  firesModal.value?.openFor(payload.row, payload.trigger)
}

function onViewItemFires(payload: { row: AgendaRow }): void {
  firesModal.value?.openForItem(payload.row)
}

function onTriggerSubmit(payload: { row: AgendaRow; spec: Record<string, unknown> }): void {
  addTrigger({ row: payload.row, spec: payload.spec })
}

const title = computed(() => sessionLabel.value ? `${t('agenda.title')} - ${sessionLabel.value}` : t('agenda.title'))

async function loadJobs(): Promise<void> {
  if (!agendaIdRef.value) return
  jobsLoading.value = true
  try {
    const query = `agendaId=${encodeURIComponent(agendaIdRef.value)}&limit=50`
    const res = await apiFetch(`/api/agendas/jobs?${query}`)
    jobs.value = (res.data?.jobs || []) as AgendaJob[]
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    jobsLoading.value = false
  }
}

function fmtTime(value: number | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function jobStatusLabel(status: AgendaJob['status']): string {
  return t(status === 'failed' ? 'agenda.job_status_failed' : 'agenda.job_status_pending')
}

function jobVariant(status: AgendaJob['status']): 'warning' | 'danger' {
  return status === 'failed' ? 'danger' : 'warning'
}

async function openByAgendaId(agendaId: string | null | undefined, label?: string) {
  agendaIdRef.value = agendaId ? String(agendaId) : ''
  sessionLabel.value = label || (agendaId ? String(agendaId) : '')
  tab.value = 'items'
  jobs.value = []
  visible.value = true
  if (agendaIdRef.value) await load()
}

watch(statusFilter, () => {
  if (visible.value && agendaIdRef.value) load()
})

watch(tab, value => {
  if (value === 'jobs' && visible.value && agendaIdRef.value) loadJobs()
})

defineExpose({ openByAgendaId })
</script>

<template>
  <SModal v-model:visible="visible" :title="title" width="xl">
    <div class="agenda-viewer-tabs">
      <STabBar v-model="tab" class="agenda-tabs">
        <STab name="items">{{ t('agenda.viewer_items') }}</STab>
        <STab name="jobs">{{ t('agenda.viewer_jobs') }}</STab>
      </STabBar>
      <SButton v-if="tab === 'jobs'" type="outline" size="sm" :loading="jobsLoading" @click="loadJobs">
        {{ t('common.refresh') }}
      </SButton>
    </div>
    <AgendaBoard
      v-if="tab === 'items'"
      v-model:status-filter="statusFilter"
      :items="sortedAgendas"
      :loading="loading"
      :pending-count="pendingCount"
      :due-count="dueCount"
      :cancelled-count="cancelledCount"
      :trigger-count="triggerCount"
      :show-profile="false"
      compact
      @refresh="load"
      @complete="complete"
      @cancel="cancel"
      @reopen="reopen"
      @remove="remove"
      @update="update"
      @fire-trigger="fireTrigger"
      @view-fires="onViewFires"
      @view-item-fires="onViewItemFires"
      @cancel-trigger="cancelTrigger"
      @reopen-trigger="reopenTrigger"
      @remove-trigger="removeTrigger"
      @update-trigger="updateTrigger"
      @add-trigger="onAddTrigger"
    />
    <div v-else class="agenda-jobs">
      <div v-if="jobsLoading" class="agenda-jobs-empty">{{ t('common.loading') }}</div>
      <div v-else-if="jobs.length === 0" class="agenda-jobs-empty">{{ t('agenda.no_jobs') }}</div>
      <article v-for="job in jobs" v-else :key="job.id" class="agenda-job">
        <div class="agenda-job-head">
          <strong>#{{ job.id }}</strong>
          <SBadge :variant="jobVariant(job.status)" size="sm">{{ jobStatusLabel(job.status) }}</SBadge>
        </div>
        <dl class="agenda-job-grid">
          <dt>{{ t('agenda.job_type') }}</dt><dd>{{ t('agenda.job_type_sync') }}</dd>
          <dt>{{ t('agenda.job_channel_session') }}</dt><dd><code>{{ job.channelSessionId || '-' }}</code></dd>
          <dt>{{ t('agenda.job_message_count') }}</dt><dd>{{ job.messageCount }}</dd>
          <dt>{{ t('agenda.attempt_count') }}</dt><dd>{{ job.attemptCount }}</dd>
          <dt>{{ t('agenda.created_at') }}</dt><dd><code>{{ fmtTime(job.createdAt) }}</code></dd>
          <dt>{{ t('agenda.updated_at') }}</dt><dd><code>{{ fmtTime(job.updatedAt) }}</code></dd>
          <dt>{{ t('agenda.error_message') }}</dt><dd><code>{{ job.errorMessage || '-' }}</code></dd>
        </dl>
      </article>
    </div>
    <AgendaTriggerEditModal ref="triggerEditModal" @submit="onTriggerSubmit" />
    <AgendaFiresModal ref="firesModal" />
  </SModal>
</template>

<style scoped>
.agenda-viewer-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
  border-bottom: 1px solid var(--sui-border-subtle);
}

.agenda-tabs {
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.agenda-jobs {
  min-height: 520px;
  max-height: 68vh;
  overflow: auto;
}

.agenda-job {
  padding: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-2);
  border: 1px solid var(--sui-border-subtle);
  border-radius: var(--sui-radius-sm);
}

.agenda-job-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-2);
}

.agenda-job-grid {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: var(--sui-sp-2);
  margin: var(--sui-sp-3) 0 0;
  font-size: var(--sui-fs-sm);
}

.agenda-job-grid dt { color: var(--sui-fg-muted); }
.agenda-job-grid dd { margin: 0; overflow-wrap: anywhere; }
.agenda-job-grid code { font-family: var(--sui-font-mono); font-size: var(--sui-fs-xs); }

.agenda-jobs-empty {
  padding: var(--sui-sp-4);
  color: var(--sui-fg-muted);
  text-align: center;
}

@media (max-width: 700px) {
  .agenda-job-grid { grid-template-columns: 1fr; }
}
</style>
