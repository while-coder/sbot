<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, SButton, SBadge, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()

interface TodoRow {
  id: number
  type: string | null
  targetId: string | null
  content: string
  status: string
  priority: string
  deadline: number | null
  schedulerId: number | null
  doneAt: number | null
  createdAt: number
}

const todos = ref<TodoRow[]>([])
const loading = ref(false)

const columns = computed<STableColumn[]>(() => [
  { key: 'id',        label: t('common.id') },
  { key: 'content',   label: t('todo.content_col'), primary: true },
  { key: 'priority',  label: t('todo.priority_col') },
  { key: 'deadline',  label: t('todo.deadline_col') },
  { key: 'createdAt', label: t('todo.created_col') },
  { key: 'ops',       label: t('common.ops'), ops: true },
])

function priorityVariant(p: string): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low') return 'neutral'
  return 'info'
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/todos')
    todos.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function formatTime(ts: number | null): string {
  if (!ts) return t('todo.no_deadline')
  return new Date(ts).toLocaleString('zh-CN')
}

async function markDone(row: TodoRow) {
  if (!confirm(t('todo.confirm_done', { id: row.id }))) return
  try {
    await apiFetch(`/api/todos/${row.id}`, 'PATCH')
    show('Done')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(row: TodoRow) {
  if (!confirm(t('todo.confirm_delete', { id: row.id }))) return
  try {
    await apiFetch(`/api/todos/${row.id}`, 'DELETE')
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
        <template #id="{ row }"><span class="todo-id">{{ row.id }}</span></template>
        <template #content="{ row }"><span class="todo-content">{{ row.content }}</span></template>
        <template #priority="{ row }">
          <SBadge :variant="priorityVariant(row.priority)">{{ row.priority }}</SBadge>
        </template>
        <template #deadline="{ row }"><span class="todo-time">{{ formatTime(row.deadline) }}</span></template>
        <template #createdAt="{ row }"><span class="todo-time">{{ formatTime(row.createdAt) }}</span></template>
        <template #ops="{ row }">
          <SButton type="primary" size="sm" @click="markDone(row)">Done</SButton>
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
.todo-content {
  display: inline-block;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.todo-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
</style>
