<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

interface HeartbeatStatus {
  id: string
  nextRun: string | null
  enabled: boolean
}

interface ChannelSessionOption {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
}

const heartbeats = computed(() => store.settings.heartbeats || {})
const statusList = ref<HeartbeatStatus[]>([])
const channelSessions = ref<ChannelSessionOption[]>([])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: '',
  expr: '30m',
  promptFile: 'heartbeat/default.md',
  target: null as number | null,
  notifyTargets: [] as number[],
  enabled: true,
  activeHoursEnabled: false,
  activeHoursStart: 9,
  activeHoursEnd: 22,
  activeHoursTimezone: '',
  okToken: '',
  pruneOk: true,
  dedupHours: 24,
})

function getNextRun(id: string): string | null {
  const s = statusList.value.find(s => s.id === id)
  return s?.nextRun ?? null
}

function sessionLabel(id: number): string {
  const s = channelSessions.value.find(s => s.id === id)
  if (!s) return `#${id}`
  return s.sessionName || `${s.channelId} / ${s.sessionId}`
}

function openAdd() {
  editingId.value = null
  form.value = {
    name: '',
    expr: '30m',
    promptFile: 'heartbeat/default.md',
    target: null,
    notifyTargets: [],
    enabled: true,
    activeHoursEnabled: false,
    activeHoursStart: 9,
    activeHoursEnd: 22,
    activeHoursTimezone: '',
    okToken: '',
    pruneOk: true,
    dedupHours: 24,
  }
  showModal.value = true
}

function openEdit(id: string) {
  const hb = heartbeats.value[id] as any
  editingId.value = id
  form.value = {
    name: hb.name || '',
    expr: hb.expr || '30m',
    promptFile: hb.promptFile || 'heartbeat/default.md',
    target: hb.target ?? null,
    notifyTargets: hb.notifyTargets ?? [],
    enabled: hb.enabled !== false,
    activeHoursEnabled: !!hb.activeHours,
    activeHoursStart: hb.activeHours?.start ?? 9,
    activeHoursEnd: hb.activeHours?.end ?? 22,
    activeHoursTimezone: hb.activeHours?.timezone ?? '',
    okToken: hb.okToken ?? '',
    pruneOk: hb.pruneOk !== false,
    dedupHours: hb.dedupHours ?? 24,
  }
  showModal.value = true
}

