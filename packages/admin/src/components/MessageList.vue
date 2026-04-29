<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageList as ChatUiMessageList } from '@sbot/chat-ui'
import type { StoredMessage, ChatLabels } from '@sbot/chat-ui'
import { apiFetch } from '@/api'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  thinksUrlPrefix?: string | null
  showDateSeparators?: boolean
  isStreaming?: boolean
  streamingContent?: string | any[]
  queuedMessages?: (string | any[])[]
}>(), {
  thinksUrlPrefix: null,
  showDateSeparators: false,
  isStreaming: false,
  streamingContent: '',
})

const labels = computed<ChatLabels>(() => ({
  roleUser: t('chat.role_user'),
  roleAi: t('chat.role_ai'),
  thinking: t('chat.thinking'),
  think: t('chat.think'),
  toolCalls: t('chat.tool_calls', { count: '{count}' }),
  toolResult: t('chat.tool_result'),
  noHistory: t('chat.no_history'),
  dateToday: t('chat.date_today'),
  dateYesterday: t('chat.date_yesterday'),
  queued: t('chat.queued'),
  loading: t('common.loading'),
  download: t('common.download'),
  close: t('common.close'),
}))

async function fetchFn(url: string) {
  return apiFetch(url)
}
</script>

<template>
  <div class="website-chatui-wrapper">
    <ChatUiMessageList
      :messages="messages"
      :thinks-url-prefix="thinksUrlPrefix"
      :show-date-separators="showDateSeparators"
      :is-streaming="isStreaming"
      :streaming-content="streamingContent"
      :queued-messages="queuedMessages"
      :labels="labels"
      :fetch-fn="fetchFn"
    />
  </div>
</template>

<style scoped>
.website-chatui-wrapper {
  padding: 16px;
}
</style>

<!-- Non-scoped: sets chatui CSS variables on body so Teleport-ed overlays (ThinkDrawer, Lightbox) inherit them -->
<style>
body {
  --chatui-bg-human: #1c1c1c;
  --chatui-fg-human: #fff;
  --chatui-bg-ai: #f5f4f2;
  --chatui-fg-ai: #1c1c1c;
  --chatui-bg-tool: #fefce8;
  --chatui-fg-tool: #713f12;
  --chatui-bg-surface: #fff;
  --chatui-bg-code: #fafaf9;
  --chatui-fg-primary: #1c1c1c;
  --chatui-fg-secondary: #9b9b9b;
  --chatui-border: #e8e6e3;
  --chatui-think-fg: #7c3aed;
  --chatui-think-bg: #f5f3ff;
  --chatui-think-border: #ddd6fe;
}
</style>
