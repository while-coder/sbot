<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm } from 'sbot-ui'
import { SModal, SButton, SBadge, SFormItem, SInput, STextarea, STable, type STableColumn } from 'sbot-ui'
import type { WikiConfig } from '@/shared/types'

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
const { confirm } = useConfirm()

const visible    = ref(false)
const wikiId     = ref('')
const wikiConfig = ref<Partial<WikiConfig>>({})
const readOnly   = ref(false)
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

const wikiColumns = computed<STableColumn[]>(() => [
  { key: 'title',     label: t('wikis.page_title'),   primary: true, ellipsis: true },
  { key: 'tags',      label: t('wikis.page_tags'),    width: '160px' },
  { key: 'updatedAt', label: t('wikis.page_updated'), width: '150px', ellipsis: true },
  { key: 'ops',       label: t('common.ops'),         ops: true,     width: '130px', align: 'center' },
])

const expandedKeys = computed<string[]>(() => expandedPage.value ? [expandedPage.value] : [])

function onExpand(row: WikiPageItem) {
  togglePage(row.id)
}

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
  if (!await confirm(t('wikis.confirm_delete_page', { name: title }), { danger: true })) return
  try {
    await apiFetch(wikiUrl(`/pages/${encodeURIComponent(id)}`), 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearAll() {
  if (!await confirm(t('wikis.confirm_clear', { name: wikiConfig.value.name || wikiId.value }), { danger: true })) return
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

function open(id: string, config: Partial<WikiConfig>, ro = false) {
  wikiId.value     = id
  wikiConfig.value = config
  readOnly.value   = ro
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
      <SButton v-if="!readOnly" type="primary" size="sm" @click="openAdd">{{ t('wikis.add_page') }}</SButton>
      <SButton v-if="!readOnly" type="danger" size="sm" style="margin-left:auto" :disabled="pages.length === 0" @click="clearAll">
        {{ t('wikis.clear_all') }}
      </SButton>
      <SBadge v-if="readOnly" variant="neutral" size="sm" style="margin-left:auto">{{ t('wikis.readonly_source') }}</SBadge>
    </template>

    <STable
      :columns="wikiColumns"
      :rows="pages"
      row-key="id"
      :loading="loading"
      :loading-text="t('common.loading')"
      :empty-text="t('wikis.no_pages')"
      expandable
      :expanded-keys="expandedKeys"
      @expand="onExpand"
    >
      <template #title="{ row }">
        <span style="font-weight:500">{{ row.title }}</span>
      </template>
      <template #tags="{ row }">
        <span v-for="tag in row.tags" :key="tag" class="wiki-tag">{{ tag }}</span>
        <span v-if="row.tags.length === 0" class="cell-secondary">-</span>
      </template>
      <template #updatedAt="{ row }">
        <span class="cell-secondary">{{ new Date(row.updatedAt).toLocaleString() }}</span>
      </template>
      <template #ops="{ row }">
        <div class="ops-row" v-if="!readOnly">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="removePage(row.id, row.title)">{{ t('common.delete') }}</SButton>
        </div>
        <span v-else class="cell-secondary">-</span>
      </template>
      <template #_expanded="{ row }">
        <div v-if="pageLoading[row.id]" class="cell-secondary" style="font-style:italic">{{ t('common.loading') }}</div>
        <pre v-else class="page-content-pre">{{ pageContents[row.id] || '' }}</pre>
      </template>
    </STable>
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
.cell-secondary {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}
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
