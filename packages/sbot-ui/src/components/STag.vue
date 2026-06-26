<script setup lang="ts">
defineProps<{
  closable?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <span class="s-tag">
    <slot />
    <button
      v-if="closable"
      type="button"
      class="s-tag__close"
      @click.stop="emit('close')"
      aria-label="remove"
    >×</button>
  </span>
</template>

<style scoped>
.s-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-1);
  padding: 2px var(--sui-sp-3);
  background: var(--sui-border);
  border-radius: var(--sui-radius-sm);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  white-space: nowrap;
}
.s-tag__close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: var(--sui-fg-soft);
  padding: 0 1px;
}
.s-tag__close:hover { color: var(--sui-danger-strong); }
</style>
