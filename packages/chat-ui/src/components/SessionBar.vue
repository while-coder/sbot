<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { SButton, SInput } from 'sbot-ui'
import type { SessionItem, ChatLabels } from '../types'
import { resolveLabels, tpl } from '../labels'

const props = withDefaults(defineProps<{
  sessions: SessionItem[]
  activeSessionId: string | null
  labels?: ChatLabels
  showHeader?: boolean
}>(), {
  showHeader: true,
})

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
  rename: [id: string, name: string]
  newSession: []
}>()

const L = computed(() => resolveLabels(props.labels))

const editingId = ref<string | null>(null)
const editingName = ref('')
const nameInputEl = ref<InstanceType<typeof SInput> | null>(null)

function startEdit(id: string) {
  editingId.value = id
  editingName.value = props.sessions.find(s => s.id === id)?.name || ''
  nextTick(() => {
    const el = (nameInputEl.value as any)?.$el as HTMLElement | undefined
    el?.querySelector('input')?.focus()
  })
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
  const label = s?.name || L.value.untitledSession
  if (window.confirm(tpl(L.value.confirmDeleteSession, { name: label }))) {
    emit('delete', id)
  }
}
</script>

<template>
  <div class="chatui-session-bar">
    <div v-if="showHeader" class="chatui-session-bar-header">
      <SButton type="outline" size="sm" block @click="emit('newSession')">{{ L.newSession }}</SButton>
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
            <SInput
              v-if="editingId === s.id"
              ref="nameInputEl"
              v-model="editingName"
              size="sm"
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
            >{{ s.name || L.untitledSession }}</div>
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
.chatui-session-empty {
  text-align: center; color: var(--chatui-fg-secondary);
  padding: 20px 8px; font-size: 12px;
}
</style>
