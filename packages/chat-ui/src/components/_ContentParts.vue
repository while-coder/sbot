<script setup lang="ts">
import { computed } from 'vue'
import { ContentPartType } from '../types'
import type { DisplayContent, DisplayPart } from '../types'
import { getContentParts, renderMd } from '../messageRender'

type RenderedDisplayPart = DisplayPart & { html?: string }

const props = withDefaults(defineProps<{
  content: DisplayContent | null | undefined
  textClass?: string
  showAudio?: boolean
}>(), {
  textClass: 'md-content',
  showAudio: true,
})

const emit = defineEmits<{ openImage: [url: string] }>()

const renderedParts = computed<RenderedDisplayPart[]>(() =>
  getContentParts(props.content).map((part) => (
    part.type === ContentPartType.Text
      ? { ...part, html: renderMd(part.text ?? '') }
      : part
  )),
)
</script>

<template>
  <template v-for="(part, idx) in renderedParts" :key="idx">
    <div v-if="part.type === ContentPartType.Text" :class="textClass" v-html="part.html" />
    <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
      <img :src="part.url" class="inline-image-thumb" @click="emit('openImage', part.url!)" />
    </div>
    <div v-else-if="part.type === ContentPartType.Audio && showAudio" class="inline-audio">
      <audio controls :src="part.url" />
    </div>
  </template>
</template>
