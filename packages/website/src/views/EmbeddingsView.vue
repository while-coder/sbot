<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { EmbeddingProvider } from '@/types'
import type { EmbeddingConfig } from '@/types'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const embeddings = computed(() => store.settings.embeddings || {})

// Model picker
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
    const provider = form.value.provider === EmbeddingProvider.Ollama ? 'ollama' : 'openai'
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
  if (!form.value.baseURL.trim()) { show(t('common.base_url_required'), 'error'); return }
  if (!form.value.apiKey.trim()) { show(t('common.api_key_required'), 'error'); return }
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
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('embeddings.add') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile">
        <thead>
          <tr><th>{{ t('common.name') }}</th><th>{{ t('common.provider') }}</th><th>{{ t('common.base_url') }}</th><th>{{ t('common.model') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(embeddings).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">{{ t('embeddings.empty') }}</td>
          </tr>
          <tr v-for="(emb, id) in embeddings" :key="id">
            <td>{{ emb.name || id }}</td>
            <td>{{ emb.provider }}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ emb.baseURL }}</td>
            <td>{{ emb.model }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="card-list">
        <div v-for="(emb, id) in embeddings" :key="id" class="mobile-card">
          <div class="mobile-card-header">{{ emb.name || id }}</div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">Provider</span>
            <span class="mobile-card-value">{{ emb.provider }}</span>
            <span class="mobile-card-label">Model</span>
            <span class="mobile-card-value">{{ emb.model }}</span>
            <span class="mobile-card-label">Base URL</span>
            <span class="mobile-card-value" style="word-break:break-all">{{ emb.baseURL }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
          </div>
        </div>
        <div v-if="Object.keys(embeddings).length === 0" class="mobile-card-empty">-</div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName !== null ? t('embeddings.edit_title') : t('embeddings.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.name') }} *</label>
            <input v-model="form.name" :placeholder="t('embeddings.name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('common.provider') }} *</label>
            <select v-model="form.provider">
              <option v-for="p in Object.values(EmbeddingProvider)" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.base_url') }} *</label>
            <input v-model="form.baseURL" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="form-group">
            <label>{{ t('common.api_key') }} *</label>
            <div class="apikey-field">
              <input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." />
              <button type="button" class="apikey-toggle" @click="showApiKey = !showApiKey" :title="showApiKey ? t('common.hide') : t('common.show')">
                {{ showApiKey ? t('common.hide') : t('common.show') }}
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>{{ t('common.model') }} *</label>
            <div class="model-field">
              <input v-model="form.model" placeholder="text-embedding-ada-002" />
              <button type="button" class="model-pick-btn" @click="openPicker" :disabled="!form.baseURL">{{ t('models.pick') }}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <!-- Model Picker Modal -->
    <div v-if="showPicker" class="modal-overlay" @click.self="showPicker = false" style="z-index:1100">
      <div class="modal-box" style="width:360px;max-height:70vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <h3>{{ t('models.pick_title') }}</h3>
          <button class="modal-close" @click="showPicker = false">&times;</button>
        </div>
        <div class="picker-filter-bar">
          <svg class="picker-filter-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6.5" cy="6.5" r="4" stroke="#94a3b8" stroke-width="1.4"/>
            <path d="M10 10l3 3" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input v-model="pickerFilter" :placeholder="t('common.filter')" class="picker-filter-input" />
        </div>
        <div class="modal-body" style="overflow-y:auto;flex:1;padding:8px 0">
          <div v-if="pickerLoading" style="text-align:center;padding:24px;color:#94a3b8">{{ t('common.loading') }}</div>
          <div v-else-if="filteredModels.length === 0" style="text-align:center;padding:24px;color:#94a3b8">{{ t('models.pick_empty') }}</div>
          <div v-for="m in filteredModels" :key="m" class="picker-item" @click="pickModel(m)">{{ m }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.apikey-field {
  display: flex;
}
.apikey-field input {
  flex: 1;
  border-radius: 6px 0 0 6px;
  border-right: none;
}
.apikey-toggle {
  padding: 0 12px;
  font-size: 12px;
  background: #f4f3f1;
  border: 1px solid #d1d0ce;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  color: #555;
  white-space: nowrap;
  transition: background .15s;
}
.apikey-toggle:hover {
  background: #eceae6;
}
.model-field {
  display: flex;
  gap: 0;
}
.model-field input {
  flex: 1;
  border-radius: 6px 0 0 6px;
  border-right: none;
}
.model-pick-btn {
  padding: 0 12px;
  font-size: 12px;
  background: #f4f3f1;
  border: 1px solid #d1d0ce;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  color: #555;
  white-space: nowrap;
  transition: background .15s;
}
.model-pick-btn:hover:not(:disabled) {
  background: #eceae6;
}
.model-pick-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.picker-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #e8e6e3;
}
.picker-filter-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.picker-filter-input {
  flex: 1;
  border: none !important;
  outline: none !important;
  background: transparent;
  font-size: 13px;
  color: #1c1c1c;
  padding: 0 !important;
  box-shadow: none !important;
}
.picker-filter-input::placeholder {
  color: #94a3b8;
}
.picker-item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
  margin: 0 8px;
}
.picker-item:hover {
  background: #f4f3f1;
}
</style>
