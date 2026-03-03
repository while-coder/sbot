<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChatMessage, ToolCall } from '@/types'

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
const saverLabel = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const attachments = ref<Attachment[]>([])
const fileInputEl = ref<HTMLInputElement | null>(null)

// streaming state
const streamingContent = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])
const isStreaming = ref(false)

const agentNames = computed(() => Object.keys(store.settings.agents || {}))
const currentAgent = computed({
  get: () => store.settings.agent || '',
  set: (v) => { store.settings.agent = v },
})

function getChatSaverName() {
  const agent = store.settings.agents?.[store.settings.agent || '']
  return agent?.saver || null
}

async function refreshAgentAndHistory() {
  const saver = getChatSaverName()
  saverLabel.value = saver ? `存储: ${saver}` : '(未配置存储)'
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

async function switchAgent(name: string) {
  if (!name || name === currentAgent.value) return
  try {
    currentAgent.value = name
    await apiFetch('/api/settings', 'PUT', store.settings)
    await refreshAgentAndHistory()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearHistory() {
  const saver = getChatSaverName()
  if (!saver || !confirm(`确定要清除 ${saver} 的所有历史记录吗？`)) return
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saver)}/history`, 'DELETE')
    show('历史已清除')
    await refreshAgentAndHistory()
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
  const saver = getChatSaverName()
  if (!saver) { show('当前 Agent 未配置会话存储', 'error'); return }
  const query = chatInput.value.trim()
  if (!query && attachments.value.length === 0) return
  chatInput.value = ''
  const atts = attachments.value.splice(0)

  if (chatSending.value) {
    chatQueue.value.push(query)
    return
  }
  await sendOne(saver, query, atts)
  await drainQueue()
}

async function drainQueue() {
  while (chatQueue.value.length > 0) {
    const q = chatQueue.value.shift()!
    const saver = getChatSaverName()
    if (!saver) break
    await sendOne(saver, q, [])
  }
}

async function sendOne(userId: string, query: string, atts: Attachment[]) {
  chatSending.value = true
  isStreaming.value = true
  streamingContent.value = ''
  streamingToolCalls.value = []

  // Append user message immediately (show original query + attachment names)
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
    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, attachments: atts.length ? atts : undefined }),
    })
    if (!response.ok) throw new Error(`请求失败: ${response.status}`)

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let evt: any
        try { evt = JSON.parse(line.slice(6)) } catch { continue }

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
          await refreshAgentAndHistory()
        } else if (evt.type === 'error') {
          isStreaming.value = false
          show(evt.message, 'error')
        }
      }
    }
  } catch (e: any) {
    isStreaming.value = false
    show(e.message, 'error')
  } finally {
    chatSending.value = false
  }
}

function fmtTs(ts?: string) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleString() } catch { return '' }
}

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

function renderMd(content: string): string {
  return marked.parse(content) as string
}


onMounted(refreshAgentAndHistory)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <label style="color:#64748b;font-size:13px;margin:0">Agent:</label>
      <select
        :value="currentAgent"
        @change="switchAgent(($event.target as HTMLSelectElement).value)"
        style="font-size:13px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#1e293b;cursor:pointer"
      >
        <option v-if="agentNames.length === 0" value="">(无 Agent)</option>
        <option v-for="name in agentNames" :key="name" :value="name">{{ name }}</option>
      </select>
      <span style="color:#94a3b8;font-size:12px">{{ saverLabel }}</span>
      <button class="btn-outline btn-sm" style="margin-left:auto" @click="refreshAgentAndHistory">刷新</button>
      <button class="btn-danger btn-sm" @click="clearHistory">清除历史</button>
    </div>

    <!-- Message list -->
    <div ref="messagesEl" style="flex:1;overflow-y:auto">
      <div class="history-messages">
        <template v-if="messages.length === 0 && !isStreaming">
          <div style="text-align:center;color:#94a3b8;padding:60px">暂无历史记录</div>
        </template>

        <template v-for="(msg, idx) in messages" :key="idx">
          <template v-if="!(msg.role === 'tool' && msg.tool_call_id)">
            <div v-if="msg.role === 'human'" class="msg-row human">
              <div v-if="msg.timestamp" class="msg-ts">{{ fmtTs(msg.timestamp) }}</div>
              <div class="msg-bubble human">
                <div class="msg-role">用户</div>
                {{ msg.content }}
              </div>
            </div>
            <div v-else-if="msg.role === 'ai'" class="msg-row ai">
              <div v-if="msg.timestamp" class="msg-ts">{{ fmtTs(msg.timestamp) }}</div>
              <div v-if="msg.content" class="msg-bubble ai">
                <div class="msg-role">AI</div>
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
                <div class="msg-role">Tool{{ msg.name ? ` · ${msg.name}` : '' }}</div>
                {{ msg.content }}
              </div>
            </div>
            <div v-else class="msg-row ai">
              <div v-if="msg.timestamp" class="msg-ts">{{ fmtTs(msg.timestamp) }}</div>
              <div class="msg-bubble ai">
                <div class="msg-role">{{ msg.role }}</div>
                {{ msg.content }}
              </div>
            </div>
          </template>
        </template>

        <!-- Streaming AI response -->
        <div v-if="isStreaming" class="msg-row ai">
          <div class="msg-bubble ai streaming">
            <div class="msg-role">AI</div>
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
        <!-- Attachment chips -->
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
</template>
