<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type {
  StoredMessage, ContentPart, Attachment, ChatLabels,
  ToolCallEvent, ToolApprovalPayload, AskEvent, AskAnswerPayload,
  DisplayContent,
} from '../types'
import { SButton } from 'sbot-ui'
import { resolveLabels } from '../labels'
import { useCompact } from '../composables/useCompact'
import { useAttachments } from '../composables/useAttachments'
import MessageList from './MessageList.vue'
import RichInput from './RichInput.vue'
import ToolApprovalBar from './ToolApprovalBar.vue'
import AskForm from './AskForm.vue'

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  isStreaming: boolean
  streamingContent: DisplayContent
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
const isCompact = useCompact()

const richInputRef = ref<InstanceType<typeof RichInput>>()
const messagesEl = ref<HTMLElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

const { attachments, add: addFiles, remove: removeAttachment, drain: drainAttachments, isImageMime } = useAttachments()

// ── Scrolling ──

function isAtBottom(): boolean {
  const el = messagesEl.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function scrollToBottom(force = false) {
  if (messagesEl.value && (force || isAtBottom())) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

watch(() => props.messages.length, async () => {
  await nextTick(); scrollToBottom()
})
watch(() => props.streamingContent, async () => {
  await nextTick(); scrollToBottom(true)
})

// ── Attachments ──

const pickFile = () => fileInputEl.value?.click()

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) await addFiles(Array.from(input.files))
  input.value = ''
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
  // Images dropped on the input bar are handled by the editor's own drop handler; only non-images
  // are surfaced as attachment chips here.
  const nonImages = Array.from(e.dataTransfer.files).filter(f => !isImageMime(f.type))
  if (nonImages.length > 0) addFiles(nonImages)
}

// ── Send ──

function send() {
  const input = richInputRef.value
  if (!input) return
  const { parts } = input.getContent()
  const files = drainAttachments()
  if (parts.length === 0 && files.length === 0) return
  input.clear()
  emit('send', parts, files)
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
      <SButton type="danger" size="sm" @click="emit('abort')">{{ L.stop }}</SButton>
    </div>

    <!-- Input bar -->
    <div
      class="chatui-input-bar"
      :class="{ 'chatui-drag-over': isDragging, 'chatui-compact': isCompact }"
      @dragover="onInputBarDragOver"
      @dragleave="onInputBarDragLeave"
      @drop.capture="isDragging = false"
      @drop="onInputBarDrop"
    >
      <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
        <div v-if="attachments.length > 0" class="chatui-attachments">
          <div v-for="(att, i) in attachments" :key="att.name" class="chatui-attachment-chip">
            <img v-if="isImageMime(att.type) && att.dataUrl" :src="att.dataUrl" class="chatui-attachment-thumb" />
            <span v-else class="chatui-attachment-icon">📄</span>
            <span class="chatui-attachment-name">{{ att.name }}</span>
            <button class="chatui-attachment-remove" @click="removeAttachment(i)">×</button>
          </div>
        </div>
        <RichInput
          ref="richInputRef"
          :placeholder="L.inputPlaceholder"
          @submit="send"
          @files="addFiles"
        />
      </div>
      <div class="chatui-input-actions">
        <SButton v-if="showAttachments" type="outline" size="sm" @click="pickFile" :title="L.addAttachment">{{ L.attachment }}</SButton>
        <SButton :disabled="!hasSaver" @click="send">{{ L.send }}</SButton>
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
  border-top: 1px solid var(--chatui-border); flex-shrink: 0;
}
.chatui-input-bar {
  display: flex; gap: 8px; padding: 10px 16px;
  border-top: 1px solid var(--chatui-border); flex-shrink: 0;
  background: var(--chatui-bg-surface);
}
.chatui-input-bar.chatui-drag-over {
  outline: 2px dashed var(--chatui-accent);
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
  padding: 2px 8px; background: var(--chatui-bg-hover);
  border: 1px solid var(--chatui-border);
  border-radius: 12px; font-size: 12px; color: var(--chatui-fg);
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
  color: var(--chatui-fg-secondary); font-size: 14px;
  padding: 0; line-height: 1; flex-shrink: 0;
}
.chatui-attachment-remove:hover { color: var(--chatui-btn-danger); }

.chatui-input-bar.chatui-compact { padding: 8px; gap: 6px; }
</style>
