<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "STreePanel", inheritAttrs: false })
const props = defineProps<{
  /** 顶部标题文本，可用 header 插槽覆盖 */
  header?: string
}>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-tree-panel">
    <div v-if="props.header || $slots.header" class="s-tree-panel-header">
      <slot name="header">{{ props.header }}</slot>
    </div>
    <div class="s-tree-panel-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.s-tree-panel { display: flex; min-height: 0; flex-direction: column; overflow-y: auto; border-right: 1px solid var(--sui-border); background: var(--sui-bg-subtle); }
.s-tree-panel-header { flex-shrink: 0; padding: 10px 12px 6px; border-bottom: 1px solid var(--sui-border); color: var(--sui-fg-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.s-tree-panel-body { flex: 1; min-height: 0; overflow-y: auto; }
</style>
