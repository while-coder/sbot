<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'

import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatViewLogic } from '@/composables/useChatViewLogic'
import ChatArea from '@/components/ChatArea.vue'
import SaverViewModal from './modals/SaverViewModal.vue'
import MemoryViewModal from './modals/MemoryViewModal.vue'
import PathPickerModal from './modals/PathPickerModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'
import NewSessionModal from './modals/NewSessionModal.vue'
import { WsCommandType } from 'sbot.commons'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()
const showSessionPanel = ref(true)

// ── Refs ──
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()
const pathPickerModal = ref<InstanceType<typeof PathPickerModal>>()
const newSessionModal = ref<InstanceType<typeof NewSessionModal>>()
const sessionNameInputEl = ref<HTMLInputElement | null>(null)

// ── Sidebar inline name edit ──
const editingSessionId   = ref<string | null>(null)
const editingSessionName = ref('')

// ── Session sidebar ──
const activeSessionId = ref<string | null>(null)
const sessions = computed(() => store.sessions)

const { chatAreaRef, agentOptions, saverOptions, memoryOptions, wikiOptions, sendOne, fetchAndRestoreSessionStatus } = useChatViewLogic({
  sessionId: () => activeSessionId.value ?? undefined,
  buildSendPayload: (parts, sessionId, fileAtts) => ({
    type: WsCommandType.Query,
    sessionId,
    parts,
    attachments: fileAtts?.length ? fileAtts : undefined,
  }),
  sessionStatusQuery: (id) => `sessionId=${encodeURIComponent(id)}`,
  onDone: () => loadSessionUsage(activeSessionId.value),
  onUsage: (data) => {
    if (sessionUsage.value) {
      sessionUsage.value.lastInputTokens = data.inputTokens
      sessionUsage.value.lastOutputTokens = data.outputTokens
      sessionUsage.value.lastTotalTokens = data.totalTokens
      sessionUsage.value.inputTokens += data.inputTokens
      sessionUsage.value.outputTokens += data.outputTokens
      sessionUsage.value.totalTokens += data.totalTokens
    } else {
      sessionUsage.value = {
        inputTokens: data.inputTokens, outputTokens: data.outputTokens, totalTokens: data.totalTokens,
        lastInputTokens: data.inputTokens, lastOutputTokens: data.outputTokens, lastTotalTokens: data.totalTokens,
      }
    }
  },
})

const effectiveAgent  = computed(() => activeSessionId.value ? sessions.value[activeSessionId.value]?.agent  : undefined)
const effectiveSaver  = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.saver  || null) : null)
const effectiveMemories = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.memories || []) : [])
const effectiveWikis = computed(() => activeSessionId.value ? ((sessions.value[activeSessionId.value] as any)?.wikis || []) : [])
const effectiveWorkPath = computed(() => activeSessionId.value ? ((sessions.value[activeSessionId.value] as any)?.workPath || '') : '')

const historyUrl = computed<string | null>(() => {
  if (!effectiveSaver.value || !activeSessionId.value) return null
  return `/api/sessions/${encodeURIComponent(activeSessionId.value)}/history`
})

function switchSession(id: string) {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  if (isMobile.value) showSessionPanel.value = false
}

