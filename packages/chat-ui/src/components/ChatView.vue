<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  ChatLabels, SessionItem, AppSettings,
  StoredMessage, UsageInfo, UsageData, ContentPart, Attachment,
  ToolCallEvent, ToolApprovalPayload,
  AskEvent, AskAnswerPayload,
  DisplayContent, ChatEvent, ChatLayoutMode,
} from '../types'
import { MessageRole, ChatEventType, MessageKind } from '../types'
import type { IChatTransport, CommandInfo } from '../transport'
import { resolveLabels, tpl } from '../labels'
import { provideCompact, useCompactProvider } from '../composables/useCompact'
import SessionBar from './SessionBar.vue'
import ConfigToolbar from './ConfigToolbar.vue'
import StatusBar from './StatusBar.vue'
import ChatArea from './ChatArea.vue'
import PathPickerModal from './PathPickerModal.vue'
import WorkbenchPanel from './WorkbenchPanel.vue'
import { SButton, SInput, SModal, useConfirm } from 'sbot-ui'

const props = withDefaults(defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
  showAttachments?: boolean
  alwaysCompact?: boolean
  layoutMode?: ChatLayoutMode
  fixedWorkPath?: string
  workPathLocked?: boolean
}>(), {
  showAttachments: true,
  alwaysCompact: false,
  layoutMode: 'auto',
  fixedWorkPath: '',
  workPathLocked: false,
})

const L = computed(() => resolveLabels(props.labels))
const { confirm } = useConfirm()

const CHAT_VIEW_STATE_KEY = 'sbot:chatview:state:v1'

// ── Core state ──

const sessions          = ref<SessionItem[]>([])
const activeProfileId   = ref<string | null>(null)
const settings          = ref<AppSettings>({ agents: {}, savers: {}, notes: {}, wikis: {} })

const messages          = ref<StoredMessage[]>([])
const isStreaming       = ref(false)
const streamingContent  = ref<DisplayContent>('')
const queuedMessages    = ref<DisplayContent[]>([])
const showArchived      = ref(false)

const pendingToolCall   = ref<ToolCallEvent | null>(null)
const pendingAsk        = ref<AskEvent | null>(null)
const usage             = ref<UsageInfo | null>(null)
const commands          = ref<CommandInfo[]>([])

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
const compactMenuOpen = ref(false)
const rightPanelOpen  = ref(loadRightPanelOpenState())
const rightPanelWidth = ref(420)
const rightPanelResizing = ref(false)
const sessionBarWidth = ref(180)
const sessionBarResizing = ref(false)
const sessionSearch = ref('')
const sessionHighlightIndex = ref(0)
const sessionSearchInputEl = ref<HTMLInputElement | null>(null)
const renameDialogVisible = ref(false)
const renameDraft = ref('')
const renameInputEl = ref<InstanceType<typeof SInput> | null>(null)
const compactMode = computed(() => {
  if (props.layoutMode === 'compact') return true
  if (props.layoutMode === 'wide') return false
  return props.alwaysCompact || isCompact.value
})
provideCompact(compactMode)

// ── Derived ──

const activeSession = computed<SessionItem | null>(
  () => sessions.value.find(s => s.id === activeProfileId.value) ?? null,
)

const hasSaver = computed(() => activeSession.value != null)

const thinksUrlPrefix = computed(() =>
  activeProfileId.value ? props.transport.getThinksUrlPrefix(activeProfileId.value) : null,
)

const tasksUrlPrefix = computed(() =>
  activeProfileId.value ? (props.transport.getTasksUrlPrefix?.(activeProfileId.value) ?? null) : null,
)

const contextWindow = computed<number | undefined>(() => {
  const agentId = activeSession.value?.agent
  const modelId = agentId ? settings.value.agents?.[agentId]?.model : undefined
  return modelId ? settings.value.models?.[modelId]?.contextWindow : undefined
})

const effectiveWorkPath = computed(() =>
  props.workPathLocked ? props.fixedWorkPath : (activeSession.value?.workPath || ''),
)

