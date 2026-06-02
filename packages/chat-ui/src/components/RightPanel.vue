<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import Terminal from './Terminal.vue'

type ViewType = 'files' | 'git' | 'terminal'

interface ViewTab {
  id: string
  type: ViewType
  /** Display title shown in the tab strip (used for multi-instance views like terminals). */
  title?: string
}

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
  editable?: boolean
}>()

const L = computed(() => resolveLabels(props.labels))

const tabs = ref<ViewTab[]>([])
const activeTabId = ref<string>('')
const addMenuOpen = ref(false)
const containerEl = ref<HTMLElement | null>(null)

const viewState = ref<ExplorerViewState>(defaultExplorerViewState())
const refreshKey = ref(0)
const refreshing = ref(false)
const gitCount = ref(0)
const gitBranch = ref('')

let nextTabSeq = 0
let nextTerminalSeq = 0

interface ViewDef {
  label: () => string
  /** Allow multiple tabs of this type at once. */
  multi: boolean
  /** Whether this view uses the shared root path bar / refresh button. */
  rooted: boolean
}

const VIEW_DEFS: Record<ViewType, ViewDef> = {
  files:    { label: () => L.value.explorerFiles, multi: false, rooted: true  },
  git:      { label: () => L.value.explorerGit,   multi: false, rooted: true  },
  terminal: { label: () => L.value.terminal,      multi: true,  rooted: false },
}

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)

const availableTypes = computed<ViewType[]>(() => {
  const singletons = new Set(tabs.value.filter(t => !VIEW_DEFS[t.type].multi).map(t => t.type))
  return (Object.keys(VIEW_DEFS) as ViewType[]).filter(t => VIEW_DEFS[t].multi || !singletons.has(t))
})

const showRoot = computed(() => Boolean(activeTab.value && props.root && VIEW_DEFS[activeTab.value.type].rooted))
const showRefresh = computed(() => Boolean(activeTab.value && VIEW_DEFS[activeTab.value.type].rooted))

function tabLabel(tab: ViewTab): string {
  return tab.title ?? VIEW_DEFS[tab.type].label()
}

watch(() => props.root, (root) => {
  gitBranch.value = ''
  viewState.value = loadExplorerViewState(root)
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

function addTab(type: ViewType) {
  if (!availableTypes.value.includes(type)) return
  const id = `${type}-${++nextTabSeq}`
  const tab: ViewTab = { id, type }
  if (type === 'terminal') tab.title = `${L.value.terminal} ${++nextTerminalSeq}`
  tabs.value.push(tab)
  activeTabId.value = id
  addMenuOpen.value = false
}

function selectTab(id: string) {
  if (activeTabId.value !== id) {
    activeTabId.value = id
    refreshing.value = false
  }
}

function closeTab(id: string) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[idx]?.id ?? tabs.value[idx - 1]?.id ?? ''
    refreshing.value = false
  }
}

function toggleAddMenu() {
  addMenuOpen.value = !addMenuOpen.value
}

function onDocClick(e: MouseEvent) {
  if (!addMenuOpen.value) return
  if (!containerEl.value?.contains(e.target as Node)) addMenuOpen.value = false
}

watch(addMenuOpen, (open) => {
  if (open) document.addEventListener('mousedown', onDocClick)
  else document.removeEventListener('mousedown', onDocClick)
})
</script>

