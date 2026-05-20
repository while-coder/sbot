<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StoredMessage, ContentPart, Attachment } from '@sbot/chat-ui'
import MessageList from './MessageList.vue'
import { RichInput } from '@sbot/chat-ui'
import { SButton } from 'sbot-ui'

const { t } = useI18n()


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
const isDragging = ref(false)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

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

async function addFiles(files: File[]) {
  for (const file of files) {
    if (attachments.value.find(a => a.name === file.name)) continue
    const att = await readFile(file)
    attachments.value.push(att)
  }
}

function onInputBarDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
  isDragging.value = true
}

function onInputBarDragLeave() {
  dragLeaveTimer = setTimeout(() => { isDragging.value = false }, 80)
}

function onInputBarDrop(e: DragEvent) {
  isDragging.value = false
  e.preventDefault()
  if (!e.dataTransfer?.files?.length) return
  const nonImageFiles = Array.from(e.dataTransfer.files).filter(f => !f.type.startsWith('image/'))
  if (nonImageFiles.length > 0) addFiles(nonImageFiles)
}

function onFilesFromEditor(files: File[]) {
  addFiles(files)
}

// ── Input ──
function send() {
  if (!richInputRef.value) return
  const { parts } = richInputRef.value.getContent()
  const fileAtts = attachments.value.splice(0)
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
      <SButton type="danger" size="sm" class="stop-btn" @click="onCancel">■ {{ t('chat.stop') }}</SButton>
    </div>

    <!-- Input bar -->
    <div
      class="chat-input-bar"
      :class="{ 'drag-over': isDragging }"
      @dragover="onInputBarDragOver"
      @dragleave="onInputBarDragLeave"
      @drop.capture="isDragging = false"
      @drop="onInputBarDrop"
    >
      <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div v-if="attachments.length > 0" style="display:flex;flex-wrap:wrap;gap:6px">
          <div
            v-for="(att, i) in attachments"
            :key="att.name"
            class="attachment-chip"
          >
            <img v-if="isImage(att) && att.dataUrl" :src="att.dataUrl"
              style="width:18px;height:18px;object-fit:cover;border-radius:2px;flex-shrink:0" />
            <span v-else style="font-size:13px;flex-shrink:0">📄</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ att.name }}</span>
            <button @click="removeAttachment(i)" class="attachment-chip-close">×</button>
          </div>
        </div>
        <RichInput
          ref="richInputRef"
          :placeholder="t('chat.input_placeholder')"
          :max-height="200"
          @submit="send"
          @files="onFilesFromEditor"
        />
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
        <SButton v-if="showAttachments" type="outline" size="sm" :title="t('chat.add_attachment')" @click="pickFile">{{ t('chat.attachment') }}</SButton>
        <SButton type="primary" @click="send">{{ t('chat.send') }}</SButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input-bar.drag-over {
  outline: 2px dashed var(--sui-info);
  outline-offset: -2px;
  background: var(--sui-info-soft);
}
.attachment-chip {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-1);
  padding: 2px var(--sui-sp-3);
  background: var(--sui-bg-soft);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-pill);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  max-width: 200px;
}
.attachment-chip-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-lg);
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
</style>
