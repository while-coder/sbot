<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

type TimerType = 'daily' | 'weekly' | 'monthly' | 'interval'

interface TimerRow {
  id: number
  name: string
  type: TimerType
  config: string
  message: string
  agentName: string | null
  userId: number | null
  enabled: boolean
  lastRun: number | null
}

interface TimerConfig {
  hour?: number
  minute?: number
  dayOfWeek?: number
  dayOfMonth?: number
  minutes?: number
}

const { show } = useToast()
const timers = ref<TimerRow[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const form = ref({
  name: '',
  type: 'daily' as TimerType,
  message: '',
  agentName: '',
  userId: '' as string | number,
  enabled: true,
  // config fields
  hour: 8,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
  minutes: 30,
})

const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/timers')
    timers.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function parseConfig(row: TimerRow): TimerConfig {
  try { return JSON.parse(row.config) } catch { return {} }
}

function formatSchedule(row: TimerRow): string {
  const cfg = parseConfig(row)
  const pad = (n: number) => String(n).padStart(2, '0')
  const t = `${pad(cfg.hour ?? 0)}:${pad(cfg.minute ?? 0)}`
  if (row.type === 'daily') return `每天 ${t}`
  if (row.type === 'weekly') return `每周${dayNames[cfg.dayOfWeek ?? 1]} ${t}`
  if (row.type === 'monthly') return `每月${cfg.dayOfMonth ?? 1}日 ${t}`
  if (row.type === 'interval') return `每 ${cfg.minutes ?? 30} 分钟`
  return '-'
}

function formatLastRun(ts: number | null): string {
  if (!ts) return '未运行'
  return new Date(ts).toLocaleString('zh-CN')
}

function openAdd() {
  editingId.value = null
  form.value = {
    name: '',
    type: 'daily',
    message: '',
    agentName: '',
    userId: '',
    enabled: true,
    hour: 8,
    minute: 0,
    dayOfWeek: 1,
    dayOfMonth: 1,
    minutes: 30,
  }
  showModal.value = true
}

function openEdit(row: TimerRow) {
  editingId.value = row.id
  const cfg = parseConfig(row)
  form.value = {
    name: row.name,
    type: row.type,
    message: row.message,
    agentName: row.agentName ?? '',
    userId: row.userId ?? '',
    enabled: row.enabled,
    hour: cfg.hour ?? 8,
    minute: cfg.minute ?? 0,
    dayOfWeek: cfg.dayOfWeek ?? 1,
    dayOfMonth: cfg.dayOfMonth ?? 1,
    minutes: cfg.minutes ?? 30,
  }
  showModal.value = true
}

function buildConfig(): TimerConfig {
  const { type, hour, minute, dayOfWeek, dayOfMonth, minutes } = form.value
  if (type === 'daily') return { hour, minute }
  if (type === 'weekly') return { hour, minute, dayOfWeek }
  if (type === 'monthly') return { hour, minute, dayOfMonth }
  return { minutes }
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  if (!form.value.message.trim()) { show('消息不能为空', 'error'); return }
  saving.value = true
  try {
    const body: any = {
      name: form.value.name.trim(),
      type: form.value.type,
      config: JSON.stringify(buildConfig()),
      message: form.value.message.trim(),
      agentName: form.value.agentName.trim() || null,
      userId: form.value.userId !== '' ? Number(form.value.userId) : null,
      enabled: form.value.enabled,
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

async function toggleEnabled(row: TimerRow) {
  try {
    await apiFetch(`/api/timers/${row.id}`, 'PUT', { enabled: !row.enabled })
    row.enabled = !row.enabled
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(row: TimerRow) {
  if (!confirm(`确定要删除计时器 "${row.name}" 吗？`)) return
  try {
    await apiFetch(`/api/timers/${row.id}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const typeLabel: Record<TimerType, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  interval: '循环',
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
            <th>类型</th>
            <th>计划</th>
            <th>消息</th>
            <th>Agent</th>
            <th>用户ID</th>
            <th>上次运行</th>
            <th>状态</th>
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
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#f5f4f2;color:#6b6b6b">
                {{ typeLabel[t.type] }}
              </span>
            </td>
            <td style="white-space:nowrap">{{ formatSchedule(t) }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b6b6b">{{ t.message }}</td>
            <td style="font-family:monospace;font-size:12px">{{ t.agentName || '-' }}</td>
            <td style="font-family:monospace">{{ t.userId ?? '-' }}</td>
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
          <div class="form-group">
            <label>类型</label>
            <select v-model="form.type">
              <option value="daily">每天定时</option>
              <option value="weekly">每周定时</option>
              <option value="monthly">每月定时</option>
              <option value="interval">按分钟循环</option>
            </select>
          </div>

          <!-- daily / weekly / monthly: hour + minute -->
          <template v-if="form.type !== 'interval'">
            <div class="inline-form">
              <div class="form-group">
                <label>小时 (0–23)</label>
                <input type="number" v-model.number="form.hour" min="0" max="23" />
              </div>
              <div class="form-group">
                <label>分钟 (0–59)</label>
                <input type="number" v-model.number="form.minute" min="0" max="59" />
              </div>
            </div>
          </template>

          <!-- weekly: day of week -->
          <div v-if="form.type === 'weekly'" class="form-group">
            <label>星期几</label>
            <select v-model.number="form.dayOfWeek">
              <option v-for="(d, i) in dayNames" :key="i" :value="i">{{ d }}</option>
            </select>
          </div>

          <!-- monthly: day of month -->
          <div v-if="form.type === 'monthly'" class="form-group">
            <label>日期 (1–31)</label>
            <input type="number" v-model.number="form.dayOfMonth" min="1" max="31" />
          </div>

          <!-- interval: minutes -->
          <div v-if="form.type === 'interval'" class="form-group">
            <label>间隔分钟数</label>
            <input type="number" v-model.number="form.minutes" min="1" max="1440" />
          </div>

          <div class="form-group">
            <label>消息内容</label>
            <textarea v-model="form.message" rows="3" placeholder="触发时发送给 Agent 的消息" />
          </div>
          <div class="form-group">
            <label>Agent 名称（可选）</label>
            <input v-model="form.agentName" placeholder="留空使用默认 Agent" />
          </div>
          <div class="form-group">
            <label>用户 ID（可选，user 表 id 字段）</label>
            <input type="number" v-model="form.userId" placeholder="留空则不关联用户" />
          </div>
          <div class="form-group" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" id="timer-enabled" v-model="form.enabled" style="width:auto" />
            <label for="timer-enabled" style="cursor:pointer">启用</label>
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
