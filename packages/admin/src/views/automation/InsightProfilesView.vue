<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'

interface InsightProfileForm {
  name: string
  enabled: boolean
  extractor: string
  extractorPromptFile: string
}

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const profiles = computed(() => store.settings.insightProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id })),
)

const columns = computed<STableColumn[]>(() => [
  { key: 'name',      label: t('common.name'),                primary: true },
  { key: 'enabled',   label: t('common.enabled'),             width: '100px', align: 'center' },
  { key: 'extractor', label: t('insight_profiles.extractor'), width: '200px' },
  { key: 'prompt',    label: t('insight_profiles.prompt'),    width: '260px' },
  { key: 'ops',       label: t('common.ops'),                 ops: true, width: '180px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<InsightProfileForm>({ name: '', enabled: true, extractor: '', extractorPromptFile: '' })

const promptFiles = ref<{ path: string }[]>([])
async function loadPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=insight/extractor')
    promptFiles.value = res.data || []
  } catch { promptFiles.value = [] }
}

function openAdd() {
  editingId.value = null
  form.value = { name: '', enabled: true, extractor: '', extractorPromptFile: '' }
  loadPrompts()
  showModal.value = true
}

function openEdit(id: string) {
  const p: any = profiles.value[id]
  editingId.value = id
  form.value = {
    name: p.name || '',
    enabled: !!p.enabled,
    extractor: p.extractor || '',
    extractorPromptFile: p.extractorPromptFile || '',
  }
  loadPrompts()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (form.value.enabled && !form.value.extractor) { show(t('insight_profiles.error_extractor'), 'error'); return }
  try {
    const body: any = {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
      extractor: form.value.extractor,
    }
    if (form.value.extractorPromptFile) body.extractorPromptFile = form.value.extractorPromptFile
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/insightProfiles/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/insightProfiles', 'POST', body)
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
  if (!await confirm(t('insight_profiles.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/insightProfiles/${encodeURIComponent(id)}`, 'DELETE')
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
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('insight_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        :empty-text="t('insight_profiles.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #enabled="{ row }">
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" pill>
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
        </template>
        <template #extractor="{ row }">
          {{ modelOptions.find(m => m.id === row.extractor)?.label || row.extractor || '-' }}
        </template>
        <template #prompt="{ row }">
          {{ row.extractorPromptFile || t('common.default') }}
        </template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingId !== null ? t('insight_profiles.edit_title') : t('insight_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('insight_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :model-value="form.enabled ? 'true' : 'false'" @update:model-value="(v: any) => (form.enabled = v === 'true')">
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('insight_profiles.extractor') + ' *'">
        <SSelect v-model="form.extractor">
          <option value="" disabled>{{ t('insight_profiles.extractor_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('insight_profiles.prompt')">
        <SSelect v-model="form.extractorPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in promptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
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
