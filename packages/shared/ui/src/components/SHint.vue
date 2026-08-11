<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'default' | 'warning' | 'danger' | 'info'
}>(), {
  type: 'default',
})
</script>

<template>
  <span class="s-hint" :class="`s-hint--${type}`">
    <slot />
  </span>
</template>

<style scoped>
.s-hint {
  display: inline-block;
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  margin-top: 2px;
}
.s-hint--warning { color: var(--sui-warning-fg); }
.s-hint--danger { color: var(--sui-danger); }
.s-hint--info { color: var(--sui-info); }
</style>
