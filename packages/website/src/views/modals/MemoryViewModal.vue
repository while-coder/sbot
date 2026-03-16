<script setup lang="ts">
import { ref } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import type { MemoryItem } from '@/types'

const { show } = useToast()

const visible     = ref(false)
const memName     = ref('')
const memories    = ref<MemoryItem[]>([])
const loading     = ref(false)
const compressing = ref(false)

const showAddModal = ref(false)
const addContent   = ref('')
const adding       = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName.value)}`)
    memories.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memName.value)}/${encodeURIComponent(id)}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function clearAll() {
  if (!confirm(`确定要清除 ${memName.value} 的所有记忆吗？`)) return
  try {
    await apiFetch(`/api/memories/${encodeURIComponent(memName.value)}`, 'DELETE')
    show('已清除所有记忆')
    memories.value = []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function openAdd() {
  addContent.value   = ''
  showAddModal.value = true
}

async function confirmAdd() {
  if (!addContent.value.trim()) { show('内容不能为空', 'error'); return }
  adding.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName.value)}/add`, 'POST', { content: addContent.value.trim() })
    show(`已添加 ${res.data?.ids?.length ?? 0} 条记忆`)
    showAddModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    adding.value = false
  }
}

async function compress() {
  if (!confirm(`确定要压缩 ${memName.value} 的记忆吗？此操作会合并相似记忆。`)) return
  compressing.value = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(memName.value)}/compress`, 'POST')
    show(`压缩完成，共压缩 ${res.data?.count ?? 0} 组记忆`)
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    compressing.value = false
  }
}

function open(name: string) {
  memName.value  = name
  memories.value = []
  visible.value  = true
  load()
}

defineExpose({ open })
</script>

<template>
  <!-- Memory view modal -->
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box xl" style="height:86vh">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px">
          <h3>记忆内容</h3>
          <span class="mem-name-badge">{{ memName }}</span>
          <span v-if="!loading" class="mem-count-badge">{{ memories.length }} 条</span>
        </div>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <div class="modal-header-toolbar">
        <button class="btn-outline btn-sm" :disabled="loading" @click="load">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
        <button class="btn-primary btn-sm" @click="openAdd">+ 添加记忆</button>
        <button class="btn-outline btn-sm" :disabled="compressing || memories.length === 0" @click="compress">
          {{ compressing ? '压缩中...' : '压缩记忆' }}
        </button>
        <button class="btn-danger btn-sm" style="margin-left:auto" :disabled="memories.length === 0" @click="clearAll">清除全部</button>
      </div>
      <div style="flex:1;overflow-y:auto">
        <div v-if="loading" class="modal-loading">加载中...</div>
        <div v-else-if="memories.length === 0" class="modal-empty">暂无记忆数据</div>
        <table v-else class="mem-table">
          <thead>
            <tr>
              <th class="col-content">内容</th>
              <th class="col-score">重要性</th>
              <th class="col-time">创建时间</th>
              <th class="col-access">访问次数</th>
              <th class="col-time">最后访问</th>
              <th class="col-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in memories" :key="m.id">
              <td class="col-content">{{ m.content }}</td>
              <td class="col-score">
                <span v-if="m.importance != null" class="importance-bar">
                  <span class="importance-fill" :style="{ width: (m.importance * 100).toFixed(0) + '%' }"></span>
                </span>
                <span class="importance-val">{{ m.importance != null ? m.importance.toFixed(2) : '-' }}</span>
              </td>
              <td class="col-time">{{ m.timestamp ? new Date(m.timestamp).toLocaleString() : '-' }}</td>
              <td class="col-access">{{ m.accessCount ?? '-' }}</td>
              <td class="col-time">{{ m.lastAccessed ? new Date(m.lastAccessed).toLocaleString() : '-' }}</td>
              <td class="col-ops">
                <button class="btn-danger btn-sm" @click="remove(m.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Add memory modal (nested) -->
  <div v-if="showAddModal" class="modal-overlay" style="z-index:1100" @click.self="showAddModal = false">
    <div class="modal-box" style="width:480px">
      <div class="modal-header">
        <h3>添加记忆</h3>
        <button class="modal-close" @click="showAddModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>内容</label>
          <textarea v-model="addContent" rows="7" placeholder="输入要直接添加的记忆内容..." style="resize:vertical" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" :disabled="adding" @click="showAddModal = false">取消</button>
        <button class="btn-primary" :disabled="adding" @click="confirmAdd">
          <span v-if="adding" class="btn-spinner" />
          {{ adding ? '添加中…' : '添加' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mem-name-badge {
  font-size: 12px;
  font-family: monospace;
  background: #f0f0ee;
  color: #555;
  padding: 2px 8px;
  border-radius: 4px;
}
.mem-count-badge {
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
.mem-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mem-table th,
.mem-table td {
  padding: 10px 14px;
  border-bottom: 1px solid #f0efed;
  vertical-align: top;
}
.mem-table th {
  background: #faf9f7;
  font-weight: 600;
  color: #6b6b6b;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.mem-table tbody tr:hover { background: #faf9f7; }

.col-content { width: auto; white-space: normal; word-break: break-word; line-height: 1.5; }
.col-score   { width: 110px; white-space: nowrap; }
.col-time    { width: 148px; white-space: nowrap; color: #6b6b6b; font-size: 12px; }
.col-access  { width: 70px; text-align: center; color: #6b6b6b; font-size: 12px; white-space: nowrap; }
.col-ops     { width: 80px; text-align: center; white-space: nowrap; }

.importance-bar {
  display: inline-block;
  width: 44px;
  height: 6px;
  background: #edecea;
  border-radius: 3px;
  vertical-align: middle;
  margin-right: 6px;
  overflow: hidden;
}
.importance-fill {
  display: block;
  height: 100%;
  background: #6366f1;
  border-radius: 3px;
}
.importance-val {
  font-size: 12px;
  color: #555;
  vertical-align: middle;
}
.btn-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: btn-spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 4px;
}
@keyframes btn-spin {
  to { transform: rotate(360deg); }
}
</style>
