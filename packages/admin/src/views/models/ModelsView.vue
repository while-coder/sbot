<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { ModelProvider } from '@/shared/types'
import type { ModelConfig } from '@/shared/types'
import { isConfigFieldVisible, type ShowWhen } from '@/utils/configField'
import ResourceRefs from '@/components/ResourceRefs.vue'
import { useResourceRefs } from '@/composables/useResourceRefs'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const models = computed(() => store.settings.models || {})
const modelRows = computed(() =>
  Object.entries(models.value).map(([id, m]) => ({ id, ...m })),
)
const modelColumns = computed<STableColumn[]>(() => [
  { key: 'name',     label: t('common.name'),     primary: true },
  { key: 'provider', label: t('common.provider') },
  { key: 'baseURL',  label: t('common.base_url'), ellipsis: true },
  { key: 'model',    label: t('models.model') },
  { key: 'ops',      label: t('common.ops'), ops: true },
])

const { loadProfiles, makeResourceRefs } = useResourceRefs()
interface ProviderField {
  label: string
  type: 'string' | 'textarea' | 'password' | 'boolean' | 'number' | 'select'
  required?: boolean
  description?: string
  default?: string | boolean | number
  options?: Array<{ label: string; value: string }>
  showWhen?: ShowWhen
}

interface ModelProviderDefinition {
  type: string
  label: string
  configSchema: Record<string, ProviderField>
  defaults?: { baseURL?: string; model?: string; config?: Record<string, any> }
  apiKeyEnabled?: boolean
  apiKeyRequired?: boolean
  supportsModelListing: boolean
}

const providers = ref<ModelProviderDefinition[]>([])
const refs = makeResourceRefs({
  channel: (c, id) => c.intentModel === id,
  profile: (p, id) => p.intentModel === id,
  session: (s, id) => s.intentModel === id,
  agent: (a, id) => a.model === id || a.compactModel === id,
  memoryProfile: (p, id) => p.writerModel === id || p.selectorModel === id,
  agendaProfile: (p, id) => p.syncModel === id,
})
const expandedIds = ref<string[]>([])
onMounted(() => {
  void loadProfiles()
  void loadProviders()
})

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const showApiKey  = ref(false)
const privateFieldVisible = ref<Record<string, boolean>>({})
const form = ref<ModelConfig>({
  name: '', provider: ModelProvider.OpenAI, baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined, contextWindow: undefined, maxTools: undefined, config: {},
})

const currentProvider = computed(() => providers.value.find(provider => provider.type === form.value.provider))
const providerOptions = computed<ModelProviderDefinition[]>(() => {
  const options = providers.value.length > 0
    ? [...providers.value]
    : Object.values(ModelProvider).map(type => ({ type, label: type, configSchema: {}, supportsModelListing: false }))
  if (form.value.provider && !options.some(provider => provider.type === form.value.provider)) {
    options.push({ type: form.value.provider, label: form.value.provider, configSchema: {}, supportsModelListing: false })
  }
  return options
})
const currentSchema = computed(() => currentProvider.value?.configSchema ?? {})
const providerConfig = computed<Record<string, any>>({
  get: () => form.value.config ?? {},
  set: value => { form.value.config = value },
})
const visibleSchemaEntries = computed(() =>
  Object.entries(currentSchema.value).filter(([, field]) => isConfigFieldVisible(field, form.value.config)),
)
const apiKeyEnabled = computed(() => currentProvider.value?.apiKeyEnabled !== false)
const apiKeyRequired = computed(() => currentProvider.value?.apiKeyRequired ?? form.value.provider !== ModelProvider.Ollama)
const providerBaseURL = computed(() => currentProvider.value?.defaults?.baseURL ?? '')
const canPickModels = computed(() => {
  if (!currentProvider.value?.supportsModelListing) return false
  if (!form.value.baseURL) return false
  return !apiKeyRequired.value || !!form.value.apiKey
})

