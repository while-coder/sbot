<script setup lang="ts">
import { computed, useAttrs } from "vue"

const px = (value: string | number | undefined, fallback = 8) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

defineOptions({ name: "SFlex", inheritAttrs: false })
const props = withDefaults(defineProps<{ vertical?: boolean; size?: string | number; justify?: string; align?: string; wrap?: boolean }>(), { wrap: true })
const attrs = useAttrs()
const style = computed(() => [{ gap: px(props.size), justifyContent: props.justify, alignItems: props.align }, attrs.style])
</script>

<template>
  <div v-bind="attrs" :class="['s-flex', { vertical, nowrap: !wrap }]" :style="style">
    <slot />
  </div>
</template>

<style scoped>
.s-flex { display: flex; align-items: flex-start; }
.s-flex.vertical { flex-direction: column; align-items: stretch; }
.s-flex.nowrap { flex-wrap: nowrap; }
.s-flex:not(.nowrap) { flex-wrap: wrap; }
</style>
