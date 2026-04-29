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
            <label>Host</label>
            <input v-model="editHost" placeholder="Host" />
            <label>Port</label>
            <input v-model.number="editPort" type="number" placeholder="Port" />
            <label class="checkbox-label"><input v-model="editSecure" type="checkbox" /> HTTPS</label>
            <label>{{ L.namePlaceholder }}</label>
            <input v-model="editName" :placeholder="L.namePlaceholder" />
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
      <input v-model.number="port" type="number" placeholder="5500" />

      <label class="checkbox-label"><input v-model="secure" type="checkbox" /> HTTPS</label>

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
  addRemote: [name: string, host: string, port: number, secure: boolean];
  updateRemote: [index: number, patch: { name?: string; host?: string; port?: number; secure?: boolean }];
  removeRemote: [index: number];
}>();

const DEFAULT_PORT = 5500;

const defaultSecure = typeof location !== 'undefined' && location.protocol === 'https:';

const host = ref('');
const port = ref(DEFAULT_PORT);
const name = ref('');
const secure = ref(defaultSecure);

const editingIndex = ref(-1);
const editName = ref('');
const editHost = ref('');
const editPort = ref(DEFAULT_PORT);
const editSecure = ref(defaultSecure);

function onAdd() {
  if (!host.value) return;
  emit('addRemote', name.value || `${host.value}:${port.value}`, host.value, port.value, secure.value);
  host.value = '';
  port.value = DEFAULT_PORT;
  name.value = '';
  secure.value = defaultSecure;
}

function startEdit(i: number, r: RemoteEntry) {
  editingIndex.value = i;
  editName.value = r.name;
  editHost.value = r.host;
  editPort.value = r.port;
  editSecure.value = r.secure ?? defaultSecure;
}

function onSaveEdit(i: number) {
  emit('updateRemote', i, { name: editName.value, host: editHost.value, port: editPort.value, secure: editSecure.value });
  editingIndex.value = -1;
}
</script>

<style scoped>
.server-picker {
  padding: var(--chatui-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--chatui-spacing-sm);
  overflow-y: auto;
  background: var(--chatui-bg);
  color: var(--chatui-fg);
}
h3 {
  font-size: var(--chatui-font-size-sm);
  font-weight: 600;
  color: var(--chatui-fg);
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
  padding: var(--chatui-spacing-sm) 12px;
  border: 1px solid var(--chatui-border);
  border-radius: var(--chatui-radius-sm);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg);
  cursor: pointer;
  font-size: var(--chatui-font-size-sm);
}
.server-item:hover {
  background: var(--chatui-bg-hover);
}
.server-item.local {
  border-color: var(--chatui-accent);
}
.server-desc {
  font-size: var(--chatui-font-size-sm);
  color: var(--chatui-fg-secondary);
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
  border-radius: var(--chatui-radius-sm);
  background: transparent;
  color: var(--chatui-fg-secondary);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-icon:hover { background: var(--chatui-bg-hover); color: var(--chatui-fg); }
.btn-icon.btn-danger:hover { color: var(--chatui-btn-danger); }
.edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--chatui-spacing-sm);
  border: 1px solid var(--chatui-border-focus);
  border-radius: var(--chatui-radius-sm);
  background: var(--chatui-bg-surface);
}
.edit-form label {
  font-size: var(--chatui-font-size-sm);
  color: var(--chatui-fg-secondary);
}
.edit-form input {
  padding: 3px 6px;
  border: 1px solid var(--chatui-border);
  border-radius: var(--chatui-radius-sm);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg);
  font-size: var(--chatui-font-size-sm);
}
.edit-actions {
  display: flex;
  gap: 4px;
}
.btn-sm {
  padding: 3px 8px;
  border: none;
  border-radius: var(--chatui-radius-sm);
  cursor: pointer;
  font-size: var(--chatui-font-size-sm);
}
.btn-save {
  background: var(--chatui-btn-bg);
  color: var(--chatui-btn-fg);
}
.btn-save:hover { background: var(--chatui-btn-hover); }
.btn-cancel {
  background: transparent;
  color: var(--chatui-fg-secondary);
  border: 1px solid var(--chatui-border);
}
.btn-cancel:hover { background: var(--chatui-bg-hover); }
.divider {
  height: 1px;
  background: var(--chatui-border);
  margin: var(--chatui-spacing-sm) 0;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form label {
  font-size: var(--chatui-font-size-sm);
  color: var(--chatui-fg-secondary);
}
.form input {
  padding: 4px 8px;
  border: 1px solid var(--chatui-border);
  border-radius: var(--chatui-radius-sm);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg);
  font-size: var(--chatui-font-size);
}
.btn-add {
  margin-top: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--chatui-radius-sm);
  background: var(--chatui-btn-bg);
  color: var(--chatui-btn-fg);
  cursor: pointer;
  font-size: var(--chatui-font-size);
}
.btn-add:hover { background: var(--chatui-btn-hover); }
.btn-add:disabled { opacity: 0.5; cursor: default; }
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--chatui-font-size-sm);
  color: var(--chatui-fg-secondary);
  cursor: pointer;
}
.checkbox-label input[type="checkbox"] { margin: 0; }
</style>
