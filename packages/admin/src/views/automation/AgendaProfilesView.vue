<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import AgendaListModal from '@/components/modals/AgendaListModal.vue'

interface AgendaProfileForm {
  name: string
  enabled: boolean
  syncModel: string
  syncPromptFile: string
}

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const profiles = computed(() => store.settings.agendaProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id })),
)

const columns = computed<STableColumn[]>(() => [
  { key: 'name',      label: t('common.name'),               primary: true },
  { key: 'enabled',   label: t('common.enabled'),            width: '100px', align: 'center' },
  { key: 'syncModel', label: t('agenda_profiles.sync_model'), width: '200px' },
  { key: 'prompt',    label: t('agenda_profiles.prompt'),     width: '260px' },
  { key: 'ops',       label: t('common.ops'),                ops: true, width: '260px', align: 'center' },
])

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<AgendaProfileForm>({ name: '', enabled: true, syncModel: '', syncPromptFile: '' })

const agendaListModal = ref<InstanceType<typeof AgendaListModal> | null>(null)
function viewAgendas(row: { id: string; name?: string }) {
  agendaListModal.value?.openByAgendaId(row.id, row.name || row.id)
}

const promptFiles = ref<{ path: string }[]>([])
async function loadPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=agenda/sync')
    promptFiles.value = res.data || []
  } catch { promptFiles.value = [] }
}

function openAdd() {
  editingId.value = null
  form.value = { name: '', enabled: true, syncModel: '', syncPromptFile: '' }
  loadPrompts()
  showModal.value = true
}

function openEdit(id: string) {
  const p: any = profiles.value[id]
  editingId.value = id
  form.value = {
    name: p.name || '',
    enabled: !!p.enabled,
    syncModel: p.syncModel || '',
    syncPromptFile: p.syncPromptFile || '',
  }
  loadPrompts()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const body: any = {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
    }
    if (form.value.syncModel) body.syncModel = form.value.syncModel
    if (form.value.syncPromptFile) body.syncPromptFile = form.value.syncPromptFile
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/agendaProfiles/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/agendaProfiles', 'POST', body)
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
  if (!await confirm(t('agenda_profiles.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/agendaProfiles/${encodeURIComponent(id)}`, 'DELETE')
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
      <SButton type="primary" size="sm" @click="openAdd">{{ t('agenda_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        :empty-text="t('agenda_profiles.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #enabled="{ row }">
          <SBadge :variant="row.enabled ? 'success' : 'neutral'" pill>
            {{ row.enabled ? t('common.enabled') : t('common.disabled') }}
          </SBadge>
        </template>
        <template #syncModel="{ row }">
          <span v-if="row.syncModel">{{ modelOptions.find(m => m.id === row.syncModel)?.label || row.syncModel }}</span>
          <span v-else class="muted">{{ t('agenda_profiles.sync_disabled') }}</span>
        </template>
        <template #prompt="{ row }">
          {{ row.syncPromptFile || t('common.default') }}
        </template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="primary" size="sm" @click="viewAgendas(row)">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingId !== null ? t('agenda_profiles.edit_title') : t('agenda_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('agenda_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :model-value="form.enabled ? 'true' : 'false'" @update:model-value="(v: any) => (form.enabled = v === 'true')">
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agenda_profiles.sync_model')">
        <SSelect v-model="form.syncModel">
          <option value="">{{ t('agenda_profiles.sync_disabled') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agenda_profiles.prompt')">
        <SSelect v-model="form.syncPromptFile">
          <option value="">{{ t('common.default') }}</option>
          <option v-for="p in promptFiles" :key="p.path" :value="p.path">{{ p.path }}</option>
        </SSelect>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <AgendaListModal ref="agendaListModal" />
  </div>
</template>

<style scoped>
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
.muted {
  color: var(--sui-fg-disabled);
  font-style: italic;
}
</style>
