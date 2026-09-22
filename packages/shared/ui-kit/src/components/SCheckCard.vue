<script setup lang="ts">
defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="s-check-card" :class="{ 's-check-card--disabled': disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <slot>{{ label }}</slot>
  </label>
</template>

<style scoped>
.s-check-card {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: var(--sui-sp-1) var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  cursor: pointer;
  font-size: var(--sui-fs-md);
  background: var(--sui-bg-subtle);
  user-select: none;
  color: var(--sui-fg-secondary);
  transition: background var(--sui-transition-base);
}
.s-check-card:hover { background: var(--sui-bg-hover); }
.s-check-card input[type=checkbox] { cursor: pointer; }
.s-check-card--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.s-check-card--disabled:hover { background: var(--sui-bg-subtle); }
</style>
