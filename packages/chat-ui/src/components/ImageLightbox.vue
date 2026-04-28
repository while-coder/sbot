<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{ labels?: ChatLabels }>()
const L = computed(() => resolveLabels(props.labels))

const src = ref<string | null>(null)

function open(url: string) {
  src.value = url
}

function close() {
  src.value = null
}

function download() {
  if (!src.value) return
  const a = document.createElement('a')
  a.href = src.value
  const ext = src.value.startsWith('data:image/png') ? 'png' : 'jpg'
  a.download = `image_${Date.now()}.${ext}`
  a.click()
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="src" class="chatui-lightbox-overlay" @click.self="close">
      <div class="chatui-lightbox-content">
        <img :src="src" class="chatui-lightbox-img" />
        <div class="chatui-lb-actions">
          <button class="chatui-lb-btn" @click="download">⇣ {{ L.download }}</button>
          <button class="chatui-lb-btn" @click="close">✕ {{ L.close }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chatui-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.chatui-lightbox-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  cursor: default;
}
.chatui-lightbox-img {
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.chatui-lb-actions {
  display: flex;
  gap: 10px;
}
.chatui-lb-btn {
  padding: 6px 16px;
  font-size: 13px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: background 0.2s;
}
.chatui-lb-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>
