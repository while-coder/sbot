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
  source: string
  version: number
  createdAt: number
  updatedAt: number
}

const { t } = useI18n()
const { show } = useToast()

const visible    = ref(false)
const wikiId     = ref('')
const wikiConfig = ref<Partial<WikiConfig>>({})
const threadId   = ref<string | undefined>(undefined)
const sessionId  = ref<string | undefined>(undefined)
const pages      = ref<WikiPageItem[]>([])
const loading    = ref(false)

const showAddModal      = ref(false)
const addTitle          = ref('')
const addContent        = ref('')
const addTags           = ref('')
const adding            = ref(false)

const expandedPage      = ref<string | null>(null)
const pageContents      = ref<Record<string, string>>({})
const pageLoading       = ref<Record<string, boolean>>({})

function wikiUrl(path = '') {
  const base = `/api/wikis/${encodeURIComponent(wikiId.value)}${path}`
  if (sessionId.value) return `${base}${path.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId.value)}`
  if (threadId.value) return `${base}${path.includes('?') ? '&' : '?'}threadId=${encodeURIComponent(threadId.value)}`
  return base
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
  addTitle.value   = ''
  addContent.value = ''
  addTags.value    = ''
  showAddModal.value = true
}

async function confirmAdd() {
  if (!addTitle.value.trim()) { show(t('wikis.error_title'), 'error'); return }
  if (!addContent.value.trim()) { show(t('wikis.error_content'), 'error'); return }
  adding.value = true
  try {
    const tags = addTags.value.trim() ? addTags.value.split(',').map(s => s.trim()).filter(Boolean) : undefined
    await apiFetch(wikiUrl('/pages'), 'POST', { title: addTitle.value.trim(), content: addContent.value.trim(), tags })
    show(t('common.created'))
    showAddModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    adding.value = false
  }
}

function open(id: string, config: Partial<WikiConfig>, thread?: string) {
  wikiId.value     = id
  wikiConfig.value = config
  threadId.value   = thread
  sessionId.value  = undefined
  pages.value      = []
  pageContents.value = {}
  expandedPage.value = null
  visible.value    = true
  load()
}

function openSession(id: string, config: Partial<WikiConfig>, sid: string) {
  wikiId.value     = id
  wikiConfig.value = config
  threadId.value   = undefined
  sessionId.value  = sid
  pages.value      = []
  pageContents.value = {}
  expandedPage.value = null
  visible.value    = true
  load()
}

defineExpose({ open, openSession })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box xl" style="height:86vh">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3>{{ t('wikis.content_title') }}</h3>
          <span class="wiki-name-badge">{{ wikiConfig.name || wikiId }}</span>
          <span v-if="wikiConfig.share" class="wiki-share-badge">{{ t('wikis.share') }}</span>
          <span v-if="sessionId || threadId" class="wiki-thread-badge">{{ sessionId || threadId }}</span>
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
              <th class="col-source">{{ t('wikis.page_source') }}</th>
              <th class="col-time">{{ t('wikis.page_updated') }}</th>
              <th class="col-ops">{{ t('common.ops') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="p in pages" :key="p.id">
              <tr @click="togglePage(p.id)" style="cursor:pointer" :style="expandedPage === p.id ? 'background:#f8fafc' : ''">
                <td style="padding:6px 8px;text-align:center">
                  <span style="color:#6b6b6b;font-size:10px">{{ expandedPage === p.id ? '\u25BC' : '\u25B6' }}</span>
                </td>
                <td style="font-weight:500">{{ p.title }}</td>
                <td class="col-tags">
                  <span v-for="tag in p.tags" :key="tag" class="wiki-tag">{{ tag }}</span>
                  <span v-if="p.tags.length === 0" style="color:#9b9b9b">-</span>
                </td>
                <td class="col-source">{{ p.source }}</td>
                <td class="col-time">{{ new Date(p.updatedAt).toLocaleString() }}</td>
                <td class="col-ops" @click.stop>
                  <button class="btn-danger btn-sm" @click="removePage(p.id, p.title)">{{ t('common.delete') }}</button>
                </td>
              </tr>
              <tr v-if="expandedPage === p.id">
                <td></td>
                <td colspan="5" class="page-content-cell">
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

  <!-- Add page modal (nested) -->
  <div v-if="showAddModal" class="modal-overlay" style="z-index:1100" @click.self="showAddModal = false">
    <div class="modal-box" style="width:520px">
      <div class="modal-header">
        <h3>{{ t('wikis.add_page_title') }}</h3>
        <button class="modal-close" @click="showAddModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>{{ t('wikis.page_title_label') }} *</label>
          <input v-model="addTitle" :placeholder="t('wikis.page_title_placeholder')" />
        </div>
        <div class="form-group">
          <label>{{ t('wikis.page_content_label') }} *</label>
          <textarea v-model="addContent" rows="8" :placeholder="t('wikis.page_content_placeholder')" style="resize:vertical" />
        </div>
        <div class="form-group">
          <label>{{ t('wikis.page_tags_label') }}</label>
          <input v-model="addTags" :placeholder="t('wikis.page_tags_placeholder')" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" :disabled="adding" @click="showAddModal = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="adding" @click="confirmAdd">
          {{ adding ? t('common.saving') : t('common.save') }}
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
.wiki-share-badge {
  font-size: 11px;
  background: #f0fdf4;
  color: #16a34a;
  padding: 2px 8px;
  border-radius: 4px;
}
.wiki-thread-badge {
  font-size: 11px;
  font-family: monospace;
  background: #eef2ff;
  color: #6366f1;
  padding: 2px 8px;
  border-radius: 4px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.col-source { width: 90px; color: #6b6b6b; font-size: 12px; }
.col-time { width: 148px; white-space: nowrap; color: #6b6b6b; font-size: 12px; }
.col-ops { width: 80px; text-align: center; white-space: nowrap; }
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
</style>
