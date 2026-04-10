<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
    <div v-if="src" class="lightbox-overlay" @click.self="close">
      <div class="lightbox-content">
        <img :src="src" class="lightbox-img" />
        <div class="lb-actions">
          <button class="lb-btn" @click="download">⇣ {{ t('common.download') }}</button>
          <button class="lb-btn" @click="close">✕ {{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-actions {
  display: flex;
  gap: 10px;
}
.lb-btn {
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
.lb-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>
