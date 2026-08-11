<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="s-form-section">
    <div v-if="title || $slots.title" class="s-form-section__title">
      <slot name="title">{{ title }}</slot>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.s-form-section {
  margin-top: var(--sui-sp-7);
  padding-top: var(--sui-sp-5);
  border-top: 1px solid var(--sui-border);
}
.s-form-section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.s-form-section__title {
  font-size: var(--sui-fs-md);
  font-weight: 600;
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-4);
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
}
</style>
