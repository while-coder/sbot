<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SEmpty", inheritAttrs: false })
const props = withDefaults(defineProps<{ description?: string; size?: string }>(), { description: "暂无数据" })
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="s-empty">
    <slot>{{ props.description }}</slot>
  </div>
</template>
