<script lang="ts">
export type STableColumn = {
  key: string
  label?: string
  slot?: string
  ellipsis?: boolean
  primary?: boolean
  ops?: boolean
  width?: string
  align?: 'left' | 'right' | 'center'
}
</script>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, ref, watch } from 'vue'

type RowKey = string | number
type RowClassName<R> = string | ((row: R, index: number) => string)

const props = withDefaults(defineProps<{
  columns: STableColumn[]
  rows: T[]
  rowKey?: keyof T | ((row: T) => RowKey)
  emptyText?: string
  loading?: boolean
  loadingText?: string
  rowClassName?: RowClassName<T>
  expandable?: boolean
  expandedKeys?: RowKey[]
  defaultExpandedKeys?: RowKey[]
}>(), {
  rowKey: 'id' as any,
  emptyText: '—',
  loading: false,
  loadingText: 'Loading…',
  expandable: false,
})

const emit = defineEmits<{
  'update:expandedKeys': [keys: RowKey[]]
  'expand': [row: T, expanded: boolean]
}>()

const primaryCol = computed(() => props.columns.find(c => c.primary))
const opsCol     = computed(() => props.columns.find(c => c.ops))
const fieldCols  = computed(() => props.columns.filter(c => !c.primary && !c.ops))
const totalCols  = computed(() => props.columns.length + (props.expandable ? 1 : 0))

const internalExpanded = ref<Set<RowKey>>(new Set(props.defaultExpandedKeys ?? []))
const isControlled = computed(() => props.expandedKeys !== undefined)
const expandedSet = computed<Set<RowKey>>(() =>
  isControlled.value ? new Set(props.expandedKeys) : internalExpanded.value,
)

watch(() => props.expandedKeys, v => {
  if (v !== undefined) internalExpanded.value = new Set(v)
})

function getRowKey(row: T, idx: number): RowKey {
  const rk = props.rowKey
  if (typeof rk === 'function') return rk(row)
  const v = (row as any)[rk as any]
  return v ?? idx
}

function slotName(col: STableColumn): string {
  return col.slot ?? col.key
}

function isExpanded(key: RowKey): boolean {
  return expandedSet.value.has(key)
}

function toggleExpand(row: T, key: RowKey) {
  const next = new Set(expandedSet.value)
  const willExpand = !next.has(key)
  if (willExpand) next.add(key)
  else next.delete(key)
  if (!isControlled.value) internalExpanded.value = next
  emit('update:expandedKeys', Array.from(next))
  emit('expand', row, willExpand)
}

function rowCls(row: T, idx: number): string {
  const rcn = props.rowClassName
  if (!rcn) return ''
  return typeof rcn === 'function' ? rcn(row, idx) : rcn
}
</script>

