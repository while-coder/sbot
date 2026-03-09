<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

interface UserRow {
  id: number
  userid: string
  username: string
  userinfo: string
  channel: string
}

const { show } = useToast()
const users = ref<UserRow[]>([])
const loading = ref(false)
const viewUser = ref<UserRow | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/users')
    users.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function remove(user: UserRow) {
  if (!confirm(`确定要删除用户 "${user.username || user.userid}" 吗？`)) return
  try {
    await apiFetch(`/api/users/${user.id}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function formatUserInfo(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">用户管理</span>
      <button class="btn-outline btn-sm" @click="load">刷新</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>用户ID</th>
            <th>用户名</th>
            <th>频道</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" style="text-align:center;color:#9b9b9b;padding:40px">加载中...</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="5" style="text-align:center;color:#9b9b9b;padding:40px">暂无用户数据</td>
          </tr>
          <tr v-for="u in users" :key="u.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ u.id }}</td>
            <td style="font-family:monospace">{{ u.userid }}</td>
            <td>{{ u.username || '-' }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ u.channel || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="viewUser = u">查看</button>
                <button class="btn-danger btn-sm" @click="remove(u)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="viewUser" class="modal-overlay" @click.self="viewUser = null">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>用户详情 — {{ viewUser.username || viewUser.userid }}</h3>
          <button class="modal-close" @click="viewUser = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>ID</label>
            <input :value="viewUser.id" disabled />
          </div>
          <div class="form-group">
            <label>用户ID</label>
            <input :value="viewUser.userid" disabled />
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input :value="viewUser.username" disabled />
          </div>
          <div class="form-group">
            <label>频道</label>
            <input :value="viewUser.channel" disabled />
          </div>
          <div class="form-group">
            <label>用户信息</label>
            <textarea :value="formatUserInfo(viewUser.userinfo)" disabled rows="16" style="font-family:monospace;font-size:12px" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewUser = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
