<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast, SButton, SBadge, SPageToolbar, SPageContent } from 'sbot-ui'

const { t } = useI18n()
const { isMobile } = useResponsive()
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
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th>{{ t('common.id') }}</th>
            <th>{{ t('todo.content_col') }}</th>
            <th>{{ t('todo.priority_col') }}</th>
            <th>{{ t('todo.deadline_col') }}</th>
            <th>{{ t('todo.created_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="todo-empty">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="todos.length === 0">
            <td colspan="6" class="todo-empty">{{ t('todo.empty') }}</td>
          </tr>
          <tr v-for="item in todos" :key="item.id">
            <td class="todo-id">{{ item.id }}</td>
            <td class="todo-content">{{ item.content }}</td>
            <td>
              <SBadge :variant="priorityVariant(item.priority)">{{ item.priority }}</SBadge>
            </td>
            <td class="todo-time">{{ formatTime(item.deadline) }}</td>
            <td class="todo-time">{{ formatTime(item.createdAt) }}</td>
            <td>
              <div class="ops-cell">
                <SButton type="primary" size="sm" @click="markDone(item)">Done</SButton>
                <SButton type="danger" size="sm" @click="remove(item)">{{ t('common.delete') }}</SButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-if="loading" class="mobile-card-empty">{{ t('common.loading') }}</div>
        <div v-else-if="todos.length === 0" class="mobile-card-empty">{{ t('todo.empty') }}</div>
        <div v-for="item in todos" :key="item.id" class="mobile-card">
          <div class="mobile-card-header">
            <span class="mobile-card-content">{{ item.content }}</span>
            <SBadge :variant="priorityVariant(item.priority)">{{ item.priority }}</SBadge>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.id') }}</span>
            <span class="mobile-card-value todo-id">{{ item.id }}</span>
            <span class="mobile-card-label">{{ t('todo.deadline_col') }}</span>
            <span class="mobile-card-value todo-time">{{ formatTime(item.deadline) }}</span>
            <span class="mobile-card-label">{{ t('todo.created_col') }}</span>
            <span class="mobile-card-value todo-time">{{ formatTime(item.createdAt) }}</span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="primary" size="sm" @click="markDone(item)">Done</SButton>
            <SButton type="danger" size="sm" @click="remove(item)">{{ t('common.delete') }}</SButton>
          </div>
        </div>
      </div>
    </SPageContent>
  </div>
</template>

<style scoped>
.todo-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.todo-id {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
}
.todo-content {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.mobile-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mobile-card-content {
  font-size: var(--sui-fs-md);
}
</style>
