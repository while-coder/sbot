<script setup lang="ts">
import { inject, useAttrs } from "vue"
import { checkboxGroupKey } from "./SCheckboxGroup.vue"

defineOptions({ name: "SCheckbox", inheritAttrs: false })
const props = defineProps<{ checked?: boolean; value?: any; label?: string; disabled?: boolean }>()
const emit = defineEmits<{ "update:checked": [checked: any]; change: [checked: any] }>()
const attrs = useAttrs()

const group = inject(checkboxGroupKey, null)
const isChecked = () => group ? group.value().includes(props.value) : props.checked
const update = (checked: boolean) => {
  if (group) group.update(checked ? [...group.value(), props.value] : group.value().filter(item => item !== props.value))
  else { emit("update:checked", checked); emit("change", checked) }
}
</script>

<template>
  <label v-bind="attrs" :class="['s-checkbox', { disabled: props.disabled }]">
    <input type="checkbox" :checked="isChecked()" :disabled="props.disabled" @change="update(($event.target as HTMLInputElement).checked)" />
    <span><slot>{{ props.label }}</slot></span>
  </label>
</template>

<style scoped>
.s-checkbox { display: inline-flex; align-items: center; gap: 6px; color: var(--sui-fg-secondary); font-size: 13px; }
.s-checkbox.disabled { opacity: .5; }
.s-checkbox input { accent-color: var(--sui-primary); }
</style>
