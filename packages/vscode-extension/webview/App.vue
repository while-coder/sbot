<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ServerChatShell, isLocalBaseUrl, type ChatLayoutMode, useServerSelection } from '@sbot/chat-ui'
import { SConfirm } from 'sbot-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
import '@sbot/chat-ui/themes/sbot-ui-bridge.css'
import { transport as vscodeTransport } from './composables/useChat'

const chatViewLayout = ref<ChatLayoutMode>(window.__SBOT_VSCODE_CONFIG__?.chatViewLayout ?? 'compact')
const workspaceFolder = ref(window.__SBOT_VSCODE_CONFIG__?.workspaceFolder ?? '')

function onHostMessage(e: MessageEvent) {
  const msg = e.data
  const config = msg?.type === 'config' ? msg.config : undefined
  const next = config?.chatViewLayout
  if (next === 'auto' || next === 'compact' || next === 'wide') chatViewLayout.value = next
  if (typeof config?.workspaceFolder === 'string') workspaceFolder.value = config.workspaceFolder
}

const {
  remotes,
  phase,
  transport: serverTransport,
  currentBaseUrl,
  connectError,
  connecting,
  loadRemotes,
  selectLocal,
  selectRemote,
  addRemote,
  updateRemote,
  removeRemote,
  switchServer,
} = useServerSelection({
  adapter: {
    loadRemotes: () => vscodeTransport.getRemotes(),
    saveRemotes: (list) => vscodeTransport.saveRemotes(list),
    connect: async (baseUrl, { local }) => {
      await vscodeTransport.connectServer(baseUrl, local)
      return vscodeTransport
    },
  },
})

const isLocalServer = computed(() => currentBaseUrl.value ? isLocalBaseUrl(currentBaseUrl.value) : false)
const fixedWorkPath = computed(() => isLocalServer.value ? workspaceFolder.value : '')

onMounted(async () => {
  window.addEventListener('message', onHostMessage)
  await loadRemotes()
  await selectLocal()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onHostMessage)
})
</script>

<template>
  <div class="vscode-app">
    <ServerChatShell
      :phase="phase"
      :remotes="remotes"
      :transport="serverTransport"
      :current-base-url="currentBaseUrl"
      :connect-error="connectError"
      :connecting="connecting"
      :layout-mode="chatViewLayout"
      :fixed-work-path="fixedWorkPath"
      :work-path-locked="isLocalServer"
      @select-local="selectLocal"
      @select-remote="selectRemote"
      @add-remote="addRemote"
      @update-remote="updateRemote"
      @remove-remote="removeRemote"
      @switch-server="switchServer"
    />
  </div>
  <SConfirm default-confirm-text="确定" default-cancel-text="取消" />
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
  --server-chat-bar-padding: 4px 12px;
  --server-chat-bar-bg: var(--vscode-sideBar-background, var(--chatui-bg-surface, #f8f8f8));
  --server-chat-border: var(--vscode-panel-border, var(--chatui-border, #e8e6e3));
  --server-chat-bar-font-size: 11px;
  --server-chat-url-fg: var(--vscode-descriptionForeground, #888);
  --server-chat-url-font-family: var(--vscode-editor-font-family, monospace);
  --server-chat-switch-padding: 2px 8px;
  --server-chat-switch-border: var(--vscode-button-secondaryBackground, #d1d5db);
  --server-chat-switch-radius: 2px;
  --server-chat-switch-bg: var(--vscode-button-secondaryBackground, transparent);
  --server-chat-switch-fg: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  --server-chat-switch-hover-bg: var(--vscode-button-secondaryHoverBackground, #e0e0e0);
  --server-chat-error-fg: var(--vscode-errorForeground, #f44);
  --server-chat-error-bg: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
  --server-chat-error-border: var(--vscode-inputValidation-errorBorder, rgba(255,0,0,0.3));
  --server-chat-status-fg: var(--vscode-descriptionForeground, #888);
  --server-chat-status-bg: var(--vscode-sideBar-background, var(--chatui-bg-surface, #f8f8f8));
  --server-chat-status-border: var(--vscode-panel-border, var(--chatui-border, #e8e6e3));
}
</style>
