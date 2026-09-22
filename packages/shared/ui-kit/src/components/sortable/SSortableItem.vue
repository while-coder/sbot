<template>
  <div
    class="s-sortable-item"
    :class="{
      's-sortable-item--dragging': sort.isDragging(index),
      's-sortable-item--before': sort.dropEdge(index) === 'before',
      's-sortable-item--after': sort.dropEdge(index) === 'after'
    }"
    :data-sortable-scope="sort.scopeId"
    :data-sortable-index="index"
  >
    <button
      class="sort-handle"
      type="button"
      :aria-label="`${rowLabel}，拖动调整顺序；也可用上下方向键移动`"
      :title="`${rowLabel}：拖动或按上下方向键调整顺序`"
      @pointerdown="sort.pointerDown(index, $event)"
      @keydown.up.prevent="sort.move(index, -1)"
      @keydown.down.prevent="sort.move(index, 1)"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="5.5" cy="4" r="1.2" fill="currentColor" />
        <circle cx="10.5" cy="4" r="1.2" fill="currentColor" />
        <circle cx="5.5" cy="8" r="1.2" fill="currentColor" />
        <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
        <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="10.5" cy="12" r="1.2" fill="currentColor" />
      </svg>
    </button>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { injectSortableListContext, type SortableItemController } from "./SSortableList.vue"

//排序规则来源二选一：外层有 SSortableList 时自动注入；也可显式传 sort prop 脱离列表单独使用。
const props = withDefaults(defineProps<{
  sort?: SortableItemController
  index: number
  //行把手的描述文案；外层是 SSortableList 时缺省用列表的 label
  label?: string
}>(), {
  label: undefined
})

const context = injectSortableListContext()
if (!props.sort && !context) {
  console.warn("[SSortableItem] 缺少 sort prop，且外层没有 SSortableList，行将无法拖拽排序")
}

const sort = computed<SortableItemController>(() => {
  if (props.sort) return props.sort
  if (context) return context.controller
  throw new Error("[SSortableItem] 缺少 sort prop，且外层没有 SSortableList")
})

const rowLabel = computed(() => props.label ?? context?.label.value ?? "项目")
</script>

<style scoped>
.s-sortable-item {
  position: relative;
}
/* 原行在拖动时退成落点占位槽：淡出加虚线框，和跟随光标的影分身区分开 */
.s-sortable-item--dragging {
  opacity: 0.35;
  outline: 1px dashed var(--sui-fg-muted);
  outline-offset: 3px;
  border-radius: var(--sui-radius-sm);
}
.s-sortable-item--before::before,
.s-sortable-item--after::after {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 2px;
  border-radius: 1px;
  background: var(--sui-primary);
  content: "";
  pointer-events: none;
}
.s-sortable-item--before::before { top: -5px; }
.s-sortable-item--after::after { bottom: -5px; }
.sort-handle {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--sui-radius-sm);
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: grab;
  opacity: 0.65;
  touch-action: none;
  user-select: none;
  transition: background var(--sui-transition), color var(--sui-transition), opacity var(--sui-transition);
}
.sort-handle:hover {
  background: color-mix(in srgb, var(--sui-primary) 8%, transparent);
  color: var(--sui-fg-secondary);
  opacity: 1;
}
.sort-handle:focus-visible {
  outline: 2px solid var(--sui-primary);
  outline-offset: -2px;
  opacity: 1;
}
.sort-handle:active { cursor: grabbing; }
.sort-handle svg { pointer-events: none; }
</style>
