<script setup lang="ts">
import { computed, useAttrs } from "vue"

const px = (value: string | number | undefined, fallback = 8) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

defineOptions({ name: "SGrid", inheritAttrs: false })
const props = withDefaults(defineProps<{ cols?: number; xGap?: string | number; yGap?: string | number }>(), { cols: 1 })
const attrs = useAttrs()
const style = computed(() => [
  { gridTemplateColumns: `repeat(${props.cols}, minmax(0, 1fr))`, columnGap: px(props.xGap), rowGap: px(props.yGap) },
  attrs.style,
])
</script>

<template>
  <div v-bind="attrs" class="s-grid" :style="style">
    <slot />
  </div>
</template>

<style scoped>
.s-grid { display: grid; }
@media (max-width: 720px) {
  .s-grid { grid-template-columns: 1fr !important; }
}
</style>
