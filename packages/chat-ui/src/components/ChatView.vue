<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  ChatLabels, SessionItem, AppSettings,
  StoredMessage, UsageInfo, ContentPart, Attachment,
  ToolCallEvent, ToolApprovalPayload,
  AskEvent, AskAnswerPayload,
  DisplayContent, ChatEvent,
} from '../types'
import { MessageRole, ChatEventType } from '../types'
import type { IChatTransport } from '../transport'
import { resolveLabels } from '../labels'
import { useCompactProvider } from '../composables/useCompact'
import SessionBar from './SessionBar.vue'
import ConfigToolbar from './ConfigToolbar.vue'
import StatusBar from './StatusBar.vue'
import ChatArea from './ChatArea.vue'
import PathPickerModal from './PathPickerModal.vue'

const props = withDefaults(defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
  showAttachments?: boolean
  alwaysCompact?: boolean
}>(), {
  showAttachments: true,
  alwaysCompact: false,
})

const L = computed(() => resolveLabels(props.labels))

// ── Core state ──

const sessions = ref<SessionItem[]>([])
const activeSessionId = ref<string | null>(null)
const settings = ref<AppSettings>({ agents: {}, savers: {}, memories: {}, wikis: {} })

const messages = ref<StoredMessage[]>([])
const isStreaming = ref(false)
const streamingContent = ref<string | any[]>('')
const queuedMessages = ref<DisplayContent[]>([])

const pendingToolCall = ref<ToolCallEvent | null>(null)
const pendingAsk = ref<AskEvent | null>(null)
const usage = ref<UsageInfo | null>(null)

// ── Refs ──

const chatAreaRef = ref<InstanceType<typeof ChatArea>>()
const pathPickerRef = ref<InstanceType<typeof PathPickerModal>>()
const rootEl = ref<HTMLElement | null>(null)
const isCompact = useCompactProvider(rootEl)
const sidebarOpen = ref(false)

// ── Derived ──

const activeSession = computed<SessionItem | null>(() => {
  if (!activeSessionId.value) return null
  return sessions.value.find(s => s.id === activeSessionId.value) ?? null
})

const hasSaver = computed(() => activeSession.value != null)

const thinksUrlPrefix = computed(() => {
  if (!activeSessionId.value) return null
  return props.transport.getThinksUrlPrefix(activeSessionId.value)
})

const contextWindow = computed(() => {
  const s = activeSession.value
  if (!s?.agent) return undefined
  const agentEntry = settings.value.agents?.[s.agent]
  const modelId = (agentEntry as any)?.model as string | undefined
  if (!modelId) return undefined
  const mc = (settings.value as any).models?.[modelId]
  return mc?.contextWindow as number | undefined
})

// ── Countdown timers ──

let denyTimer: ReturnType<typeof setInterval> | null = null
let askTimer: ReturnType<typeof setInterval> | null = null

function stopDenyTimer() { if (denyTimer) { clearInterval(denyTimer); denyTimer = null } }
function stopAskTimer() { if (askTimer) { clearInterval(askTimer); askTimer = null } }

// ── Event handler ──

