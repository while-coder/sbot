<script setup lang="ts">
import { ChatView, WebSocketTransport } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-web.css'

const transport = new WebSocketTransport()
</script>

<template>
  <ChatView :transport="transport" :show-attachments="true" />
</template>
