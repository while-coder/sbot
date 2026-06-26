<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SBadge, SButton, SEntityList, SFormItem, SModal, SSelect, STextarea } from 'sbot-ui'
import AgendaTriggerFields from '@/components/AgendaTriggerFields.vue'
import {
  firstNextFire,
  isOverdue,
  type AgendaItem,
  type AgendaOccurrence,
  type AgendaOccurrenceStatus,
  type AgendaPriority,
  type AgendaRow,
  type AgendaStatus,
  type AgendaStatusFilter,
  type AgendaTrigger,
} from '@/composables/useAgendas'
import {
  draftToSpec,
  emptyDraft,
  localInputToIso,
  triggerToDraft,
  tsToLocalInput,
  type TriggerDraft,
} from '@/composables/agendaTriggerDraft'

const props = withDefaults(defineProps<{
  items: AgendaRow[]
  loading: boolean
  pendingCount: number
  dueCount: number
  cancelledCount: number
  triggerCount: number
  statusFilter: AgendaStatusFilter
  showProfile?: boolean
  compact?: boolean
}>(), {
  showProfile: true,
  compact: false,
})

const emit = defineEmits<{
  (e: 'update:statusFilter', value: AgendaStatusFilter): void
  (e: 'refresh'): void
  (e: 'complete', row: AgendaRow): void
  (e: 'cancel', row: AgendaRow): void
  (e: 'reopen', row: AgendaRow): void
  (e: 'remove', row: AgendaRow): void
  (e: 'update', payload: { row: AgendaRow; patch: Record<string, unknown> }): void
  (e: 'fire-trigger', payload: { row: AgendaRow; trigger: AgendaTrigger }): void
  (e: 'cancel-trigger', payload: { row: AgendaRow; trigger: AgendaTrigger }): void
  (e: 'reopen-trigger', payload: { row: AgendaRow; trigger: AgendaTrigger }): void
  (e: 'remove-trigger', payload: { row: AgendaRow; trigger: AgendaTrigger }): void
  (e: 'add-trigger', payload: { row: AgendaRow }): void
  (e: 'update-trigger', payload: { row: AgendaRow; trigger: AgendaTrigger; spec: Record<string, unknown> }): void
}>()

const { t } = useI18n()

const visibleCount = computed(() => props.items.length)
const profileCount = computed(() => new Set(props.items.map(row => row.agendaId)).size)

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

function occurrenceVariant(s: AgendaOccurrenceStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'done') return 'success'
  if (s === 'pending') return 'warning'
  if (s === 'missed') return 'danger'
  return 'neutral'
}

function priorityLabel(p: AgendaPriority): string { return t(`agenda.priority_${p}`) }
function statusLabel(s: AgendaStatus): string { return t(`agenda.status_${s}`) }
function sourceLabel(s: AgendaItem['source']): string { return t(`agenda.source_${s}`) }
function checkInLabel(requiresCheckIn: AgendaItem['requiresCheckIn']): string { return t(requiresCheckIn ? 'agenda.check_in_on' : 'agenda.check_in_off') }
function triggerKindLabel(trigger: AgendaTrigger): string { return t(`agenda.trigger_${trigger.kind}`) }
function triggerActionLabel(trigger: AgendaTrigger): string { return t(`agenda.action_${trigger.action}`) }
function occurrenceStatusLabel(o: AgendaOccurrence): string { return t(`agenda.occurrence_${o.status}`) }

function formatTime(ts: number | null | undefined): string {
  if (!ts) return t('agenda.no_time')
  return new Date(ts).toLocaleString()
}

interface EditForm {
  content: string
  priority: AgendaPriority
  requiresCheckIn: boolean
  dueAt: string
}

const showEdit = ref(false)
const editingRow = ref<AgendaRow | null>(null)
const editForm = reactive<EditForm>({
  content: '',
  priority: 'normal',
  requiresCheckIn: false,
  dueAt: '',
})

