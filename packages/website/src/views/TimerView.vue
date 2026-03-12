<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

interface SchedulerRow {
  id: number
  name: string
  expr: string
  type: string | null
  message: string
  userId: number | null
  sessionId: string | null
  workPath: string | null
  lastRun: number | null
  nextRun: number | null
  runCount: number
  maxRuns: number
}

interface UserRow {
  id: number
  userid: string
  username: string
}

type UIType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'hourly' | 'custom'
type RoutingType = 'channel' | 'session' | 'directory'

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const users = ref<UserRow[]>([])
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
  userId:       '' as string | number,
  sessionId:    '',
  workPath:     '',
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
  if (uiType === 'interval') return `每 ${p[0].slice(2)} 分钟`
  if (uiType === 'hourly')   return `每小时 :${pad(parseInt(p[0]))}`
  if (uiType === 'daily')    return `每天 ${pad(parseInt(p[1]))}:${pad(parseInt(p[0]))}`
  if (uiType === 'weekly')   return `每${DAY_NAMES[parseInt(p[4])]} ${pad(parseInt(p[1]))}:${pad(parseInt(p[0]))}`
  if (uiType === 'monthly')  return `每月${p[2]}日 ${pad(parseInt(p[1]))}:${pad(parseInt(p[0]))}`
  return expr
}

// ── Routing helpers ───────────────────────────────────────────────────────────

function routingTypeOf(row: SchedulerRow): RoutingType {
  if (row.type === 'channel' || (row.type == null && row.userId != null)) return 'channel'
  if (row.type === 'session' || (row.type == null && row.sessionId != null)) return 'session'
  return 'directory'
}

