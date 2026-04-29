<script setup lang="ts">
import { ChatView } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
import { transport } from './composables/useChat'
</script>

<template>
  <ChatView :transport="transport" />
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
