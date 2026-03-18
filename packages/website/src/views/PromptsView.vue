<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { show } = useToast()

// ── Tree ──────────────────────────────────────────────────────────
type TreeNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; children?: TreeNode[] }

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

const flatTree = computed(() => flattenTree(tree.value))

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
  // trigger reactivity
  collapsed.value = new Set(collapsed.value)
}

// ── Editor ────────────────────────────────────────────────────────
const selectedPath = ref('')
const editContent = ref('')
const originalContent = ref('')
const isOverride = ref(false)
const loading = ref(false)
const saving = ref(false)

const isDirty = computed(() => editContent.value !== originalContent.value)

async function selectFile(p: string) {
  if (selectedPath.value === p) return
  selectedPath.value = p
  loading.value = true
  editContent.value = ''
  originalContent.value = ''
  try {
    const res = await apiFetch(`/api/prompts/content?path=${encodeURIComponent(p)}`)
    editContent.value = res.data?.content ?? ''
    originalContent.value = editContent.value
    isOverride.value = res.data?.isOverride ?? false
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
    show('Saved')
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
    show('Reset to default')
    loadTree()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(loadTree)
</script>

<template>
  <div class="prompts-layout">
    <!-- Left: file tree -->
    <div class="prompts-tree">
      <div class="prompts-tree-header">Prompts</div>
      <div
        v-for="{ node, depth } in flatTree"
        :key="node.path"
        class="tree-item"
        :class="{
          'tree-dir': node.type === 'dir',
          'tree-file': node.type === 'file',
          'tree-selected': selectedPath === node.path,
        }"
        :style="{ paddingLeft: `${10 + depth * 14}px` }"
        @click="node.type === 'dir' ? toggleDir(node.path) : selectFile(node.path)"
      >
        <span class="tree-icon">{{ node.type === 'dir' ? (collapsed.has(node.path) ? '▶' : '▼') : '·' }}</span>
        <span class="tree-name">{{ node.name }}</span>
        <span v-if="node.isOverride" class="tree-custom-dot" :title="node.type === 'dir' ? 'Contains custom prompts' : 'Custom'"></span>
      </div>
    </div>

    <!-- Right: editor -->
    <div class="prompts-editor">
      <template v-if="selectedPath">
        <div class="prompts-editor-toolbar">
          <span class="prompts-file-path">{{ selectedPath }}</span>
          <span v-if="isOverride" class="prompts-badge-custom">Custom</span>
          <span v-else class="prompts-badge-default">Default</span>
          <span style="flex:1" />
          <button class="btn-outline btn-sm" :disabled="!isOverride" @click="reset">Reset</button>
          <button class="btn-primary btn-sm" :disabled="saving || !isDirty" @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <div v-if="loading" class="prompts-loading">Loading…</div>
        <textarea
          v-else
          v-model="editContent"
          class="prompts-textarea"
          spellcheck="false"
        />
      </template>
      <div v-else class="prompts-empty">Select a prompt file to edit</div>
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
.prompts-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}
.prompts-textarea {
  flex: 1;
  width: 100%;
  padding: 14px 16px;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #1c1c1c;
  background: #fff;
}
.prompts-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}
</style>
