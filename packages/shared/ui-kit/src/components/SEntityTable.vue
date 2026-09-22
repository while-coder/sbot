<script lang="ts">
import type { EntityTableColumn } from "./SEntityTable.types"
export type { EntityTableColumn }
</script>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, ref, useAttrs, watch } from "vue"

defineOptions({ name: "SEntityTable", inheritAttrs: false })
const props = withDefaults(defineProps<{
  columns: EntityTableColumn[]
  rows?: T[]
  rowKey?: keyof T | ((row: T) => string | number)
  rowClassName?: string | ((row: T, index: number) => string)
  emptyText?: string
  loading?: boolean
  loadingText?: string
  expandable?: boolean
  expandedKeys?: Array<string | number>
  defaultExpandedKeys?: Array<string | number>
}>(), {
  rows: () => [],
  rowKey: "id" as any,
  expandable: false,
  defaultExpandedKeys: () => [],
  emptyText: "—",
  loading: false,
  loadingText: "加载中…",
})
const emit = defineEmits<{
  "update:expandedKeys": [keys: Array<string | number>]
  expand: [row: T, expanded: boolean]
}>()
const attrs = useAttrs()

const primaryCol = computed(() => props.columns.find(col => col.primary))
const opsCol = computed(() => props.columns.find(col => col.ops))
const fieldCols = computed(() => props.columns.filter(col => !col.primary && !col.ops))
const totalCols = computed(() => props.columns.length + (props.expandable ? 1 : 0))

//受控/非受控展开：传 expandedKeys 即受控，展开状态由外部维护（与 SEntityList 同一惯例）
const isControlled = computed(() => props.expandedKeys !== undefined)
const internalExpanded = ref<Set<string | number>>(new Set(props.defaultExpandedKeys ?? []))
const expandedSet = computed<Set<string | number>>(() =>
  isControlled.value ? new Set(props.expandedKeys) : internalExpanded.value,
)
watch(() => props.expandedKeys, value => {
  if (value !== undefined) internalExpanded.value = new Set(value)
})

const getRowKey = (row: T, index: number): string | number => {
  const key = props.rowKey
  if (typeof key === "function") return key(row)
  return (row as any)[key as any] ?? index
}
const isExpanded = (key: string | number) => expandedSet.value.has(key)
const toggleExpand = (row: T, key: string | number) => {
  if (!props.expandable) return
  const next = new Set(expandedSet.value)
  const willExpand = !next.has(key)
  if (willExpand) next.add(key)
  else next.delete(key)
  if (!isControlled.value) internalExpanded.value = next
  emit("update:expandedKeys", Array.from(next))
  emit("expand", row, willExpand)
}
const slotName = (col: EntityTableColumn) => col.slot ?? col.key
const rowCls = (row: T, index: number) => {
  const rcn = props.rowClassName
  if (!rcn) return undefined
  return typeof rcn === "function" ? rcn(row, index) : rcn
}
//行点击展开时跳过按钮/输入等交互元素（与 SDataTable 惯例一致）
const onRowClick = (event: MouseEvent, row: T, key: string | number) => {
  if ((event.target as HTMLElement).closest("button, input, select, textarea, a")) return
  toggleExpand(row, key)
}
</script>

