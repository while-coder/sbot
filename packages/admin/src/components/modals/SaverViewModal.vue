<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm } from 'sbot-ui'
import { SModal, SButton, SBadge } from 'sbot-ui'
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
const sessionId     = ref('')
const dbId          = ref<number | null>(null)
const messages      = ref<StoredMessage[]>([])
const loading       = ref(false)
const showArchived = ref(false)

const archivedCount = computed(() => messages.value.filter(m => m.kind === MessageKind.Archive).length)
const displayedMessages = computed(() =>
  showArchived.value ? messages.value : messages.value.filter(m => m.kind !== MessageKind.Archive)
)

function historyUrl() {
  if (dbId.value) return `/api/channel-sessions/${dbId.value}/history`
  if (sessionId.value) return `/api/sessions/${encodeURIComponent(sessionId.value)}/history`
  return `/api/savers/${encodeURIComponent(saverId.value)}/threads/${encodeURIComponent(threadId.value)}/history`
}

function thinksUrl() {
  if (dbId.value) return `/api/channel-sessions/${dbId.value}/thinks`
  if (sessionId.value) return `/api/sessions/${encodeURIComponent(sessionId.value)}/thinks`
  return `/api/savers/${encodeURIComponent(saverId.value)}/threads/${encodeURIComponent(threadId.value)}/thinks`
}

function tasksUrl() {
  if (dbId.value) return `/api/channel-sessions/${dbId.value}/tasks`
  if (sessionId.value) return `/api/sessions/${encodeURIComponent(sessionId.value)}/tasks`
  return `/api/savers/${encodeURIComponent(saverId.value)}/threads/${encodeURIComponent(threadId.value)}/tasks`
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

function open(id: string, name: string, thread: string) {
  saverId.value   = id
  saverName.value = name
  threadId.value  = thread
  sessionId.value = ''
  dbId.value      = null
  messages.value  = []
  visible.value   = true
  load()
}

function openSession(sid: string, name: string) {
  saverId.value   = ''
  saverName.value = name
  threadId.value  = ''
  sessionId.value = sid
  dbId.value      = null
  messages.value  = []
  visible.value   = true
  load()
}

function openByDbId(id: number, name: string) {
  saverId.value   = ''
  saverName.value = name
  threadId.value  = ''
  sessionId.value = ''
  dbId.value      = id
  messages.value  = []
  visible.value   = true
  load()
}

defineExpose({ open, openSession, openByDbId })
</script>

<template>
  <SModal v-model:visible="visible" width="xl">
    <template #header>
      <div style="display:flex;align-items:center;gap:10px">
        <h3 class="s-modal-title">{{ t('savers.history_title') }}</h3>
        <SBadge variant="neutral" size="sm">{{ saverName }}</SBadge>
        <span class="saver-thread-badge">{{ dbId ? `#${dbId}` : sessionId || threadId }}</span>
        <span v-if="!loading" class="saver-count-badge">
          {{ archivedCount > 0
            ? t('savers.count_with_archived', { count: messages.length, archived: archivedCount })
            : t('savers.count', { count: messages.length }) }}
        </span>
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
.saver-thread-badge {
  font-size: var(--sui-fs-xs);
  font-family: var(--sui-font-mono);
  background: var(--sui-info-soft);
  color: var(--sui-info-link);
  padding: 2px var(--sui-sp-3);
  border-radius: var(--sui-radius-sm);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
