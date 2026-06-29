<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SBadge, SModal, useToast } from 'sbot-ui'
import { apiFetch } from '@/shared/api'
import type { AgendaRow, AgendaTrigger, AgendaTriggerFire } from '@/composables/useAgendas'

const { t } = useI18n()
const { show } = useToast()

const visible = ref(false)
const loading = ref(false)
const fires = ref<AgendaTriggerFire[]>([])
// 'trigger' = 单条触发器历史；'item' = 整条 item（含其所有触发器）聚合历史。
const scope = ref<'trigger' | 'item'>('trigger')
const targetId = ref<number | null>(null)

// item 维度下不同 fire 可能来自不同触发器，列表里标出来源触发器编号。
const showTriggerId = computed(() => scope.value === 'item')

const title = computed(() => {
  if (targetId.value == null) return t('agenda.fires_title_plain')
  const key = scope.value === 'item' ? 'agenda.fires_item_title' : 'agenda.fires_title'
  return t(key, { id: targetId.value })
})

function actionLabel(action: AgendaTriggerFire['action']): string { return t(`agenda.action_${action}`) }

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('agenda.no_time')
  return new Date(ts).toLocaleString()
}

async function fetchFires(url: string) {
  fires.value = []
  visible.value = true
  loading.value = true
  try {
    const res = await apiFetch(url)
    fires.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function openFor(row: AgendaRow, trigger: AgendaTrigger) {
  scope.value = 'trigger'
  targetId.value = trigger.id
  await fetchFires(`/api/agendas/triggers/${trigger.id}/fires?agendaId=${encodeURIComponent(row.agendaId)}`)
}

async function openForItem(row: AgendaRow) {
  scope.value = 'item'
  targetId.value = row.item.id
  await fetchFires(`/api/agendas/${row.item.id}/fires?agendaId=${encodeURIComponent(row.agendaId)}`)
}

defineExpose({ openFor, openForItem })
</script>

<template>
  <SModal
    v-model:visible="visible"
    :title="title"
    width="lg"
  >
    <div v-if="loading" class="fires-empty">{{ t('common.loading') }}</div>
    <div v-else-if="fires.length === 0" class="fires-empty">{{ t('agenda.fires_empty') }}</div>
    <ul v-else class="fires-list">
      <li v-for="fire in fires" :key="fire.id" class="fires-row">
        <div class="fires-head">
          <span class="fires-time">{{ formatTime(fire.firedAt) }}</span>
          <SBadge v-if="showTriggerId" variant="neutral" size="xs">#{{ fire.triggerId }}</SBadge>
          <SBadge :variant="fire.delivered ? 'success' : 'danger'" size="xs">
            {{ fire.delivered ? t('agenda.fires_delivered') : t('agenda.fires_failed') }}
          </SBadge>
          <SBadge variant="info" size="xs">{{ actionLabel(fire.action) }}</SBadge>
          <span
            v-if="fire.scheduledAt && fire.scheduledAt !== fire.firedAt"
            class="fires-scheduled"
            :title="t('agenda.fires_scheduled')"
          >📅 {{ formatTime(fire.scheduledAt) }}</span>
        </div>
        <pre v-if="fire.message" class="fires-msg">{{ fire.message }}</pre>
      </li>
    </ul>
  </SModal>
</template>

<style scoped>
.fires-empty {
  padding: var(--sui-sp-5) 0;
  text-align: center;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.fires-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-2);
}
.fires-row {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  padding: var(--sui-sp-2) var(--sui-sp-3);
  background: var(--sui-bg-soft);
}
.fires-head {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.fires-time {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg);
}
.fires-scheduled {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-muted);
}
.fires-msg {
  margin: var(--sui-sp-2) 0 0;
  padding: var(--sui-sp-2) var(--sui-sp-3);
  background: var(--sui-bg);
  border-radius: var(--sui-radius-sm);
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-xs);
  font-family: var(--sui-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
