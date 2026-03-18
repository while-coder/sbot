<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()

interface SchedulerRow {
  id: number
  name: string
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
  channel: string
  sessionId: string
}

type UIType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'hourly' | 'custom'
type RoutingType = 'channel' | 'session' | 'directory'

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const channelSessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const sessionOptions = computed(() =>
  Object.keys(store.settings.sessions ?? {})
)

const directoryOptions = computed(() =>
  Object.keys(store.settings.directories ?? {})
)

const form = ref({
  name:         '',
  uiType:       'daily' as UIType,
  hour:         9,
  minute:       0,
  dayOfWeek:    1,
  dayOfMonth:   1,
  minutes:      30,
  customExpr:   '',
  message:      '',
  routingType:  'channel' as RoutingType,
  targetId:     '',
  maxRuns:      0,
})

// ── Cron helpers ─────────────────────────────────────────────────────────────

const builtExpr = computed((): string => {
  const { uiType, hour, minute, dayOfWeek, dayOfMonth, minutes, customExpr } = form.value
  const h = hour, m = minute
  if (uiType === 'daily')    return `${m} ${h} * * *`
  if (uiType === 'weekly')   return `${m} ${h} * * ${dayOfWeek}`
  if (uiType === 'monthly')  return `${m} ${h} ${dayOfMonth} * *`
  if (uiType === 'interval') return `*/${minutes} * * * *`
  if (uiType === 'hourly')   return `${minute} * * * *`
  return customExpr.trim()
})

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

function parseExpr(expr: string) {
  const uiType = detectUIType(expr)
  const p = expr.trim().split(/\s+/)
  const base = { uiType, hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1, minutes: 30, customExpr: expr }
  if (uiType === 'custom')   return base
  if (uiType === 'interval') return { ...base, minutes: parseInt(p[0].slice(2)) }
  if (uiType === 'hourly')   return { ...base, minute: parseInt(p[0]) }
  if (uiType === 'daily')    return { ...base, hour: parseInt(p[1]), minute: parseInt(p[0]) }
  if (uiType === 'weekly')   return { ...base, hour: parseInt(p[1]), minute: parseInt(p[0]), dayOfWeek: parseInt(p[4]) }
  if (uiType === 'monthly')  return { ...base, hour: parseInt(p[1]), minute: parseInt(p[0]), dayOfMonth: parseInt(p[2]) }
  return base
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
  if (row.type === 'session') return 'session'
  return 'directory'
}

function routingLabel(row: SchedulerRow): string {
  const rt = routingTypeOf(row)
  if (rt === 'channel') {
    if (row.targetId == null) return '-'
    const id = parseInt(row.targetId)
    const s = channelSessions.value.find(s => s.id === id)
    return s ? s.sessionId : row.targetId
  }
  if (rt === 'session') return row.targetId ?? '-'
  return row.targetId ? row.targetId.split(/[\\/]/).slice(-2).join('/') : '-'
}

