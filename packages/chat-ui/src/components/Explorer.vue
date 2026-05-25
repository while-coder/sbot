<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { STab, STabBar, STree, STreeNode, SSwitch } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, FsTreeItem, GitStatusItem } from '../types'
import { resolveLabels, tpl } from '../labels'
import ImageLightbox from './ImageLightbox.vue'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))

type DirState = {
  loaded: boolean
  loading: boolean
  expanded: boolean
  items: FsTreeItem[]
}

const dirStates = ref<Map<string, DirState>>(new Map())
const mode = ref<'files' | 'git'>('files')
const selectedPath = ref('')
const fileContent = ref('')
const fileDataUrl = ref('')
const fileContentType = ref<'text' | 'image' | 'binary'>('text')
const fileMimeType = ref('')
const fileSize = ref(0)
const fileTooLarge = ref(false)
const fileLoading = ref(false)
const errMsg = ref('')
const refreshing = ref(false)
const gitItems = ref<GitStatusItem[]>([])
const gitLoading = ref(false)
const gitDiffLoading = ref(false)
const gitErrMsg = ref('')
const selectedGitPath = ref('')
const selectedGitStatus = ref('')
const gitDiff = ref('')
const diffViewMode = ref<'unified' | 'split'>('unified')
const showFullDiff = ref(false)
const imageLightbox = ref<InstanceType<typeof ImageLightbox> | null>(null)
const explorerEl = ref<HTMLElement | null>(null)
const treeSize = ref(260)
const resizing = ref(false)
const resizeMode = ref<'horizontal' | 'vertical'>('horizontal')

const treeStyle = computed(() =>
  resizeMode.value === 'vertical'
    ? { height: `${treeSize.value}px` }
    : { width: `${treeSize.value}px` },
)

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function loadDir(dir: string): Promise<void> {
  let state = dirStates.value.get(dir)
  if (!state) {
    state = { loaded: false, loading: false, expanded: false, items: [] }
    dirStates.value.set(dir, state)
  }
  if (state.loaded || state.loading) return
  state.loading = true
  errMsg.value = ''
  try {
    const res = await props.transport.listTree(dir)
    state.items = res.items || []
    state.loaded = true
  } catch (e: any) {
    errMsg.value = e?.message || String(e)
  } finally {
    state.loading = false
    dirStates.value = new Map(dirStates.value)
  }
}

async function toggleDir(dir: string): Promise<void> {
  let state = dirStates.value.get(dir)
  if (!state) {
    await loadDir(dir)
    state = dirStates.value.get(dir)!
    state.expanded = true
  } else {
    state.expanded = !state.expanded
    if (state.expanded && !state.loaded) await loadDir(dir)
  }
  dirStates.value = new Map(dirStates.value)
}

async function selectFile(item: FsTreeItem): Promise<void> {
  if (selectedPath.value === item.path) return
  selectedPath.value = item.path
  fileContent.value = ''
  fileDataUrl.value = ''
  fileContentType.value = 'text'
  fileMimeType.value = ''
  fileSize.value = item.size ?? 0
  fileTooLarge.value = false
  fileLoading.value = true
  errMsg.value = ''
  try {
    const res = await props.transport.readFile(item.path)
    fileContent.value = res.content ?? ''
    fileDataUrl.value = res.dataUrl ?? ''
    fileContentType.value = res.contentType
    fileMimeType.value = res.mimeType ?? ''
    fileSize.value = res.size ?? 0
    fileTooLarge.value = !!res.tooLarge
  } catch (e: any) {
    errMsg.value = e?.message || String(e)
  } finally {
    fileLoading.value = false
  }
}

type FlatRow = { item: FsTreeItem; depth: number }
function flattenChildren(parent: string, depth: number): FlatRow[] {
  const state = dirStates.value.get(parent)
  if (!state || !state.expanded) return []
  const rows: FlatRow[] = []
  for (const item of state.items) {
    rows.push({ item, depth })
    if (item.type === 'dir') {
      const sub = dirStates.value.get(item.path)
      if (sub?.expanded) rows.push(...flattenChildren(item.path, depth + 1))
    }
  }
  return rows
}

