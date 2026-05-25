<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SButton, SBadge, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { store } from '@/shared/store'

const { t, locale } = useI18n()
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
  sessionName?: string | null
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

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const channelSessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)
const now = ref(Date.now())

const columns = computed<STableColumn[]>(() => [
  { key: 'id',       label: t('common.id') },
  { key: 'schedule', label: t('scheduler.schedule_col'), primary: true },
  { key: 'message',  label: t('scheduler.message_col') },
  { key: 'mode',     label: t('scheduler.mode_col') },
  { key: 'target',   label: t('scheduler.target_col') },
  { key: 'runCount', label: t('scheduler.run_count_col') },
  { key: 'lastRun',  label: t('scheduler.last_run_col') },
  { key: 'nextRun',  label: t('scheduler.next_run_col') },
  { key: 'ops',      label: t('common.ops'), ops: true },
])

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

interface TargetInfo { text: string; title: string; mapped: boolean; placeholder: boolean }

function targetInfo(row: SchedulerRow): TargetInfo {
  if (row.targetId == null) {
    const text = t('scheduler.target_global')
    return { text, title: text, mapped: false, placeholder: true }
  }
  const id = parseInt(row.targetId)
  const s = channelSessions.value.find(s => s.id === id)
  if (s) {
    const name = s.sessionName || s.sessionId
    const channelName = store.settings.channels?.[s.channelId]?.name || s.channelId
    return { text: `[${channelName}] ${name}`, title: s.sessionId, mapped: true, placeholder: false }
  }
  return { text: `#${row.targetId}`, title: row.targetId, mapped: false, placeholder: false }
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

const rtf = computed(() => new Intl.RelativeTimeFormat(
  locale.value === 'zh' ? 'zh-CN' : 'en',
  { numeric: 'auto' },
))

function formatRelative(ts: number): string {
  const diff = ts - now.value
  const abs = Math.abs(diff)
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR
  if (abs < 30 * SEC) return t('scheduler.just_now')
  if (abs < HOUR)     return rtf.value.format(Math.round(diff / MIN), 'minute')
  if (abs < DAY)      return rtf.value.format(Math.round(diff / HOUR), 'hour')
  return rtf.value.format(Math.round(diff / DAY), 'day')
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(locale.value === 'zh' ? 'zh-CN' : undefined)
}

function isImminent(ts: number | null): boolean {
  if (!ts) return false
  const diff = ts - now.value
  return diff > 0 && diff < 60_000
}

let tickHandle: ReturnType<typeof setInterval> | null = null

async function remove(row: SchedulerRow) {
  if (!await confirm(t('scheduler.confirm_delete', { id: row.id }), { danger: true })) return
  try {
    await apiFetch(`/api/schedulers/${row.id}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(() => {
  load()
  tickHandle = setInterval(() => { now.value = Date.now() }, 30_000)
})

onUnmounted(() => {
  if (tickHandle) clearInterval(tickHandle)
})
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
        <template #id="{ row }"><span class="sched-id">#{{ row.id }}</span></template>

        <template #schedule="{ row }">
          <div class="sched-schedule" :title="row.expr">
            <SBadge :variant="TYPE_VARIANT[detectUIType(row.expr)]" pill>
              {{ t(`scheduler.type_${detectUIType(row.expr)}`) }}
            </SBadge>
            <span class="sched-desc">{{ describeExpr(row.expr) }}</span>
          </div>
        </template>

        <template #message="{ row }">
          <span class="sched-message" :title="row.message">{{ row.message }}</span>
        </template>

        <template #mode="{ row }">
          <SBadge :variant="row.aiProcess ? 'accent' : 'neutral'">
            {{ row.aiProcess ? t('scheduler.mode_ai') : t('scheduler.mode_raw') }}
          </SBadge>
        </template>

        <template #target="{ row }">
          <span
            class="sched-target"
            :class="{
              'sched-target--placeholder': targetInfo(row).placeholder,
              'sched-target--unmapped': !targetInfo(row).mapped && !targetInfo(row).placeholder,
            }"
            :title="targetInfo(row).title"
          >{{ targetInfo(row).text }}</span>
        </template>

        <template #runCount="{ row }">
          <SBadge v-if="row.maxRuns > 0" variant="warning">
            {{ row.runCount }} / {{ row.maxRuns }}
          </SBadge>
          <span v-else class="sched-count">{{ row.runCount }}</span>
        </template>

        <template #lastRun="{ row }">
          <span
            v-if="row.lastRun"
            class="sched-time"
            :title="formatAbsolute(row.lastRun)"
          >{{ formatRelative(row.lastRun) }}</span>
          <span v-else class="sched-time sched-time--muted">{{ t('scheduler.not_run') }}</span>
        </template>

        <template #nextRun="{ row }">
          <span
            v-if="row.nextRun"
            class="sched-time"
            :class="{ 'sched-time--imminent': isImminent(row.nextRun) }"
            :title="formatAbsolute(row.nextRun)"
          >{{ formatRelative(row.nextRun) }}</span>
          <span v-else class="sched-time sched-time--muted">-</span>
        </template>

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
.sched-schedule {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: help;
}
.sched-desc {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
}
.sched-message {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sui-fg-secondary);
  vertical-align: bottom;
}
.sched-target {
  display: inline-block;
  font-size: var(--sui-fs-sm);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--sui-fg-secondary);
}
.sched-target--placeholder {
  color: var(--sui-fg-disabled);
  font-style: italic;
}
.sched-target--unmapped {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
}
.sched-count {
  font-size: var(--sui-fs-sm);
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-secondary);
  white-space: nowrap;
}
.sched-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  white-space: nowrap;
  cursor: help;
}
.sched-time--muted {
  color: var(--sui-fg-disabled);
  cursor: default;
}
.sched-time--imminent {
  color: var(--sui-on-info-soft);
  background: var(--sui-info-soft);
  padding: 1px var(--sui-sp-2);
  border-radius: var(--sui-radius-sm);
  font-weight: 600;
}
</style>
