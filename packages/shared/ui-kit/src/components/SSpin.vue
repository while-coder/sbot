<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SSpin", inheritAttrs: false })
defineProps<{ show?: boolean; description?: string }>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-spin-wrap">
    <slot />
    <div v-if="show" class="s-spin-mask" role="status">
      <span class="s-spinner large" />
      <span v-if="description">{{ description }}</span>
    </div>
  </div>
</template>

<style scoped>
.s-spin-wrap { position: relative; min-width: 0; min-height: 0; }
.s-spin-mask { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; background: color-mix(in srgb, var(--sui-bg) 82%, transparent); color: var(--sui-primary); }
</style>
