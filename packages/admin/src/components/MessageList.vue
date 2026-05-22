<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageList as ChatUiMessageList } from '@sbot/chat-ui'
import type { StoredMessage, ChatLabels } from '@sbot/chat-ui'
import { apiFetch } from '@/shared/api'

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
  archivedTag: t('savers.archived_tag'),
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
  padding: var(--sui-sp-7);
}
</style>

<!-- Non-scoped: sets chatui CSS variables on body so Teleport-ed overlays (ThinkDrawer, Lightbox) inherit them.
     通用 UI 色彩走 sui token；chat 业务专属色（human/think 等紫蓝）保留 hex，由本文件单点维护。 -->
<style>
body {
  --chatui-bg-human: var(--sui-fg);
  --chatui-fg-human: var(--sui-on-primary);
  --chatui-bg-ai: var(--sui-bg-soft);
  --chatui-fg-ai: var(--sui-fg);
  --chatui-bg-tool: var(--sui-tool-bg);
  --chatui-fg-tool: var(--sui-on-tool-bg);
  --chatui-bg-surface: var(--sui-bg);
  --chatui-bg-code: var(--sui-bg-subtle);
  --chatui-fg-primary: var(--sui-fg);
  --chatui-fg-secondary: var(--sui-fg-disabled);
  --chatui-border: var(--sui-border);
  --chatui-think-fg: #7c3aed;
  --chatui-think-bg: var(--sui-violet-bg);
  --chatui-think-border: #ddd6fe;
}
html[data-theme="dark"] body {
  --chatui-bg-human: #2d4a8a;
  --chatui-bg-tool: rgba(120, 100, 40, 0.2);
  --chatui-fg-tool: #fbbf24;
  --chatui-bg-code: rgba(255, 255, 255, 0.06);
  --chatui-think-fg: #a78bfa;
  --chatui-think-bg: rgba(167, 139, 250, 0.12);
  --chatui-think-border: rgba(167, 139, 250, 0.3);
}
</style>
