<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SButton, SPageToolbar } from 'sbot-ui'
import { Explorer, WebSocketTransport } from '@sbot/chat-ui'
import PathPickerModal from '@/views/chat/PathPickerModal.vue'

const { t } = useI18n()

const STORAGE_KEY = 'explorer-root-path'
const root = ref<string>('')
const picker = ref<InstanceType<typeof PathPickerModal> | null>(null)
const transport = new WebSocketTransport()

function openPicker() {
  picker.value?.open(root.value)
}

function onPicked(p: string) {
  root.value = p
  localStorage.setItem(STORAGE_KEY, p)
}

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) root.value = saved
})
</script>

<template>
  <div class="explorer-page">
    <SPageToolbar :title="t('explorer.title')">
      <span v-if="root" class="explorer-root-display">{{ root }}</span>
      <SButton type="outline" size="sm" @click="openPicker">
        {{ root ? t('explorer.change_root') : t('explorer.pick_root') }}
      </SButton>
    </SPageToolbar>

    <Explorer :transport="transport" :root="root" />

    <PathPickerModal ref="picker" @confirm="onPicked" />
  </div>
</template>

<style scoped>
.explorer-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.explorer-root-display {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
