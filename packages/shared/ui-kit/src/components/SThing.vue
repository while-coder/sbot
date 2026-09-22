<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SThing", inheritAttrs: false })
defineProps<{ title?: string; description?: string }>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-thing">
    <div class="s-thing-head">
      <strong><slot name="title">{{ title }}</slot></strong>
      <div v-if="$slots['header-extra']"><slot name="header-extra" /></div>
    </div>
    <div v-if="description || $slots.description" class="s-thing-description">
      <slot name="description">{{ description }}</slot>
    </div>
    <div class="s-thing-content"><slot /></div>
  </div>
</template>

<style scoped>
.s-thing-head { display: flex; justify-content: space-between; gap: 8px; }
.s-thing-description { display: flex; gap: 6px; margin: 4px 0 8px; }
</style>
