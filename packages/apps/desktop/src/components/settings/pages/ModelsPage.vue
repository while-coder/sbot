<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  SButton, SInput, SSelect, SModal, SFormItem, SCollapse, SCollapseItem, SPageToolbar,
  SPageContent, SEntityTable, toast, confirm,
} from '@sbot/ui-kit'
import type { EntityTableColumn } from '@sbot/ui-kit'
import { api } from '../../../lib/api'
import { emitSettingsChanged } from '../../../lib/settingsEvents'
import { pickVisibleConfig } from '../../../lib/configField'
import type { ConfigField } from '../../../lib/configField'
import SchemaForm from '../SchemaForm.vue'

interface ModelConfigForm {
  name: string
  provider: string
  baseURL: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  maxTools?: number
  /** 既有配置透传（本窗口不提供编辑入口，避免 PUT 整体替换时丢失） */
  llmInfo?: Record<string, any>
  config: Record<string, any>
}

interface ProviderDefinition {
  type: string
  label: string
  configSchema: Record<string, ConfigField>
  defaults?: { baseURL?: string; model?: string; config?: Record<string, any> }
  apiKeyMode?: 'disabled' | 'enabled' | 'required'
}

const models = ref<Record<string, ModelConfigForm>>({})
const providers = ref<ProviderDefinition[]>([])
const loading = ref(false)

