<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SBadge, SFormItem, STextarea, SCheckCard } from 'sbot-ui'
import type { MemoryItem, MemoryConfig } from '@/types'

const { t } = useI18n()
const { show } = useToast()

const visible      = ref(false)
const memoryId     = ref('')
const memoryConfig = ref<Partial<MemoryConfig>>({})
const memories     = ref<MemoryItem[]>([])
const loading      = ref(false)

const showAddModal = ref(false)
const addContent   = ref('')
const adding       = ref(false)
const autoSplit    = ref(true)

function memUrl(path = '') {
  return `/api/memories/${encodeURIComponent(memoryId.value)}${path}`
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(memUrl())
    memories.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  try {
    await apiFetch(memUrl(`/${encodeURIComponent(id)}`), 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearAll() {
  if (!window.confirm(t('memories.confirm_clear', { name: memoryConfig.value.name || memoryId.value }))) return
  try {
    await apiFetch(memUrl(), 'DELETE')
    memories.value = []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function openAdd() {
  addContent.value   = ''
  autoSplit.value    = true
  showAddModal.value = true
}

async function confirmAdd() {
  if (!addContent.value.trim()) { show(t('memories.error_content'), 'error'); return }
  adding.value = true
  try {
    const res = await apiFetch(memUrl('/add'), 'POST', { content: addContent.value.trim(), autoSplit: autoSplit.value })
    show(t('memories.added_count', { count: res.data?.ids?.length ?? 0 }))
    showAddModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    adding.value = false
  }
}

function open(id: string, config: Partial<MemoryConfig>) {
  memoryId.value     = id
  memoryConfig.value = config
  memories.value     = []
  visible.value      = true
  load()
}

defineExpose({ open })
</script>

<template>
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px">
        <h3 class="s-modal-title">{{ t('memories.content_title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ memoryConfig.name || memoryId }}</SBadge>
        <span v-if="!loading" class="mem-count-badge">{{ t('memories.count', { count: memories.length }) }}</span>
      </div>
    </template>

    <template #toolbar>
      <SButton type="outline" size="sm" :disabled="loading" @click="load">
        {{ loading ? t('common.loading') : t('common.refresh') }}
      </SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('memories.add_memory') }}</SButton>
      <SButton type="danger" size="sm" style="margin-left:auto" :disabled="memories.length === 0" @click="clearAll">
        {{ t('memories.clear_all') }}
      </SButton>
    </template>

    <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
    <div v-else-if="memories.length === 0" class="modal-empty">{{ t('memories.no_memories') }}</div>
    <table v-else class="mem-table">
      <colgroup>
        <col class="cg-content" />
        <col class="cg-time" />
        <col class="cg-access" />
        <col class="cg-time" />
        <col class="cg-ops" />
      </colgroup>
      <thead>
        <tr>
          <th>{{ t('memories.content_col') }}</th>
          <th>{{ t('memories.created_col') }}</th>
          <th class="col-center">{{ t('memories.access_count_col') }}</th>
          <th>{{ t('memories.last_accessed_col') }}</th>
          <th class="col-center">{{ t('common.ops') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in memories" :key="m.id">
          <td class="cell-content" :title="m.content">{{ m.content }}</td>
          <td class="cell-nowrap cell-secondary">{{ m.createdAt ? new Date(m.createdAt).toLocaleString() : '-' }}</td>
          <td class="cell-nowrap cell-secondary col-center">{{ m.accessCount ?? '-' }}</td>
          <td class="cell-nowrap cell-secondary">{{ m.lastAccessed ? new Date(m.lastAccessed).toLocaleString() : '-' }}</td>
          <td class="cell-nowrap col-center">
            <SButton type="danger" size="sm" @click="remove(m.id)">{{ t('common.delete') }}</SButton>
          </td>
        </tr>
      </tbody>
    </table>
  </SModal>

  <!-- Add memory modal (nested) -->
  <SModal v-model:visible="showAddModal" :title="t('memories.add_memory_title')" width="sm" nested>
    <SFormItem :label="t('memories.memory_content')">
      <STextarea v-model="addContent" :rows="7" :placeholder="t('memories.memory_placeholder')" />
    </SFormItem>
    <SCheckCard v-model="autoSplit" style="margin-top:8px">{{ t('memories.auto_split') }}</SCheckCard>
    <template #footer>
      <SButton type="outline" :disabled="adding" @click="showAddModal = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" :disabled="adding" :loading="adding" @click="confirmAdd">
        {{ adding ? t('memories.adding') : t('memories.add_btn') }}
      </SButton>
    </template>
  </SModal>
</template>

<style scoped>
.mem-count-badge {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}
.modal-loading,
.modal-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 60px 0;
  font-size: var(--sui-fs-lg);
}
.mem-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--sui-fs-md);
}
.mem-table th,
.mem-table td {
  padding: var(--sui-sp-3) var(--sui-sp-5);
  border-bottom: 1px solid var(--sui-border);
  vertical-align: middle;
}
.mem-table th {
  background: var(--sui-bg-subtle);
  font-weight: 600;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.mem-table tbody tr:hover { background: var(--sui-bg-subtle); }

.cg-content { width: auto; }
.cg-time    { width: 150px; }
.cg-access  { width: 60px; }
.cg-ops     { width: 70px; }

.cell-content,
.cell-nowrap {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-secondary {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.col-center {
  text-align: center;
}
</style>
