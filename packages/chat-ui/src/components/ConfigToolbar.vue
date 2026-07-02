<script setup lang="ts">
import { computed } from 'vue'
import { SMultiSelect } from 'sbot-ui'
import type { SessionItem, AppSettings, ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import { useCompact } from '../composables/useCompact'

const isCompact = useCompact()

const props = defineProps<{
  session: SessionItem | null
  settings: AppSettings
  labels?: ChatLabels
}>()

const emit = defineEmits<{
  updateConfig: [field: string, value: any]
  openPathPicker: [currentPath: string]
}>()

const L = computed(() => resolveLabels(props.labels))

function toMSOptions<T extends { name?: string }>(map: Record<string, T> | undefined) {
  return Object.entries(map || {}).map(([id, v]) => ({ id, label: v.name || id }))
}

const noteOptions = computed(() => toMSOptions(props.settings.notes))
const wikiOptions = computed(() => toMSOptions(props.settings.wikis))
</script>

<template>
  <div class="chatui-config-toolbar" :class="{ 'chatui-compact': isCompact }">
    <template v-if="session">
      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.note }}</label>
        <SMultiSelect
          :model-value="session.notes || []"
          :options="noteOptions"
          compact
          style="min-width:140px"
          @update:model-value="emit('updateConfig', 'notes', $event)"
        />
      </div>

      <div class="chatui-toolbar-sep" />

      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.wiki }}</label>
        <SMultiSelect
          :model-value="session.wikis || []"
          :options="wikiOptions"
          compact
          style="min-width:140px"
          @update:model-value="emit('updateConfig', 'wikis', $event)"
        />
      </div>
    </template>
    <span v-else class="chatui-toolbar-placeholder">{{ L.selectOrCreate }}</span>
  </div>
</template>

<style scoped>
.chatui-config-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; flex-wrap: wrap;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface); flex-shrink: 0;
}
.chatui-toolbar-group { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.chatui-toolbar-label {
  font-size: 11px; font-weight: 600; color: var(--chatui-fg-secondary);
  text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
}
.chatui-toolbar-sep {
  width: 1px; height: 18px; background: var(--chatui-border); flex-shrink: 0;
}
.chatui-toolbar-clear {
  background: none; border: none; cursor: pointer;
  color: var(--chatui-btn-danger); font-size: 14px;
  padding: 0 4px; line-height: 1;
}
.chatui-toolbar-placeholder { font-size: 13px; color: var(--chatui-fg-secondary); }

.chatui-config-toolbar.chatui-compact {
  align-items: stretch;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 8px;
}
.chatui-compact .chatui-toolbar-sep { display: none; }
.chatui-compact .chatui-toolbar-group {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto auto;
  align-items: center;
  width: 100%;
  gap: 6px;
  flex-shrink: 1;
}
.chatui-compact .chatui-toolbar-group--toggle {
  display: flex;
  margin-left: 0 !important;
  min-height: 28px;
}
.chatui-compact .chatui-toolbar-label {
  text-align: right;
}
.chatui-compact :deep(.s-select),
.chatui-compact :deep(.s-input),
.chatui-compact :deep(.s-ms) {
  width: 100%;
  min-width: 0 !important;
  max-width: none !important;
}
.chatui-compact :deep(.s-ms-trigger) {
  width: 100%;
}
.chatui-compact .chatui-toolbar-clear {
  min-width: 24px;
  min-height: 24px;
}
</style>
