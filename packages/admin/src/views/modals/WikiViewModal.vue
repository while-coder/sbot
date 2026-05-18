<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import type { WikiConfig } from '@/types'

interface WikiPageItem {
  id: string
  title: string
  tags: string[]
  content?: string
  version: number
  createdAt: number
  updatedAt: number
}

const { t } = useI18n()
const { show } = useToast()

const visible    = ref(false)
const wikiId     = ref('')
const wikiConfig = ref<Partial<WikiConfig>>({})
const pages      = ref<WikiPageItem[]>([])
const loading    = ref(false)

const showEditModal     = ref(false)
const editingPageId     = ref<string | null>(null)
const editTitle         = ref('')
const editContent       = ref('')
const editTags          = ref('')
const saving            = ref(false)

const expandedPage      = ref<string | null>(null)
const pageContents      = ref<Record<string, string>>({})
const pageLoading       = ref<Record<string, boolean>>({})

function wikiUrl(path = '') {
  return `/api/wikis/${encodeURIComponent(wikiId.value)}${path}`
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(wikiUrl())
    pages.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function togglePage(id: string) {
  if (expandedPage.value === id) {
    expandedPage.value = null
    return
  }
  expandedPage.value = id
  if (pageContents.value[id] !== undefined) return
  pageLoading.value[id] = true
  try {
    const res = await apiFetch(wikiUrl(`/pages/${encodeURIComponent(id)}`))
    pageContents.value[id] = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    pageContents.value[id] = ''
  } finally {
    pageLoading.value[id] = false
  }
}

async function removePage(id: string, title: string) {
  if (!window.confirm(t('wikis.confirm_delete_page', { name: title }))) return
  try {
    await apiFetch(wikiUrl(`/pages/${encodeURIComponent(id)}`), 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearAll() {
  if (!window.confirm(t('wikis.confirm_clear', { name: wikiConfig.value.name || wikiId.value }))) return
  try {
    for (const p of pages.value) {
      await apiFetch(wikiUrl(`/pages/${encodeURIComponent(p.id)}`), 'DELETE')
    }
    pages.value = []
    pageContents.value = {}
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function openAdd() {
  editingPageId.value = null
  editTitle.value     = ''
  editContent.value   = ''
  editTags.value      = ''
  showEditModal.value = true
}

async function openEdit(id: string) {
  editingPageId.value = id
  const page = pages.value.find(p => p.id === id)
  editTitle.value   = page?.title || ''
  editTags.value    = page?.tags?.join(', ') || ''
  editContent.value = ''
  showEditModal.value = true
  // load full content
  if (pageContents.value[id] !== undefined) {
    editContent.value = pageContents.value[id]
  } else {
    try {
      const res = await apiFetch(wikiUrl(`/pages/${encodeURIComponent(id)}`))
      const content = res.data?.content || ''
      pageContents.value[id] = content
      editContent.value = content
    } catch (e: any) {
      show(e.message, 'error')
    }
  }
}

async function confirmSave() {
  if (!editTitle.value.trim()) { show(t('wikis.error_title'), 'error'); return }
  if (!editContent.value.trim()) { show(t('wikis.error_content'), 'error'); return }
  saving.value = true
  try {
    const tags = editTags.value.trim() ? editTags.value.split(',').map(s => s.trim()).filter(Boolean) : undefined
    const body = { title: editTitle.value.trim(), content: editContent.value.trim(), tags }
    if (editingPageId.value) {
      await apiFetch(wikiUrl(`/pages/${encodeURIComponent(editingPageId.value)}`), 'PUT', body)
      delete pageContents.value[editingPageId.value]
    } else {
      await apiFetch(wikiUrl('/pages'), 'POST', body)
    }
    show(t('common.saved'))
    showEditModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    saving.value = false
  }
}

function open(id: string, config: Partial<WikiConfig>) {
  wikiId.value     = id
  wikiConfig.value = config
  pages.value      = []
  pageContents.value = {}
  expandedPage.value = null
  visible.value    = true
  load()
}

defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box xl" style="height:86vh">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3>{{ t('wikis.content_title') }}</h3>
          <span class="wiki-name-badge">{{ wikiConfig.name || wikiId }}</span>
          <span v-if="!loading" class="wiki-count-badge">{{ t('wikis.count', { count: pages.length }) }}</span>
        </div>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <div class="modal-header-toolbar">
        <button class="btn-outline btn-sm" :disabled="loading" @click="load">
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
        <button class="btn-primary btn-sm" @click="openAdd">{{ t('wikis.add_page') }}</button>
        <button class="btn-danger btn-sm" style="margin-left:auto" :disabled="pages.length === 0" @click="clearAll">{{ t('wikis.clear_all') }}</button>
      </div>
      <div style="flex:1;overflow-y:auto">
        <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
        <div v-else-if="pages.length === 0" class="modal-empty">{{ t('wikis.no_pages') }}</div>
        <table v-else class="wiki-table">
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>{{ t('wikis.page_title') }}</th>
              <th class="col-tags">{{ t('wikis.page_tags') }}</th>
              <th class="col-time">{{ t('wikis.page_updated') }}</th>
              <th class="col-ops">{{ t('common.ops') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="p in pages" :key="p.id">
              <tr @click="togglePage(p.id)" style="cursor:pointer" :style="expandedPage === p.id ? 'background:#f8fafc' : ''">
                <td style="padding:6px 8px;text-align:center">
                  <span style="color:#6b6b6b;font-size:10px">{{ expandedPage === p.id ? '▼' : '▶' }}</span>
                </td>
                <td style="font-weight:500">{{ p.title }}</td>
                <td class="col-tags">
                  <span v-for="tag in p.tags" :key="tag" class="wiki-tag">{{ tag }}</span>
                  <span v-if="p.tags.length === 0" style="color:#9b9b9b">-</span>
                </td>
                <td class="col-time">{{ new Date(p.updatedAt).toLocaleString() }}</td>
                <td class="col-ops" @click.stop>
                  <div class="ops-cell">
                    <button class="btn-outline btn-sm" @click="openEdit(p.id)">{{ t('common.edit') }}</button>
                    <button class="btn-danger btn-sm" @click="removePage(p.id, p.title)">{{ t('common.delete') }}</button>
                  </div>
                </td>
              </tr>
              <tr v-if="expandedPage === p.id">
                <td></td>
                <td colspan="4" class="page-content-cell">
                  <div v-if="pageLoading[p.id]" style="color:#94a3b8;font-style:italic">{{ t('common.loading') }}</div>
                  <pre v-else class="page-content-pre">{{ pageContents[p.id] || '' }}</pre>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Add/Edit page modal (nested) -->
  <div v-if="showEditModal" class="modal-overlay" style="z-index:1100" @click.self="showEditModal = false">
    <div class="modal-box edit-modal" @keydown.ctrl.s.prevent="confirmSave" @keydown.meta.s.prevent="confirmSave">
      <div class="modal-header">
        <h3>{{ editingPageId ? t('wikis.edit_page_title') : t('wikis.add_page_title') }}</h3>
        <button class="modal-close" @click="showEditModal = false">&times;</button>
      </div>
      <div class="modal-body edit-modal-body">
        <div class="edit-meta-row">
          <div class="form-group" style="flex:1">
            <label>{{ t('wikis.page_title_label') }} *</label>
            <input v-model="editTitle" :placeholder="t('wikis.page_title_placeholder')" />
          </div>
          <div class="form-group" style="width:200px">
            <label>{{ t('wikis.page_tags_label') }}</label>
            <input v-model="editTags" :placeholder="t('wikis.page_tags_placeholder')" />
          </div>
        </div>
        <div class="form-group edit-content-group">
          <label>{{ t('wikis.page_content_label') }} *</label>
          <textarea v-model="editContent" class="edit-textarea" :placeholder="t('wikis.page_content_placeholder')" />
        </div>
      </div>
      <div class="modal-footer">
        <span class="edit-hint">Ctrl+S {{ t('common.save') }}</span>
        <button class="btn-outline" :disabled="saving" @click="showEditModal = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="saving" @click="confirmSave">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wiki-name-badge {
  font-size: 12px;
  font-family: monospace;
  background: #f0f0ee;
  color: #555;
  padding: 2px 8px;
  border-radius: 4px;
}
.wiki-count-badge {
  font-size: 12px;
  color: #9b9b9b;
}
.modal-loading,
.modal-empty {
  text-align: center;
  color: #94a3b8;
  padding: 60px 0;
  font-size: 14px;
}
.wiki-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.wiki-table th,
.wiki-table td {
  padding: 10px 14px;
  border-bottom: 1px solid #f0efed;
  vertical-align: top;
}
.wiki-table th {
  background: #faf9f7;
  font-weight: 600;
  color: #6b6b6b;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.wiki-table tbody tr:hover { background: #faf9f7; }
.col-tags { width: 160px; }
.col-time { width: 148px; white-space: nowrap; color: #6b6b6b; font-size: 12px; }
.col-ops { width: 120px; text-align: center; white-space: nowrap; }
.wiki-tag {
  display: inline-block;
  font-size: 11px;
  background: #e8e6e3;
  color: #3b3a38;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 4px;
  margin-bottom: 2px;
}
.page-content-cell {
  background: #fafaf9;
  padding: 12px 14px !important;
}
.page-content-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  color: #3d3d3d;
  max-height: 300px;
  overflow-y: auto;
}
.edit-modal {
  width: min(720px, 90vw);
  height: 80vh;
  display: flex;
  flex-direction: column;
}
.edit-modal-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.edit-meta-row {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}
.edit-content-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.edit-textarea {
  flex: 1;
  resize: none;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
}
.edit-hint {
  font-size: 12px;
  color: #94a3b8;
  margin-right: auto;
}
</style>
