<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SBadge, SPageToolbar, SPageContent } from 'sbot-ui'
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
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('wikis.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
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
            <td colspan="4" class="wiki-empty">{{ t('wikis.empty') }}</td>
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
              <span v-if="wikiCounts[id as string] === undefined" class="count-muted">...</span>
              <span v-else-if="wikiCounts[id as string] === null" class="count-muted">-</span>
              <SBadge v-else variant="info" pill>{{ wikiCounts[id as string] }}</SBadge>
            </td>
            <td class="col-center">
              <div class="ops-row">
                <SButton type="outline" size="sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</SButton>
                <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
                <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
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
            <SBadge v-if="wikiCounts[id as string] != null" variant="info" pill>{{ wikiCounts[id as string] }} {{ t('wikis.pages_unit') }}</SBadge>
          </div>
          <div v-if="w.embedding" class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('wikis.embedding_col') }}</span>
            <span class="mobile-card-value">
              {{ embeddingOptions.find(e => e.id === w.embedding)?.label || w.embedding }}
              <span v-if="embeddingOptions.find(e => e.id === w.embedding)" class="embed-detail">{{ embeddingOptions.find(e => e.id === w.embedding)!.detail }}</span>
            </span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="outline" size="sm" @click="wikiViewModal?.open(id as string, w)">{{ t('common.view') }}</SButton>
            <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
          </div>
        </div>
      </template>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingName !== null ? t('wikis.edit_title') : t('wikis.add_title')" width="md">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('wikis.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('wikis.embedding_model')">
        <SSelect v-model="form.embedding">
          <option value="">{{ t('wikis.embedding_none') }}</option>
          <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }} ({{ e.detail }})</option>
        </SSelect>
      </SFormItem>

      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <WikiViewModal ref="wikiViewModal" />
  </div>
</template>

<style scoped>
.wiki-list-table {
  table-layout: fixed;
}
.wiki-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
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
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-xs);
}
.ops-row {
  display: inline-flex;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}
.count-muted {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
</style>
