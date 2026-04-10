<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { MessageRole } from '@/types'
import type { StoredMessage, ToolCall } from '@/types'
import { inlineArgs, resultPreview } from '@/utils/toolCallFormat'
import ThinkDrawer from './ThinkDrawer.vue'
import ImageLightbox from './ImageLightbox.vue'
import RichInput from './RichInput.vue'

const { t } = useI18n()

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  isStreaming: boolean
  streamingContent: string | any[]
  queuedMessages?: (string | any[])[]
  showAttachments?: boolean
  onCancel?: () => void
  thinksUrlPrefix?: string | null
}>(), {
  showAttachments: false,
  thinksUrlPrefix: null,
})

const emit = defineEmits<{
  send: [query: string, attachments: Attachment[]]
}>()

const richInputRef = ref<InstanceType<typeof RichInput>>()
const messagesEl = ref<HTMLElement | null>(null)
const attachments = ref<Attachment[]>([])
const fileInputEl = ref<HTMLInputElement | null>(null)

// ── Image lightbox ──
const lightboxRef = ref<InstanceType<typeof ImageLightbox>>()

function openLightbox(src: string) {
  lightboxRef.value?.open(src)
}

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
function fmtTs(ts?: number) {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
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

function renderMd(content: string | any[] | undefined | null): string {
  if (!content) return ''
  if (Array.isArray(content)) {
    // LangChain multi-part content: extract text parts only (images handled separately)
    return marked.parse(
      content
        .filter((c: any) => typeof c === 'string' || c?.type === 'text')
        .map((c: any) => (typeof c === 'string' ? c : c.text ?? ''))
        .join('\n')
    ) as string
  }
  return marked.parse(content) as string
}

function getImages(content: string | any[] | undefined | null): string[] {
  if (!Array.isArray(content)) return []
  const urls: string[] = []
  for (const c of content) {
    if (c?.type === 'image_url' && c.image_url?.url) {
      urls.push(c.image_url.url)
    } else if (c?.type === 'inlineData' && c.inlineData?.data) {
      urls.push(`data:${c.inlineData.mimeType};base64,${c.inlineData.data}`)
    }
  }
  return urls
}

// ── Think drawer ──
const thinkDrawerRef = ref<InstanceType<typeof ThinkDrawer>>()

function openThink(thinkId: string) {
  thinkDrawerRef.value?.open(thinkId)
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
function send() {
  if (!richInputRef.value) return
  const { text, images } = richInputRef.value.getContent()
  const fileAtts = props.showAttachments ? attachments.value.splice(0) : []
  const allAtts = [...images, ...fileAtts]
  if (!text.trim() && allAtts.length === 0) return
  richInputRef.value.clear()
  emit('send', text.trim(), allAtts)
}

defineExpose({ scrollToBottom })
</script>

<template>
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

    <!-- Messages -->
    <div ref="messagesEl" style="flex:1;overflow-y:auto">
      <div class="history-messages">
        <template v-if="messages.length === 0 && !isStreaming">
          <div style="text-align:center;color:#94a3b8;padding:60px">{{ t('chat.no_history') }}</div>
        </template>

        <template v-for="(msg, idx) in messages" :key="idx">
          <template v-if="msg.message.role !== MessageRole.Tool">
            <div v-if="msg.message.role === MessageRole.Human" class="msg-row human">
              <div class="msg-bubble human">
                <div class="msg-role-bar">
                  <span class="msg-role">{{ t('chat.role_user') }}</span>
                  <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
                  <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle think-toggle-human" @click="openThink(msg.thinkId!)">
                    <span>▸</span>
                    <span>{{ t('chat.think') }}</span>
                  </div>
                </div>
                <div class="md-content" v-html="renderMd(msg.message.content)" />
                <div v-for="(src, imgIdx) in getImages(msg.message.content)" :key="imgIdx" class="inline-image">
                  <img :src="src" class="inline-image-thumb" @click="openLightbox(src)" />
                </div>
              </div>
            </div>
            <div v-else-if="msg.message.role === MessageRole.AI" class="msg-row ai">
              <div v-if="msg.message.content" class="msg-bubble ai">
                <div class="msg-role-bar">
                  <span class="msg-role">{{ t('chat.role_ai') }}</span>
                  <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
                  <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                    <span>▸</span>
                    <span>{{ t('chat.think') }}</span>
                  </div>
                </div>
                <div class="md-content" v-html="renderMd(msg.message.content)" />
                <div v-for="(img, imgIdx) in getImages(msg.message.content)" :key="imgIdx" class="inline-image">
                  <img :src="img" class="inline-image-thumb" @click="openLightbox(img)" />
                </div>
              </div>
              <div v-if="msg.message.tool_calls && msg.message.tool_calls.length > 0" class="msg-tool-calls">
                <div class="msg-role has-think">
                  {{ t('chat.tool_calls', { count: msg.message.tool_calls.length }) }}
                  <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                    <span>▸</span>
                    <span>{{ t('chat.think') }}</span>
                  </div>
                </div>
                <div v-for="tc in msg.message.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
                  <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                    <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                    <span v-if="inlineArgs(tc as ToolCall)" class="tool-call-inline-args">{{ inlineArgs(tc as ToolCall) }}</span>
                    <span v-if="resultPreview(messages, (tc as ToolCall).id)" class="tool-call-result-preview">↳ {{ resultPreview(messages, (tc as ToolCall).id) }}</span>
                  </div>
                  <div class="tool-call-detail">
                    <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                    <template v-for="m2 in messages" :key="'r' + (m2.message.tool_call_id || '')">
                      <div v-if="m2.message.role === MessageRole.Tool && m2.message.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                        <div class="tool-call-result-top">
                          <div class="tool-call-result-label">{{ t('chat.tool_result') }}</div>
                          <div v-if="m2.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(m2.thinkId!)">
                            <span>▸</span>
                            <span>{{ t('chat.think') }}</span>
                          </div>
                        </div>
                        <div class="md-content tool-result-content" v-html="renderMd(m2.message.content || '')" />
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="msg-row ai">
              <div class="msg-bubble ai">
                <div class="msg-role-bar">
                  <span class="msg-role">{{ msg.message.role }}</span>
                  <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
                </div>
                <div class="md-content" v-html="renderMd(msg.message.content)" />
                <div v-for="(src, imgIdx) in getImages(msg.message.content)" :key="imgIdx" class="inline-image">
                  <img :src="src" class="inline-image-thumb" @click="openLightbox(src)" />
                </div>
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
            <div v-for="(img, imgIdx) in getImages(streamingContent)" :key="imgIdx" class="inline-image">
              <img :src="img" class="inline-image-thumb" @click="openLightbox(img)" />
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
            <div class="md-content" v-html="renderMd(q)" />
            <div v-for="(img, imgIdx) in getImages(q)" :key="imgIdx" class="inline-image">
              <img :src="img" class="inline-image-thumb" @click="openLightbox(img)" />
            </div>
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
        <RichInput
          ref="richInputRef"
          :placeholder="t('chat.input_placeholder')"
          @submit="send"
        />
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
        <button v-if="showAttachments" class="btn-outline btn-sm" @click="pickFile" :title="t('chat.add_attachment')">{{ t('chat.attachment') }}</button>
        <button v-if="onCancel && isStreaming" class="btn-danger btn-sm stop-btn" @click="onCancel">■ {{ t('chat.stop') }}</button>
        <button class="btn-primary" @click="send">{{ t('chat.send') }}</button>
      </div>
    </div>

    <ThinkDrawer v-if="thinksUrlPrefix" ref="thinkDrawerRef" :thinks-url-prefix="thinksUrlPrefix" />

    <ImageLightbox ref="lightboxRef" />
  </div>
</template>
