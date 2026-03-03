<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import type { MemoryItem } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const memName = route.params.memName as string
const memories = ref<MemoryItem[]>([])

async function load() {
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName)}`)
    memories.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memName)}/${encodeURIComponent(id)}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearAll() {
  if (!confirm(`确定要清除 ${memName} 的所有记忆吗？`)) return
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memName)}`, 'DELETE')
    show('已清除所有记忆')
    memories.value = []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="router.push('/memories')">← 返回</button>
      <span class="page-toolbar-title" style="margin-left:12px">记忆: {{ memName }}</span>
      <button class="btn-outline btn-sm" style="margin-left:16px" @click="load">刷新</button>
      <button class="btn-danger btn-sm" style="margin-left:auto" @click="clearAll">清除全部</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>内容</th><th>重要性</th><th>时间</th><th>类型</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="memories.length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无记忆</td>
          </tr>
          <tr v-for="m in memories" :key="m.id">
            <td style="max-width:420px;white-space:normal;word-break:break-word">{{ m.content }}</td>
            <td>{{ m.importance != null ? m.importance.toFixed(2) : '-' }}</td>
            <td style="white-space:nowrap">{{ m.timestamp ? new Date(m.timestamp).toLocaleString() : '-' }}</td>
            <td>{{ m.category || '-' }}</td>
            <td>
              <button class="btn-danger btn-sm" @click="remove(m.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
