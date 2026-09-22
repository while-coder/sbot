<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { settingsManager } from '@/managers/settingsManager'
import { modelManager } from '@/managers/modelManager'
import { promptFileManager } from '@/managers/promptFileManager'
import { SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, SEntityTable, type EntityTableColumn, toast, confirm } from '@sbot/ui-kit'
import MemoryListModal from '@/components/modals/MemoryListModal.vue'
import ResourceRefs from '@/components/ResourceRefs.vue'
import { useResourceRefs } from '@/composables/useResourceRefs'

interface MemoryProfileForm {
  name: string
  enabled: boolean
  writerModel: string
  selectorModel: string
  writerPromptFile: string
  readPromptFile: string
}

const { t } = useI18n()

const profiles = computed(() => store.settings.memoryProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = modelManager.options

// ── 被引用情况（频道 / 会话档案） ──
const { loadProfiles, makeResourceRefs } = useResourceRefs()
const refs = makeResourceRefs({
  channel: (c, id) => c.memory === id,
  profile: (p, id) => p.memory === id,
})
const expandedIds = ref<string[]>([])
onMounted(loadProfiles)

const columns = computed<EntityTableColumn[]>(() => [
  { key: 'name',         label: t('common.name'),                primary: true },
  { key: 'enabled',      label: t('common.enabled'),             width: '100px', align: 'center' },
  { key: 'writerModel',  label: t('memory_profiles.writer_model'), width: '200px' },
  { key: 'selectorModel', label: t('memory_profiles.selector_model'), width: '200px' },
  { key: 'ops',          label: t('common.ops'),                 ops: true, width: '260px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const memoryListModal = ref<InstanceType<typeof MemoryListModal>>()

function emptyForm(): MemoryProfileForm {
  return {
    name: '',
    enabled: true,
    writerModel: '',
    selectorModel: '',
    writerPromptFile: '',
    readPromptFile: '',
  }
}

const form = ref<MemoryProfileForm>(emptyForm())

const promptFiles = promptFileManager.list('memory')
const writerPromptFiles = computed(() => filterPromptFiles('write', form.value.writerPromptFile))
const readPromptFiles = computed(() => filterPromptFiles('read', form.value.readPromptFile))

async function loadPrompts() {
  try {
    await promptFileManager.ensure('memory')
  } catch {}
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
    selectorModel: p.selectorModel || '',
    writerPromptFile: p.writerPromptFile || '',
    readPromptFile: p.readPromptFile || '',
  }
  loadPrompts()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { toast.show('error', t('common.name_required')); return }
  if (form.value.enabled) {
    if (!form.value.writerModel) { toast.show('error', t('memory_profiles.error_writer_model')); return }
  }
  try {
    const body: any = {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
      writerModel: form.value.writerModel,
    }
    if (form.value.selectorModel) body.selectorModel = form.value.selectorModel
    if (form.value.writerPromptFile) body.writerPromptFile = form.value.writerPromptFile
    if (form.value.readPromptFile)   body.readPromptFile   = form.value.readPromptFile
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/memoryProfiles', 'POST', body)
    settingsManager.apply(res.data)
    toast.show('success', t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

async function remove(id: string) {
  const p: any = profiles.value[id]
  const label = p?.name || id
  if (!await confirm.show({ title: t('memory_profiles.confirm_delete', { name: label }), danger: true , content: ''})) return
  try {
    const res = await apiFetch(`/api/settings/memoryProfiles/${encodeURIComponent(id)}`, 'DELETE')
    settingsManager.apply(res.data)
    toast.show('success', t('common.deleted'))
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

async function refresh() {
  try {
    await settingsManager.refresh()
    await loadProfiles()
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

function openMemoryViewer(id: string) {
  const p: any = profiles.value[id]
  memoryListModal.value?.openByMemoryId(id, p?.name || id)
}

function modelLabel(id: string | undefined | null): string {
  if (!id) return '-'
  return modelManager.nameOf(id)
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('memory_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <SEntityTable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        expandable
        v-model:expandedKeys="expandedIds"
        :empty-text="t('memory_profiles.empty')"
      >
        <template #name="{ row }">
          {{ row.name || row.id }}
          <ResourceRefs mode="badge" :refs="refs(row.id)" />
        </template>
        <template #enabled="{ row }">
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" pill>
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
        </template>
        <template #writerModel="{ row }">{{ modelLabel(row.writerModel) }}</template>
        <template #selectorModel="{ row }">{{ row.selectorModel ? modelLabel(row.selectorModel) : t('memory_profiles.use_writer_model') }}</template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="openMemoryViewer(row.id)">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
        <template #expanded="{ row }">
          <div class="refs-expanded">
            <ResourceRefs mode="card" :refs="refs(row.id)" />
          </div>
        </template>
      </SEntityTable>
    </SPageContent>

    <SModal v-model:show="showModal" :title="editingId !== null ? t('memory_profiles.edit_title') : t('memory_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model:value="form.name" :placeholder="t('memory_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :value="form.enabled ? 'true' : 'false'" @update:value="(v: any) => (form.enabled = v === 'true')" :options="[
          { value: 'true', label: t('common.enabled') },
          { value: 'false', label: t('common.disabled') },
        ]" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_model') + ' *'">
        <SSelect v-model:value="form.writerModel" :placeholder="t('memory_profiles.writer_model_placeholder')" :options="modelOptions.map(m => ({ value: m.id, label: m.label }))" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.selector_model')">
        <SSelect v-model:value="form.selectorModel" :options="[{ value: '', label: t('memory_profiles.use_writer_model') }, ...modelOptions.map(m => ({ value: m.id, label: m.label }))]" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.writer_prompt')">
        <SSelect v-model:value="form.writerPromptFile" :options="[{ value: '', label: t('common.default') }, ...writerPromptFiles.map(p => ({ value: p.path, label: p.path }))]" />
      </SFormItem>
      <SFormItem :label="t('memory_profiles.read_prompt')">
        <SSelect v-model:value="form.readPromptFile" :options="[{ value: '', label: t('common.default') }, ...readPromptFiles.map(p => ({ value: p.path, label: p.path }))]" />
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
.refs-expanded {
  padding: var(--sui-sp-4) var(--sui-sp-6);
  background: var(--sui-bg-subtle);
}
</style>
