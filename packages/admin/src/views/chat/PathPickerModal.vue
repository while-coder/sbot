<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SIconButton } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()

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
const newNameInput    = ref<HTMLInputElement | null>(null)
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

async function navigatePicker(rootId: string, relPath = '', rootPath?: string): Promise<boolean> {
  if (!rootId) return false
  pickerCreating.value = false
  pickerNewName.value  = ''
  pickerLoading.value  = true
  try {
    const q = `?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(relPath)}`
    const res = await apiFetch(`/api/fs/list${q}`)
    if (rootPath) pickerRootPath.value = rootPath
    pickerRootId.value = res.data.rootId
    pickerRelPath.value = res.data.path
    pickerPath.value   = joinDisplayPath(pickerRootPath.value, res.data.path)
    pickerParent.value = res.data.parent
    pickerItems.value  = res.data.items
    return true
  } catch (e: any) {
    if (relPath || rootPath) show(e.message, 'error')
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
  if (!name || !pickerRootId.value) return
  try {
    const path = pickerRelPath.value ? `${pickerRelPath.value}/${name}` : name
    const res = await apiFetch('/api/fs/mkdir', 'POST', { rootId: pickerRootId.value, path })
    await navigatePicker(res.data.rootId, res.data.path)
  } catch (e: any) {
    show(e.message, 'error')
  }
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
  const dirs = await apiFetch('/api/fs/quickdirs').then(r => r.data ?? []).catch(() => [])
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
  const selected = pickerPath.value
  if (!selected) return
  pickerOpen.value = false
  emit('confirm', selected, pickerRootId.value)
}

defineExpose({ open })
</script>

<template>
  <SModal v-model:visible="pickerOpen" :title="t('directory.select_dir_title')" width="sm" nested>
    <template #toolbar>
      <div class="picker-path-bar">
        {{ pickerPath || t('directory.my_computer') }}
      </div>
    </template>

    <div v-if="pickerQuickDirs.length" class="picker-quickdirs">
      <button
        v-for="d in pickerQuickDirs"
        :key="d.path"
        class="picker-quickdir-chip"
        :class="{ active: pickerPath === d.path }"
        @click="navigatePicker(d.rootId, '', d.path)"
      >{{ d.label }}</button>
    </div>

    <div class="picker-list">
      <div v-if="pickerLoading" class="picker-empty">{{ t('common.loading') }}</div>
      <template v-else>
        <div
          v-if="pickerParent !== null"
          class="picker-item picker-up"
          @click="navigatePicker(pickerRootId, pickerParent!)"
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
          <SIconButton size="sm" variant="outline" :title="t('common.save')" @click="confirmCreate">✓</SIconButton>
          <SIconButton size="sm" variant="outline" :title="t('common.close')" @click="cancelCreate">✕</SIconButton>
        </div>
        <div v-if="pickerItems.length === 0 && !pickerCreating" class="picker-empty">{{ t('directory.no_subdirs') }}</div>
        <div
          v-for="item in pickerItems"
          :key="item"
          class="picker-item"
          @click="navigatePicker(pickerRootId, item)"
        >
          <span class="picker-icon">▶</span>{{ itemLabel(item) }}
        </div>
      </template>
    </div>

    <template #footer>
      <SButton
        type="outline"
        size="sm"
        style="margin-right:auto"
        :disabled="!pickerPath || pickerCreating"
        @click="startCreate"
      >{{ t('directory.new_folder') }}</SButton>
      <SButton type="outline" @click="pickerOpen = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" :disabled="!pickerPath" @click="confirmPicker">
        {{ t('directory.select_this') }}
      </SButton>
    </template>
  </SModal>
</template>

<style scoped>
.picker-path-bar {
  padding: 0;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  word-break: break-all;
  flex: 1;
}

.picker-list {
  min-height: 180px;
  margin: calc(-1 * var(--sui-sp-7)) calc(-1 * var(--sui-sp-8));
}

.picker-empty {
  text-align: center;
  padding: 40px;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}

.picker-item {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-3) var(--sui-sp-6);
  font-size: var(--sui-fs-md);
  cursor: pointer;
  border-bottom: 1px solid var(--sui-bg-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--sui-fg-secondary);
}
.picker-item:hover { background: var(--sui-bg-soft); }

.picker-up {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  border-bottom: 1px solid var(--sui-border);
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
  padding: var(--sui-sp-2) var(--sui-sp-5);
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg-subtle);
  margin: calc(-1 * var(--sui-sp-7)) calc(-1 * var(--sui-sp-8)) 0;
}

.picker-quickdir-chip {
  padding: 2px var(--sui-sp-4);
  font-size: var(--sui-fs-sm);
  border: 1px solid var(--sui-neutral-mid);
  border-radius: var(--sui-radius-pill);
  background: var(--sui-bg);
  cursor: pointer;
  color: var(--sui-fg-secondary);
  line-height: 20px;
  transition: background var(--sui-transition-base), border-color var(--sui-transition-base);
  font-family: inherit;
}
.picker-quickdir-chip:hover { background: var(--sui-bg-hover); border-color: var(--sui-border-strong); }
.picker-quickdir-chip.active {
  background: var(--sui-violet-soft);
  border-color: var(--sui-violet);
  color: var(--sui-violet);
}

.picker-create-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: 5px var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg-subtle);
}

.picker-create-input {
  flex: 1;
  height: 26px;
  padding: 0 var(--sui-sp-2);
  font-size: var(--sui-fs-md);
  border: 1px solid var(--sui-neutral-mid);
  border-radius: var(--sui-radius-sm);
  outline: none;
  background: var(--sui-bg);
  color: var(--sui-fg);
  font-family: inherit;
}
.picker-create-input:focus { border-color: var(--sui-info-link); }
</style>
