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

const showAddModal = ref(false)
const addContent = ref('')
const compressing = ref(false)

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

function openAdd() {
  addContent.value = ''
  showAddModal.value = true
}

async function confirmAdd() {
  if (!addContent.value.trim()) { show('内容不能为空', 'error'); return }
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName)}/add`, 'POST', { content: addContent.value.trim() })
    show(`已添加 ${res.data?.ids?.length ?? 0} 条记忆`)
    showAddModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function compress() {
  if (!confirm(`确定要压缩 ${memName} 的记忆吗？`)) return
  compressing.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName)}/compress`, 'POST')
    show(`压缩完成，共压缩 ${res.data?.count ?? 0} 组记忆`)
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    compressing.value = false
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
      <button class="btn-primary btn-sm" style="margin-left:16px" @click="openAdd">+ 添加记忆</button>
      <button class="btn-outline btn-sm" style="margin-left:8px" :disabled="compressing" @click="compress">{{ compressing ? '压缩中...' : '压缩记忆' }}</button>
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

    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>添加记忆</h3>
          <button class="modal-close" @click="showAddModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>内容</label>
            <textarea v-model="addContent" rows="6" placeholder="输入要直接添加的记忆内容..." style="width:100%;resize:vertical" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showAddModal = false">取消</button>
          <button class="btn-primary" @click="confirmAdd">添加</button>
        </div>
      </div>
    </div>
  </div>
</template>
