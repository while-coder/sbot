<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 已选中的标签 */
  modelValue: string[]
  /** 候选标签列表 */
  options: string[]
  /** 单选还是多选，默认多选 */
  multiple?: boolean
  size?: 'sm' | 'md'
  /** 选中态颜色，默认 primary（深色） */
  variant?: 'default' | 'primary'
}>(), {
  multiple: true,
  size: 'sm',
  variant: 'primary',
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const selected = computed(() => new Set(props.modelValue))

function toggle(tag: string) {
  if (props.multiple) {
    const next = selected.value.has(tag)
      ? props.modelValue.filter(t => t !== tag)
      : [...props.modelValue, tag]
    emit('update:modelValue', next)
  } else {
    emit('update:modelValue', selected.value.has(tag) ? [] : [tag])
  }
}

function clearAll() {
  emit('update:modelValue', [])
}

function chipClass(tag: string) {
  return [
    's-tag-filter__chip',
    `s-tag-filter__chip--${props.size}`,
    {
      's-tag-filter__chip--active':         selected.value.has(tag),
      [`s-tag-filter__chip--${props.variant}`]: selected.value.has(tag),
    },
  ]
}
</script>

<template>
  <div class="s-tag-filter" v-if="options.length > 0">
    <button
      v-for="tag in options"
      :key="tag"
      type="button"
      :class="chipClass(tag)"
      @click="toggle(tag)"
    >{{ tag }}</button>
    <button
      v-if="modelValue.length > 0"
      type="button"
      class="s-tag-filter__clear"
      @click="clearAll"
    >×</button>
  </div>
</template>

<style scoped>
.s-tag-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sui-sp-2);
}
.s-tag-filter__chip {
  border: 1px solid var(--sui-border);
  background: var(--sui-bg);
  color: var(--sui-fg-muted);
  border-radius: var(--sui-radius-pill);
  padding: 2px var(--sui-sp-3);
  font-size: var(--sui-fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--sui-transition-base), color var(--sui-transition-base), border-color var(--sui-transition-base);
}
.s-tag-filter__chip--sm {
  padding: 1px var(--sui-sp-3);
  font-size: var(--sui-fs-xs);
}
.s-tag-filter__chip:hover {
  background: var(--sui-bg-hover);
  border-color: var(--sui-border-strong);
  color: var(--sui-fg);
}
.s-tag-filter__chip--active {
  background: var(--sui-fg);
  border-color: var(--sui-fg);
  color: var(--sui-bg);
}
.s-tag-filter__chip--active:hover {
  background: var(--sui-fg);
  color: var(--sui-bg);
}
.s-tag-filter__chip--default.s-tag-filter__chip--active {
  background: var(--sui-bg-hover);
  border-color: var(--sui-border-strong);
  color: var(--sui-fg);
}

.s-tag-filter__clear {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--sui-fg-disabled);
  padding: 0 var(--sui-sp-2);
  font-family: inherit;
}
.s-tag-filter__clear:hover { color: var(--sui-danger-strong); }
</style>
