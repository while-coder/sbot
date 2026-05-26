<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { SBadge, STab, STabBar, STree, STreeNode, SSwitch } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, GitStatusItem } from '../types'
import type { ExplorerGitViewState } from '../composables/useExplorerViewState'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
  refreshKey?: number
  treeWidth?: number
  treeHeight?: number
  viewState?: ExplorerGitViewState
}>()

const emit = defineEmits<{
  count: [value: number]
  branch: [value: string]
  refreshing: [value: boolean]
  'tree-width': [value: number]
  'tree-height': [value: number]
  'view-state': [value: Partial<ExplorerGitViewState>]
}>()

const L = computed(() => resolveLabels(props.labels))

const gitItems = ref<GitStatusItem[]>([])
const gitLoading = ref(false)
const gitDiffLoading = ref(false)
const gitErrMsg = ref('')
const selectedGitPath = ref('')
const selectedGitStatus = ref('')
const selectedGitKind = ref('')
const gitDiff = ref('')
const diffViewMode = ref<'unified' | 'split'>(props.viewState?.diffViewMode ?? 'unified')
const showFullDiff = ref(props.viewState?.showFullDiff ?? false)
const explorerEl = ref<HTMLElement | null>(null)
const treeWidth = ref(props.treeWidth ?? 260)
const treeHeight = ref(props.treeHeight ?? 220)
const resizing = ref(false)
const resizeMode = ref<'horizontal' | 'vertical'>('horizontal')

const treeStyle = computed(() =>
  resizeMode.value === 'vertical'
    ? { height: `${treeHeight.value}px` }
    : { width: `${treeWidth.value}px` },
)

const gitDiffLines = computed(() => gitDiff.value ? gitDiff.value.replace(/\r?\n$/, '').split(/\r?\n/) : [])

type SplitDiffRow = {
  oldNo?: number
  newNo?: number
  oldText: string
  newText: string
  type: 'context' | 'add' | 'del' | 'change' | 'hunk' | 'meta'
}

type UnifiedDiffRow = {
  oldNo?: number
  newNo?: number
  text: string
  type: 'context' | 'add' | 'del' | 'hunk' | 'meta'
}

const unifiedDiffRows = computed<UnifiedDiffRow[]>(() => parseUnifiedDiff(gitDiffLines.value))
const splitDiffRows = computed<SplitDiffRow[]>(() => parseSplitDiff(gitDiffLines.value))

function gitStatusLabel(item: GitStatusItem): string {
  return gitStatusView(item).label
}

function gitStatusKind(item: GitStatusItem): string {
  return gitStatusView(item).kind
}

function gitStatusBadgeVariant(kind: string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  if (kind === 'added') return 'success'
  if (kind === 'deleted') return 'danger'
  if (kind === 'modified' || kind === 'copied') return 'info'
  if (kind === 'renamed' || kind === 'conflict') return 'warning'
  return 'neutral'
}

function gitStatusView(item: GitStatusItem): { label: string; kind: string } {
  const status = item.status || ''
  const x = status[0] || ' '
  const y = status[1] || ' '
  const code = x !== ' ' ? x : y

  if (status === '??' || item.untracked) return { label: 'A', kind: 'added' }
  if (x === 'D' || y === 'D') return { label: 'D', kind: 'deleted' }
  if (x === 'R' || y === 'R') return { label: 'R', kind: 'renamed' }
  if (x === 'C' || y === 'C') return { label: 'C', kind: 'copied' }
  if (x === 'U' || y === 'U' || status === 'AA' || status === 'DD') return { label: 'U', kind: 'conflict' }
  if (code === 'A') return { label: 'A', kind: 'added' }
  if (code === 'M') return { label: 'M', kind: 'modified' }
  if (code === 'T') return { label: 'T', kind: 'modified' }
  return { label: status.trim() || '?', kind: 'unknown' }
}

function parseHunkHeader(line: string): { oldNo: number; newNo: number } | null {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!m) return null
  return { oldNo: Number(m[1]), newNo: Number(m[2]) }
}