const rows = computed(() => Object.entries(models.value).map(([id, m]) => ({ id, ...m })))
const columns: EntityTableColumn[] = [
  { key: 'name', label: '名称', primary: true },
  { key: 'provider', label: '提供商' },
  { key: 'baseURL', label: 'Base URL', ellipsis: true },
  { key: 'model', label: '模型' },
  { key: 'ops', label: '操作', ops: true },
]

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [settings, providerList] = await Promise.all([
      api.get<{ models?: Record<string, ModelConfigForm> }>('/api/settings'),
      api.get<ProviderDefinition[]>('/api/llm-providers'),
    ])
    models.value = settings.models ?? {}
    providers.value = providerList
  } catch (e: any) {
    toast.show('error', e.message)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

// ── 编辑弹窗 ──

const showModal = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const testing = ref(false)

const emptyForm = (): ModelConfigForm => ({
  name: '', provider: '', baseURL: '', apiKey: '', model: '', config: {},
})
const form = ref<ModelConfigForm>(emptyForm())

const currentProvider = computed(() => providers.value.find(p => p.type === form.value.provider))
const currentSchema = computed(() => currentProvider.value?.configSchema ?? {})
// 仅用于必填校验；可见性/渲染逻辑在 SchemaForm 内部
const visibleSchemaEntries = computed(() => Object.entries(currentSchema.value))
const apiKeyEnabled = computed(() => (currentProvider.value?.apiKeyMode ?? 'required') !== 'disabled')
const apiKeyRequired = computed(() => (currentProvider.value?.apiKeyMode ?? 'required') === 'required')

function defaultProviderConfig(provider: ProviderDefinition | undefined): Record<string, any> {
  const result = { ...(provider?.defaults?.config ?? {}) }
  for (const [key, field] of Object.entries(provider?.configSchema ?? {})) {
    if (result[key] === undefined && field.default !== undefined) result[key] = field.default
  }
  return result
}

function onProviderChange(): void {
  const provider = currentProvider.value
  form.value.baseURL = provider?.defaults?.baseURL ?? ''
  form.value.model = provider?.defaults?.model ?? ''
  form.value.apiKey = ''
  form.value.config = defaultProviderConfig(provider)
}

function openAdd(): void {
  editingId.value = null
  const provider = providers.value[0]
  form.value = {
    ...emptyForm(),
    provider: provider?.type ?? '',
    baseURL: provider?.defaults?.baseURL ?? '',
    model: provider?.defaults?.model ?? '',
    config: defaultProviderConfig(provider),
  }
  showModal.value = true
}

function openEdit(id: string): void {
  const m = models.value[id]
  if (!m) return
  const provider = providers.value.find(p => p.type === m.provider)
  editingId.value = id
  form.value = {
    name: m.name ?? '',
    provider: m.provider,
    baseURL: m.baseURL ?? '',
    apiKey: m.apiKey ?? '',
    model: m.model ?? '',
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    contextWindow: m.contextWindow,
    maxTools: m.maxTools,
    llmInfo: m.llmInfo ? { ...m.llmInfo } : undefined,
    config: { ...defaultProviderConfig(provider), ...(m.config ?? {}) },
  }
  showModal.value = true
}

function validate(): string | null {
  if (!form.value.name.trim()) return '请填写名称'
  if (!form.value.baseURL.trim()) return '请填写 Base URL'
  if (apiKeyRequired.value && !form.value.apiKey.trim()) return '请填写 API Key'
  if (!form.value.model.trim()) return '请填写模型 ID'
  for (const [key, field] of visibleSchemaEntries.value) {
    const value = form.value.config[key]
    if (field.required && (value === undefined || value === null || value === '')) {
      return `${field.label} 为必填项`
    }
  }
  return null
}

function buildBody(): Record<string, any> {
  const body: Record<string, any> = { ...form.value }
  for (const key of ['temperature', 'maxTokens', 'contextWindow', 'maxTools'] as const) {
    if (body[key] === undefined || body[key] === null || body[key] === ('' as any)) delete body[key]
  }
  if (body.llmInfo && Object.values(body.llmInfo).every(v => v === undefined || v === null)) {
    delete body.llmInfo
  }
  const config = pickVisibleConfig(currentSchema.value, form.value.config)
  if (Object.keys(config).length > 0) body.config = config
  else delete body.config
  return body
}

async function save(): Promise<void> {
  const err = validate()
  if (err) { toast.show('error', err); return }
  saving.value = true
  try {
    const body = buildBody()
    if (editingId.value) {
      await api.put(`/api/settings/models/${encodeURIComponent(editingId.value)}`, body)
    } else {
      await api.post('/api/settings/models', body)
    }
    toast.show('success', '已保存')
    showModal.value = false
    await refresh()
    emitSettingsChanged()
  } catch (e: any) {
    toast.show('error', e.message)
  } finally {
    saving.value = false
  }
}

async function testConnection(): Promise<void> {
  const err = !form.value.model.trim() ? '请先填写模型 ID' : null
  if (err) { toast.show('error', err); return }
  testing.value = true
  try {
    const result = await api.post<{ ok: boolean; latencyMs: number; preview: string }>('/api/models/test', {
      provider: form.value.provider,
      baseURL: form.value.baseURL,
      apiKey: form.value.apiKey,
      model: form.value.model,
      config: form.value.config,
    })
    toast.show('success', `连接成功 · ${result.latencyMs}ms${result.preview ? ` · ${result.preview}` : ''}`)
  } catch (e: any) {
    toast.show('error', `连接失败：${e.message}`)
  } finally {
    testing.value = false
  }
}

async function remove(id: string): Promise<void> {
  const label = models.value[id]?.name || id
  if (!await confirm.show({ title: '删除模型', content: `确定删除模型「${label}」？`, danger: true })) return
  try {
    await api.del(`/api/settings/models/${encodeURIComponent(id)}`)
    toast.show('success', '已删除')
    await refresh()
    emitSettingsChanged()
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

const providerOptions = computed(() =>
  providers.value.map(p => ({ label: p.label || p.type, value: p.type })))
</script>

<template>
  <div class="page">
    <SPageToolbar>
      <SButton type="outline" size="sm" :loading="loading" @click="refresh">刷新</SButton>
      <SButton type="primary" size="sm" @click="openAdd">添加模型</SButton>
    </SPageToolbar>
    <SPageContent>
      <SEntityTable :columns="columns" :rows="rows" row-key="id" empty-text="还没有模型，点击右上角添加">
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">编辑</SButton>
          <SButton type="danger" size="sm" @click="remove(row.id)">删除</SButton>
        </template>
      </SEntityTable>
    </SPageContent>

    <SModal v-model:show="showModal" :title="editingId ? '编辑模型' : '添加模型'" width="md">
      <SFormItem label="名称 *">
        <SInput v-model:value="form.name" placeholder="显示名称，如 GPT-4o" />
      </SFormItem>
      <SFormItem label="提供商 *">
        <SSelect v-model:value="form.provider" :options="providerOptions" @change="onProviderChange" />
      </SFormItem>
      <SFormItem label="Base URL *">
        <SInput v-model:value="form.baseURL" :placeholder="currentProvider?.defaults?.baseURL || 'https://api.openai.com/v1'" />
      </SFormItem>
      <SFormItem v-if="apiKeyEnabled" :label="'API Key' + (apiKeyRequired ? ' *' : '')">
        <SInput v-model:value="form.apiKey" type="password" placeholder="API Key" />
      </SFormItem>
      <SFormItem label="模型 ID *">
        <SInput v-model:value="form.model" placeholder="如 gpt-4o-mini" />
      </SFormItem>

      <SchemaForm :schema="currentSchema" :config="form.config" />

      <SCollapse>
      <SCollapseItem title="参数（可选，留空自动适配）" name="params">
        <SFormItem label="Temperature">
          <SInput v-model:value.number="form.temperature" type="number" step="0.1" placeholder="0.7" />
        </SFormItem>
        <SFormItem label="Max Tokens">
          <SInput v-model:value.number="form.maxTokens" type="number" step="1" placeholder="不限制" />
        </SFormItem>
        <SFormItem label="上下文窗口">
          <SInput v-model:value.number="form.contextWindow" type="number" step="1" placeholder="128000" />
        </SFormItem>
        <SFormItem label="最大工具数">
          <SInput v-model:value.number="form.maxTools" type="number" step="1" placeholder="不限制" />
        </SFormItem>
      </SCollapseItem>
      </SCollapse>

      <template #footer>
        <SButton type="outline" :loading="testing" @click="testConnection">测试连接</SButton>
        <span class="spacer"></span>
        <SButton type="outline" @click="showModal = false">取消</SButton>
        <SButton type="primary" :loading="saving" @click="save">保存</SButton>
      </template>
    </SModal>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
}
.spacer {
  flex: 1;
}
</style>