function openEdit(row: AgendaRow): void {
  editingRow.value = row
  editForm.content = row.item.content
  editForm.priority = row.item.priority
  editForm.requiresCheckIn = row.item.requiresCheckIn
  editForm.dueAt = row.item.dueAt ? tsToLocalInput(row.item.dueAt) : ''
  showEdit.value = true
}

function clearDueAt(): void { editForm.dueAt = '' }

function submitEdit(): void {
  const row = editingRow.value
  if (!row) return
  const content = editForm.content.trim()
  if (!content) return
  const patch: Record<string, unknown> = {
    content,
    priority: editForm.priority,
    requiresCheckIn: editForm.requiresCheckIn,
    dueAt: editForm.dueAt ? localInputToIso(editForm.dueAt) : null,
  }
  emit('update', { row, patch })
  showEdit.value = false
  editingRow.value = null
}

// ── 触发器编辑：复用 AgendaTriggerFields，保存时整体覆盖该条 trigger 的 spec ──
const showTriggerEdit = ref(false)
const editingTriggerRow = ref<AgendaRow | null>(null)
const editingTrigger = ref<AgendaTrigger | null>(null)
const triggerDraft = reactive<TriggerDraft>(emptyDraft())
const triggerEditSpec = computed<Record<string, unknown> | null>(() => draftToSpec(triggerDraft))
const triggerEditInvalid = computed(() => triggerEditSpec.value == null)

function openTriggerEdit(row: AgendaRow, trigger: AgendaTrigger): void {
  editingTriggerRow.value = row
  editingTrigger.value = trigger
  Object.assign(triggerDraft, triggerToDraft(trigger))
  showTriggerEdit.value = true
}

function submitTriggerEdit(): void {
  const row = editingTriggerRow.value
  const trigger = editingTrigger.value
  if (!row || !trigger) return
  const spec = triggerEditSpec.value
  if (!spec) return
  emit('update-trigger', { row, trigger, spec })
  showTriggerEdit.value = false
  editingTriggerRow.value = null
  editingTrigger.value = null
}

