<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SBadge, SButton, SSelect } from 'sbot-ui'
import {
  firstNextFire,
  isOverdue,
  type AgendaCategory,
  type AgendaItem,
  type AgendaPriority,
  type AgendaStatus,
  type AgendaStatusFilter,
  type AgendaTrigger,
  type AgendaViewFilter,
} from '@/composables/useAgendas'

const props = withDefaults(defineProps<{
  items: AgendaItem[]
  loading: boolean
  pendingCount: number
  dueCount: number
  triggerCount: number
  viewFilter: AgendaViewFilter
  statusFilter: AgendaStatusFilter
  showProfile?: boolean
  compact?: boolean
}>(), {
  showProfile: true,
  compact: false,
})

const emit = defineEmits<{
  (e: 'update:viewFilter', value: AgendaViewFilter): void
  (e: 'update:statusFilter', value: AgendaStatusFilter): void
  (e: 'refresh'): void
  (e: 'complete', row: AgendaItem): void
  (e: 'cancel', row: AgendaItem): void
  (e: 'skip-next', row: AgendaItem): void
  (e: 'remove', row: AgendaItem): void
}>()

const { t } = useI18n()
const selectedId = ref<number | null>(null)

const viewOptions: Array<{ value: AgendaViewFilter; label: string }> = [
  { value: 'all', label: 'agenda.view_all' },
  { value: 'todo', label: 'agenda.view_todo' },
  { value: 'upcoming', label: 'agenda.view_upcoming' },
  { value: 'routine', label: 'agenda.view_routine' },
  { value: 'automation', label: 'agenda.view_automation' },
]

const visibleCount = computed(() => props.items.length)
const profileCount = computed(() => new Set(props.items.map(row => row.agendaId)).size)
const selectedAgenda = computed(() => {
  if (selectedId.value == null) return props.items[0] ?? null
  return props.items.find(row => row.id === selectedId.value) ?? props.items[0] ?? null
})

watch(() => props.items, rows => {
  if (rows.length === 0) {
    selectedId.value = null
    return
  }
  if (!rows.some(row => row.id === selectedId.value)) selectedId.value = rows[0].id
}, { immediate: true })

function priorityVariant(p: AgendaPriority): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'normal') return 'info'
  return 'neutral'
}

function statusVariant(s: AgendaStatus): 'success' | 'warning' | 'neutral' {
  if (s === 'done') return 'success'
  if (s === 'pending') return 'warning'
  return 'neutral'
}

function categoryVariant(c: AgendaCategory): 'success' | 'info' | 'warning' | 'neutral' {
  if (c === 'routine') return 'success'
  if (c === 'reminder') return 'warning'
  return 'neutral'
}

function priorityLabel(p: AgendaPriority): string { return t(`agenda.priority_${p}`) }
function statusLabel(s: AgendaStatus): string { return t(`agenda.status_${s}`) }
function categoryLabel(c: AgendaCategory): string { return t(`agenda.category_${c}`) }
function sourceLabel(s: AgendaItem['source']): string { return t(`agenda.source_${s}`) }
function triggerKindLabel(trigger: AgendaTrigger): string { return t(`agenda.trigger_${trigger.kind}`) }
function triggerActionLabel(trigger: AgendaTrigger): string { return t(`agenda.action_${trigger.action}`) }

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('agenda.no_time')
  return new Date(ts).toLocaleString()
}

function canSkip(row: AgendaItem): boolean {
  return row.status === 'pending' && row.triggers.some(trigger => trigger.enabled && trigger.nextFireAt)
}

function selectAgenda(row: AgendaItem) {
  selectedId.value = row.id
}
</script>