<template>
  <div class="s-table-root">
    <table class="s-table">
      <thead>
        <tr>
          <th v-if="expandable" class="s-table-expand-th"></th>
          <th
            v-for="col in columns"
            :key="col.key"
            :style="{ width: col.width, textAlign: col.align }"
          >{{ col.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td :colspan="totalCols" class="s-table-status">
            <slot name="_loading">{{ loadingText }}</slot>
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td :colspan="totalCols" class="s-table-status s-table-empty">
            <slot name="_empty">{{ emptyText }}</slot>
          </td>
        </tr>
        <template v-else v-for="(row, idx) in rows" :key="getRowKey(row, idx)">
          <tr
            :class="[rowCls(row, idx), { 's-table-row--expanded': expandable && isExpanded(getRowKey(row, idx)), 's-table-row--expandable': expandable }]"
            @click="expandable && toggleExpand(row, getRowKey(row, idx))"
          >
            <td v-if="expandable" class="s-table-expand-cell">
              <span class="s-table-expand-icon">{{ isExpanded(getRowKey(row, idx)) ? '▼' : '▶' }}</span>
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              :class="{ 's-table-cell--ellipsis': col.ellipsis, 's-table-cell--ops': col.ops }"
              :style="{ textAlign: col.align }"
              @click="col.ops && $event.stopPropagation()"
            >
              <slot :name="slotName(col)" :row="row" :column="col">
                {{ (row as any)[col.key] }}
              </slot>
            </td>
          </tr>
          <tr
            v-if="expandable && isExpanded(getRowKey(row, idx))"
            class="s-table-expanded-row"
          >
            <td></td>
            <td :colspan="columns.length" class="s-table-expanded-cell">
              <slot name="_expanded" :row="row" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div class="s-table-cards">
      <div v-if="loading" class="s-table-cards-status">
        <slot name="_loading">{{ loadingText }}</slot>
      </div>
      <div v-else-if="rows.length === 0" class="s-table-cards-status s-table-cards-empty">
        <slot name="_empty">{{ emptyText }}</slot>
      </div>
      <template v-else>
        <div
          v-for="(row, idx) in rows"
          :key="getRowKey(row, idx)"
          :class="['s-table-card', rowCls(row, idx)]"
        >
          <div
            v-if="primaryCol || expandable"
            :class="['s-table-card-header', { 's-table-card-header--expandable': expandable }]"
            @click="expandable && toggleExpand(row, getRowKey(row, idx))"
          >
            <span v-if="expandable" class="s-table-expand-icon">{{ isExpanded(getRowKey(row, idx)) ? '▼' : '▶' }}</span>
            <slot v-if="primaryCol" :name="slotName(primaryCol)" :row="row" :column="primaryCol">
              {{ (row as any)[primaryCol.key] }}
            </slot>
          </div>
          <div v-if="fieldCols.length" class="s-table-card-fields">
            <template v-for="col in fieldCols" :key="col.key">
              <span class="s-table-card-label">{{ col.label }}</span>
              <span class="s-table-card-value">
                <slot :name="slotName(col)" :row="row" :column="col">
                  {{ (row as any)[col.key] }}
                </slot>
              </span>
            </template>
          </div>
          <div v-if="opsCol" class="s-table-card-ops">
            <slot :name="slotName(opsCol)" :row="row" :column="opsCol" />
          </div>
          <div v-if="expandable && isExpanded(getRowKey(row, idx))" class="s-table-card-expanded">
            <slot name="_expanded" :row="row" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.s-table-root { width: 100%; }

.s-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--sui-fs-md);
}
.s-table th,
.s-table td {
  padding: var(--sui-sp-4) var(--sui-sp-5);
  text-align: left;
  border-bottom: 1px solid var(--sui-border);
}
.s-table th {
  font-weight: 600;
  color: var(--sui-fg-muted);
  background: var(--sui-bg-subtle);
  font-size: var(--sui-fs-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.s-table tr:hover td { background: var(--sui-bg-subtle); }
.s-table-cell--ellipsis {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.s-table-cell--ops :deep(> *) { display: inline-flex; }
.s-table-cell--ops {
  white-space: nowrap;
}
.s-table td.s-table-status {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}

.s-table-expand-th { width: 32px; }
.s-table-expand-cell {
  width: 32px;
  text-align: center;
  padding: var(--sui-sp-2) var(--sui-sp-3);
}
.s-table-expand-icon {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}
.s-table-row--expandable { cursor: pointer; }
.s-table-row--expanded > td { background: var(--sui-bg-subtle); }
.s-table-expanded-row > td {
  background: var(--sui-bg-subtle);
  border-bottom: 1px solid var(--sui-border);
}
.s-table-expanded-cell {
  padding: var(--sui-sp-3) var(--sui-sp-5);
}

.s-table-cards {
  display: none;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.s-table-card {
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  padding: var(--sui-sp-5);
}
.s-table-card-header {
  font-weight: 600;
  font-size: var(--sui-fs-lg);
  margin-bottom: var(--sui-sp-3);
}
.s-table-card-header--expandable {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.s-table-card-fields {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sui-sp-1) var(--sui-sp-4);
  font-size: var(--sui-fs-md);
  margin-bottom: var(--sui-sp-4);
}
.s-table-card-label {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
.s-table-card-value {
  color: var(--sui-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
}
.s-table-card-ops {
  display: flex;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.s-table-card-expanded {
  margin-top: var(--sui-sp-4);
  padding-top: var(--sui-sp-4);
  border-top: 1px solid var(--sui-border);
}
.s-table-cards-status {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: var(--sui-sp-8);
}

@media (max-width: 768px) {
  .s-table { display: none; }
  .s-table-cards { display: flex; }
}
</style>
