<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import ChatPanel from './ChatPanel.vue'
import { MessageRole } from '@sbot/chat-ui'
import type { ContentPart, StoredMessage, Attachment } from '@sbot/chat-ui'
import { WebChatEventType, WsCommandType, AskQuestionType } from 'sbot.commons'
import type { WebChatEvent, AskQuestionSpec } from 'sbot.commons'

const props = withDefaults(defineProps<{
  historyUrl: string | null
  showAttachments?: boolean
  /** sessionId，有值时显示中断按钮 */
  cancelSessionId?: string
}>(), {
})

const emit = defineEmits<{
  send: [parts: ContentPart[], fileAttachments: Attachment[]]
}>()

const { t } = useI18n()
const { show } = useToast()
const { send: wsSend } = useChatSocket()

const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

const thinksUrlPrefix = computed<string | null>(() => {
  if (!props.historyUrl) return null
  return props.historyUrl.replace(/\/history$/, '/thinks')
})

// ── 聊天状态 ──────────────────────────────────────────────
const messages           = ref<StoredMessage[]>([])
const isStreaming        = ref(false)
const streamingContent   = ref<string | any[]>('')

// ── Ask 表单状态 ──────────────────────────────────────────
const pendingAsk        = ref<{ id: string; title?: string; questions: AskQuestionSpec[] } | null>(null)
const askAnswers        = ref<Record<number, string | string[]>>({})
const askCustomInputs   = ref<Record<number, string>>({})

const CUSTOM_SENTINEL = '__custom__'

function initAskAnswers(questions: AskQuestionSpec[]) {
  const init: Record<number, string | string[]> = {}
  questions.forEach((q, i) => {
    if (q.type === AskQuestionType.Checkbox) init[i] = []
  })
  askAnswers.value = init
  askCustomInputs.value = {}
}
const askCountdown    = ref(600)

