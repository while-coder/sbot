<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()

// ── Tree ──────────────────────────────────────────────────────────
type TreeNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; isUserOnly?: boolean; children?: TreeNode[] }

const tree = ref<TreeNode[]>([])
const collapsed = ref(new Set<string>())

function flattenTree(nodes: TreeNode[], depth = 0): { node: TreeNode; depth: number }[] {
  const result: { node: TreeNode; depth: number }[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.type === 'dir' && !collapsed.value.has(node.path)) {
      result.push(...flattenTree(node.children || [], depth + 1))
    }
  }
  return result
}

const categoryOrder = ['system', 'agent', 'memory', 'wiki', 'skills', 'insight', 'tools', 'heartbeat']

const categories = computed(() => {
  const map = new Map<string, TreeNode>()
  for (const node of tree.value) {
    if (node.type === 'dir') map.set(node.name, node)
  }
  const order = [...categoryOrder]
  for (const node of tree.value) {
    if (node.type === 'dir' && !order.includes(node.name)) order.push(node.name)
  }
  return order
    .filter(name => map.has(name))
    .map(name => ({
      key: name,
      label: t(`prompts.cat_${name}`, name),
      node: map.get(name)!,
    }))
})

const collapsedCats = ref(new Set<string>())
const STORAGE_KEY = 'prompts-tree-state'

function saveTreeState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    collapsed: [...collapsed.value],
    collapsedCats: [...collapsedCats.value],
  }))
}

function restoreTreeState() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const state = JSON.parse(raw)
      collapsed.value = new Set(state.collapsed || [])
      collapsedCats.value = new Set(state.collapsedCats || [])
      return
    } catch {}
  }
  const allDirs: string[] = []
  function collectDirs(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === 'dir') {
        allDirs.push(n.path)
        if (n.children) collectDirs(n.children)
      }
    }
  }
  collectDirs(tree.value)
  collapsed.value = new Set(allDirs)
  collapsedCats.value = new Set(tree.value.filter(n => n.type === 'dir').map(n => n.name))
}

function toggleCat(name: string) {
  if (collapsedCats.value.has(name)) collapsedCats.value.delete(name)
  else collapsedCats.value.add(name)
  collapsedCats.value = new Set(collapsedCats.value)
  saveTreeState()
}

function flattenChildren(parent: TreeNode) {
  return flattenTree(parent.children || [], 0)
}

