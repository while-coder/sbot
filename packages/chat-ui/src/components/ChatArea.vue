<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type {
  StoredMessage, ContentPart, Attachment, ChatLabels,
  ToolCallEvent, ToolApprovalPayload, AskEvent, AskAnswerPayload,
  DisplayContent, UsageInfo,
} from '../types'
import type { CommandInfo } from '../transport'
import { SSelect } from 'sbot-ui'
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
  tasksUrlPrefix?: string | null
  labels?: ChatLabels
  showAttachments?: boolean
  hasSaver: boolean
  fetchThinks?: (url: string) => Promise<any>
  usage?: UsageInfo | null
  contextWindow?: number
  autoApprove?: boolean
  commands?: CommandInfo[]
  agent?: string
  agentOptions?: { value: string; label: string }[]
  saver?: string
  saverOptions?: { value: string; label: string }[]
  workPath?: string
}>(), {
  showAttachments: false,
  thinksUrlPrefix: null,
  tasksUrlPrefix: null,
  usage: null,
  autoApprove: false,
  commands: () => [],
  agent: '',
  agentOptions: () => [],
  saver: '',
  saverOptions: () => [],
  workPath: '',
})

const emit = defineEmits<{
  send: [parts: ContentPart[], attachments: Attachment[]]
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

const richInputRef = ref<InstanceType<typeof RichInput>>()
const messagesEl = ref<HTMLElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const shouldStickToBottom = ref(true)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null
let scrollFrame = 0

const { attachments, add: addFiles, remove: removeAttachment, drain: drainAttachments, isImageMime } = useAttachments()

const contextPercent = computed(() => {
  if (!props.contextWindow || !props.usage?.lastInputTokens) return null
  return Math.min(100, Math.round(props.usage.lastInputTokens / props.contextWindow * 100))
})

const cachePercent = computed(() => {
  if (!props.usage) return null
  const read = props.usage.cacheReadTokens ?? 0
  if (read === 0) return null
  const total = props.usage.inputTokens + read + (props.usage.cacheCreationTokens ?? 0)
  if (total === 0) return null
  return Math.round(read / total * 100)
})

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtFull(n: number): string {
  return n.toLocaleString()
}

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
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
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

    <!-- Compact usage strip -->
    <div
      v-if="isCompact && usage && usage.totalTokens > 0"
      class="chatui-input-usage-strip"
      :title="`Last: ${fmtFull(usage.lastTotalTokens)} / Total: ${fmtFull(usage.totalTokens)} tokens`"
    >
      <span v-if="contextPercent != null" class="chatui-input-usage-chip chatui-input-usage-chip--context">
        {{ contextPercent }}% context
      </span>
      <span class="chatui-input-usage-chip">
        Last {{ fmtCompact(usage.lastTotalTokens) }}
      </span>
      <span class="chatui-input-usage-chip">
        Total {{ fmtCompact(usage.totalTokens) }}
      </span>
      <span v-if="cachePercent != null" class="chatui-input-usage-chip chatui-input-usage-chip--cache">
        Cache {{ cachePercent }}%
      </span>
    </div>

    <!-- Input bar (card) -->
    <div class="chatui-input-wrap" :class="{ 'chatui-compact': isCompact }">
      <div
        class="chatui-input-card"
        :class="{ 'chatui-drag-over': isDragging }"
        @dragover="onInputBarDragOver"
        @dragleave="onInputBarDragLeave"
        @drop.capture="isDragging = false"
        @drop="onInputBarDrop"
      >
        <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />

        <!-- Attachment chips -->
        <div v-if="attachments.length > 0" class="chatui-attachments">
          <div v-for="(att, i) in attachments" :key="att.name" class="chatui-attachment-chip">
            <img v-if="isImageMime(att.type) && att.dataUrl" :src="att.dataUrl" class="chatui-attachment-thumb" />
            <span v-else class="chatui-attachment-icon">📄</span>
            <span class="chatui-attachment-name">{{ att.name }}</span>
            <button class="chatui-attachment-remove" @click="removeAttachment(i)">×</button>
          </div>
        </div>

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
              size="sm"
              :model-value="agent"
              :options="agentOptions"
              @update:model-value="(v) => emit('update-agent', v as string)"
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
              :disabled="!hasSaver"
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
        <div class="chatui-input-config-item">
          <span class="chatui-input-config-label">{{ L.storage }}</span>
          <SSelect
            class="chatui-config-select"
            size="sm"
            :model-value="saver"
            :options="saverOptions"
            @update:model-value="(v) => emit('update-config', 'saver', v)"
          />
        </div>
        <div class="chatui-input-config-item chatui-input-config-path-wrap">
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
.chatui-input-usage-strip {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  min-height: 28px;
  padding: 4px 8px;
  border-top: 1px solid var(--chatui-border-subtle);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.chatui-input-usage-chip {
  display: inline-flex; align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border: 1px solid var(--chatui-border-subtle);
  border-radius: 999px;
  background: var(--chatui-bg);
  white-space: nowrap;
}
.chatui-input-usage-chip--context {
  color: var(--chatui-fg);
}
.chatui-input-usage-chip--cache {
  color: var(--chatui-usage-cache, #22c55e);
}
/* Card-style input */
.chatui-input-wrap {
  flex-shrink: 0;
  padding: 10px 16px 14px;
  background: var(--chatui-bg-surface);
  border-top: 1px solid var(--chatui-border);
}
.chatui-input-wrap.chatui-compact { padding: 8px; }
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
.chatui-agent-select :deep(select) {
  max-width: 170px;
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
</style>
