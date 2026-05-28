<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChatView, WebSocketTransport } from '@sbot/chat-ui'
import type { SessionItem } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
// Light theme is loaded as the base (sets all --chatui-* on :root).
// Admin's <html data-theme="dark"> overrides happen via the rules in the non-scoped
// <style> block below (and in MessageList.vue), so we avoid a duplicate full dark import here.
import '@sbot/chat-ui/themes/theme-light.css'
import { SButton } from 'sbot-ui'
import TodoListModal from '@/components/modals/TodoListModal.vue'
import SchedulerListModal from '@/components/modals/SchedulerListModal.vue'

const { t } = useI18n()
const transport = new WebSocketTransport()
const todoListModal = ref<InstanceType<typeof TodoListModal>>()
const schedulerListModal = ref<InstanceType<typeof SchedulerListModal>>()

function openTodos(session: SessionItem) {
  todoListModal.value?.openBySessionId(session.id, session.name || session.id)
}

function openSchedulers(session: SessionItem) {
  schedulerListModal.value?.openBySessionId(session.id, session.name || session.id)
}
</script>

<template>
  <ChatView :transport="transport" :show-attachments="true">
    <template #status-actions="{ session }">
      <SButton v-if="session" type="outline" size="sm" @click="openTodos(session)">
        {{ t('todo.title') }}
      </SButton>
      <SButton v-if="session" type="outline" size="sm" @click="openSchedulers(session)">
        {{ t('scheduler.title') }}
      </SButton>
    </template>
  </ChatView>
  <TodoListModal ref="todoListModal" />
  <SchedulerListModal ref="schedulerListModal" />
</template>

<!--
  Dark theme overrides for all --chatui-* tokens used by @sbot/chat-ui components.
  Values are kept in sync with packages/chat-ui/src/themes/theme-dark.css.
-->
<style>
html[data-theme="dark"] {
  --chatui-bg: #1a1a1a;
  --chatui-bg-surface: #252525;
  --chatui-bg-hover: #2e2e2e;
  --chatui-bg-active: #363636;
  --chatui-fg: #e0e0e0;
  --chatui-fg-primary: #e0e0e0;
  --chatui-fg-secondary: #888888;
  --chatui-border: rgba(255, 255, 255, 0.1);
  --chatui-border-subtle: rgba(255, 255, 255, 0.06);
  --chatui-border-focus: #528bff;
  --chatui-accent: #528bff;

  --chatui-btn-bg: #528bff;
  --chatui-btn-fg: #ffffff;
  --chatui-btn-hover: #4078e6;
  --chatui-btn-danger: #f87171;

  --chatui-bg-human: #2d4a8a;
  --chatui-fg-human: #e0e0e0;
  --chatui-bg-ai: #2a2a2a;
  --chatui-fg-ai: #e0e0e0;
  --chatui-bg-tool: rgba(120, 100, 40, 0.2);
  --chatui-fg-tool: #fbbf24;
  --chatui-bg-code: rgba(255, 255, 255, 0.06);

  --chatui-think-fg: #a78bfa;
  --chatui-think-bg: rgba(167, 139, 250, 0.12);
  --chatui-think-border: rgba(167, 139, 250, 0.3);

  --chatui-ask-bg: #1e2a3a;
  --chatui-ask-border: #2d6ca3;
  --chatui-ask-title: #7dd3fc;
  --chatui-ask-label: #93c5fd;
  --chatui-ask-focus: #38bdf8;

  --chatui-approval-bg: #2a2418;
  --chatui-approval-border: #a68a2a;
  --chatui-approval-toggle: #f59e0b;
  --chatui-approval-key: #fcd34d;
  --chatui-approval-val: #d4c8a0;
  --chatui-approval-args-bg: rgba(120, 100, 40, 0.15);
  --chatui-approval-full-bg: rgba(120, 100, 40, 0.2);

  --chatui-usage-input: #60a5fa;
  --chatui-usage-output: #a78bfa;
  --chatui-usage-sep: rgba(255, 255, 255, 0.1);
  --chatui-usage-op: #555555;
  --chatui-usage-cache: #4ade80;
  --chatui-usage-cache-creation: #94a3b8;
  --chatui-usage-total: #e0e0e0;
  --chatui-usage-track: rgba(255, 255, 255, 0.1);

  --chatui-diff-meta-bg: #22272e;
  --chatui-diff-meta-fg: #adbac7;
  --chatui-diff-hunk-bg: rgba(56, 139, 253, 0.16);
  --chatui-diff-hunk-fg: #79c0ff;
  --chatui-diff-add-bg: rgba(46, 160, 67, 0.22);
  --chatui-diff-add-fg: #7ee787;
  --chatui-diff-del-bg: rgba(248, 81, 73, 0.18);
  --chatui-diff-del-fg: #ffa198;
  --chatui-diff-line-no: #8b949e;

  --chatui-blockquote-border: #555555;
  --chatui-chip-bg: #528bff;
  --chatui-chip-fg: #ffffff;
}
</style>