function parseUnifiedDiff(lines: string[]): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false

  for (const line of lines) {
    const hunk = parseHunkHeader(line)
    if (hunk) {
      oldNo = hunk.oldNo
      newNo = hunk.newNo
      inHunk = true
      rows.push({ text: line, type: 'hunk' })
      continue
    }

    if (!inHunk) {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        rows.push({ text: line, type: 'meta' })
      }
      continue
    }

    if (line.startsWith('\\')) {
      rows.push({ text: line, type: 'meta' })
    } else if (line.startsWith('-')) {
      rows.push({ oldNo: oldNo++, text: line, type: 'del' })
    } else if (line.startsWith('+')) {
      rows.push({ newNo: newNo++, text: line, type: 'add' })
    } else {
      rows.push({ oldNo: oldNo++, newNo: newNo++, text: line, type: 'context' })
    }
  }

  if (rows.length === 0 && lines.length > 0) {
    return lines.map((line, idx) => ({ newNo: idx + 1, text: line, type: 'add' }))
  }
  return rows
}

function parseSplitDiff(lines: string[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let pendingDel: { no: number; text: string }[] = []
  let pendingAdd: { no: number; text: string }[] = []

  const flushChanges = () => {
    const max = Math.max(pendingDel.length, pendingAdd.length)
    for (let i = 0; i < max; i++) {
      const left = pendingDel[i]
      const right = pendingAdd[i]
      rows.push({
        oldNo: left?.no,
        newNo: right?.no,
        oldText: left?.text ?? '',
        newText: right?.text ?? '',
        type: left && right ? 'change' : left ? 'del' : 'add',
      })
    }
    pendingDel = []
    pendingAdd = []
  }

  for (const line of lines) {
    const hunk = parseHunkHeader(line)
    if (hunk) {
      flushChanges()
      oldNo = hunk.oldNo
      newNo = hunk.newNo
      inHunk = true
      rows.push({ oldText: line, newText: line, type: 'hunk' })
      continue
    }

    if (!inHunk) {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        rows.push({ oldText: line, newText: line, type: 'meta' })
      }
      continue
    }

    if (line.startsWith('\\')) {
      flushChanges()
      rows.push({ oldText: line, newText: line, type: 'meta' })
    } else if (line.startsWith('-')) {
      pendingDel.push({ no: oldNo++, text: line.slice(1) })
    } else if (line.startsWith('+')) {
      pendingAdd.push({ no: newNo++, text: line.slice(1) })
    } else {
      flushChanges()
      const text = line.startsWith(' ') ? line.slice(1) : line
      rows.push({ oldNo: oldNo++, newNo: newNo++, oldText: text, newText: text, type: 'context' })
    }
  }

  flushChanges()
  if (rows.length === 0 && lines.length > 0) {
    return lines.map(line => ({ oldText: '', newText: line, type: 'add' }))
  }
  return rows
}

async function loadGitStatus(): Promise<void> {
  const rootPath = props.root
  if (!rootPath || gitLoading.value) return
  gitLoading.value = true
  gitErrMsg.value = ''
  try {
    const res = await props.transport.gitStatus(rootPath)
    gitItems.value = res.items || []
    emit('branch', res.branch || '')
    if (selectedGitPath.value && !gitItems.value.some(item => item.path === selectedGitPath.value)) {
      selectedGitPath.value = ''
      selectedGitStatus.value = ''
      selectedGitKind.value = ''
      gitDiff.value = ''
      emitViewState()
    }
  } catch (e: any) {
    gitErrMsg.value = e?.message || String(e)
    gitItems.value = []
    emit('branch', '')
  } finally {
    gitLoading.value = false
  }
}

async function selectGitItem(item: GitStatusItem, force = false): Promise<void> {
  if (!force && selectedGitPath.value === item.path && gitDiff.value) return
  selectedGitPath.value = item.path
  selectedGitStatus.value = gitStatusLabel(item)
  selectedGitKind.value = gitStatusKind(item)
  emitViewState()
  gitDiff.value = ''
  gitErrMsg.value = ''
  gitDiffLoading.value = true
  try {
    const res = await props.transport.gitDiff(props.root || '', item.path, showFullDiff.value)
    gitDiff.value = res.diff || ''
  } catch (e: any) {
    gitErrMsg.value = e?.message || String(e)
  } finally {
    gitDiffLoading.value = false
  }
}

function emitViewState(): void {
  emit('view-state', {
    selectedPath: selectedGitPath.value,
    diffViewMode: diffViewMode.value,
    showFullDiff: showFullDiff.value,
  })
}

