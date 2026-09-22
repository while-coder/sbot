<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  level?: number
  type?: 'category' | 'dir' | 'file'
  selected?: boolean
  expanded?: boolean
  expandable?: boolean
}>(), {
  level: 0,
  type: 'file',
})

const emit = defineEmits<{
  click: [e: MouseEvent]
  toggle: [e: MouseEvent]
}>()

const cls = computed(() => [
  's-tree-node',
  `s-tree-node--${props.type}`,
  {
    's-tree-node--selected': props.selected,
    's-tree-node--expanded': props.expanded,
  },
])

const indentStyle = computed(() => ({
  paddingLeft: props.type === 'category'
    ? 'var(--sui-sp-5)'
    : `calc(var(--sui-sp-5) + ${props.level} * 12px)`,
}))

function onClick(e: MouseEvent) {
  emit('click', e)
  if (props.expandable) emit('toggle', e)
}
</script>

<template>
  <div :class="cls" :style="indentStyle" @click="onClick">
    <span v-if="expandable" class="s-tree-node__chevron" :class="{ 's-tree-node__chevron--open': expanded }">▶</span>
    <span v-else-if="type !== 'category'" class="s-tree-node__icon">
      <slot name="icon" />
    </span>
    <span class="s-tree-node__label">
      <slot />
    </span>
    <span v-if="$slots.suffix" class="s-tree-node__suffix">
      <slot name="suffix" />
    </span>
    <span v-if="$slots.actions" class="s-tree-node__actions" @click.stop>
      <slot name="actions" />
    </span>
  </div>
</template>

<style scoped>
.s-tree-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px var(--sui-sp-3) 5px var(--sui-sp-5);
  font-size: var(--sui-fs-md);
  cursor: pointer;
  user-select: none;
  border-radius: var(--sui-radius-sm);
  margin: 1px var(--sui-sp-1);
  color: var(--sui-fg-secondary);
  transition: background var(--sui-transition-base);
}
.s-tree-node:hover { background: var(--sui-bg-hover); }
.s-tree-node--selected {
  background: var(--sui-bg-active) !important;
  font-weight: 600;
  color: var(--sui-fg);
}
.s-tree-node--category {
  font-size: var(--sui-fs-sm);
  font-weight: 700;
  color: var(--sui-fg-secondary);
  border-bottom: 1px solid var(--sui-border-subtle);
  border-radius: 0;
  margin: 2px 0 0 0;
  padding: 7px var(--sui-sp-4) 5px var(--sui-sp-4);
}
.s-tree-node--category:first-child { margin-top: 0; }
.s-tree-node--category:hover { background: var(--sui-bg-hover); }
.s-tree-node--dir { color: var(--sui-fg-secondary); font-weight: 500; }

.s-tree-node__chevron {
  font-size: 9px;
  color: var(--sui-fg-disabled);
  width: 12px;
  flex-shrink: 0;
  transition: transform var(--sui-transition-base);
}
.s-tree-node__chevron--open { transform: rotate(90deg); }
.s-tree-node__icon { font-size: 9px; color: var(--sui-fg-disabled); width: 12px; flex-shrink: 0; }
.s-tree-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.s-tree-node__suffix { flex-shrink: 0; margin-left: auto; }
.s-tree-node__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.s-tree-node__actions :deep(.s-tree-node__hover-only) { display: none; }
.s-tree-node:hover :deep(.s-tree-node__hover-only) { display: inline-flex; }
</style>
