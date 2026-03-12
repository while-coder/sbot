<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { marked } from 'marked'
import type { ChatMessage, ToolCall } from '@/types'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  streamingToolCalls: { name: string; args: unknown }[]
  chatSending: boolean
  chatQueue?: string[]
  showAttachments?: boolean
  emptyText?: string
}>(), {
  chatQueue: () => [],
  showAttachments: false,
  emptyText: '暂无历史记录',
})

const emit = defineEmits<{
  send: [query: string, attachments: Attachment[]]
  removeFromQueue: [index: number]
}>()

const chatInput = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const attachments = ref<Attachment[]>([])
const fileInputEl = ref<HTMLInputElement | null>(null)

// ── Scrolling ──
function isAtBottom(): boolean {
  if (!messagesEl.value) return true
  const el = messagesEl.value
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function scrollToBottom(force = false) {
  if (messagesEl.value && (force || isAtBottom())) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

watch(() => props.messages.length, async () => {
  await nextTick()
  scrollToBottom()
})

watch(() => props.streamingContent, async () => {
  await nextTick()
  scrollToBottom()
})

// ── Rendering ──
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

// ── Attachments ──
function pickFile() {
  fileInputEl.value?.click()
}

function isTextMime(type: string) {
  return type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/xhtml+xml'
}

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    if (isTextMime(file.type)) {
      reader.onload = () => resolve({ name: file.name, type: file.type, content: reader.result as string })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
      reader.readAsDataURL(file)
    }
  })
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

function removeAttachment(idx: number) {
  attachments.value.splice(idx, 1)
}

function isImage(att: Attachment) {
  return att.type.startsWith('image/')
}

// ── Input ──
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

function send() {
  const query = chatInput.value.trim()
  const atts = props.showAttachments ? attachments.value.splice(0) : []
  if (!query && atts.length === 0) return
  chatInput.value = ''
  emit('send', query, atts)
}

defineExpose({ scrollToBottom })
</script>

<template>
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

    <!-- Messages -->
    <div ref="messagesEl" style="flex:1;overflow-y:auto">
      <div class="history-messages">
        <template v-if="messages.length === 0 && !isStreaming">
          <div style="text-align:center;color:#94a3b8;padding:60px">{{ emptyText }}</div>
        </template>

        <template v-for="(msg, idx) in messages" :key="idx">
          <template v-if="msg.role !== 'tool'">
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

        <!-- Streaming -->
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
    <div v-if="chatQueue && chatQueue.length > 0" class="chat-queue" style="display:flex">
      <div class="chat-queue-label">待发送（{{ chatQueue.length }}）</div>
      <div v-for="(q, i) in chatQueue" :key="i" class="chat-queue-item">
        <span class="chat-queue-text">{{ q }}</span>
        <button class="chat-queue-del" @click="emit('removeFromQueue', i)">×</button>
      </div>
    </div>

    <!-- Input bar -->
    <div class="chat-input-bar">
      <input v-if="showAttachments" ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div v-if="showAttachments && attachments.length > 0" style="display:flex;flex-wrap:wrap;gap:6px">
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
          style="resize:none;width:100%"
        />
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
        <button v-if="showAttachments" class="btn-outline btn-sm" @click="pickFile" title="添加附件">附件</button>
        <button class="btn-primary" :disabled="chatSending" @click="send">发送</button>
      </div>
    </div>

  </div>
</template>
