<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { MemoryMode } from '@/types'
import type { MemoryConfig } from '@/types'
import MemoryViewModal from './modals/MemoryViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const memories         = computed(() => store.settings.memories || {})
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({ id, label: e.name || id }))
)
const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: m.name || id }))
)

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<MemoryConfig>({
  name: '', mode: MemoryMode.HumanAndAI, maxAgeDays: undefined,
  embedding: '', extractor: '', compressor: '', extractorPrompt: '', compressorPrompt: '', share: false,
})

const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()

// Expand state
const expandedMemories = ref<Record<string, boolean>>({})
const memoryThreadsMap = ref<Record<string, string[]>>({})
const memoryLoading    = ref<Record<string, boolean>>({})

async function toggleExpand(id: string) {
  expandedMemories.value[id] = !expandedMemories.value[id]
  if (!expandedMemories.value[id]) return
  if (id in memoryThreadsMap.value || memoryLoading.value[id]) return
  memoryLoading.value[id] = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/threads`)
    memoryThreadsMap.value[id] = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    memoryThreadsMap.value[id] = []
  } finally {
    memoryLoading.value[id] = false
  }
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', mode: MemoryMode.HumanAndAI, maxAgeDays: undefined, embedding: '', extractor: '', compressor: '', extractorPrompt: '', compressorPrompt: '', share: false }
  showModal.value = true
}

function openEdit(id: string) {
  const m = memories.value[id]
  editingName.value = id
  form.value = {
    name: m.name,
    mode: m.mode,
    maxAgeDays: m.maxAgeDays,
    embedding: m.embedding,
    extractor: m.extractor,
    compressor: m.compressor || '',
    extractorPrompt: m.extractorPrompt || '',
    compressorPrompt: m.compressorPrompt || '',
    share: !!m.share,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim())  { show(t('common.name_required'),        'error'); return }
  if (!form.value.embedding)    { show(t('memories.error_embedding'), 'error'); return }
  if (!form.value.extractor)    { show(t('memories.error_extractor'),      'error'); return }
  try {
    const { name, ...config } = form.value
    const body: MemoryConfig = {
      name,
      mode: config.mode,
      embedding: config.embedding,
      extractor: config.extractor,
      share: !!config.share,
    }
    if (config.maxAgeDays) body.maxAgeDays = config.maxAgeDays
    if (config.compressor) body.compressor = config.compressor
    if (config.extractorPrompt) body.extractorPrompt = config.extractorPrompt
    if (config.compressorPrompt) body.compressorPrompt = config.compressorPrompt
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
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refreshThreads(ids: string[]) {
  await Promise.all(ids.map(async id => {
    memoryLoading.value[id] = true
    try {
      const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/threads`)
      memoryThreadsMap.value[id] = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
    } finally {
      memoryLoading.value[id] = false
    }
  }))
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const expandedIds = Object.keys(expandedMemories.value).filter(id => expandedMemories.value[id])
    if (expandedIds.length > 0) await refreshThreads(expandedIds)
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
      <table v-if="!isMobile">
        <thead>
          <tr><th style="width:32px"></th><th>{{ t('common.name') }}</th><th>{{ t('memories.mode_col') }}</th><th>{{ t('memories.embedding_col') }}</th><th>{{ t('memories.max_days_col') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(memories).length === 0">
            <td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">{{ t('memories.empty') }}</td>
          </tr>
          <template v-for="(m, id) in memories" :key="id">
            <tr
              @click="toggleExpand(id as string)"
              style="cursor:pointer"
              :style="expandedMemories[id as string] ? 'background:#f8fafc' : ''"
            >
              <td style="padding:6px 8px;text-align:center">
                <span style="color:#6b6b6b;font-size:10px">{{ expandedMemories[id as string] ? '▼' : '▶' }}</span>
              </td>
              <td>{{ m.name || id }}</td>
              <td>{{ m.mode || '-' }}</td>
              <td>{{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}</td>
              <td>{{ m.maxAgeDays ?? '-' }}</td>
              <td @click.stop>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
                </div>
              </td>
            </tr>
            <template v-if="expandedMemories[id as string]">
              <tr v-if="memoryLoading[id as string]" class="thread-sub-row">
                <td></td>
                <td colspan="5" class="thread-sub-cell">{{ t('common.loading') }}</td>
              </tr>
              <!-- No threads: show the memory itself as a viewable row -->
              <tr v-else-if="(memoryThreadsMap[id as string] || []).length === 0" class="thread-sub-row">
                <td></td>
                <td colspan="4" class="thread-id-cell">{{ id }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</button>
                </td>
              </tr>
              <tr v-else v-for="thread in memoryThreadsMap[id as string]" :key="thread" class="thread-sub-row">
                <td></td>
                <td colspan="4" class="thread-id-cell">{{ thread }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m, thread)">{{ t('common.view') }}</button>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <template v-else>
        <div v-if="Object.keys(memories).length === 0" class="mobile-card-empty">{{ t('memories.empty') }}</div>
        <div v-for="(m, id) in memories" :key="id" class="mobile-card">
          <div class="mobile-card-header" @click="toggleExpand(id as string)" style="cursor:pointer;display:flex;align-items:center;gap:6px">
            <span style="font-size:10px;color:#9b9b9b">{{ expandedMemories[id as string] ? '▼' : '▶' }}</span>
            {{ m.name || id }}
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('memories.mode_col') }}</span>
            <span class="mobile-card-value">{{ m.mode || '-' }}</span>
            <span class="mobile-card-label">{{ t('memories.embedding_col') }}</span>
            <span class="mobile-card-value">{{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}</span>
            <span class="mobile-card-label">{{ t('memories.max_days_col') }}</span>
            <span class="mobile-card-value">{{ m.maxAgeDays ?? '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
          </div>
          <!-- Expanded threads -->
          <div v-if="expandedMemories[id as string]" class="mobile-card-threads">
            <div v-if="memoryLoading[id as string]" class="thread-sub-cell">{{ t('common.loading') }}</div>
            <!-- No threads: show the memory itself as viewable -->
            <div v-else-if="(memoryThreadsMap[id as string] || []).length === 0" class="mobile-thread-row">
              <span class="thread-id-cell">{{ id }}</span>
              <div class="mobile-card-ops">
                <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m)">{{ t('common.view') }}</button>
              </div>
            </div>
            <div v-for="thread in memoryThreadsMap[id as string] || []" :key="thread" class="mobile-thread-row">
              <span class="thread-id-cell">{{ thread }}</span>
              <div class="mobile-card-ops">
                <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string, m, thread)">{{ t('common.view') }}</button>
              </div>
            </div>
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
            <label>{{ t('memories.memory_mode') }}</label>
            <select v-model="form.mode">
              <option :value="MemoryMode.HumanAndAI">{{ t('memories.mode_human_and_ai') }}</option>
              <option :value="MemoryMode.HumanOnly">{{ t('memories.mode_human_only') }}</option>
              <option :value="MemoryMode.ReadOnly">{{ t('memories.mode_read_only') }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('memories.max_age_days') }}</label>
            <input v-model.number="form.maxAgeDays" type="number" placeholder="90" />
          </div>
          <div class="form-group">
            <label>{{ t('memories.embedding_model') }} *</label>
            <select v-model="form.embedding">
              <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('memories.extractor_model') }} *</label>
            <select v-model="form.extractor">
              <option value="" disabled>{{ t('common.select_placeholder') }}</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('memories.extractor_prompt') }}</label>
            <input v-model="form.extractorPrompt" :placeholder="t('memories.extractor_prompt_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('memories.compressor_model') }}</label>
            <select v-model="form.compressor">
              <option value="">{{ t('common.not_use') }}</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('memories.compressor_prompt') }}</label>
            <input v-model="form.compressorPrompt" :placeholder="t('memories.compressor_prompt_placeholder')" />
          </div>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.share" />
              <span :title="t('memories.share_hint')">{{ t('memories.share') }}</span>
            </label>
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
.thread-sub-row td {
  background: #fafaf9;
  border-bottom: 1px solid #f0efed;
  padding-top: 5px;
  padding-bottom: 5px;
}
.thread-sub-cell {
  padding: 5px 12px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
}
.thread-id-cell {
  font-family: monospace;
  font-size: 12px;
  color: #3d3d3d;
  padding: 5px 12px;
}
.mobile-card-threads {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f0efed;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mobile-thread-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
