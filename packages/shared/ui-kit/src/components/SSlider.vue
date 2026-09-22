<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SSlider", inheritAttrs: false })
withDefaults(defineProps<{ value?: number; min?: number; max?: number; step?: number; disabled?: boolean }>(), { min: 0, max: 100, step: 1 })
const emit = defineEmits<{ "update:value": [value: any]; dragend: [value: any]; change: [value: any] }>()
const attrs = useAttrs()

const onInput = (event: Event) => emit("update:value", Number((event.target as HTMLInputElement).value))
const onChange = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  emit("change", value)
  emit("dragend", value)
}
</script>

<template>
  <input v-bind="attrs" class="s-slider" type="range" :value="value" :min="min" :max="max" :step="step" :disabled="disabled"
    @input="onInput" @change="onChange" />
</template>

<style scoped>
.s-slider { width: 100%; accent-color: var(--sui-primary); }
</style>
