<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SInputGroup", inheritAttrs: false })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-input-group">
    <slot />
  </div>
</template>

<style scoped>
/* 槽内是 SInput/SButton 等子组件或业务元素，跨边界一律 :deep */
.s-input-group { display: flex; width: 100%; min-width: 0; }
.s-input-group > :deep(.s-input-wrap), .s-input-group > :deep(.s-select), .s-input-group > :deep(.s-input) { min-width: 0; flex: 1 1 auto; }
.s-input-group > :deep(.s-button) { flex: 0 0 auto; }
.s-input-group > *:not(:first-child) :deep(.s-input), .s-input-group > :deep(.s-button):not(:first-child) { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.s-input-group > *:not(:last-child) :deep(.s-input), .s-input-group > :deep(.s-button):not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
</style>
