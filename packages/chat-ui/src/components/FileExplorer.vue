<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { STree, STreeNode, SIconButton } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, FsTreeItem } from '../types'
import type { ExplorerFilesViewState } from '../composables/useExplorerViewState'
import { resolveLabels, tpl } from '../labels'
import ImageLightbox from './ImageLightbox.vue'
import CodeViewer from './CodeViewer.vue'

const props = defineProps<{
  transport: IChatTransport
  root?: string
  labels?: ChatLabels
  refreshKey?: number
  treeWidth?: number
  treeHeight?: number
  viewState?: ExplorerFilesViewState
  /** 是否启用文本文件编辑功能；默认 false（只读） */
  editable?: boolean
  /** 可编辑的最大文件大小，默认 1MB */
  maxEditSize?: number
}>()

const MAX_EDIT_SIZE_DEFAULT = 1024 * 1024

const emit = defineEmits<{
  refreshing: [value: boolean]
  'tree-width': [value: number]
  'tree-height': [value: number]
  'view-state': [value: Partial<ExplorerFilesViewState>]
}>()

const L = computed(() => resolveLabels(props.labels))

type DirState = {
  loaded: boolean
  loading: boolean
  expanded: boolean
  items: FsTreeItem[]
}

const dirStates = ref<Map<string, DirState>>(new Map())
const selectedPath = ref('')
const fileContent = ref('')
const fileDataUrl = ref('')
const fileContentType = ref<'text' | 'image' | 'binary'>('text')
const fileMimeType = ref('')
const fileSize = ref(0)
const fileMtime = ref<number | undefined>(undefined)
const fileTooLarge = ref(false)
const fileLoading = ref(false)
const errMsg = ref('')

const fileInputEl = ref<HTMLInputElement | null>(null)
const uploadTargetDir = ref('')
const busy = ref(false)

const editing = ref(false)
const draftContent = ref('')
const originalContent = ref('')
const saving = ref(false)

const isDirty = computed(() => editing.value && draftContent.value !== originalContent.value)
const canEdit = computed(() =>
  !!props.editable
  && !!selectedPath.value
  && fileContentType.value === 'text'
  && !fileTooLarge.value
  && fileSize.value <= (props.maxEditSize ?? MAX_EDIT_SIZE_DEFAULT),
)
const imageLightbox = ref<InstanceType<typeof ImageLightbox> | null>(null)
const explorerEl = ref<HTMLElement | null>(null)
const treeWidth = ref(props.treeWidth ?? 260)
const treeHeight = ref(props.treeHeight ?? 220)
const resizing = ref(false)
const resizeMode = ref<'horizontal' | 'vertical'>('horizontal')
const hasRoot = computed(() => !!props.root)
const rootPath = computed(() => props.root || '')

const treeStyle = computed(() =>
  resizeMode.value === 'vertical'
    ? { height: `${treeHeight.value}px` }
    : { width: `${treeWidth.value}px` },
)

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function joinPath(parent: string, name: string): string {
  if (!parent) return name
  const usesBackslash = parent.includes('\\') && !parent.startsWith('/')
  const sep = usesBackslash ? '\\' : '/'
  return parent.endsWith('/') || parent.endsWith('\\') ? parent + name : parent + sep + name
}

function findParentDir(p: string): string {
  for (const [dir, state] of dirStates.value) {
    if (state.items.some(it => it.path === p)) return dir
  }
  return ''
}

async function refreshDir(dir: string): Promise<void> {
  if (!dir) return
  const state = dirStates.value.get(dir)
  if (state) state.loaded = false
  await loadDir(dir)
}

function operationFailed(e: any): void {
  errMsg.value = tpl(L.value.explorerOperationFailed, { message: e?.message ?? String(e) })
}

async function handleNewFolder(parentDir: string): Promise<void> {
  if (!parentDir || busy.value) return
  const name = window.prompt(L.value.explorerNewFolderPlaceholder)
  if (!name || !name.trim()) return
  busy.value = true
  errMsg.value = ''
  try {
    await props.transport.mkdir(joinPath(parentDir, name.trim()))
    const parentState = dirStates.value.get(parentDir)
    if (parentState && !parentState.expanded) parentState.expanded = true
    await refreshDir(parentDir)
    dirStates.value = new Map(dirStates.value)
    emitViewState()
  } catch (e: any) {
    operationFailed(e)
  } finally {
    busy.value = false
  }
}