function handleEvent(evt: ChatEvent) {
  if ('sessionId' in evt && evt.sessionId !== activeSessionId.value) return
  const d = (evt as any).data
  switch (evt.type) {
    case ChatEventType.ConnectionStatus:
      if (!evt.online) resetStreamState()
      break
    case ChatEventType.Human:
      isStreaming.value = true
      if (queuedMessages.value.length > 0) queuedMessages.value.shift()
      messages.value.push({ message: { role: MessageRole.Human, content: d.content }, createdAt: Date.now() / 1000 })
      nextTick(() => chatAreaRef.value?.scrollToBottom(true))
      break
    case ChatEventType.Stream:
      streamingContent.value = d.content
      break
    case ChatEventType.Message: {
      const msg: StoredMessage = { message: d.message, createdAt: d.createdAt ?? Date.now() / 1000 }
      if (d.thinkId) msg.thinkId = d.thinkId
      messages.value.push(msg)
      streamingContent.value = ''
      break
    }
    case ChatEventType.ToolCall:
      pendingToolCall.value = d as ToolCallEvent
      break
    case ChatEventType.Ask:
      pendingAsk.value = d as AskEvent
      break
    case ChatEventType.Queue:
      if (queuedMessages.value.length === 0 && d.pendingMessages?.length > 0) {
        queuedMessages.value = d.pendingMessages
      }
      break
    case ChatEventType.Done:
      if (d?.pendingMessages) queuedMessages.value = d.pendingMessages
      stopDenyTimer()
      stopAskTimer()
      pendingToolCall.value = null
      pendingAsk.value = null
      if (queuedMessages.value.length === 0) isStreaming.value = false
      loadUsage()
      break
    case ChatEventType.Error:
      isStreaming.value = false
      stopDenyTimer()
      stopAskTimer()
      pendingToolCall.value = null
      pendingAsk.value = null
      queuedMessages.value = []
      break
    case ChatEventType.Usage:
      if (usage.value) {
        usage.value.lastInputTokens = d.inputTokens
        usage.value.lastOutputTokens = d.outputTokens
        usage.value.lastTotalTokens = d.totalTokens
        usage.value.inputTokens += d.inputTokens
        usage.value.outputTokens += d.outputTokens
        usage.value.totalTokens += d.totalTokens
        usage.value.cacheCreationTokens = (usage.value.cacheCreationTokens ?? 0) + (d.cacheCreationTokens ?? 0)
        usage.value.cacheReadTokens = (usage.value.cacheReadTokens ?? 0) + (d.cacheReadTokens ?? 0)
      } else {
        usage.value = {
          inputTokens: d.inputTokens, outputTokens: d.outputTokens, totalTokens: d.totalTokens,
          lastInputTokens: d.inputTokens, lastOutputTokens: d.outputTokens, lastTotalTokens: d.totalTokens,
          cacheCreationTokens: d.cacheCreationTokens ?? 0, cacheReadTokens: d.cacheReadTokens ?? 0,
        }
      }
      break
  }
}

function resetStreamState() {
  isStreaming.value = false
  streamingContent.value = ''
  stopDenyTimer()
  stopAskTimer()
  pendingToolCall.value = null
  pendingAsk.value = null
  queuedMessages.value = []
}

// ── Session actions ──

async function selectSession(id: string) {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
}

watch(activeSessionId, async (id) => {
  resetStreamState()
  messages.value = []
  usage.value = null
  if (!id) return
  await Promise.all([loadHistory(), loadUsage(), restoreSessionStatus()])
})

async function loadHistory() {
  const id = activeSessionId.value
  if (!id) return
  try {
    messages.value = await props.transport.getHistory(id)
    await nextTick()
    chatAreaRef.value?.scrollToBottom(true)
  } catch (e) {
    console.error('[ChatView] loadHistory', e)
  }
}

async function loadUsage() {
  const id = activeSessionId.value
  if (!id) { usage.value = null; return }
  try {
    usage.value = await props.transport.getUsage(id)
  } catch { usage.value = null }
}

async function restoreSessionStatus() {
  const id = activeSessionId.value
  if (!id) return
  try {
    const status = await props.transport.getSessionStatus(id)
    if (!status) { isStreaming.value = false; return }
    isStreaming.value = true
    queuedMessages.value = status.pendingMessages ?? []
    if (status.pendingApproval) {
      pendingToolCall.value = {
        approvalId: status.pendingApproval.id,
        name: status.pendingApproval.tool.name,
        args: status.pendingApproval.tool.args,
      }
    }
    if (status.pendingAsk) {
      pendingAsk.value = status.pendingAsk
    }
  } catch (e) {
    console.error('[ChatView] restoreSessionStatus', e)
  }
}

async function onDeleteSession(id: string) {
  try {
    await props.transport.deleteSession(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value.length > 0 ? sessions.value[0].id : null
    }
  } catch (e) {
    console.error('[ChatView] deleteSession', e)
  }
}

