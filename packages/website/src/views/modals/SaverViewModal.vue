<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import MessageHistory from '@/components/MessageHistory.vue'
import type { ChatMessage } from '@/types'

const { t } = useI18n()
const { show } = useToast()

const visible    = ref(false)
const saverId    = ref('')
const saverName  = ref('')
const threadId   = ref('')
const messages   = ref<ChatMessage[]>([])
const loading    = ref(false)

function historyUrl() {
  return `/api/savers/${encodeURIComponent(saverId.value)}/threads/${encodeURIComponent(threadId.value)}/history`
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
  if (!window.confirm(t('savers.clear_confirm'))) return
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
  messages.value = []
  visible.value  = true
  load()
}

defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box xl" style="height:86vh">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3>{{ t('savers.history_title') }}</h3>
          <span class="saver-name-badge">{{ saverName }}</span>
          <span class="saver-thread-badge">{{ threadId }}</span>
          <span v-if="!loading" class="saver-count-badge">{{ t('savers.count', { count: messages.length }) }}</span>
        </div>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <div class="modal-header-toolbar">
        <button class="btn-outline btn-sm" :disabled="loading" @click="load">
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
        <button class="btn-danger btn-sm" style="margin-left:auto" :disabled="messages.length === 0" @click="clear">{{ t('savers.clear_history') }}</button>
      </div>
      <div style="flex:1;overflow-y:auto">
        <div v-if="loading" class="modal-loading">{{ t('common.loading') }}</div>
        <div v-else-if="messages.length === 0" class="modal-empty">{{ t('savers.no_history') }}</div>
        <MessageHistory v-else :messages="messages" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.saver-name-badge {
  font-size: 12px;
  font-family: monospace;
  background: #f0f0ee;
  color: #555;
  padding: 2px 8px;
  border-radius: 4px;
}
.saver-thread-badge {
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
.saver-count-badge {
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
</style>
