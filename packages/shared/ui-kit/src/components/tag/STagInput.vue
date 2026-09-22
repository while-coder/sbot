<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from "vue"
import STag from "../STag.vue"

defineOptions({ name: "STagInput", inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** 已添加的标签 */
  value: string[]
  placeholder?: string
  size?: "sm" | "md"
  disabled?: boolean
  /** 最多标签数，达到后禁止继续输入 */
  maxTags?: number
  /** 是否允许重复标签，默认不允许 */
  allowDuplicate?: boolean
  /** 触发添加的分隔字符（不含 Enter，Enter 始终生效）。默认 [',', ' ']。 */
  separators?: string[]
  /** 校验函数：返回 true 通过；返回 string 视为拒绝原因；返回 false 静默拒绝。 */
  validate?: (tag: string) => boolean | string
  /** 候选标签（输入时显示下拉建议） */
  suggestions?: string[]
}>(), { size: "md", allowDuplicate: false, separators: () => [",", " "] })
const emit = defineEmits<{
  "update:value": [value: string[]]
  change: [value: string[]]
  /** 添加被拒绝时给出原因：max-tags / duplicate / 校验函数返回的文案 */
  invalid: [reason: string]
}>()
const attrs = useAttrs()

const root = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const buffer = ref("")
const focused = ref(false)
const suggestOpen = ref(false)

const cls = computed(() => [
  "s-tag-input",
  `size-${props.size}`,
  { focused: focused.value, disabled: props.disabled },
])

const reachedMax = computed(() => props.maxTags != null && props.value.length >= props.maxTags)

const filteredSuggestions = computed(() => {
  if (!props.suggestions?.length) return []
  const query = buffer.value.trim().toLowerCase()
  const own = new Set(props.value)
  return props.suggestions
    .filter(item => !own.has(item) && (!query || item.toLowerCase().includes(query)))
    .slice(0, 8)
})

const focusInput = () => { if (!props.disabled) inputEl.value?.focus() }

const commit = (next: string[]) => { emit("update:value", next); emit("change", next) }

function tryAdd(raw: string): boolean {
  const tag = raw.trim()
  if (!tag) return false
  if (reachedMax.value) { emit("invalid", "max-tags"); return false }
  if (!props.allowDuplicate && props.value.includes(tag)) { emit("invalid", "duplicate"); return false }
  if (props.validate) {
    const result = props.validate(tag)
    if (result === false) { emit("invalid", "invalid"); return false }
    if (typeof result === "string") { emit("invalid", result); return false }
  }
  commit([...props.value, tag])
  return true
}

function commitBuffer() {
  if (!buffer.value.trim()) return
  if (tryAdd(buffer.value)) buffer.value = ""
}

const removeAt = (index: number) => {
  if (props.disabled) return
  const next = props.value.slice()
  next.splice(index, 1)
  commit(next)
}

function pickSuggestion(item: string) {
  if (tryAdd(item)) buffer.value = ""
  suggestOpen.value = false
  inputEl.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || props.separators.includes(event.key)) {
    event.preventDefault()
    commitBuffer()
    return
  }
  if (event.key === "Backspace" && buffer.value === "" && props.value.length > 0) {
    event.preventDefault()
    removeAt(props.value.length - 1)
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text") ?? ""
  if (!text) return
  // 粘贴文本若包含分隔字符或换行，则拆分批量加入
  const source = props.separators.map(item => item.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("")
  const separator = new RegExp(`[${source}\\n\\r\\t]`)
  if (!separator.test(text)) return
  event.preventDefault()
  for (const part of text.split(separator)) tryAdd(part)
  buffer.value = ""
}

function onBlur() {
  focused.value = false
  commitBuffer()
}

const outside = (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node)) suggestOpen.value = false
}
const onDocKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !suggestOpen.value) return
  suggestOpen.value = false
  inputEl.value?.focus()
}
watch(suggestOpen, open => {
  if (open) {
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", onDocKeydown)
  } else {
    document.removeEventListener("pointerdown", outside)
    document.removeEventListener("keydown", onDocKeydown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside)
  document.removeEventListener("keydown", onDocKeydown)
})

defineExpose({ focus: focusInput })
</script>

<template>
  <div v-bind="attrs" ref="root" :class="cls" @click="focusInput">
    <STag v-for="(tag, index) in props.value" :key="tag + index" closable @close="removeAt(index)">{{ tag }}</STag>
    <input v-model="buffer" class="s-tag-input-field" :placeholder="props.value.length === 0 ? props.placeholder : ''"
      :disabled="props.disabled || reachedMax" aria-label="添加标签"
      @keydown="onKeydown" @paste="onPaste" @focus="focused = true; suggestOpen = true" @blur="onBlur"
      @input="suggestOpen = true" />
    <div v-if="suggestOpen && filteredSuggestions.length" class="s-tag-input-suggestions" role="listbox">
      <button v-for="item in filteredSuggestions" :key="item" type="button" role="option" :aria-selected="false"
        class="s-tag-input-suggestion" @mousedown.prevent="pickSuggestion(item)">{{ item }}</button>
    </div>
  </div>
</template>

<style scoped>
.s-tag-input { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 4px 8px; border: 1px solid var(--sui-border-strong); border-radius: var(--sui-radius-md); background: var(--sui-bg); color: var(--sui-fg); font-size: 13px; cursor: text; box-sizing: border-box; transition: border-color var(--sui-transition); }
.s-tag-input.size-sm { gap: 4px; min-height: 26px; padding: 2px 8px; font-size: 12px; }
.s-tag-input.focused { border-color: var(--sui-primary); }
.s-tag-input.disabled { background: var(--sui-bg-subtle); color: var(--sui-fg-disabled); cursor: not-allowed; }
.s-tag-input-field { flex: 1; min-width: 80px; padding: 2px 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: inherit; }
.s-tag-input-field::placeholder { color: var(--sui-fg-disabled); }
.s-tag-input-field:disabled { cursor: not-allowed; }
/* sm 尺寸下压缩 wm STag 的默认体积（不改 STag 本身） */
.s-tag-input.size-sm .s-tag { min-height: 20px; padding: 0 6px; font-size: 11px; }
.s-tag-input-suggestions { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: var(--sui-z-dropdown); display: grid; max-height: 200px; gap: 2px; padding: 5px; overflow-y: auto; border: 1px solid var(--sui-border-strong); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); }
.s-tag-input-suggestion { padding: 5px 7px; border: 0; border-radius: var(--sui-radius-sm); background: none; color: var(--sui-fg-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.s-tag-input-suggestion:hover { background: var(--sui-bg-hover); }
.s-tag-input-suggestion:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 2px; }
</style>
