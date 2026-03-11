<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { MemoryConfig } from '@/types'
import MemoryViewModal from './MemoryViewModal.vue'

const { show } = useToast()

const memories         = computed(() => store.settings.memories || {})
const embeddingOptions = computed(() =>
  Object.entries(store.settings.embeddings || {}).map(([id, e]) => ({ id, label: (e as any).name || id }))
)
const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)

const showModal   = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & MemoryConfig>({
  name: '', mode: 'human_and_ai', maxAgeDays: undefined,
  embedding: '', evaluator: '', extractor: '', compressor: '',
})

const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()

// Expand state
const expandedMemories  = ref<Record<string, boolean>>({})
const memoryThreadsMap  = ref<Record<string, string[]>>({})
const memoryLoading     = ref<Record<string, boolean>>({})

async function toggleExpand(id: string) {
  expandedMemories.value[id] = !expandedMemories.value[id]
  if (!expandedMemories.value[id]) return
  if (id in memoryThreadsMap.value || memoryLoading.value[id]) return
  memoryLoading.value[id] = true
  try {
    const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}/threads`)
    memoryThreadsMap.value[id] = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    memoryThreadsMap.value[id] = []
  } finally {
    memoryLoading.value[id] = false
  }
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', mode: 'human_and_ai', maxAgeDays: undefined, embedding: '', evaluator: '', extractor: '', compressor: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const m = memories.value[id]
  editingName.value = id
  form.value = {
    name: (m as any).name || '',
    mode: m.mode || 'human_and_ai',
    maxAgeDays: m.maxAgeDays,
    embedding: m.embedding || '',
    evaluator: m.evaluator || '',
    extractor: m.extractor || '',
    compressor: m.compressor || '',
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim())  { show('名称不能为空',        'error'); return }
  if (!form.value.embedding)    { show('请选择 Embedding 模型', 'error'); return }
  if (!form.value.evaluator)    { show('请选择评估器模型',      'error'); return }
  if (!form.value.extractor)    { show('请选择提取器模型',      'error'); return }
  try {
    const { name, ...config } = form.value
    const body: MemoryConfig & { name: string } = {
      name,
      mode: config.mode,
      embedding: config.embedding,
      evaluator: config.evaluator,
      extractor: config.extractor,
    }
    if (config.maxAgeDays) body.maxAgeDays = config.maxAgeDays
    if (config.compressor) body.compressor = config.compressor
    const id = editingName.value
    const res = id
      ? await apiFetch(`/api/settings/memories/${encodeURIComponent(id)}`, 'PUT', body)
      : await apiFetch('/api/settings/memories', 'POST', body)
    Object.assign(store.settings, res.data)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const m = memories.value[id]
  const label = (m as any).name || id
  if (!confirm(`确定要删除记忆配置 "${label}" 吗？`)) return
  try {
    const res = await apiFetch(`/api/settings/memories/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加记忆配置</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th style="width:32px"></th><th>名称</th><th>模式</th><th>Embedding</th><th>最大天数</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(memories).length === 0">
            <td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">暂无记忆配置</td>
          </tr>
          <template v-for="(m, id) in memories" :key="id">
            <tr>
              <td>
                <button class="expand-btn" @click="toggleExpand(id as string)">
                  {{ expandedMemories[id as string] ? '▼' : '▶' }}
                </button>
              </td>
              <td>{{ (m as any).name || id }}</td>
              <td>{{ m.mode || '-' }}</td>
              <td>{{ embeddingOptions.find(e => e.id === m.embedding)?.label || m.embedding || '-' }}</td>
              <td>{{ m.maxAgeDays ?? '-' }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
                </div>
              </td>
            </tr>
            <template v-if="expandedMemories[id as string]">
              <tr v-if="memoryLoading[id as string]" class="thread-sub-row">
                <td></td>
                <td colspan="5" class="thread-sub-cell">加载中...</td>
              </tr>
              <template v-if="(memoryThreadsMap[id as string] || []).length === 0">
                <tr class="thread-sub-row">
                  <td></td>
                  <td colspan="4" class="thread-id-cell">{{ id }}</td>
                  <td>
                    <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string)">查看</button>
                  </td>
                </tr>
              </template>
              <tr v-for="thread in memoryThreadsMap[id as string] || []" :key="thread" class="thread-sub-row">
                <td></td>
                <td colspan="4" class="thread-id-cell">{{ thread }}</td>
                <td>
                  <button class="btn-outline btn-sm" @click="memoryViewModal?.open(id as string)">查看</button>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Edit/Add modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName !== null ? '编辑记忆配置' : '添加记忆配置' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 *</label>
            <input v-model="form.name" placeholder="如 default" />
          </div>
          <div class="form-group">
            <label>记忆模式</label>
            <select v-model="form.mode">
              <option value="human_and_ai">human_and_ai（记忆用户与 AI 消息）</option>
              <option value="human_only">human_only（仅记忆用户消息）</option>
              <option value="read_only">read_only（只读，不写入新记忆）</option>
            </select>
          </div>
          <div class="form-group">
            <label>最大保留天数</label>
            <input v-model.number="form.maxAgeDays" type="number" placeholder="90" />
          </div>
          <div class="form-group">
            <label>Embedding 模型 *</label>
            <select v-model="form.embedding">
              <option v-for="e in embeddingOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>评估器模型 *</label>
            <select v-model="form.evaluator">
              <option value="" disabled>请选择</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>提取器模型 *</label>
            <select v-model="form.extractor">
              <option value="" disabled>请选择</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>压缩器模型</label>
            <select v-model="form.compressor">
              <option value="">不使用</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <MemoryViewModal ref="memoryViewModal" />
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
