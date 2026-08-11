<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  size?: 'sm' | 'md'
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  invalid?: boolean
  rows?: number
  resize?: 'none' | 'vertical' | 'horizontal' | 'both'
}>(), {
  size: 'md',
  rows: 3,
  resize: 'vertical',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [e: FocusEvent]
  focus: [e: FocusEvent]
  keydown: [e: KeyboardEvent]
}>()

const cls = computed(() => [
  's-textarea',
  `s-textarea--${props.size}`,
  { 's-textarea--invalid': props.invalid },
])

const style = computed(() => ({ resize: props.resize }))

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <textarea
    :class="cls"
    :style="style"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="rows"
    @input="onInput"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>

<style scoped>
.s-textarea {
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
  line-height: 1.5;
}
.s-textarea:focus { border-color: var(--sui-fg); }
.s-textarea:disabled {
  background: var(--sui-bg-soft);
  color: var(--sui-fg-disabled);
  cursor: not-allowed;
}
.s-textarea--sm { padding: var(--sui-sp-1) var(--sui-sp-3); font-size: var(--sui-fs-sm); }
.s-textarea--invalid { border-color: var(--sui-danger); }
.s-textarea--invalid:focus { border-color: var(--sui-danger); }
</style>
