<script lang="ts">
export type STableColumn = {
  key: string
  label?: string
  ellipsis?: boolean
  primary?: boolean
  ops?: boolean
  width?: string
  align?: 'left' | 'right' | 'center'
}
</script>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  columns: STableColumn[]
  rows: T[]
  rowKey?: keyof T | ((row: T) => string | number)
  emptyText?: string
}>(), {
  rowKey: 'id' as any,
  emptyText: '—',
})

defineSlots<{
  [key: `cell-${string}`]: (props: { row: T; column: STableColumn }) => any
}>()

const primaryCol = computed(() => props.columns.find(c => c.primary))
const opsCol     = computed(() => props.columns.find(c => c.ops))
const fieldCols  = computed(() => props.columns.filter(c => !c.primary && !c.ops))

function getRowKey(row: T, idx: number): string | number {
  const rk = props.rowKey
  if (typeof rk === 'function') return rk(row)
  const v = (row as any)[rk as any]
  return v ?? idx
}
</script>

<template>
  <div class="s-table-root">
    <table class="s-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :style="{ width: col.width, textAlign: col.align }"
          >{{ col.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length" class="s-table-empty">{{ emptyText }}</td>
        </tr>
        <tr v-for="(row, idx) in rows" :key="getRowKey(row, idx)">
          <td
            v-for="col in columns"
            :key="col.key"
            :class="{ 's-table-cell--ellipsis': col.ellipsis, 's-table-cell--ops': col.ops }"
            :style="{ textAlign: col.align }"
          >
            <slot :name="`cell-${col.key}`" :row="row" :column="col">
              {{ (row as any)[col.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="s-table-cards">
      <div v-if="rows.length === 0" class="s-table-cards-empty">{{ emptyText }}</div>
      <div
        v-for="(row, idx) in rows"
        :key="getRowKey(row, idx)"
        class="s-table-card"
      >
        <div v-if="primaryCol" class="s-table-card-header">
          <slot :name="`cell-${primaryCol.key}`" :row="row" :column="primaryCol">
            {{ (row as any)[primaryCol.key] }}
          </slot>
        </div>
        <div v-if="fieldCols.length" class="s-table-card-fields">
          <template v-for="col in fieldCols" :key="col.key">
            <span class="s-table-card-label">{{ col.label }}</span>
            <span class="s-table-card-value">
              <slot :name="`cell-${col.key}`" :row="row" :column="col">
                {{ (row as any)[col.key] }}
              </slot>
            </span>
          </template>
        </div>
        <div v-if="opsCol" class="s-table-card-ops">
          <slot :name="`cell-${opsCol.key}`" :row="row" :column="opsCol" />
        </div>
      </div>
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
.s-table-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
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
.s-table-cards-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: var(--sui-sp-8);
}

@media (max-width: 768px) {
  .s-table { display: none; }
  .s-table-cards { display: flex; }
}
</style>
