<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { settingsManager } from '@/managers/settingsManager'
import { modelManager } from '@/managers/modelManager'
import { promptFileManager } from '@/managers/promptFileManager'
import { SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, SEntityTable, type EntityTableColumn, toast, confirm } from '@sbot/ui-kit'
import AgendaListModal from '@/components/modals/AgendaListModal.vue'
import ResourceRefs from '@/components/ResourceRefs.vue'
import { useResourceRefs } from '@/composables/useResourceRefs'

interface AgendaProfileForm {
  name: string
  enabled: boolean
  syncModel: string
  syncPromptFile: string
}

const { t } = useI18n()

const profiles = computed(() => store.settings.agendaProfiles || {})
const profileList = computed(() =>
  Object.entries(profiles.value).map(([id, p]) => ({ id, ...p })),
)

const modelOptions = modelManager.options

// ── 被引用情况（频道 / 会话档案） ──
const { loadProfiles, makeResourceRefs } = useResourceRefs()
const refs = makeResourceRefs({
  channel: (c, id) => c.agenda === id,
  profile: (p, id) => p.agenda === id,
})
const expandedIds = ref<string[]>([])
onMounted(loadProfiles)

const columns = computed<EntityTableColumn[]>(() => [
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

const promptFiles = promptFileManager.list('agenda/sync')
async function loadPrompts() {
  try {
    await promptFileManager.ensure('agenda/sync')
  } catch {}
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
  if (!form.value.name.trim()) { toast.show('error', t('common.name_required')); return }
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
  if (!await confirm.show({ title: t('agenda_profiles.confirm_delete', { name: label }), danger: true , content: ''})) return
  try {
    const res = await apiFetch(`/api/settings/agendaProfiles/${encodeURIComponent(id)}`, 'DELETE')
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
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('agenda_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <SEntityTable
        :columns="columns"
        :rows="profileList"
        row-key="id"
        expandable
        v-model:expandedKeys="expandedIds"
        :empty-text="t('agenda_profiles.empty')"
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
        <template #syncModel="{ row }">
          <span v-if="row.syncModel">{{ modelManager.nameOf(row.syncModel) }}</span>
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
        <template #expanded="{ row }">
          <div class="refs-expanded">
            <ResourceRefs mode="card" :refs="refs(row.id)" />
          </div>
        </template>
      </SEntityTable>
    </SPageContent>

    <SModal v-model:show="showModal" :title="editingId !== null ? t('agenda_profiles.edit_title') : t('agenda_profiles.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model:value="form.name" :placeholder="t('agenda_profiles.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.enabled')">
        <SSelect :value="form.enabled ? 'true' : 'false'" @update:value="(v: any) => (form.enabled = v === 'true')" :options="[
          { value: 'true', label: t('common.enabled') },
          { value: 'false', label: t('common.disabled') },
        ]" />
      </SFormItem>
      <SFormItem :label="t('agenda_profiles.sync_model')">
        <SSelect v-model:value="form.syncModel" :options="[{ value: '', label: t('agenda_profiles.sync_disabled') }, ...modelOptions.map(m => ({ value: m.id, label: m.label }))]" />
      </SFormItem>
      <SFormItem :label="t('agenda_profiles.prompt')">
        <SSelect v-model:value="form.syncPromptFile" :options="[{ value: '', label: t('common.default') }, ...promptFiles.map(p => ({ value: p.path, label: p.path }))]" />
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
.refs-expanded {
  padding: var(--sui-sp-4) var(--sui-sp-6);
  background: var(--sui-bg-subtle);
}
</style>
