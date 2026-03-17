<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChatMessage } from '@/types'
import { useChatSocket } from '@/composables/useChatSocket'
import SaverViewModal from './modals/SaverViewModal.vue'
import MemoryViewModal from './modals/MemoryViewModal.vue'
import NewSessionModal from './modals/NewSessionModal.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import { sessionThreadId } from 'sbot.commons'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const { show } = useToast()

// ── Reactive state ──
const messages = ref<ChatMessage[]>([])
const chatSending = ref(false)
const chatQueue = ref<string[]>([])
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()
const newSessionModal = ref<InstanceType<typeof NewSessionModal>>()
const sessionNameInputEl = ref<HTMLInputElement | null>(null)

// ── Sidebar inline name edit ──
const editingSessionId   = ref<string | null>(null)
const editingSessionName = ref('')

// streaming state
const streamingContent = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])
const isStreaming = ref(false)

// tool approval state
const pendingToolCall = ref<{ id: string; name: string; args: Record<string, any> } | null>(null)

function approveToolCall(approval: string) {
  if (!pendingToolCall.value) return
  const id = pendingToolCall.value.id
  pendingToolCall.value = null
  apiFetch('/api/tool-approval', 'POST', { id, approval }).catch(() => {})
}

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
const effectiveMemory = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.memory || null) : null)

function switchSession(id: string) {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  messages.value = []
  refreshHistory()
}

