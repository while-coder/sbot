<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { settingsManager } from '@/managers/settingsManager'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SFormDetails, SPageToolbar, SPageContent, STable } from '@sbot/ui'
import type { STableColumn } from '@sbot/ui'
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
  apiKeyMode?: 'disabled' | 'enabled' | 'required'
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
  name: '', provider: ModelProvider.OpenAI, baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined, contextWindow: undefined, maxTools: undefined, llmInfo: undefined, config: {},
})
type LLMCapabilityKey = 'vision' | 'toolCall' | 'reasoning' | 'temperature' | 'structuredOutput'
type LLMCapabilityValue = 'true' | 'false'

interface CatalogLLMInfo {
  vision: boolean
  toolCall: boolean
  reasoning: boolean
  temperature: boolean
  structuredOutput: boolean
  contextWindow?: number
  maxOutputTokens?: number
  cost?: { input: number; output: number }
  lastUpdated?: string
  fromCatalog: boolean
}

// 能力下拉展示当前生效值；手动选择或自动填充后写入 llmInfo。
function setOverride(key: LLMCapabilityKey, value: LLMCapabilityValue): void {
  form.value.llmInfo = { ...form.value.llmInfo, [key]: value === 'true' }
}
function overrideValue(key: LLMCapabilityKey) {
  return computed({
    get: (): LLMCapabilityValue => String(form.value.llmInfo?.[key] ?? (autoLLMInfo.value ? Boolean(autoLLMInfo.value[key]) : false)) as LLMCapabilityValue,
    set: value => setOverride(key, value),
  })
}
const visionValue = overrideValue('vision')
const toolCallValue = overrideValue('toolCall')
const reasoningValue = overrideValue('reasoning')
const temperatureCapabilityValue = overrideValue('temperature')
const structuredOutputValue = overrideValue('structuredOutput')
// 目录明确不支持 Temperature 时保留现有值供查看，但不允许继续编辑；
// 用户可先在能力覆盖中改为“支持”，以处理目录误判的兼容网关。
const temperatureReadOnly = computed(() => {
  const info = autoLLMInfo.value
  if (!info?.fromCatalog) return false
  return form.value.llmInfo?.temperature ?? !info.temperature
})

// 查询结果用于展示并自动填充模型参数；请求版本避免旧模型结果覆盖新模型。
const autoLLMInfo = ref<CatalogLLMInfo | null>(null)
const llmInfoLoading = ref(false)
let llmInfoTimer: ReturnType<typeof setTimeout> | undefined
let llmInfoRequestId = 0
watch([() => form.value.model, () => form.value.provider], () => {
  clearTimeout(llmInfoTimer)
  const requestId = ++llmInfoRequestId
  autoLLMInfo.value = null
  const model = form.value.model?.trim()
  const provider = form.value.provider
  if (!model) {
    llmInfoLoading.value = false
    return
  }
  llmInfoLoading.value = true
  llmInfoTimer = setTimeout(async () => {
    try {
      const res = await apiFetch('/api/models/llm-info', 'POST', {
        provider,
        model,
      })
      if (requestId !== llmInfoRequestId) return
      const info = res.data as CatalogLLMInfo
      autoLLMInfo.value = info
      if (info.fromCatalog) autofillParams(info)
    } catch {
      // 查询失败不影响编辑，能力选择仍可手动覆盖。
    } finally {
      if (requestId === llmInfoRequestId) llmInfoLoading.value = false
    }
  }, 300)
})
onUnmounted(() => clearTimeout(llmInfoTimer))

