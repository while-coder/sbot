<script setup lang="ts">
defineProps<{
  title?: string
  bordered?: boolean
}>()
</script>

<template>
  <div class="s-card">
    <div v-if="title || $slots.title" class="s-card__title">
      <slot name="title">{{ title }}</slot>
    </div>
    <div v-if="$slots.toolbar" class="s-card__toolbar">
      <slot name="toolbar" />
    </div>
    <div class="s-card__body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="s-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.s-card {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  padding: var(--sui-sp-7) var(--sui-sp-8);
  margin-bottom: var(--sui-sp-7);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
}
.s-card__title {
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  color: var(--sui-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--sui-sp-5);
}
.s-card__toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-5);
}
.s-card__body {
  color: var(--sui-fg-secondary);
}
.s-card__footer {
  margin-top: var(--sui-sp-5);
  padding-top: var(--sui-sp-5);
  border-top: 1px solid var(--sui-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--sui-sp-3);
}
</style>
