<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { SModal, SButton, SInput, SChip } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, QuickDir } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{ confirm: [path: string, rootId: string] }>()

const pickerOpen    = ref(false)
const pickerLoading = ref(false)
const pickerRootId  = ref('')        // '' 表示驱动器选择态
const pickerRelPath = ref('')
const pickerItems   = ref<string[]>([])
const pickerDrives    = ref<QuickDir[]>([])
const pickerQuickDirs = ref<QuickDir[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<InstanceType<typeof SInput> | null>(null)

const pickerDriveMode = computed(() => !pickerRootId.value)
const pickerRootPath  = computed(() => pickerDrives.value.find(d => d.rootId === pickerRootId.value)?.path ?? '')
const pickerPath      = computed(() => pickerRootId.value ? joinDisplayPath(pickerRootPath.value, pickerRelPath.value) : '')
const pickerParent    = computed<string | null>(() => {
  if (!pickerRootId.value || !pickerRelPath.value) return null
  const i = pickerRelPath.value.lastIndexOf('/')
  return i < 0 ? '' : pickerRelPath.value.slice(0, i)
})
const canGoUp = computed(() =>
  !pickerDriveMode.value && (pickerParent.value !== null || pickerDrives.value.length > 1)
)

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

function findDriveFor(absPath: string): { drive: QuickDir; relPath: string } | null {
  let best: { drive: QuickDir; relPath: string } | null = null
  for (const d of pickerDrives.value) {
    const rel = relativeToRoot(d.path, absPath)
    if (rel === null) continue
    if (!best || d.path.length > best.drive.path.length) best = { drive: d, relPath: rel }
  }
  return best
}

function resetCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

function enterDriveMode() {
  resetCreate()
  pickerRootId.value  = ''
  pickerRelPath.value = ''
  pickerItems.value   = []
}

async function navigatePicker(rootId: string, relPath = ''): Promise<boolean> {
  if (!rootId) return false
  resetCreate()
  pickerLoading.value = true
  try {
    const res = await props.transport.listDir(rootId, relPath)
    pickerRootId.value  = res.rootId
    pickerRelPath.value = res.path
    pickerItems.value   = res.items
    return true
  } catch {
    return false
  } finally {
    pickerLoading.value = false
  }
}

async function jumpToAbsPath(absPath: string, fallbackRootId?: string): Promise<boolean> {
  const m = findDriveFor(absPath)
  if (m) return navigatePicker(m.drive.rootId, m.relPath)
  if (fallbackRootId) return navigatePicker(fallbackRootId, '')
  return false
}

function navigateUp() {
  if (pickerParent.value !== null) {
    navigatePicker(pickerRootId.value, pickerParent.value)
  } else if (pickerDrives.value.length > 1) {
    enterDriveMode()
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
  enterDriveMode()
  pickerDrives.value    = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true

  const [drives, quicks] = await Promise.all([
    props.transport.listDrives().catch(() => [] as QuickDir[]),
    props.transport.quickDirs().catch(() => [] as QuickDir[]),
  ])
  pickerDrives.value    = drives
  pickerQuickDirs.value = quicks

  if (initialPath && await jumpToAbsPath(initialPath)) return
  if (drives.length === 1) await navigatePicker(drives[0].rootId, '')
  // 多盘符：保持 driveMode 让用户选
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
        @click="jumpToAbsPath(d.path, d.rootId)"
      >{{ d.label }}</SChip>
    </div>

    <div class="chatui-picker-list">
      <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
      <template v-else-if="pickerDriveMode">
        <div v-if="pickerDrives.length === 0" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
        <div
          v-for="d in pickerDrives" :key="d.path"
          class="chatui-picker-item"
          @click="navigatePicker(d.rootId, '')"
        >
          <span class="chatui-picker-icon">▶</span>{{ d.label }}
        </div>
      </template>
      <template v-else>
        <div v-if="canGoUp" class="chatui-picker-item chatui-picker-up" @click="navigateUp()">
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