function rowKeyFn(row: AgendaRow): number { return row.item.id }
function countOcc(row: AgendaRow, status: AgendaOccurrenceStatus): number {
  return row.occurrences.filter(o => o.status === status).length
}
function activeTriggers(row: AgendaRow): number { return row.triggers.filter(t => t.enabled).length }
function sortedTriggers(triggers: AgendaTrigger[]): AgendaTrigger[] {
  return [...triggers].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return b.createdAt - a.createdAt
  })
}
function sortedOccurrences(occurrences: AgendaOccurrence[]): AgendaOccurrence[] {
  return [...occurrences].sort((a, b) => b.scheduledAt - a.scheduledAt)
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
      <button
        type="button"
        class="agenda-stat agenda-stat--clickable"
        :class="{ 'agenda-stat--active': statusFilter === 'cancelled' }"
        :title="t('agenda.cancelled_stat_hint')"
        @click="emit('update:statusFilter', statusFilter === 'cancelled' ? 'pending' : 'cancelled')"
      >
        <span class="agenda-stat__label">{{ t('agenda.filter_cancelled') }}</span>
        <span class="agenda-stat__value">{{ cancelledCount }}</span>
      </button>
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

    <SEntityList
      :items="items"
      :row-key="rowKeyFn"
      expandable
      :loading="loading"
      :loading-text="t('common.loading')"
      :empty-text="t('agenda.empty')"
    >
      <template #title="{ item: row }">
        <span class="agenda-row__id">#{{ row.item.id }}</span>
        <span
          class="agenda-row__content"
          :class="{ 'agenda-row__content--done': row.item.status !== 'pending' }"
        >{{ row.item.content }}</span>
        <SBadge :variant="statusVariant(row.item.status)" size="xs">{{ statusLabel(row.item.status) }}</SBadge>
        <SBadge v-if="row.item.priority !== 'normal'" :variant="priorityVariant(row.item.priority)" size="xs">{{ priorityLabel(row.item.priority) }}</SBadge>
        <SBadge v-if="isOverdue(row)" variant="danger" size="xs">{{ t('agenda.overdue') }}</SBadge>
      </template>

      <template #aside="{ item: row }">
        <span v-if="firstNextFire(row)" class="agenda-row__next" :title="t('agenda.next_fire_col')">
          ⏰ {{ formatTime(firstNextFire(row)) }}
        </span>
        <span v-else-if="row.item.dueAt" class="agenda-row__next" :class="{ 'agenda-row__next--overdue': isOverdue(row) }" :title="t('agenda.due_col')">
          ⏳ {{ formatTime(row.item.dueAt) }}
        </span>
      </template>

      <template #ops="{ item: row }">
        <SButton v-if="row.item.status === 'pending'" type="primary" size="sm" @click="emit('complete', row)">{{ t('agenda.complete') }}</SButton>
        <SButton v-if="row.item.status === 'pending'" type="outline" size="sm" @click="openEdit(row)">{{ t('agenda.edit') }}</SButton>
        <SButton v-if="row.item.status === 'pending'" type="outline" size="sm" @click="emit('cancel', row)">{{ t('agenda.cancel') }}</SButton>
        <SButton v-if="row.item.status !== 'pending'" type="primary" size="sm" @click="emit('reopen', row)">{{ t('agenda.reopen') }}</SButton>
        <SButton type="danger" size="sm" @click="emit('remove', row)">{{ t('common.delete') }}</SButton>
      </template>

      <template #meta="{ item: row }">
        <span v-if="showProfile" class="agenda-meta-chip mono">{{ t('agenda.profile_col') }}: {{ row.agendaId.slice(0, 8) }}</span>
        <span class="agenda-meta-chip">{{ t('agenda.source_col') }}: {{ sourceLabel(row.item.source) }}</span>
        <span v-if="row.item.requiresCheckIn" class="agenda-meta-chip">{{ t('agenda.check_in_col') }}: {{ checkInLabel(row.item.requiresCheckIn) }}</span>
        <span v-if="row.triggers.length" class="agenda-meta-chip blue">
          {{ t('agenda.triggers_col') }}: {{ activeTriggers(row) }}/{{ row.triggers.length }}
        </span>
        <span v-if="countOcc(row, 'missed')" class="agenda-meta-chip overdue" :title="t('agenda.occurrence_missed_chip_hint')">
          {{ t('agenda.occurrence_missed') }}: {{ countOcc(row, 'missed') }}
        </span>
        <span v-if="countOcc(row, 'pending')" class="agenda-meta-chip orange" :title="t('agenda.occurrence_chip_hint')">
          {{ t('agenda.occurrence_pending') }}: {{ countOcc(row, 'pending') }}
        </span>
        <span v-if="countOcc(row, 'done')" class="agenda-meta-chip" :title="t('agenda.occurrence_done_chip_hint')">
          {{ t('agenda.occurrence_done') }}: {{ countOcc(row, 'done') }}
        </span>
        <span v-if="row.item.dueAt" class="agenda-meta-chip" :class="{ overdue: isOverdue(row) }">
          {{ t('agenda.due_col') }}: {{ formatTime(row.item.dueAt) }}
        </span>
      </template>

      <template #expanded="{ item: row }">
        <div class="agenda-expanded">
          <dl class="agenda-detail-grid">
            <div>
              <dt>{{ t('agenda.created_at') }}</dt>
              <dd>{{ formatTime(row.item.createdAt) }}</dd>
            </div>
            <div>
              <dt>{{ t('agenda.updated_at') }}</dt>
              <dd>{{ formatTime(row.item.updatedAt) }}</dd>
            </div>
            <div v-if="row.item.doneAt">
              <dt>{{ t('agenda.done_at') }}</dt>
              <dd>{{ formatTime(row.item.doneAt) }}</dd>
            </div>
            <div v-if="showProfile">
              <dt>{{ t('agenda.profile_col') }}</dt>
              <dd class="mono">{{ row.agendaId }}</dd>
            </div>
          </dl>

          <section class="agenda-sub-section">
            <div class="agenda-sub-title">
              <h4>{{ t('agenda.trigger_details') }}</h4>
              <SBadge variant="success" size="xs">{{ activeTriggers(row) }} / {{ row.triggers.length }}</SBadge>
              <SButton
                v-if="row.item.status === 'pending'"
                type="outline"
                size="sm"
                class="agenda-sub-add"
                @click="emit('add-trigger', { row })"
              >+ {{ t('agenda.edit_add_trigger') }}</SButton>
            </div>
            <p v-if="row.triggers.length > activeTriggers(row)" class="agenda-sub-hint">{{ t('agenda.trigger_disabled_hint') }}</p>
            <div v-if="row.triggers.length === 0" class="agenda-sub-empty">{{ t('agenda.no_trigger') }}</div>
            <ul v-else class="agenda-trigger-list">
              <li
                v-for="trigger in sortedTriggers(row.triggers)"
                :key="trigger.id"
                class="agenda-trigger-row"
                :class="{ 'agenda-trigger-row--disabled': !trigger.enabled }"
              >
                <div class="agenda-trigger-main">
                  <SBadge :variant="trigger.enabled ? 'success' : 'neutral'" size="xs">{{ triggerKindLabel(trigger) }}</SBadge>
                  <SBadge v-if="trigger.enabled" variant="info" size="xs">{{ triggerActionLabel(trigger) }}</SBadge>
                  <SBadge v-if="!trigger.enabled" variant="neutral" size="xs">{{ t('agenda.trigger_disabled') }}</SBadge>
                  <code class="agenda-trigger-expr">{{ trigger.expr }}</code>
                  <div class="agenda-trigger-ops">
                    <SButton
                      v-if="row.item.status === 'pending' && !trigger.enabled"
                      type="primary"
                      size="sm"
                      :title="t('agenda.reopen_trigger_hint')"
                      @click="emit('reopen-trigger', { row, trigger })"
                    >↻ {{ t('agenda.reopen_trigger') }}</SButton>
                    <SButton
                      type="outline"
                      size="sm"
                      :title="t('agenda.fire_trigger_hint')"
                      @click="emit('fire-trigger', { row, trigger })"
                    >⚡ {{ t('agenda.fire_trigger') }}</SButton>
                    <SButton
                      v-if="row.item.status === 'pending' && trigger.enabled"
                      type="outline"
                      size="sm"
                      :title="t('agenda.edit_trigger_hint')"
                      @click="openTriggerEdit(row, trigger)"
                    >✎ {{ t('agenda.edit') }}</SButton>
                    <SButton
                      v-if="trigger.enabled"
                      type="outline"
                      size="sm"
                      :title="t('agenda.cancel_trigger_hint')"
                      @click="emit('cancel-trigger', { row, trigger })"
                    >⏸ {{ t('agenda.cancel_trigger') }}</SButton>
                    <SButton
                      type="danger"
                      size="sm"
                      :title="t('agenda.delete_trigger_hint')"
                      @click="emit('remove-trigger', { row, trigger })"
                    >🗑 {{ t('common.delete') }}</SButton>
                  </div>
                </div>
                <dl class="agenda-trigger-grid">
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
                    <dd>{{ trigger.fireCount }} / {{ trigger.maxFires || '∞' }}</dd>
                  </div>
                  <div v-if="trigger.message" class="agenda-trigger-msg">
                    <dt>{{ t('agenda.trigger_message') }}</dt>
                    <dd>{{ trigger.message }}</dd>
                  </div>
                </dl>
              </li>
            </ul>
          </section>

          <section v-if="row.occurrences.length" class="agenda-sub-section">
            <div class="agenda-sub-title">
              <h4>{{ t('agenda.occurrence_section') }}</h4>
              <span class="agenda-sub-counts">
                <SBadge v-if="countOcc(row, 'pending')" variant="warning" size="xs">{{ t('agenda.occurrence_pending') }} {{ countOcc(row, 'pending') }}</SBadge>
                <SBadge v-if="countOcc(row, 'missed')" variant="danger" size="xs">{{ t('agenda.occurrence_missed') }} {{ countOcc(row, 'missed') }}</SBadge>
                <SBadge v-if="countOcc(row, 'done')" variant="success" size="xs">{{ t('agenda.occurrence_done') }} {{ countOcc(row, 'done') }}</SBadge>
              </span>
            </div>
            <p class="agenda-sub-hint">{{ t('agenda.occurrence_hint') }}</p>
            <ul class="agenda-occurrence-list">
              <li
                v-for="occ in sortedOccurrences(row.occurrences)"
                :key="occ.id"
                class="agenda-occurrence-row"
                :class="{
                  'agenda-occurrence-row--done': occ.status === 'done',
                  'agenda-occurrence-row--missed': occ.status === 'missed',
                }"
              >
                <SBadge :variant="occurrenceVariant(occ.status)" size="xs">{{ occurrenceStatusLabel(occ) }}</SBadge>
                <span class="agenda-occurrence-time mono">{{ formatTime(occ.scheduledAt) }}</span>
                <span v-if="occ.doneAt" class="agenda-occurrence-time mono muted">→ {{ formatTime(occ.doneAt) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </SEntityList>

    <SModal v-model:visible="showEdit" :title="editingRow ? t('agenda.edit_title', { id: editingRow.item.id }) : ''" width="md">
      <SFormItem :label="t('agenda.edit_content') + ' *'">
        <STextarea v-model="editForm.content" :placeholder="t('agenda.edit_content_placeholder')" :rows="3" />
      </SFormItem>
      <SFormItem :label="t('agenda.priority_col')">
        <SSelect v-model="editForm.priority">
          <option value="low">{{ t('agenda.priority_low') }}</option>
          <option value="normal">{{ t('agenda.priority_normal') }}</option>
          <option value="high">{{ t('agenda.priority_high') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agenda.check_in_col')" :hint="t('agenda.check_in_hint')">
        <label class="agenda-check-in-toggle">
          <input v-model="editForm.requiresCheckIn" type="checkbox" />
          <span>{{ t('agenda.check_in_label') }}</span>
        </label>
      </SFormItem>
      <SFormItem :label="t('agenda.edit_due_at')" :hint="t('agenda.edit_due_at_hint')">
        <div class="agenda-edit-due">
          <input v-model="editForm.dueAt" type="datetime-local" class="agenda-edit-datetime" />
          <SButton v-if="editForm.dueAt" type="outline" size="sm" @click="clearDueAt">{{ t('agenda.edit_clear_due') }}</SButton>
        </div>
      </SFormItem>

      <template #footer>
        <SButton type="outline" @click="showEdit = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" :disabled="!editForm.content.trim()" @click="submitEdit">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <SModal
      v-model:visible="showTriggerEdit"
      :title="editingTrigger ? t('agenda.trigger_edit_title_edit', { id: editingTrigger.id }) : ''"
      width="md"
    >
      <p class="agenda-edit-trigger-hint">{{ t('agenda.trigger_edit_hint') }}</p>
      <AgendaTriggerFields :draft="triggerDraft" :agenda-id="editingTriggerRow?.agendaId" />
      <p v-if="triggerEditInvalid" class="agenda-edit-trigger-error">{{ t('agenda.trigger_edit_invalid') }}</p>

      <template #footer>
        <SButton type="outline" @click="showTriggerEdit = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" :disabled="triggerEditInvalid" @click="submitTriggerEdit">{{ t('common.save') }}</SButton>
      </template>
    </SModal>
  </div>
</template>

<style scoped>
.agenda-board { min-height: 100%; }

.agenda-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(110px, 1fr));
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
}
.agenda-board--compact .agenda-summary { grid-template-columns: repeat(5, minmax(105px, 1fr)); }
.agenda-stat {
  min-width: 0;
  padding: var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
  transition: border-color 120ms ease, background 120ms ease;
  text-align: left;
}
.agenda-stat--strong {
  border-color: var(--sui-info);
  background: var(--sui-info-soft);
}
.agenda-stat--strong .agenda-stat__label,
.agenda-stat--strong .agenda-stat__value { color: var(--sui-on-info-soft); }
.agenda-stat--danger {
  border-color: var(--sui-danger);
  background: var(--sui-danger-soft);
}
.agenda-stat--danger .agenda-stat__label,
.agenda-stat--danger .agenda-stat__value { color: var(--sui-on-danger-soft); }
.agenda-stat--clickable {
  cursor: pointer;
  font: inherit;
}
.agenda-stat--clickable:hover { background: var(--sui-bg-hover); }
.agenda-stat--active {
  border-color: var(--sui-primary);
  background: var(--sui-info-soft);
}
.agenda-stat--active .agenda-stat__label,
.agenda-stat--active .agenda-stat__value { color: var(--sui-on-info-soft); }
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
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.agenda-view-tab:hover { background: var(--sui-bg-hover); }
.agenda-view-tab--active {
  border-color: var(--sui-primary);
  background: var(--sui-info-soft);
  color: var(--sui-on-info-soft);
  font-weight: 600;
}
.agenda-status-select { width: 150px; }

/* ── Row title / aside / meta ── */
.agenda-row__id {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  flex-shrink: 0;
}
.agenda-row__content {
  font-weight: 600;
  color: var(--sui-fg);
  overflow-wrap: anywhere;
  flex: 1 1 auto;
  min-width: 0;
}
.agenda-row__content--done {
  color: var(--sui-fg-muted);
  text-decoration: line-through;
}
.agenda-row__next {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-secondary);
  white-space: nowrap;
}
.agenda-row__next--overdue { color: var(--sui-danger); font-weight: 600; }

.agenda-meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 9px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-xs);
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agenda-meta-chip.mono { font-family: var(--sui-font-mono); }
.agenda-meta-chip.blue {
  background: var(--sui-info-soft);
  color: var(--sui-on-info-soft);
}
.agenda-meta-chip.orange {
  background: var(--sui-warning-soft);
  color: var(--sui-on-warning-soft);
}
.agenda-meta-chip.green {
  background: var(--sui-success-soft);
  color: var(--sui-on-success-soft);
}
.agenda-meta-chip.overdue {
  background: var(--sui-danger-soft);
  color: var(--sui-on-danger-soft);
  font-weight: 600;
}

