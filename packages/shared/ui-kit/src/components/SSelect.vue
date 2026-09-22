<script lang="ts">
export interface SelectOption {
  /** divider 项不需要 label */
  label?: string | (() => unknown)
  value?: unknown
  key?: string | number
  disabled?: boolean
  show?: boolean
  children?: SelectOption[]
  /** 分隔线项：不渲染成按钮，只画一条水平细线（用于把管理类动作和可选项隔开） */
  divider?: boolean
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from "vue"

defineOptions({ name: "SSelect", inheritAttrs: false })
const props = withDefaults(defineProps<{
  value?: any
  options?: SelectOption[]
  multiple?: boolean
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
  size?: string
  invalid?: boolean
}>(), { options: () => [] })
const emit = defineEmits<{ "update:value": [value: any]; change: [value: any] }>()
const attrs = useAttrs()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)

const optionValue = (option: SelectOption): any => option.value ?? option.key ?? ""
const optionLabel = (option: SelectOption) => typeof option.label === "function" ? String(optionValue(option)) : (option.label ?? "")
const selectedValues = computed(() => {
  if (Array.isArray(props.value)) return props.value
  if (typeof props.value === "string") return props.value.split(",").map(value => value.trim()).filter(Boolean)
  return props.value == null || props.value === "" ? [] : [props.value]
})
const isSelected = (option: SelectOption) => selectedValues.value.some(value => String(value) === String(optionValue(option)))
const selectedLabel = computed(() => {
  const labels = props.options.filter(isSelected).map(optionLabel)
  return labels.length ? labels.join(", ") : (props.placeholder ?? "请选择")
})
const updateOption = (option: SelectOption, checked: boolean) => {
  const raw = optionValue(option)
  const next = selectedValues.value.filter(value => String(value) !== String(raw))
  if (checked) next.push(raw)
  emit("update:value", next)
  emit("change", next)
}
const onNativeChange = (event: Event) => {
  const element = event.target as HTMLSelectElement
  const raw = element.value
  const value = props.options.find(option => String(optionValue(option)) === raw)?.value ?? raw
  emit("update:value", value)
  emit("change", value)
}
const outside = (event: PointerEvent) => {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}
const keydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !open.value) return
  open.value = false
  trigger.value?.focus()
}
watch(open, value => {
  if (value) {
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", keydown)
  } else {
    document.removeEventListener("pointerdown", outside)
    document.removeEventListener("keydown", keydown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside)
  document.removeEventListener("keydown", keydown)
})
</script>

<template>
  <div v-if="multiple" v-bind="attrs" ref="root" class="s-multi-select">
    <button ref="trigger" type="button" class="s-select s-multi-select-trigger" :class="[size ? `size-${size}` : null, { invalid: props.invalid }]"
      :disabled="disabled" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
      <span class="s-multi-select-value" :title="selectedLabel">{{ selectedLabel }}</span>
      <svg :class="['s-multi-select-arrow', { open }]" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    <div v-if="open" class="s-multi-select-menu" role="listbox" aria-multiselectable="true">
      <label v-for="(option, index) in options" :key="index" :class="['s-multi-select-option', { disabled: option.disabled }]"
        role="option" :aria-selected="isSelected(option)">
        <input type="checkbox" :checked="isSelected(option)" :disabled="option.disabled"
          @change="updateOption(option, ($event.target as HTMLInputElement).checked)" />
        <span>{{ optionLabel(option) }}</span>
      </label>
    </div>
  </div>
  <select v-else v-bind="attrs" class="s-select" :class="[size ? `size-${size}` : null, { invalid: props.invalid }]" :value="(value as any)"
    :disabled="disabled" @change="onNativeChange">
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option v-for="option in options" :key="optionValue(option)" :value="optionValue(option)" :disabled="option.disabled">{{ optionLabel(option) }}</option>
  </select>
</template>

<style scoped>
.s-select.invalid { border-color: var(--sui-danger); }
.s-multi-select { position: relative; width: 100%; min-width: 0; }
.s-multi-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; text-align: left; }
.s-multi-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-multi-select-arrow { width: 14px; height: 14px; flex: 0 0 auto; fill: none; stroke: var(--sui-fg-muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; transition: transform var(--sui-transition); }
.s-multi-select-arrow.open { transform: rotate(180deg); }
.s-multi-select-menu { position: absolute; top: calc(100% + 4px); right: 0; left: 0; z-index: var(--sui-z-dropdown); display: grid; max-height: 220px; gap: 2px; padding: 5px; overflow-y: auto; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); }
.s-multi-select-option { display: flex; min-height: 30px; align-items: center; gap: 8px; padding: 5px 7px; border-radius: var(--sui-radius-sm); color: var(--sui-fg-secondary); cursor: pointer; font-size: 13px; }
.s-multi-select-option:hover { background: var(--sui-bg-hover); }
.s-multi-select-option.disabled { cursor: not-allowed; opacity: .5; }
.s-multi-select-option input { accent-color: var(--sui-primary); }
</style>
