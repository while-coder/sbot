<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm } from '@sbot/ui'
import { SModal, SButton, SBadge } from '@sbot/ui'
import MessageList from '@/components/MessageList.vue'
import { MessageKind } from '@sbot/chat-ui'
import type { StoredMessage } from '@sbot/chat-ui'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const visible       = ref(false)
const saverId       = ref('')
const saverName     = ref('')
const threadId      = ref('')
const messages      = ref<StoredMessage[]>([])
const loading       = ref(false)
const showArchived = ref(false)

/** 后端解析出的定位信息（saverId/threadId/存储文件路径），用于查找原始文件 */
const saverInfo = ref<{ saverId: string; saverType?: string; threadId: string; storagePath?: string } | null>(null)

const archivedCount = computed(() => messages.value.filter(m => m.kind === MessageKind.Archive).length)
const displayedMessages = computed(() =>
  showArchived.value ? messages.value : messages.value.filter(m => m.kind !== MessageKind.Archive)
)

function threadUrlBase() {
  return `/api/savers/${encodeURIComponent(saverId.value)}/threads/${encodeURIComponent(threadId.value)}`
}

function historyUrl() {
  return `${threadUrlBase()}/history`
}

function thinksUrl() {
  return `${threadUrlBase()}/thinks`
}

function tasksUrl() {
  return `${threadUrlBase()}/tasks`
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(historyUrl())
    messages.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function clear() {
  if (!await confirm(t('savers.clear_confirm'), { danger: true })) return
  try {
    await apiFetch(historyUrl(), 'DELETE')
    show(t('savers.history_cleared'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadSaverInfo() {
  try {
    const res = await apiFetch(`${threadUrlBase()}/info`)
    saverInfo.value = res.data || null
  } catch {
    saverInfo.value = null
  }
}

function open(id: string, name: string, thread: string) {
  saverId.value   = id
  saverName.value = name
  threadId.value  = thread
  messages.value  = []
  saverInfo.value = null
  visible.value   = true
  load()
  loadSaverInfo()
}

/** 通过 channel_session 数据库 id 打开：先解析出 saverId/threadId，再走统一的 saver 线程接口 */
async function openByDbId(id: number, name: string) {
  saverId.value   = ''
  saverName.value = name
  threadId.value  = ''
  messages.value  = []
  saverInfo.value = null
  visible.value   = true
  loading.value   = true
  try {
    const res = await apiFetch(`/api/channel-sessions/${id}/saver-info`)
    const info = res.data
    if (!info?.saverId || !info?.threadId) throw new Error(`Session id=${id} has no saver info`)
    saverId.value  = info.saverId
    threadId.value = info.threadId
    saverInfo.value = info
  } catch (e: any) {
    show(e.message, 'error')
    loading.value = false
    return
  }
  await load()
}

defineExpose({ open, openByDbId })
</script>

<template>
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div class="saver-view-header">
        <div class="saver-view-header-row">
          <h3 class="s-modal-title">{{ t('savers.history_title') }}</h3>
          <SBadge variant="neutral" size="sm">{{ saverName }}</SBadge>
          <span v-if="!loading" class="saver-count-badge">
            {{ archivedCount > 0
              ? t('savers.count_with_archived', { count: messages.length, archived: archivedCount })
              : t('savers.count', { count: messages.length }) }}
          </span>
        </div>
        <div v-if="saverInfo?.storagePath" class="saver-view-header-row saver-view-meta">
          <span class="saver-meta-path" :title="t('savers.storage_path')">{{ saverInfo.storagePath }}</span>
        </div>
      </div>
    </template>

    <template #toolbar>
      <SButton type="outline" size="sm" :disabled="loading" @click="load">
        {{ loading ? t('common.loading') : t('common.refresh') }}
      </SButton>
      <label v-if="archivedCount > 0" class="show-archived-toggle">
        <input type="checkbox" v-model="showArchived" />
        <span>{{ t('savers.show_archived') }}</span>
        <span class="show-archived-count">({{ archivedCount }})</span>
      </label>
      <SButton type="danger" size="sm" style="margin-left:auto" :disabled="messages.length === 0" @click="clear">
        {{ t('savers.clear_history') }}
      </SButton>
    </template>

    <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
    <div v-else-if="displayedMessages.length === 0" class="modal-empty">{{ t('savers.no_history') }}</div>
    <MessageList v-else :messages="displayedMessages" :thinks-url-prefix="thinksUrl()" :tasks-url-prefix="tasksUrl()" show-date-separators />
  </SModal>
</template>

<style scoped>
.saver-view-header {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-1);
  min-width: 0;
}
.saver-view-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.saver-view-meta { gap: var(--sui-sp-2); }
.saver-meta-path {
  font-size: var(--sui-fs-xs);
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}
.saver-count-badge {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}
.show-archived-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-1);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
  cursor: pointer;
  user-select: none;
  padding: 2px var(--sui-sp-3);
  border-radius: var(--sui-radius-sm);
}
.show-archived-toggle:hover { background: var(--sui-bg-soft); }
.show-archived-toggle input[type="checkbox"] { margin: 0; cursor: pointer; }
.show-archived-count { color: var(--sui-fg-disabled); }
.modal-loading,
.modal-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 60px 0;
  font-size: var(--sui-fs-lg);
}
</style>