async function refresh(): Promise<void> {
  emit('refreshing', true)
  try {
    await loadGitStatus()
    if (selectedGitPath.value) {
      const item = gitItems.value.find(i => i.path === selectedGitPath.value)
      if (item) await selectGitItem(item, true)
    }
  } finally {
    emit('refreshing', false)
  }
}

watch(() => props.root, async (val) => {
  gitItems.value = []
  emit('branch', '')
  selectedGitPath.value = ''
  selectedGitStatus.value = ''
  selectedGitKind.value = ''
  gitDiff.value = ''
  gitErrMsg.value = ''
  diffViewMode.value = props.viewState?.diffViewMode ?? 'unified'
  showFullDiff.value = props.viewState?.showFullDiff ?? false
  if (val) {
    await loadGitStatus()
    const savedSelectedPath = props.viewState?.selectedPath || ''
    const item = savedSelectedPath ? gitItems.value.find(item => item.path === savedSelectedPath) : undefined
    if (item) {
      await selectGitItem(item)
    } else {
      emitViewState()
    }
  }
}, { immediate: true })

watch(() => props.treeWidth, (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value !== treeWidth.value) {
    treeWidth.value = value
  }
})

watch(() => props.treeHeight, (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value !== treeHeight.value) {
    treeHeight.value = value
  }
})

watch(treeWidth, (value) => {
  emit('tree-width', value)
})

watch(treeHeight, (value) => {
  emit('tree-height', value)
})

watch(() => props.refreshKey, async (val, oldVal) => {
  if (val === oldVal) return
  await refresh()
})

watch(gitItems, (items) => emit('count', items.length), { immediate: true })

watch(diffViewMode, () => {
  emitViewState()
})

watch(showFullDiff, async () => {
  emitViewState()
  if (!selectedGitPath.value) return
  const item = gitItems.value.find(i => i.path === selectedGitPath.value)
  if (item) await selectGitItem(item, true)
})

function clampTreeSize(size: number, mode = resizeMode.value): number {
  const root = explorerEl.value
  if (!root) return Math.max(180, size)
  const total = mode === 'vertical' ? root.clientHeight : root.clientWidth
  if (total <= 0) return Math.max(180, size)
  const min = mode === 'vertical' ? 140 : 180
  const max = Math.max(min, total - (mode === 'vertical' ? 180 : 240))
  return Math.min(max, Math.max(min, size))
}

function syncResizeMode() {
  const width = explorerEl.value?.clientWidth ?? window.innerWidth
  const nextMode = width <= 768 ? 'vertical' : 'horizontal'
  resizeMode.value = nextMode
  if (nextMode === 'vertical') {
    treeHeight.value = clampTreeSize(treeHeight.value, nextMode)
  } else {
    treeWidth.value = clampTreeSize(treeWidth.value, nextMode)
  }
}

function startTreeResize(e: PointerEvent) {
  e.preventDefault()
  syncResizeMode()
  resizing.value = true
  window.addEventListener('pointermove', onTreeResize)
  window.addEventListener('pointerup', stopTreeResize, { once: true })
}

function onTreeResize(e: PointerEvent) {
  if (!resizing.value || !explorerEl.value) return
  const rect = explorerEl.value.getBoundingClientRect()
  const next = resizeMode.value === 'vertical'
    ? e.clientY - rect.top
    : e.clientX - rect.left
  if (resizeMode.value === 'vertical') {
    treeHeight.value = clampTreeSize(next)
  } else {
    treeWidth.value = clampTreeSize(next)
  }
}

function stopTreeResize() {
  resizing.value = false
  window.removeEventListener('pointermove', onTreeResize)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onTreeResize)
  window.removeEventListener('resize', syncResizeMode)
})

onMounted(() => {
  syncResizeMode()
  window.addEventListener('resize', syncResizeMode)
})
</script>

