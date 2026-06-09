<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { SButton, SInput, useConfirm } from 'sbot-ui'
import type { SessionItem, ChatLabels } from '../types'
import { resolveLabels, tpl } from '../labels'

const props = withDefaults(defineProps<{
  sessions: SessionItem[]
  activeProfileId: string | null
  highlightedProfileId?: string | null
  labels?: ChatLabels
  showHeader?: boolean
  searchable?: boolean
  width?: number
  emptyMessage?: string
}>(), {
  showHeader: true,
  searchable: false,
  highlightedProfileId: null,
})

const barStyle = computed(() =>
  props.width != null ? { width: `${props.width}px` } : undefined,
)

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
  rename: [id: string, name: string]
  newSession: []
}>()

const L = computed(() => resolveLabels(props.labels))
const { confirm } = useConfirm()

const editingId = ref<string | null>(null)
const editingName = ref('')
const nameInputEl = ref<InstanceType<typeof SInput> | null>(null)

const searchQuery = ref('')
const displayedSessions = computed<SessionItem[]>(() => {
  if (!props.searchable) return props.sessions
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.sessions
  return props.sessions.filter(s => {
    const name = (s.name || '').toLowerCase()
    const path = (s.workPath || '').toLowerCase()
    return name.includes(q) || path.includes(q)
  })
})
const resolvedEmptyMessage = computed(() => {
  if (props.searchable && searchQuery.value.trim()) return L.value.sessionNoMatch
  return props.emptyMessage
})

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

async function onDelete(id: string) {
  const s = props.sessions.find(s => s.id === id)
  const label = s?.name || L.value.untitledSession
  if (await confirm(tpl(L.value.confirmDeleteSession, { name: label }), {
    danger: true,
    cancelText: L.value.cancel,
  })) {
    emit('delete', id)
  }
}
</script>

<template>
  <div class="chatui-session-bar" :style="barStyle">
    <div v-if="showHeader" class="chatui-session-bar-header">
      <SButton type="outline" size="sm" block @click="emit('newSession')">{{ L.newSession }}</SButton>
    </div>
    <div v-if="searchable" class="chatui-session-bar-search">
      <svg class="chatui-session-bar-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="7" cy="7" r="4.5"/>
        <path d="m10.5 10.5 3 3"/>
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="chatui-session-bar-search-input"
        :placeholder="L.sessionSearchPlaceholder"
      />
      <button
        v-if="searchQuery"
        class="chatui-session-bar-search-clear"
        :title="L.cancel"
        @click="searchQuery = ''"
      >×</button>
    </div>
    <div class="chatui-session-list">
      <div
        v-for="s in displayedSessions" :key="s.id"
        class="chatui-session-item"
        :class="{ active: activeProfileId === s.id, highlighted: highlightedProfileId === s.id }"
        :data-profile-id="s.id"
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
      <div v-if="displayedSessions.length === 0" class="chatui-session-empty">
        <template v-if="resolvedEmptyMessage">{{ resolvedEmptyMessage }}</template>
        <template v-else>{{ L.emptySession }}<br>{{ L.createSessionHint }}</template>
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
.chatui-session-bar-search {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--chatui-border-subtle, var(--chatui-border));
  flex-shrink: 0;
}
.chatui-session-bar-search-icon {
  flex-shrink: 0; color: var(--chatui-fg-secondary);
}
.chatui-session-bar-search-input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font: inherit; color: var(--chatui-fg);
  padding: 2px 0;
}
.chatui-session-bar-search-input::placeholder { color: var(--chatui-fg-secondary); }
.chatui-session-bar-search-clear {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px; background: transparent;
  color: var(--chatui-fg-secondary);
  font-size: 14px; line-height: 1; cursor: pointer; flex-shrink: 0;
}
.chatui-session-bar-search-clear:hover {
  background: var(--chatui-bg-hover); color: var(--chatui-fg);
}
.chatui-session-list { flex: 1; overflow-y: auto; padding: 4px; }
.chatui-session-item {
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  transition: background .12s; margin-bottom: 2px;
}
.chatui-session-item:hover { background: var(--chatui-bg-hover); }
.chatui-session-item.active { background: var(--chatui-bg-active); }
.chatui-session-item.highlighted {
  background: var(--chatui-bg-hover);
  box-shadow: inset 0 0 0 1px var(--chatui-border-focus, var(--chatui-accent));
}
.chatui-session-item.active.highlighted { background: var(--chatui-bg-active); }
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