async function onRenameSession(id: string, name: string) {
  try {
    await props.transport.updateSession(id, { name })
    const s = sessions.value.find(s => s.id === id)
    if (s) s.name = name
  } catch (e) {
    console.error('[ChatView] renameSession', e)
  }
}

async function createNewSession() {
  try {
    const d = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const name = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const res = await props.transport.createSession({ name })
    const list = await props.transport.listSessions()
    sessions.value = list
    activeSessionId.value = res.id
  } catch {}
}

// ── Config updates ──

async function onUpdateConfig(field: string, value: any) {
  const id = activeSessionId.value
  if (!id) return
  try {
    await props.transport.updateSession(id, { [field]: value })
    const s = sessions.value.find(s => s.id === id)
    if (s) (s as any)[field] = value
  } catch (e) {
    console.error('[ChatView] updateConfig', e)
  }
}

function onOpenPathPicker(currentPath: string) {
  pathPickerRef.value?.open(currentPath)
}

function onPathConfirmed(path: string) {
  onUpdateConfig('workPath', path || undefined)
}

// ── Chat actions ──

function onSend(parts: ContentPart[], attachments: Attachment[]) {
  const id = activeSessionId.value
  if (!id || !hasSaver.value) return
  if (parts.length === 0 && attachments.length === 0) return
  queuedMessages.value.push(
    parts.map(p => p.type === 'text' ? (p as any).text : '').filter(Boolean).join('\n') || '[attachment]'
  )
  isStreaming.value = true
  props.transport.sendMessage(id, parts, attachments.length > 0 ? attachments : undefined)
}

function onApprove(payload: ToolApprovalPayload) {
  const id = activeSessionId.value
  if (!id) return
  stopDenyTimer()
  pendingToolCall.value = null
  props.transport.approveToolCall(id, payload)
}

function onAnswer(payload: AskAnswerPayload) {
  const id = activeSessionId.value
  if (!id) return
  stopAskTimer()
  pendingAsk.value = null
  props.transport.answerAsk(id, payload)
}

function onAbort() {
  const id = activeSessionId.value
  if (!id) return
  props.transport.abort(id)
  isStreaming.value = false
  streamingContent.value = ''
}

// ── Status bar actions ──

async function onRefresh() {
  await Promise.all([loadHistory(), loadUsage()])
}

async function onClearHistory() {
  const id = activeSessionId.value
  if (!id || !window.confirm(L.value.confirmClearHistory)) return
  try {
    await props.transport.clearHistory(id)
    messages.value = []
  } catch (e) {
    console.error('[ChatView] clearHistory', e)
  }
}

// ── Lifecycle ──

onMounted(async () => {
  props.transport.onEvent(handleEvent)
  props.transport.connect()
  try {
    const [s, cfg] = await Promise.all([
      props.transport.listSessions(),
      props.transport.getSettings(),
    ])
    sessions.value = s
    settings.value = cfg
    if (s.length > 0 && !activeSessionId.value) {
      activeSessionId.value = s[0].id
    }
  } catch (e) {
    console.error('[ChatView] init', e)
  }
})

onBeforeUnmount(() => {
  props.transport.offEvent(handleEvent)
  props.transport.disconnect()
  stopDenyTimer()
  stopAskTimer()
})

const fetchThinks = computed(() => props.transport.fetchThinks?.bind(props.transport))
</script>

