<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "STagFilter", inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** 已选中的标签 */
  value: string[]
  /** 候选标签列表 */
  options: string[]
  /** 单选还是多选，默认多选 */
  multiple?: boolean
  size?: "sm" | "md"
  /** 选中态配色：primary 反色 / default 灰底 */
  variant?: "default" | "primary"
}>(), { multiple: true, size: "sm", variant: "primary" })
const emit = defineEmits<{
  "update:value": [value: string[]]
  change: [value: string[]]
}>()
const attrs = useAttrs()

const selected = computed(() => new Set(props.value))

const commit = (next: string[]) => { emit("update:value", next); emit("change", next) }

function toggle(tag: string) {
  if (props.multiple) {
    commit(selected.value.has(tag) ? props.value.filter(item => item !== tag) : [...props.value, tag])
  } else {
    commit(selected.value.has(tag) ? [] : [tag])
  }
}
const clearAll = () => commit([])

const chipClass = (tag: string) => [
  "s-tag-filter-chip",
  `size-${props.size}`,
  `variant-${props.variant}`,
  { selected: selected.value.has(tag) },
]
</script>

<template>
  <div v-if="props.options.length > 0" v-bind="attrs" class="s-tag-filter" role="group" aria-label="标签筛选">
    <button v-for="tag in props.options" :key="tag" type="button" :class="chipClass(tag)"
      :aria-pressed="selected.has(tag)" @click="toggle(tag)">{{ tag }}</button>
    <button v-if="props.value.length > 0" type="button" class="s-tag-filter-clear" aria-label="清空筛选"
      @click="clearAll">×</button>
  </div>
</template>

<style scoped>
.s-tag-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.s-tag-filter-chip { padding: 2px 8px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-pill); background: var(--sui-bg); color: var(--sui-fg-muted); font: inherit; font-size: 13px; cursor: pointer; transition: background var(--sui-transition), color var(--sui-transition), border-color var(--sui-transition); }
.s-tag-filter-chip.size-sm { padding: 1px 8px; font-size: 12px; }
.s-tag-filter-chip:hover { background: var(--sui-bg-hover); border-color: var(--sui-border-strong); color: var(--sui-fg); }
.s-tag-filter-chip:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 2px; }
.s-tag-filter-chip.selected.variant-primary, .s-tag-filter-chip.selected.variant-primary:hover { background: var(--sui-primary); border-color: var(--sui-primary); color: var(--sui-on-primary); }
.s-tag-filter-chip.selected.variant-default, .s-tag-filter-chip.selected.variant-default:hover { background: var(--sui-bg-active); border-color: var(--sui-border-strong); color: var(--sui-fg); }
.s-tag-filter-clear { padding: 0 6px; border: 0; background: none; color: var(--sui-fg-disabled); font: inherit; font-size: 16px; line-height: 1; cursor: pointer; }
.s-tag-filter-clear:hover { color: var(--sui-danger); }
.s-tag-filter-clear:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 2px; }
</style>
