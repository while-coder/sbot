<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SBadge, SFormItem, SInput, STextarea } from 'sbot-ui'
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
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px">
        <h3 class="s-modal-title">{{ t('wikis.content_title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ wikiConfig.name || wikiId }}</SBadge>
        <span v-if="!loading" class="wiki-count-badge">{{ t('wikis.count', { count: pages.length }) }}</span>
      </div>
    </template>

    <template #toolbar>
      <SButton type="outline" size="sm" :disabled="loading" @click="load">
        {{ loading ? t('common.loading') : t('common.refresh') }}
      </SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('wikis.add_page') }}</SButton>
      <SButton type="danger" size="sm" style="margin-left:auto" :disabled="pages.length === 0" @click="clearAll">
        {{ t('wikis.clear_all') }}
      </SButton>
    </template>

    <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
    <div v-else-if="pages.length === 0" class="modal-empty">{{ t('wikis.no_pages') }}</div>
    <table v-else class="wiki-table">
      <colgroup>
        <col class="cg-expand" />
        <col class="cg-title" />
        <col class="cg-tags" />
        <col class="cg-time" />
        <col class="cg-ops" />
      </colgroup>
      <thead>
        <tr>
          <th></th>
          <th>{{ t('wikis.page_title') }}</th>
          <th>{{ t('wikis.page_tags') }}</th>
          <th>{{ t('wikis.page_updated') }}</th>
          <th class="col-center">{{ t('common.ops') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="p in pages" :key="p.id">
          <tr class="row-clickable" @click="togglePage(p.id)" :class="{ 'row-expanded': expandedPage === p.id }">
            <td class="cell-expand">
              <span class="expand-icon">{{ expandedPage === p.id ? '▼' : '▶' }}</span>
            </td>
            <td class="cell-title">{{ p.title }}</td>
            <td class="cell-tags">
              <span v-for="tag in p.tags" :key="tag" class="wiki-tag">{{ tag }}</span>
              <span v-if="p.tags.length === 0" class="cell-secondary">-</span>
            </td>
            <td class="cell-nowrap cell-secondary">{{ new Date(p.updatedAt).toLocaleString() }}</td>
            <td class="cell-nowrap col-center" @click.stop>
              <div class="ops-row">
                <SButton type="outline" size="sm" @click="openEdit(p.id)">{{ t('common.edit') }}</SButton>
                <SButton type="danger" size="sm" @click="removePage(p.id, p.title)">{{ t('common.delete') }}</SButton>
              </div>
            </td>
          </tr>
          <tr v-if="expandedPage === p.id">
            <td></td>
            <td colspan="4" class="page-content-cell">
              <div v-if="pageLoading[p.id]" class="cell-secondary" style="font-style:italic">{{ t('common.loading') }}</div>
              <pre v-else class="page-content-pre">{{ pageContents[p.id] || '' }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </SModal>

  <!-- Add/Edit page modal (nested) -->
  <SModal v-model:visible="showEditModal" width="lg" nested :title="editingPageId ? t('wikis.edit_page_title') : t('wikis.add_page_title')">
    <div class="edit-meta-row" @keydown.ctrl.s.prevent="confirmSave" @keydown.meta.s.prevent="confirmSave">
      <SFormItem :label="t('wikis.page_title_label') + ' *'" style="flex:1">
        <SInput v-model="editTitle" :placeholder="t('wikis.page_title_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('wikis.page_tags_label')" style="width:200px">
        <SInput v-model="editTags" :placeholder="t('wikis.page_tags_placeholder')" />
      </SFormItem>
    </div>
    <SFormItem :label="t('wikis.page_content_label') + ' *'" class="edit-content-group">
      <STextarea v-model="editContent" class="edit-textarea" :placeholder="t('wikis.page_content_placeholder')" :rows="14" resize="none" />
    </SFormItem>
    <template #footer>
      <span class="edit-hint">Ctrl+S {{ t('common.save') }}</span>
      <SButton type="outline" :disabled="saving" @click="showEditModal = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" :disabled="saving" :loading="saving" @click="confirmSave">
        {{ saving ? t('common.saving') : t('common.save') }}
      </SButton>
    </template>
  </SModal>
</template>

<style scoped>
.wiki-count-badge {
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
.wiki-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--sui-fs-md);
}
.wiki-table th,
.wiki-table td {
  padding: var(--sui-sp-3) var(--sui-sp-5);
  border-bottom: 1px solid var(--sui-border);
  vertical-align: middle;
}
.wiki-table th {
  background: var(--sui-bg-subtle);
  font-weight: 600;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.wiki-table tbody tr:hover { background: var(--sui-bg-subtle); }

.cg-expand { width: 32px; }
.cg-title  { width: auto; }
.cg-tags   { width: 160px; }
.cg-time   { width: 150px; }
.cg-ops    { width: 130px; }

.row-clickable { cursor: pointer; }
.row-expanded { background: var(--sui-bg-soft); }

.cell-expand {
  text-align: center;
  padding: var(--sui-sp-2) var(--sui-sp-1) !important;
}
.expand-icon {
  color: var(--sui-fg-muted);
  font-size: 10px;
}
.cell-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-tags,
.cell-nowrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-secondary {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
.col-center { text-align: center; }
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
.wiki-tag {
  display: inline-block;
  font-size: var(--sui-fs-xs);
  background: var(--sui-border);
  color: var(--sui-fg-secondary);
  padding: 1px var(--sui-sp-2);
  border-radius: var(--sui-radius-xs);
  margin-right: var(--sui-sp-1);
}
.page-content-cell {
  background: var(--sui-bg-subtle);
  padding: var(--sui-sp-5) var(--sui-sp-6) !important;
  white-space: normal;
}
.page-content-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--sui-fs-sm);
  line-height: 1.6;
  color: var(--sui-fg-secondary);
  max-height: 300px;
  overflow-y: auto;
}
.edit-meta-row {
  display: flex;
  gap: var(--sui-sp-5);
  flex-shrink: 0;
}
.edit-content-group { display: flex; flex-direction: column; }
.edit-textarea {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-md);
  line-height: 1.6;
  tab-size: 2;
}
.edit-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  margin-right: auto;
}
</style>
