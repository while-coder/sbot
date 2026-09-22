<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "STreeRow", inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** 缩进层级，每级 12px；category 头不缩进 */
  level?: number
  /** category 分组头 / dir 目录 / file 文件 */
  type?: "category" | "dir" | "file"
  selected?: boolean
  expanded?: boolean
  expandable?: boolean
}>(), {
  level: 0,
  type: "file",
  selected: false,
  expanded: false,
  expandable: false,
})
const emit = defineEmits<{
  click: [event: MouseEvent]
  toggle: [event: MouseEvent]
}>()
const attrs = useAttrs()

const indent = computed(() => ({
  paddingLeft: props.type === "category" ? "12px" : `calc(12px + ${props.level} * 12px)`,
}))
const onClick = (event: MouseEvent) => {
  emit("click", event)
  if (props.expandable) emit("toggle", event)
}
</script>

<template>
  <div v-bind="attrs" class="s-tree-row" :class="[`type-${props.type}`, { selected: props.selected, expanded: props.expanded }]" :style="indent" role="treeitem" :aria-selected="props.selected" :aria-expanded="props.expandable ? props.expanded : undefined" @click="onClick">
    <span v-if="props.expandable" class="s-tree-row-chevron" :class="{ open: props.expanded }" aria-hidden="true">▶</span>
    <span v-else-if="props.type !== 'category'" class="s-tree-row-icon"><slot name="icon" /></span>
    <span class="s-tree-row-label"><slot /></span>
    <span v-if="$slots.suffix" class="s-tree-row-suffix"><slot name="suffix" /></span>
    <span v-if="$slots.actions" class="s-tree-row-actions" @click.stop><slot name="actions" /></span>
  </div>
</template>

<style scoped>
.s-tree-row { display: flex; min-height: 26px; align-items: center; gap: 5px; margin: 1px 4px; padding: 5px 8px 5px 12px; border-radius: var(--sui-radius-sm); color: var(--sui-fg-secondary); font-size: 13px; cursor: pointer; user-select: none; transition: background var(--sui-transition), color var(--sui-transition); }
.s-tree-row:hover { background: var(--sui-bg-hover); }
.s-tree-row.selected { background: var(--sui-bg-active); color: var(--sui-fg); font-weight: 600; }
.s-tree-row.type-category { margin: 2px 0 0; padding: 7px 10px 5px; border-bottom: 1px solid var(--sui-border-subtle); border-radius: 0; color: var(--sui-fg-muted); font-size: 12px; font-weight: 700; }
.s-tree-row.type-category:first-child { margin-top: 0; }
.s-tree-row.type-dir { font-weight: 500; }
.s-tree-row-chevron, .s-tree-row-icon { flex: 0 0 auto; width: 12px; color: var(--sui-fg-disabled); font-size: 9px; line-height: 1; }
.s-tree-row-chevron { transition: transform var(--sui-transition); }
.s-tree-row-chevron.open { transform: rotate(90deg); }
.s-tree-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-tree-row-suffix { flex: 0 0 auto; margin-left: auto; }
.s-tree-row-actions { display: none; flex: 0 0 auto; align-items: center; gap: 2px; }
.s-tree-row:hover .s-tree-row-actions { display: flex; }
</style>
