<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SModal } from 'sbot-ui'
import AgendaBoard from '@/components/AgendaBoard.vue'
import { useAgendas } from '@/composables/useAgendas'

const { t } = useI18n()

const visible = ref(false)
const profileIdRef = ref('')
const sessionLabel = ref('')

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
} = useAgendas({
  buildQuery: () => profileIdRef.value ? `profileId=${encodeURIComponent(profileIdRef.value)}` : null,
  limit: 300,
})

const title = computed(() => sessionLabel.value ? `${t('agenda.title')} - ${sessionLabel.value}` : t('agenda.title'))

async function openByProfileId(profileId: string | number, label?: string) {
  profileIdRef.value = String(profileId)
  sessionLabel.value = label || String(profileId)
  visible.value = true
  await load()
}

watch([statusFilter, viewFilter], () => {
  if (visible.value) load()
})

defineExpose({ openByProfileId })
</script>

<template>
  <SModal v-model:visible="visible" :title="title" width="xl">
    <AgendaBoard
      v-model:view-filter="viewFilter"
      v-model:status-filter="statusFilter"
      :items="sortedAgendas"
      :loading="loading"
      :pending-count="pendingCount"
      :due-count="dueCount"
      :trigger-count="triggerCount"
      :show-profile="false"
      compact
      @refresh="load"
      @complete="complete"
      @cancel="cancel"
      @skip-next="skipNext"
      @remove="remove"
    />
  </SModal>
</template>