/* ── Expanded body ── */
.agenda-expanded {
  padding: var(--sui-sp-4) var(--sui-sp-5);
  background: var(--sui-bg-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-4);
}
.agenda-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--sui-sp-3);
  margin: 0;
}
.agenda-detail-grid div { min-width: 0; }
.agenda-detail-grid dt {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}
.agenda-detail-grid dd {
  margin: var(--sui-sp-1) 0 0;
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  overflow-wrap: anywhere;
}
.agenda-detail-grid dd.mono { font-family: var(--sui-font-mono); }

.agenda-sub-section {
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  padding: var(--sui-sp-3) var(--sui-sp-4);
}
.agenda-sub-title {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  margin-bottom: var(--sui-sp-3);
}
.agenda-sub-title h4 {
  margin: 0;
  color: var(--sui-fg);
  font-size: var(--sui-fs-md);
}
.agenda-sub-empty {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  padding: var(--sui-sp-3) 0;
}

.agenda-trigger-list,
.agenda-occurrence-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-2);
}
.agenda-trigger-row {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  padding: var(--sui-sp-2) var(--sui-sp-3);
  background: var(--sui-bg-soft);
}
.agenda-trigger-row--disabled {
  opacity: 0.55;
  background: var(--sui-bg-subtle);
  border-style: dashed;
}
.agenda-trigger-row--disabled .agenda-trigger-expr,
.agenda-trigger-row--disabled .agenda-trigger-grid dd {
  text-decoration: line-through;
  text-decoration-color: var(--sui-fg-muted);
}
.agenda-trigger-main {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.agenda-trigger-expr {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  background: var(--sui-bg);
  padding: 1px 6px;
  border-radius: var(--sui-radius-sm);
  overflow-wrap: anywhere;
}
.agenda-trigger-ops {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.agenda-trigger-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--sui-sp-2) var(--sui-sp-3);
  margin: var(--sui-sp-2) 0 0;
}
.agenda-trigger-grid div { min-width: 0; }
.agenda-trigger-grid dt {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}
.agenda-trigger-grid dd {
  margin: 0;
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  overflow-wrap: anywhere;
}
.agenda-trigger-msg { grid-column: 1 / -1; }

