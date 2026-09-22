<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SLayoutContent", inheritAttrs: false })
const attrs = useAttrs()
</script>

<template>
  <main v-bind="attrs" class="s-layout-content">
    <slot />
  </main>
</template>

<style scoped>
.s-layout-content { min-width: 0; background: var(--sui-bg-page); color: var(--sui-fg); }
</style>
