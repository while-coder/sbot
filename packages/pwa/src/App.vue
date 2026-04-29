<template>
  <ChatApp :chat="chat" :thinks-url-prefix="thinksUrlPrefix" :fetch-fn="fetchFn" />
</template>

<script setup lang="ts">
import { ChatApp } from '@sbot/chat-ui';
import { useChat } from './composables/useChat';

const { thinksUrlPrefix, fetchFn, ...chat } = useChat();
</script>
