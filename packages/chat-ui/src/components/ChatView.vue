<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  ChatLabels, SessionItem, AppSettings,
  StoredMessage, UsageInfo, UsageData, ContentPart, Attachment,
  ToolCallEvent, ToolApprovalPayload,
  AskEvent, AskAnswerPayload,
  DisplayContent, ChatEvent,
} from '../types'
import { MessageRole, ChatEventType, MessageKind } from '../types'
import type { IChatTransport } from '../transport'
import { resolveLabels } from '../labels'
import { useCompactProvider } from '../composables/useCompact'
import SessionBar from './SessionBar.vue'
import ConfigToolbar from './ConfigToolbar.vue'
import StatusBar from './StatusBar.vue'
import ChatArea from './ChatArea.vue'
import PathPickerModal from './PathPickerModal.vue'
import Explorer from './Explorer.vue'

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
const showArchived      = ref(false)

const pendingToolCall   = ref<ToolCallEvent | null>(null)
const pendingAsk        = ref<AskEvent | null>(null)
const usage             = ref<UsageInfo | null>(null)

/** Monotonic counter to discard stale async loads when switching sessions quickly. */
let loadGeneration = 0

// ── Refs ──

const chatAreaRef   = ref<InstanceType<typeof ChatArea>>()
const pathPickerRef = ref<InstanceType<typeof PathPickerModal>>()
const rootEl        = ref<HTMLElement | null>(null)
const contentEl     = ref<HTMLElement | null>(null)
const isCompact     = useCompactProvider(rootEl)
const sidebarOpen   = ref(false)
const settingsOpen  = ref(false)
const explorerOpen  = ref(false)
const explorerTouched = ref(false)
const explorerWidth = ref(420)
const explorerResizing = ref(false)
const sessionBarWidth = ref(180)
const sessionBarResizing = ref(false)

// ── Derived ──

const activeSession = computed<SessionItem | null>(
  () => sessions.value.find(s => s.id === activeSessionId.value) ?? null,
)

const hasSaver = computed(() => activeSession.value != null)

const thinksUrlPrefix = computed(() =>
  activeSessionId.value ? props.transport.getThinksUrlPrefix(activeSessionId.value) : null,
)

const tasksUrlPrefix = computed(() =>
  activeSessionId.value ? (props.transport.getTasksUrlPrefix?.(activeSessionId.value) ?? null) : null,
)

const contextWindow = computed<number | undefined>(() => {
  const agentId = activeSession.value?.agent
  const modelId = agentId ? settings.value.agents?.[agentId]?.model : undefined
  return modelId ? settings.value.models?.[modelId]?.contextWindow : undefined
})

const fetchThinks = computed(() => props.transport.fetchThinks?.bind(props.transport))

const archivedCount = computed(() => messages.value.filter(m => m.kind === MessageKind.Archive).length)
const displayedMessages = computed<StoredMessage[]>(() =>
  showArchived.value ? messages.value : messages.value.filter(m => m.kind !== MessageKind.Archive),
)

const explorerPaneStyle = computed(() =>
  isCompact.value || props.alwaysCompact
    ? undefined
    : { width: `${explorerWidth.value}px` },
)

const shouldAutoOpenExplorer = computed(() =>
  Boolean(activeSession.value?.workPath) && !isCompact.value && !props.alwaysCompact,
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
      messages.value.push({ message: { role: MessageRole.Human, content: evt.data.content }, createdAt: Date.now() / 1000, kind: MessageKind.Normal })
      nextTick(() => chatAreaRef.value?.scrollToBottom(true))
      break
    case ChatEventType.Stream:
      streamingContent.value = evt.data.content
      break
    case ChatEventType.Message: {
      const { message, createdAt, thinkId, taskId } = evt.data
      const msg: StoredMessage = { message, createdAt: createdAt ?? Date.now() / 1000, kind: MessageKind.Normal }
      if (thinkId) msg.thinkId = thinkId
      if (taskId) msg.taskId = taskId
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

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value) settingsOpen.value = false
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) sidebarOpen.value = false
}

function toggleExplorer() {
  explorerTouched.value = true
  explorerOpen.value = !explorerOpen.value
  if (explorerOpen.value && (isCompact.value || props.alwaysCompact)) {
    sidebarOpen.value = false
    settingsOpen.value = false
  }
}

