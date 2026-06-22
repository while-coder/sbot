<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { store } from '@/shared/store'
import CreatePromptModal from '@/components/modals/CreatePromptModal.vue'
import SessionSelect from '@/components/SessionSelect.vue'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

type HeartbeatMode = 'fixed' | 'smart'

interface HeartbeatItem {
  id: number
  name: string
  intervalMinutes: number
  promptFile: string
  sessionId: number
  enabled: boolean
  activeHoursStart: number | null
  activeHoursEnd: number | null
  activeHoursTimezone: string | null
  lastRun: number | null
  running: boolean
  createdAt: number
  mode: HeartbeatMode
  agendaId: string | null
  jitterMinPct: number
  jitterMaxPct: number
  decisionPromptFile: string | null
  decisionModelId: string | null
  minGapMinutes: number
  dailyLimit: number
  lastSentAt: number | null
}

interface ChannelSessionOption {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
  autoSessionName: string
  agentId?: string | null
}

const TIMEZONE_OPTIONS = [
  { value: 'Etc/GMT+12', offset: '-12:00', key: 'tz_baker_island' },
  { value: 'Pacific/Pago_Pago', offset: '-11:00', key: 'tz_pago_pago' },
  { value: 'Pacific/Honolulu', offset: '-10:00', key: 'tz_honolulu' },
  { value: 'America/Anchorage', offset: '-9:00', key: 'tz_anchorage' },
  { value: 'America/Los_Angeles', offset: '-8:00', key: 'tz_los_angeles' },
  { value: 'America/Denver', offset: '-7:00', key: 'tz_denver' },
  { value: 'America/Chicago', offset: '-6:00', key: 'tz_chicago' },
  { value: 'America/New_York', offset: '-5:00', key: 'tz_new_york' },
  { value: 'America/Halifax', offset: '-4:00', key: 'tz_halifax' },
  { value: 'America/Sao_Paulo', offset: '-3:00', key: 'tz_sao_paulo' },
  { value: 'Atlantic/South_Georgia', offset: '-2:00', key: 'tz_south_georgia' },
  { value: 'Atlantic/Azores', offset: '-1:00', key: 'tz_azores' },
  { value: 'UTC', offset: '+0:00', key: 'tz_utc' },
  { value: 'Europe/Paris', offset: '+1:00', key: 'tz_paris' },
  { value: 'Europe/Athens', offset: '+2:00', key: 'tz_athens' },
  { value: 'Europe/Moscow', offset: '+3:00', key: 'tz_moscow' },
  { value: 'Asia/Dubai', offset: '+4:00', key: 'tz_dubai' },
  { value: 'Asia/Karachi', offset: '+5:00', key: 'tz_karachi' },
  { value: 'Asia/Dhaka', offset: '+6:00', key: 'tz_dhaka' },
  { value: 'Asia/Bangkok', offset: '+7:00', key: 'tz_bangkok' },
  { value: 'Asia/Shanghai', offset: '+8:00', key: 'tz_shanghai' },
  { value: 'Asia/Tokyo', offset: '+9:00', key: 'tz_tokyo' },
  { value: 'Australia/Brisbane', offset: '+10:00', key: 'tz_brisbane' },
  { value: 'Pacific/Noumea', offset: '+11:00', key: 'tz_noumea' },
  { value: 'Pacific/Auckland', offset: '+12:00', key: 'tz_auckland' },
]

const INTERVAL_OPTIONS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
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

const agendaOptions = computed(() =>
  Object.entries(store.settings.agendaProfiles || {}).map(([id, p]: [string, any]) => ({ id, label: p?.name || id }))
)
const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]: [string, any]) => ({ id, label: m?.name || id }))
)

const showModal = ref(false)
const editingId = ref<number | null>(null)

function defaultForm() {
  return {
    name: '',
    mode: 'fixed' as HeartbeatMode,
    intervalMinutes: 30,
    promptFile: 'heartbeat/default.md',
    sessionId: null as number | null,
    enabled: true,
    activeHoursEnabled: false,
    activeHoursStart: 9,
    activeHoursEnd: 22,
    activeHoursTimezone: '',
    agendaId: '' as string,
    decisionPromptFile: 'heartbeat/smart-default.md',
    decisionModelId: '' as string,
    jitterMinPct: 50,
    jitterMaxPct: 150,
    minGapMinutes: 30,
    dailyLimit: 6,
  }
}