/** 将目录提供的限制写入表单。 */
function autofillParams(info: CatalogLLMInfo): void {
  if (info.contextWindow != null) form.value.contextWindow = info.contextWindow
  if (info.maxOutputTokens != null) form.value.maxTokens = info.maxOutputTokens
}
/** 将当前目录能力与限制固化为模型配置。 */
function fillLLMInfoFromCatalog(): void {
  const info = autoLLMInfo.value
  if (!info?.fromCatalog) {
    show(t('models.llm_fill_unlisted'), 'error')
    return
  }
  setOverride('vision', String(Boolean(info.vision)) as LLMCapabilityValue)
  setOverride('toolCall', String(Boolean(info.toolCall)) as LLMCapabilityValue)
  setOverride('reasoning', String(Boolean(info.reasoning)) as LLMCapabilityValue)
  setOverride('temperature', String(Boolean(info.temperature)) as LLMCapabilityValue)
  setOverride('structuredOutput', String(Boolean(info.structuredOutput)) as LLMCapabilityValue)
  autofillParams(info)
}
// 模型参数折叠区标题右侧的 badge：已配置的参数个数（含固化的能力覆盖）
const paramCount = computed(() => {
  const f = form.value
  let n = 0
  if (f.temperature != null) n++
  if (f.contextWindow != null) n++
  if (f.maxTokens != null) n++
  if (f.maxTools != null) n++
  if (f.llmInfo?.vision !== undefined) n++
  if (f.llmInfo?.toolCall !== undefined) n++
  if (f.llmInfo?.reasoning !== undefined) n++
  if (f.llmInfo?.temperature !== undefined) n++
  if (f.llmInfo?.structuredOutput !== undefined) n++
  return n
})

