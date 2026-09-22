<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SInfoRow", inheritAttrs: false })
const props = defineProps<{ label?: string; mono?: boolean }>()
const attrs = useAttrs()
</script>

<template>
  <tr v-bind="attrs" class="s-info-row">
    <td class="s-info-row-label">
      <slot name="label">{{ label }}</slot>
    </td>
    <td class="s-info-row-value" :class="{ mono: props.mono }">
      <slot />
    </td>
  </tr>
</template>

<style scoped>
/* 样式由 SInfoTable 通过 .s-info-table .s-info-row-* 统一控制 */
</style>
