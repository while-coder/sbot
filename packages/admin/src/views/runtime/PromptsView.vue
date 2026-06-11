<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm } from 'sbot-ui'
import { SButton, SIconButton, SBadge, SChip, STree, STreeNode } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

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

const categoryOrder = ['system', 'agent', 'compact', 'note', 'wiki', 'skills', 'memory', 'tools', 'intent', 'heartbeat', 'todo']

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
  if (!await confirm(t('prompts.confirm_delete', { name: filePath }), { danger: true })) return
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
    <STree :header="t('prompts.header')" class="prompts-tree">
      <template v-for="cat in categories" :key="cat.key">
        <STreeNode
          type="category"
          :expandable="true"
          :expanded="!collapsedCats.has(cat.key)"
          @click="toggleCat(cat.key)"
        >
          {{ cat.label }}
          <template #suffix>
            <span v-if="cat.node.isOverride" class="prompts-dot" :title="t('prompts.contains_custom')" />
          </template>
          <template v-if="cat.key === 'heartbeat'" #actions>
            <SIconButton size="xs" variant="outline" :title="t('prompts.create_file')" @click.stop="startCreate(cat.key)">+</SIconButton>
          </template>
        </STreeNode>
        <template v-if="!collapsedCats.has(cat.key)">
          <div v-if="creatingInCat === cat.key" class="prompts-new-row">
            <input
              v-model="newFileName"
              class="prompts-new-input"
              :placeholder="t('prompts.create_file')"
              @keyup.enter="confirmCreate(cat.key)"
              @keyup.escape="cancelCreate"
            />
            <SIconButton size="xs" @click="confirmCreate(cat.key)">&#10003;</SIconButton>
            <SIconButton size="xs" @click="cancelCreate">&#10005;</SIconButton>
          </div>
          <STreeNode
            v-for="{ node, depth } in flattenChildren(cat.node)"
            :key="node.path"
            :type="node.type === 'dir' ? 'dir' : 'file'"
            :level="depth + 1"
            :selected="selectedPath === node.path"
            @click="node.type === 'dir' ? toggleDir(node.path) : selectFile(node.path)"
          >
            <template #icon>
              <span>{{ node.type === 'dir' ? (collapsed.has(node.path) ? '▶' : '▼') : '·' }}</span>
            </template>
            {{ node.name }}
            <template #suffix>
              <span v-if="node.isOverride && !node.isUserOnly" class="prompts-dot" :title="node.type === 'dir' ? t('prompts.contains_custom') : t('prompts.custom_title')" />
              <span v-if="node.isUserOnly" class="prompts-user-badge" :title="t('prompts.user_only')">&#9679;</span>
            </template>
            <template v-if="node.isUserOnly && node.type === 'file'" #actions>
              <SIconButton size="xs" variant="plain" danger class="s-tree-node__hover-only" :title="t('common.delete')" @click.stop="deleteFile(node.path)">&times;</SIconButton>
            </template>
          </STreeNode>
        </template>
      </template>
    </STree>

    <!-- Right: editor -->
    <div class="prompts-editor">
      <template v-if="selectedPath">
        <div class="prompts-editor-toolbar">
          <span class="prompts-file-path">{{ selectedPath }}</span>
          <SBadge v-if="isOverride" variant="info" pill>{{ t('prompts.badge_custom') }}</SBadge>
          <SBadge v-else variant="neutral" pill>{{ t('prompts.badge_default') }}</SBadge>
          <span style="flex:1" />
          <SButton type="outline" size="sm" :disabled="!isOverride || isUserOnly" @click="reset">{{ t('prompts.reset') }}</SButton>
          <SButton type="primary" size="sm" :disabled="saving || !isDirty" :loading="saving" @click="save">
            {{ saving ? t('prompts.saving') : t('prompts.save') }}
          </SButton>
        </div>
        <div v-if="vars.length" class="prompts-vars-bar">
          <span class="prompts-vars-label">{{ t('prompts.vars_label') }}</span>
          <SChip v-for="v in vars" :key="v.name" variant="warning" :title="v.description">{{ '{' + v.name + '}' }}</SChip>
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
.prompts-tree {
  width: 210px;
  flex-shrink: 0;
}

.prompts-new-row {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px 4px 28px;
}
.prompts-new-input {
  flex: 1;
  font-size: var(--sui-fs-sm);
  padding: 2px var(--sui-sp-2);
  border: 1px solid var(--sui-border-strong);
  border-radius: var(--sui-radius-xs);
  outline: none;
  min-width: 0;
  background: var(--sui-bg);
  color: var(--sui-fg);
}
.prompts-new-input:focus { border-color: var(--sui-info); }

.prompts-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sui-info);
  display: inline-block;
}
.prompts-user-badge {
  font-size: 6px;
  color: var(--sui-success-fg);
}

.prompts-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.prompts-editor-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
  background: var(--sui-bg);
}
.prompts-file-path {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
}
.prompts-vars-bar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: 5px var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
  background: var(--sui-warning-bg);
  flex-wrap: wrap;
}
.prompts-vars-label {
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  color: var(--sui-warning-label);
  margin-right: 2px;
}
.prompts-loading,
.prompts-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
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
  padding: var(--sui-sp-6) var(--sui-sp-7);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-md);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  box-sizing: border-box;
  margin: 0;
}
.prompts-highlight {
  overflow: hidden;
  pointer-events: none;
  color: var(--sui-fg);
  background: var(--sui-bg);
}
.prompts-textarea {
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  color: transparent;
  caret-color: var(--sui-fg);
  background: transparent;
}
:deep(.tpl-var) {
  color: var(--sui-warning-fg);
  background: var(--sui-warning-chip-bg);
  border-radius: 3px;
  font-style: normal;
}

@media (max-width: 768px) {
  .prompts-layout { flex-direction: column; }
  .prompts-tree {
    width: 100%;
    max-height: 200px;
  }
  .prompts-editor { width: 100%; }
}
</style>
