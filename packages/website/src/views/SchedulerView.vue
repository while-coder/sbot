<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()

interface SchedulerRow {
  id: number
  expr: string
  type: string | null
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
type RoutingType = 'channel' | 'session'

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const channelSessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)

// ── Cron helpers ─────────────────────────────────────────────────────────────

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

// ── Routing helpers ───────────────────────────────────────────────────────────

function routingTypeOf(row: SchedulerRow): RoutingType {
  if (row.type === 'channel') return 'channel'
  return 'session'
}

function routingLabel(row: SchedulerRow): string {
  const rt = routingTypeOf(row)
  if (rt === 'channel') {
    if (row.targetId == null) return '-'
    const id = parseInt(row.targetId)
    const s = channelSessions.value.find(s => s.id === id)
    return s ? s.sessionId : row.targetId
  }
  return row.targetId ?? '-'
}

const ROUTING_BADGE: Record<RoutingType, { bg: string; color: string; label: string }> = {
  channel:   { bg: '#dbeafe', color: '#1d4ed8', label: 'channel' },
  session:   { bg: '#fef9c3', color: '#854d0e', label: 'session' },
}

// ── Data loading ──────────────────────────────────────────────────────────────

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
    <div class="page-toolbar">
      <span class="page-toolbar-title">{{ t('scheduler.title') }}</span>
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th>{{ t('common.id') }}</th>
            <th>{{ t('scheduler.schedule_col') }}</th>
            <th>{{ t('scheduler.message_col') }}</th>
            <th>{{ t('scheduler.type_col') }}</th>
            <th>{{ t('scheduler.target_col') }}</th>
            <th>{{ t('scheduler.run_count_col') }}</th>
            <th>{{ t('scheduler.last_run_col') }}</th>
            <th>{{ t('scheduler.next_run_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="9" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="timers.length === 0">
            <td colspan="9" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('scheduler.empty') }}</td>
          </tr>
          <tr v-for="t_ in timers" :key="t_.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ t_.id }}</td>
            <td>
              <div style="font-size:13px">{{ describeExpr(t_.expr) }}</div>
              <div style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ t_.expr }}</div>
            </td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b6b6b">{{ t_.message }}</td>
            <td>
              <span
                style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:monospace"
                :style="{ background: ROUTING_BADGE[routingTypeOf(t_)].bg, color: ROUTING_BADGE[routingTypeOf(t_)].color }"
              >{{ ROUTING_BADGE[routingTypeOf(t_)].label }}</span>
            </td>
            <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ routingLabel(t_) }}</td>
            <td style="font-size:12px;font-family:monospace;color:#9b9b9b;white-space:nowrap">{{ t_.runCount }}{{ t_.maxRuns > 0 ? ` / ${t_.maxRuns}` : '' }}</td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatLastRun(t_.lastRun) }}</td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatNextRun(t_.nextRun) }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-danger btn-sm" @click="remove(t_)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</template>
