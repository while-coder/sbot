<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  SButton, SInput, SSelect, SModal, SFormItem, SFormSection, SPageToolbar, SPageContent,
  SEntityTable, toast, confirm,
} from '@sbot/ui-kit'
import type { EntityTableColumn } from '@sbot/ui-kit'
import { api } from '../../../lib/api'
import { emitSettingsChanged } from '../../../lib/settingsEvents'
import { pickVisibleConfig } from '../../../lib/configField'
import type { ConfigField } from '../../../lib/configField'
import { findDesktopSaverId, type SaverEntry } from '../../../lib/defaultSaver'
import SchemaForm from '../SchemaForm.vue'

interface ChannelConfigForm {
  name: string
  type: string
  agent: string
  config: Record<string, any>
  [key: string]: any
}

interface PluginDefinition {
  type: string
  label?: string
  builtin?: boolean
  configSchema: Record<string, ConfigField>
}

const channels = ref<Record<string, ChannelConfigForm>>({})
const plugins = ref<PluginDefinition[]>([])
const agents = ref<Record<string, { name?: string }>>({})
const savers = ref<Record<string, SaverEntry>>({})
const loading = ref(false)
const httpUrl = ref('')

const rows = computed(() => Object.entries(channels.value).map(([id, c]) => ({ id, ...c })))
const columns: EntityTableColumn[] = [
  { key: 'name', label: '名称', primary: true },
  { key: 'type', label: '类型' },
  { key: 'agent', label: 'Agent' },
  { key: 'ops', label: '操作', ops: true },
]

function agentLabel(id: string): string {
  return agents.value[id]?.name || id
}

