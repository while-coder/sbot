<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { Model } from '@/types'

const { t } = useI18n()
const { show } = useToast()

const models = computed(() => store.settings.models || {})

// Modal state
const showModal   = ref(false)
const editingName = ref<string | null>(null)
const showApiKey  = ref(false)
const form = ref<{ name: string } & Model>({
  name: '', provider: 'openai', baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined,
})

const isOllama = computed(() => form.value.provider === 'ollama')

function openAdd() {
  editingName.value = null
  showApiKey.value  = false
  form.value = { name: '', provider: 'openai', baseURL: '', apiKey: '', model: '', temperature: undefined, maxTokens: undefined }
  showModal.value = true
}

function openEdit(id: string) {
  const m = models.value[id]
  editingName.value = id
  showApiKey.value  = false
  form.value = {
    name: (m as any).name || '',
    provider: m.provider || 'openai',
    baseURL: m.baseURL || '',
    apiKey: m.apiKey || '',
    model: m.model || '',
    temperature: m.temperature,
    maxTokens: m.maxTokens,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const body: any = { ...form.value }
    if (body.temperature === undefined || body.temperature === null) delete body.temperature
    if (body.maxTokens === undefined || body.maxTokens === null) delete body.maxTokens
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
  const label = (m as any).name || id
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
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('models.add') }}</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>{{ t('common.name') }}</th><th>{{ t('common.provider') }}</th><th>{{ t('common.base_url') }}</th><th>{{ t('models.model') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(models).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">{{ t('models.empty') }}</td>
          </tr>
          <tr v-for="(m, id) in models" :key="id">
            <td>{{ (m as any).name || id }}</td>
            <td>{{ m.provider || '-' }}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.baseURL || '-' }}</td>
            <td>{{ m.model || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName !== null ? t('models.edit_title') : t('models.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.name') }} *</label>
            <input v-model="form.name" :placeholder="t('models.name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('common.provider') }}</label>
            <select v-model="form.provider">
              <option value="openai">openai</option>
              <option value="ollama">ollama</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.base_url') }}</label>
            <input v-model="form.baseURL" :placeholder="isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1'" />
          </div>
          <div v-if="!isOllama" class="form-group">
            <label>{{ t('common.api_key') }}</label>
            <div class="apikey-field">
              <input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." />
              <button type="button" class="apikey-toggle" @click="showApiKey = !showApiKey" :title="showApiKey ? t('common.hide') : t('common.show')">
                {{ showApiKey ? t('common.hide') : t('common.show') }}
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>{{ t('models.model') }}</label>
            <input v-model="form.model" :placeholder="isOllama ? 'llama3' : 'gpt-4'" />
          </div>
          <div class="form-group">
            <label>{{ t('models.temperature') }}</label>
            <input v-model.number="form.temperature" type="number" step="0.1" placeholder="0.7" />
          </div>
          <div class="form-group">
            <label>{{ t('models.max_tokens') }}</label>
            <input v-model.number="form.maxTokens" type="number" step="1" :placeholder="t('models.no_limit')" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.apikey-field {
  display: flex;
  gap: 0;
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
</style>
