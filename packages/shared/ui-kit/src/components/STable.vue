<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "STable", inheritAttrs: false })
defineProps<{ bordered?: boolean; size?: string }>()
const attrs = useAttrs()
</script>

<template>
  <div class="s-table-wrap">
    <table v-bind="attrs" :class="['s-table', `size-${size ?? 'medium'}`, { bordered }]">
      <slot />
    </table>
  </div>
</template>

<style scoped>
/* .s-table 基础样式在 style.css（与 SDataTable 共用），这里只放 STable 特有的包裹层 */
.s-table-wrap { width: 100%; overflow: auto; }
</style>
