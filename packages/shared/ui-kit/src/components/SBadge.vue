<script setup lang="ts">
import { computed } from "vue"

defineOptions({ name: "SBadge" })
const props = withDefaults(defineProps<{ variant?: "neutral" | "info" | "warning" | "success" | "danger" | "accent" | "tool"; size?: "xs" | "sm"; pill?: boolean }>(), { variant: "neutral", size: "xs" })

const cls = computed(() => ["s-badge", `type-${props.variant}`, `size-${props.size}`, { pill: props.pill }])
</script>

<template>
  <span :class="cls"><slot /></span>
</template>

<style scoped>
.s-badge { display: inline-flex; align-items: center; justify-content: center; font-weight: 600; border-radius: var(--sui-radius-sm); padding: 0 6px; line-height: 1.6; white-space: nowrap; }
.s-badge.size-xs { font-size: 11px; min-width: 18px; }
.s-badge.size-sm { font-size: 12px; padding: 1px 8px; }
.s-badge.pill { border-radius: var(--sui-radius-pill); }
.s-badge.type-neutral { background: var(--sui-bg-soft); color: var(--sui-fg-muted); }
.s-badge.type-info { background: var(--sui-info-soft); color: var(--sui-on-info-soft); }
.s-badge.type-warning { background: var(--sui-warning-soft); color: var(--sui-on-warning-soft); }
.s-badge.type-success { background: var(--sui-success-soft); color: var(--sui-on-success-soft); }
.s-badge.type-danger { background: var(--sui-danger-soft); color: var(--sui-on-danger-soft); }
.s-badge.type-accent { background: color-mix(in srgb, var(--sui-primary) 16%, transparent); color: var(--sui-primary); }
.s-badge.type-tool { background: var(--sui-tool-bg); color: var(--sui-on-tool-bg); }
</style>
