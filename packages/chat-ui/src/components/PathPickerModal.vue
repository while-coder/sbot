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
const emit = defineEmits<{ confirm: [path: string] }>()

const pickerOpen    = ref(false)
const pickerLoading = ref(false)
const pickerPath    = ref('')
const pickerParent  = ref<string | null>(null)
const pickerItems   = ref<string[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<InstanceType<typeof SInput> | null>(null)
const pickerQuickDirs = ref<{ label: string; path: string }[]>([])

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).filter(Boolean).pop() || p
}

function resetCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

async function navigatePicker(dir: string): Promise<boolean> {
  resetCreate()
  pickerLoading.value = true
  try {
    const res = await props.transport.listDir(dir || undefined)
    pickerPath.value   = res.path
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
  if (!name) return
  try {
    const res = await props.transport.mkdir(`${pickerPath.value}/${name}`)
    await navigatePicker(res.path)
  } catch { /* handled by transport */ }
}

async function open(initialPath = '') {
  pickerPath.value      = ''
  pickerParent.value    = null
  pickerItems.value     = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true
  props.transport.quickDirs().then(dirs => { pickerQuickDirs.value = dirs }).catch(() => {})
  if (initialPath && await navigatePicker(initialPath)) return
  await navigatePicker('')
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
      <div class="chatui-picker-path-bar">{{ pickerPath || L.myComputer }}</div>
    </template>

    <div v-if="pickerQuickDirs.length" class="chatui-picker-quickdirs">
      <SChip
        v-for="d in pickerQuickDirs" :key="d.path"
        clickable
        :class="{ 'chatui-picker-qd-active': pickerPath === d.path }"
        @click="navigatePicker(d.path)"
      >{{ d.label }}</SChip>
    </div>

    <div class="chatui-picker-list">
      <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
      <template v-else>
        <div v-if="pickerParent !== null" class="chatui-picker-item chatui-picker-up" @click="navigatePicker(pickerParent!)">
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
        <div v-for="item in pickerItems" :key="item" class="chatui-picker-item" @click="navigatePicker(item)">
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