<template>
  <div ref="rootEl" class="chatui-root" :class="{ 'chatui-compact': isCompact || alwaysCompact }">
    <!-- Compact mode (narrow screen or alwaysCompact): hamburger + drawer -->
    <template v-if="isCompact || alwaysCompact">
      <div class="chatui-compact-header">
        <button class="chatui-hamburger" @click="sidebarOpen = !sidebarOpen">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <rect x="2" y="4" width="16" height="2" rx="1"/>
            <rect x="2" y="9" width="16" height="2" rx="1"/>
            <rect x="2" y="14" width="16" height="2" rx="1"/>
          </svg>
        </button>
        <span class="chatui-compact-title">{{ activeSession?.name || activeSession?.id?.slice(0, 8) || '' }}</span>
      </div>
      <Transition name="chatui-drawer">
        <div v-if="sidebarOpen" class="chatui-drawer-backdrop" @click="sidebarOpen = false">
          <div class="chatui-drawer" @click.stop>
            <SessionBar
              :sessions="sessions"
              :active-session-id="activeSessionId"
              :labels="labels"
              @select="(id: string) => { selectSession(id); sidebarOpen = false }"
              @delete="onDeleteSession"
              @rename="onRenameSession"
              @new-session="createNewSession"
            />
          </div>
        </div>
      </Transition>
    </template>

    <!-- Non-compact: static sidebar -->
    <SessionBar
      v-else
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :labels="labels"
      @select="selectSession"
      @delete="onDeleteSession"
      @rename="onRenameSession"
      @new-session="createNewSession"
    />

    <!-- Right panel -->
    <div class="chatui-main">
      <!-- Config toolbar -->
      <ConfigToolbar
        :session="activeSession"
        :settings="settings"
        :labels="labels"
        @update-config="onUpdateConfig"
        @open-path-picker="onOpenPathPicker"
      />

      <!-- Status bar -->
      <StatusBar
        v-if="activeSessionId"
        :usage="usage"
        :context-window="contextWindow"
        :labels="labels"
        :has-saver="hasSaver"
        @refresh="onRefresh"
        @clear-history="onClearHistory"
      />

      <!-- Chat area -->
      <ChatArea
        ref="chatAreaRef"
        :messages="messages"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :queued-messages="queuedMessages"
        :pending-tool-call="pendingToolCall"
        :pending-ask="pendingAsk"
        :thinks-url-prefix="thinksUrlPrefix"
        :labels="labels"
        :show-attachments="showAttachments"
        :has-saver="hasSaver"
        :fetch-thinks="fetchThinks"
        @send="onSend"
        @approve="onApprove"
        @answer="onAnswer"
        @abort="onAbort"
      />
    </div>

    <!-- Modals -->
    <PathPickerModal
      ref="pathPickerRef"
      :transport="transport"
      :labels="labels"
      @confirm="onPathConfirmed"
    />
  </div>
</template>

<style scoped>
.chatui-root {
  display: flex; height: 100%; overflow: hidden;
  font-family: var(--chatui-font-family);
  font-size: var(--chatui-font-size);
  color: var(--chatui-fg);
  background: var(--chatui-bg);
}
.chatui-root.chatui-compact {
  flex-direction: column;
}
.chatui-main {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  min-width: 0;
}

/* Compact header */
.chatui-compact-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-hamburger {
  background: none; border: none; cursor: pointer;
  color: var(--chatui-fg); padding: 4px; display: flex;
  border-radius: 4px;
  flex-shrink: 0;
}
.chatui-hamburger:hover { background: var(--chatui-bg-hover); }
.chatui-compact-title {
  font-size: 13px; font-weight: 600; color: var(--chatui-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}

/* Drawer overlay (drawer mode) */
.chatui-drawer-backdrop {
  position: fixed; inset: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.4);
}
.chatui-drawer {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: 240px; z-index: 100;
}
.chatui-drawer :deep(.chatui-session-bar) {
  width: 100%; height: 100%;
}

/* Drawer transitions */
.chatui-drawer-enter-active,
.chatui-drawer-leave-active {
  transition: opacity 0.25s ease;
}
.chatui-drawer-enter-active .chatui-drawer,
.chatui-drawer-leave-active .chatui-drawer {
  transition: transform 0.25s ease;
}
.chatui-drawer-enter-from,
.chatui-drawer-leave-to {
  opacity: 0;
}
.chatui-drawer-enter-from .chatui-drawer,
.chatui-drawer-leave-to .chatui-drawer {
  transform: translateX(-100%);
}
</style>
