<script setup lang="ts">
import { computed } from 'vue'

type Primitive = string | number

const props = defineProps<{
  modelValue?: boolean | Primitive[]
  value?: Primitive
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean | Primitive[]]
}>()

const isArrayMode = computed(() => Array.isArray(props.modelValue))

const checked = computed(() => {
  if (isArrayMode.value && props.value !== undefined) {
    return (props.modelValue as Primitive[]).includes(props.value)
  }
  return Boolean(props.modelValue)
})

function onChange(e: Event) {
  const next = (e.target as HTMLInputElement).checked
  if (isArrayMode.value && props.value !== undefined) {
    const arr = props.modelValue as Primitive[]
    emit(
      'update:modelValue',
      next ? [...arr, props.value] : arr.filter(v => v !== props.value),
    )
  } else {
    emit('update:modelValue', next)
  }
}
</script>

<template>
  <label class="s-checkbox" :class="{ 's-checkbox--disabled': disabled }">
    <input
      type="checkbox"
      :checked="checked"
      :value="value"
      :disabled="disabled"
      @change="onChange"
    />
    <span v-if="label || $slots.default" class="s-checkbox__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.s-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
  user-select: none;
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
}
.s-checkbox input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--sui-fg);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.s-checkbox--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.s-checkbox--disabled input { cursor: not-allowed; }
</style>
