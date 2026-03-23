<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()

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
    const q = dir ? `?dir=${encodeURIComponent(dir)}` : ''
    const res = await apiFetch(`/api/fs/list${q}`)
    pickerPath.value   = res.data.path
    pickerParent.value = res.data.parent
    pickerItems.value  = res.data.items
    return true
  } catch (e: any) {
    if (dir) show(e.message, 'error')
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
    const res = await apiFetch('/api/fs/mkdir', 'POST', { path: `${pickerPath.value}/${name}` })
    await navigatePicker(res.data.path)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function open(initialPath = '') {
  pickerPath.value      = ''
  pickerParent.value    = null
  pickerItems.value     = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true
  apiFetch('/api/fs/quickdirs').then(r => { pickerQuickDirs.value = r.data ?? [] }).catch(() => {})
  if (initialPath && await navigatePicker(initialPath)) return
  await navigatePicker('')
}

function confirmPicker() {
  const selected = pickerPath.value
  if (!selected) return
  pickerOpen.value = false
  emit('confirm', selected)
}

defineExpose({ open })
</script>

<template>
  <div v-if="pickerOpen" class="modal-overlay picker-overlay" @click.self="pickerOpen = false">
    <div class="modal-box picker-box">
      <div class="modal-header">
        <h3>{{ t('directory.select_dir_title') }}</h3>
        <button class="modal-close" @click="pickerOpen = false">&times;</button>
      </div>

      <div class="picker-path-bar">
        {{ pickerPath || t('directory.my_computer') }}
      </div>

      <div v-if="pickerQuickDirs.length" class="picker-quickdirs">
        <button
          v-for="d in pickerQuickDirs"
          :key="d.path"
          class="picker-quickdir-chip"
          :class="{ active: pickerPath === d.path }"
          @click="navigatePicker(d.path)"
        >{{ d.label }}</button>
      </div>

      <div class="picker-list">
        <div v-if="pickerLoading" class="picker-empty">{{ t('common.loading') }}</div>
        <template v-else>
          <div
            v-if="pickerParent !== null"
            class="picker-item picker-up"
            @click="navigatePicker(pickerParent!)"
          >
            {{ t('directory.up_dir') }}
          </div>
          <div v-if="pickerCreating" class="picker-create-row">
            <span class="picker-icon">▶</span>
            <input
              ref="newNameInput"
              v-model="pickerNewName"
              class="picker-create-input"
              :placeholder="t('directory.new_folder_placeholder')"
              @keydown.enter="confirmCreate"
              @keydown.escape="cancelCreate"
            />
            <button class="picker-create-btn" :title="t('common.save')" @click="confirmCreate">✓</button>
            <button class="picker-create-btn picker-create-cancel" :title="t('common.close')" @click="cancelCreate">✕</button>
          </div>
          <div v-if="pickerItems.length === 0 && !pickerCreating" class="picker-empty">{{ t('directory.no_subdirs') }}</div>
          <div
            v-for="item in pickerItems"
            :key="item"
            class="picker-item"
            @click="navigatePicker(item)"
          >
            <span class="picker-icon">▶</span>{{ itemLabel(item) }}
          </div>
        </template>
      </div>

      <div class="modal-footer">
        <button
          class="btn-outline btn-sm"
          style="margin-right:auto"
          :disabled="!pickerPath || pickerCreating"
          @click="startCreate"
        >{{ t('directory.new_folder') }}</button>
        <button class="btn-outline" @click="pickerOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="!pickerPath" @click="confirmPicker">
          {{ t('directory.select_this') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay { z-index: 1001; }

.picker-box {
  width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.picker-path-bar {
  padding: 7px 14px;
  background: #f8f7f5;
  border-bottom: 1px solid #e8e6e3;
  font-family: monospace;
  font-size: 12px;
  color: #3d3d3d;
  word-break: break-all;
  flex-shrink: 0;
}

.picker-list {
  flex: 1;
  overflow-y: auto;
  min-height: 180px;
}

.picker-empty {
  text-align: center;
  padding: 40px;
  color: #94a3b8;
  font-size: 13px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 1px solid #f5f4f2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-item:hover { background: #f5f4f2; }

.picker-up {
  color: #6b7280;
  font-size: 12px;
  border-bottom: 1px solid #e8e6e3;
}

.picker-icon {
  color: #f59e0b;
  font-size: 10px;
  flex-shrink: 0;
}

.picker-quickdirs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 12px;
  border-bottom: 1px solid #e8e6e3;
  background: #fafaf9;
  flex-shrink: 0;
}

.picker-quickdir-chip {
  padding: 2px 10px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  color: #374151;
  line-height: 20px;
  transition: background .1s, border-color .1s;
}
.picker-quickdir-chip:hover { background: #f0efed; border-color: #9ca3af; }
.picker-quickdir-chip.active { background: #ede9fe; border-color: #a78bfa; color: #5b21b6; }

.picker-create-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-bottom: 1px solid #e8e6e3;
  background: #fafaf9;
}

.picker-create-input {
  flex: 1;
  height: 26px;
  padding: 0 6px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  outline: none;
}
.picker-create-input:focus { border-color: #6366f1; }

.picker-create-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #374151;
}
.picker-create-btn:hover { background: #f5f4f2; }
.picker-create-cancel { color: #9b9b9b; }
</style>
