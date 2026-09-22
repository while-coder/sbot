<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SScrollbar", inheritAttrs: false })
defineProps<{ xScrollable?: boolean }>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" :class="['s-scrollbar', { horizontal: xScrollable }]">
    <slot />
  </div>
</template>

<style scoped>
.s-scrollbar { overflow: auto; }
.s-scrollbar.horizontal { overflow: auto; }
</style>