function clampExplorerWidth(width: number): number {
  const contentWidth = contentEl.value?.clientWidth ?? 0
  if (contentWidth <= 0) return Math.max(280, width)
  const min = Math.min(280, Math.max(220, contentWidth * 0.35))
  const max = Math.max(min, contentWidth * 0.7)
  return Math.min(max, Math.max(min, width))
}

function startExplorerResize(e: PointerEvent) {
  if (isCompact.value || props.alwaysCompact) return
  e.preventDefault()
  explorerResizing.value = true
  window.addEventListener('pointermove', onExplorerResize)
  window.addEventListener('pointerup', stopExplorerResize, { once: true })
}

function onExplorerResize(e: PointerEvent) {
  if (!explorerResizing.value || !contentEl.value) return
  const rect = contentEl.value.getBoundingClientRect()
  explorerWidth.value = clampExplorerWidth(rect.right - e.clientX)
}

function stopExplorerResize() {
  explorerResizing.value = false
  window.removeEventListener('pointermove', onExplorerResize)
}

function clampSessionBarWidth(width: number): number {
  const rootWidth = rootEl.value?.clientWidth ?? 0
  const min = 140
  const max = rootWidth > 0 ? Math.max(min, rootWidth * 0.5) : 480
  return Math.min(max, Math.max(min, width))
}

function startSessionBarResize(e: PointerEvent) {
  if (isCompact.value || props.alwaysCompact) return
  e.preventDefault()
  sessionBarResizing.value = true
  window.addEventListener('pointermove', onSessionBarResize)
  window.addEventListener('pointerup', stopSessionBarResize, { once: true })
}

function onSessionBarResize(e: PointerEvent) {
  if (!sessionBarResizing.value || !rootEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  sessionBarWidth.value = clampSessionBarWidth(e.clientX - rect.left)
}

function stopSessionBarResize() {
  sessionBarResizing.value = false
  window.removeEventListener('pointermove', onSessionBarResize)
}

watch(activeSessionId, async (id) => {
  explorerTouched.value = false
  const gen = ++loadGeneration
  resetStreamState()
  messages.value = []
  usage.value = null
  showArchived.value = false
  if (!id) return
  await Promise.all([loadHistory(gen), loadUsage(gen), restoreSessionStatus(gen)])
})

watch(shouldAutoOpenExplorer, (value) => {
  if (!explorerTouched.value) explorerOpen.value = value
}, { immediate: true })

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
        remainSec: status.pendingApproval.remainSec,
        timeoutValue: status.pendingApproval.timeoutValue,
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

async function createNewSession() {
  try {
    const res = await props.transport.createSession({ name: '' })
    sessions.value = await props.transport.listSessions()
    activeSessionId.value = res.id
    sidebarOpen.value = false
    settingsOpen.value = false
  } catch (e) {
    console.error('[ChatView] createSession', e)
  }
}

function sessionTitleFromFirstMessage(text: string): string | null {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim()

  if (!normalized || normalized === '[attachment]') return L.value.attachment
  return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized
}

async function renameSessionFromFirstMessage(id: string, text: string) {
  const session = sessions.value.find(s => s.id === id)
  if (!session || session.name?.trim()) return

  const title = sessionTitleFromFirstMessage(text)
  if (!title || title === session.name) return

  const previousName = session.name
  session.name = title
  try {
    await props.transport.updateSession(id, { name: title })
  } catch (e) {
    session.name = previousName
    console.error('[ChatView] autoRenameSession', e)
  }
}

// ── Config updates ──

async function onUpdateConfig(field: string, value: unknown) {
  const id = activeSessionId.value
  if (!id) return
  try {
    const wireValue = value === undefined ? null : value
    await props.transport.updateSession(id, { [field]: wireValue } as Partial<SessionItem>)
    const s = sessions.value.find(s => s.id === id) as Record<string, unknown> | undefined
    if (s) s[field] = value
  } catch (e) {
    console.error('[ChatView] updateConfig', e)
  }
}

function onOpenPathPicker(currentPath: string) {
  pathPickerRef.value?.open(currentPath)
}

async function onPathConfirmed(path: string) {
  await onUpdateConfig('workPath', path || undefined)
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
    messages.value.push({ message: { role: MessageRole.Human, content: display }, createdAt: Date.now() / 1000, kind: MessageKind.Normal })
    nextTick(() => chatAreaRef.value?.scrollToBottom(true))
  } else {
    void renameSessionFromFirstMessage(id, display)
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
  window.removeEventListener('pointermove', onExplorerResize)
  window.removeEventListener('pointermove', onSessionBarResize)
})
</script>

