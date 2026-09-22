<script setup lang="ts">
import { computed, useAttrs } from "vue"

const px = (value: string | number | undefined, fallback = 8) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

defineOptions({ name: "SSpace", inheritAttrs: false })
const props = withDefaults(defineProps<{ vertical?: boolean; size?: string | number; justify?: string; align?: string; wrap?: boolean }>(), { wrap: true })
const attrs = useAttrs()
const style = computed(() => [{ gap: px(props.size), justifyContent: props.justify, alignItems: props.align }, attrs.style])
</script>

<template>
  <div v-bind="attrs" :class="['s-space', { vertical, nowrap: !wrap }]" :style="style">
    <slot />
  </div>
</template>

<style scoped>
.s-space { display: flex; align-items: flex-start; }
.s-space.vertical { flex-direction: column; align-items: stretch; }
.s-space.nowrap { flex-wrap: nowrap; }
.s-space:not(.nowrap) { flex-wrap: wrap; }
</style>
