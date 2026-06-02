<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SButton, SPageToolbar, useToast } from 'sbot-ui'
import { RightPanel, WebSocketTransport, PathPickerModal } from '@sbot/chat-ui'

const { t } = useI18n()
const { show } = useToast()

const STORAGE_KEY = 'explorer-root-path'
const root = ref<string>('')
const picker = ref<InstanceType<typeof PathPickerModal> | null>(null)
const transport = new WebSocketTransport()

// Mapping admin's i18n keys → chat-ui's flat ChatLabels surface so the panel
// renders in the same locale as the surrounding admin UI.
const panelLabels = computed(() => ({
  selectDirTitle: t('directory.select_dir_title'),
  myComputer: t('directory.my_computer'),
  upDir: t('directory.up_dir'),
  newFolder: t('directory.new_folder'),
  newFolderPlaceholder: t('directory.new_folder_placeholder'),
  selectThis: t('directory.select_this'),
  noSubdirs: t('directory.no_subdirs'),
  loading: t('common.loading'),
  cancel: t('common.cancel'),
  add: t('common.add'),
  close: t('common.close'),
  refresh: t('common.refresh'),
}))

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

    <RightPanel
      class="explorer-panel"
      mode="workbench"
      :transport="transport"
      :root="root"
      :labels="panelLabels"
      editable
    />

    <PathPickerModal
      ref="picker"
      :transport="transport"
      :labels="panelLabels"
      @confirm="onPicked"
      @error="msg => show(msg, 'error')"
    />
  </div>
</template>

<style scoped>
.explorer-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.explorer-panel {
  flex: 1;
  min-height: 0;
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
