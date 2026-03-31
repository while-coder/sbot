<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import SaverViewModal from './modals/SaverViewModal.vue'
import MemoryViewModal from './modals/MemoryViewModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'
import NewSessionModal from './modals/NewSessionModal.vue'
import ChatArea from '@/components/ChatArea.vue'
import { sessionThreadId, WsCommandType, WebChatEventType } from 'sbot.commons'
import type { WebChatEvent } from 'sbot.commons'

const { t } = useI18n()

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const { show } = useToast()

// ── Refs ──
const chatAreaRef     = ref<InstanceType<typeof ChatArea>>()
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()
const newSessionModal = ref<InstanceType<typeof NewSessionModal>>()
const sessionNameInputEl = ref<HTMLInputElement | null>(null)

// ── Sidebar inline name edit ──
const editingSessionId   = ref<string | null>(null)
const editingSessionName = ref('')

// ── Session sidebar ──
const activeSessionId = ref<string | null>(null)
const sessions = computed(() => store.settings.sessions || {})

const agentOptions  = computed(() =>
  Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)
const saverOptions  = computed(() =>
  Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)

const effectiveAgent  = computed(() => activeSessionId.value ? sessions.value[activeSessionId.value]?.agent  : undefined)
const effectiveSaver  = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.saver  || null) : null)
const effectiveMemories = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.memories || []) : [])

const historyUrl = computed<string | null>(() => {
  const saver = effectiveSaver.value
  if (!saver || !activeSessionId.value) return null
  return `/api/savers/${encodeURIComponent(saver)}/threads/${encodeURIComponent(sessionThreadId(activeSessionId.value))}/history`
})

function switchSession(id: string) {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
}

