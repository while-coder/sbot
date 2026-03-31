<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import ChatPanel from './ChatPanel.vue'
import { WebChatEventType, WsCommandType, MessageRole } from 'sbot.commons'
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
  /** threadId，有值时显示中断按钮 */
  cancelThreadId?: string
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
const { send: wsSend } = useChatSocket()

const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

// ── 聊天状态 ──────────────────────────────────────────────
const messages           = ref<ChatMessage[]>([])
const chatSending        = ref(false)
const isStreaming        = ref(false)
const streamingContent   = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])

// ── Ask 表单状态 ──────────────────────────────────────────
type AskQuestion =
  | { type: 'radio';    label: string; options: string[]; allowCustom?: boolean }
  | { type: 'checkbox'; label: string; options: string[]; allowCustom?: boolean }
  | { type: 'input';    label: string; placeholder?: string }
  | { type: 'toggle';   label: string; default?: boolean }

const pendingAsk        = ref<{ id: string; threadId: string; title?: string; questions: AskQuestion[] } | null>(null)
const askAnswers        = ref<Record<number, string | string[]>>({})
const askToggleValues   = ref<Record<number, boolean>>({})
const askCustomInputs   = ref<Record<number, string>>({})

const CUSTOM_SENTINEL = '__custom__'

function initAskAnswers(questions: AskQuestion[]) {
  const init: Record<number, string | string[]> = {}
  const toggleInit: Record<number, boolean> = {}
  questions.forEach((q, i) => {
    if (q.type === 'checkbox') init[i] = []
    if (q.type === 'toggle') toggleInit[i] = q.default ?? false
  })
  askAnswers.value = init
  askToggleValues.value = toggleInit
  askCustomInputs.value = {}
}
const askCountdown    = ref(600)

function submitAsk() {
  if (!pendingAsk.value) return
  const answers: Record<string, string | string[]> = {}
  pendingAsk.value.questions.forEach((q, i) => {
    if (q.type === 'toggle') {
      answers[String(i)] = String(askToggleValues.value[i] ?? false)
      return
    }
    let val = askAnswers.value[i]
    if (Array.isArray(val)) {
      // checkbox: replace sentinel with custom text
      val = val.flatMap(v => v === CUSTOM_SENTINEL ? (askCustomInputs.value[i] ? [askCustomInputs.value[i]] : []) : [v])
      if (val.length > 0) answers[String(i)] = val
    } else {
      // radio / input: replace sentinel with custom text
      if (val === CUSTOM_SENTINEL) val = askCustomInputs.value[i] ?? ''
      if (val !== undefined && val !== '') answers[String(i)] = val
    }
  })
  const { id, threadId } = pendingAsk.value
  pendingAsk.value = null
  askAnswers.value = {}
  askToggleValues.value = {}
  askCustomInputs.value = {}
  wsSend({ type: WsCommandType.Ask, threadId, id, answers })
}

// ── 工具审批状态 ──────────────────────────────────────────
const pendingToolCall = ref<{ id: string; threadId: string; name: string; args: Record<string, any> } | null>(null)
const denyCountdown   = ref(300)
const argsExpanded    = ref(false)
let denyTimer: ReturnType<typeof setInterval> | null = null

watch(pendingToolCall, () => { argsExpanded.value = false })

function formatArgVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.length} items]`
  return '{…}'
}

function startDenyCountdown(initialSeconds = 300) {
  stopDenyCountdown()
  denyCountdown.value = initialSeconds
  denyTimer = setInterval(() => {
    if (denyCountdown.value > 0) denyCountdown.value--
  }, 1000)
}

function stopDenyCountdown() {
  if (denyTimer !== null) { clearInterval(denyTimer); denyTimer = null }
}

let askTimer: ReturnType<typeof setInterval> | null = null

function startAskCountdown(initialSeconds = 600) {
  stopAskCountdown()
  askCountdown.value = initialSeconds
  askTimer = setInterval(() => {
    if (askCountdown.value > 0) askCountdown.value--
  }, 1000)
}

function stopAskCountdown() {
  if (askTimer !== null) { clearInterval(askTimer); askTimer = null }
}

function approveToolCall(approval: string) {
  if (!pendingToolCall.value) return
  stopDenyCountdown()
  const { id, threadId } = pendingToolCall.value
  pendingToolCall.value = null
  wsSend({ type: WsCommandType.Approval, threadId, id, approval })
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
    // 消息开始处理，从排队列表移除
    if (queuedMessages.value.length > 0) queuedMessages.value.shift()
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
    pendingToolCall.value = { id: evt.id, threadId: evt.threadId, name: evt.name, args: evt.args }
    startDenyCountdown()
  } else if (evt.type === WebChatEventType.Ask) {
    pendingAsk.value = { id: evt.id, threadId: evt.threadId, title: evt.title, questions: evt.questions as AskQuestion[] }
    initAskAnswers(evt.questions as AskQuestion[])
    startAskCountdown()
  } else if (evt.type === WebChatEventType.Queue) {
    queuedMessages.value = evt.pendingMessages
  } else if (evt.type === WebChatEventType.Done) {
    if (evt.pendingMessages) {
      queuedMessages.value = evt.pendingMessages
    }
    stopDenyCountdown()
    stopAskCountdown()
    pendingToolCall.value = null
    pendingAsk.value = null
    if (queuedMessages.value.length === 0) {
      isStreaming.value = false
      chatSending.value = false
    }
    emit('done')
  } else if (evt.type === WebChatEventType.Error) {
    isStreaming.value = false
    chatSending.value = false
    stopDenyCountdown()
    stopAskCountdown()
    pendingToolCall.value = null
    pendingAsk.value = null
    queuedMessages.value = []
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
  stopAskCountdown()
  pendingToolCall.value = null
  pendingAsk.value = null
  queuedMessages.value = []
}

function cancelProcessing() {
  if (!props.cancelThreadId) return
  wsSend({ type: WsCommandType.Abort, threadId: props.cancelThreadId })
}

/** 组件卸载时调用，清理定时器 */
function cleanup() {
  stopDenyCountdown()
  stopAskCountdown()
}

function remainSeconds(startedAt: string, totalSeconds: number): number {
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  return Math.max(0, totalSeconds - elapsed)
}

/** 恢复后端 session 状态（切换 session 时调用） */
const queuedMessages = ref<string[]>([])

function restoreSessionStatus(status: {
  threadId: string
  pendingApproval?: { id: string; tool: { id?: string; name: string; args: Record<string, any> }; startedAt: string }
  pendingAsk?: { id: string; title?: string; questions: AskQuestion[]; startedAt: string }
  pendingMessages?: string[]
} | null) {
  stopDenyCountdown()
  stopAskCountdown()
  pendingToolCall.value = null
  pendingAsk.value = null
  askAnswers.value = {}
  askToggleValues.value = {}
  askCustomInputs.value = {}
  streamingContent.value = ''
  streamingToolCalls.value = []
  queuedMessages.value = []
  if (!status) {
    isStreaming.value = false
    chatSending.value = false
    return
  }
  isStreaming.value = true
  chatSending.value = true
  queuedMessages.value = status.pendingMessages ?? []
  if (status.pendingApproval) {
    const { tool, startedAt } = status.pendingApproval
    pendingToolCall.value = { id: status.pendingApproval.id, threadId: status.threadId, name: tool.name, args: tool.args }
    startDenyCountdown(remainSeconds(startedAt, 300))
  }
  if (status.pendingAsk) {
    const { startedAt, ...askInfo } = status.pendingAsk
    pendingAsk.value = { ...askInfo, threadId: status.threadId }
    initAskAnswers(askInfo.questions)
    startAskCountdown(remainSeconds(startedAt, 600))
  }
}

function addQueuedMessage(query: string) {
  queuedMessages.value.push(query)
}

defineExpose({ handleWsEvent, pushMessage, setSending, refreshHistory, clearHistory, scrollToBottom, reset, cleanup, restoreSessionStatus, addQueuedMessage })
</script>

<template>
  <div v-if="pendingAsk" class="ask-form">
    <div v-if="pendingAsk.title" class="ask-title">{{ pendingAsk.title }}</div>
    <div v-for="(q, i) in pendingAsk.questions" :key="i" class="ask-question">
      <div v-if="q.type !== 'toggle'" class="ask-label">{{ q.label }}</div>
      <div v-if="q.type === 'radio'" class="ask-options">
        <label v-for="opt in q.options" :key="opt" class="ask-option">
          <input type="radio" :name="`ask_${pendingAsk.id}_${i}`" :value="opt" v-model="askAnswers[i]" />
          {{ opt }}
        </label>
        <template v-if="q.allowCustom">
          <label class="ask-option">
            <input type="radio" :name="`ask_${pendingAsk.id}_${i}`" :value="CUSTOM_SENTINEL" v-model="askAnswers[i]" />
            {{ t('chat.ask_other') }}
          </label>
          <input v-if="askAnswers[i] === CUSTOM_SENTINEL" type="text" class="ask-input ask-custom-input"
            v-model="askCustomInputs[i]" :placeholder="t('chat.ask_other_placeholder')" />
        </template>
      </div>
      <div v-else-if="q.type === 'checkbox'" class="ask-options">
        <label v-for="opt in q.options" :key="opt" class="ask-option">
          <input type="checkbox" :value="opt" v-model="(askAnswers[i] as string[])" />
          {{ opt }}
        </label>
        <template v-if="q.allowCustom">
          <label class="ask-option">
            <input type="checkbox" :value="CUSTOM_SENTINEL" v-model="(askAnswers[i] as string[])" />
            {{ t('chat.ask_other') }}
          </label>
          <input v-if="(askAnswers[i] as string[]).includes(CUSTOM_SENTINEL)" type="text" class="ask-input ask-custom-input"
            v-model="askCustomInputs[i]" :placeholder="t('chat.ask_other_placeholder')" />
        </template>
      </div>
      <label v-else-if="q.type === 'toggle'" class="ask-option ask-toggle">
        <input type="checkbox" v-model="askToggleValues[i]" />
        {{ q.label }}
      </label>
      <input v-else type="text" class="ask-input" v-model="(askAnswers[i] as string)"
        :placeholder="(q as any).placeholder ?? ''" />
    </div>
    <div class="ask-footer">
      <button class="btn-primary btn-sm" @click="submitAsk">{{ t('chat.ask_submit') }} ({{ askCountdown }}s)</button>
    </div>
  </div>

  <div v-if="pendingToolCall" class="tool-approval-bar">
    <div class="tool-approval-top">
      <span class="tool-approval-label">{{ t('chat.execute_tool') }}<strong>{{ pendingToolCall.name }}</strong></span>
      <div class="tool-approval-btns">
        <button class="btn-primary btn-sm" @click="approveToolCall('allow')">{{ t('chat.allow') }}</button>
        <button class="btn-outline btn-sm" @click="approveToolCall('alwaysArgs')">{{ t('chat.always_allow_args') }}</button>
        <button class="btn-outline btn-sm" @click="approveToolCall('alwaysTool')">{{ t('chat.always_allow_all') }}</button>
        <button class="btn-danger btn-sm" @click="approveToolCall('deny')">{{ t('chat.deny') }} ({{ denyCountdown }}s)</button>
      </div>
    </div>
    <div v-if="Object.keys(pendingToolCall.args).length" class="tool-approval-args" @click="argsExpanded = !argsExpanded">
      <span class="args-toggle">{{ argsExpanded ? '▾' : '▸' }}</span>
      <template v-if="!argsExpanded">
        <span v-for="[k, v] in Object.entries(pendingToolCall.args)" :key="k" class="args-kv">
          <span class="args-key">{{ k }}:</span>
          <span class="args-val">{{ formatArgVal(v) }}</span>
        </span>
      </template>
      <pre v-else class="args-full" @click.stop>{{ JSON.stringify(pendingToolCall.args, null, 2) }}</pre>
    </div>
  </div>
  <ChatPanel
    ref="chatPanelRef"
    :messages="messages"
    :is-streaming="isStreaming"
    :streaming-content="streamingContent"
    :streaming-tool-calls="streamingToolCalls"
    :chat-sending="chatSending"
    :queued-messages="queuedMessages"
    :empty-text="emptyText"
    :show-attachments="showAttachments"
    :on-cancel="cancelThreadId && isStreaming ? cancelProcessing : undefined"
    @send="(q, a) => emit('send', q, a)"
  />
</template>

<style scoped>
.tool-approval-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px;
  background: #fffbeb;
  border-bottom: 1px solid #fcd34d;
  flex-shrink: 0;
  font-size: 13px;
}
.tool-approval-top   { display: flex; align-items: center; gap: 10px; }
.tool-approval-label { flex: 1; min-width: 0; }
.tool-approval-btns  { display: flex; gap: 6px; flex-shrink: 0; }
.tool-approval-args {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 4px 8px;
  background: #fef9c3;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.args-toggle { color: #92400e; flex-shrink: 0; }
.args-kv     { display: inline-flex; gap: 3px; }
.args-key    { color: #78350f; font-weight: 500; }
.args-val    { color: #44403c; font-family: monospace; word-break: break-all; }
.args-full   {
  margin: 4px 0 0;
  width: 100%;
  padding: 6px 8px;
  background: #fef3c7;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  cursor: text;
  user-select: text;
}

/* ── Ask 表单 ──────────────────────────────────────────── */
.ask-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  background: #f0f9ff;
  border-bottom: 1px solid #7dd3fc;
  flex-shrink: 0;
  font-size: 13px;
  max-height: 50vh;
  overflow-y: auto;
}
.ask-title    { font-weight: 600; font-size: 14px; color: #0c4a6e; }
.ask-question { display: flex; flex-direction: column; gap: 6px; }
.ask-label    { font-weight: 500; color: #075985; }
.ask-options  { display: flex; flex-direction: column; gap: 4px; }
.ask-option   { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.ask-option input { cursor: pointer; }
.ask-input {
  padding: 5px 8px;
  border: 1px solid #bae6fd;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  background: #fff;
}
.ask-input:focus { border-color: #38bdf8; }
.ask-custom-input { margin-top: 4px; margin-left: 20px; }
.ask-toggle { font-weight: 500; color: #075985; }
.ask-footer { display: flex; justify-content: flex-end; padding-top: 4px; }
</style>