const rootRows = computed<FlatRow[]>(() => {
  if (!props.root) return []
  return flattenChildren(props.root, 0)
})

const rootLoading = computed(() => {
  if (!props.root) return false
  return dirStates.value.get(props.root)?.loading ?? false
})

const gitDiffLines = computed(() => gitDiff.value ? gitDiff.value.replace(/\r?\n$/, '').split(/\r?\n/) : [])

type SplitDiffRow = {
  oldNo?: number
  newNo?: number
  oldText: string
  newText: string
  type: 'context' | 'add' | 'del' | 'change' | 'hunk' | 'meta'
}

const splitDiffRows = computed<SplitDiffRow[]>(() => parseSplitDiff(gitDiffLines.value))

function gitStatusLabel(item: GitStatusItem): string {
  const raw = item.status.trim()
  return raw || item.status.replace(/ /g, '_')
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'chatui-explorer-diff-line--file'
  if (line.startsWith('@@')) return 'chatui-explorer-diff-line--hunk'
  if (line.startsWith('+')) return 'chatui-explorer-diff-line--add'
  if (line.startsWith('-')) return 'chatui-explorer-diff-line--del'
  return ''
}

function parseHunkHeader(line: string): { oldNo: number; newNo: number } | null {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!m) return null
  return { oldNo: Number(m[1]), newNo: Number(m[2]) }
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

watch(() => props.root, async (val) => {
  dirStates.value = new Map()
  selectedPath.value = ''
  fileContent.value = ''
  fileDataUrl.value = ''
  fileContentType.value = 'text'
  fileMimeType.value = ''
  errMsg.value = ''
  gitItems.value = []
  selectedGitPath.value = ''
  selectedGitStatus.value = ''
  gitDiff.value = ''
  gitErrMsg.value = ''
  if (val) {
    await loadDir(val)
    const s = dirStates.value.get(val)
    if (s) {
      s.expanded = true
      dirStates.value = new Map(dirStates.value)
    }
    if (mode.value === 'git') await loadGitStatus()
  }
}, { immediate: true })

watch(mode, async (val) => {
  if (val === 'git' && props.root) await loadGitStatus()
})

watch(showFullDiff, async () => {
  if (!selectedGitPath.value) return
  const item = gitItems.value.find(i => i.path === selectedGitPath.value)
  if (item) await selectGitItem(item, true)
})

async function refresh(): Promise<void> {
  const rootPath = props.root
  if (!rootPath || refreshing.value) return
  if (mode.value === 'git') {
    refreshing.value = true
    try {
      await loadGitStatus()
      if (selectedGitPath.value) {
        const item = gitItems.value.find(i => i.path === selectedGitPath.value)
        if (item) {
          await selectGitItem(item, true)
        }
      }
    } finally {
      refreshing.value = false
    }
    return
  }
  refreshing.value = true
  errMsg.value = ''
  try {
    const wasExpanded = new Set<string>()
    for (const [p, s] of dirStates.value) {
      if (s.expanded) wasExpanded.add(p)
    }

    dirStates.value = new Map()
    await loadDir(rootPath)
    const rootState = dirStates.value.get(rootPath)
    if (!rootState) return
    rootState.expanded = true

    const queue: string[] = [rootPath]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const state = dirStates.value.get(cur)
      if (!state) continue
      for (const item of state.items) {
        if (item.type === 'dir' && wasExpanded.has(item.path)) {
          await loadDir(item.path)
          const sub = dirStates.value.get(item.path)
          if (sub) {
            sub.expanded = true
            queue.push(item.path)
          }
        }
      }
    }
    dirStates.value = new Map(dirStates.value)
  } finally {
    refreshing.value = false
  }
}

const fileLang = computed(() => {
  const p = selectedPath.value
  const i = p.lastIndexOf('.')
  return i > 0 ? p.slice(i + 1).toLowerCase() : ''
})

const isImageFile = computed(() => fileContentType.value === 'image')
const isUnsupportedBinary = computed(() => fileContentType.value === 'binary')
const imageSrc = computed(() => fileDataUrl.value || fileContent.value)

