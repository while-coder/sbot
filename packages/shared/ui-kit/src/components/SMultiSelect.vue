<script lang="ts">
export interface MultiSelectOption {
  id: string | number
  label: string
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from "vue"

defineOptions({ name: "SMultiSelect", inheritAttrs: false })
const props = withDefaults(defineProps<{
  options?: MultiSelectOption[]
  value?: Array<string | number>
  placeholder?: string
  compact?: boolean
  /** 单选模式：只允许一个选中值，选中后自动收起下拉 */
  single?: boolean
  disabled?: boolean
  /** 下拉展开方向，默认向下 */
  placement?: "bottom" | "top"
}>(), { options: () => [], value: () => [] })
const emit = defineEmits<{ "update:value": [value: Array<string | number>]; change: [value: Array<string | number>] }>()
const attrs = useAttrs()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)

const isSelected = (id: string | number) => props.value.includes(id)
const selectedLabels = computed(() => props.options.filter(option => isSelected(option.id)).map(option => option.label))
const commit = (next: Array<string | number>) => { emit("update:value", next); emit("change", next) }
const toggle = (id: string | number) => commit(isSelected(id) ? props.value.filter(item => item !== id) : [...props.value, id])
const pick = (id: string | number) => { open.value = false; if (!isSelected(id)) commit([id]) }
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
  <div v-bind="attrs" ref="root" class="s-multi-select" :class="{ compact: props.compact, open, single: props.single, up: props.placement === 'top', disabled: props.disabled }">
    <button ref="trigger" type="button" class="s-multi-select-trigger" :disabled="props.disabled" aria-haspopup="listbox"
      :aria-expanded="open" @click="open = !open">
      <span class="s-multi-select-value">
        <template v-if="selectedLabels.length">
          <span v-for="label in selectedLabels" :key="label" class="s-multi-select-chip">{{ label }}</span>
        </template>
        <span v-else class="s-multi-select-placeholder">{{ props.placeholder ?? "—" }}</span>
      </span>
      <svg class="s-multi-select-arrow" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
      </svg>
    </button>
    <div v-if="open" class="s-multi-select-menu" role="listbox" :aria-multiselectable="!props.single">
      <div v-if="props.options.length === 0" class="s-multi-select-empty">—</div>
      <label v-for="option in props.options" :key="option.id" class="s-multi-select-option"
        :class="{ checked: isSelected(option.id) }" role="option" :aria-selected="isSelected(option.id)"
        @click="props.single ? pick(option.id) : undefined">
        <input v-if="!props.single" type="checkbox" :checked="isSelected(option.id)" @change="toggle(option.id)" />
        <span>{{ option.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.s-multi-select { position: relative; display: inline-flex; flex-direction: column; }
.s-multi-select-trigger { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 5px 8px 5px 10px; gap: 6px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); color: inherit; cursor: pointer; text-align: left; transition: border-color var(--sui-transition); }
.s-multi-select.compact .s-multi-select-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.s-multi-select-trigger:hover:not(:disabled), .s-multi-select.open .s-multi-select-trigger { border-color: var(--sui-border-strong); }
.s-multi-select-trigger:disabled { cursor: not-allowed; background: var(--sui-bg-soft); color: var(--sui-fg-disabled); }
.s-multi-select-value { display: flex; flex: 1; min-width: 0; flex-wrap: wrap; gap: 4px; }
.s-multi-select-chip { padding: 1px 7px; border-radius: var(--sui-radius-pill); background: var(--sui-primary); color: var(--sui-on-primary); font-size: 12px; white-space: nowrap; }
.s-multi-select.compact .s-multi-select-chip { padding: 0 6px; font-size: 11px; }
/* 单选模式：值以纯文本展示（不使用 chip 反色底） */
.s-multi-select.single .s-multi-select-value { flex-wrap: nowrap; }
.s-multi-select.single .s-multi-select-chip { min-width: 0; padding: 0; overflow: hidden; border-radius: 0; background: none; color: var(--sui-fg); text-overflow: ellipsis; }
.s-multi-select-placeholder { color: var(--sui-fg-disabled); font-size: 13px; line-height: 1.6; }
.s-multi-select-arrow { flex: 0 0 auto; color: var(--sui-fg-muted); transition: transform var(--sui-transition); }
.s-multi-select.open .s-multi-select-arrow { transform: rotate(180deg); }
.s-multi-select-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: var(--sui-z-dropdown); min-width: 100%; width: max-content; max-height: 200px; overflow-y: auto; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); }
.s-multi-select.up .s-multi-select-menu { top: auto; bottom: calc(100% + 4px); }
.s-multi-select-option { display: flex; align-items: center; padding: 7px 12px; gap: 8px; border-bottom: 1px solid var(--sui-border-subtle); color: var(--sui-fg); font-size: 13px; cursor: pointer; user-select: none; transition: background var(--sui-transition); }
.s-multi-select-option:last-child { border-bottom: none; }
.s-multi-select-option:hover { background: var(--sui-bg-hover); }
.s-multi-select-option.checked { background: var(--sui-bg-active); font-weight: 500; }
.s-multi-select-option input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--sui-primary); }
.s-multi-select-empty { padding: 8px 12px; color: var(--sui-fg-disabled); font-size: 13px; }
</style>
