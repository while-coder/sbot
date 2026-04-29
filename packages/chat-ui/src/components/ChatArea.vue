<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type {
  StoredMessage, ContentPart, Attachment, ChatLabels,
  ToolCallEvent, ToolApprovalPayload, AskEvent, AskAnswerPayload,
  DisplayContent,
} from '../types'
import { resolveLabels } from '../labels'
import MessageList from './MessageList.vue'
import RichInput from './RichInput.vue'
import ToolApprovalBar from './ToolApprovalBar.vue'
import AskForm from './AskForm.vue'

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  isStreaming: boolean
  streamingContent: string | any[]
  queuedMessages?: DisplayContent[]
  pendingToolCall: ToolCallEvent | null
  pendingAsk: AskEvent | null
  thinksUrlPrefix?: string | null
  labels?: ChatLabels
  showAttachments?: boolean
  hasSaver: boolean
  fetchThinks?: (url: string) => Promise<any>
}>(), {
  showAttachments: false,
  thinksUrlPrefix: null,
})

const emit = defineEmits<{
  send: [parts: ContentPart[], attachments: Attachment[]]
  approve: [payload: ToolApprovalPayload]
  answer: [payload: AskAnswerPayload]
  abort: []
}>()

const L = computed(() => resolveLabels(props.labels))

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

async function addFiles(files: File[]) {
  for (const file of files) {
    if (attachments.value.find(a => a.name === file.name)) continue
    const att = await readFile(file)
    attachments.value.push(att)
  }
}

async function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  await addFiles(Array.from(files))
  ;(e.target as HTMLInputElement).value = ''
}

function removeAttachment(idx: number) {
  attachments.value.splice(idx, 1)
}

function isImage(att: Attachment) {
  return att.type.startsWith('image/')
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

// ── Send ──

function send() {
  if (!richInputRef.value) return
  const { parts } = richInputRef.value.getContent()
  const fileAtts = attachments.value.splice(0)
  if (parts.length === 0 && fileAtts.length === 0) return
  richInputRef.value.clear()
  emit('send', parts, fileAtts)
}

onBeforeUnmount(() => {
  if (dragLeaveTimer) clearTimeout(dragLeaveTimer)
})

defineExpose({ scrollToBottom })
</script>

<template>
  <div class="chatui-chat-area">
    <!-- Ask form -->
    <AskForm
      v-if="pendingAsk"
      :ask-event="pendingAsk"
      :labels="labels"
      @submit="emit('answer', $event)"
    />

    <!-- Tool approval bar -->
    <ToolApprovalBar
      v-if="pendingToolCall"
      :tool-call="pendingToolCall"
      :labels="labels"
      @approve="emit('approve', $event)"
    />

    <!-- Messages -->
    <div ref="messagesEl" class="chatui-messages-scroll">
      <MessageList
        :messages="messages"
        :thinks-url-prefix="thinksUrlPrefix"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :queued-messages="queuedMessages"
        :labels="labels"
        :fetch-fn="fetchThinks"
      />
    </div>

    <!-- Stop bar -->
    <div v-if="isStreaming" class="chatui-stop-bar">
      <button class="chatui-btn-danger chatui-btn-sm" @click="emit('abort')">{{ L.stop }}</button>
    </div>

    <!-- Input bar -->
    <div
      class="chatui-input-bar"
      :class="{ 'chatui-drag-over': isDragging }"
      @dragover="onInputBarDragOver"
      @dragleave="onInputBarDragLeave"
      @drop.capture="isDragging = false"
      @drop="onInputBarDrop"
    >
      <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
        <div v-if="attachments.length > 0" class="chatui-attachments">
          <div v-for="(att, i) in attachments" :key="att.name" class="chatui-attachment-chip">
            <img v-if="isImage(att) && att.dataUrl" :src="att.dataUrl" class="chatui-attachment-thumb" />
            <span v-else class="chatui-attachment-icon">📄</span>
            <span class="chatui-attachment-name">{{ att.name }}</span>
            <button class="chatui-attachment-remove" @click="removeAttachment(i)">×</button>
          </div>
        </div>
        <RichInput
          ref="richInputRef"
          :placeholder="L.inputPlaceholder"
          @submit="send"
          @files="onFilesFromEditor"
        />
      </div>
      <div class="chatui-input-actions">
        <button v-if="showAttachments" class="chatui-btn-outline chatui-btn-sm" @click="pickFile" :title="L.addAttachment">{{ L.attachment }}</button>
        <button class="chatui-btn-primary" :disabled="!hasSaver" @click="send">{{ L.send }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chatui-chat-area {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.chatui-messages-scroll {
  flex: 1; overflow-y: auto;
}
.chatui-stop-bar {
  display: flex; justify-content: center; padding: 6px;
  border-top: 1px solid var(--chatui-border, #e8e6e3); flex-shrink: 0;
}
.chatui-input-bar {
  display: flex; gap: 8px; padding: 10px 16px;
  border-top: 1px solid var(--chatui-border, #e8e6e3); flex-shrink: 0;
  background: var(--chatui-bg-surface, #fff);
}
.chatui-input-bar.chatui-drag-over {
  outline: 2px dashed var(--chatui-accent, #3b82f6);
  outline-offset: -2px;
  background: rgba(59, 130, 246, 0.05);
}
.chatui-input-actions {
  display: flex; flex-direction: column; gap: 6px; align-self: flex-end;
}
.chatui-attachments {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.chatui-attachment-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 8px; background: var(--chatui-bg-hover, #f1f5f9);
  border: 1px solid var(--chatui-border, #e2e8f0);
  border-radius: 12px; font-size: 12px; color: var(--chatui-fg, #475569);
  max-width: 200px;
}
.chatui-attachment-thumb {
  width: 18px; height: 18px; object-fit: cover; border-radius: 2px; flex-shrink: 0;
}
.chatui-attachment-icon { font-size: 13px; flex-shrink: 0; }
.chatui-attachment-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chatui-attachment-remove {
  background: none; border: none; cursor: pointer;
  color: var(--chatui-fg-secondary, #94a3b8); font-size: 14px;
  padding: 0; line-height: 1; flex-shrink: 0;
}
.chatui-attachment-remove:hover { color: var(--chatui-btn-danger, #ef4444); }

.chatui-btn-primary {
  padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer;
  font-size: 13px; font-weight: 500;
  background: var(--chatui-accent, #2563eb); color: #fff;
}
.chatui-btn-primary:hover { opacity: 0.9; }
.chatui-btn-primary:disabled { opacity: 0.5; cursor: default; }
.chatui-btn-outline {
  padding: 4px 10px; border: 1px solid var(--chatui-border, #d1d5db);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-fg, #374151);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover, #f5f4f2); }
.chatui-btn-danger {
  padding: 4px 10px; border: 1px solid var(--chatui-btn-danger, #ef4444);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-btn-danger, #ef4444);
}
.chatui-btn-danger:hover { background: rgba(239, 68, 68, 0.08); }
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }

@media (max-width: 768px) {
  .chatui-input-bar { padding: 8px; gap: 6px; }
}
</style>