async function deleteSession(id: string) {
  const s = sessions.value[id]
  const label = s?.name || (id as string).slice(0, 8) + '…'
  if (!window.confirm(t('chat.confirm_delete_session', { name: label }))) return
  try {
    await apiFetch(`/api/settings/sessions/${encodeURIComponent(id)}`, 'DELETE')
    if (s?.saver) {
      await apiFetch(`/api/savers/${encodeURIComponent(s.saver)}/threads/${encodeURIComponent(sessionThreadId(id))}/history`, 'DELETE').catch(() => {})
    }
    if (store.settings.sessions) delete store.settings.sessions[id]
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
    Object.assign(store.settings.sessions![targetId], patch)
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

// ── WebSocket ──
const chatSocket = useChatSocket()
const pendingDones = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()

async function handleWsMessage(evt: WebChatEvent & { threadId?: string }) {
  const threadId = evt.threadId
  // Done/Error: resolve pending promise for any session
  if (threadId && (evt.type === WebChatEventType.Done || evt.type === WebChatEventType.Error)) {
    const pending = pendingDones.get(threadId)
    if (pending) {
      pendingDones.delete(threadId)
      if (evt.type === WebChatEventType.Done) pending.resolve()
      else pending.reject(new Error((evt as any).message))
    }
  }
  // Display events: only for active session
  const expectedThreadId = activeSessionId.value ? sessionThreadId(activeSessionId.value) : undefined
  if (threadId && threadId !== expectedThreadId) return
  await chatAreaRef.value?.handleWsEvent(evt)
}

watch(chatSocket.connected, (val, oldVal) => {
  if (!val && oldVal && pendingDones.size > 0) {
    show(t('chat.ws_reconnecting'), 'error')
    chatAreaRef.value?.reset()
    for (const [, p] of pendingDones) p.reject(new Error(t('chat.ws_reconnecting')))
    pendingDones.clear()
  }
})

async function onPanelSend(query: string, atts: Attachment[]) {
  if (!activeSessionId.value) { show(t('chat.no_session'), 'error'); return }
  if (!effectiveSaver.value) { show(t('chat.no_saver'), 'error'); return }
  if (!query && atts.length === 0) return
  await sendOne(query, atts)
}

async function sendOne(query: string, atts: Attachment[]) {
  chatAreaRef.value?.setSending(true)
  const threadId = sessionThreadId(activeSessionId.value!)
  try {
    await chatSocket.waitForOpen()
    const donePromise = new Promise<void>((resolve, reject) => {
      pendingDones.set(threadId, { resolve, reject })
    })
    chatSocket.send({
      type: WsCommandType.Query,
      query,
      threadId,
      sessionId: activeSessionId.value!,
      attachments: atts.length ? atts : undefined,
    })
    await donePromise
  } catch (e: any) {
    chatAreaRef.value?.reset()
    show(e.message, 'error')
  } finally {
    pendingDones.delete(threadId)
    chatAreaRef.value?.setSending(false)
  }
}

async function fetchAndRestoreSessionStatus(sessionId: string | null) {
  if (!sessionId) { chatAreaRef.value?.restoreSessionStatus(null); return }
  try {
    const res = await apiFetch(`/api/session-status?sessionId=${encodeURIComponent(sessionId)}`)
    chatAreaRef.value?.restoreSessionStatus(res ?? null)
  } catch {
    chatAreaRef.value?.restoreSessionStatus(null)
  }
}

watch(activeSessionId, (id) => fetchAndRestoreSessionStatus(id))

onMounted(() => {
  chatSocket.onMessage(handleWsMessage)
  const ids = Object.keys(sessions.value)
  if (ids.length > 0 && !activeSessionId.value) {
    activeSessionId.value = ids[0]
  }
})

onUnmounted(() => {
  chatSocket.offMessage(handleWsMessage)
  chatAreaRef.value?.cleanup()
})
</script>

<template>
  <div style="height:100%;display:flex;overflow:hidden">

    <!-- Session sidebar (left, full height) -->
    <div style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
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
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

      <!-- Toolbar -->
      <div class="page-toolbar">
        <template v-if="activeSessionId">
          <!-- Agent -->
          <label class="toolbar-label">Agent</label>
          <select
            class="toolbar-select-sm"
            :value="effectiveAgent"
            @change="saveSession({ agent: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>

          <!-- Saver -->
          <label class="toolbar-label">{{ t('common.storage') }}</label>
          <select
            class="toolbar-select-sm"
            :value="effectiveSaver || ''"
            @change="saveSession({ saver: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <button v-if="effectiveSaver" class="chat-info-chip" @click="saverViewModal?.open(effectiveSaver!, saverOptions.find(s => s.id === effectiveSaver)?.label || effectiveSaver!, sessionThreadId(activeSessionId))">{{ t('common.view') }}</button>

          <!-- Memory -->
          <label class="toolbar-label">{{ t('common.memory') }}</label>
          <MultiSelect
            :model-value="effectiveMemories"
            :options="memoryOptions"
            compact
            style="min-width:140px"
            @update:model-value="saveSession({ memories: $event })"
          />
          <template v-for="mid in effectiveMemories" :key="mid">
            <button class="chat-info-chip" @click="memoryViewModal?.open(mid, store.settings.memories?.[mid] ?? {}, store.settings.memories?.[mid]?.share ? undefined : sessionThreadId(activeSessionId!))">{{ memoryOptions.find(m => m.id === mid)?.label || t('common.view') }}</button>
          </template>
        </template>
        <span v-else style="font-size:13px;color:#94a3b8">{{ t('chat.select_or_create') }}</span>
        <button class="btn-outline btn-sm" style="margin-left:auto" @click="chatAreaRef?.refreshHistory()">{{ t('common.refresh') }}</button>
        <button class="btn-danger btn-sm" :disabled="!effectiveSaver" @click="chatAreaRef?.clearHistory()">{{ t('chat.clear_history') }}</button>
      </div>

      <ChatArea
        ref="chatAreaRef"
        :history-url="historyUrl"
        :show-attachments="true"
        :cancel-thread-id="activeSessionId ? sessionThreadId(activeSessionId) : undefined"
        @send="onPanelSend"
      />
    </div>

    <SaverViewModal ref="saverViewModal" />
    <MemoryViewModal ref="memoryViewModal" />
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
</style>
