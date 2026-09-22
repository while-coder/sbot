<script setup lang="ts">
import { computed, useAttrs, useSlots } from "vue"

defineOptions({ name: "SEllipsis", inheritAttrs: false })
const attrs = useAttrs()
const slots = useSlots()

//内容是纯文本时才原生 title 提示，其他内容（嵌套元素等）不猜
const title = computed(() => {
  const children = slots.default?.()[0]?.children
  return typeof children === "string" ? children : undefined
})
</script>

<template>
  <span v-bind="attrs" class="s-ellipsis" :title="title">
    <slot />
  </span>
</template>

<style scoped>
.s-ellipsis { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
