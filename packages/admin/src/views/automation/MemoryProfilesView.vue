<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import MemoryListModal from '@/components/modals/MemoryListModal.vue'

interface MemoryProfileForm {
  name: string
  enabled: boolean
  writerModel: string
  writerPromptFile: string
  readPromptFile: string
}

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const profiles = computed(() => store.settings.memoryProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id })),
)

const columns = computed<STableColumn[]>(() => [
  { key: 'name',         label: t('common.name'),                primary: true },
  { key: 'enabled',      label: t('common.enabled'),             width: '100px', align: 'center' },
  { key: 'writerModel',  label: t('memory_profiles.writer_model'), width: '200px' },
  { key: 'ops',          label: t('common.ops'),                 ops: true, width: '320px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const consolidating = ref<Record<string, boolean>>({})
const memoryListModal = ref<InstanceType<typeof MemoryListModal>>()

function emptyForm(): MemoryProfileForm {
  return {
    name: '',
    enabled: true,
    writerModel: '',
    writerPromptFile: '',
    readPromptFile: '',
  }
}

const form = ref<MemoryProfileForm>(emptyForm())

const promptFiles = ref<{ path: string }[]>([])
const writerPromptFiles = computed(() => filterPromptFiles('write', form.value.writerPromptFile))
const readPromptFiles = computed(() => filterPromptFiles('read', form.value.readPromptFile))

async function loadPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=memory')
    promptFiles.value = res.data || []
  } catch { promptFiles.value = [] }
}

function filterPromptFiles(kind: 'write' | 'read', selectedPath: string): { path: string }[] {
  const prefix = kind === 'write' ? 'memory/writer/' : 'memory/reader/'
  const out = promptFiles.value.filter(p => p.path.replace(/\\/g, '/').startsWith(prefix))
  if (selectedPath && !out.some(p => p.path === selectedPath)) out.unshift({ path: selectedPath })
  return out
}

function openAdd() {
  editingId.value = null
  form.value = emptyForm()
  loadPrompts()
  showModal.value = true
}

function openEdit(id: string) {
  const p: any = profiles.value[id]
  editingId.value = id
  form.value = {
    name: p.name || '',
    enabled: !!p.enabled,
    writerModel: p.writerModel || '',
    writerPromptFile: p.writerPromptFile || '',
    readPromptFile: p.readPromptFile || '',
  }
  loadPrompts()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (form.value.enabled) {
    if (!form.value.writerModel) { show(t('memory_profiles.error_writer_model'), 'error'); return }
  }
  try {
    const body: any = {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
      writerModel: form.value.writerModel,
    }
    if (form.value.writerPromptFile) body.writerPromptFile = form.value.writerPromptFile
    if (form.value.readPromptFile)   body.readPromptFile   = form.value.readPromptFile
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/memoryProfiles', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const p: any = profiles.value[id]
  const label = p?.name || id
  if (!await confirm(t('memory_profiles.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function runConsolidate(id: string) {
  if (consolidating.value[id]) return
  consolidating.value[id] = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/consolidate/run`, 'POST', {})
    show(t('memory_profiles.consolidate_queued', { id: res.data?.jobId ?? '-' }))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    consolidating.value[id] = false
  }
}

function openMemoryViewer(id: string) {
  const p: any = profiles.value[id]
  memoryListModal.value?.openByMemoryId(id, p?.name || id)
}

function modelLabel(id: string | undefined | null): string {
  if (!id) return '-'
  return modelOptions.value.find(m => m.id === id)?.label || id
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('memory_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        :empty-text="t('memory_profiles.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #enabled="{ row }">
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" pill>
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
        </template>
        <template #writerModel="{ row }">{{ modelLabel(row.writerModel) }}</template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="openMemoryViewer(row.id)">{{ t('memory_profiles.view_memories') }}</SButton>
            <SButton type="outline" size="sm" :loading="consolidating[row.id]" @click="runConsolidate(row.id)">{{ t('memory_profiles.run_consolidate') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingId !== null ? t('memory_profiles.edit_title') : t('memory_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('memory_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :model-value="form.enabled ? 'true' : 'false'" @update:model-value="(v: any) => (form.enabled = v === 'true')">
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_model') + ' *'">
        <SSelect v-model="form.writerModel">
          <option value="" disabled>{{ t('memory_profiles.writer_model_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_prompt')">
        <SSelect v-model="form.writerPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in writerPromptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.read_prompt')">
        <SSelect v-model="form.readPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in readPromptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <MemoryListModal ref="memoryListModal" />
  </div>
</template>

<style scoped>
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
</style>
