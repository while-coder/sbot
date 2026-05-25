<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { STab, STabBar, STree, SSwitch } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, GitStatusItem } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
  refreshKey?: number
}>()

const emit = defineEmits<{
  count: [value: number]
  refreshing: [value: boolean]
}>()

const L = computed(() => resolveLabels(props.labels))

const gitItems = ref<GitStatusItem[]>([])
const gitLoading = ref(false)
const gitDiffLoading = ref(false)
const gitErrMsg = ref('')
const selectedGitPath = ref('')
const selectedGitStatus = ref('')
const gitDiff = ref('')
const diffViewMode = ref<'unified' | 'split'>('unified')
const showFullDiff = ref(false)
const explorerEl = ref<HTMLElement | null>(null)
const treeSize = ref(260)
const resizing = ref(false)
const resizeMode = ref<'horizontal' | 'vertical'>('horizontal')

const treeStyle = computed(() =>
  resizeMode.value === 'vertical'
    ? { height: `${treeSize.value}px` }
    : { width: `${treeSize.value}px` },
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
    if (selectedGitPath.value && !gitItems.value.some(item => item.path === selectedGitPath.value)) {
      selectedGitPath.value = ''
      selectedGitStatus.value = ''
      gitDiff.value = ''
    }
  } catch (e: any) {
    gitErrMsg.value = e?.message || String(e)
    gitItems.value = []
  } finally {
    gitLoading.value = false
  }
}

async function selectGitItem(item: GitStatusItem, force = false): Promise<void> {
  if (!force && selectedGitPath.value === item.path && gitDiff.value) return
  selectedGitPath.value = item.path
  selectedGitStatus.value = gitStatusLabel(item)
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
  selectedGitPath.value = ''
  selectedGitStatus.value = ''
  gitDiff.value = ''
  gitErrMsg.value = ''
  if (val) await loadGitStatus()
}, { immediate: true })

watch(() => props.refreshKey, async (val, oldVal) => {
  if (val === oldVal) return
  await refresh()
})

watch(gitItems, (items) => emit('count', items.length), { immediate: true })

watch(showFullDiff, async () => {
  if (!selectedGitPath.value) return
  const item = gitItems.value.find(i => i.path === selectedGitPath.value)
  if (item) await selectGitItem(item, true)
})

function clampTreeSize(size: number): number {
  const root = explorerEl.value
  if (!root) return Math.max(180, size)
  const total = resizeMode.value === 'vertical' ? root.clientHeight : root.clientWidth
  if (total <= 0) return Math.max(180, size)
  const min = resizeMode.value === 'vertical' ? 140 : 180
  const max = Math.max(min, total - (resizeMode.value === 'vertical' ? 180 : 240))
  return Math.min(max, Math.max(min, size))
}

function syncResizeMode() {
  const width = explorerEl.value?.clientWidth ?? window.innerWidth
  resizeMode.value = width <= 768 ? 'vertical' : 'horizontal'
  treeSize.value = clampTreeSize(treeSize.value)
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
  treeSize.value = clampTreeSize(next)
}

function stopTreeResize() {
  resizing.value = false
  window.removeEventListener('pointermove', onTreeResize)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onTreeResize)
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
        <button
          v-for="item in gitItems"
          :key="item.path"
          class="chatui-explorer-git-item"
          :class="{ 'chatui-explorer-git-item--selected': selectedGitPath === item.path }"
          type="button"
          :title="item.oldPath ? `${item.oldPath} -> ${item.path}` : item.path"
          @click="selectGitItem(item)"
        >
          <span
            class="chatui-explorer-git-status"
            :class="`chatui-explorer-git-status--${gitStatusKind(item)}`"
          >{{ gitStatusLabel(item) }}</span>
          <span class="chatui-explorer-git-path">
            <span v-if="item.oldPath" class="chatui-explorer-git-old">{{ item.oldPath }} -> </span>{{ item.path }}
          </span>
        </button>
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
          <div class="chatui-explorer-git-toolbar-main">
            <span class="chatui-explorer-path">{{ selectedGitPath }}</span>
            <span class="chatui-explorer-meta">{{ selectedGitStatus }}</span>
          </div>
          <SSwitch v-model="showFullDiff" class="chatui-explorer-full-diff-switch">
            {{ L.explorerFullDiff }}
          </SSwitch>
          <STabBar v-model="diffViewMode" class="chatui-explorer-diff-tabs">
            <STab name="unified">{{ L.explorerUnifiedDiff }}</STab>
            <STab name="split">{{ L.explorerSplitDiff }}</STab>
          </STabBar>
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
.chatui-explorer-git-item {
  width: 100%;
  min-height: 30px;
  padding: 5px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--chatui-fg-secondary);
  text-align: left;
  cursor: pointer;
}
.chatui-explorer-git-item:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-git-item--selected {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-git-status {
  width: 28px;
  height: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chatui-border);
  border-radius: 3px;
  font-family: monospace;
  font-size: 10px;
  line-height: 1;
  color: var(--chatui-fg-secondary);
  background: var(--chatui-bg-surface);
}
.chatui-explorer-git-status--added {
  border-color: rgba(34, 197, 94, 0.55);
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}
.chatui-explorer-git-status--deleted {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}
.chatui-explorer-git-status--modified {
  border-color: rgba(37, 99, 235, 0.55);
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
.chatui-explorer-git-status--renamed {
  border-color: rgba(147, 51, 234, 0.55);
  background: rgba(147, 51, 234, 0.12);
  color: #9333ea;
}
.chatui-explorer-git-status--copied {
  border-color: rgba(8, 145, 178, 0.55);
  background: rgba(8, 145, 178, 0.12);
  color: #0891b2;
}
.chatui-explorer-git-status--conflict {
  border-color: rgba(202, 138, 4, 0.6);
  background: rgba(202, 138, 4, 0.14);
  color: #ca8a04;
}
.chatui-explorer-git-status--unknown {
  border-color: rgba(148, 163, 184, 0.55);
  background: rgba(148, 163, 184, 0.12);
  color: var(--chatui-fg-secondary);
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
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
  background: var(--chatui-bg-surface);
}
.chatui-explorer-toolbar--git {
  flex-wrap: wrap;
  gap: 6px 10px;
}
.chatui-explorer-git-toolbar-main {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.chatui-explorer-path {
  flex: 1;
  min-width: 0;
  font-family: monospace;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatui-explorer-meta {
  font-size: 11px;
  color: var(--chatui-fg-secondary);
  flex-shrink: 0;
}
.chatui-explorer-full-diff-switch {
  flex-shrink: 0;
}
.chatui-explorer-full-diff-switch :deep(.s-switch__label) {
  color: var(--chatui-fg-secondary);
  font-size: 12px;
}
.chatui-explorer-diff-tabs {
  display: inline-flex;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid var(--chatui-border);
  border-radius: 5px;
  background: var(--chatui-bg);
}
.chatui-explorer-diff-tabs :deep(.s-tab) {
  height: 24px;
  padding: 0 8px;
  border-bottom: none;
  border-radius: 3px;
  color: var(--chatui-fg-secondary);
  font-size: 12px;
}
.chatui-explorer-diff-tabs :deep(.s-tab:hover:not(.s-tab--disabled)) {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-diff-tabs :deep(.s-tab--active) {
  background: var(--chatui-bg-hover);
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
}
</style>