function buildBody() {
  const body: any = {
    name: form.value.name,
    expr: form.value.expr,
    promptFile: form.value.promptFile,
    target: form.value.target,
    enabled: form.value.enabled,
    pruneOk: form.value.pruneOk,
    dedupHours: form.value.dedupHours,
  }
  if (form.value.notifyTargets.length > 0) {
    body.notifyTargets = form.value.notifyTargets
  }
  if (form.value.activeHoursEnabled) {
    body.activeHours = {
      start: form.value.activeHoursStart,
      end: form.value.activeHoursEnd,
      ...(form.value.activeHoursTimezone ? { timezone: form.value.activeHoursTimezone } : {}),
    }
  }
  if (form.value.okToken.trim()) {
    body.okToken = form.value.okToken.trim()
  }
  return body
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (form.value.target == null) { show(t('heartbeats.target') + ' required', 'error'); return }
  try {
    const body = buildBody()
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/heartbeats/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/heartbeats', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
    await loadStatus()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const hb = heartbeats.value[id] as any
  if (!window.confirm(t('heartbeats.confirm_delete', { name: hb?.name || id }))) return
  try {
    const res = await apiFetch(`/api/settings/heartbeats/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show(t('common.deleted'))
    await loadStatus()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function trigger(id: string) {
  try {
    await apiFetch(`/api/heartbeats/${encodeURIComponent(id)}/trigger`, 'POST')
    show(t('heartbeats.triggered'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadStatus() {
  try {
    const res = await apiFetch('/api/heartbeats')
    statusList.value = res.data || []
  } catch {}
}

async function loadSessions() {
  try {
    const res = await apiFetch('/api/channel-sessions')
    channelSessions.value = res.data || []
  } catch {}
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
  await loadStatus()
}

onMounted(async () => {
  await Promise.all([loadStatus(), loadSessions()])
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
            <th>{{ t('heartbeats.expr') }}</th>
            <th>{{ t('heartbeats.target') }}</th>
            <th>{{ t('heartbeats.enabled') }}</th>
            <th>{{ t('heartbeats.next_run') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(heartbeats).length === 0">
            <td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">{{ t('heartbeats.empty') }}</td>
          </tr>
          <tr v-for="(hb, id) in heartbeats" :key="id">
            <td>{{ (hb as any).name || id }}</td>
            <td style="font-family:monospace;font-size:12px">{{ (hb as any).expr }}</td>
            <td style="font-size:12px">{{ sessionLabel((hb as any).target) }}</td>
            <td>
              <span :style="{ color: (hb as any).enabled !== false ? '#16a34a' : '#9b9b9b' }">
                {{ (hb as any).enabled !== false ? 'ON' : 'OFF' }}
              </span>
            </td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">
              {{ getNextRun(id as string) ? new Date(getNextRun(id as string)!).toLocaleString('zh-CN') : '-' }}
            </td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="trigger(id as string)">{{ t('heartbeats.trigger') }}</button>
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-if="Object.keys(heartbeats).length === 0" class="mobile-card-empty">{{ t('heartbeats.empty') }}</div>
        <div v-for="(hb, id) in heartbeats" :key="id" class="mobile-card">
          <div class="mobile-card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span>{{ (hb as any).name || id }}</span>
            <span :style="{ color: (hb as any).enabled !== false ? '#16a34a' : '#9b9b9b', fontSize: '12px', fontWeight: 600 }">
              {{ (hb as any).enabled !== false ? 'ON' : 'OFF' }}
            </span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('heartbeats.expr') }}</span>
            <span class="mobile-card-value" style="font-family:monospace;font-size:12px">{{ (hb as any).expr }}</span>
            <span class="mobile-card-label">{{ t('heartbeats.target') }}</span>
            <span class="mobile-card-value" style="font-size:12px">{{ sessionLabel((hb as any).target) }}</span>
            <span class="mobile-card-label">{{ t('heartbeats.next_run') }}</span>
            <span class="mobile-card-value" style="font-size:12px;color:#9b9b9b">
              {{ getNextRun(id as string) ? new Date(getNextRun(id as string)!).toLocaleString('zh-CN') : '-' }}
            </span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="trigger(id as string)">{{ t('heartbeats.trigger') }}</button>
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
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
            <label>{{ t('heartbeats.expr') }} *</label>
            <input v-model="form.expr" placeholder="30m" />
            <div class="hint">{{ t('heartbeats.expr_hint') }}</div>
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.promptFile') }}</label>
            <input v-model="form.promptFile" placeholder="heartbeat/default.md" />
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
            <label>{{ t('heartbeats.notifyTargets') }}</label>
            <select v-model="form.notifyTargets" multiple style="min-height:60px">
              <option v-for="s in channelSessions" :key="s.id" :value="s.id">
                {{ s.sessionName || `${s.channelId} / ${s.sessionId}` }} (#{{ s.id }})
              </option>
            </select>
            <div class="hint">{{ t('heartbeats.notifyTargets_hint') }}</div>
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
          <div class="form-group">
            <label>{{ t('heartbeats.okToken') }}</label>
            <input v-model="form.okToken" placeholder="HEARTBEAT_OK" />
            <div class="hint">{{ t('heartbeats.okToken_hint') }}</div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.pruneOk" />
              {{ t('heartbeats.pruneOk') }}
            </label>
          </div>
          <div class="form-group">
            <label>{{ t('heartbeats.dedupHours') }}</label>
            <input v-model.number="form.dedupHours" type="number" min="0" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
