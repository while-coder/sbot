<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SaverConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'

const { show } = useToast()

const savers = computed(() => store.settings.savers || {})

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: 'sqlite' })

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

// Expand state
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
  form.value = { name: '', type: 'sqlite' }
  showModal.value = true
}

function openEdit(id: string) {
  const s = savers.value[id]
  editingName.value = id
  form.value = { name: (s as any).name || '', type: s.type || 'sqlite' }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  try {
    const body = { ...form.value }
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/savers/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/savers', 'POST', body)
    Object.assign(store.settings, res.data)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const s = savers.value[id]
  const label = (s as any).name || id
  if (!confirm(`确定要删除存储配置 "${label}" 吗？`)) return
  try {
    const res = await apiFetch(`/api/settings/savers/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearThread(saverId: string, thread: string) {
  if (!confirm(`确定要清理 "${thread}" 的历史记录吗？`)) return
  const key = `${saverId}::${thread}`
  threadClearing.value[key] = true
  try {
    await apiFetch(`/api/savers/${encodeURIComponent(saverId)}/threads/${encodeURIComponent(thread)}/history`, 'DELETE')
    show('清理成功')
    // 从列表中移除该 thread
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
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加存储配置</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th style="width:32px"></th><th>名称</th><th>类型</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(savers).length === 0">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">暂无存储配置</td>
          </tr>
          <template v-for="(s, id) in savers" :key="id">
            <tr>
              <td>
                <button class="expand-btn" @click="toggleExpand(id as string)">
                  {{ expandedSavers[id as string] ? '▼' : '▶' }}
                </button>
              </td>
              <td>{{ (s as any).name || id }}</td>
              <td>{{ s.type || '-' }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
                </div>
              </td>
            </tr>
            <template v-if="expandedSavers[id as string]">
              <tr v-if="saverLoading[id as string]" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-sub-cell">加载中...</td>
              </tr>
              <tr v-else-if="(saverThreadsMap[id as string] || []).length === 0" class="thread-sub-row">
                <td></td>
                <td colspan="3" class="thread-sub-cell empty">暂无会话记录</td>
              </tr>
              <tr v-for="thread in saverThreadsMap[id as string] || []" :key="thread" class="thread-sub-row">
                <td></td>
                <td colspan="2" class="thread-id-cell">{{ thread }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="saverViewModal?.open(id as string, thread)">查看</button>
                  <button class="btn-danger btn-sm" :disabled="threadClearing[`${id}::${thread}`]" @click="clearThread(id as string, thread)">清理</button>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Edit/Add modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box" style="width:400px">
        <div class="modal-header">
          <h3>{{ editingName !== null ? '编辑存储配置' : '添加存储配置' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 *</label>
            <input v-model="form.name" placeholder="如 default" />
          </div>
          <div class="form-group">
            <label>存储类型</label>
            <select v-model="form.type">
              <option value="sqlite">SQLite</option>
              <option value="file">File</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <SaverViewModal ref="saverViewModal" />
  </div>
</template>

<style scoped>
.expand-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: #9b9b9b;
  padding: 2px 6px;
  width: 28px;
  text-align: center;
  line-height: 1;
}
.expand-btn:hover { color: #1c1c1c; }
.thread-sub-row td {
  background: #fafaf9;
  border-bottom: 1px solid #f0efed;
  padding-top: 5px;
  padding-bottom: 5px;
}
.thread-sub-cell {
  padding: 5px 12px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
}
.thread-id-cell {
  font-family: monospace;
  font-size: 12px;
  color: #3d3d3d;
  padding: 5px 12px;
}
</style>