const fetchThinks = computed(() => props.transport.fetchThinks?.bind(props.transport))

const agentOptions = computed(() => [
  { value: '', label: L.value.useChannelDefault },
  ...Object.entries(settings.value.agents || {}).map(([id, a]) => ({
    value: id,
    label: `${a.name || id}${a.type ? ` (${a.type})` : ''}`,
  })),
])

const saverOptions = computed(() => [
  { value: '', label: L.value.useChannelDefault },
  ...Object.entries(settings.value.savers || {}).map(([id, s]) => ({
    value: id,
    label: s.name || id,
  })),
])

const filteredSessions = computed<SessionItem[]>(() => {
  const q = sessionSearch.value.trim().toLowerCase()
  if (!q) return sessions.value
  return sessions.value.filter(s => {
    const name = (s.name || '').toLowerCase()
    const path = (s.workPath || '').toLowerCase()
    return name.includes(q) || path.includes(q)
  })
})

const highlightedProfileId = computed<string | null>(() => {
  const list = filteredSessions.value
  if (list.length === 0) return null
  const idx = Math.min(Math.max(sessionHighlightIndex.value, 0), list.length - 1)
  return list[idx]?.id ?? null
})

const archivedCount = computed(() => messages.value.filter(m => m.kind === MessageKind.Archive).length)
const displayedMessages = computed<StoredMessage[]>(() =>
  showArchived.value ? messages.value : messages.value.filter(m => m.kind !== MessageKind.Archive),
)

const rightPanelStyle = computed(() =>
  compactMode.value
    ? undefined
    : { width: `${rightPanelWidth.value}px` },
)

// ── Event handler ──

function handleEvent(evt: ChatEvent) {
  if ('profileId' in evt && evt.profileId !== activeProfileId.value) return
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
      const { message, createdAt, thinkId, taskId, kind } = evt.data
      const msg: StoredMessage = { message, createdAt: createdAt ?? Date.now() / 1000, kind: kind ?? MessageKind.Normal }
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
      messages.value.push({
        message: { role: MessageRole.System, content: `[Error] ${evt.data.message}` },
        createdAt: Date.now() / 1000,
        kind: MessageKind.Exception,
      })
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
  if (activeProfileId.value !== id) activeProfileId.value = id
}

function setSidebarOpen(open: boolean) {
  sidebarOpen.value = open
  if (open) compactMenuOpen.value = false
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value) {
    settingsOpen.value = false
    compactMenuOpen.value = false
    resetSessionSearch()
    nextTick(() => sessionSearchInputEl.value?.focus())
  }
}

function resetSessionSearch() {
  sessionSearch.value = ''
  const list = sessions.value
  const activeIdx = list.findIndex(s => s.id === activeProfileId.value)
  sessionHighlightIndex.value = activeIdx >= 0 ? activeIdx : 0
}

function onSessionSearchInput() {
  sessionHighlightIndex.value = 0
}

