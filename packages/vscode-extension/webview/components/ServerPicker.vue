<template>
  <div class="server-picker">
    <h3>选择服务器</h3>

    <button class="server-item local" @click="$emit('selectLocal')">
      <span class="server-name">本机 (Local)</span>
      <span class="server-desc">自动检测本地 sbot</span>
    </button>

    <div v-if="remotes.length" class="server-list">
      <button
        v-for="(r, i) in remotes"
        :key="i"
        class="server-item"
        @click="$emit('selectRemote', i)"
      >
        <span class="server-name">{{ r.name }}</span>
        <span class="server-desc">{{ r.host }}:{{ r.port }}</span>
      </button>
    </div>

    <div class="divider"></div>
    <h3>添加远端服务器</h3>
    <div class="form">
      <label>Host</label>
      <input v-model="host" placeholder="192.168.1.100" />

      <label>Port</label>
      <input v-model.number="port" type="number" placeholder="3000" />

      <label>名称 (可选)</label>
      <input v-model="name" :placeholder="host ? `${host}:${port}` : ''" />

      <button class="btn-add" :disabled="!host" @click="onAdd">添加</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { RemoteEntry } from '../composables/useChat';

defineProps<{ remotes: RemoteEntry[] }>();

const emit = defineEmits<{
  selectLocal: [];
  selectRemote: [index: number];
  addRemote: [name: string, host: string, port: number];
}>();

const host = ref('');
const port = ref(3000);
const name = ref('');

function onAdd() {
  if (!host.value) return;
  emit('addRemote', name.value || `${host.value}:${port.value}`, host.value, port.value);
  host.value = '';
  port.value = 3000;
  name.value = '';
}
</script>

<style scoped>
.server-picker {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin: 0;
}
.server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.server-item {
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
.server-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.server-item.local {
  border-color: var(--vscode-button-background);
}
.server-desc {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
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
.form input {
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 4px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-size: 13px;
}
.btn-add {
  margin-top: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 13px;
}
.btn-add:hover { background: var(--vscode-button-hoverBackground); }
.btn-add:disabled { opacity: 0.5; cursor: default; }
</style>
