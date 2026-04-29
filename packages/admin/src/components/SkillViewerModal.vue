<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

// ── State ────────────────────────────────────────────────────────
const visible = ref(false)
const skillName = ref('')
const skillBadge = ref('')
const skillApiBase = ref('/api/skills')

// ── Tree ─────────────────────────────────────────────────────────
type TreeNode = { name: string; type: 'file' | 'dir'; path: string; children?: TreeNode[] }

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

function toggleDir(p: string) {
  if (collapsed.value.has(p)) collapsed.value.delete(p)
  else collapsed.value.add(p)
  collapsed.value = new Set(collapsed.value)
}

// ── File viewer ──────────────────────────────────────────────────
const selectedPath = ref('')
const fileContent = ref('')
const fileLoading = ref(false)
const treeLoading = ref(false)

async function selectFile(p: string) {
  if (selectedPath.value === p) return
  selectedPath.value = p
  fileLoading.value = true
  fileContent.value = ''
  try {
    const res = await apiFetch(`${skillApiBase.value}/${encodeURIComponent(skillName.value)}/file?path=${encodeURIComponent(p)}`)
    fileContent.value = res.data?.content ?? ''
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    fileLoading.value = false
  }
}

// ── Public API ───────────────────────────────────────────────────
async function open(name: string, badge: string, apiBase = '/api/skills') {
  skillName.value = name
  skillBadge.value = badge
  skillApiBase.value = apiBase
  tree.value = []
  selectedPath.value = ''
  fileContent.value = ''
  collapsed.value = new Set()
  treeLoading.value = true
  visible.value = true

  try {
    const res = await apiFetch(`${apiBase}/${encodeURIComponent(name)}/tree`)
    tree.value = res.data || []
    // Auto-select SKILL.md
    const skillMd = flattenTree(tree.value).find(({ node }) => node.type === 'file' && node.name === 'SKILL.md')
    if (skillMd) {
      selectFile(skillMd.node.path)
    }
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    treeLoading.value = false
  }
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-box skill-viewer-box">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span v-if="skillBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(skillBadge)}`">{{ skillBadge }}</span>
          <h3 style="margin:0;font-family:monospace">{{ skillName }}</h3>
        </div>
        <button class="modal-close" @click="close">&times;</button>
      </div>

      <div class="skill-viewer-body">
        <!-- Left: file tree -->
        <div class="skill-tree">
          <div class="skill-tree-header">{{ t('common.files') }}</div>
          <div v-if="treeLoading" class="skill-tree-loading">{{ t('common.loading') }}</div>
          <template v-else>
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
              <span class="tree-icon">{{ node.type === 'dir' ? (collapsed.has(node.path) ? '\u25B6' : '\u25BC') : '\u00B7' }}</span>
              <span class="tree-name">{{ node.name }}</span>
            </div>
          </template>
        </div>

        <!-- Right: file content -->
        <div class="skill-content">
          <template v-if="selectedPath">
            <div class="skill-content-toolbar">
              <span class="skill-file-path">{{ selectedPath }}</span>
            </div>
            <div v-if="fileLoading" class="skill-content-loading">{{ t('common.loading') }}</div>
            <pre v-else class="skill-content-pre">{{ fileContent }}</pre>
          </template>
          <div v-else class="skill-content-empty">{{ t('skills.select_file') }}</div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-outline" @click="close">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-viewer-box {
  width: 90vw;
  max-width: 900px;
  height: 75vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.skill-viewer-box > .modal-header {
  padding: 14px 20px;
  flex-shrink: 0;
}
.skill-viewer-box > .modal-footer {
  padding: 10px 20px;
  flex-shrink: 0;
}

.skill-viewer-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  border-top: 1px solid #e8e6e3;
  border-bottom: 1px solid #e8e6e3;
}

/* Tree */
.skill-tree {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid #e8e6e3;
  overflow-y: auto;
  background: #fafaf9;
}
.skill-tree-header {
  padding: 10px 12px 6px;
  font-size: 11px;
  font-weight: 700;
  color: #6b6b6b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid #e8e6e3;
}
.skill-tree-loading {
  padding: 20px;
  text-align: center;
  color: #9b9b9b;
  font-size: 13px;
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

/* Content */
.skill-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.skill-content-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
  background: #fff;
}
.skill-file-path {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: #3d3d3d;
}
.skill-content-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}
.skill-content-pre {
  margin: 0;
  padding: 14px 16px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: #1e293b;
  overflow: auto;
  flex: 1;
}
.skill-content-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9b9b9b;
  font-size: 13px;
}

@media (max-width: 768px) {
  .skill-viewer-body { flex-direction: column; }
  .skill-tree {
    width: 100%;
    max-height: 180px;
    border-right: none;
    border-bottom: 1px solid #e8e6e3;
  }
}
</style>
