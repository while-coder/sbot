<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SFormDetails", inheritAttrs: false })
defineProps<{ summary?: string; badge?: string | number; open?: boolean }>()
const attrs = useAttrs()
</script>

<template>
  <details v-bind="attrs" class="s-form-details" :open="open">
    <summary class="s-form-details-summary">
      <span class="s-form-details-title"><slot name="summary">{{ summary }}</slot></span>
      <span v-if="badge !== undefined && badge !== ''" class="s-form-details-badge">{{ badge }}</span>
      <slot name="badge" />
    </summary>
    <div class="s-form-details-body"><slot /></div>
  </details>
</template>

<style scoped>
.s-form-details { margin-top: 10px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); overflow: hidden; }
.s-form-details-summary { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; color: var(--sui-fg-secondary); cursor: pointer; user-select: none; background: var(--sui-bg-subtle); list-style: none; }
.s-form-details-summary::-webkit-details-marker { display: none; }
/* 折叠箭头，展开时旋转 */
.s-form-details-summary::before { content: "▶"; font-size: 10px; color: var(--sui-fg-disabled); transition: transform var(--sui-transition); }
.s-form-details[open] > .s-form-details-summary::before { transform: rotate(90deg); }
.s-form-details-title { flex: 1; }
.s-form-details-badge { min-width: 18px; padding: 0 6px; border-radius: var(--sui-radius-pill); background: var(--sui-info); color: #fff; font-size: 11px; font-weight: 700; text-align: center; }
.s-form-details-body { padding: 12px; border-top: 1px solid var(--sui-border); }
</style>
