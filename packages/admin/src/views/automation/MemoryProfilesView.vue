<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'

interface MemoryProfileForm {
  name: string
  enabled: boolean
  writerModel: string
  writerPromptFile: string
  readPromptFile: string
  idleMs: number
  maxMessages: number
  minTurns: number
  concurrency: number
  maxAttempts: number
  menuMaxEntries: number
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
  { key: 'ops',          label: t('common.ops'),                 ops: true, width: '240px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const running = ref<Record<string, boolean>>({})

function emptyForm(): MemoryProfileForm {
  return {
    name: '',
    enabled: true,
    writerModel: '',
    writerPromptFile: '',
    readPromptFile: '',
    idleMs: 600_000,
    maxMessages: 50,
    minTurns: 2,
    concurrency: 3,
    maxAttempts: 3,
    menuMaxEntries: 200,
  }
}

const form = ref<MemoryProfileForm>(emptyForm())

const promptFiles = ref<{ path: string }[]>([])
async function loadPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=memory')
    promptFiles.value = res.data || []
  } catch { promptFiles.value = [] }
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
    idleMs: p.idleMs ?? 600_000,
    maxMessages: p.maxMessages ?? 50,
    minTurns: p.minTurns ?? 2,
    concurrency: p.concurrency ?? 3,
    maxAttempts: p.maxAttempts ?? 3,
    menuMaxEntries: p.menuMaxEntries ?? 200,
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
      idleMs: form.value.idleMs,
      maxMessages: form.value.maxMessages,
      minTurns: form.value.minTurns,
      concurrency: form.value.concurrency,
      maxAttempts: form.value.maxAttempts,
      menuMaxEntries: form.value.menuMaxEntries,
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

async function runExtract(id: string) {
  if (running.value[id]) return
  running.value[id] = true
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(id)}/extract/run`, 'POST', {})
    show(t('memory_profiles.extract_done'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    running.value[id] = false
  }
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
            <SButton type="outline" size="sm" :loading="running[row.id]" @click="runExtract(row.id)">{{ t('memory_profiles.run_extract') }}</SButton>
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
          <option v-for="p in promptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.read_prompt')">
        <SSelect v-model="form.readPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in promptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('memory_profiles.idle_ms')">
        <SInput type="number" :model-value="form.idleMs" @update:model-value="(v: any) => (form.idleMs = Number(v) || 0)" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.max_messages')">
        <SInput type="number" :model-value="form.maxMessages" @update:model-value="(v: any) => (form.maxMessages = Number(v) || 0)" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.min_turns')">
        <SInput type="number" :model-value="form.minTurns" @update:model-value="(v: any) => (form.minTurns = Number(v) || 0)" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.concurrency')">
        <SInput type="number" :model-value="form.concurrency" @update:model-value="(v: any) => (form.concurrency = Number(v) || 1)" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.max_attempts')">
        <SInput type="number" :model-value="form.maxAttempts" @update:model-value="(v: any) => (form.maxAttempts = Number(v) || 1)" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.menu_max_entries')">
        <SInput type="number" :model-value="form.menuMaxEntries" @update:model-value="(v: any) => (form.menuMaxEntries = Number(v) || 100)" />
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>
  </div>
</template>

<style scoped>
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
</style>
