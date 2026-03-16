<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChannelConfig } from '@/types'
import SaverViewModal from './SaverViewModal.vue'

interface ChannelSessionRow {
  id: number
  channel: string
  sessionId: string
  agentId: string
  saverId: string
  memoryId: string | null
}

const { show } = useToast()

const channels = computed(() => store.settings.channels || {})
const agentOptions  = computed(() => Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name  || id })))
const saverOptions  = computed(() => Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name  || id })))
const memoryOptions = computed(() => Object.entries(store.settings.memories  || {}).map(([id, m]) => ({ id, label: (m as any).name  || id })))

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

const expandedChannels = ref<Record<string, boolean>>({})
const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
const channelLoading   = ref<Record<string, boolean>>({})
const viewSession      = ref<ChannelSessionRow | null>(null)

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ name: string; type: string; appId: string; appSecret: string; agent: string; saver: string; memory: string }>({
  name: '', type: 'lark', appId: '', appSecret: '', agent: '', saver: '', memory: '',
})

async function toggleExpand(id: string) {
  expandedChannels.value[id] = !expandedChannels.value[id]
  if (!expandedChannels.value[id]) return
  if (id in sessionMap.value || channelLoading.value[id]) return
  channelLoading.value[id] = true
  try {
    const res = await apiFetch(`/api/channel-sessions?channel=${encodeURIComponent(id)}`)
    sessionMap.value[id] = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    sessionMap.value[id] = []
  } finally {
    channelLoading.value[id] = false
  }
}

async function refreshSessions(ids: string[]) {
  await Promise.all(ids.map(async id => {
    channelLoading.value[id] = true
    try {
      const res = await apiFetch(`/api/channel-sessions?channel=${encodeURIComponent(id)}`)
      sessionMap.value[id] = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
    } finally {
      channelLoading.value[id] = false
    }
  }))
}

async function removeSession(channelId: string, session: ChannelSessionRow) {
  if (!confirm(`确定要删除会话 "${session.sessionId}" 吗？`)) return
  try {
    await apiFetch(`/api/channel-sessions/${session.id}`, 'DELETE')
    const list = sessionMap.value[channelId]
    if (list) sessionMap.value[channelId] = list.filter(s => s.id !== session.id)
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function openAdd() {
  editingId.value = null
  form.value = { name: '', type: 'lark', appId: '', appSecret: '', agent: '', saver: '', memory: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const c = channels.value[id]
  editingId.value = id
  form.value = { name: c.name || '', type: c.type || 'lark', appId: c.appId || '', appSecret: c.appSecret || '', agent: c.agent, saver: c.saver, memory: c.memory || '' }
  showModal.value = true
}

async function save() {
  if (!form.value.agent) { show('请选择 Agent', 'error'); return }
  if (!form.value.saver) { show('请选择存储配置', 'error'); return }
  try {
    const config: ChannelConfig = {
      type: form.value.type,
      agent: form.value.agent,
      saver: form.value.saver,
    }
    if (form.value.name.trim()) config.name = form.value.name.trim()
    if (form.value.appId.trim()) config.appId = form.value.appId.trim()
    if (form.value.appSecret.trim()) config.appSecret = form.value.appSecret.trim()
    if (form.value.memory) config.memory = form.value.memory

    if (editingId.value) {
      await apiFetch(`/api/settings/channels/${editingId.value}`, 'PUT', config)
    } else {
      const res = await apiFetch('/api/settings/channels', 'POST', config)
      const id = res.data?.id
      if (id) {
        if (!store.settings.channels) store.settings.channels = {}
        store.settings.channels[id] = config
      }
    }
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const c = channels.value[id]
  const label = c?.name || id
  if (!confirm(`确定要删除频道 "${label}" 吗？`)) return
  try {
    await apiFetch(`/api/settings/channels/${id}`, 'DELETE')
    if (c?.saver) {
      await apiFetch(`/api/savers/${encodeURIComponent(c.saver)}/threads/lark_${encodeURIComponent(id)}/history`, 'DELETE').catch(() => {})
    }
    if (store.settings.channels) delete store.settings.channels[id]
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const expandedIds = Object.keys(expandedChannels.value).filter(id => expandedChannels.value[id])
    if (expandedIds.length > 0) await refreshSessions(expandedIds)
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加频道</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>名称</th><th>ID</th><th>类型</th><th>Agent</th><th>存储</th><th>记忆</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(channels).length === 0">
            <td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">暂无频道配置</td>
          </tr>
          <tr v-for="(c, id) in channels" :key="id">
            <td>{{ c.name || '-' }}</td>
            <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ id }}</td>
            <td>{{ c.type || '-' }}</td>
            <td>{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</td>
            <td>
              <button v-if="c.saver" class="table-link-btn" @click="saverViewModal?.open(c.saver, 'lark_' + id)">
                {{ saverOptions.find(s => s.id === c.saver)?.label || c.saver }}
              </button>
              <span v-else>-</span>
            </td>
            <td>{{ c.memory ? (memoryOptions.find(m => m.id === c.memory)?.label || c.memory) : '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box" style="width:440px">
        <div class="modal-header">
          <h3>{{ editingId ? '编辑频道' : '添加频道' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="editingId" class="form-group">
            <label>ID</label>
            <input :value="editingId" disabled style="font-family:monospace;font-size:11px" />
          </div>
          <div class="form-group">
            <label>显示名称</label>
            <input v-model="form.name" placeholder="可选，便于识别" />
          </div>
          <div class="form-group">
            <label>频道类型 *</label>
            <select v-model="form.type">
              <option value="lark">Lark</option>
            </select>
          </div>
          <div v-if="form.type === 'lark'" class="form-group">
            <label>App ID</label>
            <input v-model="form.appId" placeholder="Lark App ID" />
          </div>
          <div v-if="form.type === 'lark'" class="form-group">
            <label>App Secret</label>
            <input v-model="form.appSecret" placeholder="Lark App Secret" type="password" />
          </div>
          <div class="form-group">
            <label>Agent *</label>
            <select v-model="form.agent">
              <option value="" disabled>请选择 Agent</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>存储配置 *</label>
            <select v-model="form.saver">
              <option value="" disabled>请选择存储配置</option>
              <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>记忆配置</label>
            <select v-model="form.memory">
              <option value="">不启用记忆</option>
              <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
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
