<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent } from 'sbot-ui'
import { SaverType } from '@/types'
import type { SaverConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const savers = computed(() => store.settings.savers || {})

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: SaverType.File, share: false })

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

const expandedSavers  = ref<Record<string, boolean>>({})
const saverThreadsMap = ref<Record<string, string[]>>({})
const saverLoading    = ref<Record<string, boolean>>({})
const threadClearing  = ref<Record<string, boolean>>({})

async function toggleExpand(id: string) {
  expandedSavers.value[id] = !expandedSavers.value[id]
  if (!expandedSavers.value[id]) return
  if (id in saverThreadsMap.value || saverLoading.value[id]) return
  saverLoading.value[id] = true
  try {
    const res = await apiFetch(`/api/savers/${encodeURIComponent(id)}/threads`)
    saverThreadsMap.value[id] = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    saverThreadsMap.value[id] = []
  } finally {
    saverLoading.value[id] = false
  }
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', type: SaverType.File, share: false }
  showModal.value = true
}

function openEdit(id: string) {
  const s = savers.value[id]
  editingName.value = id
  form.value = { name: (s as any).name || '', type: s.type || SaverType.File, share: s.share ?? false }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  try {
    const body = { ...form.value }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/savers/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/savers', 'POST', body)
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const s = savers.value[id]
  const label = (s as any).name || id
  if (!window.confirm(t('savers.confirm_delete', { name: label }))) return
  try {
    const res = await apiFetch(`/api/settings/savers/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearThread(saverId: string, thread: string) {
  if (!window.confirm(t('savers.cleanup_confirm', { name: thread }))) return
  const key = `${saverId}::${thread}`
  threadClearing.value[key] = true
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saverId)}/threads/${encodeURIComponent(thread)}/history`, 'DELETE')
    show(t('savers.cleanup_success'))
    const list = saverThreadsMap.value[saverId]
    if (list) saverThreadsMap.value[saverId] = list.filter(t => t !== thread)
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    threadClearing.value[key] = false
  }
}

async function refreshThreads(ids: string[]) {
  await Promise.all(ids.map(async id => {
    saverLoading.value[id] = true
    try {
      const res = await apiFetch(`/api/savers/${encodeURIComponent(id)}/threads`)
      saverThreadsMap.value[id] = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
    } finally {
      saverLoading.value[id] = false
    }
  }))
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const expandedIds = Object.keys(expandedSavers.value).filter(id => expandedSavers.value[id])
    if (expandedIds.length > 0) await refreshThreads(expandedIds)
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('savers.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>{{ t('common.name') }}</th>
            <th>{{ t('common.type') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(savers).length === 0">
            <td colspan="4" class="savers-empty">{{ t('savers.empty') }}</td>
          </tr>
          <template v-for="(s, id) in savers" :key="id">
            <tr
              class="saver-row"
              :class="{ 'saver-row-expanded': expandedSavers[id as string] }"
              @click="toggleExpand(id as string)"
            >
              <td class="saver-expand-cell">
                <span class="saver-expand-icon">{{ expandedSavers[id as string] ? '▼' : '▶' }}</span>
              </td>
              <td>{{ (s as any).name || id }}</td>
              <td>{{ s.type || '-' }}</td>
              <td @click.stop>
                <div class="ops-cell">
                  <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
                  <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
                </div>
              </td>
            </tr>
            <template v-if="expandedSavers[id as string]">
              <tr v-if="saverLoading[id as string]" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-sub-cell">{{ t('common.loading') }}</td>
              </tr>
              <tr v-else-if="(saverThreadsMap[id as string] || []).length === 0" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-sub-cell empty">{{ t('savers.no_sessions') }}</td>
              </tr>
              <tr v-for="thread in saverThreadsMap[id as string] || []" :key="thread" class="thread-sub-row">
                <td></td>
                <td colspan="2" class="thread-id-cell">{{ thread }}</td>
                <td>
                  <div class="ops-cell">
                    <SButton type="outline" size="sm" @click="saverViewModal?.open(id as string, (s as any).name || id as string, thread)">{{ t('common.view') }}</SButton>
                    <SButton type="danger" size="sm" :disabled="threadClearing[`${id}::${thread}`]" @click="clearThread(id as string, thread)">{{ t('savers.cleanup') }}</SButton>
                  </div>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <template v-else>
        <div v-if="Object.keys(savers).length === 0" class="mobile-card-empty">{{ t('savers.empty') }}</div>
        <div v-for="(s, id) in savers" :key="id" class="mobile-card">
          <div class="mobile-card-header mobile-card-header-clickable" @click="toggleExpand(id as string)">
            <span class="saver-expand-icon">{{ expandedSavers[id as string] ? '▼' : '▶' }}</span>
            {{ (s as any).name || id }}
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.type') }}</span>
            <span class="mobile-card-value">{{ s.type || '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
            <SButton type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
          </div>
          <div v-if="expandedSavers[id as string]" class="mobile-card-threads">
            <div v-if="saverLoading[id as string]" class="thread-sub-cell">{{ t('common.loading') }}</div>
            <div v-else-if="(saverThreadsMap[id as string] || []).length === 0" class="thread-sub-cell empty">{{ t('savers.no_sessions') }}</div>
            <div v-for="thread in saverThreadsMap[id as string] || []" :key="thread" class="mobile-thread-row">
              <span class="thread-id-cell">{{ thread }}</span>
              <div class="mobile-card-ops">
                <SButton type="outline" size="sm" @click="saverViewModal?.open(id as string, (s as any).name || id as string, thread)">{{ t('common.view') }}</SButton>
                <SButton type="danger" size="sm" :disabled="threadClearing[`${id}::${thread}`]" @click="clearThread(id as string, thread)">{{ t('savers.cleanup') }}</SButton>
              </div>
            </div>
          </div>
        </div>
      </template>
    </SPageContent>

    <!-- Edit/Add modal -->
    <SModal v-model:visible="showModal" :title="editingName !== null ? t('savers.edit_title') : t('savers.add_title')" width="sm">
      <SFormItem :label="t('common.name') + ' *'">
        <SInput v-model="form.name" :placeholder="t('savers.name_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('savers.saver_type')">
        <SSelect v-model="form.type">
          <option value="file">File {{ t('common.recommended') }}</option>
          <option value="sqlite">SQLite</option>
          <option value="memory">Memory</option>
        </SSelect>
      </SFormItem>
      <SFormItem>
        <label class="checkbox-label">
          <input v-model="form.share" type="checkbox" />
          {{ t('savers.share') }}
        </label>
      </SFormItem>
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <SaverViewModal ref="saverViewModal" />
  </div>
</template>

<style scoped>
.savers-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.thread-sub-row td {
  background: var(--sui-bg-subtle);
  border-bottom: 1px solid var(--sui-border);
  padding-top: 5px;
  padding-bottom: 5px;
}
.thread-sub-cell {
  padding: 5px 12px;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  font-style: italic;
}
.thread-id-cell {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  padding: 5px 12px;
}
.mobile-card-threads {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--sui-border);
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.mobile-thread-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
}
.mobile-card-header-clickable {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
}
.saver-row { cursor: pointer; }
.saver-row-expanded > td { background: var(--sui-bg-subtle); }
.saver-expand-cell { padding: var(--sui-sp-2) var(--sui-sp-3); text-align: center; }
.saver-expand-icon {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
</style>
