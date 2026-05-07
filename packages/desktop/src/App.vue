<script setup lang="ts">
import { ref } from 'vue'
import { ChatView, ServerPicker, WebSocketTransport } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-dark.css'
import '@sbot/chat-ui/themes/theme-pwa.css'

const DEFAULT_PORT = 5500
const REMOTES_KEY = 'sbot-desktop-remotes'

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

function selectServer(baseUrl: string) {
  transport.value = new WebSocketTransport(baseUrl)
  currentBaseUrl.value = baseUrl
  phase.value = 'chat'
}

function switchServer() {
  transport.value?.disconnect()
  transport.value = null
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
    <template v-if="phase === 'server-pick'">
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
  color: var(--chatui-fg, #e8e6e3);
  background: var(--chatui-bg, #1a1a2e);
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
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--chatui-bg-surface, #252540);
  border-bottom: 1px solid var(--chatui-border, #3a3a5c);
  flex-shrink: 0;
  font-size: 12px;
}
.desktop-server-url {
  color: var(--chatui-fg-secondary, #888);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-server-switch {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid var(--chatui-border, #3a3a5c);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--chatui-fg, #e8e6e3);
  flex-shrink: 0;
}
.desktop-server-switch:hover {
  background: var(--chatui-bg-hover, #2f2f4a);
}
</style>
