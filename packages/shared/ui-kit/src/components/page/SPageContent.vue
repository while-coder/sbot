<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SPageContent", inheritAttrs: false })
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" :class="['s-page-content', { padded }]">
    <slot />
  </div>
</template>

<style scoped>
.s-page-content { flex: 1; width: 100%; min-width: 0; overflow-y: auto; }
.s-page-content.padded { padding: 20px; }
</style>
