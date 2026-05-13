<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

interface HeartbeatItem {
  id: number
  name: string
  intervalMinutes: number
  promptFile: string
  target: number
  enabled: boolean
  activeHoursStart: number | null
  activeHoursEnd: number | null
  activeHoursTimezone: string | null
  lastRun: string | null
  nextRun: string | null
  running: boolean
  createdAt: number
}

interface ChannelSessionOption {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
}

const INTERVAL_OPTIONS = [
  { value: 30, label: '30' },
  { value: 60, label: '1' },
  { value: 120, label: '2' },
  { value: 240, label: '4' },
  { value: 360, label: '6' },
  { value: 720, label: '12' },
  { value: 1440, label: '24' },
]

function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}${t('heartbeats.minutes')}`
  const h = minutes / 60
  if (Number.isInteger(h)) return `${h}${t('heartbeats.hours')}`
  return `${minutes}${t('heartbeats.minutes')}`
}

const heartbeats = ref<HeartbeatItem[]>([])
const channelSessions = ref<ChannelSessionOption[]>([])

const showModal = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
  name: '',
  intervalMinutes: 30,
  promptFile: 'heartbeat/default.md',
  target: null as number | null,
  enabled: true,
  activeHoursEnabled: false,
  activeHoursStart: 9,
  activeHoursEnd: 22,
  activeHoursTimezone: '',
})

function sessionLabel(id: number): string {
  const s = channelSessions.value.find(s => s.id === id)
  if (!s) return `#${id}`
  return s.sessionName || `${s.channelId} / ${s.sessionId}`
}

function openAdd() {
  editingId.value = null
  form.value = {
    name: '',
    intervalMinutes: 30,
    promptFile: 'heartbeat/default.md',
    target: null,
    enabled: true,
    activeHoursEnabled: false,
    activeHoursStart: 9,
    activeHoursEnd: 22,
    activeHoursTimezone: '',
  }
  showModal.value = true
}

function openEdit(hb: HeartbeatItem) {
  editingId.value = hb.id
  form.value = {
    name: hb.name || '',
    intervalMinutes: hb.intervalMinutes || 30,
    promptFile: hb.promptFile || 'heartbeat/default.md',
    target: hb.target ?? null,
    enabled: hb.enabled !== false,
    activeHoursEnabled: hb.activeHoursStart != null && hb.activeHoursEnd != null,
    activeHoursStart: hb.activeHoursStart ?? 9,
    activeHoursEnd: hb.activeHoursEnd ?? 22,
    activeHoursTimezone: hb.activeHoursTimezone ?? '',
  }
  showModal.value = true
}