function moveSessionHighlight(delta: number) {
  const len = filteredSessions.value.length
  if (len === 0) return
  const next = (sessionHighlightIndex.value + delta + len) % len
  sessionHighlightIndex.value = next
  nextTick(() => {
    const id = filteredSessions.value[next]?.id
    if (!id) return
    const el = document.querySelector(`.chatui-session-popover [data-profile-id="${id}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onSessionSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveSessionHighlight(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveSessionHighlight(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const id = highlightedProfileId.value
    if (id) {
      selectSession(id)
      sidebarOpen.value = false
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    sidebarOpen.value = false
  }
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) {
    sidebarOpen.value = false
    compactMenuOpen.value = false
  }
}

function toggleCompactMenu() {
  compactMenuOpen.value = !compactMenuOpen.value
  if (compactMenuOpen.value) {
    sidebarOpen.value = false
    settingsOpen.value = false
  }
}

function closeRenameDialog() {
  renameDialogVisible.value = false
}

function openRenameDialog() {
  const session = activeSession.value
  if (!session) return
  compactMenuOpen.value = false
  renameDraft.value = session.name || ''
  renameDialogVisible.value = true
  nextTick(() => {
    const root = (renameInputEl.value as any)?.$el as HTMLElement | undefined
    const input = root instanceof HTMLInputElement ? root : root?.querySelector('input')
    input?.focus()
    input?.select()
  })
}

async function submitRenameDialog() {
  const session = activeSession.value
  const name = renameDraft.value.trim()
  if (!session || !name) return
  if (name !== (session.name || '')) {
    await onRenameSession(session.id, name)
  }
  closeRenameDialog()
}

async function deleteActiveSessionFromMenu() {
  const session = activeSession.value
  if (!session) return
  compactMenuOpen.value = false
  const label = session.name || L.value.untitledSession
  if (await confirm(tpl(L.value.confirmDeleteSession, { name: label }), {
    danger: true,
    cancelText: L.value.cancel,
  })) {
    await onDeleteSession(session.id)
  }
}

function onRenameDialogKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    void submitRenameDialog()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeRenameDialog()
  }
}

function setRightPanelOpen(open: boolean, persist = true) {
  rightPanelOpen.value = open
  if (persist && !compactMode.value) saveRightPanelOpenState(open)
}

function toggleRightPanel() {
  setRightPanelOpen(!rightPanelOpen.value)
  if (rightPanelOpen.value && compactMode.value) {
    sidebarOpen.value = false
    settingsOpen.value = false
    compactMenuOpen.value = false
  }
}

function clampRightPanelWidth(width: number): number {
  const contentWidth = contentEl.value?.clientWidth ?? 0
  if (contentWidth <= 0) return Math.max(280, width)
  const min = Math.min(280, Math.max(220, contentWidth * 0.35))
  const max = Math.max(min, contentWidth * 0.7)
  return Math.min(max, Math.max(min, width))
}

function startRightPanelResize(e: PointerEvent) {
  if (compactMode.value) return
  e.preventDefault()
  rightPanelResizing.value = true
  window.addEventListener('pointermove', onRightPanelResize)
  window.addEventListener('pointerup', stopRightPanelResize, { once: true })
}

function onRightPanelResize(e: PointerEvent) {
  if (!rightPanelResizing.value || !contentEl.value) return
  const rect = contentEl.value.getBoundingClientRect()
  rightPanelWidth.value = clampRightPanelWidth(rect.right - e.clientX)
}

function stopRightPanelResize() {
  rightPanelResizing.value = false
  window.removeEventListener('pointermove', onRightPanelResize)
}

function clampSessionBarWidth(width: number): number {
  const rootWidth = rootEl.value?.clientWidth ?? 0
  const min = 140
  const max = rootWidth > 0 ? Math.max(min, rootWidth * 0.5) : 480
  return Math.min(max, Math.max(min, width))
}

function startSessionBarResize(e: PointerEvent) {
  if (compactMode.value) return
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

watch(activeProfileId, async (id) => {
  const gen = ++loadGeneration
  resetStreamState()
  messages.value = []
  usage.value = null
  showArchived.value = false
  if (!id) return
  await Promise.all([loadHistory(gen), loadUsage(gen), restoreSessionStatus(gen)])
})

watch(compactMode, (compact) => {
  rightPanelOpen.value = compact ? false : loadRightPanelOpenState()
}, { immediate: true })

async function loadHistory(gen = ++loadGeneration) {
  const id = activeProfileId.value
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
  const id = activeProfileId.value
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
  const id = activeProfileId.value
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
    if (activeProfileId.value === id) {
      activeProfileId.value = sessions.value[0]?.id ?? null
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
    activeProfileId.value = res.id
    sidebarOpen.value = false
    settingsOpen.value = false
    compactMenuOpen.value = false
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
  const id = activeProfileId.value
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
  if (props.workPathLocked) return
  pathPickerRef.value?.open(currentPath)
}

async function onPathConfirmed(path: string) {
  if (props.workPathLocked) return
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
  const id = activeProfileId.value
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
  const id = activeProfileId.value
  if (!id) return
  pendingToolCall.value = null
  props.transport.approveToolCall(id, payload)
}

function onAnswer(payload: AskAnswerPayload) {
  const id = activeProfileId.value
  if (!id) return
  pendingAsk.value = null
  props.transport.answerAsk(id, payload)
}

function onAbort() {
  const id = activeProfileId.value
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
  const id = activeProfileId.value
  if (!id || !await confirm(L.value.confirmClearHistory, {
    danger: true,
    cancelText: L.value.cancel,
  })) return
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
    if (s.length > 0 && !activeProfileId.value) activeProfileId.value = s[0].id
  } catch (e) {
    console.error('[ChatView] init', e)
  }
  try {
    commands.value = (await props.transport.listCommands?.()) ?? []
  } catch (e) {
    console.error('[ChatView] listCommands', e)
  }
})

onBeforeUnmount(() => {
  props.transport.offEvent(handleEvent)
  props.transport.disconnect()
  window.removeEventListener('pointermove', onRightPanelResize)
  window.removeEventListener('pointermove', onSessionBarResize)
})

function loadRightPanelOpenState(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(CHAT_VIEW_STATE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { version?: number; rightPanelOpen?: unknown }
    return parsed.version === 1 && parsed.rightPanelOpen === true
  } catch {
    return false
  }
}

function saveRightPanelOpenState(open: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CHAT_VIEW_STATE_KEY, JSON.stringify({ version: 1, rightPanelOpen: open }))
  } catch {
    // Non-fatal: panel open state is only a convenience preference.
  }
}
</script>

<template>
  <div ref="rootEl" class="chatui-root" :class="{ 'chatui-compact': compactMode, 'chatui-session-resizing': sessionBarResizing }">
    <!-- Compact mode: title opens the session drawer -->
    <template v-if="compactMode">
      <div class="chatui-compact-header">
        <button
          type="button"
          class="chatui-compact-title"
          :class="{ 'chatui-compact-title--active': sidebarOpen }"
          :title="L.sessionList"
          @click="toggleSidebar"
        >{{ activeSession?.name || L.untitledSession }}</button>
        <div class="chatui-compact-actions">
          <button
            class="chatui-compact-action"
            :class="{ 'chatui-compact-action--active': compactMenuOpen }"
            :title="L.sessionActions"
            @click="toggleCompactMenu"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="10" r="1.4"/>
              <circle cx="10" cy="10" r="1.4"/>
              <circle cx="15" cy="10" r="1.4"/>
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
      <div v-if="compactMenuOpen" class="chatui-compact-menu-backdrop" @click="compactMenuOpen = false">
        <div class="chatui-compact-menu" @click.stop>
          <button
            type="button"
            class="chatui-compact-menu-item"
            :disabled="!activeSession"
            @click="openRenameDialog"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11.5 4.5 15.5 8.5"/>
              <path d="M5 15l1.1-4.1 7.3-7.3a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-7.3 7.3L5 15Z"/>
              <path d="M4 17h12"/>
            </svg>
            <span>{{ L.renameSession }}</span>
          </button>
          <button
            type="button"
            class="chatui-compact-menu-item chatui-compact-menu-item--danger"
            :disabled="!activeSession"
            @click="deleteActiveSessionFromMenu"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 6h12"/>
              <path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h.4A1.8 1.8 0 0 1 12 4.8V6"/>
              <path d="m7 8 .4 7"/>
              <path d="m13 8-.4 7"/>
              <path d="M6 6l.7 10A1.5 1.5 0 0 0 8.2 17h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6"/>
            </svg>
            <span>{{ L.deleteSession }}</span>
          </button>
        </div>
      </div>
      <Transition name="chatui-drawer">
        <div v-if="sidebarOpen" class="chatui-compact-popover-backdrop" @click="setSidebarOpen(false)">
          <div class="chatui-compact-popover chatui-session-popover" @click.stop>
            <div class="chatui-session-popover-search">
              <svg class="chatui-session-popover-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="7" cy="7" r="4.5"/>
                <path d="m10.5 10.5 3 3"/>
              </svg>
              <input
                ref="sessionSearchInputEl"
                v-model="sessionSearch"
                type="text"
                class="chatui-session-popover-search-input"
                :placeholder="L.sessionSearchPlaceholder"
                @input="onSessionSearchInput"
                @keydown="onSessionSearchKeydown"
              />
              <button
                v-if="sessionSearch"
                class="chatui-session-popover-search-clear"
                :title="L.cancel"
                @click="sessionSearch = ''; onSessionSearchInput(); sessionSearchInputEl?.focus()"
              >×</button>
            </div>
            <SessionBar
              :sessions="filteredSessions"
              :active-profile-id="activeProfileId"
              :highlighted-profile-id="highlightedProfileId"
              :labels="labels"
              :show-header="false"
              :show-delete="false"
              created-at-layout="inline"
              :empty-message="sessionSearch ? L.sessionNoMatch : undefined"
              @select="(id: string) => { selectSession(id); setSidebarOpen(false) }"
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
            />
            <StatusBar
              v-if="activeProfileId"
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
                  class="chatui-right-panel-toggle"
                  :class="{ 'chatui-right-panel-toggle--active': rightPanelOpen }"
                  :title="L.rightPanelToggle"
                  @click="toggleRightPanel"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="12" height="10" rx="1.5"/>
                    <line x1="10" y1="3" x2="10" y2="13"/>
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
        :active-profile-id="activeProfileId"
        :labels="labels"
        :width="sessionBarWidth"
        searchable
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
        v-if="!compactMode"
        :session="activeSession"
        :settings="settings"
        :labels="labels"
        @update-config="onUpdateConfig"
      />

      <!-- Status bar -->
      <StatusBar
        v-if="activeProfileId && !compactMode"
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
            class="chatui-right-panel-toggle"
            :class="{ 'chatui-right-panel-toggle--active': rightPanelOpen }"
            :title="L.rightPanelToggle"
            @click="toggleRightPanel"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="12" height="10" rx="1.5"/>
              <line x1="10" y1="3" x2="10" y2="13"/>
            </svg>
          </button>
        </template>
      </StatusBar>

      <!-- Chat area + optional right panel -->
      <div ref="contentEl" class="chatui-content" :class="{ 'chatui-right-panel-resizing': rightPanelResizing }">
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
          :auto-approve="!!activeSession?.autoApproveAllTools"
          :commands="commands"
          :agent="activeSession?.agent || ''"
          :agent-options="agentOptions"
          :saver="activeSession?.saver || ''"
          :saver-options="saverOptions"
          :work-path="effectiveWorkPath"
          :work-path-readonly="workPathLocked"
          @send="onSend"
          @approve="onApprove"
          @answer="onAnswer"
          @abort="onAbort"
          @toggle-auto-approve="(v: boolean) => onUpdateConfig('autoApproveAllTools', v)"
          @update-agent="(v: string) => onUpdateConfig('agent', v)"
          @update-config="onUpdateConfig"
          @open-path-picker="onOpenPathPicker"
        />
        <div v-if="rightPanelOpen" class="chatui-right-panel-pane" :style="rightPanelStyle">
          <div
            v-if="!compactMode"
            class="chatui-right-panel-resizer"
            :title="L.rightPanelToggle"
            @pointerdown="startRightPanelResize"
          />
          <div v-if="compactMode" class="chatui-right-panel-header">
            <span class="chatui-right-panel-title">{{ L.rightPanelToggle }}</span>
            <button class="chatui-right-panel-close" :title="L.close" @click="setRightPanelOpen(false, false)">×</button>
          </div>
          <WorkbenchPanel
            :transport="transport"
            :root="effectiveWorkPath"
            :labels="labels"
            :persist-key="activeProfileId ?? undefined"
            editable
          />
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
    <SModal
      :visible="renameDialogVisible"
      :title="L.renameSession"
      width="sm"
      class="chatui-rename-dialog"
      :close-on-overlay="false"
      @close="closeRenameDialog"
    >
      <div class="chatui-rename-hint">{{ L.renameSessionHint }}</div>
      <SInput
        ref="renameInputEl"
        v-model="renameDraft"
        :placeholder="L.sessionNamePlaceholder"
        autofocus
        @keydown="onRenameDialogKeydown"
      />
      <template #footer>
        <SButton type="outline" @click="closeRenameDialog">{{ L.cancel }}</SButton>
        <SButton :disabled="!renameDraft.trim()" @click="submitRenameDialog">{{ L.save }}</SButton>
      </template>
    </SModal>
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

/* Chat area + right panel side-by-side */
.chatui-content {
  flex: 1; display: flex; overflow: hidden; min-height: 0;
  position: relative;
}
.chatui-right-panel-resizing,
.chatui-right-panel-resizing * {
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
.chatui-right-panel-pane {
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
.chatui-right-panel-pane > :deep(.chatui-right-panel) { flex: 1; min-width: 0; }
.chatui-right-panel-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 8px;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
}
.chatui-right-panel-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: transparent;
  transition: background 0.15s;
}
.chatui-right-panel-resizer:hover::after,
.chatui-right-panel-resizing .chatui-right-panel-resizer::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
}
.chatui-right-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-right-panel-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--chatui-fg);
}
.chatui-right-panel-close {
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
.chatui-right-panel-close:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}

.chatui-right-panel-toggle {
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
.chatui-right-panel-toggle:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-right-panel-toggle--active {
  background: var(--chatui-bg-active);
  color: var(--chatui-fg);
  border-color: var(--chatui-border-focus, var(--chatui-accent));
}

/* Compact: right panel overlays the chat content instead of shrinking it. */
.chatui-root.chatui-compact .chatui-right-panel-pane {
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
  position: relative;
}
.chatui-compact-title {
  height: 26px;
  padding: 0 6px;
  margin-left: -6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  font: inherit;
  font-size: 13px; font-weight: 600; color: var(--chatui-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: left;
  min-width: 0;
  flex: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chatui-compact-title:hover {
  background: var(--chatui-bg-hover);
}
.chatui-compact-title--active {
  background: var(--chatui-bg-active);
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
.chatui-compact-menu-backdrop {
  position: absolute;
  top: var(--chatui-compact-header-height);
  left: 0; right: 0; bottom: 0;
  z-index: 98;
}
.chatui-compact-menu {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 168px;
  padding: 6px;
  border: 1px solid var(--chatui-border);
  border-radius: 8px;
  background: var(--chatui-bg-surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}
.chatui-compact-menu-item {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--chatui-fg);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.chatui-compact-menu-item:hover:not(:disabled) {
  background: var(--chatui-bg-hover);
}
.chatui-compact-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chatui-compact-menu-item svg {
  flex-shrink: 0;
  color: var(--chatui-fg-secondary);
}
.chatui-compact-menu-item--danger {
  color: var(--chatui-btn-danger);
}
.chatui-compact-menu-item--danger svg {
  color: currentColor;
}
.chatui-compact-menu-item--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--chatui-btn-danger) 14%, transparent);
}
.chatui-rename-dialog :deep(.s-modal-body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chatui-rename-hint {
  font-size: 12px;
  color: var(--chatui-fg-secondary);
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
.chatui-session-popover {
  display: flex;
  flex-direction: column;
}
.chatui-session-popover :deep(.chatui-session-bar) {
  width: 100%;
  max-height: min(320px, calc(100vh - 140px));
  border-right: none;
  flex: 1;
  min-height: 0;
}
.chatui-session-popover-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--chatui-border-subtle, var(--chatui-border));
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-session-popover-search-icon {
  flex-shrink: 0;
  color: var(--chatui-fg-secondary);
}
.chatui-session-popover-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--chatui-fg);
  padding: 4px 0;
}
.chatui-session-popover-search-input::placeholder {
  color: var(--chatui-fg-secondary);
}
.chatui-session-popover-search-clear {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--chatui-fg-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.chatui-session-popover-search-clear:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
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