async function loadTree() {
  try {
    const res = await apiFetch('/api/prompts/tree')
    tree.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function toggleDir(p: string) {
  if (collapsed.value.has(p)) collapsed.value.delete(p)
  else collapsed.value.add(p)
  collapsed.value = new Set(collapsed.value)
  saveTreeState()
}

// ── Editor ────────────────────────────────────────────────────────
type VarMeta = { name: string; description: string }

const selectedPath = ref('')
const editContent = ref('')
const originalContent = ref('')
const isOverride = ref(false)
const loading = ref(false)
const saving = ref(false)
const vars = ref<VarMeta[]>([])

const isDirty = computed(() => editContent.value !== originalContent.value)

const isUserOnly = computed(() => {
  function find(nodes: TreeNode[]): boolean {
    for (const n of nodes) {
      if (n.type === 'file' && n.path === selectedPath.value) return !!n.isUserOnly
      if (n.children) { const r = find(n.children); if (r) return true }
    }
    return false
  }
  return find(tree.value)
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const highlightRef = ref<HTMLDivElement | null>(null)

function syncScroll() {
  if (textareaRef.value && highlightRef.value) {
    highlightRef.value.scrollTop = textareaRef.value.scrollTop
    highlightRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

const highlightedContent = computed(() => {
  const escaped = editContent.value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/\{[^}]*\}/g, '<mark class="tpl-var">$&</mark>') + '\n'
})

async function selectFile(p: string) {
  if (selectedPath.value === p) return
  selectedPath.value = p
  loading.value = true
  editContent.value = ''
  originalContent.value = ''
  vars.value = []
  try {
    const res = await apiFetch(`/api/prompts/content?path=${encodeURIComponent(p)}`)
    editContent.value = res.data?.content ?? ''
    originalContent.value = editContent.value
    isOverride.value = res.data?.isOverride ?? false
    vars.value = res.data?.vars ?? []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!selectedPath.value || saving.value) return
  saving.value = true
  try {
    await apiFetch('/api/prompts/content', 'PUT', { path: selectedPath.value, content: editContent.value })
    originalContent.value = editContent.value
    isOverride.value = true
    show(t('common.saved'))
    loadTree()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!selectedPath.value || !isOverride.value) return
  try {
    await apiFetch(`/api/prompts/content?path=${encodeURIComponent(selectedPath.value)}`, 'DELETE')
    const res = await apiFetch(`/api/prompts/content?path=${encodeURIComponent(selectedPath.value)}`)
    editContent.value = res.data?.content ?? ''
    originalContent.value = editContent.value
    isOverride.value = false
    show(t('common.saved'))
    loadTree()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Create / Delete ──────────────────────────────────────────────
const creatingInCat = ref<string | null>(null)
const newFileName = ref('')

function startCreate(cat: string) {
  creatingInCat.value = cat
  newFileName.value = ''
}

function cancelCreate() {
  creatingInCat.value = null
  newFileName.value = ''
}

async function confirmCreate(category: string) {
  const name = newFileName.value.trim()
  if (!name) return
  const filePath = `${category}/${name}${name.includes('.') ? '' : '.md'}`
  try {
    await apiFetch('/api/prompts/content', 'PUT', { path: filePath, content: '' })
    show(t('common.created'))
    cancelCreate()
    await loadTree()
    selectFile(filePath)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function deleteFile(filePath: string) {
  if (!window.confirm(t('prompts.confirm_delete', { name: filePath }))) return
  try {
    await apiFetch(`/api/prompts/content?path=${encodeURIComponent(filePath)}`, 'DELETE')
    show(t('common.deleted'))
    if (selectedPath.value === filePath) {
      selectedPath.value = ''
      editContent.value = ''
    }
    await loadTree()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(async () => {
  await loadTree()
  restoreTreeState()
})
</script>

<template>
  <div class="prompts-layout">
    <!-- Left: file tree -->
    <div class="prompts-tree">
      <div class="prompts-tree-header">{{ t('prompts.header') }}</div>
      <template v-for="cat in categories" :key="cat.key">
        <div class="tree-category" @click="toggleCat(cat.key)">
          <span class="tree-icon">{{ collapsedCats.has(cat.key) ? '▶' : '▼' }}</span>
          <span class="tree-cat-label">{{ cat.label }}</span>
          <span v-if="cat.node.isOverride" class="tree-custom-dot" :title="t('prompts.contains_custom')"></span>
          <button v-if="cat.key === 'heartbeat'" class="tree-add-btn" @click.stop="startCreate(cat.key)" :title="t('prompts.create_file')">+</button>
        </div>
        <template v-if="!collapsedCats.has(cat.key)">
          <div v-if="creatingInCat === cat.key" class="tree-item tree-file" style="padding-left:14px;gap:3px">
            <input
              v-model="newFileName"
              class="tree-new-input"
              :placeholder="t('prompts.create_file')"
              @keyup.enter="confirmCreate(cat.key)"
              @keyup.escape="cancelCreate"
            />
            <button class="tree-inline-btn" @click="confirmCreate(cat.key)">&#10003;</button>
            <button class="tree-inline-btn" @click="cancelCreate">&#10005;</button>
          </div>
          <div
            v-for="{ node, depth } in flattenChildren(cat.node)"
            :key="node.path"
            class="tree-item"
            :class="{
              'tree-dir': node.type === 'dir',
              'tree-file': node.type === 'file',
              'tree-selected': selectedPath === node.path,
            }"
            :style="{ paddingLeft: `${14 + depth * 14}px` }"
            @click="node.type === 'dir' ? toggleDir(node.path) : selectFile(node.path)"
          >
            <span class="tree-icon">{{ node.type === 'dir' ? (collapsed.has(node.path) ? '▶' : '▼') : '·' }}</span>
            <span class="tree-name">{{ node.name }}</span>
            <span v-if="node.isOverride && !node.isUserOnly" class="tree-custom-dot" :title="node.type === 'dir' ? t('prompts.contains_custom') : t('prompts.custom_title')"></span>
            <span v-if="node.isUserOnly" class="tree-user-badge" :title="t('prompts.user_only')">&#9679;</span>
            <button v-if="node.isUserOnly && node.type === 'file'" class="tree-delete-btn" @click.stop="deleteFile(node.path)" :title="t('common.delete')">&times;</button>
          </div>
        </template>
      </template>
    </div>

    <!-- Right: editor -->
    <div class="prompts-editor">
      <template v-if="selectedPath">
        <div class="prompts-editor-toolbar">
          <span class="prompts-file-path">{{ selectedPath }}</span>
          <span v-if="isOverride" class="prompts-badge-custom">{{ t('prompts.badge_custom') }}</span>
          <span v-else class="prompts-badge-default">{{ t('prompts.badge_default') }}</span>
          <span style="flex:1" />
          <button class="btn-outline btn-sm" :disabled="!isOverride || isUserOnly" @click="reset">{{ t('prompts.reset') }}</button>
          <button class="btn-primary btn-sm" :disabled="saving || !isDirty" @click="save">
            {{ saving ? t('prompts.saving') : t('prompts.save') }}
          </button>
        </div>
        <div v-if="vars.length" class="prompts-vars-bar">
          <span class="prompts-vars-label">{{ t('prompts.vars_label') }}</span>
          <span v-for="v in vars" :key="v.name" class="prompts-var-chip" :title="v.description">{{ '{' + v.name + '}' }}</span>
        </div>
        <div v-if="loading" class="prompts-loading">{{ t('prompts.loading') }}</div>
        <div v-else class="prompts-editor-body">
          <div ref="highlightRef" class="prompts-highlight" aria-hidden="true" v-html="highlightedContent" />
          <textarea
            ref="textareaRef"
            v-model="editContent"
            class="prompts-textarea"
            spellcheck="false"
            @scroll="syncScroll"
          />
        </div>
      </template>
      <div v-else class="prompts-empty">{{ t('prompts.empty') }}</div>
    </div>
  </div>
</template>

<style scoped>
.prompts-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* Tree */
.prompts-tree {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid #e8e6e3;
  overflow-y: auto;
  background: #fafaf9;
}
.prompts-tree-header {
  padding: 10px 12px 6px;
  font-size: 11px;
  font-weight: 700;
  color: #6b6b6b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid #e8e6e3;
}
.tree-category {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px 5px;
  font-size: 12px;
  font-weight: 700;
  color: #4a4a4a;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #ece8e4;
  margin-top: 2px;
}
.tree-category:first-child { margin-top: 0; }
.tree-category:hover { background: #f0ece8; }
.tree-cat-label { flex: 1; }
.tree-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 8px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  margin: 1px 4px;
}
.tree-item:hover { background: #ede9e6; }
.tree-selected { background: #e8e4e0 !important; font-weight: 600; color: #1c1c1c; }
.tree-dir { color: #3d3d3d; font-weight: 500; }
.tree-file { color: #555; }
.tree-icon { font-size: 9px; color: #9b9b9b; width: 12px; flex-shrink: 0; }
.tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tree-custom-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
  flex-shrink: 0;
  margin-left: auto;
}
.tree-user-badge {
  font-size: 6px;
  color: #16a34a;
  flex-shrink: 0;
  margin-left: auto;
}
.tree-add-btn {
  margin-left: auto;
  background: none;
  border: 1px solid #d0ccc8;
  border-radius: 4px;
  width: 20px;
  height: 20px;
  font-size: 14px;
  line-height: 1;
  color: #6b6b6b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tree-add-btn:hover { background: #e8e4e0; color: #1c1c1c; }
.tree-new-input {
  flex: 1;
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid #d0ccc8;
  border-radius: 3px;
  outline: none;
  min-width: 0;
}
.tree-new-input:focus { border-color: #3b82f6; }
.tree-inline-btn {
  background: none;
  border: none;
  font-size: 13px;
  cursor: pointer;
  color: #6b6b6b;
  padding: 0 2px;
}
.tree-inline-btn:hover { color: #1c1c1c; }
.tree-delete-btn {
  background: none;
  border: none;
  font-size: 15px;
  cursor: pointer;
  color: #9b9b9b;
  padding: 0 2px;
  flex-shrink: 0;
  display: none;
}
.tree-item:hover .tree-delete-btn { display: block; }
.tree-delete-btn:hover { color: #dc2626; }

/* Editor */
.prompts-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.prompts-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
  background: #fff;
}
.prompts-file-path {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: #3d3d3d;
}
.prompts-badge-custom {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: #dbeafe;
  color: #1d4ed8;
}
.prompts-badge-default {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: #f3f4f6;
  color: #6b7280;
}
.prompts-vars-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
  background: #fffbf5;
  flex-wrap: wrap;
}
.prompts-vars-label {
  font-size: 11px;
  font-weight: 600;
  color: #8b6c2a;
  margin-right: 2px;
}
.prompts-var-chip {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fff3e0;
  color: #c05c00;
  cursor: default;
}
.prompts-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}
.prompts-editor-body {
  position: relative;
  flex: 1;
  overflow: hidden;
}
.prompts-highlight,
.prompts-textarea {
  position: absolute;
  inset: 0;
  padding: 14px 16px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  box-sizing: border-box;
  margin: 0;
}
.prompts-highlight {
  overflow: hidden;
  pointer-events: none;
  color: #1c1c1c;
  background: #fff;
}
.prompts-textarea {
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  color: transparent;
  caret-color: #1c1c1c;
  background: transparent;
}
:deep(.tpl-var) {
  color: #c05c00;
  background: #fff3e0;
  border-radius: 3px;
  font-style: normal;
}
.prompts-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}

@media (max-width: 768px) {
  .prompts-layout { flex-direction: column; }
  .prompts-tree {
    width: 100%;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid #e8e6e3;
  }
  .prompts-editor { width: 100%; }
}
</style>
