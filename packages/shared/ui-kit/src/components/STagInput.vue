<script setup lang="ts">
import { computed, ref } from 'vue'
import STag from './STag.vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  maxTags?: number
  allowDuplicate?: boolean
  /** 触发添加的分隔字符（不含 Enter，Enter 始终生效）。默认 [',', ' ']。 */
  separators?: string[]
  /** 校验函数：返回 true 通过；返回 string 视为拒绝原因；返回 false 静默拒绝。 */
  validate?: (tag: string) => boolean | string
  /** 候选标签（输入时显示下拉建议） */
  suggestions?: string[]
}>(), {
  size: 'md',
  allowDuplicate: false,
  separators: () => [',', ' '],
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'invalid': [reason: string]
}>()

const inputEl  = ref<HTMLInputElement>()
const buffer   = ref('')
const focused  = ref(false)
const showSugg = ref(false)

const cls = computed(() => [
  's-tag-input',
  `s-tag-input--${props.size}`,
  { 's-tag-input--focused': focused.value, 's-tag-input--disabled': props.disabled },
])

const reachedMax = computed(() =>
  props.maxTags != null && props.modelValue.length >= props.maxTags
)

const filteredSuggestions = computed(() => {
  if (!props.suggestions?.length) return []
  const q   = buffer.value.trim().toLowerCase()
  const own = new Set(props.modelValue)
  return props.suggestions
    .filter(s => !own.has(s) && (!q || s.toLowerCase().includes(q)))
    .slice(0, 8)
})

function focusInput() {
  if (props.disabled) return
  inputEl.value?.focus()
}

function tryAdd(raw: string): boolean {
  const tag = raw.trim()
  if (!tag) return false
  if (reachedMax.value) {
    emit('invalid', 'max-tags')
    return false
  }
  if (!props.allowDuplicate && props.modelValue.includes(tag)) {
    emit('invalid', 'duplicate')
    return false
  }
  if (props.validate) {
    const r = props.validate(tag)
    if (r === false) { emit('invalid', 'invalid'); return false }
    if (typeof r === 'string') { emit('invalid', r); return false }
  }
  emit('update:modelValue', [...props.modelValue, tag])
  return true
}

function commitBuffer() {
  if (!buffer.value.trim()) return
  if (tryAdd(buffer.value)) buffer.value = ''
}

function removeAt(idx: number) {
  if (props.disabled) return
  const next = props.modelValue.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
}

function pickSuggestion(s: string) {
  if (tryAdd(s)) buffer.value = ''
  showSugg.value = false
  inputEl.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitBuffer()
    return
  }
  if (props.separators.includes(e.key)) {
    e.preventDefault()
    commitBuffer()
    return
  }
  if (e.key === 'Backspace' && buffer.value === '' && props.modelValue.length > 0) {
    e.preventDefault()
    removeAt(props.modelValue.length - 1)
  }
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!text) return
  // 粘贴文本若包含分隔字符或换行，则拆分批量加入
  const sep = new RegExp(`[${props.separators.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('')}\\n\\r\\t]`)
  if (!sep.test(text)) return
  e.preventDefault()
  for (const part of text.split(sep)) tryAdd(part)
  buffer.value = ''
}

function onBlur() {
  focused.value = false
  // 延迟隐藏建议，让 click 先触发
  setTimeout(() => { showSugg.value = false }, 150)
  commitBuffer()
}

function onFocus() {
  focused.value = true
  showSugg.value = true
}

defineExpose({ focus: focusInput })
</script>

<template>
  <div :class="cls" @click="focusInput">
    <STag v-for="(tag, i) in modelValue" :key="tag + i" closable @close="removeAt(i)">{{ tag }}</STag>
    <input
      ref="inputEl"
      v-model="buffer"
      class="s-tag-input__field"
      :placeholder="modelValue.length === 0 ? placeholder : ''"
      :disabled="disabled || reachedMax"
      @keydown="onKeydown"
      @paste="onPaste"
      @focus="onFocus"
      @blur="onBlur"
      @input="showSugg = true"
    />
    <div v-if="focused && showSugg && filteredSuggestions.length" class="s-tag-input__suggestions">
      <button
        v-for="s in filteredSuggestions"
        :key="s"
        type="button"
        class="s-tag-input__suggestion"
        @mousedown.prevent="pickSuggestion(s)"
      >{{ s }}</button>
    </div>
  </div>
</template>

<style scoped>
.s-tag-input {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sui-sp-2);
  width: 100%;
  min-height: 34px;
  padding: 4px var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
  color: var(--sui-fg);
  font-size: var(--sui-fs-md);
  cursor: text;
  transition: border-color var(--sui-transition-base);
  box-sizing: border-box;
}
.s-tag-input--sm {
  min-height: 28px;
  font-size: var(--sui-fs-sm);
  padding: 2px var(--sui-sp-3);
}
.s-tag-input--focused { border-color: var(--sui-fg); }
.s-tag-input--disabled {
  background: var(--sui-bg-soft);
  color: var(--sui-fg-disabled);
  cursor: not-allowed;
}

.s-tag-input__field {
  flex: 1;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  padding: 2px 0;
}
.s-tag-input__field::placeholder { color: var(--sui-fg-disabled); }
.s-tag-input__field:disabled { cursor: not-allowed; }

.s-tag-input__suggestions {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 200px;
  overflow-y: auto;
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  box-shadow: var(--sui-shadow-md, 0 4px 12px rgba(0,0,0,0.08));
  padding: var(--sui-sp-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.s-tag-input__suggestion {
  text-align: left;
  border: none;
  background: none;
  padding: 4px var(--sui-sp-3);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg);
  cursor: pointer;
  border-radius: var(--sui-radius-sm);
  font-family: inherit;
}
.s-tag-input__suggestion:hover { background: var(--sui-bg-hover); }
</style>
