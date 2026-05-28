<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SIconButton } from 'sbot-ui'

interface DriveEntry { label: string; path: string; rootId: string }
interface QuickDir   { label: string; rootId: string; relPath: string }

const { t } = useI18n()
const { show } = useToast()

const emit = defineEmits<{ confirm: [path: string, rootId: string] }>()

const pickerOpen      = ref(false)
const pickerLoading   = ref(false)
const pickerRootId    = ref('')
const pickerRelPath   = ref('')
const pickerItems     = ref<string[]>([])
const pickerDrives    = ref<DriveEntry[]>([])
const pickerQuickDirs = ref<QuickDir[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<HTMLInputElement | null>(null)

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

function joinDisplayPath(rootPath: string, relPath: string): string {
  if (!relPath) return rootPath
  const sep = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${sep}${relPath.replace(/\//g, sep)}`
}

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || p
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

async function navigate(rootId: string, relPath = ''): Promise<boolean> {
  if (!rootId) return false
  resetCreate()
  pickerLoading.value = true
  try {
    const q = `?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(relPath)}`
    const res = await apiFetch(`/api/fs/list${q}`)
    pickerRootId.value  = res.data.rootId
    pickerRelPath.value = res.data.path
    pickerItems.value   = res.data.items
    return true
  } catch (e: any) {
    if (relPath) show(e.message, 'error')
    return false
  } finally {
    pickerLoading.value = false
  }
}

function navigateUp() {
  if (pickerParent.value !== null) navigate(pickerRootId.value, pickerParent.value)
  else if (pickerDrives.value.length > 1) enterDriveMode()
}

function startCreate() {
  pickerCreating.value = true
  pickerNewName.value  = ''
  nextTick(() => newNameInput.value?.focus())
}

const cancelCreate = resetCreate

async function confirmCreate() {
  const name = pickerNewName.value.trim()
  if (!name || !pickerRootId.value) return
  try {
    const path = pickerRelPath.value ? `${pickerRelPath.value}/${name}` : name
    const res = await apiFetch('/api/fs/mkdir', 'POST', { rootId: pickerRootId.value, path })
    await navigate(res.data.rootId, res.data.path)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function resolveInitialPath(absPath: string): { rootId: string; relPath: string } | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const target = norm(absPath)
  let best: { drive: DriveEntry; rel: string } | null = null
  for (const d of pickerDrives.value) {
    const root = norm(d.path)
    let rel: string | null = null
    if (target === root) rel = ''
    else if (root === '' && target.startsWith('/')) rel = target.slice(1)
    else if (target.startsWith(`${root}/`)) rel = target.slice(root.length + 1)
    if (rel === null) continue
    if (!best || d.path.length > best.drive.path.length) best = { drive: d, rel }
  }
  return best ? { rootId: best.drive.rootId, relPath: best.rel } : null
}

async function open(initialPath = '') {
  enterDriveMode()
  pickerDrives.value    = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true

  const [drives, quicks] = await Promise.all([
    apiFetch('/api/fs/drives').then(r => r.data ?? []).catch(() => []) as Promise<DriveEntry[]>,
    apiFetch('/api/fs/quickdirs').then(r => r.data ?? []).catch(() => []) as Promise<QuickDir[]>,
  ])
  pickerDrives.value    = drives
  pickerQuickDirs.value = quicks

  if (initialPath) {
    const m = resolveInitialPath(initialPath)
    if (m && await navigate(m.rootId, m.relPath)) return
  }
  if (drives.length === 1) await navigate(drives[0].rootId, '')
}

function confirmPicker() {
  if (!pickerPath.value) return
  pickerOpen.value = false
  emit('confirm', pickerPath.value, pickerRootId.value)
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
        :key="`${d.rootId}/${d.relPath}`"
        class="picker-quickdir-chip"
        :class="{ active: d.rootId === pickerRootId && d.relPath === pickerRelPath }"
        @click="navigate(d.rootId, d.relPath)"
      >{{ d.label }}</button>
    </div>

    <div class="picker-list">
      <div v-if="pickerLoading" class="picker-empty">{{ t('common.loading') }}</div>
      <template v-else-if="pickerDriveMode">
        <div v-if="pickerDrives.length === 0" class="picker-empty">{{ t('directory.no_subdirs') }}</div>
        <div
          v-for="d in pickerDrives"
          :key="d.path"
          class="picker-item"
          @click="navigate(d.rootId, '')"
        >
          <span class="picker-icon">▶</span>{{ d.label }}
        </div>
      </template>
      <template v-else>
        <div
          v-if="canGoUp"
          class="picker-item picker-up"
          @click="navigateUp()"
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
          @click="navigate(pickerRootId, item)"
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