async function deleteSession(id: string) {
  const s = sessions.value[id]
  const label = s?.name || (id as string).slice(0, 8) + '…'
  if (!window.confirm(t('chat.confirm_delete_session', { name: label }))) return
  try {
    await apiFetch(`/api/settings/sessions/${encodeURIComponent(id)}`, 'DELETE')
    if (s?.saver) {
      await apiFetch(`/api/sessions/${encodeURIComponent(id)}/history`, 'DELETE').catch(() => {})
    }
    delete store.sessions[id]
    if (activeSessionId.value === id) {
      const remaining = Object.keys(sessions.value)
      activeSessionId.value = remaining.length > 0 ? remaining[0] : null
    }
    show(t('chat.session_deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function onSessionCreated(id: string) {
  activeSessionId.value = id
}

async function saveSession(patch: Record<string, any>, id?: string) {
  const targetId = id ?? activeSessionId.value
  if (!targetId) return
  try {
    const current = { ...sessions.value[targetId] }
    const updated = { ...current, ...patch }
    await apiFetch(`/api/settings/sessions/${encodeURIComponent(targetId)}`, 'PUT', updated)
    Object.assign(store.sessions[targetId], patch)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function startEditSessionName(id: string) {
  editingSessionId.value = id
  editingSessionName.value = sessions.value[id]?.name || ''
  nextTick(() => sessionNameInputEl.value?.focus())
}

async function commitEditSessionName() {
  const id = editingSessionId.value
  editingSessionId.value = null
  if (!id) return
  const val = editingSessionName.value.trim()
  if (!val) return
  const prev = activeSessionId.value
  activeSessionId.value = id
  await saveSession({ name: val })
  activeSessionId.value = prev
}

// ── Send / lifecycle ──
async function onPanelSend(parts: any[], fileAtts: { name: string; type: string; dataUrl?: string; content?: string }[]) {
  if (!activeSessionId.value) { show(t('chat.no_session'), 'error'); return }
  if (!effectiveSaver.value) { show(t('chat.no_saver'), 'error'); return }
  if (parts.length === 0 && fileAtts.length === 0) return
  await sendOne(parts, fileAtts)
}

// ── Token usage ──
interface ThreadUsage {
  inputTokens: number; outputTokens: number; totalTokens: number
  lastInputTokens: number; lastOutputTokens: number; lastTotalTokens: number
}
const sessionUsage = ref<ThreadUsage | null>(null)

async function loadSessionUsage(id: string | null) {
  if (!id) { sessionUsage.value = null; return }
  try {
    const res = await apiFetch(`/api/thread-usage?sessions=${encodeURIComponent(id)}`)
    sessionUsage.value = res.data?.[id] ?? null
  } catch { sessionUsage.value = null }
}

// ── Model info (context window) ──
const sessionContextWindow = computed(() => {
  const sid = activeSessionId.value
  if (!sid) return undefined
  const session = sessions.value[sid]
  if (!session?.agent) return undefined
  const agentEntry = (store.settings.agents || {} as any)[session.agent]
  const modelId = agentEntry?.model as string | undefined
  if (!modelId) return undefined
  const mc = (store.settings as any).models?.[modelId]
  return mc?.contextWindow as number | undefined
})

const contextPercent = computed(() => {
  if (!sessionContextWindow.value || !sessionUsage.value?.lastInputTokens) return null
  return Math.min(100, Math.round(sessionUsage.value.lastInputTokens / sessionContextWindow.value * 100))
})

const contextBarColor = computed(() => {
  const p = contextPercent.value
  if (p == null) return ''
  if (p < 60) return '#22c55e'
  if (p < 85) return '#eab308'
  return '#ef4444'
})

function formatNumber(n: number): string {
  return n.toLocaleString()
}

watch(activeSessionId, (id) => {
  fetchAndRestoreSessionStatus(id)
  loadSessionUsage(id)
})

onMounted(() => {
  const ids = Object.keys(sessions.value)
  if (ids.length > 0 && !activeSessionId.value) {
    activeSessionId.value = ids[0]
  }
})
</script>

<template>
  <div style="height:100%;display:flex;overflow:hidden">

    <button v-if="isMobile" class="session-toggle-btn" @click="showSessionPanel = !showSessionPanel">
      {{ showSessionPanel ? '✕' : '☰' }}
    </button>

    <!-- Session sidebar (left, full height) -->
    <div v-if="!isMobile || showSessionPanel" :class="{ 'chat-session-panel-mobile': isMobile }" style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
      <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
        <button class="btn-outline btn-sm" style="width:100%" @click="newSessionModal?.open()">{{ t('chat.new_session') }}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:4px">
        <div
          v-for="(s, id) in sessions"
          :key="id"
          class="session-item"
          :class="{ active: activeSessionId === id }"
          @click="switchSession(id as string)"
        >
          <div style="display:flex;align-items:center;gap:4px">
            <div style="flex:1;min-width:0">
              <input
                v-if="editingSessionId === id"
                ref="sessionNameInputEl"
                v-model="editingSessionName"
                class="session-name-input"
                @click.stop
                @blur="commitEditSessionName"
                @keydown.enter.stop="commitEditSessionName"
                @keydown.escape.stop="editingSessionId = null"
              />
              <div
                v-else
                class="session-item-name"
                @dblclick.stop="startEditSessionName(id as string)"
                title="双击编辑名称"
              >{{ s.name || (id as string).slice(0, 8) + '…' }}</div>
              <div v-if="(s as any).workPath" class="session-item-path" :title="(s as any).workPath">{{ (s as any).workPath }}</div>
            </div>
            <button
              class="session-del-btn"
              @click.stop="deleteSession(id as string)"
              title="删除会话"
            >×</button>
          </div>
        </div>
        <div v-if="Object.keys(sessions).length === 0" style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
          {{ t('chat.empty') }}<br>{{ t('chat.create_hint') }}
        </div>
      </div>
    </div>

    <!-- Right panel: toolbar + chat -->
    <div v-if="!isMobile || !showSessionPanel" style="flex:1;display:flex;flex-direction:column;overflow:hidden">

      <!-- Header -->
      <div class="chat-header">
        <!-- Row 1: Config -->
        <div class="chat-toolbar-row" :class="{ 'chat-toolbar-mobile': isMobile }">
          <template v-if="activeSessionId">
            <div class="toolbar-group">
              <label class="toolbar-label">Agent</label>
              <select
                class="toolbar-select-sm"
                :value="effectiveAgent"
                @change="saveSession({ agent: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
              </select>
            </div>

            <div class="toolbar-sep" />

            <div class="toolbar-group">
              <label class="toolbar-label">{{ t('common.storage') }}</label>
              <select
                class="toolbar-select-sm"
                :value="effectiveSaver || ''"
                @change="saveSession({ saver: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
              <button v-if="effectiveSaver" class="chat-info-chip" @click="saverViewModal?.openSession(activeSessionId!, saverOptions.find(s => s.id === effectiveSaver)?.label || effectiveSaver!)">{{ t('common.view') }}</button>
            </div>

            <div class="toolbar-sep" />

            <div class="toolbar-group">
              <label class="toolbar-label">{{ t('common.workpath') }}</label>
              <input
                class="toolbar-input-sm"
                :value="effectiveWorkPath"
                :placeholder="t('common.workpath_placeholder')"
                readonly
                :title="effectiveWorkPath || t('common.workpath_placeholder')"
                style="max-width:180px"
              />
              <button class="btn-outline btn-sm" @click="pathPickerModal?.open(effectiveWorkPath)">…</button>
              <button v-if="effectiveWorkPath" class="chat-info-chip" style="color:#ef4444" @click="saveSession({ workPath: undefined })">×</button>
            </div>

            <div class="toolbar-sep" />

            <div class="toolbar-group">
              <label class="toolbar-label">{{ t('common.memory') }}</label>
              <MultiSelect
                :model-value="effectiveMemories"
                :options="memoryOptions"
                compact
                style="min-width:140px"
                @update:model-value="saveSession({ memories: $event })"
              />
              <template v-for="mid in effectiveMemories" :key="mid">
                <button class="chat-info-chip" @click="store.settings.memories?.[mid]?.share ? memoryViewModal?.open(mid, store.settings.memories[mid]) : memoryViewModal?.openSession(mid, store.settings.memories?.[mid] ?? {}, activeSessionId!)">{{ memoryOptions.find(m => m.id === mid)?.label || t('common.view') }}</button>
              </template>
            </div>

            <div class="toolbar-sep" />

            <div class="toolbar-group">
              <label class="toolbar-label">{{ t('common.wiki') }}</label>
              <MultiSelect
                :model-value="effectiveWikis"
                :options="wikiOptions"
                compact
                style="min-width:140px"
                @update:model-value="saveSession({ wikis: $event })"
              />
            </div>

            <div class="toolbar-group" style="margin-left:auto">
              <label class="toggle-label toolbar-toggle" style="font-size:12px">
                <input
                  type="checkbox"
                  :checked="!!sessions[activeSessionId!]?.autoApproveAllTools"
                  @change="saveSession({ autoApproveAllTools: ($event.target as HTMLInputElement).checked })"
                />
                <span>{{ t('settings.auto_approve_all') }}</span>
              </label>
            </div>
          </template>
          <span v-else style="font-size:13px;color:#94a3b8">{{ t('chat.select_or_create') }}</span>
        </div>

        <!-- Row 2: Usage + Actions -->
        <div class="chat-status-row" v-if="activeSessionId">
          <div class="usage-stats" v-if="sessionUsage && sessionUsage.totalTokens > 0">
            <span v-if="contextPercent != null" class="context-bar-wrap" :title="`${formatNumber(sessionUsage.lastInputTokens)} / ${formatNumber(sessionContextWindow!)}`">
              <div class="context-bar-track">
                <div class="context-bar-fill" :style="{ width: contextPercent + '%', background: contextBarColor }" />
              </div>
              <span class="context-bar-label">{{ contextPercent }}%</span>
            </span>
            <span class="usage-sep" v-if="contextPercent != null" />
            <span class="usage-item">
              <span class="usage-label">{{ t('usage.last') }}</span>
              <span class="usage-val usage-in">{{ formatNumber(sessionUsage.lastInputTokens) }}</span>
              <span class="usage-op">/</span>
              <span class="usage-val usage-out">{{ formatNumber(sessionUsage.lastOutputTokens) }}</span>
            </span>
            <span class="usage-sep" />
            <span class="usage-item">
              <span class="usage-label">{{ t('usage.total') }}</span>
              <span class="usage-val usage-in">{{ formatNumber(sessionUsage.inputTokens) }}</span>
              <span class="usage-op">/</span>
              <span class="usage-val usage-out">{{ formatNumber(sessionUsage.outputTokens) }}</span>
            </span>
          </div>
          <div class="toolbar-actions">
            <button class="btn-outline btn-sm" @click="() => { chatAreaRef?.refreshHistory(); loadSessionUsage(activeSessionId) }">{{ t('common.refresh') }}</button>
            <button class="btn-danger btn-sm" :disabled="!effectiveSaver" @click="chatAreaRef?.clearHistory()">{{ t('chat.clear_history') }}</button>
          </div>
        </div>
      </div>

      <ChatArea
        ref="chatAreaRef"
        :history-url="historyUrl"
        :show-attachments="true"
        :cancel-session-id="activeSessionId || undefined"
        @send="onPanelSend"
      />
    </div>

    <SaverViewModal ref="saverViewModal" />
    <MemoryViewModal ref="memoryViewModal" />
    <PathPickerModal ref="pathPickerModal" @confirm="(p: string) => saveSession({ workPath: p || undefined })" />
    <NewSessionModal ref="newSessionModal" @created="onSessionCreated" />
  </div>
</template>

<style scoped>
.session-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
  margin-bottom: 2px;
}
.session-item:hover { background: #f5f4f2; }
.session-item.active { background: #f0efed; }
.session-item-path {
  font-size: 10px;
  color: #9b9b9b;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.session-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-del-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: transparent;
  font-size: 16px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color .1s;
}
.session-item:hover .session-del-btn { color: #94a3b8; }
.session-del-btn:hover { color: #ef4444 !important; }
.session-name-input {
  width: 100%;
  font-size: 13px;
  font-weight: 500;
  padding: 1px 4px;
  border: 1px solid #1c1c1c;
  border-radius: 4px;
  outline: none;
  font-family: inherit;
  color: #1c1c1c;
  background: #fff;
}
/* ── Header layout ── */
.chat-header {
  border-bottom: 1px solid #e8e6e3;
  background: #fff;
  flex-shrink: 0;
}
.chat-toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.toolbar-label {
  font-size: 11px;
  font-weight: 600;
  color: #9b9b9b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.toolbar-select-sm {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #e8e6e3;
  border-radius: 4px;
  background: #fff;
  color: #1c1c1c;
  outline: none;
  font-family: inherit;
}
.toolbar-select-sm:focus { border-color: #1c1c1c; }
.toolbar-sep {
  width: 1px;
  height: 18px;
  background: #e8e6e3;
  flex-shrink: 0;
}
.toolbar-input-sm {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #f9fafb;
  color: #6b7280;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
}
/* ── Status row ── */
.chat-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 16px;
  border-top: 1px solid #f0efed;
  min-height: 30px;
}
.usage-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #64748b;
}
.usage-item {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.usage-label {
  color: #94a3b8;
  font-weight: 500;
}
.usage-val {
  font-weight: 600;
}
.usage-in { color: #3b82f6; }
.usage-out { color: #8b5cf6; }
.usage-op {
  color: #cbd5e1;
  font-size: 10px;
}
.usage-sep {
  width: 1px;
  height: 12px;
  background: #e2e8f0;
  flex-shrink: 0;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.session-toggle-btn {
  position: fixed;
  top: 58px;
  left: 8px;
  z-index: 50;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.chat-session-panel-mobile {
  width: 100% !important;
  border-right: none !important;
}
.context-bar-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}
.context-bar-track {
  width: 80px;
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
}
.context-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width .3s, background .3s;
}
.context-bar-label {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (max-width: 768px) {
  .chat-toolbar-mobile {
    gap: 6px;
    padding: 6px 8px;
  }
  .chat-toolbar-mobile .toolbar-sep { display: none; }
  .chat-toolbar-mobile .toolbar-group {
    flex-wrap: wrap;
  }
  .chat-status-row {
    flex-wrap: wrap;
    padding: 4px 8px;
    gap: 6px;
  }
}
</style>
