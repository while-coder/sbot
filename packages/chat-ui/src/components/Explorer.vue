<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { STree, STreeNode } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, FsTreeItem } from '../types'
import { resolveLabels, tpl } from '../labels'

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
const selectedPath = ref('')
const fileContent = ref('')
const fileSize = ref(0)
const fileTooLarge = ref(false)
const fileBinary = ref(false)
const fileLoading = ref(false)
const errMsg = ref('')
const refreshing = ref(false)

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
  fileSize.value = item.size ?? 0
  fileTooLarge.value = false
  fileBinary.value = false
  fileLoading.value = true
  errMsg.value = ''
  try {
    const res = await props.transport.readFile(item.path)
    fileContent.value = res.content ?? ''
    fileSize.value = res.size ?? 0
    fileTooLarge.value = !!res.tooLarge
    fileBinary.value = !!res.isBinary
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

watch(() => props.root, async (val) => {
  dirStates.value = new Map()
  selectedPath.value = ''
  fileContent.value = ''
  errMsg.value = ''
  if (val) {
    await loadDir(val)
    const s = dirStates.value.get(val)
    if (s) {
      s.expanded = true
      dirStates.value = new Map(dirStates.value)
    }
  }
}, { immediate: true })

async function refresh(): Promise<void> {
  const rootPath = props.root
  if (!rootPath || refreshing.value) return
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
</script>

<template>
  <div class="chatui-explorer">
    <STree class="chatui-explorer-tree">
      <template #header>
        <div class="chatui-explorer-header">
          <span class="chatui-explorer-header-text">{{ props.root || L.explorerNoRoot }}</span>
          <button
            v-if="props.root"
            class="chatui-explorer-refresh"
            :class="{ 'chatui-explorer-refresh--spinning': refreshing }"
            :disabled="refreshing"
            :title="L.refresh"
            @click="refresh"
          >↻</button>
        </div>
      </template>
      <div v-if="!props.root" class="chatui-explorer-empty-tip">{{ L.explorerPickRootHint }}</div>
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
        </STreeNode>
      </template>
    </STree>

    <div class="chatui-explorer-viewer">
      <template v-if="selectedPath">
        <div class="chatui-explorer-toolbar">
          <span class="chatui-explorer-path">{{ selectedPath }}</span>
          <span class="chatui-explorer-meta">{{ fmtSize(fileSize) }}</span>
        </div>
        <div v-if="fileLoading" class="chatui-explorer-state">{{ L.loading }}</div>
        <div v-else-if="errMsg" class="chatui-explorer-state chatui-explorer-error">{{ errMsg }}</div>
        <div v-else-if="fileBinary" class="chatui-explorer-state">{{ L.explorerBinaryFile }}</div>
        <div v-else-if="fileTooLarge" class="chatui-explorer-state">
          {{ tpl(L.explorerTooLarge, { size: fmtSize(fileSize) }) }}
        </div>
        <pre v-else class="chatui-explorer-content" :data-lang="fileLang">{{ fileContent }}</pre>
      </template>
      <div v-else class="chatui-explorer-state">{{ L.explorerSelectFile }}</div>
    </div>
  </div>
</template>

<style scoped>
.chatui-explorer {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--chatui-bg);
}
.chatui-explorer-tree {
  width: 260px;
  flex-shrink: 0;
}
.chatui-explorer-header {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  text-transform: none; letter-spacing: 0;
}
.chatui-explorer-header-text {
  flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: monospace;
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

@media (max-width: 768px) {
  .chatui-explorer { flex-direction: column; }
  .chatui-explorer-tree { width: 100%; max-height: 220px; }
}
</style>