const currentProvider = computed(() => providers.value.find(provider => provider.type === form.value.provider))
const providerOptions = computed<ModelProviderDefinition[]>(() => {
  const options = providers.value.length > 0
    ? [...providers.value]
    : Object.values(ModelProvider).map(type => ({ type, label: type, configSchema: {} }))
  if (form.value.provider && !options.some(provider => provider.type === form.value.provider)) {
    options.push({ type: form.value.provider, label: form.value.provider, configSchema: {} })
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
const apiKeyEnabled = computed(() => (currentProvider.value?.apiKeyMode ?? 'required') !== 'disabled')
const apiKeyRequired = computed(() => (currentProvider.value?.apiKeyMode ?? 'required') === 'required')
const providerBaseURL = computed(() => currentProvider.value?.defaults?.baseURL ?? '')

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
/** 全目录候选有数千条，只渲染前若干条；配合过滤框输入后可精确命中。 */
const MAX_PICKER_ITEMS = 100
const filteredModels = computed(() => {
  const list = pickerFilter.value ? pickerModels.value.filter(m => m.toLowerCase().includes(pickerFilter.value.toLowerCase())) : pickerModels.value
  return list.slice(0, MAX_PICKER_ITEMS)
})

async function openPicker() {
  pickerLoading.value = true
  pickerModels.value  = []
  pickerFilter.value  = ''
  showPicker.value    = true
  try {
    const res = await apiFetch('/api/models/available', 'POST', {})
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
    llmInfo: undefined,
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
    llmInfo: m.llmInfo ? { ...m.llmInfo } : undefined,
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
    if (body.llmInfo && Object.values(body.llmInfo).every(v => v === undefined || v === null)) delete body.llmInfo
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
    settingsManager.apply(res.data)
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
    settingsManager.apply(res.data)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    await settingsManager.refresh()
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
          <SButton type="outline" size="sm" @click="openPicker">{{ t('models.pick') }}</SButton>
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
      <SFormDetails :summary="t('models.section_params')" :badge="paramCount || ''" :open="true">
        <section class="catalog-card" :class="{ 'catalog-card--loading': llmInfoLoading }">
          <div class="catalog-card__head">
            <div>
              <div class="catalog-card__title">{{ t('models.catalog') }}</div>
              <div class="catalog-card__meta">
                <template v-if="llmInfoLoading">{{ t('models.llm_loading') }}</template>
                <template v-else-if="autoLLMInfo?.fromCatalog">
                  <span class="catalog-card__status">{{ t('models.catalog_recognized') }}</span>
                  <span v-if="autoLLMInfo.lastUpdated">{{ t('models.catalog_updated') }} {{ String(autoLLMInfo.lastUpdated).slice(0, 10) }}</span>
                </template>
                <template v-else>{{ t('models.llm_auto_unlisted') }}</template>
              </div>
            </div>
            <SButton
              type="outline"
              size="sm"
              :disabled="!autoLLMInfo?.fromCatalog || llmInfoLoading"
              @click="fillLLMInfoFromCatalog"
            >{{ t('models.llm_fill') }}</SButton>
          </div>
          <div v-if="autoLLMInfo?.fromCatalog" class="catalog-card__body">
            <div class="capability-list" :aria-label="t('models.catalog_capabilities')">
              <div class="capability-item">
                <span>{{ t('models.vision') }}</span>
                <strong :class="autoLLMInfo.vision ? 'capability--yes' : 'capability--no'">
                  {{ autoLLMInfo.vision ? t('models.capability_supported') : t('models.capability_unsupported') }}
                </strong>
              </div>
              <div class="capability-item">
                <span>{{ t('models.tool_call') }}</span>
                <strong :class="autoLLMInfo.toolCall ? 'capability--yes' : 'capability--no'">
                  {{ autoLLMInfo.toolCall ? t('models.capability_supported') : t('models.capability_unsupported') }}
                </strong>
              </div>
              <div class="capability-item">
                <span>{{ t('models.reasoning') }}</span>
                <strong :class="autoLLMInfo.reasoning ? 'capability--yes' : 'capability--no'">
                  {{ autoLLMInfo.reasoning ? t('models.capability_supported') : t('models.capability_unsupported') }}
                </strong>
              </div>
              <div class="capability-item">
                <span>{{ t('models.temperature_control') }}</span>
                <strong :class="autoLLMInfo.temperature ? 'capability--yes' : 'capability--no'">
                  {{ autoLLMInfo.temperature ? t('models.capability_supported') : t('models.capability_unsupported') }}
                </strong>
              </div>
              <div class="capability-item">
                <span>{{ t('models.structured_output') }}</span>
                <strong :class="autoLLMInfo.structuredOutput ? 'capability--yes' : 'capability--no'">
                  {{ autoLLMInfo.structuredOutput ? t('models.capability_supported') : t('models.capability_unsupported') }}
                </strong>
              </div>
            </div>
            <div class="catalog-metrics">
              <div v-if="autoLLMInfo.contextWindow" class="catalog-metric">
                <span>{{ t('models.context_window') }}</span>
                <strong>{{ autoLLMInfo.contextWindow.toLocaleString() }}</strong>
                <small>Tokens</small>
              </div>
              <div v-if="autoLLMInfo.maxOutputTokens" class="catalog-metric">
                <span>{{ t('models.max_tokens') }}</span>
                <strong>{{ autoLLMInfo.maxOutputTokens.toLocaleString() }}</strong>
                <small>Tokens</small>
              </div>
              <div v-if="autoLLMInfo.cost" class="catalog-metric">
                <span>{{ t('models.cost_short') }}</span>
                <strong>${{ autoLLMInfo.cost.input }} / ${{ autoLLMInfo.cost.output }}</strong>
                <small>{{ t('models.per_million_tokens') }}</small>
              </div>
            </div>
          </div>
        </section>

        <div class="parameter-group">
          <div class="parameter-group__head">
            <div>{{ t('models.generation_limits') }}</div>
            <span>{{ t('models.generation_limits_hint') }}</span>
          </div>
          <div class="parameter-grid">
            <SFormItem :label="t('models.temperature')">
              <SInput v-model.number="form.temperature" type="number" step="0.1" placeholder="0.7" :readonly="temperatureReadOnly" />
              <template v-if="temperatureReadOnly" #hint>{{ t('models.temperature_unsupported_hint') }}</template>
            </SFormItem>
            <SFormItem :label="t('models.max_tools')">
              <SInput v-model.number="form.maxTools" type="number" step="1" :placeholder="t('models.no_limit')" />
            </SFormItem>
            <SFormItem :label="t('models.context_window')">
              <SInput v-model.number="form.contextWindow" type="number" step="1" placeholder="128000" />
            </SFormItem>
            <SFormItem :label="t('models.max_tokens')">
              <SInput v-model.number="form.maxTokens" type="number" step="1" :placeholder="t('models.no_limit')" />
            </SFormItem>
          </div>
        </div>

        <div class="parameter-group parameter-group--capabilities">
          <div class="parameter-group__head">
            <div>{{ t('models.capability_override') }}</div>
            <span>{{ t('models.capability_override_hint') }}</span>
          </div>
          <div class="parameter-grid">
            <SFormItem :label="t('models.vision')">
              <SSelect v-model="visionValue">
                <option value="true">{{ t('models.capability_supported') }}</option>
                <option value="false">{{ t('models.capability_unsupported') }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('models.tool_call')">
              <SSelect v-model="toolCallValue">
                <option value="true">{{ t('models.capability_supported') }}</option>
                <option value="false">{{ t('models.capability_unsupported') }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('models.reasoning')">
              <SSelect v-model="reasoningValue">
                <option value="true">{{ t('models.capability_supported') }}</option>
                <option value="false">{{ t('models.capability_unsupported') }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('models.temperature_control')">
              <SSelect v-model="temperatureCapabilityValue">
                <option value="true">{{ t('models.capability_supported') }}</option>
                <option value="false">{{ t('models.capability_unsupported') }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('models.structured_output')">
              <SSelect v-model="structuredOutputValue">
                <option value="true">{{ t('models.capability_supported') }}</option>
                <option value="false">{{ t('models.capability_unsupported') }}</option>
              </SSelect>
            </SFormItem>
          </div>
        </div>
      </SFormDetails>
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
.catalog-card {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  background: var(--sui-bg-subtle);
  margin-bottom: var(--sui-sp-6);
  overflow: hidden;
}
.catalog-card--loading { opacity: .72; }
.catalog-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sui-sp-4);
  padding: var(--sui-sp-3) var(--sui-sp-4);
}
.parameter-group__head span {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-xs);
}
.catalog-card__title {
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  line-height: 1.45;
}
.catalog-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sui-sp-1) var(--sui-sp-2);
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-xs);
  line-height: 1.4;
}
.catalog-card__status {
  color: var(--sui-success-fg);
  font-weight: 600;
}
.catalog-card__body {
  border-top: 1px solid var(--sui-border);
  padding: 0;
}
.capability-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.capability-item {
  display: flex;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-4);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.capability-item:nth-child(even) { border-left: 1px solid var(--sui-border); }
.capability-item:nth-child(n + 3) { border-top: 1px solid var(--sui-border); }
.capability--yes { color: var(--sui-success-fg); }
.capability--no { color: var(--sui-danger); }
.catalog-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--sui-border);
}
.catalog-metric {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: var(--sui-sp-3) var(--sui-sp-4);
  font-variant-numeric: tabular-nums;
}
.catalog-metric + .catalog-metric { border-left: 1px solid var(--sui-border); }
.catalog-metric span,
.catalog-metric small {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-xs);
  line-height: 1.35;
}
.catalog-metric strong {
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-group + .parameter-group {
  border-top: 1px solid var(--sui-border);
  margin-top: var(--sui-sp-2);
  padding-top: var(--sui-sp-5);
}
.parameter-group__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-3);
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
}
.parameter-group__head span { font-weight: 400; text-align: right; }
.parameter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--sui-sp-4);
}
.parameter-grid :deep(.s-form-item) { margin-bottom: var(--sui-sp-4); }
.parameter-grid :deep(.s-form-item:nth-last-child(-n + 2)) { margin-bottom: 0; }
@media (max-width: 480px) {
  .parameter-grid,
  .capability-list { grid-template-columns: 1fr; }
  .catalog-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .capability-item:nth-child(even) { border-left: 0; }
  .capability-item:nth-child(n + 2) { border-top: 1px solid var(--sui-border); }
  .catalog-metric + .catalog-metric { border-left: 1px solid var(--sui-border); }
  .catalog-metric:nth-child(3) { border-left: 0; border-top: 1px solid var(--sui-border); grid-column: 1 / -1; }
  .parameter-grid :deep(.s-form-item) { margin-bottom: var(--sui-sp-4); }
  .parameter-grid :deep(.s-form-item:last-child) { margin-bottom: 0; }
  .catalog-card__head,
  .parameter-group__head { align-items: flex-start; }
  .parameter-group__head { flex-direction: column; gap: var(--sui-sp-1); }
  .parameter-group__head span { text-align: left; }
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
