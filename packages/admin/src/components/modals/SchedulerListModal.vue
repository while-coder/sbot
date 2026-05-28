<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SModal, SButton, SBadge } from 'sbot-ui'
import { WEB_CHANNEL_ID } from 'sbot.commons'

const { t, locale } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

interface SchedulerRow {
  id: number
  expr: string
  message: string
  targetId: string | null
  aiProcess: boolean
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

type UIType = 'daily' | 'weekly' | 'monthly' | 'once' | 'interval' | 'hourly' | 'custom'

const TYPE_VARIANT: Record<UIType, 'info' | 'accent' | 'success' | 'warning' | 'neutral'> = {
  interval: 'info',
  hourly:   'accent',
  daily:    'success',
  weekly:   'warning',
  monthly:  'warning',
  once:     'accent',
  custom:   'neutral',
}

const visible      = ref(false)
const dbSessionId  = ref<number | null>(null)
const sessionIdRef = ref<string | null>(null)
const sessionLabel = ref('')
const loading      = ref(false)
const all          = ref<SchedulerRow[]>([])

const filtered = computed(() => {
  if (dbSessionId.value == null) return []
  const target = String(dbSessionId.value)
  return all.value.filter(r => r.targetId === target)
})

interface CronFields { s: string; m: string; h: string; dom: string; mon: string; dow: string }

function parseCron(expr: string): CronFields | null {
  const p = expr.trim().split(/\s+/)
  if (p.length === 6) return { s: p[0], m: p[1], h: p[2], dom: p[3], mon: p[4], dow: p[5] }
  if (p.length === 5) return { s: '0', m: p[0], h: p[1], dom: p[2], mon: p[3], dow: p[4] }
  return null
}

function detectUIType(expr: string): UIType {
  const f = parseCron(expr)
  if (!f) return 'custom'
  const { s, m, h, dom, mon, dow } = f
  const allRest = dom === '*' && mon === '*' && dow === '*'
  if (/^\*\/\d+$/.test(s) && m === '*' && h === '*' && allRest) return 'interval'
  if (s === '0' && /^\*\/\d+$/.test(m) && h === '*' && allRest)  return 'interval'
  if (s === '0' && m === '0' && /^\*\/\d+$/.test(h) && allRest)  return 'interval'
  if (/^\d+$/.test(s) && /^\d+$/.test(m) && h === '*' && allRest) return 'hourly'
  if (/^\d+$/.test(s) && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    if (dom === '*' && mon === '*' && /^\d$/.test(dow))                              return 'weekly'
    if (/^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*')                       return 'once'
    if (/^\d+$/.test(dom) && mon === '*' && dow === '*')                             return 'monthly'
    if (allRest)                                                                      return 'daily'
  }
  return 'custom'
}

function describeExpr(expr: string): string {
  const f = parseCron(expr)
  if (!f) return expr
  const { s, m, h, dom, mon, dow } = f
  const pad = (v: string) => String(parseInt(v)).padStart(2, '0')
  const allRest = dom === '*' && mon === '*' && dow === '*'

  if (/^\*\/\d+$/.test(s) && m === '*' && h === '*' && allRest)
    return t('scheduler.cron_every_n_seconds', { n: s.slice(2) })
  if (s === '0' && /^\*\/\d+$/.test(m) && h === '*' && allRest)
    return t('scheduler.cron_every_n_minutes', { n: m.slice(2) })
  if (s === '0' && m === '0' && /^\*\/\d+$/.test(h) && allRest)
    return t('scheduler.cron_every_n_hours', { n: h.slice(2) })

  if (/^\d+$/.test(s) && /^\d+$/.test(m) && h === '*' && allRest) {
    if (s === '0' && m === '0') return t('scheduler.cron_hourly')
    if (s === '0')              return t('scheduler.cron_hourly_at', { minute: pad(m) })
    return t('scheduler.cron_hourly_at_sec', { minute: pad(m), second: pad(s) })
  }

  if (/^\d+$/.test(s) && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    const time = s === '0'
      ? `${pad(h)}:${pad(m)}`
      : `${pad(h)}:${pad(m)}:${pad(s)}`
    if (dom === '*' && mon === '*' && /^\d$/.test(dow))
      return t('scheduler.cron_weekly', { day: t(`scheduler.weekday_${dow}`), time })
    if (/^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*')
      return t('scheduler.cron_once', { month: parseInt(mon), day: parseInt(dom), time })
    if (/^\d+$/.test(dom) && mon === '*' && dow === '*')
      return t('scheduler.cron_monthly', { day: dom, time })
    if (allRest)
      return t('scheduler.cron_daily', { time })
  }

  return expr
}

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(locale.value === 'zh' ? 'zh-CN' : undefined)
}

async function load() {
  loading.value = true
  try {
    const [timersRes, sessionsRes] = await Promise.all([
      apiFetch('/api/schedulers'),
      apiFetch(`/api/channel-sessions?channelId=${encodeURIComponent(WEB_CHANNEL_ID)}`),
    ])
    all.value = timersRes.data || []
    if (dbSessionId.value == null && sessionIdRef.value) {
      const sessions: ChannelSessionRow[] = sessionsRes.data || []
      const row = sessions.find(s => s.channelId === WEB_CHANNEL_ID && s.sessionId === sessionIdRef.value)
      dbSessionId.value = row?.id ?? null
    }
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

function open(id: number, label: string) {
  dbSessionId.value  = id
  sessionIdRef.value = null
  sessionLabel.value = label
  all.value          = []
  visible.value      = true
  load()
}

function openBySessionId(sid: string, label: string) {
  dbSessionId.value  = null
  sessionIdRef.value = sid
  sessionLabel.value = label
  all.value          = []
  visible.value      = true
  load()
}

defineExpose({ open, openBySessionId })
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
    <div v-else-if="filtered.length === 0" class="modal-empty">{{ t('scheduler.empty') }}</div>
    <ul v-else class="sched-list">
      <li v-for="row in filtered" :key="row.id" class="sched-row">
        <div class="sched-row-main">
          <span class="sched-row-id">#{{ row.id }}</span>
          <SBadge :variant="TYPE_VARIANT[detectUIType(row.expr)]" size="sm" pill>
            {{ t(`scheduler.type_${detectUIType(row.expr)}`) }}
          </SBadge>
          <span class="sched-row-desc" :title="row.expr">{{ describeExpr(row.expr) }}</span>
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