function buildBody() {
  const body: any = {
    name: form.value.name,
    intervalMinutes: form.value.intervalMinutes,
    promptFile: form.value.promptFile,
    target: form.value.target,
    enabled: form.value.enabled,
  }
  if (form.value.activeHoursEnabled) {
    body.activeHoursStart = form.value.activeHoursStart
    body.activeHoursEnd = form.value.activeHoursEnd
    body.activeHoursTimezone = form.value.activeHoursTimezone || null
  } else {
    body.activeHoursStart = null
    body.activeHoursEnd = null
    body.activeHoursTimezone = null
  }
  return body
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (form.value.target == null) { show(t('heartbeats.target') + ' required', 'error'); return }
  try {
    const body = buildBody()
    const id = editingId.value
    if (id != null) {
      await apiFetch(`/api/heartbeats/${id}`, 'PUT', body)
    } else {
      await apiFetch('/api/heartbeats', 'POST', body)
    }
    show(t('common.saved'))
    showModal.value = false
    await loadHeartbeats()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(hb: HeartbeatItem) {
  if (!window.confirm(t('heartbeats.confirm_delete', { name: hb.name || hb.id }))) return
  try {
    await apiFetch(`/api/heartbeats/${hb.id}`, 'DELETE')
    show(t('common.deleted'))
    await loadHeartbeats()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function trigger(hb: HeartbeatItem) {
  try {
    await apiFetch(`/api/heartbeats/${hb.id}/trigger`, 'POST')
    show(t('heartbeats.triggered'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadHeartbeats() {
  try {
    const res = await apiFetch('/api/heartbeats')
    heartbeats.value = res.data || []
  } catch {}
}

async function loadSessions() {
  try {
    const res = await apiFetch('/api/channel-sessions')
    channelSessions.value = res.data || []
  } catch {}
}

const heartbeatPrompts = ref<{ path: string; isUserOnly?: boolean }[]>([])

async function loadHeartbeatPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=heartbeat')
    heartbeatPrompts.value = res.data || []
  } catch {}
}

const showCreatePrompt = ref(false)
const newPromptName = ref('')
const newPromptContent = ref('')

function openCreatePrompt() {
  newPromptName.value = ''
  newPromptContent.value = ''
  showCreatePrompt.value = true
}

async function createPrompt() {
  const name = newPromptName.value.trim()
  if (!name) { show(t('common.name_required'), 'error'); return }
  const filePath = `heartbeat/${name}${name.endsWith('.md') ? '' : '.md'}`
  try {
    await apiFetch('/api/prompts/content', 'PUT', { path: filePath, content: newPromptContent.value })
    show(t('common.created'))
    showCreatePrompt.value = false
    await loadHeartbeatPrompts()
    form.value.promptFile = filePath
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  await loadHeartbeats()
}

onMounted(async () => {
  await Promise.all([loadHeartbeats(), loadSessions(), loadHeartbeatPrompts()])
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('heartbeats.add') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th>{{ t('heartbeats.name') }}</th>
            <th>{{ t('heartbeats.interval') }}</th>
            <th>{{ t('heartbeats.target') }}</th>
            <th>{{ t('heartbeats.status') }}</th>
            <th>{{ t('heartbeats.last_run') }}</th>
            <th>{{ t('heartbeats.next_run') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="heartbeats.length === 0">
            <td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">{{ t('heartbeats.empty') }}</td>
          </tr>
          <tr v-for="hb in heartbeats" :key="hb.id">
            <td>{{ hb.name || hb.id }}</td>
            <td style="font-size:12px">{{ intervalLabel(hb.intervalMinutes) }}</td>
            <td style="font-size:12px">{{ sessionLabel(hb.target) }}</td>
            <td>
              <span v-if="!hb.enabled" style="color:#9b9b9b">{{ t('heartbeats.disabled') }}</span>
              <span v-else-if="hb.running" style="color:#f59e0b;font-weight:600">{{ t('heartbeats.running') }}</span>
              <span v-else style="color:#16a34a">{{ t('heartbeats.waiting') }}</span>
            </td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">
              {{ hb.lastRun ? new Date(hb.lastRun).toLocaleString('zh-CN') : '-' }}
            </td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">
              {{ hb.nextRun ? new Date(hb.nextRun).toLocaleString('zh-CN') : '-' }}
            </td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="trigger(hb)">{{ t('heartbeats.trigger') }}</button>
                <button class="btn-outline btn-sm" @click="openEdit(hb)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(hb)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-if="heartbeats.length === 0" class="mobile-card-empty">{{ t('heartbeats.empty') }}</div>
        <div v-for="hb in heartbeats" :key="hb.id" class="mobile-card">
          <div class="mobile-card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span>{{ hb.name || hb.id }}</span>
            <span v-if="!hb.enabled" style="color:#9b9b9b;font-size:12px;font-weight:600">{{ t('heartbeats.disabled') }}</span>
            <span v-else-if="hb.running" style="color:#f59e0b;font-size:12px;font-weight:600">{{ t('heartbeats.running') }}</span>
            <span v-else style="color:#16a34a;font-size:12px;font-weight:600">{{ t('heartbeats.waiting') }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('heartbeats.interval') }}</span>
            <span class="mobile-card-value" style="font-size:12px">{{ intervalLabel(hb.intervalMinutes) }}</span>
            <span class="mobile-card-label">{{ t('heartbeats.target') }}</span>
            <span class="mobile-card-value" style="font-size:12px">{{ sessionLabel(hb.target) }}</span>
            <span class="mobile-card-label">{{ t('heartbeats.last_run') }}</span>
            <span class="mobile-card-value" style="font-size:12px;color:#9b9b9b">
              {{ hb.lastRun ? new Date(hb.lastRun).toLocaleString('zh-CN') : '-' }}
            </span>
            <span class="mobile-card-label">{{ t('heartbeats.next_run') }}</span>
            <span class="mobile-card-value" style="font-size:12px;color:#9b9b9b">
              {{ hb.nextRun ? new Date(hb.nextRun).toLocaleString('zh-CN') : '-' }}
            </span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="trigger(hb)">{{ t('heartbeats.trigger') }}</button>
            <button class="btn-outline btn-sm" @click="openEdit(hb)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(hb)">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit/Add modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box" style="width:520px;max-height:85vh;overflow-y:auto">
        <div class="modal-header">
          <h3>{{ editingId !== null ? t('heartbeats.edit_title') : t('heartbeats.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('heartbeats.name') }} *</label>
            <input v-model="form.name" />
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.interval') }} *</label>
            <select v-model.number="form.intervalMinutes">
              <option v-for="opt in INTERVAL_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.value < 60 ? opt.label + t('heartbeats.minutes') : opt.label + t('heartbeats.hours') }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.promptFile') }}</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select v-model="form.promptFile" style="flex:1">
                <option v-for="p in heartbeatPrompts" :key="p.path" :value="p.path">
                  {{ p.path }}
                </option>
              </select>
              <button type="button" class="btn-outline btn-sm" @click="openCreatePrompt" title="+">+</button>
            </div>
            <div class="hint">{{ t('heartbeats.promptFile_hint') }}</div>
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.target') }} *</label>
            <select v-model="form.target">
              <option :value="null" disabled>--</option>
              <option v-for="s in channelSessions" :key="s.id" :value="s.id">
                {{ s.sessionName || `${s.channelId} / ${s.sessionId}` }} (#{{ s.id }})
              </option>
            </select>
            <div class="hint">{{ t('heartbeats.target_hint') }}</div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.enabled" />
              {{ t('heartbeats.enabled') }}
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.activeHoursEnabled" />
              {{ t('heartbeats.activeHours') }}
            </label>
            <div class="hint">{{ t('heartbeats.activeHours_hint') }}</div>
          </div>
          <template v-if="form.activeHoursEnabled">
            <div style="display:flex;gap:12px">
              <div class="form-group" style="flex:1">
                <label>{{ t('heartbeats.start_hour') }}</label>
                <input v-model.number="form.activeHoursStart" type="number" min="0" max="23" />
              </div>
              <div class="form-group" style="flex:1">
                <label>{{ t('heartbeats.end_hour') }}</label>
                <input v-model.number="form.activeHoursEnd" type="number" min="0" max="23" />
              </div>
            </div>
            <div class="form-group">
              <label>{{ t('heartbeats.timezone') }}</label>
              <input v-model="form.activeHoursTimezone" placeholder="Asia/Shanghai" />
            </div>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <!-- Quick create prompt sub-dialog -->
    <div v-if="showCreatePrompt" class="modal-overlay" style="z-index:1001" @click.self="showCreatePrompt = false">
      <div class="modal-box" style="width:440px">
        <div class="modal-header">
          <h3>{{ t('heartbeats.create_prompt') }}</h3>
          <button class="modal-close" @click="showCreatePrompt = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('heartbeats.prompt_filename') }}</label>
            <div style="display:flex;align-items:center;gap:4px">
              <span style="color:#9b9b9b;font-size:13px;flex-shrink:0">heartbeat/</span>
              <input v-model="newPromptName" placeholder="my-prompt.md" style="flex:1" @keyup.enter="createPrompt" />
            </div>
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.prompt_content') }}</label>
            <textarea v-model="newPromptContent" rows="8" style="font-family:'Consolas','Monaco',monospace;font-size:13px" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showCreatePrompt = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="createPrompt">{{ t('common.create') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
