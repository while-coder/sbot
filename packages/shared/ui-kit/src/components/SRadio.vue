<script setup lang="ts">
const props = defineProps<{
  modelValue?: string | number | boolean
  value: string | number | boolean
  label?: string
  name?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

function onChange() {
  emit('update:modelValue', props.value)
}
</script>

<template>
  <label class="s-radio" :class="{ 's-radio--disabled': disabled }">
    <input
      type="radio"
      :name="name"
      :value="value"
      :checked="modelValue === value"
      :disabled="disabled"
      @change="onChange"
    />
    <span v-if="label || $slots.default" class="s-radio__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.s-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
  user-select: none;
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
}
.s-radio input[type="radio"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--sui-fg);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.s-radio--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.s-radio--disabled input { cursor: not-allowed; }
</style>
