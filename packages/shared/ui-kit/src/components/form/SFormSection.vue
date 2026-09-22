<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SFormSection", inheritAttrs: false })
defineProps<{ title?: string }>()
const attrs = useAttrs()
</script>

<template>
  <section v-bind="attrs" class="s-form-section">
    <div v-if="title || $slots.title" class="s-form-section-title">
      <slot name="title">{{ title }}</slot>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.s-form-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--sui-border); }
/* 首个分区不带顶部分隔线 */
.s-form-section:first-child { margin-top: 0; padding-top: 0; border-top: none; }
.s-form-section-title { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: var(--sui-fg-muted); }
</style>
