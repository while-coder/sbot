<script setup lang="ts">
withDefaults(defineProps<{
  summary?: string
  badge?: string | number
  open?: boolean
}>(), {})
</script>

<template>
  <details class="s-form-details" :open="open">
    <summary class="s-form-details__summary">
      <span class="s-form-details__title">
        <slot name="summary">{{ summary }}</slot>
      </span>
      <span v-if="badge !== undefined && badge !== ''" class="s-form-details__badge">{{ badge }}</span>
      <slot name="badge" />
    </summary>
    <div class="s-form-details__body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.s-form-details {
  margin-top: var(--sui-sp-5);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  overflow: hidden;
}
.s-form-details__summary {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-3) var(--sui-sp-5);
  font-size: var(--sui-fs-md);
  font-weight: 600;
  color: var(--sui-fg-secondary);
  cursor: pointer;
  user-select: none;
  background: var(--sui-bg-subtle);
  list-style: none;
}
.s-form-details__summary::-webkit-details-marker { display: none; }
.s-form-details__summary::before {
  content: '▶';
  font-size: 10px;
  color: var(--sui-fg-disabled);
  transition: transform var(--sui-transition-base);
}
.s-form-details[open] > .s-form-details__summary::before { transform: rotate(90deg); }
.s-form-details__title { flex: 1; }
.s-form-details__badge {
  background: var(--sui-info);
  color: #fff;
  border-radius: var(--sui-radius-pill);
  font-size: var(--sui-fs-xs);
  font-weight: 700;
  padding: 0 var(--sui-sp-2);
  min-width: 18px;
  text-align: center;
}
.s-form-details__body {
  padding: var(--sui-sp-5);
  border-top: 1px solid var(--sui-border);
}
</style>
