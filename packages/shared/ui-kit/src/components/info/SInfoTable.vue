<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SInfoTable", inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** divided：行分隔线；compact：小号大写标签 */
  variant?: "divided" | "compact"
  labelWidth?: string
}>(), { variant: "divided", labelWidth: "120px" })
const attrs = useAttrs()
</script>

<template>
  <table v-bind="attrs" class="s-info-table" :class="variant" :style="{ '--s-info-label-width': props.labelWidth }">
    <tbody>
      <slot />
    </tbody>
  </table>
</template>

<style scoped>
.s-info-table { width: 100%; font-size: 13px; border-collapse: collapse; }
.s-info-table :deep(.s-info-row-label) { width: var(--s-info-label-width); white-space: nowrap; }
.s-info-table :deep(.s-info-row-value.mono) { font-family: var(--sui-font-mono); }
/* divided：行分隔线，末行无线 */
.s-info-table.divided :deep(.s-info-row) > td { padding: 8px 0; border-bottom: 1px solid var(--sui-border); }
.s-info-table.divided :deep(.s-info-row:last-child) > td { border-bottom: none; }
.s-info-table.divided :deep(.s-info-row-label) { color: var(--sui-fg-muted); }
/* compact：小号大写标签，无行分隔 */
.s-info-table.compact :deep(.s-info-row) > td { padding: 7px 12px; }
.s-info-table.compact :deep(.s-info-row-label) { color: var(--sui-fg-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.s-info-table.compact :deep(.s-info-row-value) { color: var(--sui-fg); }
</style>
