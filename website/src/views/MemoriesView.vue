<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { MemoryConfig } from '@/types'

const { show } = useToast()
const router = useRouter()

const memories = computed(() => store.settings.memories || {})
const embeddingOptions = computed(() => Object.keys(store.settings.embeddings || {}))
const modelOptions = computed(() => Object.keys(store.settings.models || {}))

const showModal = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & MemoryConfig>({
  name: '', mode: 'human_and_ai', maxAgeDays: undefined,
  embedding: '', evaluator: '', extractor: '', compressor: '',
})

function openAdd() {
  editingName.value = null
  form.value = { name: '', mode: 'human_and_ai', maxAgeDays: undefined, embedding: '', evaluator: '', extractor: '', compressor: '' }
  showModal.value = true
}

function openEdit(name: string) {
  const m = memories.value[name]
  editingName.value = name
  form.value = {
    name,
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
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  if (!form.value.embedding) { show('请选择 Embedding 模型', 'error'); return }
  if (!form.value.evaluator) { show('请选择评估器模型', 'error'); return }
  if (!form.value.extractor) { show('请选择提取器模型', 'error'); return }
  try {
    const { name, ...config } = form.value
    const clean: MemoryConfig = { mode: config.mode, embedding: config.embedding, evaluator: config.evaluator, extractor: config.extractor }
    if (config.maxAgeDays) clean.maxAgeDays = config.maxAgeDays
    if (config.compressor) clean.compressor = config.compressor
    if (!store.settings.memories) store.settings.memories = {}
    if (editingName.value && editingName.value !== name) {
      delete store.settings.memories[editingName.value]
    }
    store.settings.memories[name] = clean
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(name: string) {
  if (!confirm(`确定要删除记忆配置 "${name}" 吗？`)) return
  try {
    delete store.settings.memories![name]
    await apiFetch('/api/settings', 'PUT', store.settings)
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
          <tr><th>名称</th><th>模式</th><th>Embedding</th><th>最大天数</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(memories).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无记忆配置</td>
          </tr>
          <tr v-for="(m, name) in memories" :key="name">
            <td style="font-family:monospace">{{ name }}</td>
            <td>{{ m.mode || '-' }}</td>
            <td>{{ m.embedding || '-' }}</td>
            <td>{{ m.maxAgeDays ?? '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="router.push(`/memories/${name}/view`)">查看</button>
                <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(name as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName ? '编辑记忆配置' : '添加记忆配置' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 (唯一标识) *</label>
            <input v-model="form.name" :disabled="!!editingName" placeholder="如 default" />
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
              <option v-for="e in embeddingOptions" :key="e" :value="e">{{ e }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>评估器模型 *</label>
            <select v-model="form.evaluator">
              <option value="" disabled>请选择</option>
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>提取器模型 *</label>
            <select v-model="form.extractor">
              <option value="" disabled>请选择</option>
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>压缩器模型</label>
            <select v-model="form.compressor">
              <option value="">不使用</option>
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
