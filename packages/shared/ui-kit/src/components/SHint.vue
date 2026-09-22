<script setup lang="ts">
defineOptions({ name: "SHint" })
const props = withDefaults(defineProps<{ type?: "default" | "warning" | "danger" | "info" }>(), { type: "default" })
</script>

<template>
  <span :class="['s-hint', `type-${props.type}`]"><slot /></span>
</template>

<style scoped>
.s-hint { display: inline-block; font-size: 11px; color: var(--sui-fg-disabled); margin-top: 2px; }
.s-hint.type-warning { color: var(--sui-warning-fg); }
.s-hint.type-danger { color: var(--sui-danger); }
.s-hint.type-info { color: var(--sui-info); }
</style>
