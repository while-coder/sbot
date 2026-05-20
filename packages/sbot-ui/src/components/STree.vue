<script setup lang="ts">
defineProps<{
  header?: string
}>()
</script>

<template>
  <div class="s-tree">
    <div v-if="header || $slots.header" class="s-tree__header">
      <slot name="header">{{ header }}</slot>
    </div>
    <div class="s-tree__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.s-tree {
  display: flex;
  flex-direction: column;
  background: var(--sui-bg-subtle);
  border-right: 1px solid var(--sui-border);
  overflow-y: auto;
}
.s-tree__header {
  padding: var(--sui-sp-4) var(--sui-sp-5) var(--sui-sp-2);
  font-size: var(--sui-fs-xs);
  font-weight: 700;
  color: var(--sui-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
}
.s-tree__body {
  flex: 1;
  overflow-y: auto;
}
</style>
