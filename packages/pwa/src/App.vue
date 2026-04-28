<template>
  <div class="app">
    <div class="header">
      <span class="title">sbot</span>
      <span v-if="state.phase !== 'server-pick'" class="btn-switch" @click="backToServerPick">
        切换服务器
      </span>
      <span class="status" :class="{ online: state.online }" v-if="state.online || state.phase === 'session-pick' || state.phase === 'chat'">
        {{ state.online ? '已连接' : '未连接' }}
      </span>
    </div>

    <template v-if="state.phase === 'server-pick'">
      <ServerPicker
        :remotes="state.remotes"
        @selectLocal="selectLocal"
        @selectRemote="selectRemote"
        @addRemote="addRemote"
        @updateRemote="updateRemote"
        @removeRemote="removeRemote"
      />
    </template>

    <template v-else-if="!state.online && (state.phase === 'session-pick' || state.phase === 'chat')">
      <div class="center-msg">
        <p>无法连接到 sbot 服务器</p>
        <button class="btn-retry" @click="retry">重试</button>
      </div>
    </template>

    <template v-else-if="state.phase === 'session-pick'">
      <SessionPicker
        :sessions="state.sessions"
        :agents="state.agents"
        :savers="state.savers"
        :workPath="state.workPath"
        @select="selectSession"
        @create="createSession"
      />
    </template>

    <template v-else-if="state.phase === 'chat'">
      <ChatView
        :messages="state.messages"
        :streamingContent="state.streamingContent"
        :isStreaming="state.isStreaming"
        :agents="state.agents"
        :savers="state.savers"
        :memories="state.memories"
        :currentAgent="state.currentAgent"
        :currentSaver="state.currentSaver"
        :currentMemories="state.currentMemories"
        @send="sendMessage"
        @updateConfig="updateSessionConfig"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useChat } from './composables/useChat';
import { ServerPicker, SessionPicker, ChatView } from '@sbot/chat-ui';

const {
  state,
  selectLocal,
  selectRemote,
  addRemote,
  updateRemote,
  removeRemote,
  backToServerPick,
  selectSession,
  createSession,
  sendMessage,
  updateSessionConfig,
  retry,
} = useChat();
</script>

<style scoped>
.app {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 16px;
}
.btn-switch {
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  margin-left: auto;
}
.btn-switch:hover { text-decoration: underline; }
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--error-bg);
  color: var(--error-text);
}
.status.online {
  background: var(--success-bg);
  color: var(--success-text);
}
.center-msg {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
}
.btn-retry {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: var(--btn-bg);
  color: var(--btn-text);
  cursor: pointer;
  font-size: 14px;
}
.btn-retry:hover { background: var(--btn-hover); }
</style>
