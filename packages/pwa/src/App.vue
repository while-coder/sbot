<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChatView, ServerPicker, WebSocketTransport } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-dark.css'
import '@sbot/chat-ui/themes/theme-pwa.css'

const DEFAULT_PORT = 5500
const REMOTES_KEY = 'sbot-pwa-remotes'

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
  if (r) selectServer(`http://${r.host}:${r.port}`)
}

function addRemote(name: string, host: string, port: number) {
  remotes.value.push({ name, host, port })
  saveRemotes(remotes.value)
  selectServer(`http://${host}:${port}`)
}

function updateRemote(index: number, patch: { name?: string; host?: string; port?: number }) {
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
  <div style="height:100vh;display:flex;flex-direction:column;overflow:hidden">
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
      <div class="pwa-server-bar">
        <span class="pwa-server-url">{{ currentBaseUrl }}</span>
        <button class="pwa-server-switch" @click="switchServer">切换服务器</button>
      </div>
      <ChatView :transport="transport" :show-attachments="true" />
    </template>
  </div>
</template>

<style scoped>
.pwa-server-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--chatui-bg-surface, #f8f8f8);
  border-bottom: 1px solid var(--chatui-border, #e8e6e3);
  flex-shrink: 0;
  font-size: 12px;
}
.pwa-server-url {
  color: var(--chatui-fg-secondary, #888);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pwa-server-switch {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid var(--chatui-border, #d1d5db);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--chatui-fg, #374151);
  flex-shrink: 0;
}
.pwa-server-switch:hover {
  background: var(--chatui-bg-hover, #f0efed);
}
</style>
