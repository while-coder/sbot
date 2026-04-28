<template>
  <div class="workdir-picker">
    <div class="header-row">
      <button class="btn-back" @click="$emit('back')">&larr;</button>
      <h3>{{ remote.name }} — 选择工作目录</h3>
    </div>

    <div v-if="remote.workPaths.length" class="dir-list">
      <div v-for="(wp, i) in remote.workPaths" :key="i" class="dir-row">
        <template v-if="editingIndex === i">
          <div class="edit-form">
            <input v-model="editPath" placeholder="完整路径" />
            <input v-model="editAlias" placeholder="别名" />
            <div class="edit-actions">
              <button class="btn-sm btn-save" @click="onSaveEdit(i)">保存</button>
              <button class="btn-sm btn-cancel" @click="editingIndex = -1">取消</button>
            </div>
          </div>
        </template>
        <template v-else>
          <button class="dir-item" @click="$emit('select', wp.path)">
            <span class="dir-alias">{{ wp.alias }}</span>
            <span class="dir-path">{{ wp.path }}</span>
          </button>
          <div class="item-actions">
            <button class="btn-icon" title="编辑" @click.stop="startEdit(i, wp)">&#9998;</button>
            <button class="btn-icon btn-danger" title="删除" @click.stop="$emit('removeWorkPath', i)">&times;</button>
          </div>
        </template>
      </div>
    </div>
    <div v-else class="empty">暂无已保存目录</div>

    <div class="divider"></div>
    <h3>添加工作目录</h3>
    <div class="form">
      <label>完整路径</label>
      <input v-model="path" placeholder="/home/user/project" />

      <label>别名 (可选)</label>
      <input v-model="alias" :placeholder="pathBasename" />

      <button class="btn-add" :disabled="!path" @click="onAdd">添加</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { RemoteEntry, WorkPathEntry } from '../composables/useChat';

defineProps<{ remote: RemoteEntry }>();

const emit = defineEmits<{
  select: [path: string];
  add: [path: string, alias: string];
  updateWorkPath: [wpIndex: number, patch: { path?: string; alias?: string }];
  removeWorkPath: [wpIndex: number];
  back: [];
}>();

const path = ref('');
const alias = ref('');

const editingIndex = ref(-1);
const editPath = ref('');
const editAlias = ref('');

const pathBasename = computed(() => {
  if (!path.value) return '';
  return path.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';
});

function onAdd() {
  if (!path.value) return;
  emit('add', path.value, alias.value || pathBasename.value);
  path.value = '';
  alias.value = '';
}

function startEdit(i: number, wp: WorkPathEntry) {
  editingIndex.value = i;
  editPath.value = wp.path;
  editAlias.value = wp.alias;
}

function onSaveEdit(i: number) {
  emit('updateWorkPath', i, { path: editPath.value, alias: editAlias.value });
  editingIndex.value = -1;
}
</script>

<style scoped>
.workdir-picker {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-back {
  padding: 2px 8px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 14px;
}
.btn-back:hover { background: var(--vscode-list-hoverBackground); }
h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin: 0;
}
.dir-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dir-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dir-item {
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
.dir-item:hover { background: var(--vscode-list-hoverBackground); }
.dir-path {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
