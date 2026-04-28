<template>
  <div class="app">
    <div class="header">
      <span class="title">sbot</span>
      <span v-if="chat.state.phase !== 'server-pick'" class="btn-switch" @click="chat.backToServerPick">
        切换服务器
      </span>
      <span class="status" :class="{ online: chat.state.online }" v-if="chat.state.online || chat.state.phase === 'session-pick' || chat.state.phase === 'chat'">
        {{ chat.state.online ? '已连接' : '未连接' }}
      </span>
    </div>

    <template v-if="chat.state.phase === 'server-pick'">
      <ServerPicker
        :remotes="chat.state.remotes"
        @selectLocal="chat.selectLocal"
        @selectRemote="chat.selectRemote"
        @addRemote="chat.addRemote"
        @updateRemote="chat.updateRemote"
        @removeRemote="chat.removeRemote"
      />
    </template>

    <template v-else-if="!chat.state.online && (chat.state.phase === 'session-pick' || chat.state.phase === 'chat')">
      <div class="center-msg">
        <p>无法连接到 sbot 服务器</p>
        <button class="btn-retry" @click="chat.retry">重试</button>
      </div>
    </template>

    <template v-else-if="chat.state.phase === 'session-pick'">
      <SessionPicker
        :sessions="chat.state.sessions"
        :agents="chat.state.agents"
        :savers="chat.state.savers"
        :workPath="chat.state.workPath"
        @select="chat.selectSession"
        @create="chat.createSession"
      />
    </template>

    <template v-else-if="chat.state.phase === 'chat'">
      <ChatView
        :messages="chat.state.messages"
        :streamingContent="chat.state.streamingContent"
        :isStreaming="chat.state.isStreaming"
        :agents="chat.state.agents"
        :savers="chat.state.savers"
        :memories="chat.state.memories"
        :currentAgent="chat.state.currentAgent"
        :currentSaver="chat.state.currentSaver"
        :currentMemories="chat.state.currentMemories"
        @send="chat.sendMessage"
        @updateConfig="chat.updateSessionConfig"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ChatInstance } from '../transport';
import ServerPicker from './ServerPicker.vue';
import SessionPicker from './SessionPicker.vue';
import ChatView from './ChatView.vue';

defineProps<{ chat: ChatInstance }>();
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
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  flex-shrink: 0;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 16px;
}
.btn-switch {
  font-size: 12px;
  color: var(--vscode-textLink-foreground, #3794ff);
  cursor: pointer;
  margin-left: auto;
}
.btn-switch:hover { text-decoration: underline; }
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
  color: var(--vscode-errorForeground, #f48771);
}
.status.online {
  background: var(--vscode-inputValidation-infoBackground, #063b49);
  color: var(--vscode-testing-iconPassed, #73c991);
}
.center-msg {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--vscode-descriptionForeground);
}
.btn-retry {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 14px;
}
.btn-retry:hover { background: var(--vscode-button-hoverBackground); }
</style>
