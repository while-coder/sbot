<template>
  <div class="server-picker">
    <h3>{{ L.selectServer }}</h3>

    <button class="server-item local" @click="$emit('selectLocal')">
      <span class="server-name">{{ L.localServer }}</span>
      <span class="server-desc">{{ L.localServerDesc }}</span>
    </button>

    <div v-if="remotes.length" class="server-list">
      <div v-for="(r, i) in remotes" :key="i" class="server-row">
        <template v-if="editingIndex === i">
          <div class="edit-form">
            <input v-model="editName" :placeholder="L.namePlaceholder" />
            <input v-model="editHost" placeholder="Host" />
            <input v-model.number="editPort" type="number" placeholder="Port" />
            <div class="edit-actions">
              <button class="btn-sm btn-save" @click="onSaveEdit(i)">{{ L.save }}</button>
              <button class="btn-sm btn-cancel" @click="editingIndex = -1">{{ L.cancel }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <button class="server-item" @click="$emit('selectRemote', i)">
            <span class="server-name">{{ r.name }}</span>
            <span class="server-desc">{{ r.host }}:{{ r.port }}</span>
          </button>
          <div class="item-actions">
            <button class="btn-icon" title="编辑" @click.stop="startEdit(i, r)">&#9998;</button>
            <button class="btn-icon btn-danger" title="删除" @click.stop="$emit('removeRemote', i)">&times;</button>
          </div>
        </template>
      </div>
    </div>

    <div class="divider"></div>
    <h3>{{ L.addRemoteServer }}</h3>
    <div class="form">
      <label>Host</label>
      <input v-model="host" placeholder="192.168.1.100" />

      <label>Port</label>
      <input v-model.number="port" type="number" placeholder="3000" />

      <label>{{ L.namePlaceholder }}</label>
      <input v-model="name" :placeholder="host ? `${host}:${port}` : ''" />

      <button class="btn-add" :disabled="!host" @click="onAdd">{{ L.add }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RemoteEntry, ChatLabels } from '../types';
import { resolveLabels } from '../labels';

const props = defineProps<{ remotes: RemoteEntry[]; labels?: ChatLabels }>();
const L = computed(() => resolveLabels(props.labels));

const emit = defineEmits<{
  selectLocal: [];
  selectRemote: [index: number];
  addRemote: [name: string, host: string, port: number];
  updateRemote: [index: number, patch: { name?: string; host?: string; port?: number }];
  removeRemote: [index: number];
}>();

const host = ref('');
const port = ref(3000);
const name = ref('');

const editingIndex = ref(-1);
const editName = ref('');
const editHost = ref('');
const editPort = ref(3000);

function onAdd() {
  if (!host.value) return;
  emit('addRemote', name.value || `${host.value}:${port.value}`, host.value, port.value);
  host.value = '';
  port.value = 3000;
  name.value = '';
}

function startEdit(i: number, r: RemoteEntry) {
  editingIndex.value = i;
  editName.value = r.name;
  editHost.value = r.host;
  editPort.value = r.port;
}

function onSaveEdit(i: number) {
  emit('updateRemote', i, { name: editName.value, host: editHost.value, port: editPort.value });
  editingIndex.value = -1;
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
.server-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.server-item {
  flex: 1;
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
.item-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.btn-icon {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-icon:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.btn-icon.btn-danger:hover { color: var(--vscode-errorForeground, #f48771); }
.edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 6px;
}
.edit-form input {
  padding: 3px 6px;
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 4px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-size: 12px;
}
.edit-actions {
  display: flex;
  gap: 4px;
}
.btn-sm {
  padding: 3px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.btn-save {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn-save:hover { background: var(--vscode-button-hoverBackground); }
.btn-cancel {
  background: transparent;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
}
.btn-cancel:hover { background: var(--vscode-list-hoverBackground); }
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
