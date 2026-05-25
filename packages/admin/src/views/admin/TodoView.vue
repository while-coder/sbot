<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, SButton, SBadge, SSelect, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'

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

const todos = ref<TodoRow[]>([])
const loading = ref(false)
const statusFilter = ref<'pending' | 'done' | 'all'>('pending')

const columns = computed<STableColumn[]>(() => {
  const base: STableColumn[] = [
    { key: 'id',          label: t('common.id') },
    { key: 'session',     label: t('todo.session_col') },
    { key: 'content',     label: t('todo.content_col'), primary: true },
    { key: 'priority',    label: t('todo.priority_col') },
    { key: 'deadline',    label: t('todo.deadline_col') },
    { key: 'createdAt',   label: t('todo.created_col') },
  ]
  if (statusFilter.value !== 'pending') {
    base.push({ key: 'status', label: t('todo.status_col') })
  }
  base.push({ key: 'ops', label: t('common.ops'), ops: true })
  return base
})

function priorityVariant(p: string): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low') return 'neutral'
  return 'info'
}

function statusVariant(s: string): 'success' | 'info' {
  return s === 'done' ? 'success' : 'info'
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(`/api/todos?status=${statusFilter.value}`)
    todos.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function formatTime(ts: string | null): string {
  if (!ts) return t('todo.no_deadline')
  return new Date(ts).toLocaleString('zh-CN')
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

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar :title="t('todo.title')">
      <template #actions>
        <SSelect v-model="statusFilter" size="sm" style="width:140px" @change="load">
          <option value="pending">{{ t('todo.filter_pending') }}</option>
          <option value="done">{{ t('todo.filter_done') }}</option>
          <option value="all">{{ t('todo.filter_all') }}</option>
        </SSelect>
        <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      </template>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="todos"
        row-key="id"
        :loading="loading"
        :loading-text="t('common.loading')"
        :empty-text="t('todo.empty')"
      >
        <template #id="{ row }"><span class="todo-id">#{{ row.id }}</span></template>
        <template #session="{ row }">
          <span class="todo-session">{{ row.sessionName || `#${row.dbSessionId}` }}</span>
          <span v-if="row.channelId" class="todo-channel">{{ row.channelId }}</span>
        </template>
        <template #content="{ row }">
          <span class="todo-content" :class="{ 'todo-content-done': row.status === 'done' }">{{ row.content }}</span>
        </template>
        <template #priority="{ row }">
          <SBadge :variant="priorityVariant(row.priority)">{{ row.priority }}</SBadge>
        </template>
        <template #deadline="{ row }"><span class="todo-time">{{ formatTime(row.deadline) }}</span></template>
        <template #createdAt="{ row }"><span class="todo-time">{{ formatTime(row.createdAt) }}</span></template>
        <template #status="{ row }">
          <SBadge :variant="statusVariant(row.status)">{{ row.status }}</SBadge>
        </template>
        <template #ops="{ row }">
          <SButton v-if="row.status === 'pending'" type="primary" size="sm" @click="markDone(row)">{{ t('todo.mark_done') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>
  </div>
</template>

<style scoped>
.todo-id {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
}
.todo-session {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg);
}
.todo-channel {
  display: block;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
}
.todo-content {
  display: inline-block;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.todo-content-done {
  color: var(--sui-fg-disabled);
  text-decoration: line-through;
}
.todo-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
</style>
