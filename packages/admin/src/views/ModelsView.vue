<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { ModelProvider } from '@/types'
import type { ModelConfig } from '@/types'

const { t } = useI18n()
const { show } = useToast()

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

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const showApiKey  = ref(false)
const form = ref<ModelConfig>({
  name: '', provider: ModelProvider.OpenAI, baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined, contextWindow: undefined,
})

const isOllama     = computed(() => form.value.provider === ModelProvider.Ollama)
const isAnthropic  = computed(() => form.value.provider === ModelProvider.Anthropic)
const isGemini     = computed(() => form.value.provider === ModelProvider.Gemini || form.value.provider === ModelProvider.GeminiImage)

const thinkingType = computed({
  get: () => form.value.anthropic?.thinking?.type ?? '',
  set: (v: string) => {
    if (!v) { form.value.anthropic = { ...form.value.anthropic, thinking: undefined }; return }
    form.value.anthropic = {
      ...form.value.anthropic,
      thinking: { type: v as any, ...(v === 'enabled' ? { budgetTokens: form.value.anthropic?.thinking?.budgetTokens ?? 8192 } : {}) },
    }
  },
})
const thinkingBudget = computed({
  get: () => form.value.anthropic?.thinking?.budgetTokens,
  set: (v: number | undefined) => { if (form.value.anthropic?.thinking) form.value.anthropic.thinking.budgetTokens = v },
})
const promptCaching = computed({
  get: () => form.value.anthropic?.promptCaching ?? false,
  set: (v: boolean) => { form.value.anthropic = { ...form.value.anthropic, promptCaching: v || undefined } },
})
const geminiApiVersion = computed({
  get: () => form.value.gemini?.apiVersion ?? '',
  set: (v: string) => { form.value.gemini = { ...form.value.gemini, apiVersion: v || undefined } },
})

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
  form.value = { name: '', provider: ModelProvider.OpenAI, baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined, contextWindow: undefined }
  showModal.value = true
}

function openEdit(id: string) {
  const m = models.value[id]
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
    anthropic: m.anthropic ? { ...m.anthropic } : undefined,
    gemini: m.gemini ? { ...m.gemini } : undefined,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (!form.value.baseURL.trim()) { show(t('common.base_url_required'), 'error'); return }
  if (!isOllama.value && !form.value.apiKey.trim()) { show(t('common.api_key_required'), 'error'); return }
  if (!form.value.model.trim()) { show(t('common.model_required'), 'error'); return }
  try {
    const body: any = { ...form.value }
    if (body.temperature === undefined || body.temperature === null) delete body.temperature
    if (body.maxTokens === undefined || body.maxTokens === null) delete body.maxTokens
    if (body.contextWindow === undefined || body.contextWindow === null) delete body.contextWindow
    if (body.anthropic) {
      if (!body.anthropic.thinking) delete body.anthropic.thinking
      else if (body.anthropic.thinking.type !== 'enabled') delete body.anthropic.thinking.budgetTokens
      if (!body.anthropic.promptCaching) delete body.anthropic.promptCaching
      if (!Object.keys(body.anthropic).length) delete body.anthropic
    }
    if (body.gemini) {
      if (!body.gemini.apiVersion) delete body.gemini.apiVersion
      if (!Object.keys(body.gemini).length) delete body.gemini
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
  if (!window.confirm(t('models.confirm_delete', { name: label }))) return
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
      <STable :columns="modelColumns" :rows="modelRows" row-key="id" :empty-text="t('models.empty')">
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingName !== null ? t('models.edit_title') : t('models.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('models.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.provider') + ' *'">
        <SSelect v-model="form.provider">
          <option v-for="p in Object.values(ModelProvider)" :key="p" :value="p">{{ p }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('common.base_url') + ' *'">
        <SInput v-model="form.baseURL" :placeholder="isOllama ? 'http://localhost:11434' : isAnthropic ? 'https://api.anthropic.com' : isGemini ? '' : 'https://api.openai.com/v1'" />
      </SFormItem>
      <SFormItem v-if="!isOllama" :label="t('common.api_key') + ' *'">
        <div class="apikey-field">
          <SInput v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="isAnthropic ? 'sk-ant-...' : isGemini ? 'AIza...' : 'sk-...'" class="apikey-input" />
          <SButton type="outline" size="sm" @click="showApiKey = !showApiKey">{{ showApiKey ? t('common.hide') : t('common.show') }}</SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('models.model') + ' *'">
        <div class="model-field">
          <SInput v-model="form.model" :placeholder="isOllama ? 'llama3' : isAnthropic ? 'claude-sonnet-4-6' : isGemini ? 'gemini-2.0-flash' : 'gpt-4'" class="model-input" />
          <SButton type="outline" size="sm" :disabled="!isAnthropic && !isGemini && !form.baseURL" @click="openPicker">{{ t('models.pick') }}</SButton>
        </div>
      </SFormItem>
      <SFormItem v-if="isGemini" :label="t('models.api_version')">
        <SInput v-model="geminiApiVersion" placeholder="v1beta" />
      </SFormItem>
      <SFormItem :label="t('models.temperature')">
        <SInput v-model.number="form.temperature" type="number" step="0.1" placeholder="0.7" />
      </SFormItem>
      <SFormItem :label="t('models.context_window')">
        <SInput v-model.number="form.contextWindow" type="number" step="1" placeholder="128000" />
      </SFormItem>
      <SFormItem :label="t('models.max_tokens')">
        <SInput v-model.number="form.maxTokens" type="number" step="1" :placeholder="t('models.no_limit')" />
      </SFormItem>
      <SFormItem v-if="isAnthropic" :label="t('models.thinking')">
        <SSelect v-model="thinkingType">
          <option value="">{{ t('models.thinking_none') }}</option>
          <option value="adaptive">{{ t('models.thinking_adaptive') }}</option>
          <option value="enabled">{{ t('models.thinking_enabled') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem v-if="isAnthropic && thinkingType === 'enabled'" :label="t('models.thinking_budget')">
        <SInput v-model.number="thinkingBudget" type="number" step="1024" placeholder="8192" />
      </SFormItem>
      <SFormItem v-if="isAnthropic" :label="t('models.prompt_caching')">
        <label class="checkbox-label">
          <input v-model="promptCaching" type="checkbox" />
          {{ t('models.prompt_caching_desc') }}
        </label>
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
