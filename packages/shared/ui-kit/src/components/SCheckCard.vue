<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SCheckCard", inheritAttrs: false })
const props = defineProps<{ checked?: boolean; label?: string; disabled?: boolean }>()
const emit = defineEmits<{ "update:checked": [checked: boolean]; change: [checked: boolean] }>()
const attrs = useAttrs()
</script>

<template>
  <label v-bind="attrs" :class="['s-check-card', { disabled: props.disabled }]">
    <input type="checkbox" :checked="props.checked" :disabled="props.disabled" @change="emit('update:checked', ($event.target as HTMLInputElement).checked); emit('change', ($event.target as HTMLInputElement).checked)" />
    <slot>{{ props.label }}</slot>
  </label>
</template>

<style scoped>
.s-check-card { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); cursor: pointer; font-size: 13px; background: var(--sui-bg-subtle); user-select: none; color: var(--sui-fg-secondary); transition: background var(--sui-transition); }
.s-check-card:hover { background: var(--sui-bg-hover); }
.s-check-card input[type="checkbox"] { cursor: pointer; accent-color: var(--sui-primary); }
.s-check-card.disabled { opacity: .5; cursor: not-allowed; }
.s-check-card.disabled:hover { background: var(--sui-bg-subtle); }
</style>