const ROUTING_BADGE: Record<RoutingType, { bg: string; color: string; label: string }> = {
  channel:   { bg: '#dbeafe', color: '#1d4ed8', label: 'channel' },
  session:   { bg: '#fef9c3', color: '#854d0e', label: 'session' },
  directory: { bg: '#dcfce7', color: '#15803d', label: 'directory' },
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

function sessionLabel(s: ChannelSessionRow): string {
  return s.sessionId ? `${s.sessionId} (${s.channel})` : String(s.id)
}

// ── Modal open/close ──────────────────────────────────────────────────────────

function openAdd() {
  editingId.value = null
  const parsed = parseExpr('0 9 * * *')
  form.value = {
    ...parsed,
    name:        '',
    message:     '',
    routingType: 'channel',
    targetId:    '',
    maxRuns:     0,
  }
  showModal.value = true
}

function openEdit(row: SchedulerRow) {
  editingId.value = row.id
  const parsed = parseExpr(row.expr)
  const rt = routingTypeOf(row)
  form.value = {
    ...parsed,
    name:        row.name,
    message:     row.message,
    routingType: rt,
    targetId:    row.targetId ?? '',
    maxRuns:     row.maxRuns ?? 0,
  }
  showModal.value = true
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  if (!form.value.name.trim())    { show(t('common.name_required'), 'error'); return }
  if (!builtExpr.value.trim())    { show(t('scheduler.error_cron'), 'error'); return }
  if (!form.value.message.trim()) { show(t('scheduler.message_label') + ' ' + t('common.name_required'), 'error'); return }

  const rt = form.value.routingType
  if (rt === 'channel' && !form.value.targetId)          { show(t('scheduler.error_session'), 'error'); return }
  if (rt === 'session' && !form.value.targetId)          { show(t('scheduler.error_session_id'), 'error'); return }
  if (rt === 'directory' && !form.value.targetId.trim()) { show(t('scheduler.error_work_dir'), 'error'); return }

  saving.value = true
  try {
    const body: any = {
      name:     form.value.name.trim(),
      expr:     builtExpr.value,
      message:  form.value.message.trim(),
      type:     rt,
      targetId: form.value.targetId || null,
      maxRuns:  form.value.maxRuns ?? 0,
    }
    if (editingId.value !== null) {
      await apiFetch(`/api/schedulers/${editingId.value}`, 'PUT', body)
      show(t('common.saved'))
    } else {
      await apiFetch('/api/schedulers', 'POST', body)
      show(t('common.created'))
    }
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function remove(row: SchedulerRow) {
  if (!confirm(t('scheduler.confirm_delete', { name: row.name }))) return
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
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('scheduler.add') }}</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th>{{ t('common.id') }}</th>
            <th>{{ t('scheduler.name_col') }}</th>
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
            <td colspan="10" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="timers.length === 0">
            <td colspan="10" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('scheduler.empty') }}</td>
          </tr>
          <tr v-for="t_ in timers" :key="t_.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ t_.id }}</td>
            <td style="font-weight:500">{{ t_.name }}</td>
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
                <button class="btn-outline btn-sm" @click="openEdit(t_)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(t_)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingId !== null ? t('scheduler.edit_title') : t('scheduler.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('scheduler.name_label') }}</label>
            <input v-model="form.name" :placeholder="t('scheduler.name_placeholder')" />
          </div>

          <!-- 触发类型 -->
          <div class="form-group">
            <label>{{ t('scheduler.frequency') }}</label>
            <select v-model="form.uiType">
              <option value="daily">{{ t('scheduler.freq_daily') }}</option>
              <option value="weekly">{{ t('scheduler.freq_weekly') }}</option>
              <option value="monthly">{{ t('scheduler.freq_monthly') }}</option>
              <option value="interval">{{ t('scheduler.freq_interval') }}</option>
              <option value="hourly">{{ t('scheduler.freq_hourly') }}</option>
              <option value="custom">{{ t('scheduler.freq_custom') }}</option>
            </select>
          </div>

          <!-- daily / weekly / monthly: 时间 -->
          <div v-if="['daily','weekly','monthly'].includes(form.uiType)" class="inline-form">
            <div class="form-group">
              <label>{{ t('scheduler.hour_label') }}</label>
              <input type="number" v-model.number="form.hour" min="0" max="23" />
            </div>
            <div class="form-group">
              <label>{{ t('scheduler.minute_label') }}</label>
              <input type="number" v-model.number="form.minute" min="0" max="59" />
            </div>
          </div>

          <!-- weekly: 星期几 -->
          <div v-if="form.uiType === 'weekly'" class="form-group">
            <label>{{ t('scheduler.weekday_label') }}</label>
            <select v-model.number="form.dayOfWeek">
              <option v-for="i in 7" :key="i - 1" :value="i - 1">{{ t(`scheduler.weekday_${i - 1}`) }}</option>
            </select>
          </div>

          <!-- monthly: 几号 -->
          <div v-if="form.uiType === 'monthly'" class="form-group">
            <label>{{ t('scheduler.day_label') }}</label>
            <input type="number" v-model.number="form.dayOfMonth" min="1" max="31" />
          </div>

          <!-- interval: 间隔分钟 -->
          <div v-if="form.uiType === 'interval'" class="form-group">
            <label>{{ t('scheduler.interval_label') }}</label>
            <input type="number" v-model.number="form.minutes" min="1" max="59" />
          </div>

          <!-- hourly: 触发分钟 -->
          <div v-if="form.uiType === 'hourly'" class="form-group">
            <label>{{ t('scheduler.trigger_minute_label') }}</label>
            <input type="number" v-model.number="form.minute" min="0" max="59" />
          </div>

          <!-- custom: 直接输入 -->
          <div v-if="form.uiType === 'custom'" class="form-group">
            <label>{{ t('scheduler.cron_label') }}</label>
            <input v-model="form.customExpr" :placeholder="t('scheduler.cron_placeholder')" style="font-family:monospace" />
          </div>

          <!-- cron 预览 -->
          <div v-if="form.uiType !== 'custom' && builtExpr" style="margin-bottom:12px;padding:6px 10px;background:#f5f4f2;border-radius:4px;font-family:monospace;font-size:12px;color:#6b6b6b">
            {{ builtExpr }}
          </div>

          <div class="form-group">
            <label>{{ t('scheduler.message_label') }}</label>
            <textarea v-model="form.message" rows="3" :placeholder="t('scheduler.message_placeholder')" />
          </div>

          <!-- 路由类型 -->
          <div class="form-group">
            <label>{{ t('scheduler.route_type') }}</label>
            <select v-model="form.routingType">
              <option value="channel">{{ t('scheduler.route_channel') }}</option>
              <option value="session">{{ t('scheduler.route_session') }}</option>
              <option value="directory">{{ t('scheduler.route_directory') }}</option>
            </select>
          </div>

          <!-- channel: 频道会话 -->
          <div v-if="form.routingType === 'channel'" class="form-group">
            <label>{{ t('scheduler.channel_session') }}</label>
            <select v-model="form.targetId">
              <option value="">{{ t('scheduler.select_session') }}</option>
              <option v-for="s in channelSessions" :key="s.id" :value="String(s.id)">{{ sessionLabel(s) }}</option>
            </select>
          </div>

          <!-- session: 会话 -->
          <div v-if="form.routingType === 'session'" class="form-group">
            <label>{{ t('scheduler.session_id') }}</label>
            <select v-if="sessionOptions.length" v-model="form.targetId">
              <option value="">{{ t('scheduler.select_session') }}</option>
              <option v-for="s in sessionOptions" :key="s" :value="s">{{ s }}</option>
            </select>
            <input v-else v-model="form.targetId" placeholder="session ID" />
          </div>

          <!-- directory: 工作目录 -->
          <div v-if="form.routingType === 'directory'" class="form-group">
            <label>{{ t('scheduler.work_dir') }}</label>
            <select v-if="directoryOptions.length" v-model="form.targetId">
              <option value="">{{ t('common.select_placeholder') }}</option>
              <option v-for="d in directoryOptions" :key="d" :value="d">{{ d }}</option>
            </select>
            <input v-else v-model="form.targetId" :placeholder="t('scheduler.work_dir_placeholder')" style="font-family:monospace" />
          </div>

          <!-- 最大执行次数 -->
          <div class="form-group">
            <label>{{ t('scheduler.max_runs') }}</label>
            <input type="number" v-model.number="form.maxRuns" min="0" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="saving" @click="save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
