<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast, SModal, SButton } from 'sbot-ui'
import { FileExplorer, WebSocketTransport } from '@sbot/chat-ui'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

const visible = ref(false)
const skillName = ref('')
const skillBadge = ref('')
const skillPath = ref('')
const viewerKey = ref(0)
const transport = new WebSocketTransport()
const initialViewState = computed(() => ({
  expandedPaths: [],
  selectedPath: skillPath.value ? `${skillPath.value.replace(/[\\/]+$/, '')}${skillPath.value.includes('\\') ? '\\' : '/'}SKILL.md` : '',
}))

function open(name: string, badge: string, path: string) {
  if (!path) {
    show('Missing skill path', 'error')
    return
  }
  skillName.value = name
  skillBadge.value = badge
  skillPath.value = path
  viewerKey.value += 1
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <SModal v-model:visible="visible" width="xl" class="skill-viewer-modal-box">
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
        :root="skillPath"
        :view-state="initialViewState"
        editable
      />
    </div>

    <template #footer>
      <SButton type="outline" @click="close">{{ t('common.close') }}</SButton>
    </template>
  </SModal>
</template>

<style>
.s-modal-box.skill-viewer-modal-box {
  height: 88vh;
}
.s-modal-box.skill-viewer-modal-box > .s-modal-body {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.s-modal-box.skill-viewer-modal-box > .s-modal-body > .skill-viewer-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
