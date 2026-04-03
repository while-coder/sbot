import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import { useI18n } from 'vue-i18n'
import ChatArea from '@/components/ChatArea.vue'
import type { WebChatEvent } from 'sbot.commons'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

interface ChatViewLogicOptions {
  /** Reactive getter for the current sessionId */
  sessionId: () => string | undefined
  /** Build the WS command payload (view-specific fields) */
  buildSendPayload: (query: string, sessionId: string, atts?: Attachment[]) => Record<string, any>
  /** Build the session-status API query string */
  sessionStatusQuery: (activeId: string) => string
}

export function useChatViewLogic(options: ChatViewLogicOptions) {
  const { t } = useI18n()
  const { show } = useToast()
  const chatSocket = useChatSocket()
  const chatAreaRef = ref<InstanceType<typeof ChatArea>>()

  // ── Shared computed: agent/saver/memory options ──
  const agentOptions = computed(() =>
    Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
  )
  const saverOptions = computed(() =>
    Object.entries(store.settings.savers || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
  )
  const memoryOptions = computed(() =>
    Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
  )

  // ── WS event routing ──
  async function handleWsEvent(evt: WebChatEvent & { sessionId?: string }) {
    const expected = options.sessionId()
    if (evt.sessionId && evt.sessionId !== expected) return
    await chatAreaRef.value?.handleWsEvent(evt)
  }

  // ── WS reconnect ──
  watch(chatSocket.connected, (val, oldVal) => {
    if (!val && oldVal) {
      show(t('chat.ws_reconnecting'), 'error')
      chatAreaRef.value?.reset()
    }
  })

  // ── Send ──
  async function sendOne(query: string, atts: Attachment[]) {
    const sessionId = options.sessionId()
    if (!sessionId) return
    try {
      await chatSocket.waitForOpen()
      chatSocket.send(options.buildSendPayload(query, sessionId, atts))
      chatAreaRef.value?.addQueuedMessage(query)
    } catch (e: any) {
      chatAreaRef.value?.reset()
      show(e.message, 'error')
    }
  }

  // ── Restore session status ──
  async function fetchAndRestoreSessionStatus(activeId: string | null) {
    if (!activeId) { chatAreaRef.value?.restoreSessionStatus(null); return }
    try {
      const qs = options.sessionStatusQuery(activeId)
      const res = await apiFetch(`/api/session-status?${qs}`)
      chatAreaRef.value?.restoreSessionStatus(res ?? null)
    } catch {
      chatAreaRef.value?.restoreSessionStatus(null)
    }
  }

  // ── Lifecycle ──
  onMounted(() => {
    chatSocket.onMessage(handleWsEvent)
  })

  onUnmounted(() => {
    chatSocket.offMessage(handleWsEvent)
    chatAreaRef.value?.cleanup()
  })

  return {
    chatAreaRef,
    agentOptions,
    saverOptions,
    memoryOptions,
    handleWsEvent,
    sendOne,
    fetchAndRestoreSessionStatus,
  }
}