function submitAsk() {
  if (!pendingAsk.value) return
  const answers: Record<string, string | string[]> = {}
  pendingAsk.value.questions.forEach((q, i) => {
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
  const { id } = pendingAsk.value
  pendingAsk.value = null
  askAnswers.value = {}
  askCustomInputs.value = {}
  wsSend({ type: WsCommandType.Ask, sessionId: props.cancelSessionId, id, answers })
}

// ── 工具审批状态 ──────────────────────────────────────────
const pendingToolCall = ref<{ approvalId: string; name: string; args: Record<string, any> } | null>(null)
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
  const { approvalId } = pendingToolCall.value
  pendingToolCall.value = null
  wsSend({ type: WsCommandType.Approval, sessionId: props.cancelSessionId, id: approvalId, approval })
}

// ── 历史记录 ──────────────────────────────────────────────
async function refreshHistory() {
  const url = props.historyUrl
  if (!url) { messages.value = []; return }
  try {
    const res = await apiFetch(url)
    messages.value = res.data || []
    await nextTick()
    chatPanelRef.value?.scrollToBottom(true)
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
  console.log('[ws]', evt.type, evt.data)
  const d = evt.data as any
  if (evt.type === WebChatEventType.Human) {
    isStreaming.value = true
    // 从排队列表移除当前消息（与 push 到 messages 同步，避免空窗期）
    if (queuedMessages.value.length > 0) queuedMessages.value.shift()
    messages.value.push({ message: { role: MessageRole.Human, content: d.content }, createdAt: Date.now() / 1000 })
    await nextTick()
    chatPanelRef.value?.scrollToBottom(true)
  } else if (evt.type === WebChatEventType.Stream) {
    streamingContent.value = d.content
  } else if (evt.type === WebChatEventType.Message) {
    const msg: StoredMessage = { message: d.message, createdAt: d.createdAt ?? Date.now() / 1000 }
    if (d.thinkId) msg.thinkId = d.thinkId
    messages.value.push(msg)
    streamingContent.value = ''
  } else if (evt.type === WebChatEventType.ToolCall) {
    pendingToolCall.value = { approvalId: d.approvalId, name: d.name, args: d.args }
    startDenyCountdown()
  } else if (evt.type === WebChatEventType.Ask) {
    pendingAsk.value = { id: d.id, title: d.title, questions: d.questions as AskQuestionSpec[] }
    initAskAnswers(d.questions as AskQuestionSpec[])
    startAskCountdown()
  } else if (evt.type === WebChatEventType.Queue) {
    // Queue 事件仅用于补充服务端额外的排队消息（如恢复连接后），
    // 不覆盖客户端乐观队列，避免与 Human shift 冲突
    if (queuedMessages.value.length === 0 && d.pendingMessages.length > 0) {
      queuedMessages.value = d.pendingMessages
    }
  } else if (evt.type === WebChatEventType.Done) {
    if (d.pendingMessages) {
      queuedMessages.value = d.pendingMessages
    }
    stopDenyCountdown()
    stopAskCountdown()
    pendingToolCall.value = null
    pendingAsk.value = null
    if (queuedMessages.value.length === 0) {
      isStreaming.value = false
    }
  } else if (evt.type === WebChatEventType.Error) {
    isStreaming.value = false
    stopDenyCountdown()
    stopAskCountdown()
    pendingToolCall.value = null
    pendingAsk.value = null
    queuedMessages.value = []
  }
}

// ── 公开接口 ──────────────────────────────────────────────
function scrollToBottom(force?: boolean) {
  chatPanelRef.value?.scrollToBottom(force)
}

/** 重置流式/发送状态（ws 断连时调用） */
function reset() {
  isStreaming.value = false
  stopDenyCountdown()
  stopAskCountdown()
  pendingToolCall.value = null
  pendingAsk.value = null
  queuedMessages.value = []
}

function cancelProcessing() {
  if (!props.cancelSessionId) return
  wsSend({ type: WsCommandType.Abort, sessionId: props.cancelSessionId })
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
const queuedMessages = ref<(string | any[])[]>([])

function restoreSessionStatus(status: {
  pendingApproval?: { id: string; tool: { id?: string; name: string; args: Record<string, any> }; startedAt: string }
  pendingAsk?: { id: string; title?: string; questions: AskQuestionSpec[]; startedAt: string }
  pendingMessages?: (string | any[])[]
} | null) {
  stopDenyCountdown()
  stopAskCountdown()
  pendingToolCall.value = null
  pendingAsk.value = null
  askAnswers.value = {}
  askCustomInputs.value = {}
  streamingContent.value = ''
  queuedMessages.value = []
  if (!status) {
    isStreaming.value = false
    return
  }
  isStreaming.value = true
  queuedMessages.value = status.pendingMessages ?? []
  if (status.pendingApproval) {
    const { tool, startedAt } = status.pendingApproval
    pendingToolCall.value = { approvalId: status.pendingApproval.id, name: tool.name, args: tool.args }
    startDenyCountdown(remainSeconds(startedAt, 300))
  }
  if (status.pendingAsk) {
    const { startedAt, ...askInfo } = status.pendingAsk
    pendingAsk.value = askInfo
    initAskAnswers(askInfo.questions)
    startAskCountdown(remainSeconds(startedAt, 600))
  }
}

function addQueuedMessage(query: string | any[]) {
  queuedMessages.value.push(query)
}

defineExpose({ handleWsEvent, refreshHistory, clearHistory, scrollToBottom, reset, cleanup, restoreSessionStatus, addQueuedMessage })
</script>

<template>
  <div v-if="pendingAsk" class="ask-form">
    <div v-if="pendingAsk.title" class="ask-title">{{ pendingAsk.title }}</div>
    <div v-for="(q, i) in pendingAsk.questions" :key="i" class="ask-question">
      <div class="ask-label">{{ q.label }}</div>
      <div v-if="q.type === AskQuestionType.Radio" class="ask-options">
        <label v-for="opt in q.options" :key="opt" class="ask-option">
          <input type="radio" :name="`ask_${pendingAsk.id}_${i}`" :value="opt" v-model="askAnswers[i]" />
          {{ opt }}
        </label>
        <label class="ask-option">
          <input type="radio" :name="`ask_${pendingAsk.id}_${i}`" :value="CUSTOM_SENTINEL" v-model="askAnswers[i]" />
          {{ t('chat.ask_other') }}
        </label>
        <input v-if="askAnswers[i] === CUSTOM_SENTINEL" type="text" class="ask-input ask-custom-input"
          v-model="askCustomInputs[i]" :placeholder="t('chat.ask_other_placeholder')" />
      </div>
      <div v-else-if="q.type === AskQuestionType.Checkbox" class="ask-options">
        <label v-for="opt in q.options" :key="opt" class="ask-option">
          <input type="checkbox" :value="opt" v-model="(askAnswers[i] as string[])" />
          {{ opt }}
        </label>
        <label class="ask-option">
          <input type="checkbox" :value="CUSTOM_SENTINEL" v-model="(askAnswers[i] as string[])" />
          {{ t('chat.ask_other') }}
        </label>
        <input v-if="(askAnswers[i] as string[]).includes(CUSTOM_SENTINEL)" type="text" class="ask-input ask-custom-input"
          v-model="askCustomInputs[i]" :placeholder="t('chat.ask_other_placeholder')" />
      </div>
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
:queued-messages="queuedMessages"
    :show-attachments="showAttachments"
    :on-cancel="cancelSessionId && isStreaming ? cancelProcessing : undefined"
    :thinks-url-prefix="thinksUrlPrefix"
    @send="(parts, fileAtts) => emit('send', parts, fileAtts)"
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
.ask-footer { display: flex; justify-content: flex-end; padding-top: 4px; }

@media (max-width: 768px) {
  .msg-bubble {
    max-width: 95% !important;
  }
  .ask-form {
    max-height: 60vh;
  }
  .tool-approval-bar {
    flex-wrap: wrap;
  }
  .tool-approval-btns {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
