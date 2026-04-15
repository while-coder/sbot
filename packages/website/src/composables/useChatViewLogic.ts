import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import { useI18n } from 'vue-i18n'
import ChatArea from '@/components/ChatArea.vue'
import type { ContentPart } from '@/components/RichInput.vue'
import { WebChatEventType, type WebChatEvent } from 'sbot.commons'

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
  buildSendPayload: (parts: ContentPart[], sessionId: string, fileAtts?: Attachment[]) => Record<string, any>
  /** Build the session-status API query string */
  sessionStatusQuery: (activeId: string) => string
  /** Called when an AI response round completes (Done event) */
  onDone?: () => void
}

export function useChatViewLogic(options: ChatViewLogicOptions) {
  const { t } = useI18n()
  const { show } = useToast()
  const chatSocket = useChatSocket()
  const chatAreaRef = ref<InstanceType<typeof ChatArea>>()

  // ── Shared computed: agent/saver/memory options ──
  const agentOptions = computed(() =>
    Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id, type: (a as any).type || '' }))
  )
  const saverOptions = computed(() =>
    Object.entries(store.settings.savers || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
  )
  const memoryOptions = computed(() =>
    Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
  )
  const wikiOptions = computed(() =>
    Object.entries(store.settings.wikis || {}).map(([id, w]) => ({ id, label: (w as any).name || id }))
  )

  // ── WS event routing ──
  async function handleWsEvent(evt: WebChatEvent & { sessionId?: string }) {
    const expected = options.sessionId()
    if (evt.sessionId && evt.sessionId !== expected) return
    await chatAreaRef.value?.handleWsEvent(evt)
    if (evt.type === WebChatEventType.Done) options.onDone?.()
  }

  // ── WS reconnect ──
  watch(chatSocket.connected, (val, oldVal) => {
    if (!val && oldVal) {
      show(t('chat.ws_reconnecting'), 'error')
      chatAreaRef.value?.reset()
    }
  })

  // ── Send ──
  async function sendOne(parts: ContentPart[], fileAtts: Attachment[]) {
    const sessionId = options.sessionId()
    if (!sessionId) return
    try {
      await chatSocket.waitForOpen()
      chatSocket.send(options.buildSendPayload(parts, sessionId, fileAtts))
      // Build multimodal content for queued message display (preserving interleaved order)
      const hasImages = parts.some(p => p.type === 'image')
      if (hasImages) {
        const queuedContent = parts.map(p =>
          p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: (p as any).dataUrl } }
        )
        chatAreaRef.value?.addQueuedMessage(queuedContent)
      } else {
        const text = parts.filter(p => p.type === 'text').map(p => (p as any).text).join('\n')
        chatAreaRef.value?.addQueuedMessage(text)
      }
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
    wikiOptions,
    handleWsEvent,
    sendOne,
    fetchAndRestoreSessionStatus,
  }
}
