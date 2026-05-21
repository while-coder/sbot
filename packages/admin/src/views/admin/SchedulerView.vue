<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, SButton, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'

const { t } = useI18n()

interface SchedulerRow {
  id: number
  expr: string
  message: string
  targetId: string | null
  lastRun: number | null
  nextRun: number | null
  runCount: number
  maxRuns: number
}

interface ChannelSessionRow {
  id: number
  channelId: string
  sessionId: string
}

type UIType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'hourly' | 'custom'

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const channelSessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)

const columns = computed<STableColumn[]>(() => [
  { key: 'id',       label: t('common.id') },
  { key: 'schedule', label: t('scheduler.schedule_col'), primary: true },
  { key: 'message',  label: t('scheduler.message_col') },
  { key: 'target',   label: t('scheduler.target_col') },
  { key: 'runCount', label: t('scheduler.run_count_col') },
  { key: 'lastRun',  label: t('scheduler.last_run_col') },
  { key: 'nextRun',  label: t('scheduler.next_run_col') },
  { key: 'ops',      label: t('common.ops'), ops: true },
])

function detectUIType(expr: string): UIType {
  const p = expr.trim().split(/\s+/)
  if (p.length !== 5) return 'custom'
  const [m, h, dom, mon, dow] = p
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'interval'
  if (/^\d+$/.test(m)     && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'hourly'
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && /^\d$/.test(dow)) return 'weekly'
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === '*' && dow === '*') return 'monthly'
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return 'daily'
  return 'custom'
}

function describeExpr(expr: string): string {
  const uiType = detectUIType(expr)
  const p = expr.trim().split(/\s+/)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (uiType === 'interval') return t('scheduler.cron_every_n_minutes', { n: p[0].slice(2) })
  if (uiType === 'hourly')   return t('scheduler.cron_hourly')
  if (uiType === 'daily')    return t('scheduler.cron_daily', { hour: pad(parseInt(p[1])), minute: pad(parseInt(p[0])) })
  if (uiType === 'weekly')   return t('scheduler.cron_weekly', { day: t(`scheduler.weekday_${p[4]}`), hour: pad(parseInt(p[1])), minute: pad(parseInt(p[0])) })
  if (uiType === 'monthly')  return `每月${p[2]}日 ${pad(parseInt(p[1]))}:${pad(parseInt(p[0]))}`
  return expr
}

function targetLabel(row: SchedulerRow): string {
  if (row.targetId == null) return '-'
  const id = parseInt(row.targetId)
  const s = channelSessions.value.find(s => s.id === id)
  return s ? s.sessionId : row.targetId
}

async function load() {
  loading.value = true
  try {
    const [timersRes, sessionsRes] = await Promise.all([
      apiFetch('/api/schedulers'),
      apiFetch('/api/channel-sessions'),
    ])
    timers.value = timersRes.data || []
    channelSessions.value = sessionsRes.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function formatLastRun(ts: number | null): string {
  if (!ts) return t('scheduler.not_run')
  return new Date(ts).toLocaleString('zh-CN')
}

function formatNextRun(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

async function remove(row: SchedulerRow) {
  if (!confirm(t('scheduler.confirm_delete', { id: row.id }))) return
  try {
    await apiFetch(`/api/schedulers/${row.id}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar :title="t('scheduler.title')">
      <template #actions>
        <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      </template>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="timers"
        row-key="id"
        :loading="loading"
        :loading-text="t('common.loading')"
        :empty-text="t('scheduler.empty')"
      >
        <template #id="{ row }"><span class="sched-id">{{ row.id }}</span></template>
        <template #schedule="{ row }">
          <div class="sched-desc">{{ describeExpr(row.expr) }}</div>
          <div class="sched-expr">{{ row.expr }}</div>
        </template>
        <template #message="{ row }"><span class="sched-message">{{ row.message }}</span></template>
        <template #target="{ row }"><span class="sched-target">{{ targetLabel(row) }}</span></template>
        <template #runCount="{ row }">
          <span class="sched-count">{{ row.runCount }}{{ row.maxRuns > 0 ? ` / ${row.maxRuns}` : '' }}</span>
        </template>
        <template #lastRun="{ row }"><span class="sched-time">{{ formatLastRun(row.lastRun) }}</span></template>
        <template #nextRun="{ row }"><span class="sched-time">{{ formatNextRun(row.nextRun) }}</span></template>
        <template #ops="{ row }">
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>
  </div>
</template>

<style scoped>
.sched-id {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
}
.sched-desc { font-size: var(--sui-fs-md); }
.sched-expr {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
}
.sched-message {
  display: inline-block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sui-fg-muted);
  vertical-align: bottom;
}
.sched-target {
  display: inline-block;
  font-size: var(--sui-fs-sm);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.sched-count {
  font-size: var(--sui-fs-sm);
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.sched-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
</style>
