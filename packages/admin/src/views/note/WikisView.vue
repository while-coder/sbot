<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SFormSection, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import type { WikiConfig } from '@/shared/types'
import { isConfigFieldVisible, type ShowWhen } from '@/utils/configField'
import WikiViewModal from './WikiViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const wikis = computed(() => store.settings.wikis || {})
const wikiList = computed(() =>
  Object.entries(wikis.value).map(([id, w]) => ({ id, ...w })),
)
const columns = computed<STableColumn[]>(() => [
  { key: 'name',      label: t('common.name'),         primary: true },
  { key: 'embedding', label: t('wikis.embedding_col'), width: '140px' },
  { key: 'pages',     label: t('wikis.pages_col'),     width: '70px',  align: 'center' },
  { key: 'ops',       label: t('common.ops'),          ops: true,      width: '180px', align: 'center' },
])
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({
    id,
    label: e.name || id,
    detail: `${e.provider} / ${e.model}`,
  }))
)

// ── Wiki 数据源插件 ──
interface WikiPluginInfo {
  type: string
  label: string
  readOnly: boolean
  configSchema: Record<string, { label: string; type: string; required?: boolean; description?: string; default?: string | boolean | number; options?: Array<{ label: string; value: string }>; showWhen?: ShowWhen }>
}
const plugins = ref<WikiPluginInfo[]>([])
async function loadPlugins() {
  try {
    const res = await apiFetch('/api/wiki-plugins')
    plugins.value = res.data || []
  } catch { /* ignore */ }
}
loadPlugins()

const currentSchema = computed(() => plugins.value.find(p => p.type === form.value.type)?.configSchema ?? {})
const visibleSchemaEntries = computed(() =>
  Object.entries(currentSchema.value).filter(([, field]) => isConfigFieldVisible(field, form.value.config)),
)
const passwordVisible = ref<Record<string, boolean>>({})

/** 某 wiki 配置对应的数据源是否只读（决定页面 CRUD 是否可用）。 */
function isReadOnly(w: { type?: string }): boolean {
  return !!plugins.value.find(p => p.type === (w.type || 'local'))?.readOnly
}

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<WikiConfig>({
  name: '',
  type: 'local',
  config: {},
})

const wikiViewModal = ref<InstanceType<typeof WikiViewModal>>()

const wikiCounts = ref<Record<string, number | null>>({})

async function loadCounts() {
  const ids = Object.keys(wikis.value)
  await Promise.all(ids.map(async id => {
    if (wikiCounts.value[id] !== undefined) return
    try {
      const res = await apiFetch(`/api/wikis/${encodeURIComponent(id)}`)
      wikiCounts.value[id] = Array.isArray(res.data) ? res.data.length : 0
    } catch {
      wikiCounts.value[id] = null
    }
  }))
}

onMounted(loadCounts)
watch(wikis, () => loadCounts(), { deep: true })

function openAdd() {
  editingName.value = null
  form.value = { name: '', embedding: '', type: 'local', config: {} }
  showModal.value = true
}