const form = ref(defaultForm())

function sessionLabel(id: number): string {
  const s = channelSessions.value.find(s => s.id === id)
  if (!s) return `#${id}`
  const name = s.sessionName || s.autoSessionName || s.sessionId
  const channelName = store.settings.channels?.[s.channelId]?.name || s.channelId
  return `[${channelName}] ${name}`
}

function statusVariant(hb: HeartbeatItem): 'neutral' | 'warning' | 'success' {
  if (!hb.enabled) return 'neutral'
  if (hb.running) return 'warning'
  return 'success'
}
function statusLabel(hb: HeartbeatItem): string {
  if (!hb.enabled) return t('heartbeats.disabled')
  if (hb.running) return t('heartbeats.running')
  return t('heartbeats.waiting')
}

function openAdd() {
  editingId.value = null
  form.value = defaultForm()
  showModal.value = true
}

function openEdit(hb: HeartbeatItem) {
  editingId.value = hb.id
  form.value = {
    name: hb.name || '',
    mode: hb.mode || 'fixed',
    intervalMinutes: hb.intervalMinutes || 30,
    promptFile: hb.promptFile || 'heartbeat/default.md',
    sessionId: hb.sessionId ?? null,
    enabled: Boolean(hb.enabled),
    activeHoursEnabled: hb.activeHoursStart != null && hb.activeHoursEnd != null,
    activeHoursStart: hb.activeHoursStart ?? 9,
    activeHoursEnd: hb.activeHoursEnd ?? 22,
    activeHoursTimezone: hb.activeHoursTimezone ?? '',
    agendaId: hb.agendaId ?? '',
    decisionPromptFile: hb.decisionPromptFile ?? 'heartbeat/smart-default.md',
    decisionModelId: hb.decisionModelId ?? '',
    jitterMinPct: hb.jitterMinPct ?? 50,
    jitterMaxPct: hb.jitterMaxPct ?? 150,
    minGapMinutes: hb.minGapMinutes ?? 30,
    dailyLimit: hb.dailyLimit ?? 6,
  }
  showModal.value = true
}

function buildBody() {
  const f = form.value
  const body: any = {
    name: f.name,
    mode: f.mode,
    intervalMinutes: f.intervalMinutes,
    promptFile: f.promptFile,
    sessionId: f.sessionId,
    enabled: f.enabled,
    agendaId: f.agendaId || null,
    jitterMinPct: f.jitterMinPct,
    jitterMaxPct: f.jitterMaxPct,
    minGapMinutes: f.minGapMinutes,
    dailyLimit: f.dailyLimit,
  }
  if (f.activeHoursEnabled) {
    body.activeHoursStart = f.activeHoursStart
    body.activeHoursEnd = f.activeHoursEnd
    body.activeHoursTimezone = f.activeHoursTimezone || null
  } else {
    body.activeHoursStart = null
    body.activeHoursEnd = null
    body.activeHoursTimezone = null
  }
  if (f.mode === 'smart') {
    body.decisionPromptFile = f.decisionPromptFile || null
    body.decisionModelId = f.decisionModelId || null
  }
  return body
}

