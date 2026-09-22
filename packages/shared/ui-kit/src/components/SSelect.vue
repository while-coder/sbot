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
  /** 配合 multiple：下拉单选形态，点选即收起，值以纯文本展示（原 SMultiSelect 的 single） */
  single?: boolean
  /** 配合 multiple：更矮的触发器与更小的 chip（原 SMultiSelect 的 compact） */
  compact?: boolean
  /** 下拉展开方向，默认向下（原 SMultiSelect 的 placement） */
  placement?: "bottom" | "top"
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
const selectedOptions = computed(() => props.options.filter(isSelected))
const selectedLabel = computed(() => {
  const labels = selectedOptions.value.map(optionLabel)
  return labels.length ? labels.join(", ") : (props.placeholder ?? "请选择")
})
//下拉单选：点选后收起；已选中再点不动
const pickSingle = (option: SelectOption) => {
  open.value = false
  if (isSelected(option)) return
  const raw = optionValue(option)
  emit("update:value", [raw])
  emit("change", [raw])
}
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
  <div v-if="multiple" v-bind="attrs" ref="root" class="s-multi-select" :class="{ compact: props.compact, single: props.single, up: props.placement === 'top' }">
    <button ref="trigger" type="button" class="s-select s-multi-select-trigger" :class="[size ? `size-${size}` : null, { invalid: props.invalid }]"
      :disabled="disabled" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
      <span class="s-multi-select-value" :title="props.single ? undefined : selectedLabel">
        <template v-if="props.single">
          <span v-if="selectedOptions.length" class="s-multi-select-single-value">{{ selectedLabel }}</span>
          <span v-else class="s-multi-select-placeholder">{{ placeholder ?? "请选择" }}</span>
        </template>
        <template v-else-if="selectedOptions.length">
          <span v-for="option in selectedOptions" :key="String(optionValue(option))" class="s-multi-select-chip">{{ optionLabel(option) }}</span>
        </template>
        <span v-else class="s-multi-select-placeholder">{{ placeholder ?? "请选择" }}</span>
      </span>
      <svg :class="['s-multi-select-arrow', { open }]" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    <div v-if="open" class="s-multi-select-menu" role="listbox" :aria-multiselectable="!props.single">
      <div v-if="options.length === 0" class="s-multi-select-empty">—</div>
      <label v-for="(option, index) in options" :key="index" :class="['s-multi-select-option', { disabled: option.disabled, checked: props.single && isSelected(option) }]"
        role="option" :aria-selected="isSelected(option)" @click="props.single ? pickSingle(option) : undefined">
        <input v-if="!props.single" type="checkbox" :checked="isSelected(option)" :disabled="option.disabled"
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
.s-multi-select.compact .s-multi-select-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.s-multi-select-value { display: flex; flex: 1; min-width: 0; flex-wrap: wrap; gap: 4px; }
.s-multi-select.single .s-multi-select-value { flex-wrap: nowrap; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-multi-select-chip { padding: 1px 7px; border-radius: var(--sui-radius-pill); background: var(--sui-primary); color: var(--sui-on-primary); font-size: 12px; white-space: nowrap; }
.s-multi-select.compact .s-multi-select-chip { padding: 0 6px; font-size: 11px; }
.s-multi-select-single-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-multi-select-placeholder { color: var(--sui-fg-disabled); font-size: 13px; line-height: 1.6; }
.s-multi-select-arrow { width: 14px; height: 14px; flex: 0 0 auto; fill: none; stroke: var(--sui-fg-muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; transition: transform var(--sui-transition); }
.s-multi-select-arrow.open { transform: rotate(180deg); }
.s-multi-select-menu { position: absolute; top: calc(100% + 4px); right: 0; left: 0; z-index: var(--sui-z-dropdown); display: grid; max-height: 220px; gap: 2px; padding: 5px; overflow-y: auto; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); }
.s-multi-select.up .s-multi-select-menu { top: auto; bottom: calc(100% + 4px); }
.s-multi-select-option { display: flex; min-height: 30px; align-items: center; gap: 8px; padding: 5px 7px; border-radius: var(--sui-radius-sm); color: var(--sui-fg-secondary); cursor: pointer; font-size: 13px; }
.s-multi-select-option:hover { background: var(--sui-bg-hover); }
.s-multi-select-option.checked { background: var(--sui-bg-active); font-weight: 500; }
.s-multi-select-option.disabled { cursor: not-allowed; opacity: .5; }
.s-multi-select-option input { accent-color: var(--sui-primary); }
.s-multi-select-empty { padding: 8px 12px; color: var(--sui-fg-disabled); font-size: 13px; }
</style>
