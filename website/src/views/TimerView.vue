<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

interface SchedulerRow {
  id: number
  name: string
  expr: string
  message: string
  agentName: string
  userId: number | null
  enabled: boolean
  lastRun: number | null
}

interface UserRow {
  id: number
  userid: string
  username: string
}

type UIType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'hourly' | 'custom'

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const users = ref<UserRow[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const agentOptions = computed(() =>
  Object.entries(store.settings.agents ?? {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)

const form = ref({
  name:       '',
  uiType:     'daily' as UIType,
  hour:       9,
  minute:     0,
  dayOfWeek:  1,
  dayOfMonth: 1,
  minutes:    30,
  customExpr: '',
  message:    '',
  agentName:  '',
  userId:     '' as string | number,
  enabled:    true,
})

// 从 form 中生成 cron 表达式
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

// 从 cron 表达式反推 UIType
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

// 解析 cron 表达式填入 form 的各字段
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

// 人性化描述（列表展示用）
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

function userLabel(u: UserRow): string {
  return u.username ? `${u.username} (${u.userid})` : u.userid
}

function openAdd() {
  editingId.value = null
  const parsed = parseExpr('9 0 * * *')
  form.value = {
    ...parsed,
    name:      '',
    message:   '',
    agentName: agentOptions.value[0]?.id ?? '',
    userId:    '',
    enabled:   true,
  }
  showModal.value = true
}

function openEdit(row: SchedulerRow) {
  editingId.value = row.id
  const parsed = parseExpr(row.expr)
  form.value = {
    ...parsed,
    name:      row.name,
    message:   row.message,
    agentName: row.agentName || agentOptions.value[0]?.id || '',
    userId:    row.userId ?? '',
    enabled:   row.enabled,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim())    { show('名称不能为空', 'error'); return }
  if (!builtExpr.value.trim())    { show('Cron 表达式不能为空', 'error'); return }
  if (!form.value.message.trim()) { show('消息不能为空', 'error'); return }
  if (!form.value.agentName)      { show('请选择 Agent', 'error'); return }
  saving.value = true
  try {
    const body: any = {
      name:      form.value.name.trim(),
      expr:      builtExpr.value,
      message:   form.value.message.trim(),
      agentName: form.value.agentName,
      userId:    form.value.userId !== '' ? Number(form.value.userId) : null,
      enabled:   form.value.enabled,
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

async function toggleEnabled(row: SchedulerRow) {
  try {
    await apiFetch(`/api/timers/${row.id}`, 'PUT', { enabled: !row.enabled })
    row.enabled = !row.enabled
  } catch (e: any) {
    show(e.message, 'error')
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
            <th>Agent</th>
            <th>用户</th>
            <th>上次运行</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="9" style="text-align:center;color:#9b9b9b;padding:40px">加载中...</td>
          </tr>
          <tr v-else-if="timers.length === 0">
            <td colspan="9" style="text-align:center;color:#9b9b9b;padding:40px">暂无计时器</td>
          </tr>
          <tr v-for="t in timers" :key="t.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ t.id }}</td>
            <td style="font-weight:500">{{ t.name }}</td>
            <td>
              <div style="font-size:13px">{{ describeExpr(t.expr) }}</div>
              <div style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ t.expr }}</div>
            </td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b6b6b">{{ t.message }}</td>
            <td style="font-family:monospace;font-size:12px">{{ t.agentName || '-' }}</td>
            <td style="font-size:12px">
              {{ t.userId != null ? (users.find(u => u.id === t.userId)?.username || users.find(u => u.id === t.userId)?.userid || t.userId) : '-' }}
            </td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatLastRun(t.lastRun) }}</td>
            <td>
              <span
                style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer"
                :style="t.enabled ? 'background:#dcfce7;color:#16a34a' : 'background:#f5f4f2;color:#9b9b9b'"
                @click="toggleEnabled(t)"
              >{{ t.enabled ? '启用' : '停用' }}</span>
            </td>
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

          <!-- 类型选择 -->
          <div class="form-group">
            <label>类型</label>
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
          <div class="form-group">
            <label>Agent</label>
            <select v-model="form.agentName">
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>用户（可选）</label>
            <select v-model="form.userId">
              <option value="">不关联用户</option>
              <option v-for="u in users" :key="u.id" :value="u.id">{{ userLabel(u) }}</option>
            </select>
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
