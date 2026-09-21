<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ChatView, ChatEventType, WebSocketTransport } from '@sbot/chat-ui'
import type { ChatEvent, IChatTransport } from '@sbot/chat-ui'
import { useToast } from '@sbot/ui'
import SplashGate from './SplashGate.vue'
import OnboardingCard from './OnboardingCard.vue'
import { backend } from '../lib/backend'
import { api } from '../lib/api'

const ready = computed(() => backend.phase === 'ready' && !!backend.baseUrl)

// ── Transport（backend 就绪时创建一次；ChatView 重挂时会自行 disconnect/connect，实例可复用） ──

const transport = ref<IChatTransport | null>(null)

// 最近一次聊天流活动时间：设置变更后判断重挂是否安全
let lastChatActivity = 0

function buildTransport(): WebSocketTransport {
  const t = new WebSocketTransport(backend.baseUrl)
  t.onEvent((event: ChatEvent) => {
    if (event.type !== ChatEventType.ConnectionStatus) lastChatActivity = Date.now()
  })
  return t
}

watch(ready, (isReady) => {
  transport.value = isReady ? buildTransport() : null
}, { immediate: true })

// ── Onboarding：models 为空时显示引导卡 ──

const modelsEmpty = ref(false)

async function refreshModelsEmpty(): Promise<void> {
  try {
    const settings = await api.get<{ models?: Record<string, unknown> }>('/api/settings')
    modelsEmpty.value = Object.keys(settings?.models ?? {}).length === 0
  } catch {
    modelsEmpty.value = false
  }
}

watch(ready, (isReady) => {
  if (isReady) void refreshModelsEmpty()
}, { immediate: true })

function openModelsSettings(): void {
  void invoke('open_settings_window', { page: 'models' })
}

// ── 设置变更 → 等聊天流空闲后重挂 ChatView（ChatView 仅 mount 时拉一次配置） ──

const toast = useToast()
const settingsVersion = ref(0)
let idleTimer: ReturnType<typeof setInterval> | null = null

function stopIdleWatch(): void {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
}

function remountWhenIdle(): void {
  if (Date.now() - lastChatActivity > 5_000) {
    settingsVersion.value++
    stopIdleWatch()
    return
  }
  if (!idleTimer) toast.info('配置已更新，将在当前回复完成后应用')
}

const unlistenPromise = listen('sbot://settings-changed', () => {
  void refreshModelsEmpty()
  stopIdleWatch()
  remountWhenIdle()
  idleTimer = setInterval(remountWhenIdle, 2_000)
})

onUnmounted(() => {
  stopIdleWatch()
  void unlistenPromise.then((unlisten) => unlisten())
})
</script>

<template>
  <SplashGate v-if="!ready" />

  <div v-else class="main-app">
    <OnboardingCard v-if="modelsEmpty" @configure="openModelsSettings" />
    <ChatView
      v-else-if="transport"
      :key="settingsVersion"
      :transport="transport"
      :show-attachments="true"
      layout-mode="auto"
    />
  </div>
</template>

<style scoped>
.main-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
