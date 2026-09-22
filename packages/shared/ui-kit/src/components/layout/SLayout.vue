<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SLayout", inheritAttrs: false })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-layout">
    <slot />
  </div>
</template>

<style scoped>
.s-layout { min-width: 0; background: var(--sui-bg-page); color: var(--sui-fg); }
</style>
