<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { MemoryConfig } from '@/types'
import MemoryViewModal from './modals/MemoryViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const memories         = computed(() => store.settings.memories || {})
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({ id, label: e.name || id }))
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
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('memories.add') }}</button>
    </div>
    <div class="page-content">
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
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">{{ t('memories.empty') }}</td>
          </tr>
          <tr v-for="(m, id) in memories" :key="id">
            <td class="cell-nowrap">{{ m.name || id }}</td>
            <td class="cell-nowrap cell-secondary">{{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}</td>
            <td class="col-center">
              <span v-if="memoryCounts[id as string] === undefined" class="count-loading">...</span>
              <span v-else-if="memoryCounts[id as string] === null" class="count-error">-</span>
              <span v-else class="count-badge">{{ memoryCounts[id as string] }}</span>
            </td>
            <td class="col-center">
              <div class="ops-row">
                <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</button>
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
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
            <span v-if="memoryCounts[id as string] != null" class="count-badge">{{ memoryCounts[id as string] }} {{ t('memories.items') }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('memories.embedding_col') }}</span>
            <span class="mobile-card-value">{{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</button>
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
          </div>
        </div>
      </template>
    </div>

    <!-- Edit/Add modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName !== null ? t('memories.edit_title') : t('memories.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.name') }} *</label>
            <input v-model="form.name" :placeholder="t('memories.name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('memories.embedding_model') }} *</label>
            <select v-model="form.embedding">
              <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <MemoryViewModal ref="memoryViewModal" />
  </div>
</template>

<style scoped>
.mem-list-table {
  table-layout: fixed;
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
  color: #6b6b6b;
  font-size: 12px;
}
.ops-row {
  display: inline-flex;
  gap: 6px;
  white-space: nowrap;
}
.count-badge {
  display: inline-block;
  background: #e8f4f8;
  color: #0e7490;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  min-width: 24px;
  text-align: center;
}
.count-loading {
  color: #94a3b8;
  font-size: 12px;
}
.count-error {
  color: #94a3b8;
  font-size: 12px;
}
</style>