async function save() {
  const f = form.value
  if (!f.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (f.sessionId == null) { show(t('heartbeats.sessionId') + ' required', 'error'); return }
  if (f.mode === 'smart' && !f.decisionModelId) { show('decisionModelId required for smart mode', 'error'); return }
  if (f.jitterMinPct <= 0 || f.jitterMaxPct < f.jitterMinPct) {
    show('invalid jitter range', 'error'); return
  }
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
  if (!await confirm(t('heartbeats.confirm_delete', { name: hb.name || hb.id }), { danger: true })) return
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
const creatingPromptFor = ref<'fixed' | 'smart'>('fixed')

function openCreatePrompt(target: 'fixed' | 'smart' = 'fixed') {
  creatingPromptFor.value = target
  showCreatePrompt.value = true
}

async function onPromptCreated(filePath: string) {
  showCreatePrompt.value = false
  await loadHeartbeatPrompts()
  if (creatingPromptFor.value === 'smart') {
    form.value.decisionPromptFile = filePath
  } else {
    form.value.promptFile = filePath
  }
}

async function refresh() {
  await loadHeartbeats()
}

const heartbeatColumns = computed<STableColumn[]>(() => [
  { key: 'name',        label: t('heartbeats.name'), primary: true },
  { key: 'mode',        label: t('heartbeats.mode') },
  { key: 'interval',    label: t('heartbeats.interval') },
  { key: 'activeHours', label: t('heartbeats.activeHours') },
  { key: 'sessionId',   label: t('heartbeats.sessionId') },
  { key: 'status',      label: t('heartbeats.status') },
  { key: 'lastRun',     label: t('heartbeats.last_run') },
  { key: 'nextRun',     label: t('heartbeats.next_run') },
  { key: 'ops',         label: t('common.ops'), ops: true },
])

function fmtTime(s: string | number | null): string {
  return s ? new Date(s).toLocaleString('zh-CN') : '-'
}

function activeHoursLabel(hb: HeartbeatItem): string {
  if (hb.activeHoursStart == null || hb.activeHoursEnd == null) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hb.activeHoursStart)}:00 - ${pad(hb.activeHoursEnd)}:00`
}

function activeHoursTitle(hb: HeartbeatItem): string {
  if (hb.activeHoursStart == null || hb.activeHoursEnd == null) return ''
  return hb.activeHoursTimezone || t('heartbeats.timezone_local')
}

function intervalDisplay(hb: HeartbeatItem): string {
  const base = intervalLabel(hb.intervalMinutes)
  return `${base} ±[${hb.jitterMinPct}%-${hb.jitterMaxPct}%]`
}

function nextRunOf(hb: HeartbeatItem): string {
  if (!hb.enabled) return '-'
  if (hb.jitterMinPct !== 100 || hb.jitterMaxPct !== 100) return '~'
  if (!hb.lastRun) return '-'
  return fmtTime(hb.lastRun + hb.intervalMinutes * 60_000)
}

onMounted(async () => {
  await Promise.all([loadHeartbeats(), loadSessions(), loadHeartbeatPrompts()])
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('heartbeats.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable :columns="heartbeatColumns" :rows="heartbeats" row-key="id" :empty-text="t('heartbeats.empty')">
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #mode="{ row }">
          <SBadge :variant="row.mode === 'smart' ? 'info' : 'neutral'">{{ row.mode || 'fixed' }}</SBadge>
        </template>
        <template #interval="{ row }"><span class="hb-small">{{ intervalDisplay(row) }}</span></template>
        <template #activeHours="{ row }">
          <span class="hb-small" :title="activeHoursTitle(row)">{{ activeHoursLabel(row) }}</span>
        </template>
        <template #sessionId="{ row }"><span class="hb-small">{{ sessionLabel(row.sessionId) }}</span></template>
        <template #status="{ row }">
          <SBadge :variant="statusVariant(row)">{{ statusLabel(row) }}</SBadge>
        </template>
        <template #lastRun="{ row }"><span class="hb-time">{{ fmtTime(row.lastRun) }}</span></template>
        <template #nextRun="{ row }"><span class="hb-time">{{ nextRunOf(row) }}</span></template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="trigger(row)">{{ t('heartbeats.trigger') }}</SButton>
          <SButton type="outline" size="sm" @click="openEdit(row)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingId !== null ? t('heartbeats.edit_title') : t('heartbeats.add_title')" width="lg">
      <SFormItem :label="t('heartbeats.name') + ' *'">
        <SInput v-model="form.name" />
      </SFormItem>
      <SFormItem :label="t('heartbeats.mode')" :hint="t('heartbeats.mode_hint')">
        <SSelect v-model="form.mode">
          <option value="fixed">fixed — {{ t('heartbeats.mode_fixed_hint') }}</option>
          <option value="smart">smart — {{ t('heartbeats.mode_smart_hint') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="(form.mode === 'smart' ? t('heartbeats.base_interval') : t('heartbeats.interval')) + ' *'">
        <SSelect v-model.number="form.intervalMinutes">
          <option v-for="opt in INTERVAL_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.value < 60 ? opt.label + t('heartbeats.minutes') : opt.label + t('heartbeats.hours') }}
          </option>
        </SSelect>
      </SFormItem>

      <!-- fixed: prompt file -->
      <SFormItem v-if="form.mode === 'fixed'" :label="t('heartbeats.promptFile')" :hint="t('heartbeats.promptFile_hint')">
        <div class="prompt-field">
          <SSelect v-model="form.promptFile" class="prompt-select">
            <option v-for="p in heartbeatPrompts" :key="p.path" :value="p.path">
              {{ p.path.split('/').pop() }}
            </option>
          </SSelect>
          <SButton type="outline" size="sm" @click="openCreatePrompt('fixed')">+</SButton>
        </div>
      </SFormItem>

      <SFormItem :label="t('heartbeats.agenda')" :hint="t('heartbeats.agenda_hint')">
        <SSelect v-model="form.agendaId">
          <option value="">{{ t('heartbeats.agenda_none') }}</option>
          <option v-for="a in agendaOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('heartbeats.jitter')" :hint="t('heartbeats.jitter_hint')">
        <div class="hour-row">
          <SInput v-model.number="form.jitterMinPct" type="number" min="10" max="500" />
          <SInput v-model.number="form.jitterMaxPct" type="number" min="10" max="500" />
        </div>
      </SFormItem>
      <SFormItem :label="t('heartbeats.minGap')" :hint="t('heartbeats.minGap_hint')">
        <SInput v-model.number="form.minGapMinutes" type="number" min="0" max="1440" />
      </SFormItem>
      <SFormItem :label="t('heartbeats.dailyLimit')" :hint="t('heartbeats.dailyLimit_hint')">
        <SInput v-model.number="form.dailyLimit" type="number" min="0" max="100" />
      </SFormItem>

      <!-- smart: decision prompt + model -->
      <template v-if="form.mode === 'smart'">
        <SFormItem :label="t('heartbeats.decisionPromptFile')" :hint="t('heartbeats.decisionPromptFile_hint')">
          <div class="prompt-field">
            <SSelect v-model="form.decisionPromptFile" class="prompt-select">
              <option v-for="p in heartbeatPrompts" :key="p.path" :value="p.path">
                {{ p.path.split('/').pop() }}
              </option>
            </SSelect>
            <SButton type="outline" size="sm" @click="openCreatePrompt('smart')">+</SButton>
          </div>
        </SFormItem>
        <SFormItem :label="t('heartbeats.decisionModel') + ' *'" :hint="t('heartbeats.decisionModel_hint')">
          <SSelect v-model="form.decisionModelId">
            <option value="" disabled>--</option>
            <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </SSelect>
        </SFormItem>
      </template>

      <SFormItem :label="t('heartbeats.sessionId') + ' *'" :hint="t('heartbeats.sessionId_hint')">
        <SessionSelect v-model="form.sessionId" empty-disabled />
      </SFormItem>
      <SFormItem>
        <label class="checkbox-label">
          <input v-model="form.enabled" type="checkbox" />
          {{ t('heartbeats.enabled') }}
        </label>
      </SFormItem>
      <SFormItem :hint="t('heartbeats.activeHours_hint')">
        <label class="checkbox-label">
          <input v-model="form.activeHoursEnabled" type="checkbox" />
          {{ t('heartbeats.activeHours') }}
        </label>
      </SFormItem>
      <template v-if="form.activeHoursEnabled">
        <div class="hour-row">
          <SFormItem :label="t('heartbeats.start_hour')" class="hour-item">
            <SInput v-model.number="form.activeHoursStart" type="number" min="0" max="23" />
          </SFormItem>
          <SFormItem :label="t('heartbeats.end_hour')" class="hour-item">
            <SInput v-model.number="form.activeHoursEnd" type="number" min="0" max="24" />
          </SFormItem>
        </div>
        <SFormItem :label="t('heartbeats.timezone')">
          <SSelect v-model="form.activeHoursTimezone">
            <option value="">{{ t('heartbeats.timezone_local') }}</option>
            <option v-for="tz in TIMEZONE_OPTIONS" :key="tz.value" :value="tz.value">(UTC{{ tz.offset }}) {{ t('heartbeats.' + tz.key) }}</option>
          </SSelect>
        </SFormItem>
      </template>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <CreatePromptModal v-model:visible="showCreatePrompt" prefix="heartbeat/" default-ext=".md" @created="onPromptCreated" @close="showCreatePrompt = false" />
  </div>
</template>

<style scoped>
.hb-small { font-size: var(--sui-fs-sm); }
.hb-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.prompt-field {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.prompt-select { flex: 1; }
.hour-row {
  display: flex;
  gap: var(--sui-sp-4);
}
.hour-item { flex: 1; }
</style>
