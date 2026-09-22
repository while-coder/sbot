<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SGridItem", inheritAttrs: false })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-grid-item">
    <slot />
  </div>
</template>
