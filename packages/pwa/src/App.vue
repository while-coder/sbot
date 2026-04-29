<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChatView, ServerPicker, WebSocketTransport } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
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

function selectServer(baseUrl: string) {
  transport.value = new WebSocketTransport(baseUrl)
  phase.value = 'chat'
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
      <ChatView :transport="transport" :show-attachments="true" />
    </template>
  </div>
</template>
