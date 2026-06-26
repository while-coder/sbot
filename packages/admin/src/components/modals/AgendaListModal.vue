<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SModal } from 'sbot-ui'
import AgendaBoard from '@/components/AgendaBoard.vue'
import AgendaTriggerEditModal from '@/components/modals/AgendaTriggerEditModal.vue'
import { useAgendas, type AgendaRow } from '@/composables/useAgendas'

const { t } = useI18n()

const visible = ref(false)
const agendaIdRef = ref('')
const sessionLabel = ref('')

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

function onAddTrigger(payload: { row: AgendaRow }): void {
  triggerEditModal.value?.openCreate(payload.row)
}

function onTriggerSubmit(payload: { row: AgendaRow; spec: Record<string, unknown> }): void {
  addTrigger({ row: payload.row, spec: payload.spec })
}

const title = computed(() => sessionLabel.value ? `${t('agenda.title')} - ${sessionLabel.value}` : t('agenda.title'))

async function openByAgendaId(agendaId: string | null | undefined, label?: string) {
  agendaIdRef.value = agendaId ? String(agendaId) : ''
  sessionLabel.value = label || (agendaId ? String(agendaId) : '')
  visible.value = true
  if (agendaIdRef.value) await load()
}

watch(statusFilter, () => {
  if (visible.value && agendaIdRef.value) load()
})

defineExpose({ openByAgendaId })
</script>

<template>
  <SModal v-model:visible="visible" :title="title" width="xl">
    <AgendaBoard
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
      @cancel-trigger="cancelTrigger"
      @reopen-trigger="reopenTrigger"
      @remove-trigger="removeTrigger"
      @update-trigger="updateTrigger"
      @add-trigger="onAddTrigger"
    />
    <AgendaTriggerEditModal ref="triggerEditModal" @submit="onTriggerSubmit" />
  </SModal>
</template>
