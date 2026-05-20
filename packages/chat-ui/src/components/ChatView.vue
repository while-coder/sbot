<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  ChatLabels, SessionItem, AppSettings,
  StoredMessage, UsageInfo, UsageData, ContentPart, Attachment,
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

const sessions          = ref<SessionItem[]>([])
const activeSessionId   = ref<string | null>(null)
const settings          = ref<AppSettings>({ agents: {}, savers: {}, memories: {}, wikis: {} })

const messages          = ref<StoredMessage[]>([])
const isStreaming       = ref(false)
const streamingContent  = ref<DisplayContent>('')
const queuedMessages    = ref<DisplayContent[]>([])
const showCompacted     = ref(false)

const pendingToolCall   = ref<ToolCallEvent | null>(null)
const pendingAsk        = ref<AskEvent | null>(null)
const usage             = ref<UsageInfo | null>(null)

/** Monotonic counter to discard stale async loads when switching sessions quickly. */
let loadGeneration = 0

// ── Refs ──

const chatAreaRef   = ref<InstanceType<typeof ChatArea>>()
const pathPickerRef = ref<InstanceType<typeof PathPickerModal>>()
const rootEl        = ref<HTMLElement | null>(null)
const isCompact     = useCompactProvider(rootEl)
const sidebarOpen   = ref(false)

// ── Derived ──

const activeSession = computed<SessionItem | null>(
  () => sessions.value.find(s => s.id === activeSessionId.value) ?? null,
)

const hasSaver = computed(() => activeSession.value != null)

const thinksUrlPrefix = computed(() =>
  activeSessionId.value ? props.transport.getThinksUrlPrefix(activeSessionId.value) : null,
)

const contextWindow = computed<number | undefined>(() => {
  const agentId = activeSession.value?.agent
  const modelId = agentId ? settings.value.agents?.[agentId]?.model : undefined
  return modelId ? settings.value.models?.[modelId]?.contextWindow : undefined
})

const fetchThinks = computed(() => props.transport.fetchThinks?.bind(props.transport))

const compactedCount = computed(() => messages.value.filter(m => m.compacted).length)
const displayedMessages = computed<StoredMessage[]>(() =>
  showCompacted.value ? messages.value : messages.value.filter(m => !m.compacted),
)

// ── Event handler ──

function handleEvent(evt: ChatEvent) {
  if ('sessionId' in evt && evt.sessionId !== activeSessionId.value) return
  switch (evt.type) {
    case ChatEventType.ConnectionStatus:
      if (!evt.online) resetStreamState()
      break
    case ChatEventType.Human:
      isStreaming.value = true
      if (queuedMessages.value.length > 0) queuedMessages.value.shift()
      messages.value.push({ message: { role: MessageRole.Human, content: evt.data.content }, createdAt: Date.now() / 1000 })
      nextTick(() => chatAreaRef.value?.scrollToBottom(true))
      break
    case ChatEventType.Stream:
      streamingContent.value = evt.data.content
      break
    case ChatEventType.Message: {
      const { message, createdAt, thinkId } = evt.data
      const msg: StoredMessage = { message, createdAt: createdAt ?? Date.now() / 1000 }
      if (thinkId) msg.thinkId = thinkId
      messages.value.push(msg)
      streamingContent.value = ''
      break
    }
    case ChatEventType.ToolCall:
      pendingToolCall.value = evt.data
      break
    case ChatEventType.Ask:
      pendingAsk.value = evt.data
      break
    case ChatEventType.Queue:
      // Only adopt the server's view when the client doesn't already have a local queue.
      if (queuedMessages.value.length === 0 && evt.data.pendingMessages?.length) {
        queuedMessages.value = filterPendingCommands(evt.data.pendingMessages)
      }
      break
    case ChatEventType.Done:
      if (evt.data?.pendingMessages) {
        queuedMessages.value = filterPendingCommands(evt.data.pendingMessages)
      }
      pendingToolCall.value = null
      pendingAsk.value = null
      if (queuedMessages.value.length === 0) isStreaming.value = false
      loadUsage()
      break
    case ChatEventType.Error:
      resetStreamState()
      break
    case ChatEventType.Usage:
      usage.value = mergeUsage(usage.value, evt.data)
      break
  }
}

function mergeUsage(prev: UsageInfo | null, d: UsageData): UsageInfo {
  if (!prev) {
    return {
      inputTokens:  d.inputTokens,
      outputTokens: d.outputTokens,
      totalTokens:  d.totalTokens,
      lastInputTokens:  d.inputTokens,
      lastOutputTokens: d.outputTokens,
      lastTotalTokens:  d.totalTokens,
      cacheCreationTokens: d.cacheCreationTokens ?? 0,
      cacheReadTokens:     d.cacheReadTokens ?? 0,
    }
  }
  return {
    ...prev,
    lastInputTokens:     d.inputTokens,
    lastOutputTokens:    d.outputTokens,
    lastTotalTokens:     d.totalTokens,
    inputTokens:         prev.inputTokens  + d.inputTokens,
    outputTokens:        prev.outputTokens + d.outputTokens,
    totalTokens:         prev.totalTokens  + d.totalTokens,
    cacheCreationTokens: (prev.cacheCreationTokens ?? 0) + (d.cacheCreationTokens ?? 0),
    cacheReadTokens:     (prev.cacheReadTokens     ?? 0) + (d.cacheReadTokens     ?? 0),
  }
}

