<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, STree, STreeNode } from 'sbot-ui'

const props = defineProps<{
  root?: string
}>()

const { t } = useI18n()
const { show } = useToast()

type FsItem = { name: string; path: string; type: 'dir' | 'file'; size?: number }
type DirState = {
  loaded: boolean
  loading: boolean
  expanded: boolean
  items: FsItem[]
}

const dirStates = ref<Map<string, DirState>>(new Map())
const selectedPath = ref('')
const fileContent = ref('')
const fileSize = ref(0)
const fileTooLarge = ref(false)
const fileBinary = ref(false)
const fileLoading = ref(false)

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
  try {
    const res = await apiFetch(`/api/fs/tree?dir=${encodeURIComponent(dir)}`)
    state.items = res.data?.items || []
    state.loaded = true
  } catch (e: any) {
    show(e.message, 'error')
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

async function selectFile(item: FsItem): Promise<void> {
  if (selectedPath.value === item.path) return
  selectedPath.value = item.path
  fileContent.value = ''
  fileSize.value = item.size ?? 0
  fileTooLarge.value = false
  fileBinary.value = false
  fileLoading.value = true
  try {
    const res = await apiFetch(`/api/fs/read?path=${encodeURIComponent(item.path)}`)
    fileContent.value = res.data?.content ?? ''
    fileSize.value = res.data?.size ?? 0
    fileTooLarge.value = !!res.data?.tooLarge
    fileBinary.value = !!res.data?.isBinary
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    fileLoading.value = false
  }
}

type FlatRow = { item: FsItem; depth: number }
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
  if (val) {
    await loadDir(val)
    const s = dirStates.value.get(val)!
    s.expanded = true
    dirStates.value = new Map(dirStates.value)
  }
}, { immediate: true })

const fileLang = computed(() => {
  const p = selectedPath.value
  const i = p.lastIndexOf('.')
  return i > 0 ? p.slice(i + 1).toLowerCase() : ''
})
</script>

<template>
  <div class="explorer">
    <STree :header="props.root || t('explorer.no_root')" class="explorer-tree">
      <div v-if="!props.root" class="explorer-empty-tip">{{ t('explorer.pick_root_hint') }}</div>
      <div v-else-if="rootLoading && rootRows.length === 0" class="explorer-empty-tip">{{ t('common.loading') }}</div>
      <div v-else-if="rootRows.length === 0" class="explorer-empty-tip">{{ t('explorer.empty_dir') }}</div>
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

    <div class="explorer-viewer">
      <template v-if="selectedPath">
        <div class="explorer-toolbar">
          <span class="explorer-path">{{ selectedPath }}</span>
          <span class="explorer-meta">{{ fmtSize(fileSize) }}</span>
        </div>
        <div v-if="fileLoading" class="explorer-state">{{ t('common.loading') }}</div>
        <div v-else-if="fileBinary" class="explorer-state">{{ t('explorer.binary_file') }}</div>
        <div v-else-if="fileTooLarge" class="explorer-state">{{ t('explorer.too_large', { size: fmtSize(fileSize) }) }}</div>
        <pre v-else class="explorer-content" :data-lang="fileLang">{{ fileContent }}</pre>
      </template>
      <div v-else class="explorer-state">{{ t('explorer.select_a_file') }}</div>
    </div>
  </div>
</template>

<style scoped>
.explorer {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.explorer-tree {
  width: 280px;
  flex-shrink: 0;
}
.explorer-empty-tip {
  padding: var(--sui-sp-6) var(--sui-sp-5);
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
  text-align: center;
}

.explorer-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--sui-bg);
}
.explorer-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
  background: var(--sui-bg);
}
.explorer-path {
  flex: 1;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.explorer-meta {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-muted);
  flex-shrink: 0;
}
.explorer-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
.explorer-content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: var(--sui-sp-5) var(--sui-sp-7);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  line-height: 1.6;
  color: var(--sui-fg);
  background: var(--sui-bg);
  white-space: pre;
}

@media (max-width: 768px) {
  .explorer { flex-direction: column; }
  .explorer-tree { width: 100%; max-height: 220px; }
}
</style>