function openImagePreview(): void {
  if (imageSrc.value) imageLightbox.value?.open(imageSrc.value)
}

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
  <div ref="explorerEl" class="chatui-explorer" :class="{ 'chatui-explorer--resizing': resizing }">
    <STree class="chatui-explorer-tree" :style="treeStyle">
      <template #header>
        <div class="chatui-explorer-header">
          <STabBar v-model="mode" class="chatui-explorer-tabs">
            <STab name="files">{{ L.explorerFiles }}</STab>
            <STab name="git" :count="gitItems.length || ''">{{ L.explorerGit }}</STab>
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
      </template>
      <div v-if="!props.root" class="chatui-explorer-empty-tip">{{ L.explorerPickRootHint }}</div>
      <template v-else-if="mode === 'files'">
        <div v-if="rootLoading && rootRows.length === 0" class="chatui-explorer-empty-tip">{{ L.loading }}</div>
        <div v-else-if="rootRows.length === 0" class="chatui-explorer-empty-tip">{{ L.explorerEmptyDir }}</div>
        <template v-else>
          <STreeNode
            v-for="{ item, depth } in rootRows"
            :key="item.path"
            :type="item.type === 'dir' ? 'dir' : 'file'"
            :level="depth"
            :selected="selectedPath === item.path"
            @click="item.type === 'dir' ? toggleDir(item.path) : selectFile(item)"
          >
            <template #icon>
              <span v-if="item.type === 'dir'">{{ dirStates.get(item.path)?.expanded ? '▼' : '▶' }}</span>
              <span v-else>·</span>
            </template>
            {{ item.name }}
          </STreeNode>
        </template>
      </template>
      <template v-else>
        <div v-if="gitLoading && gitItems.length === 0" class="chatui-explorer-empty-tip">{{ L.loading }}</div>
        <div v-else-if="gitErrMsg && gitItems.length === 0" class="chatui-explorer-empty-tip chatui-explorer-error">{{ gitErrMsg }}</div>
        <div v-else-if="gitItems.length === 0" class="chatui-explorer-empty-tip">{{ L.explorerGitNoChanges }}</div>
        <template v-else>
          <button
            v-for="item in gitItems"
            :key="item.path"
            class="chatui-explorer-git-item"
            :class="{ 'chatui-explorer-git-item--selected': selectedGitPath === item.path }"
            type="button"
            :title="item.oldPath ? `${item.oldPath} → ${item.path}` : item.path"
            @click="selectGitItem(item)"
          >
            <span
              class="chatui-explorer-git-status"
              :class="{
                'chatui-explorer-git-status--untracked': item.untracked,
                'chatui-explorer-git-status--staged': item.staged && !item.untracked,
                'chatui-explorer-git-status--unstaged': item.unstaged && !item.untracked,
              }"
            >{{ gitStatusLabel(item) }}</span>
            <span class="chatui-explorer-git-path">
              <span v-if="item.oldPath" class="chatui-explorer-git-old">{{ item.oldPath }} → </span>{{ item.path }}
            </span>
          </button>
        </template>
      </template>
    </STree>

    <div
      class="chatui-explorer-splitter"
      :class="{ 'chatui-explorer-splitter--vertical': resizeMode === 'vertical' }"
      @pointerdown="startTreeResize"
    />

    <div class="chatui-explorer-viewer">
      <template v-if="mode === 'files' && selectedPath">
        <div class="chatui-explorer-toolbar">
          <span class="chatui-explorer-path">{{ selectedPath }}</span>
          <span class="chatui-explorer-meta">{{ fmtSize(fileSize) }}</span>
        </div>
        <div v-if="fileLoading" class="chatui-explorer-state">{{ L.loading }}</div>
        <div v-else-if="errMsg" class="chatui-explorer-state chatui-explorer-error">{{ errMsg }}</div>
        <div v-else-if="fileTooLarge" class="chatui-explorer-state">
          {{ tpl(L.explorerTooLarge, { size: fmtSize(fileSize) }) }}
        </div>
        <div v-else-if="isImageFile && imageSrc" class="chatui-explorer-image-wrap">
          <button class="chatui-explorer-image-button" :title="fileMimeType || selectedPath" @click="openImagePreview">
            <img :src="imageSrc" :alt="selectedPath" class="chatui-explorer-image" />
          </button>
        </div>
        <div v-else-if="isUnsupportedBinary" class="chatui-explorer-state">{{ L.explorerBinaryFile }}</div>
        <pre v-else class="chatui-explorer-content" :data-lang="fileLang">{{ fileContent }}</pre>
      </template>
      <template v-else-if="mode === 'git' && selectedGitPath">
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
            v-for="(line, idx) in gitDiffLines"
            :key="idx"
            class="chatui-explorer-diff-line"
            :class="diffLineClass(line)"
          >
            <span class="chatui-explorer-diff-no">{{ idx + 1 }}</span>
            <span class="chatui-explorer-diff-text">{{ line || ' ' }}</span>
          </div>
        </div>
      </template>
      <div v-else class="chatui-explorer-state">
        {{ mode === 'git' ? L.explorerGitSelectFile : L.explorerSelectFile }}
      </div>
    </div>
    <ImageLightbox ref="imageLightbox" :labels="props.labels" />
  </div>
