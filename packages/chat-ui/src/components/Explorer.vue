<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { STab, STabBar } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import FileExplorer from './FileExplorer.vue'
import GitExplorer from './GitExplorer.vue'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const mode = ref<'files' | 'git'>('files')
const refreshKey = ref(0)
const refreshing = ref(false)
const gitCount = ref(0)

watch(mode, () => {
  refreshing.value = false
})

function refresh() {
  if (!props.root || refreshing.value) return
  refreshing.value = true
  refreshKey.value += 1
}
</script>

<template>
  <div class="chatui-explorer">
    <div class="chatui-explorer-header">
      <STabBar v-model="mode" class="chatui-explorer-tabs">
        <STab name="files">{{ L.explorerFiles }}</STab>
        <STab name="git" :count="gitCount || ''">{{ L.explorerGit }}</STab>
      </STabBar>
      <button
        v-if="props.root"
        class="chatui-explorer-refresh"
        :class="{ 'chatui-explorer-refresh--spinning': refreshing }"
        :disabled="refreshing"
        :title="L.refresh"
        @click="refresh"
      >↻</button>
    </div>
    <div class="chatui-explorer-root" :title="props.root || L.explorerNoRoot">
      {{ props.root || L.explorerNoRoot }}
    </div>

    <FileExplorer
      v-if="mode === 'files'"
      :transport="transport"
      :root="root"
      :labels="labels"
      :refresh-key="refreshKey"
      @refreshing="refreshing = $event"
    />
    <GitExplorer
      v-else
      :transport="transport"
      :root="root"
      :labels="labels"
      :refresh-key="refreshKey"
      @count="gitCount = $event"
      @refreshing="refreshing = $event"
    />
  </div>
</template>

<style scoped>
.chatui-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-explorer-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 4px 8px 2px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-explorer-tabs {
  flex: 1;
  min-width: 0;
  padding: 0;
  border-bottom: none;
  background: transparent;
}
.chatui-explorer-tabs :deep(.s-tab) {
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}
.chatui-explorer-tabs :deep(.s-tab__count) {
  min-width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chatui-explorer-root {
  width: 100%;
  padding: 0 10px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg-secondary);
  font-family: monospace;
  font-size: 11px;
  flex-shrink: 0;
}
.chatui-explorer-refresh {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--chatui-fg-secondary);
  font-size: 14px;
  line-height: 1;
  border-radius: 3px;
  transition: background 0.15s, color 0.15s;
}
.chatui-explorer-refresh:hover:not(:disabled) {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-refresh:disabled {
  cursor: default;
  opacity: 0.6;
}
.chatui-explorer-refresh--spinning {
  animation: chatui-explorer-spin 0.8s linear infinite;
}
@keyframes chatui-explorer-spin {
  to { transform: rotate(360deg); }
}
</style>
