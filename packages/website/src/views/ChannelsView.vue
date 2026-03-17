<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChannelConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'
import { larkThreadId } from 'sbot.commons'

interface ChannelSessionRow {
  id: number
  channel: string
  sessionId: string
  name: string
  agentId: string
  memoryId: string | null
}

interface UserRow {
  id: number
  userid: string
  username: string
  userinfo: string
  channel: string
}

const { show } = useToast()

const channels = computed(() => store.settings.channels || {})
const agentOptions  = computed(() => Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name  || id })))
const saverOptions  = computed(() => Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name  || id })))
const memoryOptions = computed(() => Object.entries(store.settings.memories  || {}).map(([id, m]) => ({ id, label: (m as any).name  || id })))

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()

const expandedChannels = ref<Record<string, boolean>>({})
const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
const userMap          = ref<Record<string, UserRow[]>>({})
const channelLoading   = ref<Record<string, boolean>>({})
const viewUser         = ref<UserRow | null>(null)

const editingSession   = ref<ChannelSessionRow | null>(null)
const sessionForm      = ref<{ name: string; agentId: string; memoryId: string }>({ name: '', agentId: '', memoryId: '' })

function openEditSession(s: ChannelSessionRow) {
  editingSession.value = s
  sessionForm.value = { name: s.name || '', agentId: s.agentId || '', memoryId: s.memoryId || '' }
}

