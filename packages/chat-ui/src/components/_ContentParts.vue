<script setup lang="ts">
import { computed } from 'vue'
import { ContentPartType } from '../types'
import type { DisplayContent } from '../types'
import { getContentParts, renderMd } from '../messageRender'

const props = withDefaults(defineProps<{
  content: DisplayContent | null | undefined
  textClass?: string
  showAudio?: boolean
}>(), {
  textClass: 'md-content',
  showAudio: true,
})

const emit = defineEmits<{ openImage: [url: string] }>()

const parts = computed(() => getContentParts(props.content))
</script>

<template>
  <template v-for="(part, idx) in parts" :key="idx">
    <div v-if="part.type === ContentPartType.Text" :class="textClass" v-html="renderMd(part.text)" />
    <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
      <img :src="part.url" class="inline-image-thumb" @click="emit('openImage', part.url!)" />
    </div>
    <div v-else-if="part.type === ContentPartType.Audio && showAudio" class="inline-audio">
      <audio controls :src="part.url" />
    </div>
  </template>
</template>
