<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SBadge, SFormItem, STextarea, SCheckCard, STable, type STableColumn } from 'sbot-ui'
import type { MemoryItem, MemoryConfig } from '@/types'

const { t } = useI18n()
const { show } = useToast()

const columns = computed<STableColumn[]>(() => [
  { key: 'content',      label: t('memories.content_col'),        primary: true, ellipsis: true },
  { key: 'createdAt',    label: t('memories.created_col'),        width: '150px', ellipsis: true },
  { key: 'accessCount',  label: t('memories.access_count_col'),   width: '60px',  align: 'center' },
  { key: 'lastAccessed', label: t('memories.last_accessed_col'),  width: '150px', ellipsis: true },
  { key: 'ops',          label: t('common.ops'),                  width: '70px',  align: 'center', ops: true },
])

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

    <STable
      :columns="columns"
      :rows="memories"
      row-key="id"
      :loading="loading"
      :loading-text="t('common.loading')"
      :empty-text="t('memories.no_memories')"
    >
      <template #content="{ row }">
        <span :title="row.content">{{ row.content }}</span>
      </template>
      <template #createdAt="{ row }">
        <span class="cell-secondary">{{ row.createdAt ? new Date(row.createdAt).toLocaleString() : '-' }}</span>
      </template>
      <template #accessCount="{ row }">
        <span class="cell-secondary">{{ row.accessCount ?? '-' }}</span>
      </template>
      <template #lastAccessed="{ row }">
        <span class="cell-secondary">{{ row.lastAccessed ? new Date(row.lastAccessed).toLocaleString() : '-' }}</span>
      </template>
      <template #ops="{ row }">
        <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
      </template>
    </STable>
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
.cell-secondary {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
</style>