<template>
  <div ref="rootEl" class="chatui-root" :class="{ 'chatui-compact': isCompact || alwaysCompact, 'chatui-session-resizing': sessionBarResizing }">
    <!-- Compact mode (narrow screen or alwaysCompact): hamburger + drawer -->
    <template v-if="isCompact || alwaysCompact">
      <div class="chatui-compact-header">
        <span class="chatui-compact-title">{{ activeSession?.name || L.untitledSession }}</span>
        <div class="chatui-compact-actions">
          <button
            class="chatui-compact-action"
            :class="{ 'chatui-compact-action--active': sidebarOpen }"
            :title="L.sessionList"
            @click="toggleSidebar"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M5 6h10"/>
              <path d="M5 10h10"/>
              <path d="M5 14h10"/>
            </svg>
          </button>
          <button
            class="chatui-compact-action"
            :class="{ 'chatui-compact-action--active': settingsOpen }"
            :title="L.settings"
            @click="toggleSettings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.59 3.94c.09-.54.56-.94 1.11-.94h2.6c.55 0 1.02.4 1.11.94l.21 1.28c.06.37.31.69.64.87l.22.13c.33.2.72.26 1.08.12l1.22-.46c.51-.19 1.09.01 1.37.49l1.3 2.25c.27.48.16 1.08-.26 1.43l-1 .83c-.3.24-.44.61-.43.99a7.72 7.72 0 0 1 0 .26c-.01.38.13.75.43.99l1 .83c.42.35.53.95.26 1.43l-1.3 2.25c-.28.48-.86.68-1.37.49l-1.22-.46c-.36-.13-.75-.07-1.08.12l-.22.13c-.33.18-.58.5-.64.87l-.21 1.28c-.09.54-.56.94-1.11.94h-2.6c-.55 0-1.02-.4-1.11-.94l-.21-1.28c-.06-.37-.31-.69-.64-.87l-.22-.13c-.33-.2-.72-.26-1.08-.12l-1.22.46c-.51.19-1.09-.01-1.37-.49l-1.3-2.25a1.13 1.13 0 0 1 .26-1.43l1-.83c.3-.24.44-.61.43-.99a7.72 7.72 0 0 1 0-.26c.01-.38-.13-.75-.43-.99l-1-.83a1.13 1.13 0 0 1-.26-1.43l1.3-2.25c.28-.48.86-.68 1.37-.49l1.22.46c.36.13.75.07 1.08-.12l.22-.13c.33-.18.58-.5.64-.87l.21-1.28Z"/>
              <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
          </button>
          <button class="chatui-compact-action" :title="L.newSession" @click="createNewSession">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V9"/>
              <path d="M13.5 3.8 16.2 6.5"/>
              <path d="m8.8 11.2 6.7-6.7"/>
            </svg>
          </button>
        </div>
      </div>
      <Transition name="chatui-drawer">
        <div v-if="sidebarOpen" class="chatui-compact-popover-backdrop" @click="sidebarOpen = false">
          <div class="chatui-compact-popover chatui-session-popover" @click.stop>
            <SessionBar
              :sessions="sessions"
              :active-session-id="activeSessionId"
              :labels="labels"
              :show-header="false"
              @select="(id: string) => { selectSession(id); sidebarOpen = false }"
              @delete="onDeleteSession"
              @rename="onRenameSession"
              @new-session="createNewSession"
            />
          </div>
        </div>
      </Transition>
      <Transition name="chatui-drawer">
        <div v-if="settingsOpen" class="chatui-compact-popover-backdrop" @click="settingsOpen = false">
          <div class="chatui-compact-popover chatui-settings-popover" @click.stop>
            <ConfigToolbar
              :session="activeSession"
              :settings="settings"
              :labels="labels"
              @update-config="onUpdateConfig"
              @open-path-picker="onOpenPathPicker"
            />
            <StatusBar
              v-if="activeSessionId"
              :usage="usage"
              :context-window="contextWindow"
              :labels="labels"
              :has-saver="hasSaver"
              :archived-count="archivedCount"
              v-model:show-archived="showArchived"
              @refresh="onRefresh"
              @clear-history="onClearHistory"
            >
              <template #actions-prepend>
                <slot name="status-actions" :session="activeSession" />
                <button
                  class="chatui-explorer-toggle"
                  :class="{ 'chatui-explorer-toggle--active': explorerOpen }"
                  :title="L.explorerToggle"
                  @click="toggleExplorer"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 5v7.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9z"/>
                  </svg>
                </button>
              </template>
            </StatusBar>
          </div>
        </div>
      </Transition>
    </template>

    <!-- Non-compact: static sidebar -->
    <template v-else>
      <SessionBar
        :sessions="sessions"
        :active-session-id="activeSessionId"
        :labels="labels"
        :width="sessionBarWidth"
        @select="selectSession"
        @delete="onDeleteSession"
        @rename="onRenameSession"
        @new-session="createNewSession"
      />
      <div
        class="chatui-session-resizer"
        :class="{ 'chatui-session-resizer--active': sessionBarResizing }"
        @pointerdown="startSessionBarResize"
      />
    </template>

    <!-- Right panel -->
    <div class="chatui-main">
      <!-- Config toolbar -->
      <ConfigToolbar
        v-if="!(isCompact || alwaysCompact)"
        :session="activeSession"
        :settings="settings"
        :labels="labels"
        @update-config="onUpdateConfig"
        @open-path-picker="onOpenPathPicker"
      />

      <!-- Status bar -->
      <StatusBar
        v-if="activeSessionId && !(isCompact || alwaysCompact)"
        :usage="usage"
        :context-window="contextWindow"
        :labels="labels"
        :has-saver="hasSaver"
        :archived-count="archivedCount"
        v-model:show-archived="showArchived"
        @refresh="onRefresh"
        @clear-history="onClearHistory"
      >
        <template #actions-prepend>
          <slot name="status-actions" :session="activeSession" />
          <button
            class="chatui-explorer-toggle"
            :class="{ 'chatui-explorer-toggle--active': explorerOpen }"
            :title="L.explorerToggle"
            @click="toggleExplorer"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 5v7.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9z"/>
            </svg>
          </button>
        </template>
      </StatusBar>

      <!-- Chat area + optional Explorer -->
      <div ref="contentEl" class="chatui-content" :class="{ 'chatui-explorer-resizing': explorerResizing }">
        <ChatArea
          ref="chatAreaRef"
          class="chatui-chatarea"
          :messages="displayedMessages"
          :is-streaming="isStreaming"
          :streaming-content="streamingContent"
          :queued-messages="queuedMessages"
          :pending-tool-call="pendingToolCall"
          :pending-ask="pendingAsk"
          :thinks-url-prefix="thinksUrlPrefix"
          :tasks-url-prefix="tasksUrlPrefix"
          :labels="labels"
          :show-attachments="showAttachments"
          :has-saver="hasSaver"
          :fetch-thinks="fetchThinks"
          :usage="usage"
          :context-window="contextWindow"
          @send="onSend"
          @approve="onApprove"
          @answer="onAnswer"
          @abort="onAbort"
        />
        <div v-if="explorerOpen" class="chatui-explorer-pane" :style="explorerPaneStyle">
          <div
            v-if="!(isCompact || alwaysCompact)"
            class="chatui-explorer-resizer"
            :title="L.explorerToggle"
            @pointerdown="startExplorerResize"
          />
          <div v-if="isCompact || alwaysCompact" class="chatui-explorer-panel-header">
            <span class="chatui-explorer-panel-title">{{ L.explorerToggle }}</span>
            <button class="chatui-explorer-panel-close" :title="L.close" @click="explorerOpen = false">×</button>
          </div>
          <Explorer :transport="transport" :root="activeSession?.workPath" :labels="labels" editable />
        </div>
      </div>
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
  position: relative;
}
.chatui-root.chatui-compact {
  flex-direction: column;
  --chatui-compact-header-height: 36px;
}
.chatui-main {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  min-width: 0;
}

