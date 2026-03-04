<script setup lang="ts">
import { ref } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import MessageHistory from '@/components/MessageHistory.vue'
import type { ChatMessage } from '@/types'

const { show } = useToast()

const visible    = ref(false)
const saverName  = ref('')
const messages   = ref<ChatMessage[]>([])
const loading    = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(`/api/savers/${encodeURIComponent(saverName.value)}/history`)
    messages.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function clear() {
  if (!confirm(`确定要清除 ${saverName.value} 的所有历史记录吗？`)) return
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saverName.value)}/history`, 'DELETE')
    show('历史已清除')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function open(name: string) {
  saverName.value = name
  messages.value  = []
  visible.value   = true
  load()
}

defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box xl" style="height:86vh">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3>会话历史</h3>
          <span class="saver-name-badge">{{ saverName }}</span>
          <span v-if="!loading" class="saver-count-badge">{{ messages.length }} 条</span>
        </div>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <div class="modal-header-toolbar">
        <button class="btn-outline btn-sm" :disabled="loading" @click="load">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
        <button class="btn-danger btn-sm" style="margin-left:auto" :disabled="messages.length === 0" @click="clear">清除历史</button>
      </div>
      <div style="flex:1;overflow-y:auto">
        <div v-if="loading" class="modal-loading">加载中...</div>
        <div v-else-if="messages.length === 0" class="modal-empty">暂无历史记录</div>
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
