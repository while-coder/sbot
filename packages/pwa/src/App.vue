<template>
  <ChatApp :chat="chat" />
</template>

<script setup lang="ts">
import { ChatApp } from '@sbot/chat-ui';
import { useChat } from './composables/useChat';

const chat = useChat();
</script>
