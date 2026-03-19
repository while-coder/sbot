<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import ChatPanel from './ChatPanel.vue'
import { WebChatEventType, MessageRole } from 'sbot.commons'
import type { WebChatEvent } from 'sbot.commons'
import type { ChatMessage } from '@/types'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const props = withDefaults(defineProps<{
  historyUrl: string | null
  emptyText?: string
  showAttachments?: boolean
  /** 是否从 ws Human 事件推消息（ChatView=true；DirectoryView=false，由父组件乐观推送） */
  handleHumanMessage?: boolean
}>(), {
  handleHumanMessage: true,
})

const emit = defineEmits<{
  send: [query: string, attachments: Attachment[]]
  done: []
  error: [message: string]
}>()

const { t } = useI18n()
const { show } = useToast()

const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

// ── 聊天状态 ──────────────────────────────────────────────
const messages           = ref<ChatMessage[]>([])
const chatSending        = ref(false)
const isStreaming        = ref(false)
const streamingContent   = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])

// ── 工具审批状态 ──────────────────────────────────────────
const pendingToolCall = ref<{ id: string; name: string; args: Record<string, any> } | null>(null)
const denyCountdown   = ref(300)
let denyTimer: ReturnType<typeof setInterval> | null = null

function startDenyCountdown() {
  stopDenyCountdown()
  denyCountdown.value = 300
  denyTimer = setInterval(() => {
    if (denyCountdown.value > 0) denyCountdown.value--
  }, 1000)
}

function stopDenyCountdown() {
  if (denyTimer !== null) { clearInterval(denyTimer); denyTimer = null }
}

function approveToolCall(approval: string) {
  if (!pendingToolCall.value) return
  stopDenyCountdown()
  const id = pendingToolCall.value.id
  pendingToolCall.value = null
  apiFetch('/api/tool-approval', 'POST', { id, approval }).catch(() => {})
}

// ── 历史记录 ──────────────────────────────────────────────
async function refreshHistory() {
  const url = props.historyUrl
  if (!url) { messages.value = []; return }
  try {
    const res = await apiFetch(url)
    messages.value = res.data || []
    await nextTick()
    chatPanelRef.value?.scrollToBottom()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearHistory() {
  const url = props.historyUrl
  if (!url || !window.confirm(t('chat.confirm_clear_history'))) return
  try {
    await apiFetch(url, 'DELETE')
    show(t('chat.history_cleared'))
    await refreshHistory()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

watch(() => props.historyUrl, () => refreshHistory())

// ── WebSocket 事件处理 ────────────────────────────────────
async function handleWsEvent(evt: WebChatEvent) {
  if (evt.type === WebChatEventType.Human) {
    isStreaming.value = true
    if (props.handleHumanMessage) {
      messages.value.push({ role: MessageRole.Human, content: evt.content, timestamp: new Date().toISOString() })
      await nextTick()
      chatPanelRef.value?.scrollToBottom(true)
    }
  } else if (evt.type === WebChatEventType.Stream) {
    streamingContent.value = evt.content
  } else if (evt.type === WebChatEventType.Message) {
    messages.value.push({
      role: evt.role, content: evt.content,
      tool_calls: evt.tool_calls, tool_call_id: evt.tool_call_id,
      timestamp: new Date().toISOString(),
    })
    streamingContent.value = ''
    streamingToolCalls.value = []
  } else if (evt.type === WebChatEventType.ToolCall) {
    const tcId = evt.id ?? `tc-${Date.now()}`
    pendingToolCall.value = { id: tcId, name: evt.name, args: evt.args }
    startDenyCountdown()
  } else if (evt.type === WebChatEventType.Done) {
    isStreaming.value = false
    chatSending.value = false
    stopDenyCountdown()
    pendingToolCall.value = null
    emit('done')
  } else if (evt.type === WebChatEventType.Error) {
    isStreaming.value = false
    chatSending.value = false
    stopDenyCountdown()
    pendingToolCall.value = null
    emit('error', evt.message)
  }
}

// ── 公开接口 ──────────────────────────────────────────────
function pushMessage(msg: ChatMessage) {
  messages.value.push(msg)
}

function setSending(val: boolean) {
  chatSending.value = val
}

function scrollToBottom(force?: boolean) {
  chatPanelRef.value?.scrollToBottom(force)
}

/** 重置流式/发送状态（ws 断连时调用） */
function reset() {
  isStreaming.value = false
  chatSending.value = false
  stopDenyCountdown()
  pendingToolCall.value = null
}

/** 组件卸载时调用，清理定时器 */
function cleanup() {
  stopDenyCountdown()
}

defineExpose({ handleWsEvent, pushMessage, setSending, refreshHistory, clearHistory, scrollToBottom, reset, cleanup })
</script>

<template>
  <div v-if="pendingToolCall" class="tool-approval-bar">
    <span class="tool-approval-label">{{ t('chat.execute_tool') }}<strong>{{ pendingToolCall.name }}</strong></span>
    <div class="tool-approval-btns">
      <button class="btn-primary btn-sm" @click="approveToolCall('allow')">{{ t('chat.allow') }}</button>
      <button class="btn-outline btn-sm" @click="approveToolCall('alwaysArgs')">{{ t('chat.always_allow_args') }}</button>
      <button class="btn-outline btn-sm" @click="approveToolCall('alwaysTool')">{{ t('chat.always_allow_all') }}</button>
      <button class="btn-danger btn-sm" @click="approveToolCall('deny')">{{ t('chat.deny') }} ({{ denyCountdown }}s)</button>
    </div>
  </div>
  <ChatPanel
    ref="chatPanelRef"
    :messages="messages"
    :is-streaming="isStreaming"
    :streaming-content="streamingContent"
    :streaming-tool-calls="streamingToolCalls"
    :chat-sending="chatSending"
    :empty-text="emptyText"
    :show-attachments="showAttachments"
    @send="(q, a) => emit('send', q, a)"
  />
</template>

<style scoped>
.tool-approval-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #fffbeb;
  border-bottom: 1px solid #fcd34d;
  flex-shrink: 0;
  font-size: 13px;
}
.tool-approval-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-approval-btns  { display: flex; gap: 6px; flex-shrink: 0; }
</style>
