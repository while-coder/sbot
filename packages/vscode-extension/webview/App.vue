<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ChatView, ServerPicker } from '@sbot/chat-ui'
import type { RemoteEntry } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
import { transport } from './composables/useChat'

const DEFAULT_PORT = 5500

const remotes = ref<RemoteEntry[]>([])
const phase = ref<'server-pick' | 'chat'>('server-pick')
const currentBaseUrl = ref('')

onMounted(async () => {
  remotes.value = await transport.getRemotes()
  const last = await transport.getLastServer()
  if (last) selectServer(last.url, last.local)
})

async function selectServer(baseUrl: string, local = false) {
  await transport.connectServer(baseUrl, local)
  currentBaseUrl.value = baseUrl
  phase.value = 'chat'
}

function switchServer() {
  phase.value = 'server-pick'
}

function selectLocal() {
  selectServer(`http://localhost:${DEFAULT_PORT}`, true)
}

function selectRemote(index: number) {
  const r = remotes.value[index]
  if (r) selectServer(`http://${r.host}:${r.port}`)
}

async function addRemote(name: string, host: string, port: number) {
  remotes.value.push({ name, host, port })
  await transport.saveRemotes(remotes.value)
  selectServer(`http://${host}:${port}`)
}

async function updateRemote(index: number, patch: { name?: string; host?: string; port?: number }) {
  const r = remotes.value[index]
  if (r) {
    Object.assign(r, patch)
    await transport.saveRemotes(remotes.value)
  }
}

async function removeRemote(index: number) {
  remotes.value.splice(index, 1)
  await transport.saveRemotes(remotes.value)
}
</script>

<template>
  <div class="vscode-app">
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
    <template v-else>
      <div class="vscode-server-bar">
        <span class="vscode-server-url">{{ currentBaseUrl }}</span>
        <button class="vscode-server-switch" @click="switchServer">切换服务器</button>
      </div>
      <ChatView :transport="transport" always-compact />
    </template>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  overflow: hidden;
}
</style>

<style scoped>
.vscode-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.vscode-server-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--vscode-sideBar-background, var(--chatui-bg-surface, #f8f8f8));
  border-bottom: 1px solid var(--vscode-panel-border, var(--chatui-border, #e8e6e3));
  flex-shrink: 0;
  font-size: 11px;
}
.vscode-server-url {
  color: var(--vscode-descriptionForeground, #888);
  font-family: var(--vscode-editor-font-family, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vscode-server-switch {
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid var(--vscode-button-secondaryBackground, #d1d5db);
  border-radius: 2px;
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer;
  font-size: 11px;
  flex-shrink: 0;
}
.vscode-server-switch:hover {
  background: var(--vscode-button-secondaryHoverBackground, #e0e0e0);
}
</style>
