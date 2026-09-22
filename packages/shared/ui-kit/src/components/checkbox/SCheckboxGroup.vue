<script lang="ts">
import type { InjectionKey } from "vue"

export interface CheckboxGroupContext { value: () => unknown[]; update: (value: unknown[]) => void }
export const checkboxGroupKey: InjectionKey<CheckboxGroupContext> = Symbol("checkbox-group")
</script>

<script setup lang="ts">
import { provide, useAttrs } from "vue"

defineOptions({ name: "SCheckboxGroup", inheritAttrs: false })
const props = withDefaults(defineProps<{ value?: unknown[] }>(), { value: () => [] })
const emit = defineEmits<{ "update:value": [value: any]; change: [value: any] }>()
const attrs = useAttrs()

provide(checkboxGroupKey, {
  value: () => props.value,
  update: value => { emit("update:value", value); emit("change", value) },
})
</script>

<template>
  <div v-bind="attrs" class="s-checkbox-group">
    <slot />
  </div>
</template>

<style scoped>
.s-checkbox-group { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; color: var(--sui-fg-secondary); font-size: 13px; }
</style>
