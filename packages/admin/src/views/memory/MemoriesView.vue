<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import type { MemoryConfig } from '@/shared/types'
import MemoryViewModal from './MemoryViewModal.vue'

const { t } = useI18n()
const { show } = useToast()

const memories         = computed(() => store.settings.memories || {})
const memoryList       = computed(() =>
  Object.entries(memories.value).map(([id, m]) => ({ id, ...m })),
)
const columns = computed<STableColumn[]>(() => [
  { key: 'name',      label: t('common.name'),            primary: true },
  { key: 'embedding', label: t('memories.embedding_col'), width: '180px' },
  { key: 'count',     label: t('memories.count_col'),     width: '70px',  align: 'center' },
  { key: 'ops',       label: t('common.ops'),             ops: true,      width: '180px', align: 'center' },
])
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({
    id,
    label: e.name || id,
    detail: `${e.provider} / ${e.model}`,
  }))
)
const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<MemoryConfig>({
  name: '', embedding: '',
})

const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()

const memoryCounts = ref<Record<string, number | null>>({})

async function loadCounts() {
  const ids = Object.keys(memories.value)
  await Promise.all(ids.map(async id => {
    if (memoryCounts.value[id] !== undefined) return
    try {
      const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}`)
      memoryCounts.value[id] = Array.isArray(res.data) ? res.data.length : 0
    } catch {
      memoryCounts.value[id] = null
    }
  }))
}

onMounted(loadCounts)
watch(memories, () => loadCounts(), { deep: true })

function openAdd() {
  editingName.value = null
  form.value = { name: '', embedding: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const m = memories.value[id]
  editingName.value = id
  form.value = {
    name: m.name,
    embedding: m.embedding,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim())  { show(t('common.name_required'),        'error'); return }
  if (!form.value.embedding)    { show(t('memories.error_embedding'), 'error'); return }
  try {
    const { name, ...config } = form.value
    const body: MemoryConfig = {
      name,
      embedding: config.embedding,
    }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/memories/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/memories', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const m = memories.value[id]
  const label = m.name || id
  if (!window.confirm(t('memories.confirm_delete', { name: label }))) return
  try {
    const res = await apiFetch(`/api/settings/memories/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    delete memoryCounts.value[id]
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    memoryCounts.value = {}
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
      <SButton type="primary" size="sm" @click="openAdd">{{ t('memories.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="memoryList"
        row-key="id"
        :empty-text="t('memories.empty')"
      >
        <template #name="{ row }">{{ row.name || row.id }}</template>
        <template #embedding="{ row }">
          <div class="embed-cell">
            <template v-if="embeddingOptions.find(e => e.id === row.embedding)">
              <div class="embed-label">{{ embeddingOptions.find(e => e.id === row.embedding)!.label }}</div>
              <div class="embed-detail">{{ embeddingOptions.find(e => e.id === row.embedding)!.detail }}</div>
            </template>
            <template v-else>
              <div class="embed-label">{{ row.embedding || '-' }}</div>
            </template>
          </div>
        </template>
        <template #count="{ row }">
          <span v-if="memoryCounts[row.id] === undefined" class="count-muted">...</span>
          <span v-else-if="memoryCounts[row.id] === null" class="count-muted">-</span>
          <SBadge v-else variant="info" pill>{{ memoryCounts[row.id] }}</SBadge>
        </template>
        <template #ops="{ row }">
          <div class="ops-row">
            <SButton type="outline" size="sm" @click="memoryViewModal?.open(row.id, row)">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SModal v-model:visible="showModal" :title="editingName !== null ? t('memories.edit_title') : t('memories.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('memories.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('memories.embedding_model') + ' *'">
        <SSelect v-model="form.embedding">
          <option value="" disabled>{{ t('memories.embedding_placeholder') }}</option>
          <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }} ({{ e.detail }})</option>
        </SSelect>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <MemoryViewModal ref="memoryViewModal" />
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
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
.count-muted {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
</style>
