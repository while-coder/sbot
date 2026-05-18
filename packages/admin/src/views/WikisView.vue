<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { WikiConfig } from '@/types'
import WikiViewModal from './modals/WikiViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const wikis = computed(() => store.settings.wikis || {})
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({
    id,
    label: e.name || id,
    detail: `${e.provider} / ${e.model}`,
  }))
)

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<WikiConfig>({
  name: '',
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
  form.value = { name: '', embedding: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const w = wikis.value[id]
  editingName.value = id
  form.value = {
    name: w.name,
    embedding: w.embedding,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const body: WikiConfig = {
      name: form.value.name,
      embedding: form.value.embedding || undefined,
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
  if (!window.confirm(t('wikis.confirm_delete', { name: label }))) return
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
    wikiCounts.value = {}
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
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('wikis.add') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile" class="wiki-list-table">
        <colgroup>
          <col style="width:auto" />
          <col style="width:140px" />
          <col style="width:70px" />
          <col style="width:180px" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('common.name') }}</th>
            <th>{{ t('wikis.embedding_col') }}</th>
            <th class="col-center">{{ t('wikis.pages_col') }}</th>
            <th class="col-center">{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(wikis).length === 0">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">{{ t('wikis.empty') }}</td>
          </tr>
          <tr v-for="(w, id) in wikis" :key="id">
            <td class="cell-nowrap">{{ w.name || id }}</td>
            <td class="cell-nowrap cell-secondary">
              <template v-if="embeddingOptions.find(e => e.id === w.embedding)">
                {{ embeddingOptions.find(e => e.id === w.embedding)!.label }}
                <span class="embed-detail">{{ embeddingOptions.find(e => e.id === w.embedding)!.detail }}</span>
              </template>
              <template v-else>{{ w.embedding || t('wikis.embedding_none') }}</template>
            </td>
            <td class="col-center">
              <span v-if="wikiCounts[id as string] === undefined" class="count-loading">...</span>
              <span v-else-if="wikiCounts[id as string] === null" class="count-error">-</span>
              <span v-else class="count-badge">{{ wikiCounts[id as string] }}</span>
            </td>
            <td class="col-center">
              <div class="ops-row">
                <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</button>
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <template v-else>
        <div v-if="Object.keys(wikis).length === 0" class="mobile-card-empty">{{ t('wikis.empty') }}</div>
        <div v-for="(w, id) in wikis" :key="id" class="mobile-card">
          <div class="mobile-card-header">
            <span>{{ w.name || id }}</span>
            <span v-if="wikiCounts[id as string] != null" class="count-badge">{{ wikiCounts[id as string] }} {{ t('wikis.pages_unit') }}</span>
          </div>
          <div v-if="w.embedding" class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('wikis.embedding_col') }}</span>
            <span class="mobile-card-value">
              {{ embeddingOptions.find(e => e.id === w.embedding)?.label || w.embedding }}
              <span v-if="embeddingOptions.find(e => e.id === w.embedding)" class="embed-detail">{{ embeddingOptions.find(e => e.id === w.embedding)!.detail }}</span>
            </span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</button>
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
          <h3>{{ editingName !== null ? t('wikis.edit_title') : t('wikis.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.name') }} *</label>
            <input v-model="form.name" :placeholder="t('wikis.name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('wikis.embedding_model') }}</label>
            <select v-model="form.embedding">
              <option value="">{{ t('wikis.embedding_none') }}</option>
              <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }} ({{ e.detail }})</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <WikiViewModal ref="wikiViewModal" />
  </div>
</template>

<style scoped>
.wiki-list-table {
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
.embed-detail {
  display: block;
  color: #94a3b8;
  font-size: 11px;
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