function routingLabel(row: SchedulerRow): string {
  const rt = routingTypeOf(row)
  if (rt === 'channel') {
    if (row.userId == null) return '-'
    const u = users.value.find(u => u.id === row.userId)
    return u ? (u.username || u.userid) : String(row.userId)
  }
  if (rt === 'session') return row.sessionId ?? '-'
  return row.workPath ? row.workPath.split(/[\\/]/).slice(-2).join('/') : '-'
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
    const [timersRes, usersRes] = await Promise.all([
      apiFetch('/api/timers'),
      apiFetch('/api/users'),
    ])
    timers.value = timersRes.data || []
    users.value = usersRes.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function formatLastRun(ts: number | null): string {
  if (!ts) return '未运行'
  return new Date(ts).toLocaleString('zh-CN')
}

function formatNextRun(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

function userLabel(u: UserRow): string {
  return u.username ? `${u.username} (${u.userid})` : u.userid
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
    userId:      '',
    sessionId:   sessionOptions.value[0] ?? '',
    workPath:    '',
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
    userId:      row.userId ?? '',
    sessionId:   row.sessionId ?? '',
    workPath:    row.workPath ?? '',
    maxRuns:     row.maxRuns ?? 0,
  }
  showModal.value = true
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  if (!form.value.name.trim())    { show('名称不能为空', 'error'); return }
  if (!builtExpr.value.trim())    { show('Cron 表达式不能为空', 'error'); return }
  if (!form.value.message.trim()) { show('消息不能为空', 'error'); return }

  const rt = form.value.routingType
  if (rt === 'channel' && form.value.userId === '') { show('请选择 Lark 用户', 'error'); return }
  if (rt === 'session' && !form.value.sessionId)    { show('请选择会话', 'error'); return }
  if (rt === 'directory' && !form.value.workPath.trim()) { show('请输入工作目录路径', 'error'); return }

  saving.value = true
  try {
    const body: any = {
      name:      form.value.name.trim(),
      expr:      builtExpr.value,
      message:   form.value.message.trim(),
      type:      rt,
      userId:    rt === 'channel' && form.value.userId !== '' ? Number(form.value.userId) : null,
      sessionId: rt === 'session' ? form.value.sessionId : null,
      workPath:  rt === 'directory' ? form.value.workPath.trim() : null,
      maxRuns:   form.value.maxRuns ?? 0,
    }
    if (editingId.value !== null) {
      await apiFetch(`/api/timers/${editingId.value}`, 'PUT', body)
      show('保存成功')
    } else {
      await apiFetch('/api/timers', 'POST', body)
      show('创建成功')
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
  if (!confirm(`确定要删除计时器 "${row.name}" 吗？`)) return
  try {
    await apiFetch(`/api/timers/${row.id}`, 'DELETE')
    show('删除成功')
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
      <span class="page-toolbar-title">计时器管理</span>
      <button class="btn-outline btn-sm" @click="load">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加计时器</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>计划</th>
            <th>消息</th>
            <th>类型</th>
            <th>路由目标</th>
            <th>执行次数</th>
            <th>上次运行</th>
            <th>下次运行</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="10" style="text-align:center;color:#9b9b9b;padding:40px">加载中...</td>
          </tr>
          <tr v-else-if="timers.length === 0">
            <td colspan="10" style="text-align:center;color:#9b9b9b;padding:40px">暂无计时器</td>
          </tr>
          <tr v-for="t in timers" :key="t.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ t.id }}</td>
            <td style="font-weight:500">{{ t.name }}</td>
            <td>
              <div style="font-size:13px">{{ describeExpr(t.expr) }}</div>
              <div style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ t.expr }}</div>
            </td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b6b6b">{{ t.message }}</td>
            <td>
              <span
                style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:monospace"
                :style="{ background: ROUTING_BADGE[routingTypeOf(t)].bg, color: ROUTING_BADGE[routingTypeOf(t)].color }"
              >{{ ROUTING_BADGE[routingTypeOf(t)].label }}</span>
            </td>
            <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ routingLabel(t) }}</td>
            <td style="font-size:12px;font-family:monospace;color:#9b9b9b;white-space:nowrap">{{ t.runCount }}{{ t.maxRuns > 0 ? ` / ${t.maxRuns}` : '' }}</td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatLastRun(t.lastRun) }}</td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatNextRun(t.nextRun) }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(t)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(t)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingId !== null ? '编辑计时器' : '添加计时器' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称</label>
            <input v-model="form.name" placeholder="计时器名称" />
          </div>

          <!-- 触发类型 -->
          <div class="form-group">
            <label>触发频率</label>
            <select v-model="form.uiType">
              <option value="daily">每天定时</option>
              <option value="weekly">每周定时</option>
              <option value="monthly">每月定时</option>
              <option value="interval">按分钟循环 (1–59 分钟)</option>
              <option value="hourly">每小时</option>
              <option value="custom">自定义 Cron</option>
            </select>
          </div>

          <!-- daily / weekly / monthly: 时间 -->
          <div v-if="['daily','weekly','monthly'].includes(form.uiType)" class="inline-form">
            <div class="form-group">
              <label>小时 (0–23)</label>
              <input type="number" v-model.number="form.hour" min="0" max="23" />
            </div>
            <div class="form-group">
              <label>分钟 (0–59)</label>
              <input type="number" v-model.number="form.minute" min="0" max="59" />
            </div>
          </div>

          <!-- weekly: 星期几 -->
          <div v-if="form.uiType === 'weekly'" class="form-group">
            <label>星期几</label>
            <select v-model.number="form.dayOfWeek">
              <option v-for="(d, i) in DAY_NAMES" :key="i" :value="i">{{ d }}</option>
            </select>
          </div>

          <!-- monthly: 几号 -->
          <div v-if="form.uiType === 'monthly'" class="form-group">
            <label>日期 (1–31)</label>
            <input type="number" v-model.number="form.dayOfMonth" min="1" max="31" />
          </div>

          <!-- interval: 间隔分钟 -->
          <div v-if="form.uiType === 'interval'" class="form-group">
            <label>间隔分钟数 (1–59)</label>
            <input type="number" v-model.number="form.minutes" min="1" max="59" />
          </div>

          <!-- hourly: 触发分钟 -->
          <div v-if="form.uiType === 'hourly'" class="form-group">
            <label>触发分钟 (0–59)</label>
            <input type="number" v-model.number="form.minute" min="0" max="59" />
          </div>

          <!-- custom: 直接输入 -->
          <div v-if="form.uiType === 'custom'" class="form-group">
            <label>Cron 表达式</label>
            <input v-model="form.customExpr" placeholder="例: 0 9 * * 1-5" style="font-family:monospace" />
          </div>

          <!-- cron 预览 -->
          <div v-if="form.uiType !== 'custom' && builtExpr" style="margin-bottom:12px;padding:6px 10px;background:#f5f4f2;border-radius:4px;font-family:monospace;font-size:12px;color:#6b6b6b">
            {{ builtExpr }}
          </div>

          <div class="form-group">
            <label>消息内容</label>
            <textarea v-model="form.message" rows="3" placeholder="触发时发送给 Agent 的消息" />
          </div>

          <!-- 路由类型 -->
          <div class="form-group">
            <label>路由类型</label>
            <select v-model="form.routingType">
              <option value="channel">Lark 频道 (channel)</option>
              <option value="session">HTTP 会话 (session)</option>
              <option value="directory">目录模式 (directory)</option>
            </select>
          </div>

          <!-- channel: Lark 用户 -->
          <div v-if="form.routingType === 'channel'" class="form-group">
            <label>Lark 用户</label>
            <select v-model="form.userId">
              <option value="">请选择用户</option>
              <option v-for="u in users" :key="u.id" :value="u.id">{{ userLabel(u) }}</option>
            </select>
          </div>

          <!-- session: 会话 -->
          <div v-if="form.routingType === 'session'" class="form-group">
            <label>会话 ID</label>
            <select v-if="sessionOptions.length" v-model="form.sessionId">
              <option value="">请选择会话</option>
              <option v-for="s in sessionOptions" :key="s" :value="s">{{ s }}</option>
            </select>
            <input v-else v-model="form.sessionId" placeholder="session ID" />
          </div>

          <!-- directory: 工作目录 -->
          <div v-if="form.routingType === 'directory'" class="form-group">
            <label>工作目录</label>
            <select v-if="directoryOptions.length" v-model="form.workPath">
              <option value="">请选择目录</option>
              <option v-for="d in directoryOptions" :key="d" :value="d">{{ d }}</option>
            </select>
            <input v-else v-model="form.workPath" placeholder="/path/to/directory" style="font-family:monospace" />
          </div>

          <!-- 最大执行次数 -->
          <div class="form-group">
            <label>最大执行次数（0 不限制）</label>
            <input type="number" v-model.number="form.maxRuns" min="0" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" :disabled="saving" @click="save">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
