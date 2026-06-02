<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
  /**
   * Captured at creation time in workbench mode so subsequent changes to the
   * panel-level default root don't yank the rug from under existing tabs.
   * Falls back to props.root in session mode.
   */
  root?: string
  title?: string
  /** Cached so we can show "● 5" in the Git tab strip. */
  gitCount?: number
  /** Cached so the root bar can show the current branch when this tab is active. */
  gitBranch?: string
  /** Per-tab refresh tick so refresh button only re-fetches the active tab. */
  refreshKey?: number
  refreshing?: boolean
}

const props = withDefaults(defineProps<{
  transport: IChatTransport
  /**
   * In session mode this is the single root for files/git/terminal.
   * In workbench mode this becomes the *default* root applied to newly added tabs;
   * existing tabs keep whatever root they captured at creation time.
   */
  root?: string
  labels?: ChatLabels
  editable?: boolean
  /** session = singletons + shared root (ChatView). workbench = multi + per-tab root (ExplorerView). */
  mode?: 'session' | 'workbench'
}>(), {
  mode: 'session',
})

const L = computed(() => resolveLabels(props.labels))

const tabs = ref<ViewTab[]>([])
const activeTabId = ref<string>('')
const addMenuOpen = ref(false)
const containerEl = ref<HTMLElement | null>(null)

/**
 * Per-root view-state cache. Keyed by root path so multiple workbench tabs
 * pointing at the same root share state, while different roots stay isolated.
 * loadExplorerViewState already reads from localStorage by root, so we just
 * ensure each unique root is fetched once.
 */
const viewStates = reactive<Map<string, ExplorerViewState>>(new Map())

let nextTabSeq = 0
let nextTerminalSeq = 0

interface ViewDef {
  label: () => string
  multi: (mode: 'session' | 'workbench') => boolean
  rooted: boolean
}

const VIEW_DEFS: Record<ViewType, ViewDef> = {
  files:    { label: () => L.value.explorerFiles, multi: m => m === 'workbench', rooted: true  },
  git:      { label: () => L.value.explorerGit,   multi: m => m === 'workbench', rooted: true  },
  terminal: { label: () => L.value.terminal,      multi: () => true,             rooted: false },
}

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)
const activeRoot = computed(() => activeTab.value?.root ?? props.root)

const availableTypes = computed<ViewType[]>(() => {
  const singletons = new Set(
    tabs.value.filter(t => !VIEW_DEFS[t.type].multi(props.mode)).map(t => t.type),
  )
  return (Object.keys(VIEW_DEFS) as ViewType[])
    .filter(t => VIEW_DEFS[t].multi(props.mode) || !singletons.has(t))
})

const showRoot = computed(() => Boolean(activeTab.value && activeRoot.value && VIEW_DEFS[activeTab.value.type].rooted))
const showRefresh = computed(() => Boolean(activeTab.value && VIEW_DEFS[activeTab.value.type].rooted))

