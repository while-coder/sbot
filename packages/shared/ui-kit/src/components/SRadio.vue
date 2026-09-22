<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "SRadio", inheritAttrs: false })
const props = defineProps<{ value?: any; labelValue?: any; label?: string; name?: string; disabled?: boolean }>()
const emit = defineEmits<{ "update:value": [value: any]; change: [value: any] }>()
const attrs = useAttrs()

// 自身取值：未传 labelValue 时回退到自身 value（单独使用时视为始终选中）
const ownValue = computed(() => props.labelValue ?? props.value)
const update = () => {
  emit("update:value", ownValue.value)
  emit("change", ownValue.value)
}
</script>

<template>
  <label v-bind="attrs" :class="['s-radio', { disabled: props.disabled }]">
    <input type="radio" :name="props.name" :value="ownValue" :checked="props.value === ownValue" :disabled="props.disabled" @change="update" />
    <span v-if="props.label || $slots.default" class="s-radio-label"><slot>{{ props.label }}</slot></span>
  </label>
</template>

<style scoped>
.s-radio { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; font-size: 13px; color: var(--sui-fg); }
.s-radio input[type="radio"] { margin: 0; flex-shrink: 0; width: 14px; height: 14px; cursor: pointer; accent-color: var(--sui-primary); }
.s-radio.disabled { opacity: .5; cursor: not-allowed; }
.s-radio.disabled input { cursor: not-allowed; }
</style>
