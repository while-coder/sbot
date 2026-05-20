<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="s-page-toolbar">
    <div v-if="title || $slots.title" class="s-page-toolbar__title">
      <slot name="title">{{ title }}</slot>
    </div>
    <slot />
    <div v-if="$slots.actions" class="s-page-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.s-page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-4) var(--sui-sp-8);
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.s-page-toolbar__title {
  font-weight: 600;
  font-size: var(--sui-fs-lg);
  color: var(--sui-fg);
}
.s-page-toolbar__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
}
.s-page-toolbar :deep(.s-select),
.s-page-toolbar :deep(.s-input) {
  width: auto;
}
</style>
