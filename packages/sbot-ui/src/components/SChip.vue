<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'default' | 'warning'
  clickable?: boolean
}>(), {
  variant: 'default',
})

const cls = computed(() => [
  's-chip',
  `s-chip--${props.variant}`,
  { 's-chip--clickable': props.clickable },
])
</script>

<template>
  <span :class="cls">
    <slot />
  </span>
</template>

<style scoped>
.s-chip {
  display: inline-flex;
  align-items: center;
  font-size: var(--sui-fs-sm);
  padding: 3px var(--sui-sp-4);
  background: var(--sui-bg-soft);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-pill);
  color: var(--sui-fg-muted);
  white-space: nowrap;
  transition: background var(--sui-transition-base), border-color var(--sui-transition-base);
}
.s-chip--clickable { cursor: pointer; }
.s-chip--clickable:hover {
  background: var(--sui-bg-hover);
  border-color: var(--sui-border-strong);
}
.s-chip--warning {
  background: var(--sui-warning-chip-bg);
  border-color: var(--sui-warning-soft);
  color: var(--sui-warning-fg);
}
</style>
