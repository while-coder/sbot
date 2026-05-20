<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent } from 'sbot-ui'
import type { MemoryConfig } from '@/types'
import MemoryViewModal from './modals/MemoryViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const memories         = computed(() => store.settings.memories || {})
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
      <table v-if="!isMobile" class="mem-list-table">
        <colgroup>
          <col style="width:auto" />
          <col style="width:180px" />
          <col style="width:70px" />
          <col style="width:180px" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('common.name') }}</th>
            <th>{{ t('memories.embedding_col') }}</th>
            <th class="col-center">{{ t('memories.count_col') }}</th>
            <th class="col-center">{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(memories).length === 0">
            <td colspan="4" class="mem-empty">{{ t('memories.empty') }}</td>
          </tr>
          <tr v-for="(m, id) in memories" :key="id">
            <td class="cell-nowrap">{{ m.name || id }}</td>
            <td class="cell-nowrap cell-secondary">
              <template v-if="embeddingOptions.find(e => e.id === m.embedding)">
                {{ embeddingOptions.find(e => e.id === m.embedding)!.label }}
                <span class="embed-detail">{{ embeddingOptions.find(e => e.id === m.embedding)!.detail }}</span>
              </template>
              <template v-else>{{ m.embedding || '-' }}</template>
            </td>
            <td class="col-center">
              <span v-if="memoryCounts[id as string] === undefined" class="count-muted">...</span>
              <span v-else-if="memoryCounts[id as string] === null" class="count-muted">-</span>
              <SBadge v-else variant="info" pill>{{ memoryCounts[id as string] }}</SBadge>
            </td>
            <td class="col-center">
              <div class="ops-row">
                <SButton type="outline" size="sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</SButton>
                <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
                <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <template v-else>
        <div v-if="Object.keys(memories).length === 0" class="mobile-card-empty">{{ t('memories.empty') }}</div>
        <div v-for="(m, id) in memories" :key="id" class="mobile-card">
          <div class="mobile-card-header">
            <span>{{ m.name || id }}</span>
            <SBadge v-if="memoryCounts[id as string] != null" variant="info" pill>{{ memoryCounts[id as string] }} {{ t('memories.items') }}</SBadge>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('memories.embedding_col') }}</span>
            <span class="mobile-card-value">
              {{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}
              <span v-if="embeddingOptions.find(e => e.id === m.embedding)" class="embed-detail">{{ embeddingOptions.find(e => e.id === m.embedding)!.detail }}</span>
            </span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="outline" size="sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
          </div>
        </div>
      </template>
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
.mem-list-table {
  table-layout: fixed;
}
.mem-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.col-center {
  text-align: center;
}
.cell-nowrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-secondary {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.embed-detail {
  display: block;
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
