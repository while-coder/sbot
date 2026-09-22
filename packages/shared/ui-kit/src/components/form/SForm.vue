<script setup lang="ts">
import { useAttrs } from "vue"

const px = (value: string | number | undefined, fallback = 8) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

defineOptions({ name: "SForm", inheritAttrs: false })
defineProps<{ labelPlacement?: string; labelWidth?: string | number; size?: string }>()
const attrs = useAttrs()
</script>

<template>
  <form v-bind="attrs" :class="['s-form', `labels-${labelPlacement ?? 'top'}`]"
    :style="[{ '--s-form-label-width': px(labelWidth as any, 100) }, attrs.style]" @submit.prevent>
    <slot />
  </form>
</template>

<style scoped>
.s-form { display: flex; flex-direction: column; gap: 12px; }
/* .s-form-item 是 SFormItem 的根元素（子组件根会带父组件 scope id），可以命中 */
.s-form.labels-left .s-form-item { grid-template-columns: var(--s-form-label-width) minmax(0, 1fr); align-items: center; }
@media (max-width: 720px) {
  .s-form.labels-left .s-form-item { grid-template-columns: 1fr; }
}
</style>
