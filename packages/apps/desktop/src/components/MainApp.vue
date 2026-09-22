<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { ChatView, ChatEventType, WebSocketTransport } from '@sbot/chat-ui'
import type { ChatEvent, IChatTransport } from '@sbot/chat-ui'
import { SModal, toast } from '@sbot/ui-kit'
import SplashGate from './SplashGate.vue'
import OnboardingCard from './OnboardingCard.vue'
import SettingsApp from './settings/SettingsApp.vue'
import { backend } from '../lib/backend'
import { api } from '../lib/api'
import { BUILTIN_AGENT_IDS, ensureBuiltinAgents } from '../lib/defaultAgent'

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
  if (isReady) {
    void refreshModelsEmpty()
    void ensureBuiltinAgents()
  }
}, { immediate: true })

// 首次启动 models 为空时跳过创建内置助手，配好模型后补建
watch(modelsEmpty, (isEmpty) => {
  if (!isEmpty && backend.baseUrl) void ensureBuiltinAgents()
})

function openModelsSettings(): void {
  openSettings('models')
}

// ── 设置 modal：菜单/引导卡统一入口（Rust 菜单广播 sbot://open-settings） ──

type SettingsPage = 'general' | 'models' | 'channels' | 'about'

const settingsOpen = ref(false)
const settingsPage = ref<SettingsPage>('general')

function openSettings(page: SettingsPage): void {
  settingsPage.value = page
  settingsOpen.value = true
}

const unlistenOpenSettings = listen<{ page?: string | null }>('sbot://open-settings', (e) => {
  const page = e.payload?.page
  openSettings(page === 'models' || page === 'channels' || page === 'about' || page === 'general' ? page : 'general')
})

// ── 设置变更 → 等聊天流空闲后重挂 ChatView（ChatView 仅 mount 时拉一次配置） ──

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
  if (!idleTimer) toast.show('info', '配置已更新，将在当前回复完成后应用')
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
  void unlistenOpenSettings.then((unlisten) => unlisten())
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
      :builtin-agent-ids="BUILTIN_AGENT_IDS"
    />

    <SModal
      v-model:show="settingsOpen"
      title="设置"
      width="xl"
      draggable
      :close-on-overlay="false"
      class="settings-modal"
    >
      <SettingsApp :initial-page="settingsPage" />
    </SModal>
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

<style>
/* SModal teleport 到 body，需用全局样式定制设置 modal：撑高 + 去掉 body 默认内边距 */
.settings-modal {
  height: min(86vh, 780px);
}
.settings-modal .s-modal-body {
  padding: 0;
  display: flex;
}
.settings-modal .s-modal-body > * {
  flex: 1;
  min-width: 0;
}
</style>
