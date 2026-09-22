<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SLayoutHeader", inheritAttrs: false })
defineProps<{ bordered?: boolean }>()
const attrs = useAttrs()
</script>

<template>
  <header v-bind="attrs" :class="['s-layout-header', { bordered }]">
    <slot />
  </header>
</template>

<style scoped>
.s-layout-header.bordered { border-bottom: 1px solid var(--sui-border); }
</style>