<template>
  <div class="agenda-board" :class="{ 'agenda-board--compact': compact }">
    <section class="agenda-summary" aria-label="Agenda summary">
      <div class="agenda-stat agenda-stat--strong">
        <span class="agenda-stat__label">{{ t('agenda.total_visible') }}</span>
        <span class="agenda-stat__value">{{ visibleCount }}</span>
      </div>
      <div class="agenda-stat">
        <span class="agenda-stat__label">{{ t('agenda.filter_pending') }}</span>
        <span class="agenda-stat__value">{{ pendingCount }}</span>
      </div>
      <div class="agenda-stat" :class="{ 'agenda-stat--danger': dueCount > 0 }">
        <span class="agenda-stat__label">{{ t('agenda.overdue') }}</span>
        <span class="agenda-stat__value">{{ dueCount }}</span>
      </div>
      <div v-if="showProfile" class="agenda-stat">
        <span class="agenda-stat__label">{{ t('agenda.active_profiles') }}</span>
        <span class="agenda-stat__value">{{ profileCount }}</span>
      </div>
      <div class="agenda-stat">
        <span class="agenda-stat__label">{{ t('agenda.active_triggers') }}</span>
        <span class="agenda-stat__value">{{ triggerCount }}</span>
      </div>
    </section>

    <section class="agenda-controls" aria-label="Agenda controls">
      <div class="agenda-viewbar" aria-label="Agenda views">
        <button
          v-for="option in viewOptions"
          :key="option.value"
          type="button"
          class="agenda-view-tab"
          :class="{ 'agenda-view-tab--active': viewFilter === option.value }"
          @click="emit('update:viewFilter', option.value)"
        >
          {{ t(option.label) }}
        </button>
      </div>
      <div class="agenda-filters">
        <SSelect :model-value="statusFilter" size="sm" class="agenda-status-select" @update:model-value="v => emit('update:statusFilter', v as AgendaStatusFilter)">
          <option value="pending">{{ t('agenda.filter_pending') }}</option>
          <option value="done">{{ t('agenda.filter_done') }}</option>
          <option value="cancelled">{{ t('agenda.filter_cancelled') }}</option>
          <option value="all">{{ t('agenda.filter_all') }}</option>
        </SSelect>
        <SButton type="outline" size="sm" :loading="loading" @click="emit('refresh')">{{ t('common.refresh') }}</SButton>
      </div>
    </section>

    <div class="agenda-main">
      <section class="agenda-list-panel">
        <div class="agenda-panel-header">
          <h3>{{ t('agenda.list_title') }}</h3>
          <span>{{ visibleCount }}</span>
        </div>

        <div v-if="loading" class="agenda-empty">{{ t('common.loading') }}</div>
        <div v-else-if="items.length === 0" class="agenda-empty">{{ t('agenda.empty') }}</div>
        <div v-else class="agenda-list">
          <button
            v-for="row in items"
            :key="row.id"
            type="button"
            class="agenda-item"
            :class="{
              'agenda-item--selected': selectedAgenda?.id === row.id,
              'agenda-item--done': row.status !== 'pending',
            }"
            @click="selectAgenda(row)"
          >
            <span class="agenda-item__top">
              <span class="agenda-item__id">#{{ row.id }}</span>
              <SBadge :variant="categoryVariant(row.category)" size="xs">{{ categoryLabel(row.category) }}</SBadge>
              <SBadge :variant="priorityVariant(row.priority)" size="xs">{{ priorityLabel(row.priority) }}</SBadge>
              <SBadge :variant="statusVariant(row.status)" size="xs">{{ statusLabel(row.status) }}</SBadge>
            </span>
            <span class="agenda-item__content">{{ row.content }}</span>
            <span class="agenda-item__meta">
              <span v-if="showProfile" class="agenda-item__profile">{{ row.agendaId.slice(0, 8) }}</span>
              <span class="agenda-item__time" :class="{ 'agenda-item__time--overdue': isOverdue(row) }">
                {{ t('agenda.due_col') }} {{ formatTime(row.dueAt) }}
              </span>
              <span class="agenda-item__time">
                {{ t('agenda.next_fire_col') }} {{ formatTime(firstNextFire(row)) }}
              </span>
            </span>
          </button>
        </div>
      </section>

      <aside class="agenda-detail-panel">
        <template v-if="selectedAgenda">
          <div class="agenda-detail-head">
            <div class="agenda-detail-title">
              <span class="agenda-detail-id">#{{ selectedAgenda.id }}</span>
              <h3>{{ selectedAgenda.content }}</h3>
            </div>
            <div class="agenda-detail-badges">
              <SBadge :variant="categoryVariant(selectedAgenda.category)" size="sm">{{ categoryLabel(selectedAgenda.category) }}</SBadge>
              <SBadge :variant="priorityVariant(selectedAgenda.priority)" size="sm">{{ priorityLabel(selectedAgenda.priority) }}</SBadge>
              <SBadge :variant="statusVariant(selectedAgenda.status)" size="sm">{{ statusLabel(selectedAgenda.status) }}</SBadge>
            </div>
          </div>

          <div class="agenda-detail-actions">
            <SButton v-if="selectedAgenda.status === 'pending'" type="primary" size="sm" @click="emit('complete', selectedAgenda)">{{ t('agenda.complete') }}</SButton>
            <SButton v-if="selectedAgenda.status === 'pending'" type="outline" size="sm" @click="emit('cancel', selectedAgenda)">{{ t('agenda.cancel') }}</SButton>
            <SButton v-if="canSkip(selectedAgenda)" type="outline" size="sm" @click="emit('skip-next', selectedAgenda)">{{ t('agenda.skip_next') }}</SButton>
            <SButton type="danger" size="sm" @click="emit('remove', selectedAgenda)">{{ t('common.delete') }}</SButton>
          </div>

          <dl class="agenda-detail-grid">
            <div v-if="showProfile">
              <dt>{{ t('agenda.profile_col') }}</dt>
              <dd class="agenda-mono">{{ selectedAgenda.agendaId }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.source_col') }}</dt>
              <dd>{{ sourceLabel(selectedAgenda.source) }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.due_col') }}</dt>
              <dd :class="{ 'agenda-time--overdue': isOverdue(selectedAgenda) }">{{ formatTime(selectedAgenda.dueAt) }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.next_fire_col') }}</dt>
              <dd>{{ formatTime(firstNextFire(selectedAgenda)) }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.created_at') }}</dt>
              <dd>{{ formatTime(selectedAgenda.createdAt) }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.updated_at') }}</dt>
              <dd>{{ formatTime(selectedAgenda.updatedAt) }}</dd>
            </div>
          </dl>

          <section class="agenda-trigger-section">
            <div class="agenda-section-title">
              <h4>{{ t('agenda.trigger_details') }}</h4>
              <SBadge variant="neutral" size="xs">{{ selectedAgenda.triggers.length }}</SBadge>
            </div>
            <div v-if="selectedAgenda.triggers.length === 0" class="agenda-trigger-empty">{{ t('agenda.no_trigger') }}</div>
            <ul v-else class="agenda-trigger-list">
              <li
                v-for="trigger in selectedAgenda.triggers"
                :key="trigger.id"
                class="agenda-trigger-row"
                :class="{ 'agenda-trigger-row--disabled': !trigger.enabled }"
              >
                <div class="agenda-trigger-main">
                  <SBadge :variant="trigger.enabled ? 'success' : 'neutral'" size="xs">{{ triggerKindLabel(trigger) }}</SBadge>
                  <span class="agenda-trigger-expr">{{ trigger.expr }}</span>
                </div>
                <dl class="agenda-trigger-grid">
                  <div>
                    <dt>{{ t('agenda.trigger_action') }}</dt>
                    <dd>{{ triggerActionLabel(trigger) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('agenda.trigger_next') }}</dt>
                    <dd>{{ formatTime(trigger.nextFireAt) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('agenda.trigger_last') }}</dt>
                    <dd>{{ formatTime(trigger.lastFiredAt) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('agenda.trigger_count') }}</dt>
                    <dd>{{ trigger.fireCount }} / {{ trigger.maxFires || '-' }}</dd>
                  </div>
                  <div v-if="trigger.timezone">
                    <dt>{{ t('agenda.trigger_timezone') }}</dt>
                    <dd>{{ trigger.timezone }}</dd>
                  </div>
                  <div v-if="trigger.message">
                    <dt>{{ t('agenda.trigger_message') }}</dt>
                    <dd>{{ trigger.message }}</dd>
                  </div>
                </dl>
              </li>
            </ul>
          </section>
        </template>
        <div v-else class="agenda-empty">{{ t('agenda.no_selection') }}</div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.agenda-board { min-height: 100%; }
.agenda-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
}
.agenda-board--compact .agenda-summary { grid-template-columns: repeat(4, minmax(110px, 1fr)); }
.agenda-stat {
  min-width: 0;
  padding: var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
}
.agenda-stat--strong { border-color: var(--sui-border-strong); }
.agenda-stat--danger { border-color: var(--sui-danger); }
.agenda-stat__label {
  display: block;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  white-space: nowrap;
}
.agenda-stat__value {
  display: block;
  margin-top: var(--sui-sp-1);
  font-size: 24px;
  font-weight: 700;
  color: var(--sui-fg);
  line-height: 1.1;
}
.agenda-stat--danger .agenda-stat__value { color: var(--sui-danger); }
.agenda-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  flex-wrap: wrap;
  margin-bottom: var(--sui-sp-4);
}
.agenda-viewbar,
.agenda-filters {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
  flex-wrap: wrap;
}
.agenda-view-tab {
  border: 1px solid var(--sui-border);
  background: var(--sui-bg);
  color: var(--sui-fg-secondary);
  border-radius: var(--sui-radius-md);
  padding: var(--sui-sp-2) var(--sui-sp-4);
  font-size: var(--sui-fs-sm);
  cursor: pointer;
}
.agenda-view-tab:hover { background: var(--sui-bg-hover); }
.agenda-view-tab--active {
  border-color: var(--sui-primary);
  background: var(--sui-info-soft);
  color: var(--sui-primary);
  font-weight: 600;
}
.agenda-status-select { width: 150px; }
.agenda-main {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(360px, 0.9fr);
  gap: var(--sui-sp-4);
  align-items: start;
}
.agenda-board--compact .agenda-main {
  grid-template-columns: minmax(300px, 1fr) minmax(300px, 0.9fr);
}
.agenda-list-panel,
.agenda-detail-panel {
  min-width: 0;
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
  overflow: hidden;
}
.agenda-detail-panel {
  position: sticky;
  top: var(--sui-sp-4);
}
.agenda-board--compact .agenda-detail-panel { position: static; }
.agenda-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-4) var(--sui-sp-5);
  border-bottom: 1px solid var(--sui-border);
}
.agenda-panel-header h3,
.agenda-detail-title h3,
.agenda-section-title h4 {
  margin: 0;
  color: var(--sui-fg);
}
.agenda-panel-header h3,
.agenda-detail-title h3 { font-size: var(--sui-fs-lg); }
.agenda-panel-header span {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.agenda-list {
  max-height: calc(100vh - 300px);
  overflow: auto;
}
.agenda-board--compact .agenda-list { max-height: 52vh; }
.agenda-item {
  display: block;
  width: 100%;
  padding: var(--sui-sp-4) var(--sui-sp-5);
  border: none;
  border-bottom: 1px solid var(--sui-border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.agenda-item:last-child { border-bottom: none; }
.agenda-item:hover { background: var(--sui-bg-hover); }
.agenda-item--selected {
  background: var(--sui-info-soft);
  box-shadow: inset 3px 0 0 var(--sui-info);
}
.agenda-item--done .agenda-item__content {
  color: var(--sui-fg-muted);
  text-decoration: line-through;
}
.agenda-item__top,
.agenda-item__meta,
.agenda-detail-badges,
.agenda-detail-actions,
.agenda-section-title,
.agenda-trigger-main {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.agenda-item__id,
.agenda-detail-id,
.agenda-mono {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-muted);
}
.agenda-item__content {
  display: block;
  margin-top: var(--sui-sp-2);
  color: var(--sui-fg);
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.agenda-item__meta {
  margin-top: var(--sui-sp-2);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.agenda-item__profile { font-family: var(--sui-font-mono); }
.agenda-item__time--overdue,
.agenda-time--overdue { color: var(--sui-danger); font-weight: 600; }
.agenda-detail-panel { padding: var(--sui-sp-5); }
.agenda-detail-head {
  display: flex;
  justify-content: space-between;
  gap: var(--sui-sp-4);
  align-items: flex-start;
}
.agenda-detail-title { min-width: 0; }
.agenda-detail-title h3 {
  margin-top: var(--sui-sp-1);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.agenda-detail-actions {
  margin-top: var(--sui-sp-4);
  padding-bottom: var(--sui-sp-4);
  border-bottom: 1px solid var(--sui-border);
}
.agenda-detail-grid,
.agenda-trigger-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sui-sp-3);
  margin: var(--sui-sp-4) 0 0;
}
.agenda-detail-grid div,
.agenda-trigger-grid div { min-width: 0; }
.agenda-detail-grid dt,
.agenda-trigger-grid dt {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}
.agenda-detail-grid dd,
.agenda-trigger-grid dd {
  margin: var(--sui-sp-1) 0 0;
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  overflow-wrap: anywhere;
}
.agenda-trigger-section { margin-top: var(--sui-sp-5); }
.agenda-section-title {
  justify-content: space-between;
  padding-top: var(--sui-sp-4);
  border-top: 1px solid var(--sui-border);
}
.agenda-section-title h4 { font-size: var(--sui-fs-md); }
.agenda-trigger-empty,
.agenda-empty {
  padding: var(--sui-sp-8);
  color: var(--sui-fg-muted);
  text-align: center;
}
.agenda-trigger-list {
  list-style: none;
  margin: var(--sui-sp-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.agenda-trigger-row {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  padding: var(--sui-sp-3);
}
.agenda-trigger-row--disabled { opacity: 0.65; }
.agenda-trigger-expr {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-sm);
  overflow-wrap: anywhere;
}

@media (max-width: 1100px) {
  .agenda-summary { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
  .agenda-main,
  .agenda-board--compact .agenda-main { grid-template-columns: 1fr; }
  .agenda-detail-panel { position: static; }
  .agenda-list { max-height: none; }
}

@media (max-width: 700px) {
  .agenda-summary,
  .agenda-board--compact .agenda-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .agenda-detail-head { flex-direction: column; }
  .agenda-detail-grid,
  .agenda-trigger-grid { grid-template-columns: 1fr; }
}
</style>
