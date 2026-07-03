<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ServerChatShell, WebSocketTransport, useServerSelection } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import { SConfirm, SToast } from 'sbot-ui'
import ThemeMenu from './ThemeMenu.vue'
import UpdaterDialog from './UpdaterDialog.vue'
import '@sbot/chat-ui/themes/variables.css'
import lightThemeCSS from '@sbot/chat-ui/themes/theme-light.css?inline'
import darkThemeCSS from '@sbot/chat-ui/themes/theme-dark.css?inline'
import '@sbot/chat-ui/themes/theme-pwa.css'
import '@sbot/chat-ui/themes/sbot-ui-bridge.css'

const REMOTES_KEY = 'sbot-app-remotes'
const THEME_KEY = 'sbot-app-theme'

type ThemeMode = 'system' | 'light' | 'dark'

function readStorage(key: string): string | null {
  try { return window.localStorage?.getItem(key) ?? null }
  catch { return null }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage?.setItem(key, value) }
  catch {}
}

function loadRemotes(): RemoteEntry[] {
  try {
    const parsed = JSON.parse(readStorage(REMOTES_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  }
  catch { return [] }
}
function saveRemotes(list: RemoteEntry[]) {
  writeStorage(REMOTES_KEY, JSON.stringify(list))
}

const {
  remotes,
  phase,
  transport,
  currentBaseUrl,
  connectError,
  connecting,
  selectLocal,
  selectRemote,
  addRemote,
  updateRemote,
  removeRemote,
  switchServer,
} = useServerSelection<WebSocketTransport>({
  initialRemotes: loadRemotes(),
  adapter: {
    saveRemotes,
    connect: async (baseUrl) => {
      const nextTransport = new WebSocketTransport(baseUrl)
      try {
        await nextTransport.getSettings()
        return nextTransport
      } catch (error) {
        nextTransport.disconnect()
        throw error
      }
    },
    disconnect: (currentTransport) => currentTransport.disconnect(),
  },
})

const themeMode = ref<ThemeMode>(((): ThemeMode => {
  const v = readStorage(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
})())

const mq = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null
const themeStyleEl = document.createElement('style')
themeStyleEl.id = 'sbot-app-theme'
document.head.appendChild(themeStyleEl)

const resolvedTheme = computed<'light' | 'dark'>(() =>
  themeMode.value === 'system' ? (mq?.matches ? 'dark' : 'light') : themeMode.value,
)

function applyTheme(t: 'light' | 'dark') {
  themeStyleEl.textContent = t === 'dark' ? darkThemeCSS : lightThemeCSS
  document.documentElement.dataset.theme = t
}

watch(resolvedTheme, applyTheme, { immediate: true })
watch(themeMode, (m) => writeStorage(THEME_KEY, m))

function onSystemChange() {
  if (themeMode.value === 'system') applyTheme(resolvedTheme.value)
}

function addSystemThemeListener() {
  if (!mq) return
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSystemChange)
  else mq.addListener?.(onSystemChange)
}

function removeSystemThemeListener() {
  if (!mq) return
  if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onSystemChange)
  else mq.removeListener?.(onSystemChange)
}

onMounted(addSystemThemeListener)
onUnmounted(removeSystemThemeListener)

</script>

<template>
  <div class="desktop-app">
    <UpdaterDialog />
    <SToast />
    <SConfirm default-confirm-text="确定" default-cancel-text="取消" />
    <ServerChatShell
      :phase="phase"
      :remotes="remotes"
      :transport="transport"
      :current-base-url="currentBaseUrl"
      :connect-error="connectError"
      :connecting="connecting"
      :show-attachments="true"
      @select-local="selectLocal"
      @select-remote="selectRemote"
      @add-remote="addRemote"
      @update-remote="updateRemote"
      @remove-remote="removeRemote"
      @switch-server="switchServer"
    >
      <template #picker-actions>
        <ThemeMenu :mode="themeMode" @update="(m) => themeMode = m" />
      </template>
      <template #server-actions>
        <ThemeMenu :mode="themeMode" @update="(m) => themeMode = m" />
      </template>
    </ServerChatShell>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: var(--chatui-fg);
  background: var(--chatui-bg);
  overflow: hidden;
}
</style>

<style scoped>
.desktop-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