function handleUpload(parentDir: string): void {
  if (!parentDir || busy.value) return
  uploadTargetDir.value = parentDir
  const input = fileInputEl.value
  if (!input) return
  input.value = ''
  input.click()
}

async function onFilesSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = input.files
  const target = uploadTargetDir.value
  if (!files || files.length === 0 || !target) {
    input.value = ''
    return
  }
  busy.value = true
  errMsg.value = ''
  try {
    const failures: string[] = []
    await Promise.all(Array.from(files).map(async (f) => {
      try {
        await props.transport.uploadFile(target, f)
      } catch (err: any) {
        failures.push(`${f.name}: ${err?.message ?? String(err)}`)
      }
    }))
    const parentState = dirStates.value.get(target)
    if (parentState && !parentState.expanded) parentState.expanded = true
    await refreshDir(target)
    dirStates.value = new Map(dirStates.value)
    emitViewState()
    if (failures.length > 0) {
      operationFailed({ message: failures.join('\n') })
    }
  } finally {
    input.value = ''
    uploadTargetDir.value = ''
    busy.value = false
  }
}

async function handleDelete(item: FsTreeItem): Promise<void> {
  if (busy.value) return
  if (!window.confirm(tpl(L.value.explorerConfirmDelete, { name: item.name }))) return
  busy.value = true
  errMsg.value = ''
  try {
    await props.transport.deleteEntry(item.path)
    const sep = item.path.includes('\\') && !item.path.startsWith('/') ? '\\' : '/'
    const prefix = item.path.endsWith(sep) ? item.path : item.path + sep
    if (selectedPath.value === item.path || selectedPath.value.startsWith(prefix)) {
      selectedPath.value = ''
      fileContent.value = ''
      fileDataUrl.value = ''
      fileContentType.value = 'text'
      fileMimeType.value = ''
      fileSize.value = 0
      fileMtime.value = undefined
      fileTooLarge.value = false
      resetEditState()
    }
    if (item.type === 'dir') dirStates.value.delete(item.path)
    const parent = findParentDir(item.path)
    if (parent) await refreshDir(parent)
    dirStates.value = new Map(dirStates.value)
    emitViewState()
  } catch (e: any) {
    operationFailed(e)
  } finally {
    busy.value = false
  }
}

async function loadDir(dir: string): Promise<void> {
  if (!dir) return
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
  emitViewState()
}

async function selectFile(item: FsTreeItem): Promise<void> {
  if (selectedPath.value === item.path) return
  if (!confirmDiscardDirty()) return
  await loadFile(item.path, item.size ?? 0)
}

async function loadFile(path: string, fallbackSize = 0): Promise<void> {
  selectedPath.value = path
  emitViewState()
  fileContent.value = ''
  fileDataUrl.value = ''
  fileContentType.value = 'text'
  fileMimeType.value = ''
  fileSize.value = fallbackSize
  fileMtime.value = undefined
  fileTooLarge.value = false
  fileLoading.value = true
  errMsg.value = ''
  resetEditState()
  try {
    const res = await props.transport.readFile(path)
    fileContent.value = res.content ?? ''
    fileDataUrl.value = res.dataUrl ?? ''
    fileContentType.value = res.contentType
    fileMimeType.value = res.mimeType ?? ''
    fileSize.value = res.size ?? 0
    fileMtime.value = res.mtime
    fileTooLarge.value = !!res.tooLarge
  } catch (e: any) {
    errMsg.value = e?.message || String(e)
  } finally {
    fileLoading.value = false
  }
}

function resetEditState(): void {
  editing.value = false
  draftContent.value = ''
  originalContent.value = ''
  saving.value = false
}

function confirmDiscardDirty(): boolean {
  if (!isDirty.value) return true
  return window.confirm(L.value.explorerEditDiscardConfirm)
}

function startEdit(): void {
  if (!canEdit.value || editing.value) return
  draftContent.value = fileContent.value
  originalContent.value = fileContent.value
  editing.value = true
  errMsg.value = ''
}

function cancelEdit(): void {
  if (!editing.value) return
  if (!confirmDiscardDirty()) return
  resetEditState()
}

