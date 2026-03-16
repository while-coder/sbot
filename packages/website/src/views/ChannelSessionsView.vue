<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

interface ChannelSessionRow {
  id: number
  channel: string
  sessionId: string
  agentId: string
  saverId: string
  memoryId: string | null
}

const { show } = useToast()
const sessions = ref<ChannelSessionRow[]>([])
const loading = ref(false)
const viewSession = ref<ChannelSessionRow | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/channel-sessions')
    sessions.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function remove(s: ChannelSessionRow) {
  if (!confirm(`确定要删除会话 "${s.sessionId}" 吗？`)) return
  try {
    await apiFetch(`/api/channel-sessions/${s.id}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">频道会话管理</span>
      <button class="btn-outline btn-sm" @click="load">刷新</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>频道</th>
            <th>Session ID</th>
            <th>Agent ID</th>
            <th>Saver ID</th>
            <th>Memory ID</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" style="text-align:center;color:#9b9b9b;padding:40px">加载中...</td>
          </tr>
          <tr v-else-if="sessions.length === 0">
            <td colspan="7" style="text-align:center;color:#9b9b9b;padding:40px">暂无会话数据</td>
          </tr>
          <tr v-for="s in sessions" :key="s.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ s.id }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.channel || '-' }}</td>
            <td style="font-family:monospace">{{ s.sessionId || '-' }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.agentId || '-' }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.saverId || '-' }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.memoryId || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="viewSession = s">查看</button>
                <button class="btn-danger btn-sm" @click="remove(s)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="viewSession" class="modal-overlay" @click.self="viewSession = null">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>会话详情 — {{ viewSession.sessionId }}</h3>
          <button class="modal-close" @click="viewSession = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>ID</label>
            <input :value="viewSession.id" disabled />
          </div>
          <div class="form-group">
            <label>频道</label>
            <input :value="viewSession.channel" disabled />
          </div>
          <div class="form-group">
            <label>Session ID (chat_id)</label>
            <input :value="viewSession.sessionId" disabled />
          </div>
          <div class="form-group">
            <label>Agent ID</label>
            <input :value="viewSession.agentId" disabled />
          </div>
          <div class="form-group">
            <label>Saver ID</label>
            <input :value="viewSession.saverId" disabled />
          </div>
          <div class="form-group">
            <label>Memory ID</label>
            <input :value="viewSession.memoryId ?? ''" disabled />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewSession = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
