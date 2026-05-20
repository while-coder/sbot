<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string | number
  type?: 'text' | 'password' | 'number' | 'email' | 'url' | 'search'
  size?: 'sm' | 'md'
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  invalid?: boolean
  autofocus?: boolean
}>(), {
  type: 'text',
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  blur: [e: FocusEvent]
  focus: [e: FocusEvent]
  keydown: [e: KeyboardEvent]
}>()

const cls = computed(() => [
  's-input',
  `s-input--${props.size}`,
  { 's-input--invalid': props.invalid },
])

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', props.type === 'number' ? Number(target.value) : target.value)
}
</script>

<template>
  <input
    :class="cls"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :autofocus="autofocus"
    @input="onInput"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>

<style scoped>
.s-input {
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
}
.s-input:focus { border-color: var(--sui-fg); }
.s-input:disabled {
  background: var(--sui-bg-soft);
  color: var(--sui-fg-disabled);
  cursor: not-allowed;
}
.s-input--sm { padding: var(--sui-sp-1) var(--sui-sp-3); font-size: var(--sui-fs-sm); }
.s-input--invalid { border-color: var(--sui-danger); }
.s-input--invalid:focus { border-color: var(--sui-danger); }
</style>
