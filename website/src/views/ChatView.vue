<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChatMessage, ToolCall } from '@/types'
import SaverViewModal from './SaverViewModal.vue'
import MemoryViewModal from './MemoryViewModal.vue'
import NewSessionModal from './NewSessionModal.vue'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const { show } = useToast()

// ── Reactive state ──
const messages = ref<ChatMessage[]>([])
const chatInput = ref('')
const chatSending = ref(false)
const chatQueue = ref<string[]>([])
const messagesEl = ref<HTMLElement | null>(null)
const attachments = ref<Attachment[]>([])
const fileInputEl = ref<HTMLInputElement | null>(null)

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
      await apiFetch(`/api/savers/${encodeURIComponent(s.saver)}/threads/session_${encodeURIComponent(id)}/history`, 'DELETE').catch(() => {})
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
let ws: WebSocket | null = null
let doneResolve: (() => void) | null = null
let doneReject: ((e: Error) => void) | null = null

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/chat`
}

function bindWsHandlers(socket: WebSocket) {
  socket.onmessage = async (event: MessageEvent) => {
    let evt: any
    try { evt = JSON.parse(event.data as string) } catch { return }

    if (evt.type === 'stream') {
      streamingContent.value = evt.content
      await nextTick()
      scrollToBottom()
    } else if (evt.type === 'tool_call') {
      streamingToolCalls.value.push({ name: evt.name, args: evt.args })
      await nextTick()
      scrollToBottom()
    } else if (evt.type === 'done') {
      isStreaming.value = false
      await refreshHistory()
      doneResolve?.()
      doneResolve = null
      doneReject = null
    } else if (evt.type === 'error') {
      isStreaming.value = false
      show(evt.message, 'error')
      doneReject?.(new Error(evt.message))
      doneResolve = null
      doneReject = null
    }
  }
  socket.onclose = () => { if (ws === socket) ws = null }
  socket.onerror = () => {
    show('WebSocket 连接错误', 'error')
    doneReject?.(new Error('WebSocket 连接错误'))
    doneResolve = null
    doneReject = null
  }
}

function ensureWs(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(getWsUrl())
    socket.onopen = () => { ws = socket; bindWsHandlers(socket); resolve() }
    socket.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
}

function saverThreadUrl(saver: string): string | null {
  if (!activeSessionId.value) return null
  return `/api/savers/${encodeURIComponent(saver)}/threads/session_${encodeURIComponent(activeSessionId.value)}/history`
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
    scrollToBottom()
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

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

// ── Attachments ──
function pickFile() {
  fileInputEl.value?.click()
}

async function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    if (attachments.value.find(a => a.name === file.name)) continue
    const att = await readFile(file)
    attachments.value.push(att)
  }
  ;(e.target as HTMLInputElement).value = ''
}

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    if (file.type.startsWith('image/')) {
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
      reader.readAsDataURL(file)
    } else {
      reader.onload = () => resolve({ name: file.name, type: file.type, content: reader.result as string })
      reader.readAsText(file)
    }
  })
}

function removeAttachment(idx: number) {
  attachments.value.splice(idx, 1)
}

function isImage(att: Attachment) {
  return att.type.startsWith('image/')
}

// ── Chat input ──
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

async function send() {
  if (!activeSessionId.value) { show('请先选择或新建会话', 'error'); return }
  const saver = effectiveSaver.value
  if (!saver) { show('未配置会话存储', 'error'); return }
  const query = chatInput.value.trim()
  if (!query && attachments.value.length === 0) return
  chatInput.value = ''
  const atts = attachments.value.splice(0)

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
  scrollToBottom()

  try {
    await ensureWs()
    const donePromise = new Promise<void>((resolve, reject) => {
      doneResolve = resolve
      doneReject = reject
    })
    ws!.send(JSON.stringify({
      type: 'message',
      query,
      sessionId: activeSessionId.value!,
      attachments: atts.length ? atts : undefined,
    }))
    await donePromise
  } catch (e: any) {
    isStreaming.value = false
    show(e.message, 'error')
  } finally {
    chatSending.value = false
  }
}

function fmtTs(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return time
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
  } catch { return '' }
}

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

function renderMd(content: string): string {
  return marked.parse(content) as string
}

onMounted(() => {
  const ids = Object.keys(sessions.value)
  if (ids.length > 0 && !activeSessionId.value) {
    activeSessionId.value = ids[0]
  }
  refreshHistory()
})

onUnmounted(() => {
  ws?.close()
  ws = null
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
          <button v-if="effectiveSaver" class="chat-info-chip" @click="saverViewModal?.open(effectiveSaver!, 'session_' + activeSessionId)">查看</button>

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

      <!-- Chat area -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div ref="messagesEl" style="flex:1;overflow-y:auto">
          <div class="history-messages">
            <template v-if="messages.length === 0 && !isStreaming">
              <div style="text-align:center;color:#94a3b8;padding:60px">暂无历史记录</div>
            </template>

            <template v-for="(msg, idx) in messages" :key="idx">
              <template v-if="!(msg.role === 'tool' && msg.tool_call_id)">
                <div v-if="msg.role === 'human'" class="msg-row human">
                  <div class="msg-bubble human">
                    <div class="msg-role-bar">
                      <span class="msg-role">用户</span>
                      <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                    </div>
                    {{ msg.content }}
                  </div>
                </div>
                <div v-else-if="msg.role === 'ai'" class="msg-row ai">
                  <div v-if="msg.content" class="msg-bubble ai">
                    <div class="msg-role-bar">
                      <span class="msg-role">AI</span>
                      <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                    </div>
                    <div class="md-content" v-html="renderMd(msg.content)" />
                  </div>
                  <div v-if="msg.tool_calls && msg.tool_calls.length > 0" class="msg-tool-calls">
                    <div class="msg-role">Tool Calls ({{ msg.tool_calls.length }})</div>
                    <div v-for="tc in msg.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
                      <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                        <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                      </div>
                      <div class="tool-call-detail">
                        <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                        <template v-for="m2 in messages" :key="'r' + (m2.tool_call_id || '')">
                          <div v-if="m2.role === 'tool' && m2.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                            <div class="tool-call-result-label">返回结果</div>
                            {{ m2.content }}
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else-if="msg.role === 'tool'" class="msg-row ai">
                  <div class="msg-bubble tool">
                    <div class="msg-role-bar">
                      <span class="msg-role">Tool{{ msg.name ? ` · ${msg.name}` : '' }}</span>
                    </div>
                    {{ msg.content }}
                  </div>
                </div>
                <div v-else class="msg-row ai">
                  <div class="msg-bubble ai">
                    <div class="msg-role-bar">
                      <span class="msg-role">{{ msg.role }}</span>
                      <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                    </div>
                    {{ msg.content }}
                  </div>
                </div>
              </template>
            </template>

            <div v-if="isStreaming" class="msg-row ai">
              <div class="msg-bubble ai streaming">
                <div class="msg-role-bar"><span class="msg-role">AI</span></div>
                <div v-if="streamingContent" class="md-content" v-html="renderMd(streamingContent)" />
                <span v-else style="color:#94a3b8">思考中…</span>
              </div>
              <div v-for="(tc, i) in streamingToolCalls" :key="i" class="msg-tool-calls">
                <div class="msg-role">Tool Call</div>
                <div class="tool-call-item">
                  <div class="tool-call-header expanded" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                    <span class="tool-call-name">{{ tc.name }}</span>
                  </div>
                  <div class="tool-call-detail show">
                    <div class="tool-call-args">{{ JSON.stringify(tc.args, null, 2) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Queue -->
        <div v-if="chatQueue.length > 0" class="chat-queue" style="display:flex">
          <div class="chat-queue-label">待发送（{{ chatQueue.length }}）</div>
          <div v-for="(q, i) in chatQueue" :key="i" class="chat-queue-item">
            <span class="chat-queue-text">{{ q }}</span>
            <button class="chat-queue-del" @click="chatQueue.splice(i, 1)">×</button>
          </div>
        </div>

        <!-- Input bar -->
        <div class="chat-input-bar">
          <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
          <div style="flex:1;display:flex;flex-direction:column;gap:6px">
            <div v-if="attachments.length > 0" style="display:flex;flex-wrap:wrap;gap:6px">
              <div
                v-for="(att, i) in attachments"
                :key="att.name"
                style="display:flex;align-items:center;gap:4px;padding:2px 8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;font-size:12px;color:#475569;max-width:200px"
              >
                <img v-if="isImage(att) && att.dataUrl" :src="att.dataUrl"
                  style="width:18px;height:18px;object-fit:cover;border-radius:2px;flex-shrink:0" />
                <span v-else style="font-size:13px;flex-shrink:0">📄</span>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ att.name }}</span>
                <button @click="removeAttachment(i)"
                  style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:14px;padding:0;line-height:1;flex-shrink:0">×</button>
              </div>
            </div>
            <textarea
              v-model="chatInput"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
              rows="3"
              @keydown="onKeydown"
              @input="autoResize"
              style="resize:none"
            />
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
            <button class="btn-outline btn-sm" @click="pickFile" title="添加附件">附件</button>
            <button class="btn-primary" :disabled="chatSending" @click="send">发送</button>
          </div>
        </div>
      </div>
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
.session-item-sub {
  font-size: 11px;
  color: #9b9b9b;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
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
.toolbar-label {
  font-size: 12px;
  color: #9b9b9b;
  white-space: nowrap;
}
.toolbar-select-sm {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: #fff;
  color: #1e293b;
  cursor: pointer;
  max-width: 120px;
}
.toolbar-select-sm:focus { outline: none; border-color: #1c1c1c; }
</style>
