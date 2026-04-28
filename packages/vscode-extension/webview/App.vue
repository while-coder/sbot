<template>
  <ChatApp :chat="chat" />
</template>

<script setup lang="ts">
import { ChatApp } from '@sbot/chat-ui';
import { useChat } from './composables/useChat';

const chat = useChat();
</script>

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
