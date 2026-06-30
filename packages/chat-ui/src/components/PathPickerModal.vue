<script setup lang="ts">
import { ref, nextTick, computed, watch } from 'vue'
import { SModal, SButton, SInput, SChip } from 'sbot-ui'
import type { IChatTransport } from '../transport'
import type { ChatLabels, DriveEntry, QuickDir } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
  /** 从抽屉/弹层中打开时设为 true，使用更高的 z-index 盖住宿主层 */
  nested?: boolean
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
const pickerError     = ref('')
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

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
    pickerError.value  = ''
    return true
  } catch (e: any) {
    pickerError.value = getErrorMessage(e)
    emit('error', pickerError.value)
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
  pickerError.value     = ''
  pickerLoading.value   = true
  pickerOpen.value      = true

  const [drivesResult, quicksResult] = await Promise.allSettled([
    props.transport.listDrives(),
    props.transport.quickDirs(),
  ])

  if (drivesResult.status === 'fulfilled') pickerDrives.value = drivesResult.value
  if (quicksResult.status === 'fulfilled') pickerQuickDirs.value = quicksResult.value

  const errors: string[] = []
  if (drivesResult.status === 'rejected') errors.push(`磁盘列表：${getErrorMessage(drivesResult.reason)}`)
  if (quicksResult.status === 'rejected') errors.push(`常用目录：${getErrorMessage(quicksResult.reason)}`)
  if (errors.length) {
    pickerError.value = `请求目录失败：${errors.join('；')}`
    emit('error', pickerError.value)
  }
  pickerLoading.value = false

  if (initialPath && await navigate(initialPath)) return
  if (pickerDrives.value.length === 1) await navigate(pickerDrives.value[0].path)
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
    :nested="nested"
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
    <div v-if="pickerError" class="chatui-picker-error">{{ pickerError }}</div>

    <div class="chatui-picker-list">
      <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
      <template v-else-if="pickerDriveMode">
        <div v-if="pickerDrives.length === 0 && !pickerError" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
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
        <div v-if="pickerItems.length === 0 && !pickerCreating && !pickerError" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
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
.chatui-picker-error {
  padding: 8px 12px;
  border-bottom: 1px solid var(--chatui-border);
  color: var(--chatui-btn-danger, #d14343);
  background: var(--chatui-bg-surface);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}
.chatui-picker-create-row {
  display: flex; align-items: center; gap: 6px; padding: 5px 14px;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-hover);
}
.chatui-picker-create-input { flex: 1; }
</style>