<template>
  <div ref="explorerEl" class="chatui-git-explorer" :class="{ 'chatui-git-explorer--resizing': resizing }">
    <STree class="chatui-explorer-tree" :style="treeStyle">
      <div v-if="!props.root" class="chatui-explorer-empty-tip">{{ L.explorerPickRootHint }}</div>
      <div v-else-if="gitLoading && gitItems.length === 0" class="chatui-explorer-empty-tip">{{ L.loading }}</div>
      <div v-else-if="gitErrMsg && gitItems.length === 0" class="chatui-explorer-empty-tip chatui-explorer-error">{{ gitErrMsg }}</div>
      <div v-else-if="gitItems.length === 0" class="chatui-explorer-empty-tip">{{ L.explorerGitNoChanges }}</div>
      <template v-else>
        <STreeNode
          v-for="item in gitItems"
          :key="item.path"
          type="file"
          :level="0"
          :selected="selectedGitPath === item.path"
          :title="item.oldPath ? `${item.oldPath} -> ${item.path}` : item.path"
          @click="selectGitItem(item)"
        >
          <template #icon>
            <span class="chatui-explorer-git-dot" />
          </template>
          <span class="chatui-explorer-git-path">
            <span v-if="item.oldPath" class="chatui-explorer-git-old">{{ item.oldPath }} -> </span>{{ item.path }}
          </span>
          <template #suffix>
            <SBadge :variant="gitStatusBadgeVariant(gitStatusKind(item))" size="xs">
              {{ gitStatusLabel(item) }}
            </SBadge>
          </template>
        </STreeNode>
      </template>
    </STree>

    <div
      class="chatui-explorer-splitter"
      :class="{ 'chatui-explorer-splitter--vertical': resizeMode === 'vertical' }"
      @pointerdown="startTreeResize"
    />

    <div class="chatui-explorer-viewer">
      <template v-if="selectedGitPath">
        <div class="chatui-explorer-toolbar chatui-explorer-toolbar--git">
          <div class="chatui-explorer-git-toolbar-left">
            <span class="chatui-explorer-encoding">UTF-8</span>
            <span class="chatui-explorer-path">{{ selectedGitPath }}</span>
            <SBadge
              v-if="selectedGitKind"
              :variant="gitStatusBadgeVariant(selectedGitKind)"
              size="xs"
              pill
            >
              {{ selectedGitStatus }}
            </SBadge>
          </div>
          <STabBar v-model="diffViewMode" class="chatui-explorer-diff-tabs">
            <STab name="unified">{{ L.explorerUnifiedDiff }}</STab>
            <STab name="split">{{ L.explorerSplitDiff }}</STab>
          </STabBar>
          <div class="chatui-explorer-git-toolbar-right">
            <SSwitch v-model="showFullDiff" class="chatui-explorer-full-diff-switch">
              {{ L.explorerFullDiff }}
            </SSwitch>
          </div>
        </div>
        <div v-if="gitDiffLoading" class="chatui-explorer-state">{{ L.loading }}</div>
        <div v-else-if="gitErrMsg" class="chatui-explorer-state chatui-explorer-error">{{ gitErrMsg }}</div>
        <div v-else-if="gitDiffLines.length === 0" class="chatui-explorer-state">{{ L.explorerGitNoDiff }}</div>
        <div v-else-if="diffViewMode === 'split'" class="chatui-explorer-split-diff" role="document" :aria-label="selectedGitPath">
          <div class="chatui-explorer-split-head">
            <span>{{ L.explorerBaseVersion }}</span>
            <span>{{ L.explorerLocalVersion }}</span>
          </div>
          <div
            v-for="(row, idx) in splitDiffRows"
            :key="idx"
            class="chatui-explorer-split-row"
            :class="`chatui-explorer-split-row--${row.type}`"
          >
            <div class="chatui-explorer-split-cell chatui-explorer-split-cell--old">
              <span class="chatui-explorer-split-no">{{ row.oldNo ?? '' }}</span>
              <span class="chatui-explorer-split-text">{{ row.oldText || ' ' }}</span>
            </div>
            <div class="chatui-explorer-split-cell chatui-explorer-split-cell--new">
              <span class="chatui-explorer-split-no">{{ row.newNo ?? '' }}</span>
              <span class="chatui-explorer-split-text">{{ row.newText || ' ' }}</span>
            </div>
          </div>
        </div>
        <div v-else class="chatui-explorer-diff-content" role="document" :aria-label="selectedGitPath">
          <div
            v-for="(row, idx) in unifiedDiffRows"
            :key="idx"
            class="chatui-explorer-diff-line"
            :class="`chatui-explorer-diff-line--${row.type}`"
          >
            <span class="chatui-explorer-diff-no chatui-explorer-diff-no--old">{{ row.oldNo ?? '' }}</span>
            <span class="chatui-explorer-diff-no chatui-explorer-diff-no--new">{{ row.newNo ?? '' }}</span>
            <span class="chatui-explorer-diff-text">{{ row.text || ' ' }}</span>
          </div>
        </div>
      </template>
      <div v-else class="chatui-explorer-state">{{ L.explorerGitSelectFile }}</div>
    </div>
  </div>
