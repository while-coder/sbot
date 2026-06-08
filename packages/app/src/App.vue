<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChatView, ServerPicker, WebSocketTransport } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import ThemeMenu from './ThemeMenu.vue'
import UpdaterDialog from './UpdaterDialog.vue'
import '@sbot/chat-ui/themes/variables.css'
import lightThemeCSS from '@sbot/chat-ui/themes/theme-light.css?inline'
import darkThemeCSS from '@sbot/chat-ui/themes/theme-dark.css?inline'
import '@sbot/chat-ui/themes/theme-pwa.css'
import '@sbot/chat-ui/themes/sbot-ui-bridge.css'

const DEFAULT_PORT = 5500
const REMOTES_KEY = 'sbot-app-remotes'
const THEME_KEY = 'sbot-app-theme'

type ThemeMode = 'system' | 'light' | 'dark'

function loadRemotes(): RemoteEntry[] {
  try { return JSON.parse(localStorage.getItem(REMOTES_KEY) || '[]') }
  catch { return [] }
}
function saveRemotes(list: RemoteEntry[]) {
  localStorage.setItem(REMOTES_KEY, JSON.stringify(list))
}

const remotes = ref<RemoteEntry[]>(loadRemotes())
const phase = ref<'server-pick' | 'chat'>('server-pick')
const transport = ref<WebSocketTransport | null>(null)
const currentBaseUrl = ref('')
const connectError = ref('')
const connecting = ref(false)

const themeMode = ref<ThemeMode>(((): ThemeMode => {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
})())

const mq = window.matchMedia('(prefers-color-scheme: dark)')
const themeStyleEl = document.createElement('style')
themeStyleEl.id = 'sbot-app-theme'
document.head.appendChild(themeStyleEl)

const resolvedTheme = computed<'light' | 'dark'>(() =>
  themeMode.value === 'system' ? (mq.matches ? 'dark' : 'light') : themeMode.value,
)

function applyTheme(t: 'light' | 'dark') {
  themeStyleEl.textContent = t === 'dark' ? darkThemeCSS : lightThemeCSS
  document.documentElement.dataset.theme = t
}

watch(resolvedTheme, applyTheme, { immediate: true })
watch(themeMode, (m) => localStorage.setItem(THEME_KEY, m))

function onSystemChange() {
  if (themeMode.value === 'system') applyTheme(resolvedTheme.value)
}
onMounted(() => mq.addEventListener('change', onSystemChange))
onUnmounted(() => mq.removeEventListener('change', onSystemChange))

async function selectServer(baseUrl: string) {
  if (connecting.value) return
  connectError.value = ''
  connecting.value = true
  const nextTransport = new WebSocketTransport(baseUrl)
  try {
    await nextTransport.getSettings()
    transport.value = nextTransport
    currentBaseUrl.value = baseUrl
    phase.value = 'chat'
  } catch {
    nextTransport.disconnect()
    connectError.value = `无法连接服务器 ${baseUrl}`
  } finally {
    connecting.value = false
  }
}

function switchServer() {
  transport.value?.disconnect()
  transport.value = null
  connectError.value = ''
  phase.value = 'server-pick'
}

function selectLocal() {
  selectServer(`http://localhost:${DEFAULT_PORT}`)
}

function selectRemote(index: number) {
  const r = remotes.value[index]
  if (r) {
    const proto = r.secure ? 'https' : 'http'
    selectServer(`${proto}://${r.host}:${r.port}`)
  }
}

function addRemote(name: string, host: string, port: number, secure: boolean) {
  remotes.value.push({ name, host, port, secure })
  saveRemotes(remotes.value)
  const proto = secure ? 'https' : 'http'
  selectServer(`${proto}://${host}:${port}`)
}

function updateRemote(index: number, patch: { name?: string; host?: string; port?: number; secure?: boolean }) {
  const r = remotes.value[index]
  if (r) {
    Object.assign(r, patch)
    saveRemotes(remotes.value)
  }
}

function removeRemote(index: number) {
  remotes.value.splice(index, 1)
  saveRemotes(remotes.value)
}
</script>

<template>
  <div class="desktop-app">
    <UpdaterDialog />
    <div v-if="phase === 'server-pick'" class="theme-menu-floating">
      <ThemeMenu :mode="themeMode" @update="(m) => themeMode = m" />
    </div>

    <template v-if="phase === 'server-pick'">
      <div v-if="connectError" class="desktop-connect-error">{{ connectError }}</div>
      <div v-if="connecting" class="desktop-connect-status">正在连接服务器...</div>
      <ServerPicker
        :remotes="remotes"
        @select-local="selectLocal"
        @select-remote="selectRemote"
        @add-remote="addRemote"
        @update-remote="updateRemote"
        @remove-remote="removeRemote"
      />
    </template>
    <template v-else-if="transport">
      <div class="desktop-server-bar">
        <span class="desktop-server-url">{{ currentBaseUrl }}</span>
        <ThemeMenu :mode="themeMode" @update="(m) => themeMode = m" />
        <button class="desktop-server-switch" @click="switchServer">切换服务器</button>
      </div>
      <ChatView :transport="transport" :show-attachments="true" />
    </template>
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
.desktop-server-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--chatui-bg-surface);
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
  font-size: 12px;
}
.desktop-server-url {
  flex: 1;
  color: var(--chatui-fg-secondary);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-server-switch {
  padding: 2px 10px;
  border: 1px solid var(--chatui-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--chatui-fg);
  flex-shrink: 0;
}
.desktop-server-switch:hover {
  background: var(--chatui-bg-hover);
}
.theme-menu-floating {
  position: fixed;
  top: 8px;
  right: 12px;
  z-index: 10;
}
.desktop-connect-error,
.desktop-connect-status {
  padding: 8px 12px;
  margin: 8px 12px 0;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
}
.desktop-connect-error {
  color: var(--chatui-btn-danger, #d14343);
  background: var(--chatui-bg-surface);
  border: 1px solid var(--chatui-btn-danger, #d14343);
}
.desktop-connect-status {
  color: var(--chatui-fg-secondary);
  background: var(--chatui-bg-surface);
  border: 1px solid var(--chatui-border);
}
</style>
