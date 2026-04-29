<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

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

const PRIORITY_BADGE: Record<string, { bg: string; color: string }> = {
  high:   { bg: '#fee2e2', color: '#dc2626' },
  normal: { bg: '#dbeafe', color: '#1d4ed8' },
  low:    { bg: '#f3f4f6', color: '#6b7280' },
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
    <div class="page-toolbar">
      <span class="page-toolbar-title">{{ t('todo.title') }}</span>
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
    </div>
    <div class="page-content">
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
            <td colspan="6" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="todos.length === 0">
            <td colspan="6" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('todo.empty') }}</td>
          </tr>
          <tr v-for="item in todos" :key="item.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ item.id }}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.content }}</td>
            <td>
              <span
                style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600"
                :style="{ background: (PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.normal).bg, color: (PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.normal).color }"
              >{{ item.priority }}</span>
            </td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatTime(item.deadline) }}</td>
            <td style="font-size:12px;color:#9b9b9b;white-space:nowrap">{{ formatTime(item.createdAt) }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-primary btn-sm" @click="markDone(item)">Done</button>
                <button class="btn-danger btn-sm" @click="remove(item)">{{ t('common.delete') }}</button>
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
          <div class="mobile-card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px">{{ item.content }}</span>
            <span
              style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600"
              :style="{ background: (PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.normal).bg, color: (PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.normal).color }"
            >{{ item.priority }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.id') }}</span>
            <span class="mobile-card-value" style="font-family:monospace;color:#9b9b9b">{{ item.id }}</span>
            <span class="mobile-card-label">{{ t('todo.deadline_col') }}</span>
            <span class="mobile-card-value" style="font-size:12px;color:#9b9b9b">{{ formatTime(item.deadline) }}</span>
            <span class="mobile-card-label">{{ t('todo.created_col') }}</span>
            <span class="mobile-card-value" style="font-size:12px;color:#9b9b9b">{{ formatTime(item.createdAt) }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-primary btn-sm" @click="markDone(item)">Done</button>
            <button class="btn-danger btn-sm" @click="remove(item)">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