function openEdit(id: string) {
  const w = wikis.value[id]
  editingName.value = id
  form.value = {
    name: w.name,
    embedding: w.embedding,
    type: w.type || 'local',
    config: { ...(w.config || {}) },
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const schema = currentSchema.value
    const processedConfig: Record<string, any> = {}
    for (const [key, val] of Object.entries(form.value.config || {})) {
      if (val !== '' && val !== undefined && val !== null) {
        processedConfig[key] = typeof val === 'string' ? val.trim() : val
      }
    }
    const sourceType = form.value.type || 'local'
    const body: WikiConfig = {
      name: form.value.name,
      embedding: form.value.embedding || undefined,
      type: sourceType === 'local' ? undefined : sourceType,
      config: Object.keys(processedConfig).length > 0 ? processedConfig : undefined,
    }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/wikis/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/wikis', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const w = wikis.value[id]
  const label = w.name || id
  if (!await confirm(t('wikis.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/wikis/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    delete wikiCounts.value[id]
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    await loadPlugins()
    wikiCounts.value = {}
    await loadCounts()
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('wikis.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="wikiList"
        row-key="id"
        :empty-text="t('wikis.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #embedding="{ row }">
          <div class="embed-cell">
            <template v-if="embeddingOptions.find(e => e.id === row.embedding)">
              <div class="embed-label">{{ embeddingOptions.find(e => e.id === row.embedding)!.label }}</div>
              <div class="embed-detail">{{ embeddingOptions.find(e => e.id === row.embedding)!.detail }}</div>
            </template>
            <template v-else-if="row.embedding">
              <div class="embed-label">{{ row.embedding }}</div>
            </template>
            <template v-else>
              <div class="embed-label embed-bm25">{{ t('wikis.embedding_bm25_only') }}</div>
            </template>
          </div>
        </template>
        <template #pages="{ row }">
          <span v-if="wikiCounts[row.id] === undefined" class="count-muted">...</span>
          <span v-else-if="wikiCounts[row.id] === null" class="count-muted">-</span>
          <SBadge v-else variant="info" pill>{{ wikiCounts[row.id] }}</SBadge>
        </template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="wikiViewModal?.open(row.id, row, isReadOnly(row))">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingName !== null ? t('wikis.edit_title') : t('wikis.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('wikis.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('wikis.source_type')">
        <SSelect v-model="form.type" @change="form.config = {}" :disabled="editingName !== null">
          <option v-for="p in plugins" :key="p.type" :value="p.type">{{ p.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('wikis.embedding_model')">
        <SSelect v-model="form.embedding">
          <option value="">{{ t('wikis.embedding_none') }}</option>
          <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }} ({{ e.detail }})</option>
        </SSelect>
      </SFormItem>

      <!-- 数据源插件私有配置 -->
      <SFormSection v-if="Object.keys(currentSchema).length > 0" :title="t('wikis.source_config')">
        <template v-for="[key, field] in visibleSchemaEntries" :key="key">
          <SFormItem :label="field.label + (field.required ? ' *' : '')">
            <SSelect v-if="field.type === 'select'" v-model="form.config![key]">
              <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </SSelect>
            <label v-else-if="field.type === 'boolean'" class="toggle-label">
              <input type="checkbox" v-model="form.config![key]" />
              <span>{{ field.description || '' }}</span>
            </label>
            <SInput v-else-if="field.type === 'number'" type="number" v-model.number="form.config![key]" :placeholder="field.description || ''" />
            <div v-else-if="field.type === 'password'" class="apikey-field">
              <SInput v-model="form.config![key]" :placeholder="field.description || ''" :type="passwordVisible[key] ? 'text' : 'password'" class="apikey-input" />
              <button type="button" class="apikey-toggle" @click="passwordVisible[key] = !passwordVisible[key]">{{ passwordVisible[key] ? t('common.hide') : t('common.show') }}</button>
            </div>
            <SInput v-else v-model="form.config![key]" :placeholder="field.description || ''" />
            <template v-if="field.type !== 'boolean' && field.description" #hint>{{ field.description }}</template>
          </SFormItem>
        </template>
      </SFormSection>

      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <WikiViewModal ref="wikiViewModal" />
  </div>
</template>

<style scoped>
.embed-cell {
  min-width: 0;
}
.embed-label,
.embed-detail {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.embed-label {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.embed-detail {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-xs);
}
.embed-bm25 {
  color: var(--sui-fg-disabled);
  font-style: italic;
}
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
.count-muted {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.apikey-field { display: flex; gap: 0; }
.apikey-input { flex: 1; }
.apikey-input :deep(input) { border-radius: var(--sui-radius-md) 0 0 var(--sui-radius-md); border-right: none; }
.apikey-toggle {
  padding: 0 12px;
  font-size: var(--sui-fs-sm);
  background: var(--sui-bg-hover);
  border: 1px solid var(--sui-border-strong);
  border-radius: 0 var(--sui-radius-md) var(--sui-radius-md) 0;
  cursor: pointer;
  color: var(--sui-fg-muted);
  white-space: nowrap;
}
.apikey-toggle:hover { background: var(--sui-bg-active); }
</style>
