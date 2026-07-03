<script setup lang="ts">
import { onMounted } from 'vue'
import { ServerChatShell, useServerSelection } from '@sbot/chat-ui'
import { SConfirm } from 'sbot-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
import '@sbot/chat-ui/themes/sbot-ui-bridge.css'
import { transport as vscodeTransport } from './composables/useChat'

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

onMounted(async () => {
  await loadRemotes()
  await selectLocal()
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
      :always-compact="true"
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