<template>
  <div v-bind="attrs" class="s-entity-table">
    <table class="s-entity-table-table">
      <thead>
        <tr>
          <th v-if="props.expandable" class="s-entity-table-expand-th" aria-hidden="true"></th>
          <th v-for="col in props.columns" :key="col.key" :class="{ ops: col.ops }" :style="{ width: col.width, textAlign: col.align }">{{ col.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="props.loading">
          <td :colspan="totalCols" class="s-entity-table-status"><slot name="_loading">{{ props.loadingText }}</slot></td>
        </tr>
        <tr v-else-if="props.rows.length === 0">
          <td :colspan="totalCols" class="s-entity-table-status"><slot name="_empty">{{ props.emptyText }}</slot></td>
        </tr>
        <template v-else v-for="(row, index) in props.rows" :key="getRowKey(row, index)">
          <tr :class="[rowCls(row, index), { expandable: props.expandable, expanded: props.expandable && isExpanded(getRowKey(row, index)) }]" @click="onRowClick($event, row, getRowKey(row, index))">
            <td v-if="props.expandable" class="s-entity-table-expand-cell">
              <button type="button" class="s-entity-table-expand-button" :aria-label="isExpanded(getRowKey(row, index)) ? '收起详情' : '展开详情'" :aria-expanded="isExpanded(getRowKey(row, index))" @click.stop="toggleExpand(row, getRowKey(row, index))">
                <span class="s-entity-table-expand-icon" aria-hidden="true">{{ isExpanded(getRowKey(row, index)) ? "▼" : "▶" }}</span>
              </button>
            </td>
            <td v-for="col in props.columns" :key="col.key" :class="{ ellipsis: col.ellipsis, ops: col.ops }" :style="{ textAlign: col.align }" @click="col.ops && $event.stopPropagation()">
              <slot :name="slotName(col)" :row="row" :column="col">{{ (row as any)[col.key] }}</slot>
            </td>
          </tr>
          <tr v-if="props.expandable && isExpanded(getRowKey(row, index))" class="s-entity-table-expanded-row">
            <td class="s-entity-table-expanded-spacer" aria-hidden="true"></td>
            <td :colspan="props.columns.length" class="s-entity-table-expanded-cell"><slot name="expanded" :row="row" :index="index" /></td>
          </tr>
        </template>
      </tbody>
    </table>

    <div class="s-entity-table-cards">
      <div v-if="props.loading" class="s-entity-table-status"><slot name="_loading">{{ props.loadingText }}</slot></div>
      <div v-else-if="props.rows.length === 0" class="s-entity-table-status"><slot name="_empty">{{ props.emptyText }}</slot></div>
      <template v-else>
        <div v-for="(row, index) in props.rows" :key="getRowKey(row, index)" class="s-entity-table-card" :class="{ expanded: props.expandable && isExpanded(getRowKey(row, index)) }">
          <div v-if="primaryCol || props.expandable" class="s-entity-table-card-header" :class="{ clickable: props.expandable }" @click="toggleExpand(row, getRowKey(row, index))">
            <span v-if="props.expandable" class="s-entity-table-expand-icon" aria-hidden="true">{{ isExpanded(getRowKey(row, index)) ? "▼" : "▶" }}</span>
            <slot v-if="primaryCol" :name="slotName(primaryCol)" :row="row" :column="primaryCol">{{ (row as any)[primaryCol.key] }}</slot>
          </div>
          <div v-if="fieldCols.length" class="s-entity-table-card-fields">
            <template v-for="col in fieldCols" :key="col.key">
              <span class="s-entity-table-card-label">{{ col.label }}</span>
              <span class="s-entity-table-card-value"><slot :name="slotName(col)" :row="row" :column="col">{{ (row as any)[col.key] }}</slot></span>
            </template>
          </div>
          <div v-if="opsCol" class="s-entity-table-card-ops"><slot :name="slotName(opsCol)" :row="row" :column="opsCol" /></div>
          <div v-if="props.expandable && isExpanded(getRowKey(row, index))" class="s-entity-table-card-expanded"><slot name="expanded" :row="row" :index="index" /></div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.s-entity-table { width: 100%; }
.s-entity-table-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.s-entity-table-table th, .s-entity-table-table td { padding: 10px 12px; border-bottom: 1px solid var(--sui-border); text-align: left; }
.s-entity-table-table th { background: var(--sui-bg-subtle); color: var(--sui-fg-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
.s-entity-table-table tbody tr:hover td { background: var(--sui-bg-subtle); }
.s-entity-table-table tbody tr.expanded > td { background: var(--sui-bg-soft); }
.s-entity-table-table td.ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-entity-table-table td.ops, .s-entity-table-table th.ops { width: 1%; white-space: nowrap; }
.s-entity-table-table td.ops :deep(> *) { display: inline-flex; }
.s-entity-table-expand-th { width: 32px; }
.s-entity-table-expand-cell { width: 32px; padding: 6px 4px; text-align: center; user-select: none; }
.s-entity-table-expand-button { display: inline-grid; width: 24px; height: 24px; padding: 0; place-items: center; border: 0; border-radius: var(--sui-radius-sm); background: transparent; color: var(--sui-fg-muted); cursor: pointer; }
.s-entity-table-expand-button:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.s-entity-table-expand-button:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 1px; }
.s-entity-table-expand-icon { display: inline-block; font-size: 10px; line-height: 1; }
.s-entity-table tr.expandable { cursor: pointer; }
.s-entity-table-expanded-row > td { background: var(--sui-bg-soft); border-bottom: 1px solid var(--sui-border); }
.s-entity-table-expanded-spacer { width: 32px; padding: 0; }
.s-entity-table-expanded-cell { padding: 8px 12px; }
.s-entity-table-status { padding: 20px; color: var(--sui-fg-disabled); font-size: 13px; text-align: center; }
.s-entity-table-cards { display: none; flex-direction: column; gap: 8px; }
.s-entity-table-card { overflow: hidden; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-lg); background: var(--sui-bg); padding: 12px; transition: box-shadow var(--sui-transition), border-color var(--sui-transition); }
.s-entity-table-card:hover { box-shadow: var(--sui-shadow-sm); }
.s-entity-table-card.expanded { border-color: var(--sui-border-strong); }
.s-entity-table-card-header { margin-bottom: 8px; font-size: 14px; font-weight: 600; }
.s-entity-table-card-header.clickable { cursor: pointer; }
.s-entity-table-card-fields { display: grid; grid-template-columns: auto 1fr; margin-bottom: 10px; font-size: 13px; gap: 4px 10px; }
.s-entity-table-card-label { color: var(--sui-fg-disabled); font-size: 12px; }
.s-entity-table-card-value { overflow: hidden; text-overflow: ellipsis; word-break: break-all; }
.s-entity-table-card-ops { display: flex; flex-wrap: wrap; gap: 6px; }
.s-entity-table-card-expanded { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--sui-border); }
@media (max-width: 768px) {
  .s-entity-table-table { display: none; }
  .s-entity-table-cards { display: flex; }
}
</style>
