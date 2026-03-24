<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChannelConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'
import PathPickerModal from './modals/PathPickerModal.vue'
import { larkThreadId, slackThreadId, wecomThreadId } from 'sbot.commons'

const { t } = useI18n()

interface ChannelSessionRow {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
  avatar: string
  agentId: string
  memoryId: string | null
  workPath: string | null
}

interface UserRow {
  id: number
  userId: string
  userName: string
  avatar: string
  userInfo: string
  channelId: string
}

const { show } = useToast()

const channels = computed(() => store.settings.channels || {})
const agentOptions  = computed(() => Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name  || id })))
const saverOptions  = computed(() => Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name  || id })))
const memoryOptions = computed(() => Object.entries(store.settings.memories  || {}).map(([id, m]) => ({ id, label: (m as any).name  || id })))

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()
const pathPicker     = ref<InstanceType<typeof PathPickerModal>>()

const expandedChannels  = ref<Record<string, boolean>>({})
const channelTabs       = ref<Record<string, 'sessions' | 'users'>>({})

function getChannelTab(id: string): 'sessions' | 'users' { return channelTabs.value[id] ?? 'sessions' }
function setChannelTab(id: string, tab: 'sessions' | 'users') { channelTabs.value[id] = tab }
const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
const userMap          = ref<Record<string, UserRow[]>>({})
const channelLoading   = ref<Record<string, boolean>>({})
const viewUser         = ref<UserRow | null>(null)

const editingSession   = ref<ChannelSessionRow | null>(null)
const sessionForm      = ref<{ name: string; agentId: string; memoryId: string; workPath: string }>({ name: '', agentId: '', memoryId: '', workPath: '' })

function openEditSession(s: ChannelSessionRow) {
  editingSession.value = s
  sessionForm.value = { name: s.sessionName || '', agentId: s.agentId || '', memoryId: s.memoryId || '', workPath: s.workPath || '' }
}