</template>

<style scoped>
.chatui-explorer {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-explorer--resizing,
.chatui-explorer--resizing * {
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
.chatui-explorer--resizing .chatui-explorer-splitter::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
  opacity: 1;
}
.chatui-explorer--resizing .chatui-explorer-splitter {
  cursor: col-resize;
}
.chatui-explorer-header {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  text-transform: none; letter-spacing: 0;
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
  margin-top: 6px;
  flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: monospace;
  font-size: 11px;
  color: var(--chatui-fg-secondary);
}
.chatui-explorer-refresh {
  flex-shrink: 0;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer;
  color: var(--chatui-fg-secondary);
  font-size: 14px; line-height: 1;
  border-radius: 3px;
  transition: background 0.15s, color 0.15s;
}
.chatui-explorer-refresh:hover:not(:disabled) {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg);
}
.chatui-explorer-refresh:disabled { cursor: default; opacity: 0.6; }
.chatui-explorer-refresh--spinning {
  animation: chatui-explorer-spin 0.8s linear infinite;
}
@keyframes chatui-explorer-spin {
  to { transform: rotate(360deg); }
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
.chatui-explorer-git-status--untracked {
  border-color: rgba(234, 179, 8, 0.45);
  color: #eab308;
}
.chatui-explorer-git-status--staged {
  border-color: rgba(34, 197, 94, 0.45);
  color: #22c55e;
}
.chatui-explorer-git-status--unstaged {
  border-color: rgba(96, 165, 250, 0.45);
  color: #60a5fa;
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
.chatui-explorer-content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px 16px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--chatui-fg);
  background: var(--chatui-bg);
  white-space: pre;
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
  width: 48px;
  flex-shrink: 0;
  padding: 0 10px 0 8px;
  color: var(--chatui-diff-line-no, var(--chatui-fg-secondary));
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--chatui-border);
}
.chatui-explorer-diff-text {
  padding: 0 12px;
}
.chatui-explorer-diff-line--file {
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
.chatui-explorer-image-wrap {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background:
    linear-gradient(45deg, var(--chatui-bg-soft) 25%, transparent 25%),
    linear-gradient(-45deg, var(--chatui-bg-soft) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--chatui-bg-soft) 75%),
    linear-gradient(-45deg, transparent 75%, var(--chatui-bg-soft) 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}
.chatui-explorer-image-button {
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  cursor: zoom-in;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chatui-explorer-image {
  max-width: 100%;
  max-height: calc(100vh - 180px);
  object-fit: contain;
  display: block;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

@media (max-width: 768px) {
  .chatui-explorer { flex-direction: column; }
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
  .chatui-explorer--resizing .chatui-explorer-splitter {
    cursor: row-resize;
  }
  .chatui-explorer-image {
    max-height: calc(100vh - 320px);
  }
}
</style>