async function loadProviders() {
  try {
    const res = await apiFetch('/api/llm-providers')
    providers.value = res.data as ModelProviderDefinition[]
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function defaultPrivateConfig(provider = currentProvider.value): Record<string, any> {
  const result = { ...(provider?.defaults?.config ?? {}) }
  for (const [key, field] of Object.entries(provider?.configSchema ?? {})) {
    if (result[key] === undefined && field.default !== undefined) result[key] = field.default
  }
  return result
}

function onProviderChange() {
  const provider = currentProvider.value
  form.value.baseURL = provider?.defaults?.baseURL ?? ''
  form.value.model = provider?.defaults?.model ?? ''
  form.value.apiKey = ''
  form.value.config = defaultPrivateConfig(provider)
  showApiKey.value = false
  privateFieldVisible.value = {}
}

const showPicker    = ref(false)
const pickerLoading = ref(false)
const pickerModels  = ref<string[]>([])
const pickerFilter  = ref('')
const filteredModels = computed(() =>
  pickerFilter.value ? pickerModels.value.filter(m => m.toLowerCase().includes(pickerFilter.value.toLowerCase())) : pickerModels.value
)

async function openPicker() {
  pickerLoading.value = true
  pickerModels.value  = []
  pickerFilter.value  = ''
  showPicker.value    = true
  try {
    const res = await apiFetch('/api/models/available', 'POST', {
      baseURL:  form.value.baseURL,
      apiKey:   form.value.apiKey,
      provider: form.value.provider,
      config:   form.value.config,
    })
    pickerModels.value = res.data as string[]
  } catch (e: any) {
    show(e.message, 'error')
    showPicker.value = false
  } finally {
    pickerLoading.value = false
  }
}

function pickModel(m: string) {
  form.value.model = m
  showPicker.value = false
}

function openAdd() {
  editingName.value = null
  showApiKey.value  = false
  const provider = providers.value.find(item => item.type === ModelProvider.OpenAI) ?? providers.value[0]
  form.value = {
    name: '',
    provider: provider?.type ?? ModelProvider.OpenAI,
    baseURL: provider?.defaults?.baseURL ?? '',
    apiKey: '',
    model: provider?.defaults?.model ?? '',
    temperature: undefined,
    maxTokens: undefined,
    contextWindow: undefined,
    maxTools: undefined,
    config: defaultPrivateConfig(provider),
  }
  showModal.value = true
}

function openEdit(id: string) {
  const m = models.value[id]
  const provider = providers.value.find(item => item.type === m.provider)
  editingName.value = id
  showApiKey.value  = false
  form.value = {
    name: m.name || '',
    provider: m.provider,
    baseURL: m.baseURL,
    apiKey: m.apiKey,
    model: m.model,
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    contextWindow: m.contextWindow,
    maxTools: m.maxTools,
    config: { ...defaultPrivateConfig(provider), ...(m.config ?? {}) },
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (!form.value.baseURL.trim()) { show(t('common.base_url_required'), 'error'); return }
  if (apiKeyRequired.value && !form.value.apiKey.trim()) { show(t('common.api_key_required'), 'error'); return }
  if (!form.value.model.trim()) { show(t('common.model_required'), 'error'); return }
  for (const [key, field] of visibleSchemaEntries.value) {
    const value = form.value.config?.[key]
    if (field.required && (value === undefined || value === null || value === '')) {
      show(`${field.label} is required`, 'error')
      return
    }
  }
  try {
    const body: any = { ...form.value }
    if (body.temperature === undefined || body.temperature === null) delete body.temperature
    if (body.maxTokens === undefined || body.maxTokens === null) delete body.maxTokens
    if (body.contextWindow === undefined || body.contextWindow === null) delete body.contextWindow
    if (body.maxTools === undefined || body.maxTools === null) delete body.maxTools
    if (currentProvider.value) {
      const providerConfig: Record<string, any> = {}
      for (const [key, field] of Object.entries(currentSchema.value)) {
        if (!isConfigFieldVisible(field, body.config)) continue
        const value = body.config?.[key]
        if (value !== undefined && value !== null && value !== '') providerConfig[key] = value
      }
      if (Object.keys(providerConfig).length > 0) body.config = providerConfig
      else delete body.config
    } else if (!body.config || Object.keys(body.config).length === 0) {
      delete body.config
    }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/models/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/models', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const m = models.value[id]
  const label = m.name || id
  if (!await confirm(t('models.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/models/${encodeURIComponent(id)}`, 'DELETE')
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
    await loadProfiles()
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('models.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="modelColumns"
        :rows="modelRows"
        row-key="id"
        expandable
        v-model:expandedKeys="expandedIds"
        :empty-text="t('models.empty')"
      >
        <template #name="{ row }">
          {{ row.name || row.id }}
          <ResourceRefs mode="badge" :refs="refs(row.id)" />
        </template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
        </template>
        <template #_expanded="{ row }">
          <div class="refs-expanded">
            <ResourceRefs mode="card" :refs="refs(row.id)" />
          </div>
        </template>
      </STable>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingName !== null ? t('models.edit_title') : t('models.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('models.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.provider') + ' *'">
        <SSelect v-model="form.provider" @change="onProviderChange">
          <option v-for="provider in providerOptions" :key="provider.type" :value="provider.type">{{ provider.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('common.base_url') + ' *'">
        <SInput v-model="form.baseURL" :placeholder="providerBaseURL" />
      </SFormItem>
      <SFormItem v-if="apiKeyEnabled" :label="t('common.api_key') + (apiKeyRequired ? ' *' : '')">
        <div class="apikey-field">
          <SInput v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="API Key" class="apikey-input" />
          <SButton type="outline" size="sm" @click="showApiKey = !showApiKey">{{ showApiKey ? t('common.hide') : t('common.show') }}</SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('models.model') + ' *'">
        <div class="model-field">
          <SInput v-model="form.model" placeholder="Model ID" class="model-input" />
          <SButton type="outline" size="sm" :disabled="!canPickModels" @click="openPicker">{{ t('models.pick') }}</SButton>
        </div>
      </SFormItem>
      <template v-for="[key, field] in visibleSchemaEntries" :key="key">
        <SFormItem :label="field.label + (field.required ? ' *' : '')">
          <SSelect v-if="field.type === 'select'" v-model="providerConfig[key]">
            <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </SSelect>
          <label v-else-if="field.type === 'boolean'" class="checkbox-label">
            <input v-model="providerConfig[key]" type="checkbox" />
            {{ field.description || '' }}
          </label>
          <SInput v-else-if="field.type === 'number'" v-model.number="providerConfig[key]" type="number" :placeholder="field.description || ''" />
          <div v-else-if="field.type === 'password'" class="apikey-field">
            <SInput v-model="providerConfig[key]" :type="privateFieldVisible[key] ? 'text' : 'password'" :placeholder="field.description || ''" class="apikey-input" />
            <SButton type="outline" size="sm" @click="privateFieldVisible[key] = !privateFieldVisible[key]">
              {{ privateFieldVisible[key] ? t('common.hide') : t('common.show') }}
            </SButton>
          </div>
          <SInput v-else-if="field.type === 'textarea'" v-model="providerConfig[key]" multiline :placeholder="field.description || ''" />
          <SInput v-else v-model="providerConfig[key]" :placeholder="field.description || ''" />
          <template v-if="field.type !== 'boolean' && field.description" #hint>{{ field.description }}</template>
        </SFormItem>
      </template>
      <SFormItem :label="t('models.temperature')">
        <SInput v-model.number="form.temperature" type="number" step="0.1" placeholder="0.7" />
      </SFormItem>
      <SFormItem :label="t('models.context_window')">
        <SInput v-model.number="form.contextWindow" type="number" step="1" placeholder="128000" />
      </SFormItem>
      <SFormItem :label="t('models.max_tokens')">
        <SInput v-model.number="form.maxTokens" type="number" step="1" :placeholder="t('models.no_limit')" />
      </SFormItem>
      <SFormItem :label="t('models.max_tools')">
        <SInput v-model.number="form.maxTools" type="number" step="1" :placeholder="t('models.no_limit')" />
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <!-- Model picker -->
    <SModal v-model:visible="showPicker" :title="t('models.pick_title')" width="sm" nested>
      <template #toolbar>
        <div class="picker-filter-bar">
          <svg class="picker-filter-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input v-model="pickerFilter" :placeholder="t('common.filter')" class="picker-filter-input" />
        </div>
      </template>
      <div class="picker-list">
        <div v-if="pickerLoading" class="picker-empty">{{ t('common.loading') }}</div>
        <div v-else-if="filteredModels.length === 0" class="picker-empty">{{ t('models.pick_empty') }}</div>
        <div v-for="m in filteredModels" :key="m" class="picker-item" @click="pickModel(m)">{{ m }}</div>
      </div>
    </SModal>
  </div>
</template>

<style scoped>
.refs-expanded {
  padding: var(--sui-sp-4) var(--sui-sp-6);
  background: var(--sui-bg-subtle);
}
.apikey-field, .model-field {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.apikey-input, .model-input { flex: 1; }
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.picker-filter-bar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  width: 100%;
  color: var(--sui-fg-muted);
}
.picker-filter-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.picker-filter-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
  padding: 0;
  box-shadow: none;
}
.picker-filter-input::placeholder {
  color: var(--sui-fg-disabled);
}
.picker-list {
  max-height: 50vh;
  overflow-y: auto;
  padding: var(--sui-sp-2) 0;
}
.picker-empty {
  text-align: center;
  padding: 24px;
  color: var(--sui-fg-disabled);
}
.picker-item {
  padding: var(--sui-sp-3) var(--sui-sp-5);
  cursor: pointer;
  font-size: var(--sui-fs-md);
  border-radius: var(--sui-radius-sm);
  margin: 0 var(--sui-sp-2);
}
.picker-item:hover {
  background: var(--sui-bg-hover);
}
</style>
