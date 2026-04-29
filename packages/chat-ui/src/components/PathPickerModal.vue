<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
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
const newNameInput    = ref<HTMLInputElement | null>(null)
const pickerQuickDirs = ref<{ label: string; path: string }[]>([])

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).filter(Boolean).pop() || p
}

async function navigatePicker(dir: string): Promise<boolean> {
  pickerCreating.value = false
  pickerNewName.value  = ''
  pickerLoading.value  = true
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
  nextTick(() => newNameInput.value?.focus())
}

function cancelCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

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
  <div v-if="pickerOpen" class="chatui-modal-overlay" @click.self="pickerOpen = false">
    <div class="chatui-modal-box chatui-picker-box">
      <div class="chatui-modal-header">
        <h3>{{ L.selectDirTitle }}</h3>
        <button class="chatui-modal-close" @click="pickerOpen = false">&times;</button>
      </div>

      <div class="chatui-picker-path-bar">{{ pickerPath || L.myComputer }}</div>

      <div v-if="pickerQuickDirs.length" class="chatui-picker-quickdirs">
        <button
          v-for="d in pickerQuickDirs" :key="d.path"
          class="chatui-picker-qd-chip"
          :class="{ active: pickerPath === d.path }"
          @click="navigatePicker(d.path)"
        >{{ d.label }}</button>
      </div>

      <div class="chatui-picker-list">
        <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
        <template v-else>
          <div v-if="pickerParent !== null" class="chatui-picker-item chatui-picker-up" @click="navigatePicker(pickerParent!)">
            {{ L.upDir }}
          </div>
          <div v-if="pickerCreating" class="chatui-picker-create-row">
            <span class="chatui-picker-icon">▶</span>
            <input ref="newNameInput" v-model="pickerNewName" class="chatui-picker-create-input"
              :placeholder="L.newFolderPlaceholder" @keydown.enter="confirmCreate" @keydown.escape="cancelCreate" />
            <button class="chatui-picker-create-btn" @click="confirmCreate">✓</button>
            <button class="chatui-picker-create-btn chatui-picker-create-cancel" @click="cancelCreate">✕</button>
          </div>
          <div v-if="pickerItems.length === 0 && !pickerCreating" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
          <div v-for="item in pickerItems" :key="item" class="chatui-picker-item" @click="navigatePicker(item)">
            <span class="chatui-picker-icon">▶</span>{{ itemLabel(item) }}
          </div>
        </template>
      </div>

      <div class="chatui-modal-footer">
        <button class="chatui-btn-outline chatui-btn-sm" style="margin-right:auto" :disabled="!pickerPath || pickerCreating" @click="startCreate">{{ L.newFolder }}</button>
        <button class="chatui-btn-outline" @click="pickerOpen = false">{{ L.cancel }}</button>
        <button class="chatui-btn-primary" :disabled="!pickerPath" @click="confirmPicker">{{ L.selectThis }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chatui-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.chatui-modal-box {
  background: var(--chatui-bg-surface, #fff); border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18); max-width: 90vw;
}
.chatui-picker-box { width: 480px; max-height: 70vh; display: flex; flex-direction: column; }
.chatui-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--chatui-border, #e8e6e3);
}
.chatui-modal-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--chatui-fg, #1c1c1c); }
.chatui-modal-close {
  background: none; border: none; font-size: 20px; cursor: pointer;
  color: var(--chatui-fg-secondary, #94a3b8); padding: 0 4px; line-height: 1;
}
.chatui-modal-close:hover { color: var(--chatui-fg, #1c1c1c); }
.chatui-modal-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--chatui-border, #e8e6e3);
}
.chatui-picker-path-bar {
  padding: 7px 14px; background: var(--chatui-bg-hover, #f8f7f5);
  border-bottom: 1px solid var(--chatui-border, #e8e6e3);
  font-family: monospace; font-size: 12px; color: var(--chatui-fg, #3d3d3d);
  word-break: break-all; flex-shrink: 0;
}
.chatui-picker-list { flex: 1; overflow-y: auto; min-height: 180px; }
.chatui-picker-empty {
  text-align: center; padding: 40px;
  color: var(--chatui-fg-secondary, #94a3b8); font-size: 13px;
}
.chatui-picker-item {
  display: flex; align-items: center; gap: 6px; padding: 8px 14px;
  font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--chatui-border-subtle, #f5f4f2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--chatui-fg, #1c1c1c);
}
.chatui-picker-item:hover { background: var(--chatui-bg-hover, #f5f4f2); }
.chatui-picker-up { color: var(--chatui-fg-secondary, #6b7280); font-size: 12px; border-bottom: 1px solid var(--chatui-border, #e8e6e3); }
.chatui-picker-icon { color: #f59e0b; font-size: 10px; flex-shrink: 0; }
.chatui-picker-quickdirs {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 12px;
  border-bottom: 1px solid var(--chatui-border, #e8e6e3);
  background: var(--chatui-bg-hover, #fafaf9); flex-shrink: 0;
}
.chatui-picker-qd-chip {
  padding: 2px 10px; font-size: 12px; border: 1px solid var(--chatui-border, #d1d5db);
  border-radius: 12px; background: var(--chatui-bg-surface, #fff); cursor: pointer;
  color: var(--chatui-fg, #374151); line-height: 20px;
}
.chatui-picker-qd-chip:hover { background: var(--chatui-bg-active, #f0efed); border-color: var(--chatui-border-focus, #9ca3af); }
.chatui-picker-qd-chip.active { background: #ede9fe; border-color: #a78bfa; color: #5b21b6; }
.chatui-picker-create-row {
  display: flex; align-items: center; gap: 6px; padding: 5px 14px;
  border-bottom: 1px solid var(--chatui-border, #e8e6e3);
  background: var(--chatui-bg-hover, #fafaf9);
}
.chatui-picker-create-input {
  flex: 1; height: 26px; padding: 0 6px; font-size: 13px;
  border: 1px solid var(--chatui-border, #d1d5db); border-radius: 4px;
  outline: none; background: var(--chatui-bg-surface, #fff); color: var(--chatui-fg, #1c1c1c);
}
.chatui-picker-create-input:focus { border-color: var(--chatui-accent, #6366f1); }
.chatui-picker-create-btn {
  background: none; border: 1px solid var(--chatui-border, #d1d5db);
  border-radius: 4px; width: 26px; height: 26px; cursor: pointer;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: var(--chatui-fg, #374151);
}
.chatui-picker-create-btn:hover { background: var(--chatui-bg-hover, #f5f4f2); }
.chatui-picker-create-cancel { color: var(--chatui-fg-secondary, #9b9b9b); }
.chatui-btn-outline {
  padding: 6px 14px; border: 1px solid var(--chatui-border, #d1d5db);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 13px; color: var(--chatui-fg, #374151);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover, #f5f4f2); }
.chatui-btn-outline.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }
.chatui-btn-outline:disabled { opacity: 0.5; cursor: default; }
.chatui-btn-primary {
  padding: 6px 14px; border: none; border-radius: 6px;
  background: var(--chatui-btn-bg, #1c1c1c); color: var(--chatui-btn-fg, #fff);
  cursor: pointer; font-size: 13px;
}
.chatui-btn-primary:hover { background: var(--chatui-btn-hover, #333); }
.chatui-btn-primary:disabled { opacity: 0.5; cursor: default; }
</style>
