<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "SChip", inheritAttrs: false })
const props = withDefaults(defineProps<{ variant?: "default" | "warning"; clickable?: boolean }>(), { variant: "default" })
const attrs = useAttrs()

const cls = computed(() => ["s-chip", `type-${props.variant}`, { clickable: props.clickable }])
</script>

<template>
  <span v-bind="attrs" :class="cls"><slot /></span>
</template>

<style scoped>
.s-chip { display: inline-flex; align-items: center; font-size: 12px; padding: 3px 10px; background: var(--sui-bg-soft); border: 1px solid var(--sui-border); border-radius: var(--sui-radius-pill); color: var(--sui-fg-muted); white-space: nowrap; transition: background var(--sui-transition), border-color var(--sui-transition); }
.s-chip.clickable { cursor: pointer; }
.s-chip.clickable:hover { background: var(--sui-bg-hover); border-color: var(--sui-border-strong); }
.s-chip.type-warning { background: var(--sui-warning-chip-bg); border-color: var(--sui-warning-soft); color: var(--sui-warning-fg); }
</style>