async function deleteSession(id: string) {
  const s = sessions.value[id]
  const label = s?.name || (id as string).slice(0, 8) + '…'
  if (!confirm(`确定要删除会话 "${label}" 吗？`)) return
  try {
    await apiFetch(`/api/settings/sessions/${encodeURIComponent(id)}`, 'DELETE')
    if (s?.saver) {
      await apiFetch(`/api/savers/${encodeURIComponent(s.saver)}/threads/${encodeURIComponent(sessionThreadId(id))}/history`, 'DELETE').catch(() => {})
    }
    if (store.settings.sessions) delete store.settings.sessions[id]
    if (activeSessionId.value === id) {
      const remaining = Object.keys(sessions.value)
      activeSessionId.value = remaining.length > 0 ? remaining[0] : null
      messages.value = []
      await refreshHistory()
    }
    show('会话已删除')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function onSessionCreated(id: string) {
  activeSessionId.value = id
  messages.value = []
  refreshHistory()
}

async function saveSession(patch: Record<string, any>, id?: string) {
  const targetId = id ?? activeSessionId.value
  if (!targetId) return
  try {
    const current = { ...sessions.value[targetId] }
    const updated = { ...current, ...patch }
    if (updated.memory === '' || updated.memory === undefined) delete updated.memory
    await apiFetch(`/api/settings/sessions/${encodeURIComponent(targetId)}`, 'PUT', updated)
    Object.assign(store.settings.sessions![targetId], patch)
    if ((patch.memory === '' || patch.memory === undefined) && store.settings.sessions![targetId].memory !== undefined) {
      delete store.settings.sessions![targetId].memory
    }
    if ('saver' in patch && targetId === activeSessionId.value) refreshHistory()
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
let doneResolve: (() => void) | null = null
let doneReject: ((e: Error) => void) | null = null

async function handleWsMessage(evt: any) {
  if (evt.sessionId && evt.sessionId !== activeSessionId.value) return
  if (evt.type === 'stream') {
    streamingContent.value = evt.content
  } else if (evt.type === 'message') {
    messages.value.push({
      role: evt.role,
      content: evt.content,
      tool_calls: evt.tool_calls,
      tool_call_id: evt.tool_call_id,
      timestamp: new Date().toISOString(),
    })
    streamingContent.value = ''
    streamingToolCalls.value = []
  } else if (evt.type === 'tool_call') {
    const tcId = evt.id ?? `tc-${Date.now()}`
    pendingToolCall.value = { id: tcId, name: evt.name, args: evt.args }
  } else if (evt.type === 'done') {
    isStreaming.value = false
    pendingToolCall.value = null
    await refreshHistory()
    doneResolve?.()
    doneResolve = null
    doneReject = null
  } else if (evt.type === 'error') {
    isStreaming.value = false
    pendingToolCall.value = null
    show(evt.message, 'error')
    doneReject?.(new Error(evt.message))
    doneResolve = null
    doneReject = null
  }
}

watch(chatSocket.connected, (val, oldVal) => {
  if (!val && oldVal && doneReject) {
    show('WebSocket 连接断开，正在重连…', 'error')
    isStreaming.value = false
    doneReject(new Error('WebSocket 连接断开'))
    doneResolve = null
    doneReject = null
  }
})

function saverThreadUrl(saver: string): string | null {
  if (!activeSessionId.value) return null
  return `/api/savers/${encodeURIComponent(saver)}/threads/${encodeURIComponent(sessionThreadId(activeSessionId.value))}/history`
}

async function refreshHistory() {
  const saver = effectiveSaver.value
  if (!saver) { messages.value = []; return }
  const url = saverThreadUrl(saver)
  if (!url) { messages.value = []; return }
  try {
    const res = await apiFetch(url)
    messages.value = res.data || []
    await nextTick()
    chatPanelRef.value?.scrollToBottom()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearHistory() {
  const saver = effectiveSaver.value
  if (!saver || !confirm('确定要清除当前会话的历史记录吗？')) return
  const url = saverThreadUrl(saver)
  if (!url) return
  try {
    await apiFetch(url, 'DELETE')
    show('历史已清除')
    await refreshHistory()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function onPanelSend(query: string, atts: Attachment[]) {
  if (!activeSessionId.value) { show('请先选择或新建会话', 'error'); return }
  const saver = effectiveSaver.value
  if (!saver) { show('未配置会话存储', 'error'); return }
  if (!query && atts.length === 0) return

  if (chatSending.value) {
    chatQueue.value.push(query)
    return
  }
  await sendOne(query, atts)
  await drainQueue()
}

async function drainQueue() {
  while (chatQueue.value.length > 0) {
    const q = chatQueue.value.shift()!
    await sendOne(q, [])
  }
}

async function sendOne(query: string, atts: Attachment[]) {
  chatSending.value = true
  isStreaming.value = true
  streamingContent.value = ''
  streamingToolCalls.value = []

  const displayContent = [
    query,
    ...atts.map(a => `[附件: ${a.name}]`),
  ].filter(Boolean).join('\n')
  messages.value.push({
    role: 'human',
    content: displayContent,
    timestamp: new Date().toISOString(),
  })
  await nextTick()
  chatPanelRef.value?.scrollToBottom(true)

  try {
    await chatSocket.waitForOpen()
    const donePromise = new Promise<void>((resolve, reject) => {
      doneResolve = resolve
      doneReject = reject
    })
    chatSocket.send({
      query,
      sessionId: activeSessionId.value!,
      attachments: atts.length ? atts : undefined,
    })
    await donePromise
  } catch (e: any) {
    isStreaming.value = false
    show(e.message, 'error')
  } finally {
    chatSending.value = false
  }
}

onMounted(() => {
  chatSocket.onMessage(handleWsMessage)
  const ids = Object.keys(sessions.value)
  if (ids.length > 0 && !activeSessionId.value) {
    activeSessionId.value = ids[0]
  }
  refreshHistory()
})

onUnmounted(() => {
  chatSocket.offMessage(handleWsMessage)
})
</script>

<template>
  <div style="height:100%;display:flex;overflow:hidden">

    <!-- Session sidebar (left, full height) -->
    <div style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
      <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
        <button class="btn-outline btn-sm" style="width:100%" @click="newSessionModal?.open()">+ 新建会话</button>
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
          暂无会话<br>点击上方新建
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
          <label class="toolbar-label">存储</label>
          <select
            class="toolbar-select-sm"
            :value="effectiveSaver || ''"
            @change="saveSession({ saver: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <button v-if="effectiveSaver" class="chat-info-chip" @click="saverViewModal?.open(effectiveSaver!, sessionThreadId(activeSessionId))">查看</button>

          <!-- Memory -->
          <label class="toolbar-label">记忆</label>
          <select
            class="toolbar-select-sm"
            :value="effectiveMemory || ''"
            @change="saveSession({ memory: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">(不使用)</option>
            <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <button v-if="effectiveMemory" class="chat-info-chip" @click="memoryViewModal?.open(effectiveMemory!)">查看</button>
        </template>
        <span v-else style="font-size:13px;color:#94a3b8">请选择或新建会话</span>
        <button class="btn-outline btn-sm" style="margin-left:auto" @click="refreshHistory">刷新</button>
        <button class="btn-danger btn-sm" :disabled="!effectiveSaver" @click="clearHistory">清除历史</button>
      </div>

      <!-- Tool approval bar -->
      <div v-if="pendingToolCall" class="tool-approval-bar">
        <span class="tool-approval-label">执行工具：<strong>{{ pendingToolCall.name }}</strong></span>
        <div class="tool-approval-btns">
          <button class="btn-primary btn-sm" @click="approveToolCall('allow')">允许</button>
          <button class="btn-outline btn-sm" @click="approveToolCall('alwaysArgs')">总是允许（相同参数）</button>
          <button class="btn-outline btn-sm" @click="approveToolCall('alwaysTool')">总是允许（所有参数）</button>
          <button class="btn-danger btn-sm" @click="approveToolCall('deny')">拒绝</button>
        </div>
      </div>

      <ChatPanel
        ref="chatPanelRef"
        :messages="messages"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :streaming-tool-calls="streamingToolCalls"
        :chat-sending="chatSending"
        :chat-queue="chatQueue"
        :show-attachments="true"
        @send="onPanelSend"
        @remove-from-queue="chatQueue.splice($event, 1)"
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
.tool-approval-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #fffbeb;
  border-bottom: 1px solid #fcd34d;
  flex-shrink: 0;
  font-size: 13px;
}
.tool-approval-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-approval-btns  { display: flex; gap: 6px; flex-shrink: 0; }
</style>
