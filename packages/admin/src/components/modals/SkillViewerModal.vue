<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast, SModal, SButton } from 'sbot-ui'
import { FileExplorer, WebSocketTransport } from '@sbot/chat-ui'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

const visible = ref(false)
const skillName = ref('')
const skillBadge = ref('')
const skillRootId = ref('')
const viewerKey = ref(0)
const transport = new WebSocketTransport()
const initialViewState = { expandedPaths: [], selectedPath: 'SKILL.md' }

function open(name: string, badge: string, rootId: string) {
  if (!rootId) {
    show('Missing skill file root id', 'error')
    return
  }
  skillName.value = name
  skillBadge.value = badge
  skillRootId.value = rootId
  viewerKey.value += 1
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div style="display:flex;align-items:center;gap:8px">
        <span v-if="skillBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(skillBadge)}`">{{ skillBadge }}</span>
        <h3 class="s-modal-title" style="font-family:var(--sui-font-mono)">{{ skillName }}</h3>
      </div>
    </template>

    <div class="skill-viewer-body">
      <FileExplorer
        :key="viewerKey"
        :transport="transport"
        :root-id="skillRootId"
        :view-state="initialViewState"
      />
    </div>

    <template #footer>
      <SButton type="outline" @click="close">{{ t('common.close') }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.skill-viewer-body {
  height: 70vh;
  display: flex;
  min-height: 0;
  overflow: hidden;
  margin: calc(-1 * var(--sui-sp-7)) calc(-1 * var(--sui-sp-8));
}
</style>