async function saveSession() {
  const s = editingSession.value
  if (!s) return
  try {
    await apiFetch(`/api/channel-sessions/${s.id}`, 'PUT', {
      sessionName: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      memoryId: sessionForm.value.memoryId || null,
      workPath: sessionForm.value.workPath.trim() || null,
    })
    Object.assign(s, {
      sessionName: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      memoryId: sessionForm.value.memoryId || null,
      workPath: sessionForm.value.workPath.trim() || null,
    })
    show(t('common.saved'))
    editingSession.value = null
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function threadId(channelId: string, c: any, sessionId: string): string {
  if (c.type === 'slack') return slackThreadId(channelId, sessionId)
  if (c.type === 'wecom') return wecomThreadId(channelId, sessionId)
  return larkThreadId(channelId, sessionId)
}

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ name: string; type: string; appId: string; appSecret: string; botToken: string; appToken: string; botId: string; secret: string; agent: string; saver: string; memory: string }>({
  name: '', type: 'lark', appId: '', appSecret: '', botToken: '', appToken: '', botId: '', secret: '', agent: '', saver: '', memory: '',
})

async function loadChannelData(id: string) {
  channelLoading.value[id] = true
  try {
    const [sessRes, userRes] = await Promise.all([
      apiFetch(`/api/channel-sessions?channelId=${encodeURIComponent(id)}`),
      apiFetch(`/api/channel-users?channelId=${encodeURIComponent(id)}`),
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
  if (!window.confirm(t('channels.confirm_delete_session', { name: session.sessionId }))) return
  try {
    await apiFetch(`/api/channel-sessions/${session.id}`, 'DELETE')
    const list = sessionMap.value[channelId]
    if (list) sessionMap.value[channelId] = list.filter(s => s.id !== session.id)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function removeUser(channelId: string, user: UserRow) {
  if (!window.confirm(t('channels.confirm_delete_user', { name: user.userName || user.userId }))) return
  try {
    await apiFetch(`/api/channel-users/${user.id}`, 'DELETE')
    const list = userMap.value[channelId]
    if (list) userMap.value[channelId] = list.filter(u => u.id !== user.id)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function formatUserInfo(raw: string) {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function openAdd() {
  editingId.value = null
  form.value = { name: '', type: 'lark', appId: '', appSecret: '', botToken: '', appToken: '', botId: '', secret: '', agent: '', saver: '', memory: '' }
  showModal.value = true
}

function openEdit(id: string) {
  const c = channels.value[id]
  editingId.value = id
  form.value = { name: c.name || '', type: c.type || 'lark', appId: c.appId || '', appSecret: c.appSecret || '', botToken: c.botToken || '', appToken: c.appToken || '', botId: c.botId || '', secret: c.secret || '', agent: c.agent, saver: c.saver, memory: c.memory || '' }
  showModal.value = true
}

async function save() {
  if (!form.value.agent) { show(t('channels.select_agent'), 'error'); return }
  if (!form.value.saver) { show(t('channels.select_saver'), 'error'); return }
  try {
    const config: ChannelConfig = {
      type: form.value.type,
      agent: form.value.agent,
      saver: form.value.saver,
    }
    if (form.value.name.trim()) config.name = form.value.name.trim()
    if (form.value.appId.trim()) config.appId = form.value.appId.trim()
    if (form.value.appSecret.trim()) config.appSecret = form.value.appSecret.trim()
    if (form.value.botToken.trim()) config.botToken = form.value.botToken.trim()
    if (form.value.appToken.trim()) config.appToken = form.value.appToken.trim()
    if (form.value.botId.trim()) config.botId = form.value.botId.trim()
    if (form.value.secret.trim()) config.secret = form.value.secret.trim()
    if (form.value.memory) config.memory = form.value.memory

    if (editingId.value) {
      await apiFetch(`/api/settings/channels/${editingId.value}`, 'PUT', config)
      if (store.settings.channels) Object.assign(store.settings.channels[editingId.value], config)
    } else {
      const res = await apiFetch('/api/settings/channels', 'POST', config)
      const id = res.data?.id
      if (id) {
        if (!store.settings.channels) store.settings.channels = {}
        store.settings.channels[id] = config
      }
    }
    show(t('common.saved'))
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(id: string) {
  const c = channels.value[id]
  const label = c?.name || id
  if (!window.confirm(t('channels.confirm_delete', { name: label }))) return
  try {
    await apiFetch(`/api/settings/channels/${id}`, 'DELETE')
    if (c?.saver) {
      await apiFetch(`/api/savers/${encodeURIComponent(c.saver)}/threads/${c.type}_${encodeURIComponent(id)}/history`, 'DELETE').catch(() => {})
    }
    if (store.settings.channels) delete store.settings.channels[id]
    show(t('common.deleted'))
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
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('channels.add') }}</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th style="width:32px"></th><th>{{ t('common.name') }}</th><th>{{ t('common.id') }}</th><th>{{ t('common.type') }}</th><th>{{ t('common.agent') }}</th><th>{{ t('common.storage') }}</th><th>{{ t('common.memory') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(channels).length === 0">
            <td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">{{ t('channels.empty') }}</td>
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
                  <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
                  <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
                </div>
              </td>
            </tr>
            <!-- ── Detail row (expanded) ── -->
            <tr v-if="expandedChannels[id as string]">
              <td colspan="8" style="padding:0;border-bottom:2px solid #e2e8f0">
                <!-- Tab bar -->
                <div class="detail-tab-bar">
                  <button
                    v-for="tab in [
                      { key: 'sessions', label: `${t('channels.sessions')} (${(sessionMap[id as string] || []).length})` },
                      { key: 'users',    label: `${t('channels.users')} (${(userMap[id as string] || []).length})` },
                    ]"
                    :key="tab.key"
                    class="detail-tab-btn"
                    :class="{ active: getChannelTab(id as string) === tab.key }"
                    @click="setChannelTab(id as string, tab.key as 'sessions' | 'users')"
                  >{{ tab.label }}</button>
                </div>
                <!-- Tab content -->
                <div class="detail-tab-content">
                  <div v-if="channelLoading[id as string]" class="detail-empty">{{ t('common.loading') }}</div>
                  <template v-else>
                    <!-- Sessions tab -->
                    <template v-if="getChannelTab(id as string) === 'sessions'">
                      <div v-if="(sessionMap[id as string] || []).length === 0" class="detail-empty">{{ t('channels.no_sessions') }}</div>
                      <table v-else class="detail-table">
                        <thead>
                          <tr>
                            <th>{{ t('common.name') }}</th>
                            <th>{{ t('common.id') }}</th>
                            <th>{{ t('common.agent') }}</th>
                            <th>{{ t('common.memory') }}</th>
                            <th>{{ t('directory.path_label') }}</th>
                            <th>{{ t('common.ops') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="s in sessionMap[id as string] || []" :key="s.id">
                            <td class="session-id-cell">
                              <img v-if="s.avatar" :src="s.avatar" class="session-avatar" />
                              {{ s.sessionName || s.sessionId }}
                            </td>
                            <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ s.sessionId }}</td>
                            <td>{{ agentOptions.find(a => a.id === s.agentId)?.label || s.agentId || '-' }}</td>
                            <td>{{ memoryOptions.find(m => m.id === s.memoryId)?.label || s.memoryId || '-' }}</td>
                            <td style="font-family:monospace;font-size:11px;color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="s.workPath || ''">{{ s.workPath || '-' }}</td>
                            <td>
                              <div class="ops-cell">
                                <button v-if="c.saver" class="btn-outline btn-sm" @click="saverViewModal?.open(c.saver, threadId(id as string, c, s.sessionId))">{{ t('channels.history') }}</button>
                                <button class="btn-outline btn-sm" @click="openEditSession(s)">{{ t('common.edit') }}</button>
                                <button class="btn-danger btn-sm" @click="removeSession(id as string, s)">{{ t('common.delete') }}</button>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </template>
                    <!-- Users tab -->
                    <template v-if="getChannelTab(id as string) === 'users'">
                      <div v-if="(userMap[id as string] || []).length === 0" class="detail-empty">{{ t('channels.no_users') }}</div>
                      <table v-else class="detail-table">
                        <thead>
                          <tr>
                            <th>{{ t('common.name') }}</th>
                            <th>{{ t('common.id') }}</th>
                            <th>{{ t('common.ops') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="u in userMap[id as string] || []" :key="u.id">
                            <td class="session-id-cell">
                              <img v-if="u.avatar" :src="u.avatar" class="session-avatar" />
                              {{ u.userName || '-' }}
                            </td>
                            <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ u.userId }}</td>
                            <td>
                              <div class="ops-cell">
                                <button class="btn-outline btn-sm" @click="viewUser = u">{{ t('common.view') }}</button>
                                <button class="btn-danger btn-sm" @click="removeUser(id as string, u)">{{ t('common.delete') }}</button>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </template>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box" style="width:440px">
        <div class="modal-header">
          <h3>{{ editingId ? t('channels.edit_title') : t('channels.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="editingId" class="form-group">
            <label>{{ t('common.id') }}</label>
            <input :value="editingId" disabled style="font-family:monospace;font-size:11px" />
          </div>
          <div class="form-group">
            <label>{{ t('channels.display_name') }}</label>
            <input v-model="form.name" :placeholder="t('channels.display_name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('channels.channel_type') }} *</label>
            <select v-model="form.type">
              <option value="lark">Lark</option>
              <option value="wecom">WeCom</option>
            </select>
          </div>
          <div v-if="form.type === 'lark'" class="form-group">
            <label>{{ t('channels.app_id') }}</label>
            <input v-model="form.appId" placeholder="Lark App ID" />
          </div>
          <div v-if="form.type === 'lark'" class="form-group">
            <label>{{ t('channels.app_secret') }}</label>
            <input v-model="form.appSecret" placeholder="Lark App Secret" type="password" />
          </div>
          <div v-if="form.type === 'wecom'" class="form-group">
            <label>{{ t('channels.bot_id') }}</label>
            <input v-model="form.botId" placeholder="WeCom Bot ID" />
          </div>
          <div v-if="form.type === 'wecom'" class="form-group">
            <label>{{ t('channels.bot_secret') }}</label>
            <input v-model="form.secret" placeholder="WeCom Bot Secret" type="password" />
          </div>
          <div class="form-group">
            <label>{{ t('common.agent') }} *</label>
            <select v-model="form.agent">
              <option value="" disabled>{{ t('channels.select_agent') }}</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.storage') }} *</label>
            <select v-model="form.saver">
              <option value="" disabled>{{ t('channels.select_saver') }}</option>
              <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.memory') }}</label>
            <select v-model="form.memory">
              <option value="">{{ t('channels.no_memory') }}</option>
              <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="editingSession" class="modal-overlay" @click.self="editingSession = null">
      <div class="modal-box" style="width:440px">
        <div class="modal-header">
          <h3>{{ t('channels.edit_session_title', { name: editingSession.sessionId }) }}</h3>
          <button class="modal-close" @click="editingSession = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('channels.session_id') }}</label>
            <input :value="editingSession.sessionId" disabled style="font-family:monospace;font-size:11px" />
          </div>
          <div class="form-group">
            <label>{{ t('channels.session_name') }}</label>
            <input :value="sessionForm.name" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('common.agent') }}</label>
            <select v-model="sessionForm.agentId">
              <option value="">{{ t('common.not_use') }}</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.memory') }}</label>
            <select v-model="sessionForm.memoryId">
              <option value="">{{ t('channels.no_memory') }}</option>
              <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('directory.path_label') }}</label>
            <div style="display:flex;gap:6px">
              <input v-model="sessionForm.workPath" type="text" :placeholder="t('directory.path_placeholder')" style="flex:1" />
              <button class="btn-outline btn-sm" @click="pathPicker?.open(sessionForm.workPath)">{{ t('directory.browse') }}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="editingSession = null">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="saveSession">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="viewUser" class="modal-overlay" @click.self="viewUser = null">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>{{ t('channels.user_detail_title', { name: viewUser.userName || viewUser.userId }) }}</h3>
          <button class="modal-close" @click="viewUser = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.id') }}</label>
            <input :value="viewUser.id" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('channels.user_id') }}</label>
            <input :value="viewUser.userId" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('channels.username') }}</label>
            <input :value="viewUser.userName" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('channels.channel') }}</label>
            <input :value="viewUser.channelId" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('channels.user_info') }}</label>
            <textarea :value="formatUserInfo(viewUser.userInfo)" disabled rows="16" style="font-family:monospace;font-size:12px" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewUser = null">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <SaverViewModal ref="saverViewModal" />
    <PathPickerModal ref="pathPicker" @confirm="p => sessionForm.workPath = p" />
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
.session-id-cell {
  font-size: 13px;
  font-weight: 500;
  color: #2d2d2d;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.session-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
/* ── Detail row ── */
.detail-tab-bar {
  display: flex;
  border-bottom: 1px solid #e8e6e3;
  background: #f0f4f8;
  padding: 0 20px;
}
.detail-tab-btn {
  padding: 9px 14px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s;
  color: #9b9b9b;
}
.detail-tab-btn:hover { color: #1c1c1c; }
.detail-tab-btn.active { color: #1c1c1c; border-bottom-color: #1c1c1c; }
.detail-tab-content {
  padding: 12px 20px;
  background: #f8fafc;
  max-height: 400px;
  overflow: auto;
}
.detail-empty {
  text-align: center;
  padding: 24px;
  color: #94a3b8;
  font-size: 13px;
}
.detail-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e8e6e3;
}
.detail-table th {
  padding: 7px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: .04em;
  background: #f5f4f2;
  border-bottom: 1px solid #e8e6e3;
  text-align: left;
}
.detail-table td {
  padding: 7px 12px;
  font-size: 13px;
  border-bottom: 1px solid #f0eeeb;
  vertical-align: middle;
}
.detail-table tr:last-child td { border-bottom: none; }
.detail-table tr:hover td { background: #fafaf9; }
</style>
