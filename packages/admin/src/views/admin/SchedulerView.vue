<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SButton, SBadge, SPageToolbar, SPageContent, STable, SModal, SFormItem, SSelect } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { store } from '@/shared/store'
import { TYPE_VARIANT, detectUIType, describeExpr, type SchedulerRow } from '@/utils/scheduler'

const { t, locale } = useI18n()
const { confirm } = useConfirm()

interface ChannelSessionRow {
  id: number
  channelId: string
  sessionId: string
  sessionName?: string | null
  autoSessionName?: string | null
}

interface ChannelGroup {
  channelId: string
  channelName: string
  sessions: ChannelSessionRow[]
}

const { show } = useToast()
const timers = ref<SchedulerRow[]>([])
const channelSessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)
const now = ref(Date.now())

const groupedSessions = computed<ChannelGroup[]>(() => {
  const channels = store.settings.channels
  const map = new Map<string, ChannelSessionRow[]>()
  for (const s of channelSessions.value) {
    const list = map.get(s.channelId) || []
    list.push(s)
    map.set(s.channelId, list)
  }
  const groups: ChannelGroup[] = []
  for (const [channelId, sessions] of map) {
    const channelName = channels?.[channelId]?.name || channelId
    groups.push({ channelId, channelName, sessions })
  }
  return groups
})

const showModal = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
  message: '',
  targetId: null as number | null,
  aiProcess: true,
})

function openEdit(row: SchedulerRow) {
  editingId.value = row.id
  form.value = {
    message: row.message || '',
    targetId: row.targetId != null ? parseInt(row.targetId) : null,
    aiProcess: Boolean(row.aiProcess),
  }
  showModal.value = true
}

async function save() {
  const id = editingId.value
  if (id == null) return
  if (!form.value.message.trim()) { show(t('scheduler.message_required'), 'error'); return }
  if (form.value.targetId == null) { show(t('scheduler.target_required'), 'error'); return }
  try {
    await apiFetch(`/api/schedulers/${id}`, 'PUT', {
      message: form.value.message.trim(),
      targetId: String(form.value.targetId),
      aiProcess: form.value.aiProcess,
    })
    show(t('common.saved'))
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e?.message || String(e), 'error')
  }
}

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

interface TargetInfo { text: string; title: string; mapped: boolean; placeholder: boolean }

function targetInfo(row: SchedulerRow): TargetInfo {
  if (row.targetId == null) {
    const text = t('scheduler.target_global')
    return { text, title: text, mapped: false, placeholder: true }
  }
  const id = parseInt(row.targetId)
  const s = channelSessions.value.find(s => s.id === id)
  if (s) {
    const name = s.sessionName || s.autoSessionName || s.sessionId
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
            <span class="sched-desc">{{ describeExpr(row.expr, t) }}</span>
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
          <SButton type="outline" size="sm" @click="openEdit(row)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="t('scheduler.edit_title')" width="lg">
      <SFormItem :label="t('scheduler.message_col') + ' *'">
        <textarea v-model="form.message" class="sched-textarea" rows="4" spellcheck="false" />
      </SFormItem>
      <SFormItem :label="t('scheduler.target_col') + ' *'">
        <SSelect :model-value="form.targetId ?? ''" @update:model-value="form.targetId = $event === '' ? null : Number($event)">
          <option value="" disabled>--</option>
          <optgroup v-for="g in groupedSessions" :key="g.channelId" :label="g.channelName">
            <option v-for="s in g.sessions" :key="s.id" :value="s.id">
              {{ s.sessionName || s.autoSessionName || s.sessionId }}
            </option>
          </optgroup>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('scheduler.mode_col')">
        <SSelect :model-value="form.aiProcess ? '1' : '0'" @update:model-value="form.aiProcess = $event === '1'">
          <option value="1">{{ t('scheduler.mode_ai') }}</option>
          <option value="0">{{ t('scheduler.mode_raw') }}</option>
        </SSelect>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>
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
.sched-textarea {
  width: 100%;
  font-family: inherit;
  font-size: var(--sui-fs-md);
  padding: var(--sui-sp-2) var(--sui-sp-3);
  background: var(--sui-bg);
  color: var(--sui-fg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  resize: vertical;
  box-sizing: border-box;
}
.sched-textarea:focus {
  outline: none;
  border-color: var(--sui-accent);
}
</style>
