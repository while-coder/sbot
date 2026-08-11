<script setup lang="ts">
import { computed } from 'vue'

type Option = { label: string; value: string | number; disabled?: boolean }

const props = withDefaults(defineProps<{
  modelValue?: string | number
  options?: Option[]
  size?: 'sm' | 'md'
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
}>(), {
  size: 'md',
  options: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const cls = computed(() => [
  's-select',
  `s-select--${props.size}`,
  { 's-select--invalid': props.invalid },
])

function onChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <select :class="cls" :value="modelValue" :disabled="disabled" @change="onChange">
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <slot>
      <option
        v-for="opt in options"
        :key="opt.value"
        :value="opt.value"
        :disabled="opt.disabled"
      >{{ opt.label }}</option>
    </slot>
  </select>
</template>

<style scoped>
.s-select {
  width: 100%;
  padding: var(--sui-sp-2) var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  font-size: var(--sui-fs-md);
  font-family: inherit;
  color: var(--sui-fg);
  background: var(--sui-bg);
  outline: none;
  transition: border-color var(--sui-transition-base);
  box-sizing: border-box;
  cursor: pointer;
}
.s-select:focus { border-color: var(--sui-fg); }
.s-select:disabled {
  background: var(--sui-bg-soft);
  color: var(--sui-fg-disabled);
  cursor: not-allowed;
}
.s-select--sm { padding: var(--sui-sp-1) var(--sui-sp-3); font-size: var(--sui-fs-sm); }
.s-select--invalid { border-color: var(--sui-danger); }
.s-select--invalid:focus { border-color: var(--sui-danger); }
</style>
