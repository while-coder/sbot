<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChatMessage, ToolCall } from '@/types'
import SaverViewModal from './SaverViewModal.vue'
import MemoryViewModal from './MemoryViewModal.vue'

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

// streaming state
const streamingContent = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])
const isStreaming = ref(false)

// ── Session sidebar ──
const activeSessionId = ref<string | null>(null)
const sessions = computed(() => store.settings.sessions || {})

const agentNames = computed(() => Object.keys(store.settings.agents || {}))
const currentAgent = ref('')

// Effective agent/saver/memory: session overrides current agent selection
const effectiveAgent  = computed(() => activeSessionId.value ? sessions.value[activeSessionId.value]?.agent : currentAgent.value)
const effectiveSaver  = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.saver || null) : null)
const effectiveMemory = computed(() => activeSessionId.value ? (sessions.value[activeSessionId.value]?.memory || null) : null)

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

async function refreshHistory() {
  const saver = effectiveSaver.value
  if (!saver) { messages.value = []; return }
  try {
    const res = await apiFetch(`/api/savers/${encodeURIComponent(saver)}/history`)
    messages.value = res.data || []
    await nextTick()
    scrollToBottom()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function selectSession(id: string | null) {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  await refreshHistory()
}

function switchAgent(name: string) {
  if (!name || name === currentAgent.value) return
  currentAgent.value = name
  activeSessionId.value = null
  refreshHistory()
}

async function clearHistory() {
  const saver = effectiveSaver.value
  if (!saver || !confirm(`确定要清除存储 "${saver}" 的所有历史记录吗？`)) return
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saver)}/history`, 'DELETE')
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
      sessionId: activeSessionId.value ?? undefined,
      agentName: activeSessionId.value ? undefined : (currentAgent.value || undefined),
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


onMounted(refreshHistory)

onUnmounted(() => {
  ws?.close()
  ws = null
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <template v-if="!activeSessionId">
        <label style="color:#64748b;font-size:13px;margin:0">Agent:</label>
        <select
          :value="currentAgent"
          @change="switchAgent(($event.target as HTMLSelectElement).value)"
          style="font-size:13px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#1e293b;cursor:pointer"
        >
          <option v-if="agentNames.length === 0" value="">(无 Agent)</option>
          <option v-for="name in agentNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </template>
      <template v-else>
        <span style="font-size:13px;font-weight:600;color:#1c1c1c">{{ sessions[activeSessionId]?.name || (activeSessionId as string).slice(0, 8) + '…' }}</span>
        <span style="font-size:12px;color:#9b9b9b;font-family:monospace">{{ effectiveAgent }}</span>
      </template>
      <button v-if="effectiveSaver" class="chat-info-chip" @click="saverViewModal?.open(effectiveSaver!)">
        存储: {{ effectiveSaver }}
      </button>
      <span v-else style="color:#c4c4c0;font-size:12px">未配置存储</span>
      <button v-if="effectiveMemory" class="chat-info-chip" @click="memoryViewModal?.open(effectiveMemory!)">
        记忆: {{ effectiveMemory }}
      </button>
      <button class="btn-outline btn-sm" style="margin-left:auto" @click="refreshHistory">刷新</button>
      <button class="btn-danger btn-sm" @click="clearHistory">清除历史</button>
    </div>

    <!-- Body: session sidebar + chat area -->
    <div style="flex:1;display:flex;overflow:hidden">

      <!-- Session sidebar -->
      <div style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
        <div style="padding:8px 10px;font-size:11px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e8e6e3;flex-shrink:0">
          Sessions
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px">
          <div
            class="session-item"
            :class="{ active: activeSessionId === null }"
            @click="selectSession(null)"
          >
            <div class="session-item-name">默认</div>
            <div class="session-item-sub">{{ currentAgent || '未选择' }}</div>
          </div>
          <div
            v-for="(s, id) in sessions"
            :key="id"
            class="session-item"
            :class="{ active: activeSessionId === id }"
            @click="selectSession(id as string)"
          >
            <div class="session-item-name">{{ s.name || (id as string).slice(0, 8) + '…' }}</div>
            <div class="session-item-sub">{{ s.agent }}</div>
          </div>
        </div>
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
</style>
