<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'divided' | 'compact'
  labelWidth?: string
}>(), {
  variant: 'divided',
  labelWidth: '120px',
})

const tableStyle = computed(() => ({
  '--s-info-label-width': props.labelWidth,
}))
</script>

<template>
  <table class="s-info-table" :class="`s-info-table--${variant}`" :style="tableStyle">
    <tbody>
      <slot />
    </tbody>
  </table>
</template>

<style scoped>
.s-info-table {
  width: 100%;
  font-size: var(--sui-fs-md);
  border-collapse: collapse;
}
.s-info-table :deep(.s-info-row__label) {
  width: var(--s-info-label-width);
}
.s-info-table :deep(.s-info-row__value.mono) {
  font-family: var(--sui-font-mono);
}

/* divided: rows separated by border-bottom, last row no border */
.s-info-table--divided :deep(.s-info-row) > td {
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border);
}
.s-info-table--divided :deep(.s-info-row:last-child) > td {
  border-bottom: none;
}
.s-info-table--divided :deep(.s-info-row__label) {
  color: var(--sui-fg-muted);
}

/* compact: small uppercase labels, no row separators */
.s-info-table--compact :deep(.s-info-row) > td {
  padding: 7px 12px;
}
.s-info-table--compact :deep(.s-info-row__label) {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.s-info-table--compact :deep(.s-info-row__value) {
  color: var(--sui-fg);
}
</style>