/* Chat area + Explorer side-by-side */
.chatui-content {
  flex: 1; display: flex; overflow: hidden; min-height: 0;
  position: relative;
}
.chatui-explorer-resizing,
.chatui-explorer-resizing * {
  cursor: col-resize !important;
  user-select: none;
}
.chatui-root.chatui-session-resizing,
.chatui-root.chatui-session-resizing * {
  cursor: col-resize !important;
  user-select: none;
}
.chatui-session-resizer {
  width: 4px;
  margin-left: -2px;
  margin-right: -2px;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
}
.chatui-session-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1px;
  width: 1px;
  background: transparent;
  transition: background 0.15s;
}
.chatui-session-resizer:hover::after,
.chatui-session-resizer--active::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
}
.chatui-chatarea {
  flex: 1; min-width: 0;
}
.chatui-explorer-pane {
  min-width: 280px;
  max-width: 70%;
  border-left: 1px solid var(--chatui-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--chatui-bg);
  position: relative;
  flex-shrink: 0;
}
.chatui-explorer-pane > .chatui-explorer { flex: 1; min-width: 0; }
.chatui-explorer-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 8px;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
}
.chatui-explorer-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: transparent;
  transition: background 0.15s;
}
.chatui-explorer-resizer:hover::after,
.chatui-explorer-resizing .chatui-explorer-resizer::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
}
.chatui-explorer-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-explorer-panel-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--chatui-fg);
}
.chatui-explorer-panel-close {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--chatui-fg-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.chatui-explorer-panel-close:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}

