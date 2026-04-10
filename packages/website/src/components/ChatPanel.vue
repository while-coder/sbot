<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StoredMessage } from '@/types'
import MessageList from './MessageList.vue'
import RichInput, { type ContentPart } from './RichInput.vue'

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
  send: [parts: ContentPart[], fileAttachments: Attachment[]]
}>()

const richInputRef = ref<InstanceType<typeof RichInput>>()
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
  const { parts } = richInputRef.value.getContent()
  const fileAtts = props.showAttachments ? attachments.value.splice(0) : []
  if (parts.length === 0 && fileAtts.length === 0) return
  richInputRef.value.clear()
  emit('send', parts, fileAtts)
}

defineExpose({ scrollToBottom })
</script>

<template>
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

    <!-- Messages -->
    <div ref="messagesEl" style="flex:1;overflow-y:auto">
      <MessageList
        :messages="messages"
        :thinks-url-prefix="thinksUrlPrefix"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :queued-messages="queuedMessages"
      />
    </div>

    <!-- Stop bar -->
    <div v-if="onCancel && isStreaming" class="chat-stop-bar">
      <button class="btn-danger btn-sm stop-btn" @click="onCancel">■ {{ t('chat.stop') }}</button>
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
        <button class="btn-primary" @click="send">{{ t('chat.send') }}</button>
      </div>
    </div>
  </div>
</template>
