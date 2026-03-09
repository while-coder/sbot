<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SaverConfig } from '@/types'
import SaverViewModal from './SaverViewModal.vue'

const { show } = useToast()

const savers = computed(() => store.settings.savers || {})

const showModal  = ref(false)
const editingName = ref<string | null>(null)
const form = ref<{ name: string } & SaverConfig>({ name: '', type: 'sqlite' })

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

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
          <tr v-for="(s, id) in savers" :key="id">
            <td>{{ (s as any).name || id }}</td>
            <td>{{ s.type || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="saverViewModal?.open(id as string)">查看</button>
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
              </div>
            </td>
          </tr>
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
