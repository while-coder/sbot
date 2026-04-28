<template>
  <div class="session-picker">
    <h3>选择会话</h3>
    <div class="session-list" v-if="sessions.length">
      <button
        v-for="s in sessions"
        :key="s.id"
        class="session-item"
        @click="$emit('select', s.id)"
      >
        <span class="session-name">{{ s.name || s.id }}</span>
        <span class="session-agent">{{ s.agent }}</span>
      </button>
    </div>
    <div v-else class="empty">当前目录没有已有会话</div>

    <div class="divider"></div>
    <h3>新建会话</h3>
    <div class="form">
      <label>Agent</label>
      <select v-model="agentId">
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name || a.id }}</option>
      </select>

      <label>Saver</label>
      <select v-model="saverId">
        <option v-for="s in savers" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>

      <button class="btn-create" :disabled="!agentId || !saverId" @click="onCreate">
        创建会话
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { SessionItem, AgentOption, SaverOption } from '../composables/useChat';

const props = defineProps<{
  sessions: SessionItem[];
  agents: AgentOption[];
  savers: SaverOption[];
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  create: [agentId: string, saverId: string, memoryIds: string[]];
}>();

const agentId = ref(props.agents[0]?.id ?? '');
const saverId = ref(props.savers[0]?.id ?? '');

function onCreate() {
  if (!agentId.value || !saverId.value) return;
  emit('create', agentId.value, saverId.value, []);
}
</script>

<style scoped>
.session-picker {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin: 0;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.session-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 13px;
}
.session-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.session-agent {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
.empty {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  padding: 8px 0;
}
.divider {
  height: 1px;
  background: var(--vscode-widget-border, rgba(255,255,255,0.1));
  margin: 8px 0;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}
.form select {
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 4px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-size: 13px;
}
.btn-create {
  margin-top: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 13px;
}
.btn-create:hover {
  background: var(--vscode-button-hoverBackground);
}
.btn-create:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
