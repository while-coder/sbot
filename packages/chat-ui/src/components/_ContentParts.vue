<script setup lang="ts">
import { computed } from 'vue'
import { ContentPartType } from '../types'
import type { DisplayContent, DisplayPart } from '../types'
import { getContentParts, renderMd } from '../messageRender'

type RenderedDisplayPart = DisplayPart & { html?: string; text?: string }

const props = withDefaults(defineProps<{
  content: DisplayContent | null | undefined
  textClass?: string
  showAudio?: boolean
  /** 关闭 markdown 渲染，按纯文本显示（保留换行） */
  plain?: boolean
}>(), {
  textClass: 'md-content',
  showAudio: true,
  plain: false,
})

const emit = defineEmits<{ openImage: [url: string] }>()

const renderedParts = computed<RenderedDisplayPart[]>(() =>
  getContentParts(props.content).map((part) => {
    if (part.type !== ContentPartType.Text) return part
    if (props.plain) return { ...part, text: part.text ?? '' }
    return { ...part, html: renderMd(part.text ?? '') }
  }),
)
</script>

<template>
  <template v-for="(part, idx) in renderedParts" :key="idx">
    <div v-if="part.type === ContentPartType.Text && plain" :class="['plain-content', textClass]">{{ part.text }}</div>
    <div v-else-if="part.type === ContentPartType.Text" :class="textClass" v-html="part.html" />
    <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
      <img :src="part.url" class="inline-image-thumb" @click="emit('openImage', part.url!)" />
    </div>
    <div v-else-if="part.type === ContentPartType.Audio && showAudio" class="inline-audio">
      <audio controls :src="part.url" />
    </div>
  </template>
</template>

<style scoped>
.plain-content {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