/** 桌面专用存储（ensureBuiltinSaver 启动时创建）；新渠道默认落到它 */
const desktopSaverId = computed(() => findDesktopSaverId(savers.value))

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [settings, pluginList] = await Promise.all([
      api.get<{
        channels?: Record<string, ChannelConfigForm>
        agents?: Record<string, { name?: string }>
        savers?: Record<string, SaverEntry>
      }>('/api/settings'),
      api.get<PluginDefinition[]>('/api/channel-plugins'),
    ])
    channels.value = settings.channels ?? {}
    agents.value = settings.agents ?? {}
    savers.value = settings.savers ?? {}
    httpUrl.value = (settings as { httpUrl?: string }).httpUrl ?? ''
    plugins.value = pluginList
  } catch (e: any) {
    toast.show('error', e.message)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

/** 失焦/回车触发（SInput change）：接口按字段合并，只提交本字段 */
async function saveHttpUrl(): Promise<void> {
  try {
    //空串（而非省略字段）才能触发后端的 httpUrl || undefined 清除分支
    await api.put('/api/settings/general', { httpUrl: httpUrl.value.trim() })
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

function pluginOf(type: string): PluginDefinition | undefined {
  return plugins.value.find(p => p.type === type)
}
function isBuiltin(id: string): boolean {
  return pluginOf(channels.value[id]?.type)?.builtin ?? false
}

// ── 编辑弹窗 ──

const showModal = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = ref<ChannelConfigForm>({ name: '', type: '', agent: '', saver: '', config: {} })
/** 编辑时保留既有配置的其余字段（PUT 整体替换，避免丢失 notes/wikis/intent 等高级配置） */
let baseChannel: Record<string, any> | null = null

const currentSchema = computed(() => pluginOf(form.value.type)?.configSchema ?? {})
const isEditingBuiltin = computed(() => editingId.value != null && isBuiltin(editingId.value))

const typeOptions = computed(() =>
  plugins.value.map(p => ({ label: p.label || p.type, value: p.type })))
const agentOptions = computed(() =>
  Object.entries(agents.value).map(([id, a]) => ({ label: a.name || id, value: id })))

function openAdd(): void {
  editingId.value = null
  baseChannel = null
  const type = plugins.value.find(p => !p.builtin)?.type || plugins.value[0]?.type || ''
  form.value = {
    name: '',
    type,
    agent: agentOptions.value[0]?.value ?? '',
    config: {},
  }
  showModal.value = true
}

function openEdit(id: string): void {
  const c = channels.value[id]
  if (!c) return
  editingId.value = id
  baseChannel = { ...c, config: { ...(c.config ?? {}) } }
  form.value = {
    name: c.name ?? '',
    type: c.type,
    agent: c.agent ?? '',
    config: { ...(c.config ?? {}) },
  }
  showModal.value = true
}

function validate(): string | null {
  if (!form.value.name.trim()) return '请填写名称'
  if (!form.value.agent) return '请选择 Agent'
  for (const [key, field] of Object.entries(currentSchema.value)) {
    if (!field.required) continue
    const value = form.value.config[key]
    if (value === undefined || value === null || value === '') {
      return `${field.label} 为必填项`
    }
  }
  return null
}

async function save(): Promise<void> {
  const err = validate()
  if (err) { toast.show('error', err); return }
  saving.value = true
  try {
    const config = pickVisibleConfig(currentSchema.value, form.value.config)
    if (editingId.value && baseChannel) {
      // saver 不在表单里：编辑时沿用原值，避免覆盖桌面专用存储
      const payload = { ...baseChannel, name: form.value.name.trim(), agent: form.value.agent, config }
      await api.put(`/api/settings/channels/${encodeURIComponent(editingId.value)}`, payload)
    } else {
      const payload = {
        name: form.value.name.trim(),
        type: form.value.type,
        agent: form.value.agent,
        saver: desktopSaverId.value ?? '',
        notes: [],
        wikis: [],
        config,
      }
      await api.post('/api/settings/channels', payload)
    }
    toast.show('success', '已保存，渠道已热载')
    showModal.value = false
    await refresh()
    emitSettingsChanged()
  } catch (e: any) {
    toast.show('error', e.message)
  } finally {
    saving.value = false
  }
}

async function remove(id: string): Promise<void> {
  if (isBuiltin(id)) { toast.show('error', '内置渠道不可删除'); return }
  const label = channels.value[id]?.name || id
  if (!await confirm.show({ title: '删除渠道', content: `确定删除渠道「${label}」？`, danger: true })) return
  try {
    await api.del(`/api/settings/channels/${encodeURIComponent(id)}`)
    toast.show('success', '已删除')
    await refresh()
    emitSettingsChanged()
  } catch (e: any) {
    toast.show('error', e.message)
  }
}
</script>

<template>
  <div class="page">
    <SPageToolbar>
      <SButton type="outline" size="sm" :loading="loading" @click="refresh">刷新</SButton>
      <SButton type="primary" size="sm" @click="openAdd">添加渠道</SButton>
    </SPageToolbar>
    <SFormSection class="http-url" title="外网访问">
      <SFormItem label="外网访问 URL">
        <SInput v-model:value="httpUrl" placeholder="https://example.com（留空禁用）" @change="saveHttpUrl" />
        <template #hint>对外展示的服务地址，渠道回调链接据此生成</template>
      </SFormItem>
    </SFormSection>
    <SPageContent>
      <SEntityTable :columns="columns" :rows="rows" row-key="id" empty-text="还没有渠道，点击右上角添加">
        <template #name="{ row }">
          {{ row.name || row.id }}
          <span v-if="isBuiltin(row.id)" class="builtin-tag">内置</span>
        </template>
        <template #agent="{ row }">{{ agentLabel(row.agent) }}</template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">编辑</SButton>
          <SButton v-if="!isBuiltin(row.id)" type="danger" size="sm" @click="remove(row.id)">删除</SButton>
        </template>
      </SEntityTable>
    </SPageContent>

    <SModal v-model:show="showModal" :title="editingId ? '编辑渠道' : '添加渠道'" width="md">
      <SFormItem label="名称 *">
        <SInput v-model:value="form.name" placeholder="渠道显示名称" />
      </SFormItem>
      <SFormItem label="类型 *">
        <SSelect v-model:value="form.type" :options="typeOptions" :disabled="isEditingBuiltin" />
      </SFormItem>
      <SFormItem label="Agent *">
        <SSelect v-model:value="form.agent" :options="agentOptions" />
      </SFormItem>

      <SchemaForm :schema="currentSchema" :config="form.config" />

      <template #footer>
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
.http-url {
  padding: 4px 20px 0;
  flex-shrink: 0;
}
.builtin-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--sui-bg-subtle, #f1f3f4);
  color: var(--sui-fg-muted, #8a8f98);
}
</style>
