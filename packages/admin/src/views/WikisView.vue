<script setup lang="ts">
import { ref, computed } from 'vue'
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
const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: m.name || id }))
)

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<WikiConfig>({
  name: '', extractor: '', autoExtract: true, share: false,
})

const wikiViewModal = ref<InstanceType<typeof WikiViewModal>>()

// Expand state
const expandedWikis = ref<Record<string, boolean>>({})
const wikiThreadsMap = ref<Record<string, string[]>>({})
const wikiLoading    = ref<Record<string, boolean>>({})

async function toggleExpand(id: string) {
  expandedWikis.value[id] = !expandedWikis.value[id]
  if (!expandedWikis.value[id]) return
  if (id in wikiThreadsMap.value || wikiLoading.value[id]) return
  wikiLoading.value[id] = true
  try {
    const res = await apiFetch(`/api/wikis/${encodeURIComponent(id)}/threads`)
    wikiThreadsMap.value[id] = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    wikiThreadsMap.value[id] = []
  } finally {
    wikiLoading.value[id] = false
  }
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', extractor: '', autoExtract: true, share: false }
  showModal.value = true
}

function openEdit(id: string) {
  const w = wikis.value[id]
  editingName.value = id
  form.value = {
    name: w.name,
    extractor: w.extractor,
    autoExtract: w.autoExtract !== false,
    share: !!w.share,
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const body: WikiConfig = {
      name: form.value.name,
      extractor: form.value.extractor,
      autoExtract: form.value.autoExtract,
      share: !!form.value.share,
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
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refreshThreads(ids: string[]) {
  await Promise.all(ids.map(async id => {
    wikiLoading.value[id] = true
    try {
      const res = await apiFetch(`/api/wikis/${encodeURIComponent(id)}/threads`)
      wikiThreadsMap.value[id] = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
    } finally {
      wikiLoading.value[id] = false
    }
  }))
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const expandedIds = Object.keys(expandedWikis.value).filter(id => expandedWikis.value[id])
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
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('wikis.add') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile">
        <thead>
          <tr><th style="width:32px"></th><th>{{ t('common.name') }}</th><th>{{ t('wikis.extractor_col') }}</th><th>{{ t('wikis.auto_extract') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(wikis).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">{{ t('wikis.empty') }}</td>
          </tr>
          <template v-for="(w, id) in wikis" :key="id">
            <tr
              @click="toggleExpand(id as string)"
              style="cursor:pointer"
              :style="expandedWikis[id as string] ? 'background:#f8fafc' : ''"
            >
              <td style="padding:6px 8px;text-align:center">
                <span style="color:#6b6b6b;font-size:10px">{{ expandedWikis[id as string] ? '\u25BC' : '\u25B6' }}</span>
              </td>
              <td>{{ w.name || id }}</td>
              <td>{{ modelOptions.find(m => m.id === w.extractor)?.label || w.extractor || '-' }}</td>
              <td>{{ w.autoExtract !== false ? '\u2713' : '-' }}</td>
              <td @click.stop>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
                </div>
              </td>
            </tr>
            <template v-if="expandedWikis[id as string]">
              <tr v-if="wikiLoading[id as string]" class="thread-sub-row">
                <td></td>
                <td colspan="4" class="thread-sub-cell">{{ t('common.loading') }}</td>
              </tr>
              <!-- No threads: show the wiki itself as a viewable row -->
              <tr v-else-if="(wikiThreadsMap[id as string] || []).length === 0" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-id-cell">{{ id }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</button>
                </td>
              </tr>
              <tr v-else v-for="thread in wikiThreadsMap[id as string]" :key="thread" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-id-cell">{{ thread }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w, thread)">{{ t('common.view') }}</button>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <template v-else>
        <div v-if="Object.keys(wikis).length === 0" class="mobile-card-empty">{{ t('wikis.empty') }}</div>
        <div v-for="(w, id) in wikis" :key="id" class="mobile-card">
          <div class="mobile-card-header" @click="toggleExpand(id as string)" style="cursor:pointer;display:flex;align-items:center;gap:6px">
            <span style="font-size:10px;color:#9b9b9b">{{ expandedWikis[id as string] ? '\u25BC' : '\u25B6' }}</span>
            {{ w.name || id }}
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('wikis.extractor_col') }}</span>
            <span class="mobile-card-value">{{ modelOptions.find(m => m.id === w.extractor)?.label || w.extractor || '-' }}</span>
            <span class="mobile-card-label">{{ t('wikis.auto_extract') }}</span>
            <span class="mobile-card-value">{{ w.autoExtract !== false ? '\u2713' : '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
          </div>
          <!-- Expanded threads -->
          <div v-if="expandedWikis[id as string]" class="mobile-card-threads">
            <div v-if="wikiLoading[id as string]" class="thread-sub-cell">{{ t('common.loading') }}</div>
            <div v-else-if="(wikiThreadsMap[id as string] || []).length === 0" class="mobile-thread-row">
              <span class="thread-id-cell">{{ id }}</span>
              <div class="mobile-card-ops">
                <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</button>
              </div>
            </div>
            <div v-for="thread in wikiThreadsMap[id as string] || []" :key="thread" class="mobile-thread-row">
              <span class="thread-id-cell">{{ thread }}</span>
              <div class="mobile-card-ops">
                <button class="btn-outline btn-sm" @click="wikiViewModal?.open(id as string, w, thread)">{{ t('common.view') }}</button>
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
          <h3>{{ editingName !== null ? t('wikis.edit_title') : t('wikis.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.name') }} *</label>
            <input v-model="form.name" :placeholder="t('wikis.name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('wikis.extractor_model') }}</label>
            <select v-model="form.extractor">
              <option value="">{{ t('common.not_use') }}</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.autoExtract" />
              <span :title="t('wikis.auto_extract_hint')">{{ t('wikis.auto_extract') }}</span>
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.share" />
              <span :title="t('wikis.share_hint')">{{ t('wikis.share') }}</span>
            </label>
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
