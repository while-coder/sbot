<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { sourceBadgeStyle } from '@/utils/badges'
import { SModal, SButton, STree, STreeNode } from 'sbot-ui'

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
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div style="display:flex;align-items:center;gap:8px">
        <span v-if="skillBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(skillBadge)}`">{{ skillBadge }}</span>
        <h3 class="s-modal-title" style="font-family:var(--sui-font-mono)">{{ skillName }}</h3>
      </div>
    </template>

    <div class="skill-viewer-body">
      <!-- Left: file tree -->
      <STree :header="t('common.files')" class="skill-tree">
        <div v-if="treeLoading" class="skill-tree-loading">{{ t('common.loading') }}</div>
        <template v-else>
          <STreeNode
            v-for="{ node, depth } in flatTree"
            :key="node.path"
            :level="depth"
            :type="node.type"
            :selected="selectedPath === node.path"
            :expandable="node.type === 'dir'"
            :expanded="node.type === 'dir' && !collapsed.has(node.path)"
            @click="node.type === 'dir' ? toggleDir(node.path) : selectFile(node.path)"
          >
            {{ node.name }}
          </STreeNode>
        </template>
      </STree>

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

    <template #footer>
      <SButton type="outline" @click="close">{{ t('common.close') }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.skill-viewer-body {
  display: flex;
  height: 70vh;
  overflow: hidden;
  margin: calc(-1 * var(--sui-sp-7)) calc(-1 * var(--sui-sp-8));
}
.skill-tree {
  width: 210px;
  flex-shrink: 0;
}
.skill-tree-loading {
  padding: 20px;
  text-align: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}

.skill-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.skill-content-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-4);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
  background: var(--sui-bg);
}
.skill-file-path {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
}
.skill-content-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
.skill-content-pre {
  margin: 0;
  padding: var(--sui-sp-4) var(--sui-sp-5);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--sui-fg);
  overflow: auto;
  flex: 1;
}
.skill-content-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}

@media (max-width: 768px) {
  .skill-viewer-body { flex-direction: column; }
  .skill-tree {
    width: 100%;
    max-height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--sui-border);
  }
}
</style>
