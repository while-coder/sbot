<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "STag", inheritAttrs: false })
const props = withDefaults(defineProps<{ type?: string; size?: string; closable?: boolean; bordered?: boolean }>(), { type: "default", bordered: true })
const emit = defineEmits<{ close: [] }>()
const attrs = useAttrs()
</script>

<template>
  <span v-bind="attrs" :class="['s-tag', `type-${props.type}`, `size-${props.size ?? 'medium'}`, { bordered: props.bordered }]">
    <slot />
    <button v-if="props.closable" type="button" class="s-tag-close" aria-label="移除" @click="emit('close')">×</button>
  </span>
</template>

<style scoped>
.s-tag { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 2px 8px; border-radius: var(--sui-radius-sm); background: var(--sui-bg-soft); color: var(--sui-fg-secondary); font-size: 12px; }
.s-tag.bordered { border: 1px solid var(--sui-border); }
.s-tag.type-success { color: var(--sui-success); }
.s-tag.type-warning { color: var(--sui-warning); }
.s-tag.type-error { color: var(--sui-danger); }
.s-tag.type-info, .s-tag.type-primary { color: var(--sui-info); }
.s-tag-close { border: 0; background: transparent; color: inherit; cursor: pointer; }
</style>
