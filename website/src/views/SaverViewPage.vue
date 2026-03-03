<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import MessageHistory from '@/components/MessageHistory.vue'
import type { ChatMessage } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const saverName = route.params.saverName as string
const messages = ref<ChatMessage[]>([])

async function load() {
  try {
    const res = await apiFetch(`/api/savers/${encodeURIComponent(saverName)}/history`)
    messages.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clear() {
  if (!confirm(`确定要清除 ${saverName} 的所有历史记录吗？`)) return
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saverName)}/history`, 'DELETE')
    show('历史已清除')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="router.push('/savers')">← 返回</button>
      <span class="page-toolbar-title" style="margin-left:12px">存储: {{ saverName }}</span>
      <button class="btn-outline btn-sm" style="margin-left:16px" @click="load">刷新</button>
      <button class="btn-danger btn-sm" style="margin-left:auto" @click="clear">清除历史</button>
    </div>
    <div style="flex:1;overflow-y:auto">
      <MessageHistory :messages="messages" />
    </div>
  </div>
</template>