</template>

<style scoped>
.chatui-git-explorer {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-git-explorer--resizing,
.chatui-git-explorer--resizing * {
  user-select: none;
}
.chatui-explorer-tree {
  flex-shrink: 0;
  min-width: 180px;
  max-width: calc(100% - 240px);
  height: 100%;
}
.chatui-explorer-splitter {
  width: 8px;
  margin: 0 -4px;
  flex-shrink: 0;
  position: relative;
  z-index: 4;
  cursor: col-resize;
  touch-action: none;
}
.chatui-explorer-splitter::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--chatui-border);
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}
.chatui-explorer-splitter:hover::after,
.chatui-git-explorer--resizing .chatui-explorer-splitter::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
  opacity: 1;
}
.chatui-git-explorer--resizing .chatui-explorer-splitter {
  cursor: col-resize;
}
.chatui-explorer-empty-tip {
  padding: 24px 16px;
  color: var(--chatui-fg-secondary);
  font-size: 12px;
  text-align: center;
}
.chatui-explorer-git-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--chatui-fg-secondary);
}
.chatui-explorer-git-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 12px;
}
.chatui-explorer-git-old {
  color: var(--chatui-fg-muted, var(--chatui-fg-secondary));
}
.chatui-explorer-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--chatui-bg);
  min-width: 0;
}
.chatui-explorer-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(150px, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
  background: var(--chatui-bg-surface);
}
.chatui-explorer-toolbar--git {
  gap: 6px 10px;
}
.chatui-explorer-git-toolbar-left,
.chatui-explorer-git-toolbar-right {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.chatui-explorer-git-toolbar-right {
  justify-content: flex-end;
}
.chatui-explorer-encoding {
  flex-shrink: 0;
  color: var(--chatui-fg-secondary);
  font-family: monospace;
  font-size: 12px;
}
.chatui-explorer-path {
  flex: 1;
  min-width: 0;
  font-family: monospace;
  font-size: 12px;
  color: var(--chatui-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatui-explorer-full-diff-switch {
  flex-shrink: 0;
}
.chatui-explorer-full-diff-switch :deep(.s-switch__label) {
  color: var(--chatui-fg-secondary);
  font-size: 12px;
}
.chatui-explorer-diff-tabs {
  justify-self: center;
  display: inline-flex;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}
.chatui-explorer-diff-tabs :deep(.s-tab) {
  height: 24px;
  padding: 0 8px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--chatui-fg-secondary);
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 0;
}
.chatui-explorer-diff-tabs :deep(.s-tab + .s-tab) {
  margin-left: 2px;
}
.chatui-explorer-diff-tabs :deep(.s-tab:hover:not(.s-tab--disabled)) {
  color: var(--chatui-fg);
}
.chatui-explorer-diff-tabs :deep(.s-tab--active) {
  background: transparent;
  border-bottom-color: var(--chatui-fg);
  color: var(--chatui-fg);
}
.chatui-explorer-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--chatui-fg-secondary);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.chatui-explorer-error {
  color: var(--chatui-btn-danger, #f87171);
  white-space: pre-wrap;
}
.chatui-explorer-diff-content {
  flex: 1;
  overflow: auto;
  padding: 8px 0;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--chatui-fg);
  background: var(--chatui-bg);
}
.chatui-explorer-diff-line {
  display: flex;
  min-width: max-content;
  white-space: pre;
}
.chatui-explorer-diff-no {
  width: 42px;
  flex-shrink: 0;
  padding: 0 8px;
  color: var(--chatui-diff-line-no, var(--chatui-fg-secondary));
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--chatui-border);
}
.chatui-explorer-diff-text {
  padding: 0 12px;
}
.chatui-explorer-diff-line--meta {
  color: var(--chatui-diff-meta-fg, var(--chatui-fg-secondary));
  background: var(--chatui-diff-meta-bg, var(--chatui-bg-surface));
}
.chatui-explorer-diff-line--hunk {
  color: var(--chatui-diff-hunk-fg, #0969da);
  background: var(--chatui-diff-hunk-bg, #eaf2ff);
}
.chatui-explorer-diff-line--add {
  background: var(--chatui-diff-add-bg, #dafbe1);
}
.chatui-explorer-diff-line--add .chatui-explorer-diff-text {
  color: var(--chatui-diff-add-fg, #116329);
}
.chatui-explorer-diff-line--del {
  background: var(--chatui-diff-del-bg, #ffebe9);
}
.chatui-explorer-diff-line--del .chatui-explorer-diff-text {
  color: var(--chatui-diff-del-fg, #b42318);
}
.chatui-explorer-split-diff {
  flex: 1;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--chatui-fg);
  background: var(--chatui-bg);
}
.chatui-explorer-split-head,
.chatui-explorer-split-row {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
  min-width: 760px;
}
.chatui-explorer-split-head {
  position: sticky;
  top: 0;
  z-index: 2;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-diff-meta-bg, var(--chatui-bg-surface));
  color: var(--chatui-diff-meta-fg, var(--chatui-fg-secondary));
  text-align: center;
  font-family: inherit;
  font-size: 12px;
}
.chatui-explorer-split-head span {
  padding: 6px 10px;
}
.chatui-explorer-split-head span + span {
  border-left: 1px solid var(--chatui-border);
}
.chatui-explorer-split-cell {
  display: flex;
  min-width: 0;
  white-space: pre;
}
.chatui-explorer-split-cell--new {
  border-left: 1px solid var(--chatui-border);
}
.chatui-explorer-split-no {
  width: 42px;
  flex-shrink: 0;
  padding: 0 8px;
  color: var(--chatui-diff-line-no, var(--chatui-fg-secondary));
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--chatui-border);
}
.chatui-explorer-split-text {
  padding: 0 10px;
}
.chatui-explorer-split-row--meta,
.chatui-explorer-split-row--hunk {
  color: var(--chatui-diff-meta-fg, var(--chatui-fg-secondary));
  background: var(--chatui-diff-meta-bg, var(--chatui-bg-surface));
}
.chatui-explorer-split-row--hunk {
  color: var(--chatui-diff-hunk-fg, #0969da);
  background: var(--chatui-diff-hunk-bg, #eaf2ff);
}
.chatui-explorer-split-row--del .chatui-explorer-split-cell--old,
.chatui-explorer-split-row--change .chatui-explorer-split-cell--old {
  background: var(--chatui-diff-del-bg, #ffebe9);
}
.chatui-explorer-split-row--del .chatui-explorer-split-cell--old .chatui-explorer-split-text,
.chatui-explorer-split-row--change .chatui-explorer-split-cell--old .chatui-explorer-split-text {
  color: var(--chatui-diff-del-fg, #b42318);
}
.chatui-explorer-split-row--add .chatui-explorer-split-cell--new,
.chatui-explorer-split-row--change .chatui-explorer-split-cell--new {
  background: var(--chatui-diff-add-bg, #dafbe1);
}
.chatui-explorer-split-row--add .chatui-explorer-split-cell--new .chatui-explorer-split-text,
.chatui-explorer-split-row--change .chatui-explorer-split-cell--new .chatui-explorer-split-text {
  color: var(--chatui-diff-add-fg, #116329);
}

@media (max-width: 768px) {
  .chatui-git-explorer { flex-direction: column; }
  .chatui-explorer-tree {
    width: 100% !important;
    min-width: 0;
    max-width: none;
    min-height: 140px;
    max-height: calc(100% - 180px);
  }
  .chatui-explorer-splitter {
    width: 100%;
    height: 8px;
    margin: -4px 0;
    cursor: row-resize;
  }
  .chatui-explorer-splitter::after {
    top: 3px;
    bottom: auto;
    left: 0;
    right: 0;
    width: auto;
    height: 1px;
  }
  .chatui-git-explorer--resizing .chatui-explorer-splitter {
    cursor: row-resize;
  }
  .chatui-explorer-toolbar {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .chatui-explorer-diff-tabs {
    justify-self: start;
  }
  .chatui-explorer-git-toolbar-right {
    justify-content: flex-start;
  }
}
</style>
