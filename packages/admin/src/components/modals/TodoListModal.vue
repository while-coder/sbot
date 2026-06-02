<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SModal, SButton, SBadge, SSelect } from 'sbot-ui'
import { useTodos, isOverdue, type Todo } from '@/composables/useTodos'

const { t } = useI18n()

const visible       = ref(false)
const profileIdRef  = ref<string | null>(null)
const sessionLabel  = ref('')

const {
  todos,
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
  formatTime,
} = useTodos({
  buildQuery: () => {
    if (profileIdRef.value)         return `profileId=${encodeURIComponent(profileIdRef.value)}`
    return null
  },
})

function priorityVariantOf(p: Todo['priority']): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low')  return 'neutral'
  return 'info'
}

function openByProfileId(profileId: string, label: string) {
  profileIdRef.value = profileId
  sessionLabel.value = label
  todos.value        = []
  statusFilter.value = 'pending'
  visible.value      = true
  load()
}

defineExpose({ openByProfileId })
</script>

<template>
  <SModal v-model:visible="visible" width="lg">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h3 class="s-modal-title">{{ t('todo.title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ sessionLabel }}</SBadge>
        <span v-if="!loading" class="todo-counts">
          <SBadge variant="info" size="sm">{{ t('todo.count_pending', { n: pendingCount }) }}</SBadge>
          <SBadge v-if="overdueCount > 0" variant="danger" size="sm">{{ t('todo.overdue') }} {{ overdueCount }}</SBadge>
          <SBadge v-if="doneCount > 0" variant="success" size="sm">{{ t('todo.count_done', { n: doneCount }) }}</SBadge>
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
      <li
        v-for="row in sortedTodos"
        :key="row.id"
        class="todo-row"
        :class="{ done: row.status === 'done', overdue: isOverdue(row) }"
      >
        <div class="todo-row-main">
          <span class="todo-row-id">#{{ row.id }}</span>
          <SBadge :variant="priorityVariantOf(row.priority)" size="sm">{{ priorityLabel(row.priority) }}</SBadge>
          <span class="todo-row-content">{{ row.content }}</span>
        </div>
        <div class="todo-row-meta">
          <span v-if="row.deadline" class="todo-row-time" :class="{ 'todo-row-overdue': isOverdue(row) }">
            <span v-if="isOverdue(row)" class="todo-overdue-icon">⚠</span>
            ⏰ {{ formatTime(row.deadline) }}
          </span>
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
.todo-counts {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
}

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
.todo-row-overdue {
  color: var(--sui-danger);
  font-weight: 500;
}
.todo-row-done-at { color: var(--sui-success); }
.todo-overdue-icon { margin-right: 2px; }
.todo-row-ops {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
  flex-shrink: 0;
}
</style>