.agenda-occurrence-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-1) var(--sui-sp-2);
  border-radius: var(--sui-radius-sm);
  font-size: var(--sui-fs-sm);
}
.agenda-occurrence-row--done { opacity: 0.65; }
.agenda-occurrence-row--cancelled {
  background: var(--sui-bg-soft);
  color: var(--sui-fg-muted);
  text-decoration: line-through;
}
.agenda-occurrence-row--missed {
  background: var(--sui-danger-soft);
  border-left: 3px solid var(--sui-danger);
  padding-left: calc(var(--sui-sp-2) - 3px);
}
.agenda-occurrence-row--missed,
.agenda-occurrence-row--missed .agenda-occurrence-time {
  color: var(--sui-on-danger-soft);
}
.agenda-occurrence-row--missed .agenda-occurrence-time.muted {
  color: var(--sui-on-danger-soft);
  opacity: 0.7;
}
.agenda-sub-counts {
  display: inline-flex;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.agenda-sub-hint {
  margin: 0 0 var(--sui-sp-2);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
  line-height: 1.5;
}
.agenda-occurrence-time { color: var(--sui-fg); }
.agenda-occurrence-time.mono { font-family: var(--sui-font-mono); }
.agenda-occurrence-time.muted { color: var(--sui-fg-muted); }

.agenda-edit-due {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.agenda-edit-datetime {
  flex: 1;
  height: 32px;
  padding: 0 var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  background: var(--sui-bg);
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  font-family: inherit;
  outline: none;
  color-scheme: light dark;
}
.agenda-edit-datetime:focus {
  border-color: var(--sui-primary);
}
.agenda-edit-section-title {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  margin-top: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-2);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
}
.agenda-edit-no-trigger {
  margin: var(--sui-sp-3) 0 0;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.agenda-edit-trigger-hint {
  margin: 0 0 var(--sui-sp-2);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
  line-height: 1.5;
}
.agenda-edit-trigger-hint.warning { color: var(--sui-warning); }

.agenda-edit-trigger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.agenda-edit-trigger-card {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  padding: var(--sui-sp-3) var(--sui-sp-4);
  background: var(--sui-bg-soft);
}
.agenda-edit-trigger-head {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  margin-bottom: var(--sui-sp-2);
}
.agenda-edit-trigger-label {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.agenda-edit-trigger-kind { width: 140px; }
.agenda-edit-trigger-fields {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-1);
  margin-bottom: var(--sui-sp-2);
}
.agenda-edit-trigger-every {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.agenda-edit-trigger-amount { width: 90px; }

.agenda-edit-trigger-actions {
  display: flex;
  margin-top: var(--sui-sp-2);
}
.agenda-edit-trigger-error {
  margin: var(--sui-sp-2) 0 0;
  color: var(--sui-danger);
  font-size: var(--sui-fs-sm);
}

@media (max-width: 1100px) {
  .agenda-summary { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
}
@media (max-width: 700px) {
  .agenda-summary,
  .agenda-board--compact .agenda-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .agenda-meta-chip { max-width: 100%; }
}
</style>
