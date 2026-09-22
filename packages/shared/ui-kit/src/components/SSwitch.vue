<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SSwitch", inheritAttrs: false })
const props = defineProps<{ value?: boolean; label?: string; disabled?: boolean; size?: string }>()
const emit = defineEmits<{ "update:value": [value: any]; change: [value: any] }>()
const attrs = useAttrs()

const toggle = () => { emit("update:value", !props.value); emit("change", !props.value) }
</script>

<template>
  <button v-bind="attrs" type="button" role="switch" :aria-checked="props.value" :disabled="props.disabled"
    :class="['s-switch', props.size ? `size-${props.size}` : null, { checked: props.value }]" @click="toggle">
    <span class="s-switch-track" aria-hidden="true"><span class="s-switch-thumb" /></span>
    <span v-if="$slots.checked || $slots.unchecked" class="s-switch-label">
      <slot v-if="props.value" name="checked" /><slot v-else name="unchecked" />
    </span>
    <span v-else-if="props.label" class="s-switch-label">{{ props.label }}</span>
  </button>
</template>

<style scoped>
.s-switch { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: var(--sui-fg-secondary); cursor: pointer; font: inherit; line-height: 1; }
.s-switch-track { position: relative; width: 38px; height: 22px; flex: 0 0 auto; border: 1px solid var(--sui-border-strong); border-radius: 999px; background: var(--sui-bg-hover); transition: background var(--sui-transition), border-color var(--sui-transition); }
.s-switch-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--sui-fg-muted); box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: background var(--sui-transition), transform var(--sui-transition); }
.s-switch:hover:not(:disabled) .s-switch-track { border-color: var(--sui-primary); }
.s-switch.checked .s-switch-track { border-color: var(--sui-primary); background: var(--sui-primary); }
.s-switch.checked .s-switch-thumb { background: var(--sui-on-primary); transform: translateX(16px); }
.s-switch:disabled { cursor: not-allowed; opacity: .5; }
.s-switch-label { color: var(--sui-fg-muted); font-size: 12px; line-height: 1.2; white-space: nowrap; }
.s-switch.checked .s-switch-label { color: var(--sui-fg-secondary); }
.s-switch.size-small { min-height: 24px; }
.s-switch.size-small .s-switch-track { width: 32px; height: 18px; }
.s-switch.size-small .s-switch-thumb { width: 12px; height: 12px; }
.s-switch.size-small.checked .s-switch-thumb { transform: translateX(14px); }
</style>
