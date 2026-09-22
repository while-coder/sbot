<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'accent' | 'tool'
  size?: 'xs' | 'sm'
  pill?: boolean
}>(), {
  variant: 'neutral',
  size: 'xs',
})

const cls = computed(() => [
  's-badge',
  `s-badge--${props.variant}`,
  `s-badge--${props.size}`,
  { 's-badge--pill': props.pill },
])
</script>

<template>
  <span :class="cls"><slot /></span>
</template>

<style scoped>
.s-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border-radius: var(--sui-radius-sm);
  padding: 0 var(--sui-sp-2);
  line-height: 1.6;
  white-space: nowrap;
}
.s-badge--xs { font-size: var(--sui-fs-xs); min-width: 18px; }
.s-badge--sm { font-size: var(--sui-fs-sm); padding: 1px var(--sui-sp-3); }
.s-badge--pill { border-radius: var(--sui-radius-pill); }

.s-badge--neutral { background: var(--sui-bg-soft); color: var(--sui-fg-muted); }
.s-badge--info    { background: var(--sui-info-soft); color: var(--sui-on-info-soft); }
.s-badge--warning { background: var(--sui-warning-soft); color: var(--sui-on-warning-soft); }
.s-badge--success { background: var(--sui-success-soft); color: var(--sui-on-success-soft); }
.s-badge--danger  { background: var(--sui-danger-soft); color: var(--sui-on-danger-soft); }
.s-badge--accent  { background: var(--sui-info); color: #fff; }
.s-badge--tool    { background: var(--sui-tool-bg); color: var(--sui-on-tool-bg); }
</style>
