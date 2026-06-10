<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SPageContent, SPageToolbar } from 'sbot-ui'
import AgendaBoard from '@/components/AgendaBoard.vue'
import { useAgendas } from '@/composables/useAgendas'

const { t } = useI18n()

const {
  loading,
  statusFilter,
  viewFilter,
  sortedAgendas,
  pendingCount,
  dueCount,
  triggerCount,
  load,
  complete,
  cancel,
  skipNext,
  remove,
} = useAgendas({ buildQuery: () => '', limit: 1000 })

watch([statusFilter, viewFilter], () => load())
onMounted(load)
</script>

<template>
  <div class="agenda-page">
    <SPageToolbar :title="t('agenda.title')" />
    <SPageContent :padded="false">
      <div class="agenda-shell">
        <AgendaBoard
          v-model:view-filter="viewFilter"
          v-model:status-filter="statusFilter"
          :items="sortedAgendas"
          :loading="loading"
          :pending-count="pendingCount"
          :due-count="dueCount"
          :trigger-count="triggerCount"
          :show-profile="true"
          @refresh="load"
          @complete="complete"
          @cancel="cancel"
          @skip-next="skipNext"
          @remove="remove"
        />
      </div>
    </SPageContent>
  </div>
</template>

<style scoped>
.agenda-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.agenda-shell {
  min-height: 100%;
  padding: var(--sui-sp-6);
  background: var(--sui-bg-subtle);
}

@media (max-width: 700px) {
  .agenda-shell { padding: var(--sui-sp-4); }
}
</style>
