<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type {
  StoredMessage, ContentPart, Attachment, ChatLabels,
  ToolCallEvent, ToolApprovalPayload, AskEvent, AskAnswerPayload,
  DisplayContent,
} from '../types'
import type { CommandInfo } from '../transport'
import { SSelect } from '@qingfeng346/ui-kit'
import { resolveLabels, tpl } from '../labels'
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
  tasksUrlPrefix?: string | null
  labels?: ChatLabels
  showAttachments?: boolean
  hasSaver: boolean
  fetchThinks?: (url: string) => Promise<any>
  autoApprove?: boolean
  commands?: CommandInfo[]
  agent?: string
  agentOptions?: { value: string; label: string }[]
  saver?: string
  saverOptions?: { value: string; label: string }[]
  /** 隐藏「存储」选择项（存储由渠道默认值决定） */
  hideSaverSelect?: boolean
  workPath?: string
  workPathReadonly?: boolean
}>(), {
  showAttachments: false,
  thinksUrlPrefix: null,
  tasksUrlPrefix: null,
  autoApprove: false,
  commands: () => [],
  agent: '',
  agentOptions: () => [],
  saver: '',
  saverOptions: () => [],
  hideSaverSelect: false,
  workPath: '',
  workPathReadonly: false,
})

const emit = defineEmits<{
  send: [content: ContentPart[], attachments: Attachment[]]
  approve: [payload: ToolApprovalPayload]
  answer: [payload: AskAnswerPayload]
  abort: []
  'toggle-auto-approve': [value: boolean]
  'update-agent': [value: string]
  'update-config': [field: string, value: unknown]
  'open-path-picker': [currentPath: string]
}>()

const L = computed(() => resolveLabels(props.labels))
const isCompact = useCompact()

// 下拉选择器复用 SSelect multiple + single 的单选形态
const agentMsOptions = computed(() => props.agentOptions.map(o => ({ value: o.value, label: o.label })))
const saverMsOptions = computed(() => props.saverOptions.map(o => ({ value: o.value, label: o.label })))
const agentMsValue = computed(() => (props.agent ? [props.agent] : []))
const saverMsValue = computed(() => (props.saver ? [props.saver] : []))

const richInputRef = ref<InstanceType<typeof RichInput>>()
const messagesEl = ref<HTMLElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const shouldStickToBottom = ref(true)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null
let scrollFrame = 0

const {
  attachments, add: addFiles, remove: removeAttachment, drain: drainAttachments, isImageMime, isReading, failedFiles,
} = useAttachments()
const attachmentPreviews = computed(() => {
  let imageIndex = 0
  return attachments.value.map(attachment => {
    const image = isImageMime(attachment.type) ? attachment.dataUrl : undefined
    return {
      image,
      name: attachment.name,
      label: image ? tpl(L.value.imageAttachment, { index: ++imageIndex }) : attachment.name,
    }
  })
})

// ── Scrolling ──

function isAtBottom(): boolean {
  const el = messagesEl.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function updateStickToBottom() {
  shouldStickToBottom.value = isAtBottom()
}

function scrollToBottom(force = false) {
  if (!messagesEl.value || (!force && !shouldStickToBottom.value)) return
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    if (messagesEl.value && (force || shouldStickToBottom.value)) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
    scrollFrame = 0
  })
}

watch(() => props.messages.length, async () => {
  await nextTick(); scrollToBottom()
})
watch(() => props.streamingContent, async () => {
  await nextTick(); scrollToBottom()
})

// ── Attachments ──

const pickFile = () => fileInputEl.value?.click()

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void addFiles(Array.from(input.files))
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
  if (dragLeaveTimer) clearTimeout(dragLeaveTimer)
  dragLeaveTimer = setTimeout(() => { isDragging.value = false }, 80)
}

function onInputBarDrop(e: DragEvent) {
  if (!e.dataTransfer?.files.length) return
  e.preventDefault()
  void addFiles(Array.from(e.dataTransfer.files))
}

// ── Send ──

function send() {
  const input = richInputRef.value
  if (!input || !props.hasSaver || isReading.value) return
  const { content } = input.getContent()
  if (content.length === 0 && attachments.value.length === 0) return
  const files = drainAttachments()
  input.clear()
  emit('send', content, files)
}

onBeforeUnmount(() => {
  if (dragLeaveTimer) clearTimeout(dragLeaveTimer)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})

defineExpose({ scrollToBottom })
</script>

