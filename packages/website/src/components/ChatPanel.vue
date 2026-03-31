<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { MessageRole } from '@/types'
import type { ChatMessage, ToolCall } from '@/types'

const { t } = useI18n()

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
  queuedMessages?: string[]
  showAttachments?: boolean
  emptyText?: string
  onCancel?: () => void
}>(), {
  showAttachments: false,
  emptyText: '',
})

const emit = defineEmits<{
  send: [query: string, attachments: Attachment[]]
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

// ── Paste ──
async function onPaste(e: ClipboardEvent) {
  if (!props.showAttachments) return
  const items = Array.from(e.clipboardData?.items ?? [])
  const fileItems = items.filter(i => i.kind === 'file')
  if (fileItems.length === 0) return
  e.preventDefault()
  for (const item of fileItems) {
    const file = item.getAsFile()
    if (!file) continue
    const name = file.name && file.name !== 'image.png' ? file.name
      : `paste-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
    const namedFile = new File([file], name, { type: file.type })
    if (attachments.value.find(a => a.name === namedFile.name)) continue
    attachments.value.push(await readFile(namedFile))
  }
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
          <div style="text-align:center;color:#94a3b8;padding:60px">{{ emptyText || t('chat.no_history') }}</div>
        </template>

        <template v-for="(msg, idx) in messages" :key="idx">
          <template v-if="msg.role !== MessageRole.Tool">
            <div v-if="msg.role === MessageRole.Human" class="msg-row human">
              <div class="msg-bubble human">
                <div class="msg-role-bar">
                  <span class="msg-role">{{ t('chat.role_user') }}</span>
                  <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                </div>
                {{ msg.content }}
              </div>
            </div>
            <div v-else-if="msg.role === MessageRole.AI" class="msg-row ai">
              <div v-if="msg.content" class="msg-bubble ai">
                <div class="msg-role-bar">
                  <span class="msg-role">{{ t('chat.role_ai') }}</span>
                  <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                </div>
                <div class="md-content" v-html="renderMd(msg.content)" />
              </div>
              <div v-if="msg.tool_calls && msg.tool_calls.length > 0" class="msg-tool-calls">
                <div class="msg-role">{{ t('chat.tool_calls', { count: msg.tool_calls.length }) }}</div>
                <div v-for="tc in msg.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
                  <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                    <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                  </div>
                  <div class="tool-call-detail">
                    <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                    <template v-for="m2 in messages" :key="'r' + (m2.tool_call_id || '')">
                      <div v-if="m2.role === MessageRole.Tool && m2.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                        <div class="tool-call-result-label">{{ t('chat.tool_result') }}</div>
                        <div class="md-content tool-result-content" v-html="renderMd(m2.content || '')" />
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
            <div class="msg-role-bar"><span class="msg-role">{{ t('chat.role_ai') }}</span></div>
            <div v-if="streamingContent" class="md-content" v-html="renderMd(streamingContent)" />
            <span v-else style="color:#94a3b8">{{ t('chat.thinking') }}</span>
          </div>
          <div v-for="(tc, i) in streamingToolCalls" :key="i" class="msg-tool-calls">
            <div class="msg-role">{{ t('chat.tool_call') }}</div>
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

        <!-- Queued messages -->
        <div v-for="(q, i) in queuedMessages" :key="'q' + i" class="msg-row human">
          <div class="msg-bubble human queued">
            <div class="msg-role-bar">
              <span class="msg-role">{{ t('chat.role_user') }}</span>
              <span class="msg-queued-tag">{{ t('chat.queued') }}</span>
            </div>
            {{ q }}
          </div>
        </div>
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
          :placeholder="t('chat.input_placeholder')"
          rows="3"
          @keydown="onKeydown"
          @paste="onPaste"
          @input="autoResize"
          style="resize:none;width:100%"
        />
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
        <button v-if="showAttachments" class="btn-outline btn-sm" @click="pickFile" :title="t('chat.add_attachment')">{{ t('chat.attachment') }}</button>
        <button v-if="onCancel && isStreaming" class="btn-danger btn-sm stop-btn" @click="onCancel">■ {{ t('chat.stop') }}</button>
        <button v-else class="btn-primary" :disabled="chatSending" @click="send">{{ t('chat.send') }}</button>
      </div>
    </div>

  </div>
</template>
