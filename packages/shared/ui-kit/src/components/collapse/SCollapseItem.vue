<script setup lang="ts">
import { inject, useAttrs } from "vue"
import { collapseKey } from "./SCollapse.vue"

defineOptions({ name: "SCollapseItem", inheritAttrs: false })
defineProps<{ title?: string; name?: any }>()
const attrs = useAttrs()

const context = inject(collapseKey, null)
</script>

<template>
  <details v-bind="attrs" class="s-collapse-item" :open="context?.defaults.has(name)">
    <summary class="s-collapse-summary">
      <span><slot name="header">{{ title ?? "详情" }}</slot></span>
      <span v-if="$slots['header-extra']" class="s-collapse-extra" @click.prevent><slot name="header-extra" /></span>
    </summary>
    <div class="s-collapse-body"><slot /></div>
  </details>
</template>

<style scoped>
.s-collapse-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; background: var(--sui-bg-soft); cursor: pointer; color: var(--sui-fg); }
.s-collapse-body { padding: 12px; }
.s-collapse-extra { margin-left: auto; }
</style>
