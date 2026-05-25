<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, SModal, SButton, SBadge, SSelect } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()

interface TodoRow {
  id: number
  dbSessionId: number
  sessionName: string
  channelId: string
  content: string
  status: 'pending' | 'done'
  priority: 'low' | 'normal' | 'high'
  deadline: string | null
  doneAt: string | null
  createdAt: string
}

const visible        = ref(false)
const dbSessionId    = ref<number | null>(null)
const sessionIdRef   = ref<string | null>(null)
const sessionLabel   = ref('')
const todos          = ref<TodoRow[]>([])
const loading        = ref(false)
const statusFilter   = ref<'pending' | 'done' | 'all'>('pending')

const pendingCount = computed(() => todos.value.filter(t => t.status === 'pending').length)
const doneCount    = computed(() => todos.value.filter(t => t.status === 'done').length)

function priorityVariant(p: string): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low')  return 'neutral'
  return 'info'
}

function priorityRank(p: string): number {
  if (p === 'high')   return 0
  if (p === 'normal') return 1
  return 2
}

const sortedTodos = computed(() =>
  [...todos.value].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    const pr = priorityRank(a.priority) - priorityRank(b.priority)
    if (pr !== 0) return pr
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  }),
)

function formatTime(ts: string | null): string {
  if (!ts) return t('todo.no_deadline')
  return new Date(ts).toLocaleString('zh-CN')
}

async function load() {
  const q = dbSessionId.value != null
    ? `dbSessionId=${dbSessionId.value}`
    : sessionIdRef.value
      ? `sessionId=${encodeURIComponent(sessionIdRef.value)}`
      : null
  if (!q) return
  loading.value = true
  try {
    const res = await apiFetch(`/api/todos?${q}&status=${statusFilter.value}`)
    todos.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function markDone(row: TodoRow) {
  if (!window.confirm(t('todo.confirm_done', { id: row.id }))) return
  try {
    await apiFetch(`/api/todos/${row.dbSessionId}/${row.id}`, 'PATCH')
    show(t('common.saved'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(row: TodoRow) {
  if (!window.confirm(t('todo.confirm_delete', { id: row.id }))) return
  try {
    await apiFetch(`/api/todos/${row.dbSessionId}/${row.id}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function open(id: number, label: string) {
  dbSessionId.value  = id
  sessionIdRef.value = null
  sessionLabel.value = label
  todos.value        = []
  statusFilter.value = 'pending'
  visible.value      = true
  load()
}

function openBySessionId(sid: string, label: string) {
  dbSessionId.value  = null
  sessionIdRef.value = sid
  sessionLabel.value = label
  todos.value        = []
  statusFilter.value = 'pending'
  visible.value      = true
  load()
}

defineExpose({ open, openBySessionId })
</script>

<template>
  <SModal v-model:visible="visible" width="lg">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px">
        <h3 class="s-modal-title">{{ t('todo.title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ sessionLabel }}</SBadge>
        <span v-if="!loading" class="todo-count-badge">
          {{ t('todo.count_pending', { n: pendingCount }) }}
          <span v-if="doneCount > 0" class="todo-count-done">/ {{ t('todo.count_done', { n: doneCount }) }}</span>
        </span>
      </div>
    </template>

    <template #toolbar>
      <SSelect v-model="statusFilter" size="sm" style="width:140px" @change="load">
        <option value="pending">{{ t('todo.filter_pending') }}</option>
        <option value="done">{{ t('todo.filter_done') }}</option>
        <option value="all">{{ t('todo.filter_all') }}</option>
      </SSelect>
      <SButton type="outline" size="sm" :disabled="loading" @click="load">
        {{ loading ? t('common.loading') : t('common.refresh') }}
      </SButton>
    </template>

    <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
    <div v-else-if="sortedTodos.length === 0" class="modal-empty">{{ t('todo.empty') }}</div>
    <ul v-else class="todo-list">
      <li v-for="row in sortedTodos" :key="row.id" class="todo-row" :class="{ done: row.status === 'done' }">
        <div class="todo-row-main">
          <span class="todo-row-id">#{{ row.id }}</span>
          <SBadge :variant="priorityVariant(row.priority)" size="sm">{{ row.priority }}</SBadge>
          <span class="todo-row-content">{{ row.content }}</span>
        </div>
        <div class="todo-row-meta">
          <span v-if="row.deadline" class="todo-row-time">⏰ {{ formatTime(row.deadline) }}</span>
          <span class="todo-row-time">{{ formatTime(row.createdAt) }}</span>
          <span v-if="row.status === 'done' && row.doneAt" class="todo-row-time todo-row-done-at">✓ {{ formatTime(row.doneAt) }}</span>
        </div>
        <div class="todo-row-ops">
          <SButton v-if="row.status === 'pending'" type="primary" size="sm" @click="markDone(row)">{{ t('todo.mark_done') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </div>
      </li>
    </ul>
  </SModal>
</template>

<style scoped>
.todo-count-badge { font-size: var(--sui-fs-sm); color: var(--sui-fg-disabled); }
.todo-count-done  { margin-left: 4px; }

.modal-loading,
.modal-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 60px 0;
  font-size: var(--sui-fs-lg);
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.todo-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px var(--sui-sp-3);
  align-items: center;
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border);
}
.todo-row:last-child { border-bottom: none; }
.todo-row.done .todo-row-content {
  color: var(--sui-fg-disabled);
  text-decoration: line-through;
}
.todo-row-main {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
}
.todo-row-id {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  flex-shrink: 0;
}
.todo-row-content {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
  min-width: 0;
  word-break: break-word;
}
.todo-row-meta {
  grid-column: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sui-sp-3);
  padding-left: 28px;
}
.todo-row-time {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.todo-row-done-at { color: var(--sui-success); }
.todo-row-ops {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
  flex-shrink: 0;
}
</style>