async function saveEdit(): Promise<void> {
  if (!editing.value || saving.value) return
  if (!selectedPath.value) return
  saving.value = true
  errMsg.value = ''
  try {
    const res = await props.transport.writeFile(selectedPath.value, draftContent.value, fileMtime.value)
    fileContent.value = draftContent.value
    originalContent.value = draftContent.value
    fileMtime.value = res.mtime
    fileSize.value = res.size
    editing.value = false
  } catch (e: any) {
    if (e?.status === 409 || /STALE_MTIME/i.test(e?.message ?? '')) {
      if (window.confirm(L.value.explorerEditStaleConfirm)) {
        const path = selectedPath.value
        resetEditState()
        await loadFile(path, fileSize.value)
      }
    } else {
      errMsg.value = e?.message || String(e)
    }
  } finally {
    saving.value = false
  }
}

function onEditorKeydown(e: KeyboardEvent): void {
  if (!editing.value) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    void saveEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function emitViewState(): void {
  emit('view-state', {
    expandedPaths: getExpandedPaths(),
    selectedPath: selectedPath.value,
  })
}

function getExpandedPaths(): string[] {
  const paths: string[] = []
  for (const [path, state] of dirStates.value) {
    if (state.expanded) paths.push(path)
  }
  return paths
}

function findLoadedItem(path: string): FsTreeItem | undefined {
  for (const state of dirStates.value.values()) {
    const item = state.items.find(item => item.path === path)
    if (item) return item
  }
}

async function restoreExpandedDirs(expandedPaths: string[]): Promise<void> {
  const root = rootPath.value
  if (!root) return
  const expanded = new Set([root, ...expandedPaths])
  await loadDir(root)
  const rootState = dirStates.value.get(root)
  if (!rootState) return
  rootState.expanded = true

  const queue: string[] = [root]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const state = dirStates.value.get(cur)
    if (!state) continue
    for (const item of state.items) {
      if (item.type === 'dir' && expanded.has(item.path)) {
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
  if (!hasRoot.value) return []
  return flattenChildren(rootPath.value, 0)
})

const rootLoading = computed(() => {
  if (!hasRoot.value) return false
  return dirStates.value.get(rootPath.value)?.loading ?? false
})

watch(() => props.root, async (providedRoot) => {
  dirStates.value = new Map()
  selectedPath.value = ''
  fileContent.value = ''
  fileDataUrl.value = ''
  fileContentType.value = 'text'
  fileMimeType.value = ''
  fileMtime.value = undefined
  errMsg.value = ''
  resetEditState()
  if (providedRoot) {
    await restoreExpandedDirs(props.viewState?.expandedPaths ?? [])
    const savedSelectedPath = props.viewState?.selectedPath || ''
    if (savedSelectedPath) {
      const item = findLoadedItem(savedSelectedPath)
      if (item?.type === 'file') {
        await selectFile(item)
      } else {
        emitViewState()
      }
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

async function refresh(): Promise<void> {
  if (!hasRoot.value) return
  emit('refreshing', true)
  errMsg.value = ''
  try {
    const wasExpanded = new Set<string>()
    for (const [p, s] of dirStates.value) {
      if (s.expanded) wasExpanded.add(p)
    }

    dirStates.value = new Map()
    await loadDir(rootPath.value)
    const rootState = dirStates.value.get(rootPath.value)
    if (!rootState) return
    rootState.expanded = true

    const queue: string[] = [rootPath.value]
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
    emitViewState()
  } finally {
    emit('refreshing', false)
  }
}

const isImageFile = computed(() => fileContentType.value === 'image')
const isUnsupportedBinary = computed(() => fileContentType.value === 'binary')
const imageSrc = computed(() => fileDataUrl.value || fileContent.value)
const rawDownloadHref = computed(() =>
  selectedPath.value && typeof props.transport.getRawFileUrl === 'function'
    ? props.transport.getRawFileUrl(selectedPath.value)
    : '',
)

function openImagePreview(): void {
  if (imageSrc.value) imageLightbox.value?.open(imageSrc.value)
}

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
  const width = window.innerWidth
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
  <div
    ref="explorerEl"
    class="chatui-file-explorer"
    :class="{
      'chatui-file-explorer--resizing': resizing,
      'chatui-file-explorer--vertical': resizeMode === 'vertical',
    }"
  >
    <div class="chatui-explorer-tree-wrap" :style="treeStyle">
      <div v-if="editable && hasRoot" class="chatui-explorer-tree-toolbar">
        <SIconButton
          variant="outline"
          size="sm"
          :title="L.explorerNewFolder"
          :disabled="busy"
          @click="handleNewFolder(rootPath)"
        >＋</SIconButton>
        <SIconButton
          variant="outline"
          size="sm"
          :title="L.explorerUpload"
          :disabled="busy"
          @click="handleUpload(rootPath)"
        >⤒</SIconButton>
      </div>
      <STree class="chatui-explorer-tree">
        <div v-if="!hasRoot" class="chatui-explorer-empty-tip">{{ L.explorerPickRootHint }}</div>
        <div v-else-if="rootLoading && rootRows.length === 0" class="chatui-explorer-empty-tip">{{ L.loading }}</div>
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
            <template v-if="editable" #actions>
              <SIconButton
                v-if="item.type === 'dir'"
                class="s-tree-node__hover-only"
                size="xs"
                variant="plain"
                :title="L.explorerNewSubfolder"
                :disabled="busy"
                @click="handleNewFolder(item.path)"
              >＋</SIconButton>
              <SIconButton
                v-if="item.type === 'dir'"
                class="s-tree-node__hover-only"
                size="xs"
                variant="plain"
                :title="L.explorerUploadHere"
                :disabled="busy"
                @click="handleUpload(item.path)"
              >⤒</SIconButton>
              <SIconButton
                class="s-tree-node__hover-only"
                size="xs"
                variant="plain"
                danger
                :title="L.explorerDelete"
                :disabled="busy"
                @click="handleDelete(item)"
              >×</SIconButton>
            </template>
          </STreeNode>
        </template>
      </STree>
      <input
        v-if="editable"
        ref="fileInputEl"
        type="file"
        multiple
        class="chatui-explorer-file-input"
        @change="onFilesSelected"
      />
    </div>

    <div
      class="chatui-explorer-splitter"
      :class="{ 'chatui-explorer-splitter--vertical': resizeMode === 'vertical' }"
      @pointerdown="startTreeResize"
    />

    <div class="chatui-explorer-viewer" @keydown="onEditorKeydown">
      <template v-if="selectedPath">
        <div class="chatui-explorer-toolbar">
          <span class="chatui-explorer-path">{{ selectedPath }}</span>
          <span class="chatui-explorer-meta">{{ fmtSize(fileSize) }}</span>
          <span v-if="isDirty" class="chatui-explorer-dirty" :title="L.explorerEditDirty">●</span>
          <SIconButton
            v-if="rawDownloadHref"
            variant="outline"
            size="sm"
            :href="rawDownloadHref"
            target="_blank"
            :title="L.explorerDownload || 'Download'"
          >⤓</SIconButton>
          <SIconButton
            v-if="canEdit && !editing"
            variant="outline"
            size="sm"
            :title="L.explorerEdit"
            @click="startEdit"
          >✎</SIconButton>
          <button
            v-if="editing"
            class="chatui-explorer-action chatui-explorer-action--primary"
            :disabled="saving || !isDirty"
            :title="L.explorerEditSave"
            @click="saveEdit"
          >{{ saving ? L.loading : L.explorerEditSave }}</button>
          <button
            v-if="editing"
            class="chatui-explorer-action"
            :disabled="saving"
            :title="L.explorerEditCancel"
            @click="cancelEdit"
          >{{ L.explorerEditCancel }}</button>
        </div>
        <div v-if="fileLoading" class="chatui-explorer-state">{{ L.loading }}</div>
        <div v-else-if="errMsg" class="chatui-explorer-state chatui-explorer-error">{{ errMsg }}</div>
        <div v-else-if="fileTooLarge" class="chatui-explorer-state">
          <div>{{ tpl(L.explorerTooLarge, { size: fmtSize(fileSize) }) }}</div>
          <a v-if="rawDownloadHref" class="chatui-explorer-link" :href="rawDownloadHref" target="_blank" rel="noopener">
            {{ L.explorerDownload || 'Download full file' }}
          </a>
        </div>
        <div v-else-if="isImageFile && imageSrc" class="chatui-explorer-image-wrap">
          <button class="chatui-explorer-image-button" :title="fileMimeType || selectedPath" @click="openImagePreview">
            <img :src="imageSrc" :alt="selectedPath" class="chatui-explorer-image" />
          </button>
        </div>
        <div v-else-if="isUnsupportedBinary" class="chatui-explorer-state">
          <div>{{ L.explorerBinaryFile }}</div>
          <a v-if="rawDownloadHref" class="chatui-explorer-link" :href="rawDownloadHref" target="_blank" rel="noopener">
            {{ L.explorerDownload || 'Download file' }}
          </a>
        </div>
        <CodeViewer
          v-else-if="editing"
          editable
          :content="draftContent"
          :path="selectedPath"
          class="chatui-explorer-content"
          @update:content="draftContent = $event"
        />
        <CodeViewer v-else :content="fileContent" :path="selectedPath" class="chatui-explorer-content" />
      </template>
      <div v-else class="chatui-explorer-state">{{ L.explorerSelectFile }}</div>
    </div>
    <ImageLightbox ref="imageLightbox" :labels="props.labels" />
  </div>
</template>

<style scoped>
.chatui-file-explorer {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-file-explorer--resizing,
.chatui-file-explorer--resizing * {
  user-select: none;
}
.chatui-explorer-tree-wrap {
  flex: 0 0 auto;
  align-self: stretch;
  min-width: 180px;
  max-width: calc(100% - 240px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chatui-explorer-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.chatui-explorer-tree-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface);
  flex-shrink: 0;
}
.chatui-explorer-file-input {
  display: none;
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
.chatui-file-explorer--resizing .chatui-explorer-splitter::after {
  background: var(--chatui-border-focus, var(--chatui-accent));
  opacity: 1;
}
.chatui-file-explorer--resizing .chatui-explorer-splitter {
  cursor: col-resize;
}
.chatui-explorer-empty-tip {
  padding: 24px 16px;
  color: var(--chatui-fg-secondary);
  font-size: 12px;
  text-align: center;
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
.chatui-explorer-dirty {
  flex-shrink: 0;
  color: var(--chatui-accent, #f59e0b);
  font-size: 12px;
  line-height: 1;
}
.chatui-explorer-action {
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--chatui-border);
  background: var(--chatui-bg);
  color: var(--chatui-fg);
  font-size: 12px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chatui-explorer-action:hover:not(:disabled) {
  background: var(--chatui-bg-hover, var(--chatui-bg-soft));
}
.chatui-explorer-action:disabled {
  opacity: 0.55;
  cursor: default;
}
.chatui-explorer-action--primary {
  background: var(--chatui-accent, #2563eb);
  border-color: var(--chatui-accent, #2563eb);
  color: #fff;
}
.chatui-explorer-action--primary:hover:not(:disabled) {
  filter: brightness(1.05);
  background: var(--chatui-accent, #2563eb);
}
.chatui-explorer-link {
  display: inline-block;
  margin-top: 8px;
  color: var(--chatui-link, #2563eb);
  font-size: 12px;
  text-decoration: underline;
}
.chatui-explorer-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
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
  min-height: 0;
  overflow: hidden;
  background: var(--chatui-bg);
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

.chatui-file-explorer--vertical { flex-direction: column; }
.chatui-file-explorer--vertical .chatui-explorer-tree-wrap {
  width: 100% !important;
  min-width: 0;
  max-width: none;
  min-height: 140px;
  max-height: calc(100% - 180px);
  align-self: auto;
}
.chatui-file-explorer--vertical .chatui-explorer-splitter {
  width: 100%;
  height: 8px;
  margin: -4px 0;
  cursor: row-resize;
}
.chatui-file-explorer--vertical .chatui-explorer-splitter::after {
  top: 3px;
  bottom: auto;
  left: 0;
  right: 0;
  width: auto;
  height: 1px;
}
.chatui-file-explorer--vertical.chatui-file-explorer--resizing .chatui-explorer-splitter {
  cursor: row-resize;
}
.chatui-file-explorer--vertical .chatui-explorer-image {
  max-height: calc(100vh - 320px);
}
</style>
