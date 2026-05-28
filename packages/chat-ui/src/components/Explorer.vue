<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { STab, STabBar } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import {
  defaultExplorerViewState,
  loadExplorerViewState,
  mergeExplorerViewState,
  saveExplorerViewState,
  type ExplorerFilesViewState,
  type ExplorerGitViewState,
  type ExplorerViewState,
} from '../composables/useExplorerViewState'
import FileExplorer from './FileExplorer.vue'
import GitExplorer from './GitExplorer.vue'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const mode = ref<'files' | 'git'>('files')
const viewState = ref<ExplorerViewState>(defaultExplorerViewState())
const refreshKey = ref(0)
const refreshing = ref(false)
const gitCount = ref(0)
const gitBranch = ref('')

watch(mode, (value) => {
  refreshing.value = false
  persistViewState({ mode: value })
})

watch(() => props.root, (root) => {
  gitBranch.value = ''
  viewState.value = loadExplorerViewState(root)
  mode.value = viewState.value.mode
}, { immediate: true })

function persistViewState(patch: Partial<ExplorerViewState>) {
  if (!props.root) return
  viewState.value = mergeExplorerViewState(viewState.value, patch)
  saveExplorerViewState(props.root, viewState.value)
}

function updateFilesViewState(patch: Partial<ExplorerFilesViewState>) {
  persistViewState({ files: patch as ExplorerFilesViewState })
}

function updateGitViewState(patch: Partial<ExplorerGitViewState>) {
  persistViewState({ git: patch as ExplorerGitViewState })
}

function updateTreeWidth(value: number) {
  persistViewState({ treeWidth: value })
}

function updateTreeHeight(value: number) {
  persistViewState({ treeHeight: value })
}

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
    <div
      class="chatui-explorer-root"
      :title="mode === 'git' && gitBranch ? `${props.root || L.explorerNoRoot}  ${L.explorerGitBranch}: ${gitBranch}` : props.root || L.explorerNoRoot"
    >
      <span class="chatui-explorer-root-path">{{ props.root || L.explorerNoRoot }}</span>
      <span v-if="mode === 'git' && gitBranch" class="chatui-explorer-root-branch">
        {{ gitBranch }}
      </span>
    </div>

    <FileExplorer
      v-if="mode === 'files'"
      :transport="transport"
      :root="root"
      :labels="labels"
      :refresh-key="refreshKey"
      :tree-width="viewState.treeWidth"
      :tree-height="viewState.treeHeight"
      :view-state="viewState.files"
      @refreshing="refreshing = $event"
      @tree-width="updateTreeWidth"
      @tree-height="updateTreeHeight"
      @view-state="updateFilesViewState"
    />
    <GitExplorer
      v-else
      :transport="transport"
      :root="root"
      :labels="labels"
      :refresh-key="refreshKey"
      :tree-width="viewState.treeWidth"
      :tree-height="viewState.treeHeight"
      :view-state="viewState.git"
      @count="gitCount = $event"
      @branch="gitBranch = $event"
      @refreshing="refreshing = $event"
      @tree-width="updateTreeWidth"
      @tree-height="updateTreeHeight"
      @view-state="updateGitViewState"
    />
  </div>
</template>

<style scoped>
.chatui-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-explorer > :deep(.chatui-file-explorer),
.chatui-explorer > :deep(.chatui-git-explorer) {
  flex: 1 1 0;
  min-height: 0;
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
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  color: var(--chatui-fg-secondary);
  font-family: monospace;
  font-size: 11px;
  flex-shrink: 0;
}
.chatui-explorer-root-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatui-explorer-root-branch {
  max-width: 120px;
  height: 16px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--chatui-border);
  border-radius: 3px;
  background: var(--chatui-bg);
  color: var(--chatui-fg);
  font-weight: 600;
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
