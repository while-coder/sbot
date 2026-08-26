<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { channelManager } from '@/managers/channelManager'
import { saverManager } from '@/managers/saverManager'
import { settingsManager } from '@/managers/settingsManager'
import { useToast, useConfirm, SButton, SInput, SSelect, SModal, SFormItem, SPageToolbar, SPageContent, STable } from '@sbot/ui'
import type { STableColumn } from '@sbot/ui'
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

// ── 被引用情况（频道 / 会话档案 / 会话 / 智能体） ──
const { loadProfiles, makeResourceRefs } = useResourceRefs()
const refs = makeResourceRefs({
  channel: (c, id) => c.saver === id,
  profile: (p, id) => p.saver === id,
  session: (s, id) => s.saver === id,   // 会话私有覆盖（存在各自 auto profile 上，否则被漏扫）
  agent: (a, id) => a.saver === id,
})
onMounted(() => {
  loadProfiles()
  channelManager.ensure().catch(() => { /* 加载失败时 thread 列表回退为只显示裸 id */ })
})

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: SaverType.File })

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

const expandedKeys   = ref<(string | number)[]>([])
const threadClearing = ref<Record<string, boolean>>({})

// ── thread ↔ 会话关联：threadId 即 profileId，用 channelManager 的会话映射 ──
const profileSessions = channelManager.sessionByProfileId

/** thread 对应的会话（可见 profile 可能被多个会话共享，取第一个） */
function sessionOf(thread: string) {
  return profileSessions.value.get(thread)
}

function sessionLabelOf(thread: string): string {
  const s = sessionOf(thread)
  return s ? (s.sessionName || s.autoSessionName || s.sessionId) : thread
}

function channelLabelOf(thread: string): string {
  const s = sessionOf(thread)
  return s ? channelManager.channelName(s.channelId) : ''
}

/** thread 列表排序：按频道分组，同频道内按会话名称；未绑定会话的排在最后 */
function sortedThreads(saverId: string): string[] {
  const threads = saverManager.threadsMap[saverId] || []
  return [...threads].sort((a, b) => {
    const sa = sessionOf(a)
    const sb = sessionOf(b)
    if (!sa && !sb) return a.localeCompare(b)
    if (!sa) return 1
    if (!sb) return -1
    const ca = channelLabelOf(a)
    const cb = channelLabelOf(b)
    if (ca !== cb) return ca.localeCompare(cb)
    const na = sessionLabelOf(a)
    const nb = sessionLabelOf(b)
    return na !== nb ? na.localeCompare(nb) : a.localeCompare(b)
  })
}

async function loadThreads(id: string) {
  try {
    await saverManager.loadThreads(id)
  } catch (e: any) {
    show(e.message, 'error')
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
    settingsManager.apply(res.data)
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
    settingsManager.apply(res.data)
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
    await saverManager.clearHistory(saverId, thread)
    show(t('savers.cleanup_success'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    threadClearing.value[key] = false
  }
}

async function refresh() {
  try {
    await settingsManager.refresh()
    await loadProfiles()
    await channelManager.ensure(true).catch(() => {})
    const expandedIds = expandedKeys.value.map(String)
    if (expandedIds.length > 0) {
      for (const id of expandedIds) saverManager.reset(id)
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
          <div v-if="saverManager.loadingMap[row.id]" class="thread-status">{{ t('common.loading') }}</div>
          <div v-else-if="(saverManager.threadsMap[row.id] || []).length === 0" class="thread-status thread-status--empty">
            {{ t('savers.no_sessions') }}
          </div>
          <div v-else class="thread-list">
            <div v-for="thread in sortedThreads(row.id)" :key="thread" class="thread-row">
              <div class="thread-info">
                <template v-if="sessionOf(thread)">
                  <span class="thread-name">{{ sessionLabelOf(thread) }}</span>
                  <span class="thread-meta">
                    <span v-if="channelLabelOf(thread)" class="thread-channel">{{ channelLabelOf(thread) }}</span>
                    <span class="thread-id">{{ thread }}</span>
                  </span>
                </template>
                <span v-else class="thread-id" :title="t('savers.no_session_bound')">{{ thread }}</span>
              </div>
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
}
.thread-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-2) 0;
  border-bottom: 1px solid var(--sui-border);
}
.thread-row:last-child {
  border-bottom: none;
}
.thread-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.thread-name {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread-meta {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  min-width: 0;
}
.thread-channel {
  font-size: var(--sui-fs-xs);
  color: var(--sui-info-link);
  background: var(--sui-info-soft);
  padding: 0 var(--sui-sp-2);
  border-radius: var(--sui-radius-sm);
  flex-shrink: 0;
}
.thread-id {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread-ops {
  display: flex;
  gap: var(--sui-sp-2);
  flex-shrink: 0;
}
</style>
