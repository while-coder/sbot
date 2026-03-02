<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SaverConfig } from '@/types'

const { show } = useToast()
const router = useRouter()

const savers = computed(() => store.settings.savers || {})

const showModal = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: 'sqlite' })

function openAdd() {
  editingName.value = null
  form.value = { name: '', type: 'sqlite' }
  showModal.value = true
}

function openEdit(name: string) {
  const s = savers.value[name]
  editingName.value = name
  form.value = { name, type: s.type || 'sqlite' }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  try {
    const { name, ...config } = form.value
    if (!store.settings.savers) store.settings.savers = {}
    if (editingName.value && editingName.value !== name) {
      delete store.settings.savers[editingName.value]
    }
    store.settings.savers[name] = config
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(name: string) {
  if (!confirm(`确定要删除存储配置 "${name}" 吗？`)) return
  try {
    delete store.settings.savers![name]
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
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加存储配置</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>名称</th><th>类型</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(savers).length === 0">
            <td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">暂无存储配置</td>
          </tr>
          <tr v-for="(s, name) in savers" :key="name">
            <td style="font-family:monospace">{{ name }}</td>
            <td>{{ s.type || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="router.push(`/savers/${name}/view`)">查看</button>
                <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(name as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box" style="width:400px">
        <div class="modal-header">
          <h3>{{ editingName ? '编辑存储配置' : '添加存储配置' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 (唯一标识) *</label>
            <input v-model="form.name" :disabled="!!editingName" placeholder="如 default" />
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
  </div>
</template>
