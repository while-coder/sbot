<script setup lang="ts">
import { ref, nextTick, computed, watch } from 'vue'
import { SModal, SButton, SInput, SChip } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, DriveEntry, QuickDir } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{
  confirm: [path: string]
  error: [message: string]
}>()

const pickerOpen      = ref(false)
const pickerLoading   = ref(false)
const pickerPath      = ref('')              // '' 表示驱动器选择态
const pickerParent    = ref<string | null>(null)
const pickerItems     = ref<string[]>([])    // 绝对路径
const pickerDrives    = ref<DriveEntry[]>([])
const pickerQuickDirs = ref<QuickDir[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<InstanceType<typeof SInput> | null>(null)
const pathInput       = ref('')

watch(() => pickerPath.value, v => { pathInput.value = v })

const pickerDriveMode = computed(() => !pickerPath.value)
const isDriveRoot     = computed(() => /^[A-Za-z]:[/\\]?$/.test(pickerPath.value))
const canGoUp = computed(() =>
  !pickerDriveMode.value && (pickerParent.value !== null || isDriveRoot.value),
)

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || p
}

function pathSep(p: string): string {
  return p.includes('\\') ? '\\' : '/'
}

function resetCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

function enterDriveMode() {
  resetCreate()
  pickerPath.value   = ''
  pickerParent.value = null
  pickerItems.value  = []
}

async function navigate(absPath: string): Promise<boolean> {
  if (!absPath) { enterDriveMode(); return true }
  resetCreate()
  pickerLoading.value = true
  try {
    const res = await props.transport.listDir(absPath)
    pickerPath.value   = res.path
    pickerParent.value = res.parent
    pickerItems.value  = res.items
    return true
  } catch (e: any) {
    emit('error', e?.message ?? String(e))
    return false
  } finally {
    pickerLoading.value = false
  }
}

function navigateUp() {
  if (pickerParent.value !== null) navigate(pickerParent.value)
  else if (isDriveRoot.value) enterDriveMode()
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
  if (!name || !pickerPath.value) return
  const sep = pathSep(pickerPath.value)
  const newPath = `${pickerPath.value.replace(/[\\/]+$/, '')}${sep}${name}`
  try {
    await props.transport.mkdir(newPath)
    await navigate(newPath)
  } catch (e: any) {
    emit('error', e?.message ?? String(e))
  }
}

async function open(initialPath = '') {
  enterDriveMode()
  pickerDrives.value    = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true

  const [drives, quicks] = await Promise.all([
    props.transport.listDrives().catch(() => [] as DriveEntry[]),
    props.transport.quickDirs().catch(() => [] as QuickDir[]),
  ])
  pickerDrives.value    = drives
  pickerQuickDirs.value = quicks

  if (initialPath && await navigate(initialPath)) return
  if (drives.length === 1) await navigate(drives[0].path)
  // 多盘符：保持 driveMode 让用户选
}

function confirmPicker() {
  if (!pickerPath.value) return
  pickerOpen.value = false
  emit('confirm', pickerPath.value)
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
      <SInput
        v-model="pathInput"
        size="sm"
        class="chatui-picker-path-bar"
        :placeholder="L.myComputer"
        @keydown.enter="navigate(String(pathInput).trim())"
      />
    </template>

    <div v-if="pickerQuickDirs.length" class="chatui-picker-quickdirs">
      <SChip
        v-for="d in pickerQuickDirs" :key="d.label"
        clickable
        :class="{ 'chatui-picker-qd-active': d.path === pickerPath || (!d.path && pickerDriveMode) }"
        @click="navigate(d.path)"
      >{{ d.label }}</SChip>
    </div>

    <div class="chatui-picker-list">
      <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
      <template v-else-if="pickerDriveMode">
        <div v-if="pickerDrives.length === 0" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
        <div
          v-for="d in pickerDrives" :key="d.path"
          class="chatui-picker-item"
          @click="navigate(d.path)"
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
        <div v-for="item in pickerItems" :key="item" class="chatui-picker-item" @click="navigate(item)">
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
.chatui-picker-path-bar :deep(input) {
  font-family: monospace; font-size: 12px;
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
