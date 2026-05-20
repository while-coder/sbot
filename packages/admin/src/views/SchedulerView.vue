<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast, SButton, SPageToolbar, SPageContent } from 'sbot-ui'

const { t } = useI18n()
const { isMobile } = useResponsive()

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

function targetLabel(row: SchedulerRow): string {
  if (row.targetId == null) return '-'
  const id = parseInt(row.targetId)
  const s = channelSessions.value.find(s => s.id === id)
  return s ? s.sessionId : row.targetId
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
    <SPageToolbar :title="t('scheduler.title')">
      <template #actions>
        <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      </template>
    </SPageToolbar>
    <SPageContent>
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th>{{ t('common.id') }}</th>
            <th>{{ t('scheduler.schedule_col') }}</th>
            <th>{{ t('scheduler.message_col') }}</th>
            <th>{{ t('scheduler.target_col') }}</th>
            <th>{{ t('scheduler.run_count_col') }}</th>
            <th>{{ t('scheduler.last_run_col') }}</th>
            <th>{{ t('scheduler.next_run_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="sched-empty">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="timers.length === 0">
            <td colspan="8" class="sched-empty">{{ t('scheduler.empty') }}</td>
          </tr>
          <tr v-for="t_ in timers" :key="t_.id">
            <td class="sched-id">{{ t_.id }}</td>
            <td>
              <div class="sched-desc">{{ describeExpr(t_.expr) }}</div>
              <div class="sched-expr">{{ t_.expr }}</div>
            </td>
            <td class="sched-message">{{ t_.message }}</td>
            <td class="sched-target">{{ targetLabel(t_) }}</td>
            <td class="sched-count">{{ t_.runCount }}{{ t_.maxRuns > 0 ? ` / ${t_.maxRuns}` : '' }}</td>
            <td class="sched-time">{{ formatLastRun(t_.lastRun) }}</td>
            <td class="sched-time">{{ formatNextRun(t_.nextRun) }}</td>
            <td>
              <div class="ops-cell">
                <SButton type="danger" size="sm" @click="remove(t_)">{{ t('common.delete') }}</SButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-if="loading" class="mobile-card-empty">{{ t('common.loading') }}</div>
        <div v-else-if="timers.length === 0" class="mobile-card-empty">{{ t('scheduler.empty') }}</div>
        <div v-for="t_ in timers" :key="t_.id" class="mobile-card">
          <div class="mobile-card-header">
            <span class="sched-desc">{{ describeExpr(t_.expr) }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.id') }}</span>
            <span class="mobile-card-value sched-id">{{ t_.id }}</span>
            <span class="mobile-card-label">{{ t('scheduler.schedule_col') }}</span>
            <span class="mobile-card-value sched-expr">{{ t_.expr }}</span>
            <span class="mobile-card-label">{{ t('scheduler.message_col') }}</span>
            <span class="mobile-card-value sched-message">{{ t_.message }}</span>
            <span class="mobile-card-label">{{ t('scheduler.target_col') }}</span>
            <span class="mobile-card-value sched-target">{{ targetLabel(t_) }}</span>
            <span class="mobile-card-label">{{ t('scheduler.run_count_col') }}</span>
            <span class="mobile-card-value sched-count">{{ t_.runCount }}{{ t_.maxRuns > 0 ? ` / ${t_.maxRuns}` : '' }}</span>
            <span class="mobile-card-label">{{ t('scheduler.last_run_col') }}</span>
            <span class="mobile-card-value sched-time">{{ formatLastRun(t_.lastRun) }}</span>
            <span class="mobile-card-label">{{ t('scheduler.next_run_col') }}</span>
            <span class="mobile-card-value sched-time">{{ formatNextRun(t_.nextRun) }}</span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="danger" size="sm" @click="remove(t_)">{{ t('common.delete') }}</SButton>
          </div>
        </div>
      </div>
    </SPageContent>

  </div>
</template>

<style scoped>
.sched-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
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
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sui-fg-muted);
}
.sched-target {
  font-size: var(--sui-fs-sm);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
