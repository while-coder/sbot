<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SModal, SButton, SBadge } from 'sbot-ui'
import { TYPE_VARIANT, detectUIType, describeExpr, type SchedulerRow } from '@/utils/scheduler'

const { t, locale } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const visible      = ref(false)
const profileIdRef = ref<string | null>(null)
const sessionLabel = ref('')
const loading      = ref(false)
const rows         = ref<SchedulerRow[]>([])

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(locale.value === 'zh' ? 'zh-CN' : undefined)
}

async function load() {
  if (!profileIdRef.value) return
  loading.value = true
  try {
    const res = await apiFetch(`/api/schedulers?profileId=${encodeURIComponent(profileIdRef.value)}`)
    rows.value = res.data || []
  } catch (e: any) {
    show(e?.message || String(e), 'error')
  } finally {
    loading.value = false
  }
}

async function remove(row: SchedulerRow) {
  if (!await confirm(t('scheduler.confirm_delete', { id: row.id }), { danger: true })) return
  try {
    await apiFetch(`/api/schedulers/${row.id}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e?.message || String(e), 'error')
  }
}

function openByProfileId(profileId: string, label: string) {
  profileIdRef.value = profileId
  sessionLabel.value = label
  rows.value         = []
  visible.value      = true
  load()
}

defineExpose({ openByProfileId })
</script>

<template>
  <SModal v-model:visible="visible" width="lg">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h3 class="s-modal-title">{{ t('scheduler.title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ sessionLabel }}</SBadge>
      </div>
    </template>

    <template #toolbar>
      <SButton type="outline" size="sm" :disabled="loading" @click="load">
        {{ loading ? t('common.loading') : t('common.refresh') }}
      </SButton>
    </template>

    <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
    <div v-else-if="rows.length === 0" class="modal-empty">{{ t('scheduler.empty') }}</div>
    <ul v-else class="sched-list">
      <li v-for="row in rows" :key="row.id" class="sched-row">
        <div class="sched-row-main">
          <span class="sched-row-id">#{{ row.id }}</span>
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" size="sm">
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
          <SBadge :variant="TYPE_VARIANT[detectUIType(row.expr)]" size="sm" pill>
            {{ t(`scheduler.type_${detectUIType(row.expr)}`) }}
          </SBadge>
          <span class="sched-row-desc" :title="row.expr">{{ describeExpr(row.expr, t) }}</span>
          <SBadge :variant="row.aiProcess ? 'accent' : 'neutral'" size="sm">
            {{ row.aiProcess ? t('scheduler.mode_ai') : t('scheduler.mode_raw') }}
          </SBadge>
        </div>
        <div class="sched-row-meta">
          <span class="sched-row-message" :title="row.message">{{ row.message }}</span>
          <span class="sched-row-time">⏱ {{ t('scheduler.next_run_col') }}: {{ formatTime(row.nextRun) }}</span>
          <span v-if="row.lastRun" class="sched-row-time">↺ {{ t('scheduler.last_run_col') }}: {{ formatTime(row.lastRun) }}</span>
          <span class="sched-row-time">
            ×{{ row.runCount }}<template v-if="row.maxRuns > 0">/{{ row.maxRuns }}</template>
          </span>
        </div>
        <div class="sched-row-ops">
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </div>
      </li>
    </ul>
  </SModal>
</template>

<style scoped>
.modal-loading,
.modal-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 60px 0;
  font-size: var(--sui-fs-lg);
}

.sched-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.sched-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px var(--sui-sp-3);
  align-items: center;
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border);
}
.sched-row:last-child { border-bottom: none; }
.sched-row-main {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
  flex-wrap: wrap;
}
.sched-row-id {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  flex-shrink: 0;
}
.sched-row-desc {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
  cursor: help;
}
.sched-row-meta {
  grid-column: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sui-sp-3);
  padding-left: 28px;
}
.sched-row-message {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sched-row-time {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.sched-row-ops {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
  flex-shrink: 0;
}
</style>
