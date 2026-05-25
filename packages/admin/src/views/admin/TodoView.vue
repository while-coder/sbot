<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SButton, SBadge, SSelect, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { useTodos, isOverdue, type Todo } from '@/composables/useTodos'

const { t } = useI18n()

const {
  loading,
  statusFilter,
  sortedTodos,
  pendingCount,
  doneCount,
  overdueCount,
  load,
  markDone,
  remove,
  priorityLabel,
  statusLabel,
  formatTime,
} = useTodos({ buildQuery: () => '' })  // empty query = list all sessions

const columns = computed<STableColumn[]>(() => {
  const base: STableColumn[] = [
    { key: 'id',        label: t('common.id') },
    { key: 'session',   label: t('todo.session_col') },
    { key: 'content',   label: t('todo.content_col'), primary: true },
    { key: 'priority',  label: t('todo.priority_col') },
    { key: 'deadline',  label: t('todo.deadline_col') },
    { key: 'createdAt', label: t('todo.created_col') },
  ]
  if (statusFilter.value !== 'pending') {
    base.push({ key: 'status', label: t('todo.status_col') })
    base.push({ key: 'doneAt', label: t('todo.done_at') })
  }
  base.push({ key: 'ops', label: t('common.ops'), ops: true })
  return base
})

function priorityVariantOf(p: Todo['priority']): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low')  return 'neutral'
  return 'info'
}

function statusVariantOf(s: Todo['status']): 'success' | 'info' {
  return s === 'done' ? 'success' : 'info'
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar :title="t('todo.title')">
      <span v-if="!loading" class="todo-counts">
        <SBadge variant="info" size="sm">{{ t('todo.count_pending', { n: pendingCount }) }}</SBadge>
        <SBadge v-if="overdueCount > 0" variant="danger" size="sm">{{ t('todo.overdue') }} {{ overdueCount }}</SBadge>
        <SBadge v-if="doneCount > 0" variant="success" size="sm">{{ t('todo.count_done', { n: doneCount }) }}</SBadge>
      </span>
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
        :rows="sortedTodos"
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
          <SBadge :variant="priorityVariantOf(row.priority)">{{ priorityLabel(row.priority) }}</SBadge>
        </template>
        <template #deadline="{ row }">
          <span class="todo-time" :class="{ 'todo-time-overdue': isOverdue(row) }">
            <span v-if="isOverdue(row)" class="todo-overdue-icon">⚠</span>
            {{ formatTime(row.deadline) }}
          </span>
        </template>
        <template #createdAt="{ row }"><span class="todo-time">{{ formatTime(row.createdAt) }}</span></template>
        <template #status="{ row }">
          <SBadge :variant="statusVariantOf(row.status)">{{ statusLabel(row.status) }}</SBadge>
        </template>
        <template #doneAt="{ row }">
          <span class="todo-time todo-time-done">{{ row.doneAt ? formatTime(row.doneAt) : '-' }}</span>
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
.todo-counts {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
}
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
.todo-time-overdue {
  color: var(--sui-danger);
  font-weight: 500;
}
.todo-time-done {
  color: var(--sui-success);
}
.todo-overdue-icon {
  margin-right: 2px;
}
</style>
