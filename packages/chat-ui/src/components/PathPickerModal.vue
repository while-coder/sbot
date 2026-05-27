<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { SModal, SButton, SInput, SChip } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{ confirm: [path: string, rootId: string] }>()

const pickerOpen    = ref(false)
const pickerLoading = ref(false)
const pickerPath    = ref('')
const pickerRelPath = ref('')
const pickerRootPath = ref('')
const pickerRootId  = ref('')
const pickerParent  = ref<string | null>(null)
const pickerItems   = ref<string[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<InstanceType<typeof SInput> | null>(null)
const pickerQuickDirs = ref<{ label: string; path: string; rootId: string }[]>([])

function normalizeDisplayPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function relativeToRoot(rootPath: string, targetPath: string): string | null {
  const root = normalizeDisplayPath(rootPath)
  const target = normalizeDisplayPath(targetPath)
  if (target === root) return ''
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1)
  return null
}

function joinDisplayPath(rootPath: string, relPath: string): string {
  if (!relPath) return rootPath
  const sep = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${sep}${relPath.replace(/\//g, sep)}`
}

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).filter(Boolean).pop() || p
}

function resetCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

async function navigatePicker(rootId: string, relPath = '', rootPath?: string): Promise<boolean> {
  if (!rootId) return false
  resetCreate()
  pickerLoading.value = true
  try {
    const res = await props.transport.listDir(rootId, relPath)
    if (rootPath) pickerRootPath.value = rootPath
    pickerRootId.value = res.rootId
    pickerRelPath.value = res.path
    pickerPath.value   = joinDisplayPath(pickerRootPath.value, res.path)
    pickerParent.value = res.parent
    pickerItems.value  = res.items
    return true
  } catch {
    return false
  } finally {
    pickerLoading.value = false
  }
}

function startCreate() {
  pickerCreating.value = true
  pickerNewName.value  = ''
  nextTick(() => {
    const el = (newNameInput.value as any)?.$el as HTMLElement | undefined
    el?.querySelector('input')?.focus()
  })
}

const cancelCreate = resetCreate

async function confirmCreate() {
  const name = pickerNewName.value.trim()
  if (!name || !pickerRootId.value) return
  try {
    const path = pickerRelPath.value ? `${pickerRelPath.value}/${name}` : name
    const res = await props.transport.mkdir(pickerRootId.value, path)
    await navigatePicker(res.rootId, res.path)
  } catch { /* handled by transport */ }
}

async function open(initialPath = '') {
  pickerPath.value      = ''
  pickerRelPath.value   = ''
  pickerRootPath.value  = ''
  pickerRootId.value    = ''
  pickerParent.value    = null
  pickerItems.value     = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true
  const dirs = await props.transport.quickDirs().catch(() => [])
  pickerQuickDirs.value = dirs
  let matched: { label: string; path: string; rootId: string; relPath: string } | undefined
  if (initialPath) {
    for (const dir of dirs) {
      const relPath = relativeToRoot(dir.path, initialPath)
      if (relPath === null) continue
      if (!matched || dir.path.length > matched.path.length) matched = { ...dir, relPath }
    }
  }
  if (matched && await navigatePicker(matched.rootId, matched.relPath, matched.path)) return
  const first = dirs[0]
  if (first) await navigatePicker(first.rootId, '', first.path)
}

function confirmPicker() {
  if (!pickerPath.value) return
  pickerOpen.value = false
  emit('confirm', pickerPath.value, pickerRootId.value)
}

defineExpose({ open })
</script>

<template>
  <SModal
    v-model:visible="pickerOpen"
    :title="L.selectDirTitle"
    width="480px"
    class="chatui-picker-modal"
  >
    <template #toolbar>
      <div class="chatui-picker-path-bar">{{ pickerPath || L.myComputer }}</div>
    </template>

    <div v-if="pickerQuickDirs.length" class="chatui-picker-quickdirs">
      <SChip
        v-for="d in pickerQuickDirs" :key="d.path"
        clickable
        :class="{ 'chatui-picker-qd-active': pickerPath === d.path }"
        @click="navigatePicker(d.rootId, '', d.path)"
      >{{ d.label }}</SChip>
    </div>

    <div class="chatui-picker-list">
      <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
      <template v-else>
        <div v-if="pickerParent !== null" class="chatui-picker-item chatui-picker-up" @click="navigatePicker(pickerRootId, pickerParent!)">
          {{ L.upDir }}
        </div>
        <div v-if="pickerCreating" class="chatui-picker-create-row">
          <span class="chatui-picker-icon">▶</span>
          <SInput
            ref="newNameInput"
            v-model="pickerNewName"
            size="sm"
            class="chatui-picker-create-input"
            :placeholder="L.newFolderPlaceholder"
            @keydown.enter="confirmCreate"
            @keydown.escape="cancelCreate"
          />
          <SButton type="outline" size="sm" @click="confirmCreate">✓</SButton>
          <SButton type="outline" size="sm" @click="cancelCreate">✕</SButton>
        </div>
        <div v-if="pickerItems.length === 0 && !pickerCreating" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
        <div v-for="item in pickerItems" :key="item" class="chatui-picker-item" @click="navigatePicker(pickerRootId, item)">
          <span class="chatui-picker-icon">▶</span>{{ itemLabel(item) }}
        </div>
      </template>
    </div>

    <template #footer>
      <SButton type="outline" size="sm" style="margin-right:auto" :disabled="!pickerPath || pickerCreating" @click="startCreate">{{ L.newFolder }}</SButton>
      <SButton type="outline" @click="pickerOpen = false">{{ L.cancel }}</SButton>
      <SButton :disabled="!pickerPath" @click="confirmPicker">{{ L.selectThis }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.chatui-picker-modal :deep(.s-modal-body) { padding: 0; }
.chatui-picker-path-bar {
  width: 100%;
  font-family: monospace; font-size: 12px; color: var(--chatui-fg);
  word-break: break-all;
}
.chatui-picker-list { min-height: 180px; max-height: 50vh; overflow-y: auto; }
.chatui-picker-empty {
  text-align: center; padding: 40px;
  color: var(--chatui-fg-secondary); font-size: 13px;
}
.chatui-picker-item {
  display: flex; align-items: center; gap: 6px; padding: 8px 14px;
  font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--chatui-border-subtle);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--chatui-fg);
}
.chatui-picker-item:hover { background: var(--chatui-bg-hover); }
.chatui-picker-up { color: var(--chatui-fg-secondary); font-size: 12px; border-bottom: 1px solid var(--chatui-border); }
.chatui-picker-icon { color: #f59e0b; font-size: 10px; flex-shrink: 0; }
.chatui-picker-quickdirs {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 12px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-hover);
}
.chatui-picker-qd-active { background: var(--chatui-bg-active) !important; }
.chatui-picker-create-row {
  display: flex; align-items: center; gap: 6px; padding: 5px 14px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-hover);
}
.chatui-picker-create-input { flex: 1; }
</style>
