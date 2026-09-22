<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SListItem", inheritAttrs: false })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-list-item">
    <div class="s-list-main"><slot /></div>
    <div v-if="$slots.suffix" class="s-list-suffix"><slot name="suffix" /></div>
  </div>
</template>

<style scoped>
.s-list-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; }
.s-list-item + .s-list-item { border-top: 1px solid var(--sui-border); }
.s-list-main { min-width: 0; flex: 1; }
.s-list-suffix { flex: 0 0 auto; }
</style>