<template>
  <div class="chatui-chat-area">
    <!-- Messages -->
    <div ref="messagesEl" class="chatui-messages-scroll" @scroll.passive="updateStickToBottom">
      <MessageList
        :messages="messages"
        :thinks-url-prefix="thinksUrlPrefix"
        :tasks-url-prefix="tasksUrlPrefix"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :queued-messages="queuedMessages"
        :labels="labels"
        :fetch-fn="fetchThinks"
      />
    </div>

    <!-- Input bar (card) -->
    <div class="chatui-input-wrap" :class="{ 'chatui-compact': isCompact }">
      <div v-if="pendingToolCall" class="chatui-input-approval">
        <ToolApprovalBar
          :tool-call="pendingToolCall"
          :labels="labels"
          @approve="emit('approve', $event)"
        />
      </div>

      <div v-if="pendingAsk" class="chatui-input-ask">
        <AskForm
          :ask-event="pendingAsk"
          :labels="labels"
          @submit="emit('answer', $event)"
        />
      </div>

      <div
        class="chatui-input-card"
        :class="{ 'chatui-drag-over': isDragging }"
        @dragover="onInputBarDragOver"
        @dragleave="onInputBarDragLeave"
        @drop.capture="isDragging = false"
        @drop="onInputBarDrop"
      >
        <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />

        <ul v-if="attachmentPreviews.length" class="chatui-attachments" :aria-label="L.attachment">
          <li
            v-for="(att, i) in attachmentPreviews"
            :key="i"
            class="chatui-attachment-chip"
            :class="{ 'chatui-attachment-chip--image': att.image }"
          >
            <img v-if="att.image" :src="att.image" :alt="att.name" class="chatui-attachment-thumb" decoding="async" />
            <span class="chatui-attachment-name" :title="att.name">{{ att.label }}</span>
            <button
              type="button"
              class="chatui-attachment-remove"
              :aria-label="tpl(L.removeAttachment, { name: att.label })"
              @click="removeAttachment(i)"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        </ul>
        <p v-if="isReading" class="chatui-attachment-status" role="status">{{ L.loading }}</p>
        <p v-if="failedFiles.length" class="chatui-attachment-status" role="alert">
          {{ tpl(L.attachmentReadFailed, { names: failedFiles.join('、') }) }}
        </p>

        <!-- Editor -->
        <RichInput
          ref="richInputRef"
          :placeholder="L.inputPlaceholder"
          :commands="commands"
          @submit="send"
          @files="addFiles"
        />

        <!-- Toolbar -->
        <div class="chatui-input-toolbar">
          <div class="chatui-input-toolbar-side">
            <button
              v-if="showAttachments"
              class="chatui-icon-btn"
              :title="L.addAttachment"
              @click="pickFile"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                <path d="M10 5v10" />
                <path d="M5 10h10" />
              </svg>
            </button>
            <button
              class="chatui-approve-chip"
              :class="{ 'chatui-approve-chip--on': autoApprove }"
              :title="autoApprove ? L.autoApproved : L.requestApproval"
              @click="emit('toggle-auto-approve', !autoApprove)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 1.8 2.6 4v3.4c0 3.1 2.2 5.3 5.4 6.8 3.2-1.5 5.4-3.7 5.4-6.8V4L8 1.8Z" />
                <path v-if="autoApprove" d="M5.8 8.1 7.3 9.6 10.4 6.3" />
              </svg>
              <span>{{ autoApprove ? L.autoApproved : L.requestApproval }}</span>
              <svg class="chatui-approve-caret" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            <SSelect
              v-if="agentOptions.length"
              class="chatui-agent-select"
              multiple
              single
              placement="top"
              :value="agentMsValue"
              :options="agentMsOptions"
              :placeholder="L.selectPlaceholder"
              @update:value="(v) => emit('update-agent', v[0] ?? '')"
            />
          </div>
          <div class="chatui-input-toolbar-side">
            <button
              v-if="isStreaming"
              class="chatui-stop-btn"
              :title="L.stop"
              @click="emit('abort')"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="2" />
              </svg>
            </button>
            <button
              class="chatui-send-btn"
              :disabled="!hasSaver || isReading"
              :title="L.send"
              @click="send"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 15.5v-11" />
                <path d="M5.5 9 10 4.5 14.5 9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Below-card session config row -->
      <div v-if="hasSaver" class="chatui-input-config">
        <div v-if="!hideSaverSelect" class="chatui-input-config-item">
          <span class="chatui-input-config-label">{{ L.storage }}</span>
          <SSelect
            class="chatui-config-select"
            multiple
            single
            compact
            placement="top"
            :value="saverMsValue"
            :options="saverMsOptions"
            :placeholder="L.selectPlaceholder"
            @update:value="(v) => emit('update-config', 'saver', v[0] ?? '')"
          />
        </div>
        <div v-if="!workPathReadonly" class="chatui-input-config-item chatui-input-config-path-wrap">
          <button
            class="chatui-input-config-path"
            :title="workPath || L.workpathPlaceholder"
            @click="emit('open-path-picker', workPath)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3l1.2 1.5H12.5A1.5 1.5 0 0 1 14 7v4.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5Z" />
            </svg>
            <span class="chatui-input-config-path-text">{{ workPath || L.workpathPlaceholder }}</span>
          </button>
          <button
            v-if="workPath"
            class="chatui-input-config-clear"
            :title="L.close"
            @click="emit('update-config', 'workPath', undefined)"
          >×</button>
        </div>
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
/* Card-style input */
.chatui-input-wrap {
  flex-shrink: 0;
  padding: 10px 16px 14px;
  background: var(--chatui-bg-surface);
  border-top: 1px solid var(--chatui-border);
}
.chatui-input-wrap.chatui-compact { padding: 8px; }
.chatui-input-approval {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--chatui-approval-border);
  border-radius: 8px;
  background: var(--chatui-approval-bg);
}
.chatui-input-approval :deep(.chatui-tool-approval) {
  border-bottom: none;
}
.chatui-input-ask {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--chatui-ask-border);
  border-radius: 8px;
  background: var(--chatui-ask-bg);
}
.chatui-input-ask :deep(.chatui-ask-form) {
  max-height: min(38vh, 320px);
  border-bottom: none;
}
.chatui-input-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 8px;
  border: 1px solid var(--chatui-border);
  border-radius: 14px;
  background: var(--chatui-bg);
  transition: border-color 0.15s;
}
.chatui-input-card:focus-within {
  border-color: var(--chatui-border-focus, var(--chatui-accent));
}
.chatui-input-card.chatui-drag-over {
  border-color: var(--chatui-accent);
  border-style: dashed;
  background: rgba(59, 130, 246, 0.05);
}
.chatui-input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.chatui-input-toolbar-side {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chatui-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--chatui-fg-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chatui-icon-btn:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-stop-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  padding: 0;
  border: 1px solid var(--chatui-btn-danger, #ef4444);
  border-radius: 50%;
  background: transparent;
  color: var(--chatui-btn-danger, #ef4444);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chatui-stop-btn:hover {
  background: var(--chatui-btn-danger, #ef4444);
  color: #fff;
}
.chatui-approve-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--chatui-border);
  border-radius: 999px;
  background: transparent;
  color: var(--chatui-fg-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chatui-approve-chip:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-approve-chip--on {
  color: var(--chatui-usage-cache, #22c55e);
  border-color: var(--chatui-usage-cache, #22c55e);
}
.chatui-approve-caret { opacity: 0.6; }
.chatui-send-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--chatui-accent, #3b82f6);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.chatui-send-btn:hover:not(:disabled) { opacity: 0.88; }
.chatui-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.chatui-agent-select {
  max-width: 170px;
  min-width: 0;
}
.chatui-agent-select :deep(.s-multi-select-trigger) {
  min-height: 30px;
  max-width: 170px;
}
.chatui-agent-select :deep(.s-multi-select-chip),
.chatui-agent-select :deep(.s-multi-select-placeholder) {
  font-size: 12px;
  line-height: 1.4;
}

/* Below-card config row */
.chatui-input-config {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 8px 4px 0;
}
.chatui-input-config-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
}
.chatui-input-config-label {
  white-space: nowrap;
}
.chatui-config-select {
  min-width: 0;
  max-width: 180px;
}
.chatui-config-select :deep(.s-multi-select-trigger) {
  max-width: 180px;
}
.chatui-config-select :deep(.s-multi-select-chip),
.chatui-config-select :deep(.s-multi-select-placeholder) {
  font-size: 12px;
  line-height: 1.4;
}
.chatui-input-config-path-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 340px;
}
.chatui-input-config-path {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
}
.chatui-input-config-path:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-input-config-path:disabled,
.chatui-input-config-path--readonly {
  cursor: default;
  opacity: 1;
}
.chatui-input-config-path:disabled:hover,
.chatui-input-config-path--readonly:hover {
  background: transparent;
  color: var(--chatui-fg-secondary);
}
.chatui-input-config-path-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatui-input-config-clear {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--chatui-fg-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.chatui-input-config-clear:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-btn-danger, #ef4444);
}
.chatui-attachments {
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px;
  max-height: min(28vh, 180px);
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 2px;
}
.chatui-attachment-chip {
  position: relative;
  display: flex; align-items: center;
  padding-inline-start: 8px;
  background: var(--chatui-bg-hover);
  border: 1px solid var(--chatui-border);
  border-radius: 8px;
  font-size: 0.75rem;
  color: var(--chatui-fg);
  min-width: 0;
  max-width: min(200px, 100%);
}
.chatui-attachment-chip--image {
  flex-direction: column;
  align-items: stretch;
  width: 5.5rem;
  padding: 0;
}
.chatui-attachment-chip--image .chatui-attachment-name {
  padding: 3px 6px;
}
.chatui-attachment-thumb {
  display: block;
  width: 100%;
  height: 3.5rem;
  object-fit: contain;
  border-radius: 7px 7px 0 0;
}
.chatui-attachment-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chatui-attachment-remove {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--chatui-fg);
  font-size: 1rem;
  cursor: pointer;
}
.chatui-attachment-chip--image .chatui-attachment-remove {
  position: absolute;
  top: 0;
  right: 0;
  place-items: start end;
  padding: 4px;
}
.chatui-attachment-remove span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--chatui-bg);
  box-shadow: inset 0 0 0 1px var(--chatui-border);
}
.chatui-attachment-remove:hover span,
.chatui-attachment-remove:active span {
  color: var(--chatui-btn-danger);
}
.chatui-attachment-remove:focus-visible {
  outline: 2px solid var(--chatui-border-focus, var(--chatui-accent));
  outline-offset: -2px;
}
.chatui-attachment-status {
  margin: 0;
  font-size: 0.75rem;
  color: var(--chatui-fg-secondary);
  overflow-wrap: anywhere;
}
</style>
