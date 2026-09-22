<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, ref, useAttrs, useSlots, watch } from "vue"

defineOptions({ name: "SEntityList", inheritAttrs: false })
const props = withDefaults(defineProps<{
  items?: T[]
  rowKey?: keyof T | ((item: T) => string | number)
  expandable?: boolean
  expandedKeys?: Array<string | number>
  defaultExpandedKeys?: Array<string | number>
  emptyText?: string
  loading?: boolean
  loadingText?: string
  /** default 常规；sub 收紧间距，用于嵌套子列表 */
  variant?: "default" | "sub"
}>(), {
  items: () => [],
  rowKey: "id" as any,
  expandable: false,
  defaultExpandedKeys: () => [],
  emptyText: "—",
  loading: false,
  loadingText: "加载中…",
  variant: "default",
})
const emit = defineEmits<{
  "update:expandedKeys": [keys: Array<string | number>]
  expand: [item: T, expanded: boolean]
}>()
const attrs = useAttrs()
const slots = useSlots()

//受控/非受控展开：传 expandedKeys 即受控，展开状态由外部维护
const isControlled = computed(() => props.expandedKeys !== undefined)
const internalExpanded = ref<Set<string | number>>(new Set(props.defaultExpandedKeys ?? []))
const expandedSet = computed<Set<string | number>>(() =>
  isControlled.value ? new Set(props.expandedKeys) : internalExpanded.value,
)
watch(() => props.expandedKeys, value => {
  if (value !== undefined) internalExpanded.value = new Set(value)
})

const getRowKey = (item: T, index: number): string | number => {
  const key = props.rowKey
  if (typeof key === "function") return key(item)
  return (item as any)[key as any] ?? index
}
const isExpanded = (key: string | number) => expandedSet.value.has(key)
const toggleExpand = (item: T, key: string | number) => {
  if (!props.expandable) return
  const next = new Set(expandedSet.value)
  const willExpand = !next.has(key)
  if (willExpand) next.add(key)
  else next.delete(key)
  if (!isControlled.value) internalExpanded.value = next
  emit("update:expandedKeys", Array.from(next))
  emit("expand", item, willExpand)
}
</script>

<template>
  <div v-bind="attrs" class="s-entity-list" :class="{ sub: props.variant === 'sub' }">
    <div v-if="props.loading" class="s-entity-list-status">
      <slot name="_loading">{{ props.loadingText }}</slot>
    </div>
    <div v-else-if="props.items.length === 0" class="s-entity-list-status empty">
      <slot name="_empty">{{ props.emptyText }}</slot>
    </div>
    <template v-else>
      <div v-for="(item, index) in props.items" :key="getRowKey(item, index)" class="s-entity-list-card"
        :class="{ expanded: props.expandable && isExpanded(getRowKey(item, index)) }">
        <div class="s-entity-list-header" :class="{ clickable: props.expandable }"
          @click="toggleExpand(item, getRowKey(item, index))">
          <div class="s-entity-list-header-left">
            <span v-if="props.expandable" class="s-entity-list-expand-icon" aria-hidden="true">{{ isExpanded(getRowKey(item, index)) ? "▼" : "▶" }}</span>
            <slot name="title" :item="item" :index="index" :expanded="isExpanded(getRowKey(item, index))" />
          </div>
          <div v-if="slots.aside || slots.ops" class="s-entity-list-header-right" @click.stop>
            <slot v-if="slots.aside" name="aside" :item="item" :index="index" />
            <slot v-if="slots.ops" name="ops" :item="item" :index="index" />
          </div>
        </div>
        <div v-if="slots.meta" class="s-entity-list-meta">
          <slot name="meta" :item="item" :index="index" />
        </div>
        <div v-if="props.expandable && isExpanded(getRowKey(item, index)) && slots.expanded" class="s-entity-list-expanded">
          <slot name="expanded" :item="item" :index="index" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.s-entity-list { display: flex; flex-direction: column; width: 100%; gap: 16px; }
.s-entity-list.sub { gap: 6px; }
.s-entity-list-card { overflow: hidden; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-lg); background: var(--sui-bg); transition: box-shadow var(--sui-transition), border-color var(--sui-transition); }
.s-entity-list-card:hover { box-shadow: var(--sui-shadow-sm); }
.s-entity-list-card.expanded { border-color: var(--sui-border-strong); }
.s-entity-list.sub .s-entity-list-card { border-radius: var(--sui-radius-md); }
.s-entity-list-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; gap: 8px; }
.s-entity-list.sub .s-entity-list-header { padding: 8px 12px; }
.s-entity-list-header.clickable { cursor: pointer; }
.s-entity-list-header.clickable:hover { background: var(--sui-bg-subtle); }
.s-entity-list-header-left { display: flex; flex: 1; min-width: 0; align-items: center; flex-wrap: wrap; gap: 8px; }
.s-entity-list-header-right { display: flex; flex: 0 0 auto; align-items: center; flex-wrap: wrap; gap: 8px; }
.s-entity-list-expand-icon { flex: 0 0 auto; color: var(--sui-fg-muted); font-size: 10px; }
.s-entity-list-meta { display: flex; align-items: center; flex-wrap: wrap; padding: 0 14px 12px 14px; gap: 4px 8px; font-size: 11px; }
.s-entity-list.sub .s-entity-list-meta { padding: 0 12px 8px 12px; }
.s-entity-list-expanded { border-top: 1px solid var(--sui-border); }
.s-entity-list-status { padding: 20px; color: var(--sui-fg-disabled); font-size: 13px; text-align: center; }
@media (max-width: 768px) {
  .s-entity-list { gap: 8px; }
  .s-entity-list-header { padding: 8px 12px; }
  .s-entity-list-meta { padding: 0 12px 8px 12px; }
}
</style>
