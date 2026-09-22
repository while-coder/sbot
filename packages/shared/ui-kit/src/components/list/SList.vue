<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SList", inheritAttrs: false })
defineProps<{ bordered?: boolean }>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" :class="['s-list', { bordered }]">
    <slot />
  </div>
</template>

<style scoped>
.s-list.bordered { border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); overflow: hidden; }
</style>
