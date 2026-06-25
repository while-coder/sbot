<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { SaverType } from '@/shared/types'
import type { SaverConfig } from '@/shared/types'
import SaverViewModal from '@/components/modals/SaverViewModal.vue'
import ResourceRefs from '@/components/ResourceRefs.vue'
import { useResourceRefs } from '@/composables/useResourceRefs'

type SaverRow = { id: string; name: string; type: string; raw: SaverConfig }

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const savers = computed(() => store.settings.savers || {})

const saverRows = computed<SaverRow[]>(() =>
  Object.entries(savers.value).map(([id, s]) => ({
    id,
    name: (s as any).name || id,
    type: s.type || '-',
    raw: s,
  })),
)

const saverColumns = computed<STableColumn[]>(() => [
  { key: 'name', label: t('common.name'), primary: true },
  { key: 'type', label: t('common.type') },
  { key: 'ops',  label: t('common.ops'), ops: true },
])

// ── 被引用情况（频道 / 会话档案 / 智能体） ──
const { loadProfiles, makeResourceRefs } = useResourceRefs()
const refs = makeResourceRefs({
  channel: (c, id) => c.saver === id,
  profile: (p, id) => p.saver === id,
  agent: (a, id) => a.saver === id,
})
onMounted(loadProfiles)

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: SaverType.File })

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

const expandedKeys    = ref<(string | number)[]>([])
const saverThreadsMap = ref<Record<string, string[]>>({})
const saverLoading    = ref<Record<string, boolean>>({})
const threadClearing  = ref<Record<string, boolean>>({})

async function loadThreads(id: string) {
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

function onExpand(row: SaverRow, expanded: boolean) {
  if (expanded) loadThreads(row.id)
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', type: SaverType.File }
  showModal.value = true
}

function openEdit(id: string) {
  const s = savers.value[id]
  editingName.value = id
  form.value = { name: (s as any).name || '', type: s.type || SaverType.File }
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
  if (!await confirm(t('savers.confirm_delete', { name: label }), { danger: true })) return
  try {
    const res = await apiFetch(`/api/settings/savers/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearThread(saverId: string, thread: string) {
  if (!await confirm(t('savers.cleanup_confirm', { name: thread }), { danger: true })) return
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

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    await loadProfiles()
    const expandedIds = expandedKeys.value.map(String)
    if (expandedIds.length > 0) {
      for (const id of expandedIds) delete saverThreadsMap.value[id]
      await Promise.all(expandedIds.map(loadThreads))
    }
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('savers.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="saverColumns"
        :rows="saverRows"
        row-key="id"
        expandable
        v-model:expanded-keys="expandedKeys"
        :empty-text="t('savers.empty')"
        @expand="onExpand"
      >
        <template #name="{ row }">
          {{ row.name || row.id }}
          <ResourceRefs mode="badge" :refs="refs(row.id)" />
        </template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row.id)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" @click="remove(row.id)">{{ t('common.delete') }}</SButton>
        </template>
        <template #_expanded="{ row }">
          <ResourceRefs mode="card" :refs="refs(row.id)" class="saver-refs" />
          <div v-if="saverLoading[row.id]" class="thread-status">{{ t('common.loading') }}</div>
          <div v-else-if="(saverThreadsMap[row.id] || []).length === 0" class="thread-status thread-status--empty">
            {{ t('savers.no_sessions') }}
          </div>
          <div v-else class="thread-list">
            <div v-for="thread in saverThreadsMap[row.id]" :key="thread" class="thread-row">
              <span class="thread-id">{{ thread }}</span>
              <div class="thread-ops">
                <SButton type="outline" size="sm" @click="saverViewModal?.open(row.id, row.name, thread)">{{ t('common.view') }}</SButton>
                <SButton type="danger" size="sm" :disabled="threadClearing[`${row.id}::${thread}`]" @click="clearThread(row.id, thread)">{{ t('savers.cleanup') }}</SButton>
              </div>
            </div>
          </div>
        </template>
      </STable>
    </SPageContent>

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
      <template #footer>
        <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
      </template>
    </SModal>

    <SaverViewModal ref="saverViewModal" />
  </div>
</template>

<style scoped>
.saver-refs { margin-bottom: var(--sui-sp-3); }
.thread-status {
  padding: var(--sui-sp-2) 0;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}
.thread-status--empty { font-style: italic; }
.thread-list {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-2);
}
.thread-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-1) 0;
}
.thread-id {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  word-break: break-all;
}
.thread-ops {
  display: flex;
  gap: var(--sui-sp-2);
  flex-shrink: 0;
}
</style>
