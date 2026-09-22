<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SPageToolbar", inheritAttrs: false })
defineProps<{ title?: string }>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-page-toolbar">
    <div v-if="title || $slots.title" class="s-page-toolbar-title">
      <slot name="title">{{ title }}</slot>
    </div>
    <slot />
    <div v-if="$slots.actions" class="s-page-toolbar-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.s-page-toolbar { display: flex; flex-wrap: wrap; flex-shrink: 0; align-items: center; gap: 8px; padding: 10px 20px; background: var(--sui-bg); border-bottom: 1px solid var(--sui-border); }
.s-page-toolbar-title { font-size: 15px; font-weight: 600; color: var(--sui-fg); }
.s-page-toolbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
/* 默认槽内的下拉/输入自动收窄宽度 */
.s-page-toolbar :deep(.s-select),
.s-page-toolbar :deep(.s-input) { width: auto; }
</style>
