<script lang="ts">
let autoCompleteId = 0
</script>

<script setup lang="ts">
import { useAttrs } from "vue"
import type { SelectOption } from "./SSelect.vue"

defineOptions({ name: "SAutoComplete", inheritAttrs: false })
withDefaults(defineProps<{
  value?: string | number
  options?: (string | SelectOption)[]
  placeholder?: string
  disabled?: boolean
}>(), { options: () => [] })
const emit = defineEmits<{ "update:value": [value: string]; change: [value: string] }>()
const attrs = useAttrs()
const id = `s-autocomplete-${++autoCompleteId}`
const optionValue = (option: string | SelectOption) => typeof option === "string" ? option : (option.value as any) ?? option.label
</script>

<template>
  <input v-bind="attrs" :id="id" class="s-input" :value="value ?? ''" :placeholder="placeholder" :disabled="disabled"
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    @change="emit('change', ($event.target as HTMLInputElement).value)" />
  <datalist :id="id">
    <option v-for="(option, index) in options" :key="index" :value="optionValue(option)" />
  </datalist>
</template>
