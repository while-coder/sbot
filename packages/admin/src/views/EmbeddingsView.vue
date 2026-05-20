<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { EmbeddingProvider } from '@/types'
import type { EmbeddingConfig } from '@/types'

const { t } = useI18n()
const { show } = useToast()

const embeddings = computed(() => store.settings.embeddings || {})
const embeddingRows = computed(() =>
  Object.entries(embeddings.value).map(([id, e]) => ({ id, ...e })),
)
const embeddingColumns = computed<STableColumn[]>(() => [
  { key: 'name',     label: t('common.name'),     primary: true },
  { key: 'provider', label: t('common.provider') },
  { key: 'baseURL',  label: t('common.base_url'), ellipsis: true },
  { key: 'model',    label: t('common.model') },
  { key: 'ops',      label: t('common.ops'), ops: true },
])

const providerDefaults: Record<string, { baseURL: string; apiKey: string; model: string }> = {
  [EmbeddingProvider.OpenAI]:   { baseURL: 'https://api.openai.com/v1',   apiKey: 'sk-...',  model: 'text-embedding-ada-002' },
  [EmbeddingProvider.Ollama]:   { baseURL: 'http://localhost:11434',       apiKey: '',         model: 'nomic-embed-text' },
  [EmbeddingProvider.Gemini]:   { baseURL: 'https://generativelanguage.googleapis.com', apiKey: 'AIza...', model: 'text-embedding-004' },
  [EmbeddingProvider.VoyageAI]: { baseURL: 'https://api.voyageai.com/v1', apiKey: 'pa-...',   model: 'voyage-3' },
  [EmbeddingProvider.Cohere]:   { baseURL: 'https://api.cohere.com/v2',   apiKey: 'sk-...',   model: 'embed-v4.0' },
}

const defaults = computed(() => providerDefaults[form.value.provider] || providerDefaults[EmbeddingProvider.OpenAI])
const isOllama = computed(() => form.value.provider === EmbeddingProvider.Ollama)
const isGemini = computed(() => form.value.provider === EmbeddingProvider.Gemini)

const canPick = computed(() => isGemini.value || isOllama.value || !!form.value.baseURL)

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
    const provider = form.value.provider as string
    const res = await apiFetch('/api/models/available', 'POST', {
      baseURL:  form.value.baseURL,
      apiKey:   form.value.apiKey,
      provider,
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

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const showApiKey  = ref(false)
const form = ref<EmbeddingConfig>({
  name: '', provider: EmbeddingProvider.OpenAI, baseURL: '', apiKey: '', model: '',
})

function openAdd() {
  editingName.value = null
  showApiKey.value  = false
  form.value = { name: '', provider: EmbeddingProvider.OpenAI, baseURL: '', apiKey: '', model: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const e = embeddings.value[id]
  editingName.value = id
  showApiKey.value  = false
  form.value = {
    name: e.name,
    provider: e.provider,
    baseURL: e.baseURL,
    apiKey: e.apiKey,
    model: e.model,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (!isOllama.value && !form.value.apiKey.trim()) { show(t('common.api_key_required'), 'error'); return }
  if (!form.value.model.trim()) { show(t('common.model_required'), 'error'); return }
  try {
    const body = { ...form.value }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/embeddings/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/embeddings', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const e = embeddings.value[id]
  const label = e.name || id
  if (!window.confirm(t('embeddings.confirm_delete', { name: label }))) return
  try {
    const res = await apiFetch(`/api/settings/embeddings/${encodeURIComponent(id)}`, 'DELETE')
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
      <SButton type="primary" size="sm" @click="openAdd">{{ t('embeddings.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable :columns="embeddingColumns" :rows="embeddingRows" row-key="id" :empty-text="t('embeddings.empty')">
        <template #cell-name="{ row }">{{ row.name || row.id }}</template>
        <template #cell-ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingName !== null ? t('embeddings.edit_title') : t('embeddings.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('embeddings.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('common.provider') + ' *'">
        <SSelect v-model="form.provider">
          <option v-for="p in Object.values(EmbeddingProvider)" :key="p" :value="p">{{ p }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('common.base_url')">
        <SInput v-model="form.baseURL" :placeholder="defaults.baseURL" />
      </SFormItem>
      <SFormItem v-if="!isOllama" :label="t('common.api_key') + ' *'">
        <div class="apikey-field">
          <SInput v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="defaults.apiKey" class="apikey-input" />
          <SButton type="outline" size="sm" class="apikey-toggle" @click="showApiKey = !showApiKey">
            {{ showApiKey ? t('common.hide') : t('common.show') }}
          </SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('common.model') + ' *'">
        <div class="model-field">
          <SInput v-model="form.model" :placeholder="defaults.model" class="model-input" />
          <SButton type="outline" size="sm" class="model-pick-btn" :disabled="!canPick" @click="openPicker">{{ t('models.pick') }}</SButton>
        </div>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <!-- Model Picker Modal -->
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
.apikey-input, .model-input {
  flex: 1;
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
