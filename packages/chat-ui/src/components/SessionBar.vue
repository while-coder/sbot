<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { SessionItem, ChatLabels } from '../types'
import { resolveLabels, tpl } from '../labels'

const props = defineProps<{
  sessions: SessionItem[]
  activeSessionId: string | null
  labels?: ChatLabels
}>()

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
  rename: [id: string, name: string]
  newSession: []
}>()

const L = computed(() => resolveLabels(props.labels))

const editingId = ref<string | null>(null)
const editingName = ref('')
const nameInputEl = ref<HTMLInputElement | null>(null)

function startEdit(id: string) {
  editingId.value = id
  editingName.value = props.sessions.find(s => s.id === id)?.name || ''
  nextTick(() => nameInputEl.value?.focus())
}

function commitEdit() {
  const id = editingId.value
  editingId.value = null
  if (!id) return
  const val = editingName.value.trim()
  if (val) emit('rename', id, val)
}

function onDelete(id: string) {
  const s = props.sessions.find(s => s.id === id)
  const label = s?.name || id.slice(0, 8) + '…'
  if (window.confirm(tpl(L.value.confirmDeleteSession, { name: label }))) {
    emit('delete', id)
  }
}
</script>

<template>
  <div class="chatui-session-bar">
    <div class="chatui-session-bar-header">
      <button class="chatui-btn-outline chatui-btn-sm" style="width:100%" @click="emit('newSession')">{{ L.newSession }}</button>
    </div>
    <div class="chatui-session-list">
      <div
        v-for="s in sessions" :key="s.id"
        class="chatui-session-item"
        :class="{ active: activeSessionId === s.id }"
        @click="emit('select', s.id)"
      >
        <div style="display:flex;align-items:center;gap:4px">
          <div style="flex:1;min-width:0">
            <input
              v-if="editingId === s.id"
              ref="nameInputEl"
              v-model="editingName"
              class="chatui-session-name-input"
              @click.stop
              @blur="commitEdit"
              @keydown.enter.stop="commitEdit"
              @keydown.escape.stop="editingId = null"
            />
            <div
              v-else
              class="chatui-session-item-name"
              @dblclick.stop="startEdit(s.id)"
              :title="L.editSessionNameHint"
            >{{ s.name || s.id.slice(0, 8) + '…' }}</div>
            <div v-if="s.workPath" class="chatui-session-item-path" :title="s.workPath">{{ s.workPath }}</div>
          </div>
          <button class="chatui-session-del-btn" @click.stop="onDelete(s.id)">×</button>
        </div>
      </div>
      <div v-if="sessions.length === 0" class="chatui-session-empty">
        {{ L.emptySession }}<br>{{ L.createSessionHint }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.chatui-session-bar {
  width: 180px; border-right: 1px solid var(--chatui-border);
  display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0;
  background: var(--chatui-bg-surface);
}
.chatui-session-bar-header {
  padding: 6px 8px; border-bottom: 1px solid var(--chatui-border); flex-shrink: 0;
}
.chatui-session-list { flex: 1; overflow-y: auto; padding: 4px; }
.chatui-session-item {
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  transition: background .12s; margin-bottom: 2px;
}
.chatui-session-item:hover { background: var(--chatui-bg-hover); }
.chatui-session-item.active { background: var(--chatui-bg-active); }
.chatui-session-item-name {
  font-size: 13px; font-weight: 500; color: var(--chatui-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chatui-session-item-path {
  font-size: 10px; color: var(--chatui-fg-secondary);
  font-family: monospace; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; margin-top: 1px;
}
.chatui-session-del-btn {
  background: none; border: none; cursor: pointer; color: transparent;
  font-size: 16px; padding: 0 2px; line-height: 1; flex-shrink: 0; transition: color .1s;
}
.chatui-session-item:hover .chatui-session-del-btn { color: var(--chatui-fg-secondary); }
.chatui-session-del-btn:hover { color: var(--chatui-btn-danger) !important; }
.chatui-session-name-input {
  width: 100%; font-size: 13px; font-weight: 500; padding: 1px 4px;
  border: 1px solid var(--chatui-fg); border-radius: 4px;
  outline: none; font-family: inherit;
  color: var(--chatui-fg); background: var(--chatui-bg-surface);
}
.chatui-session-empty {
  text-align: center; color: var(--chatui-fg-secondary);
  padding: 20px 8px; font-size: 12px;
}
.chatui-btn-outline {
  padding: 4px 10px; border: 1px solid var(--chatui-border);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-fg);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover); }
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }
</style>