async function saveSession() {
  const s = editingSession.value
  if (!s) return
  try {
    await apiFetch(`/api/channel-sessions/${s.id}`, 'PUT', {
      name: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      memoryId: sessionForm.value.memoryId || null,
    })
    Object.assign(s, {
      name: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      memoryId: sessionForm.value.memoryId || null,
    })
    show('保存成功')
    editingSession.value = null
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ name: string; type: string; appId: string; appSecret: string; agent: string; saver: string; memory: string }>({
  name: '', type: 'lark', appId: '', appSecret: '', agent: '', saver: '', memory: '',
})

async function loadChannelData(id: string) {
  channelLoading.value[id] = true
  try {
    const [sessRes, userRes] = await Promise.all([
      apiFetch(`/api/channel-sessions?channel=${encodeURIComponent(id)}`),
      apiFetch(`/api/channel-users?channel=${encodeURIComponent(id)}`),
    ])
    sessionMap.value[id] = sessRes.data || []
    userMap.value[id]    = userRes.data || []
  } catch (e: any) {
    show(e.message, 'error')
    sessionMap.value[id] = []
    userMap.value[id]    = []
  } finally {
    channelLoading.value[id] = false
  }
}

async function toggleExpand(id: string) {
  expandedChannels.value[id] = !expandedChannels.value[id]
  if (!expandedChannels.value[id]) return
  if ((id in sessionMap.value) || channelLoading.value[id]) return
  await loadChannelData(id)
}

async function refreshSessions(ids: string[]) {
  await Promise.all(ids.map(id => loadChannelData(id)))
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

async function removeUser(channelId: string, user: UserRow) {
  if (!confirm(`确定要删除用户 "${user.username || user.userid}" 吗？`)) return
  try {
    await apiFetch(`/api/channel-users/${user.id}`, 'DELETE')
    const list = userMap.value[channelId]
    if (list) userMap.value[channelId] = list.filter(u => u.id !== user.id)
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function formatUserInfo(raw: string) {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
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
          <tr><th style="width:32px"></th><th>名称</th><th>ID</th><th>类型</th><th>Agent</th><th>存储</th><th>记忆</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(channels).length === 0">
            <td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">暂无频道配置</td>
          </tr>
          <template v-for="(c, id) in channels" :key="id">
            <tr>
              <td>
                <button class="expand-btn" @click="toggleExpand(id as string)">
                  {{ expandedChannels[id as string] ? '▼' : '▶' }}
                </button>
              </td>
              <td>{{ c.name || '-' }}</td>
              <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ id }}</td>
              <td>{{ c.type || '-' }}</td>
              <td>{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</td>
              <td>{{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</td>
              <td>{{ c.memory ? (memoryOptions.find(m => m.id === c.memory)?.label || c.memory) : '-' }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
                </div>
              </td>
            </tr>
            <template v-if="expandedChannels[id as string]">
              <!-- Sessions section -->
              <tr class="section-label-row">
                <td></td>
                <td colspan="7" class="section-label-cell">会话</td>
              </tr>
              <tr v-if="channelLoading[id as string]" class="session-sub-row">
                <td></td>
                <td colspan="7" class="session-sub-cell">加载中...</td>
              </tr>
              <template v-else>
                <tr v-if="(sessionMap[id as string] || []).length === 0" class="session-sub-row">
                  <td></td>
                  <td colspan="7" class="session-sub-cell">暂无会话记录</td>
                </tr>
                <tr v-for="s in sessionMap[id as string] || []" :key="s.id" class="session-sub-row">
                  <td></td>
                  <td colspan="2" class="session-id-cell">{{ s.name || s.sessionId }}</td>
                  <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ s.sessionId }}</td>
                  <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ agentOptions.find(a => a.id === s.agentId)?.label || s.agentId || '-' }}</td>
                  <td></td>
                  <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.memoryId || '-' }}</td>
                  <td>
                    <div class="ops-cell">
                      <button v-if="c.saver" class="btn-outline btn-sm" @click="saverViewModal?.open(c.saver, larkThreadId(id as string, s.sessionId))">历史记录</button>
                      <button class="btn-outline btn-sm" @click="openEditSession(s)">编辑</button>
                      <button class="btn-danger btn-sm" @click="removeSession(id as string, s)">删除</button>
                    </div>
                  </td>
                </tr>
              </template>
              <!-- Users section -->
              <tr class="section-label-row">
                <td></td>
                <td colspan="7" class="section-label-cell">用户</td>
              </tr>
              <template v-if="!channelLoading[id as string]">
                <tr v-if="(userMap[id as string] || []).length === 0" class="session-sub-row">
                  <td></td>
                  <td colspan="7" class="session-sub-cell">暂无用户数据</td>
                </tr>
                <tr v-for="u in userMap[id as string] || []" :key="u.id" class="session-sub-row">
                  <td></td>
                  <td colspan="2" class="session-id-cell">{{ u.userid }}</td>
                  <td colspan="2" style="font-size:12px;color:#3d3d3d">{{ u.username || '-' }}</td>
                  <td colspan="2"></td>
                  <td>
                    <div class="ops-cell">
                      <button class="btn-outline btn-sm" @click="viewUser = u">查看</button>
                      <button class="btn-danger btn-sm" @click="removeUser(id as string, u)">删除</button>
                    </div>
                  </td>
                </tr>
              </template>
            </template>
          </template>
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

    <div v-if="editingSession" class="modal-overlay" @click.self="editingSession = null">
      <div class="modal-box" style="width:440px">
        <div class="modal-header">
          <h3>编辑会话 — {{ editingSession.sessionId }}</h3>
          <button class="modal-close" @click="editingSession = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Session ID</label>
            <input :value="editingSession.sessionId" disabled style="font-family:monospace;font-size:11px" />
          </div>
          <div class="form-group">
            <label>名称</label>
            <input v-model="sessionForm.name" placeholder="会话名称" />
          </div>
          <div class="form-group">
            <label>Agent</label>
            <select v-model="sessionForm.agentId">
              <option value="">不指定</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>记忆配置</label>
            <select v-model="sessionForm.memoryId">
              <option value="">不启用记忆</option>
              <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="editingSession = null">取消</button>
          <button class="btn-primary" @click="saveSession">保存</button>
        </div>
      </div>
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
.session-sub-row td {
  background: #fafaf9;
  border-bottom: 1px solid #f0efed;
  padding-top: 5px;
  padding-bottom: 5px;
}
.section-label-row td {
  background: #f5f4f2;
  border-bottom: 1px solid #e8e6e3;
  padding-top: 3px;
  padding-bottom: 3px;
}
.section-label-cell {
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #8a8a8a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.session-sub-cell {
  padding: 5px 12px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
}
.session-id-cell {
  font-family: monospace;
  font-size: 12px;
  color: #3d3d3d;
  padding: 5px 12px;
}
</style>
