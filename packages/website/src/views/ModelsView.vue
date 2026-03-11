<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { Model } from '@/types'

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
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  try {
    const body: any = { ...form.value }
    if (body.temperature === undefined || body.temperature === null) delete body.temperature
    if (body.maxTokens === undefined || body.maxTokens === null) delete body.maxTokens
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/models/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/models', 'POST', body)
    Object.assign(store.settings, res.data)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const m = models.value[id]
  const label = (m as any).name || id
  if (!confirm(`确定要删除模型 "${label}" 吗？`)) return
  try {
    const res = await apiFetch(`/api/settings/models/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show('删除成功')
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
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加模型</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>名称</th><th>Provider</th><th>Base URL</th><th>Model</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(models).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无模型</td>
          </tr>
          <tr v-for="(m, id) in models" :key="id">
            <td>{{ (m as any).name || id }}</td>
            <td>{{ m.provider || '-' }}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.baseURL || '-' }}</td>
            <td>{{ m.model || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
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
          <h3>{{ editingName !== null ? '编辑模型' : '添加模型' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 *</label>
            <input v-model="form.name" placeholder="如 openai-gpt4" />
          </div>
          <div class="form-group">
            <label>Provider</label>
            <select v-model="form.provider">
              <option value="openai">openai</option>
              <option value="ollama">ollama</option>
            </select>
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input v-model="form.baseURL" :placeholder="isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1'" />
          </div>
          <div v-if="!isOllama" class="form-group">
            <label>API Key</label>
            <div class="apikey-field">
              <input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." />
              <button type="button" class="apikey-toggle" @click="showApiKey = !showApiKey" :title="showApiKey ? '隐藏' : '显示'">
                {{ showApiKey ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Model</label>
            <input v-model="form.model" :placeholder="isOllama ? 'llama3' : 'gpt-4'" />
          </div>
          <div class="form-group">
            <label>Temperature</label>
            <input v-model.number="form.temperature" type="number" step="0.1" placeholder="0.7" />
          </div>
          <div class="form-group">
            <label>Max Tokens</label>
            <input v-model.number="form.maxTokens" type="number" step="1" placeholder="不限制" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
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
