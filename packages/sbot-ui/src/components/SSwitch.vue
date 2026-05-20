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
  <label class="s-switch" :class="{ 's-switch--disabled': disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="s-switch__track" />
    <span v-if="label || $slots.default" class="s-switch__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.s-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}
.s-switch input[type=checkbox] { display: none; }
.s-switch__track {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--sui-neutral-mid);
  transition: background var(--sui-transition-slow);
  flex-shrink: 0;
}
.s-switch__track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--sui-transition-slow);
}
.s-switch input:checked + .s-switch__track { background: var(--sui-primary); }
.s-switch input:checked + .s-switch__track::after { transform: translateX(12px); }
.s-switch__label {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  white-space: nowrap;
}
.s-switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
