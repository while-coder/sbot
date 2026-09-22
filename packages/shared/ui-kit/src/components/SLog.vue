<script setup lang="ts">
import { computed, ref, useAttrs } from "vue"

defineOptions({ name: "SLog", inheritAttrs: false })
const props = withDefaults(defineProps<{ log?: string; lines?: unknown[] }>(), { lines: () => [] })
const attrs = useAttrs()

const element = ref<HTMLElement | null>(null)
defineExpose({
  element,
  scrollTo(options: { position?: string }) {
    const host = element.value
    if (!host) return
    if (options?.position === "bottom") host.scrollTop = host.scrollHeight
    else if (options?.position === "top") host.scrollTop = 0
  },
})

//纯文本行走一个文本节点，日志量大时最省；只有需要上色(带 tone)的行才逐行建元素
const hasObjectLines = computed(() => props.lines.some(line => line != null && typeof line === "object"))
const objectLines = computed(() => props.lines.map((line, index) => {
  const item = line as { text?: string; tone?: string }
  const tone = typeof item === "object" ? item.tone : undefined
  return { key: index, tone, text: String(typeof item === "object" ? item.text ?? "" : item) }
}))
</script>

<template>
  <pre v-bind="attrs" ref="element" class="s-log"><template v-if="log != null">{{ log }}</template><template v-else-if="!hasObjectLines">{{ lines.join("\n") }}</template><template v-else><div v-for="line in objectLines" :key="line.key" :class="['s-log-line', line.tone ? `tone-${line.tone}` : null]">{{ line.text }}</div></template></pre>
</template>

<style scoped>
/* 行样式 .s-log-line 在 style.css（BasicLogPane 也在自己 DOM 上复用，必须全局） */
.s-log { margin: 0; padding: 10px; overflow: auto; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-log-bg); color: var(--sui-log-fg); font-family: Consolas, Monaco, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
</style>
