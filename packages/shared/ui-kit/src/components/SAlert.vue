<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SAlert", inheritAttrs: false })
const props = withDefaults(defineProps<{ type?: string; title?: string; bordered?: boolean }>(), { type: "info", bordered: true })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" :role="props.type === 'error' ? 'alert' : 'status'" :class="['s-alert', `type-${props.type}`, { bordered: props.bordered }]">
    <strong v-if="props.title" class="s-alert-title">{{ props.title }}</strong>
    <div class="s-alert-content"><slot /></div>
  </div>
</template>

<style scoped>
.s-alert { padding: 10px 12px; border-radius: var(--sui-radius-md); background: var(--sui-bg-soft); color: var(--sui-fg-secondary); font-size: 13px; line-height: 1.55; }
.s-alert.bordered { border: 1px solid var(--sui-border); }
.s-alert.type-error { border-color: color-mix(in srgb, var(--sui-danger) 45%, transparent); color: var(--sui-danger); }
.s-alert.type-warning { border-color: color-mix(in srgb, var(--sui-warning) 45%, transparent); }
.s-alert.type-info { border-color: color-mix(in srgb, var(--sui-info) 45%, transparent); }
.s-alert-title { display: block; margin-bottom: 4px; }
</style>