function resetStreamState() {
  isStreaming.value = false
  streamingContent.value = ''
  pendingToolCall.value = null
  pendingAsk.value = null
  queuedMessages.value = []
}

// ── Session actions ──

function selectSession(id: string) {
  if (activeSessionId.value !== id) activeSessionId.value = id
}

watch(activeSessionId, async (id) => {
  const gen = ++loadGeneration
  resetStreamState()
  messages.value = []
  usage.value = null
  showCompacted.value = false
  if (!id) return
  await Promise.all([loadHistory(gen), loadUsage(gen), restoreSessionStatus(gen)])
})

async function loadHistory(gen = ++loadGeneration) {
  const id = activeSessionId.value
  if (!id) return
  try {
    const data = await props.transport.getHistory(id)
    if (gen !== loadGeneration) return
    messages.value = data
    await nextTick()
    chatAreaRef.value?.scrollToBottom(true)
  } catch (e) {
    console.error('[ChatView] loadHistory', e)
  }
}

async function loadUsage(gen = ++loadGeneration) {
  const id = activeSessionId.value
  if (!id) { usage.value = null; return }
  try {
    const data = await props.transport.getUsage(id)
    if (gen !== loadGeneration) return
    usage.value = data
  } catch {
    if (gen === loadGeneration) usage.value = null
  }
}

async function restoreSessionStatus(gen = ++loadGeneration) {
  const id = activeSessionId.value
  if (!id) return
  try {
    const status = await props.transport.getSessionStatus(id)
    if (gen !== loadGeneration) return
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
    if (status.pendingAsk) pendingAsk.value = status.pendingAsk
  } catch (e) {
    console.error('[ChatView] restoreSessionStatus', e)
  }
}

async function onDeleteSession(id: string) {
  try {
    await props.transport.deleteSession(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id ?? null
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

function defaultSessionName(d = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function createNewSession() {
  try {
    const res = await props.transport.createSession({ name: defaultSessionName() })
    sessions.value = await props.transport.listSessions()
    activeSessionId.value = res.id
  } catch (e) {
    console.error('[ChatView] createSession', e)
  }
}

// ── Config updates ──

async function onUpdateConfig(field: string, value: unknown) {
  const id = activeSessionId.value
  if (!id) return
  try {
    await props.transport.updateSession(id, { [field]: value } as Partial<SessionItem>)
    const s = sessions.value.find(s => s.id === id) as Record<string, unknown> | undefined
    if (s) s[field] = value
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

const isCommandText = (text: string) => text.trimStart().startsWith('/')

function filterPendingCommands(pending: DisplayContent[]): DisplayContent[] {
  return pending.filter(m => !(typeof m === 'string' && isCommandText(m)))
}

function partsToDisplayText(parts: ContentPart[]): string {
  const text = parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .filter(Boolean)
    .join('\n')
  return text || '[attachment]'
}

function onSend(parts: ContentPart[], attachments: Attachment[]) {
  const id = activeSessionId.value
  if (!id || !hasSaver.value) return
  if (parts.length === 0 && attachments.length === 0) return
  const display = partsToDisplayText(parts)
  if (isCommandText(display)) {
    messages.value.push({ message: { role: MessageRole.Human, content: display }, createdAt: Date.now() / 1000 })
    nextTick(() => chatAreaRef.value?.scrollToBottom(true))
  } else {
    queuedMessages.value.push(display)
  }
  isStreaming.value = true
  props.transport.sendMessage(id, parts, attachments.length > 0 ? attachments : undefined)
}

function onApprove(payload: ToolApprovalPayload) {
  const id = activeSessionId.value
  if (!id) return
  pendingToolCall.value = null
  props.transport.approveToolCall(id, payload)
}

function onAnswer(payload: AskAnswerPayload) {
  const id = activeSessionId.value
  if (!id) return
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
    if (s.length > 0 && !activeSessionId.value) activeSessionId.value = s[0].id
  } catch (e) {
    console.error('[ChatView] init', e)
  }
})

onBeforeUnmount(() => {
  props.transport.offEvent(handleEvent)
  props.transport.disconnect()
})
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
        :compacted-count="compactedCount"
        v-model:show-compacted="showCompacted"
        @refresh="onRefresh"
        @clear-history="onClearHistory"
      />

      <!-- Chat area -->
      <ChatArea
        ref="chatAreaRef"
        :messages="displayedMessages"
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