function basename(p: string): string {
  if (!p) return ''
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

function tabLabel(tab: ViewTab): string {
  if (tab.title) return tab.title
  const base = VIEW_DEFS[tab.type].label()
  // In workbench mode, suffix the path basename so multiple Files/Git tabs are
  // distinguishable at a glance.
  if (props.mode === 'workbench' && tab.root && VIEW_DEFS[tab.type].rooted) {
    const name = basename(tab.root)
    if (name) return `${base} · ${name}`
  }
  return base
}

function tabTooltip(tab: ViewTab): string {
  return tab.root ? `${tabLabel(tab)}\n${tab.root}` : tabLabel(tab)
}

function getViewState(root: string | undefined): ExplorerViewState {
  if (!root) return defaultExplorerViewState()
  let state = viewStates.get(root)
  if (!state) {
    state = loadExplorerViewState(root)
    viewStates.set(root, state)
  }
  return state
}

function persistViewState(root: string | undefined, patch: Partial<ExplorerViewState>) {
  if (!root) return
  const next = mergeExplorerViewState(getViewState(root), patch)
  viewStates.set(root, next)
  saveExplorerViewState(root, next)
}

function refresh() {
  const tab = activeTab.value
  if (!tab || tab.refreshing) return
  if (VIEW_DEFS[tab.type].rooted && !(tab.root ?? props.root)) return
  tab.refreshing = true
  tab.refreshKey = (tab.refreshKey ?? 0) + 1
}

function addTab(type: ViewType) {
  if (!availableTypes.value.includes(type)) return
  const id = `${type}-${++nextTabSeq}`
  const tab: ViewTab = {
    id,
    type,
    root: VIEW_DEFS[type].rooted || type === 'terminal' ? props.root : undefined,
    refreshKey: 0,
    refreshing: false,
  }
  if (type === 'terminal') tab.title = `${L.value.terminal} ${++nextTerminalSeq}`
  tabs.value.push(tab)
  activeTabId.value = id
  addMenuOpen.value = false
}

function selectTab(id: string) {
  if (activeTabId.value !== id) activeTabId.value = id
}

function closeTab(id: string) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[idx]?.id ?? tabs.value[idx - 1]?.id ?? ''
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

// Session mode: keep tabs synced when the bound root changes.
watch(() => props.root, (root) => {
  if (props.mode !== 'session') return
  for (const tab of tabs.value) {
    if (VIEW_DEFS[tab.type].rooted || tab.type === 'terminal') tab.root = root
    tab.gitBranch = ''
  }
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
          :title="tabTooltip(tab)"
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
          v-if="showRefresh && activeRoot"
          type="button"
          class="chatui-rp-action"
          :class="{ 'chatui-rp-action--spinning': activeTab?.refreshing }"
          :disabled="activeTab?.refreshing"
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
      v-if="showRoot && activeRoot"
      class="chatui-rp-root"
      :title="activeTab?.type === 'git' && activeTab?.gitBranch ? `${activeRoot}  ${L.explorerGitBranch}: ${activeTab.gitBranch}` : activeRoot"
    >
      <span class="chatui-rp-root-path">{{ activeRoot }}</span>
      <span v-if="activeTab?.type === 'git' && activeTab?.gitBranch" class="chatui-rp-root-branch">
        {{ activeTab.gitBranch }}
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
        :root="tab.root"
        :labels="labels"
        :refresh-key="tab.refreshKey"
        :tree-width="getViewState(tab.root).treeWidth"
        :tree-height="getViewState(tab.root).treeHeight"
        :view-state="getViewState(tab.root).files"
        :editable="props.editable"
        @refreshing="tab.refreshing = $event"
        @tree-width="persistViewState(tab.root, { treeWidth: $event })"
        @tree-height="persistViewState(tab.root, { treeHeight: $event })"
        @view-state="persistViewState(tab.root, { files: $event as ExplorerFilesViewState })"
      />
      <GitExplorer
        v-else-if="tab.type === 'git'"
        v-show="tab.id === activeTabId"
        :transport="transport"
        :root="tab.root"
        :labels="labels"
        :refresh-key="tab.refreshKey"
        :tree-width="getViewState(tab.root).treeWidth"
        :tree-height="getViewState(tab.root).treeHeight"
        :view-state="getViewState(tab.root).git"
        @count="tab.gitCount = $event"
        @branch="tab.gitBranch = $event"
        @refreshing="tab.refreshing = $event"
        @tree-width="persistViewState(tab.root, { treeWidth: $event })"
        @tree-height="persistViewState(tab.root, { treeHeight: $event })"
        @view-state="persistViewState(tab.root, { git: $event as ExplorerGitViewState })"
      />
      <Terminal
        v-else-if="tab.type === 'terminal'"
        v-show="tab.id === activeTabId"
        :transport="transport"
        :cwd="tab.root"
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
