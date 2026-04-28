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
import ServerPicker from './components/ServerPicker.vue';
import SessionPicker from './components/SessionPicker.vue';
import ChatView from './components/ChatView.vue';

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

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  overflow: hidden;
}
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  flex-shrink: 0;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 14px;
}
.btn-switch {
  font-size: 11px;
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
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
}
.btn-retry:hover { background: var(--vscode-button-hoverBackground); }
</style>