.chatui-explorer-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--chatui-border); cursor: pointer;
  color: var(--chatui-fg-secondary);
  width: 26px;
  min-width: 26px;
  padding: 0;
  border-radius: 4px;
  height: 24px;
  font: inherit;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.chatui-explorer-toggle:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-toggle--active {
  background: var(--chatui-bg-active);
  color: var(--chatui-fg);
  border-color: var(--chatui-border-focus, var(--chatui-accent));
}

/* Compact: explorer overlays the chat content instead of shrinking it. */
.chatui-root.chatui-compact .chatui-explorer-pane {
  position: absolute;
  inset: 0;
  z-index: 80;
  width: 100%;
  max-width: none;
  min-width: 0;
  height: 100%;
  border-left: none;
  border-top: none;
  box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.22);
}

/* Compact header */
.chatui-compact-header {
  display: flex; align-items: center; gap: 8px;
  height: var(--chatui-compact-header-height);
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-compact-title {
  font-size: 13px; font-weight: 600; color: var(--chatui-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.chatui-compact-actions {
  display: inline-flex; align-items: center; gap: 4px;
  flex-shrink: 0;
}
.chatui-compact-action {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: var(--chatui-fg-secondary);
  border-radius: 5px;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.chatui-compact-action:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-compact-action--active {
  background: var(--chatui-bg-active);
  color: var(--chatui-fg);
}

/* Compact popovers */
.chatui-compact-popover-backdrop {
  position: absolute;
  top: var(--chatui-compact-header-height);
  left: 0; right: 0; bottom: 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.22);
}
.chatui-compact-popover {
  position: absolute;
  top: 8px; left: 8px; right: 8px;
  max-height: min(70vh, calc(100% - 16px));
  z-index: 100;
  border: 1px solid var(--chatui-border);
  border-radius: 8px;
  background: var(--chatui-bg-surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.chatui-session-popover :deep(.chatui-session-bar) {
  width: 100%;
  max-height: min(320px, calc(100vh - 80px));
  border-right: none;
}
.chatui-settings-popover {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.chatui-settings-popover :deep(.chatui-config-toolbar) {
  border-bottom: 1px solid var(--chatui-border-subtle);
  padding: 8px;
}
.chatui-settings-popover :deep(.chatui-status-bar) {
  border-bottom: none;
  padding: 8px;
}
.chatui-settings-popover :deep(.chatui-toolbar-actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Compact popover transitions */
.chatui-drawer-enter-active,
.chatui-drawer-leave-active {
  transition: opacity 0.25s ease;
}
.chatui-drawer-enter-active .chatui-compact-popover,
.chatui-drawer-leave-active .chatui-compact-popover {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.chatui-drawer-enter-from,
.chatui-drawer-leave-to {
  opacity: 0;
}
.chatui-drawer-enter-from .chatui-compact-popover,
.chatui-drawer-leave-to .chatui-compact-popover {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
