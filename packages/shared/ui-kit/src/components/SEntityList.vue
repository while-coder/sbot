<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, ref, watch, useSlots } from 'vue'

type RowKey = string | number

const props = withDefaults(defineProps<{
  items: T[]
  rowKey?: keyof T | ((item: T) => RowKey)
  expandable?: boolean
  expandedKeys?: RowKey[]
  defaultExpandedKeys?: RowKey[]
  emptyText?: string
  loading?: boolean
  loadingText?: string
  /** Outer variant — sub variant tightens spacing for nested lists */
  variant?: 'default' | 'sub'
}>(), {
  rowKey: 'id' as any,
  expandable: false,
  emptyText: '—',
  loading: false,
  loadingText: 'Loading…',
  variant: 'default',
})

const emit = defineEmits<{
  'update:expandedKeys': [keys: RowKey[]]
  'expand': [item: T, expanded: boolean]
}>()

const slots = useSlots()

const internalExpanded = ref<Set<RowKey>>(new Set(props.defaultExpandedKeys ?? []))
const isControlled = computed(() => props.expandedKeys !== undefined)
const expandedSet = computed<Set<RowKey>>(() =>
  isControlled.value ? new Set(props.expandedKeys) : internalExpanded.value,
)

watch(() => props.expandedKeys, v => {
  if (v !== undefined) internalExpanded.value = new Set(v)
})

function getRowKey(item: T, idx: number): RowKey {
  const rk = props.rowKey
  if (typeof rk === 'function') return rk(item)
  const v = (item as any)[rk as any]
  return v ?? idx
}

function isExpanded(key: RowKey): boolean {
  return expandedSet.value.has(key)
}

function toggleExpand(item: T, key: RowKey) {
  if (!props.expandable) return
  const next = new Set(expandedSet.value)
  const willExpand = !next.has(key)
  if (willExpand) next.add(key)
  else next.delete(key)
  if (!isControlled.value) internalExpanded.value = next
  emit('update:expandedKeys', Array.from(next))
  emit('expand', item, willExpand)
}
</script>

<template>
  <div :class="['s-entity-list', `s-entity-list--${variant}`]">
    <div v-if="loading" class="s-entity-list-status">
      <slot name="_loading">{{ loadingText }}</slot>
    </div>
    <div v-else-if="items.length === 0" class="s-entity-list-status s-entity-list-empty">
      <slot name="_empty">{{ emptyText }}</slot>
    </div>
    <template v-else>
      <div
        v-for="(item, idx) in items"
        :key="getRowKey(item, idx)"
        :class="[
          's-entity-list-card',
          { 's-entity-list-card--expanded': expandable && isExpanded(getRowKey(item, idx)) },
        ]"
      >
        <div
          :class="[
            's-entity-list-header',
            { 's-entity-list-header--clickable': expandable },
          ]"
          @click="toggleExpand(item, getRowKey(item, idx))"
        >
          <div class="s-entity-list-header-left">
            <span v-if="expandable" class="s-entity-list-expand-icon">{{ isExpanded(getRowKey(item, idx)) ? '▼' : '▶' }}</span>
            <slot name="title" :item="item" :index="idx" :expanded="isExpanded(getRowKey(item, idx))" />
          </div>
          <div v-if="slots.aside || slots.ops" class="s-entity-list-header-right" @click.stop>
            <slot v-if="slots.aside" name="aside" :item="item" :index="idx" />
            <slot v-if="slots.ops" name="ops" :item="item" :index="idx" />
          </div>
        </div>
        <div v-if="slots.meta" class="s-entity-list-meta">
          <slot name="meta" :item="item" :index="idx" />
        </div>
        <div
          v-if="expandable && isExpanded(getRowKey(item, idx)) && slots.expanded"
          class="s-entity-list-expanded"
        >
          <slot name="expanded" :item="item" :index="idx" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.s-entity-list {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-4);
  width: 100%;
}
.s-entity-list--sub {
  gap: var(--sui-sp-2);
}

.s-entity-list-card {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  background: var(--sui-bg);
  overflow: hidden;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.s-entity-list-card:hover { box-shadow: var(--sui-shadow-sm); }
.s-entity-list-card--expanded { border-color: var(--sui-border-strong); }
.s-entity-list--sub .s-entity-list-card { border-radius: var(--sui-radius-md); }

.s-entity-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sui-sp-4) var(--sui-sp-5);
  gap: var(--sui-sp-3);
}
.s-entity-list--sub .s-entity-list-header {
  padding: var(--sui-sp-3) var(--sui-sp-4);
}
.s-entity-list-header--clickable { cursor: pointer; }
.s-entity-list-header--clickable:hover { background: var(--sui-bg-subtle); }

.s-entity-list-header-left {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}
.s-entity-list-header-right {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.s-entity-list-expand-icon {
  color: var(--sui-fg-muted);
  font-size: 10px;
  flex-shrink: 0;
}

.s-entity-list-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--sui-sp-3);
  padding: 0 var(--sui-sp-5) var(--sui-sp-4) var(--sui-sp-5);
  font-size: var(--sui-fs-xs);
}
.s-entity-list--sub .s-entity-list-meta {
  padding: 0 var(--sui-sp-4) var(--sui-sp-3) var(--sui-sp-4);
}

.s-entity-list-expanded {
  border-top: 1px solid var(--sui-border);
}

.s-entity-list-status {
  text-align: center;
  padding: var(--sui-sp-8);
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}

@media (max-width: 768px) {
  .s-entity-list { gap: var(--sui-sp-3); }
  .s-entity-list-header { padding: var(--sui-sp-3) var(--sui-sp-4); }
  .s-entity-list-meta { padding: 0 var(--sui-sp-4) var(--sui-sp-3) var(--sui-sp-4); }
}
</style>