<template>
  <div ref="containerEl" class="chatui-right-panel">
    <div class="chatui-rp-tabs">
      <div class="chatui-rp-tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="chatui-rp-tab"
          :class="{ 'chatui-rp-tab--active': tab.id === activeTabId }"
          :title="tabLabel(tab)"
          @click="selectTab(tab.id)"
        >
          <span class="chatui-rp-tab-label">{{ tabLabel(tab) }}</span>
          <span
            class="chatui-rp-tab-close"
            :title="L.close"
            role="button"
            @click.stop="closeTab(tab.id)"
          >×</span>
        </button>
      </div>
      <div class="chatui-rp-actions">
        <button
          v-if="showRefresh && props.root"
          type="button"
          class="chatui-rp-action"
          :class="{ 'chatui-rp-action--spinning': refreshing }"
          :disabled="refreshing"
          :title="L.refresh"
          @click="refresh"
        >↻</button>
        <div class="chatui-rp-add-wrap">
          <button
            type="button"
            class="chatui-rp-action chatui-rp-add"
            :class="{ 'chatui-rp-action--active': addMenuOpen }"
            :disabled="availableTypes.length === 0"
            :title="L.add"
            @click="toggleAddMenu"
          >+</button>
          <div v-if="addMenuOpen && availableTypes.length > 0" class="chatui-rp-menu">
            <button
              v-for="type in availableTypes"
              :key="type"
              type="button"
              class="chatui-rp-menu-item"
              @click="addTab(type)"
            >
              {{ VIEW_DEFS[type].label() }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showRoot"
      class="chatui-rp-root"
      :title="activeTab?.type === 'git' && gitBranch ? `${props.root}  ${L.explorerGitBranch}: ${gitBranch}` : props.root"
    >
      <span class="chatui-rp-root-path">{{ props.root }}</span>
      <span v-if="activeTab?.type === 'git' && gitBranch" class="chatui-rp-root-branch">
        {{ gitBranch }}
      </span>
    </div>

    <div v-if="!activeTab" class="chatui-rp-empty">
      <div class="chatui-rp-empty-text">{{ L.rightPanelToggle }}</div>
      <button
        v-if="availableTypes.length > 0"
        type="button"
        class="chatui-rp-empty-add"
        @click="toggleAddMenu"
      >＋ {{ L.add }}</button>
    </div>

    <!--
      All open tabs render simultaneously, gated by v-show. This is what keeps
      a terminal session alive when the user briefly switches to Files/Git and
      back; unmounting would kill the pty.
    -->
    <template v-for="tab in tabs" :key="tab.id">
      <FileExplorer
        v-if="tab.type === 'files'"
        v-show="tab.id === activeTabId"
        :transport="transport"
        :root="root"
        :labels="labels"
        :refresh-key="refreshKey"
        :tree-width="viewState.treeWidth"
        :tree-height="viewState.treeHeight"
        :view-state="viewState.files"
        :editable="props.editable"
        @refreshing="refreshing = $event"
        @tree-width="updateTreeWidth"
        @tree-height="updateTreeHeight"
        @view-state="updateFilesViewState"
      />
      <GitExplorer
        v-else-if="tab.type === 'git'"
        v-show="tab.id === activeTabId"
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
      <Terminal
        v-else-if="tab.type === 'terminal'"
        v-show="tab.id === activeTabId"
        :transport="transport"
        :cwd="root"
        :labels="labels"
      />
    </template>
  </div>
</template>

<style scoped>
.chatui-right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-right-panel > :deep(.chatui-file-explorer),
.chatui-right-panel > :deep(.chatui-git-explorer) {
  flex: 1 1 0;
  min-height: 0;
}

/* Tab bar */
.chatui-rp-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 4px 6px 0;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-rp-tablist {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.chatui-rp-tablist::-webkit-scrollbar { display: none; }

.chatui-rp-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  max-width: 180px;
  padding: 0 6px 0 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--chatui-fg-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chatui-rp-tab:hover:not(.chatui-rp-tab--active) {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-rp-tab--active {
  background: var(--chatui-bg);
  color: var(--chatui-fg);
  border-color: var(--chatui-border);
  margin-bottom: -1px;
}
.chatui-rp-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.chatui-rp-tab-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  border-radius: 3px;
  color: inherit;
  opacity: 0.55;
  flex-shrink: 0;
}
.chatui-rp-tab-close:hover {
  background: var(--chatui-bg-active);
  opacity: 1;
}

/* Actions on the right */
.chatui-rp-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-bottom: 2px;
}
.chatui-rp-action {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--chatui-fg-secondary);
  font-size: 14px;
  line-height: 1;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.chatui-rp-action:hover:not(:disabled) {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-rp-action:disabled {
  cursor: default;
  opacity: 0.45;
}
.chatui-rp-action--active {
  background: var(--chatui-bg-active);
  color: var(--chatui-fg);
}
.chatui-rp-action--spinning {
  animation: chatui-rp-spin 0.8s linear infinite;
}
@keyframes chatui-rp-spin {
  to { transform: rotate(360deg); }
}
.chatui-rp-add {
  font-size: 16px;
  font-weight: 600;
}

/* Add menu */
.chatui-rp-add-wrap {
  position: relative;
}
.chatui-rp-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  z-index: 50;
  border: 1px solid var(--chatui-border);
  border-radius: 6px;
  background: var(--chatui-bg-surface);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.chatui-rp-menu-item {
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: var(--chatui-fg);
}
.chatui-rp-menu-item:hover {
  background: var(--chatui-bg-hover);
}

/* Root path bar */
.chatui-rp-root {
  width: 100%;
  padding: 4px 10px 5px;
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
.chatui-rp-root-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatui-rp-root-branch {
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

/* Empty state */
.chatui-rp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--chatui-fg-secondary);
  font-size: 12px;
}
.chatui-rp-empty-text {
  opacity: 0.7;
}
.chatui-rp-empty-add {
  padding: 6px 14px;
  border: 1px solid var(--chatui-border);
  border-radius: 6px;
  background: var(--chatui-bg-surface);
  cursor: pointer;
  color: var(--chatui-fg);
  font: inherit;
  font-size: 12px;
}
.chatui-rp-empty-add:hover {
  background: var(--chatui-bg-hover);
}
</style>
