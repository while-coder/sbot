<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { ChannelConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'
import PathPickerModal from './modals/PathPickerModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'

const { t } = useI18n()
const { isMobile } = useResponsive()

interface PluginInfo {
  type: string
  configSchema?: Record<string, { label: string; type: string; required?: boolean; description?: string; default?: string | boolean | number; options?: Array<{ label: string; value: string }> }>
}

interface ChannelSessionRow {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
  avatar: string
  // 可覆盖 ChannelConfig 默认值（null = 使用频道默认值）
  agentId: string | null
  saver: string | null
  memories: string[]
  wikis: string[]
  workPath: string | null
  streamVerbose: boolean | null
  autoApproveAllTools: boolean | null
  intentModel: string | null
  intentPrompt: string | null
  intentThreshold: number | null
  // 会话自有字段
  useChannelMemories: boolean
  useChannelWikis: boolean
  // 运行时统计
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastInputTokens: number
  lastOutputTokens: number
  lastTotalTokens: number
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

const plugins = ref<PluginInfo[]>([])

async function loadPlugins() {
  try {
    const res = await apiFetch('/api/channel-plugins')
    plugins.value = res.data || []
  } catch { /* ignore */ }
}
loadPlugins()

const currentSchema = computed(() => {
  const p = plugins.value.find(p => p.type === form.value.type)
  return p?.configSchema ?? {}
})

const channels = computed(() => store.settings.channels || {})
const agentOptions  = computed(() => Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name  || id, type: (a as any).type || '' })))
const saverOptions  = computed(() => Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name  || id })))
const memoryOptions = computed(() => Object.entries(store.settings.memories  || {}).map(([id, m]) => ({ id, label: m.name  || id })))
const wikiOptions   = computed(() => Object.entries(store.settings.wikis    || {}).map(([id, w]) => ({ id, label: (w as any).name  || id })))
const modelOptions  = computed(() => Object.entries(store.settings.models   || {}).map(([id, m]) => ({ id, label: (m as any).name  || id })))

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
const sessionForm      = ref<{ name: string; agentId: string; saver: string; memories: string[]; wikis: string[]; useChannelMemories: boolean; useChannelWikis: boolean; workPath: string; intentModel: string | null; intentPrompt: string; intentThreshold: number; streamVerbose: boolean | null; autoApproveAllTools: boolean | null }>({ name: '', agentId: '', saver: '', memories: [], wikis: [], useChannelMemories: false, useChannelWikis: false, workPath: '', intentModel: null, intentPrompt: '', intentThreshold: 0.7, streamVerbose: null, autoApproveAllTools: null })

function openEditSession(s: ChannelSessionRow) {
  editingSession.value = s
  const rawMem = s.memories
  const memArr = Array.isArray(rawMem) ? rawMem : typeof rawMem === 'string' ? (() => { try { const p = JSON.parse(rawMem); return Array.isArray(p) ? p : [] } catch { return [] } })() : []
  const rawWiki = (s as any).wikis
  const wikiArr = Array.isArray(rawWiki) ? rawWiki : typeof rawWiki === 'string' ? (() => { try { const p = JSON.parse(rawWiki); return Array.isArray(p) ? p : [] } catch { return [] } })() : []
  sessionForm.value = { name: s.sessionName || '', agentId: s.agentId || '', saver: s.saver || '', memories: memArr, wikis: wikiArr, useChannelMemories: !!s.useChannelMemories, useChannelWikis: !!s.useChannelWikis, workPath: s.workPath || '', intentModel: s.intentModel ?? null, intentPrompt: s.intentPrompt || '', intentThreshold: s.intentThreshold ?? 0.7, streamVerbose: s.streamVerbose, autoApproveAllTools: s.autoApproveAllTools }
}

async function saveSession() {
  const s = editingSession.value
  if (!s) return
  const validMemIds = new Set(memoryOptions.value.map(m => m.id))
  const memories = sessionForm.value.memories.filter(id => validMemIds.has(id))
  const validWikiIds = new Set(wikiOptions.value.map(w => w.id))
  const wikis = sessionForm.value.wikis.filter(id => validWikiIds.has(id))
  try {
    await apiFetch(`/api/channel-sessions/${s.id}`, 'PUT', {
      sessionName: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      saver: sessionForm.value.saver || null,
      memories,
      wikis,
      useChannelMemories: sessionForm.value.useChannelMemories,
      useChannelWikis: sessionForm.value.useChannelWikis,
      workPath: sessionForm.value.workPath.trim() || null,
      intentModel: sessionForm.value.intentModel ?? null,
      intentPrompt: sessionForm.value.intentPrompt.trim() || null,
      intentThreshold: sessionForm.value.intentModel ? sessionForm.value.intentThreshold : null,
      streamVerbose: sessionForm.value.streamVerbose,
      autoApproveAllTools: sessionForm.value.autoApproveAllTools,
    })
    Object.assign(s, {
      sessionName: sessionForm.value.name.trim(),
      agentId: sessionForm.value.agentId,
      saver: sessionForm.value.saver || null,
      memories,
      wikis,
      useChannelMemories: sessionForm.value.useChannelMemories,
      useChannelWikis: sessionForm.value.useChannelWikis,
      workPath: sessionForm.value.workPath.trim() || null,
      intentModel: sessionForm.value.intentModel ?? null,
      intentPrompt: sessionForm.value.intentPrompt.trim() || null,
      intentThreshold: sessionForm.value.intentModel ? sessionForm.value.intentThreshold : null,
      streamVerbose: sessionForm.value.streamVerbose,
      autoApproveAllTools: sessionForm.value.autoApproveAllTools,
    })
    show(t('common.saved'))
    editingSession.value = null
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function formatTokens(n: number): string {
  return n.toLocaleString()
}

function threadId(channelId: string, c: any, sessionId: string): string {
  return `${c.type}_${channelId}_${sessionId}`
}

const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<ChannelConfig>({
  name: '', type: '', config: {}, agent: '', saver: '', memories: [],
  workPath: '', streamVerbose: false, autoApproveAllTools: false,
  intentModel: '', intentPrompt: '', intentThreshold: 0.7,
})

async function loadChannelData(id: string) {
  channelLoading.value[id] = true
  try {
    const [sessRes, userRes] = await Promise.all([
      apiFetch(`/api/channel-sessions?channelId=${encodeURIComponent(id)}`),
      apiFetch(`/api/channel-users?channelId=${encodeURIComponent(id)}`),
    ])
    sessionMap.value[id] = (sessRes.data || []).map((s: any) => ({
      ...s, memories: s.memories || [], useChannelMemories: !!s.useChannelMemories, useChannelWikis: !!s.useChannelWikis,
    }))
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
  if (!window.confirm(t('users.confirm_delete', { name: user.userName || user.userId }))) return
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

const passwordVisible = ref<Record<string, boolean>>({})

// --- Action field support (QR login etc.) ---
const actionState = ref<Record<string, { loading: boolean; qrUrl?: string; qrType?: 'image' | 'link'; status?: string; error?: string }>>({})

function clearActionState() {
  actionState.value = {}
}

async function triggerAction(key: string) {
  const channelId = editingId.value
  if (!channelId) { show('请先保存 Channel 后再执行此操作', 'error'); return }

  actionState.value[key] = { loading: true }
  try {
    const res = await apiFetch(`/api/channels/${channelId}/qrcode/${key}`, 'POST', form.value.config)
    const data = res.data
    if (data?.url) {
      actionState.value[key] = { loading: false, qrUrl: data.url, qrType: data.type || 'link', status: 'wait' }
      await waitForQRConfirm(key, channelId)
    } else {
      actionState.value[key] = { loading: false, status: 'done' }
    }
  } catch (e: any) {
    actionState.value[key] = { loading: false, error: e.message }
  }
}

/** Long-polls backend until QR scan confirmed or expired */
async function waitForQRConfirm(key: string, channelId: string) {
  try {
    const res = await apiFetch(`/api/channels/${channelId}/qrcode/${key}/confirm`, 'POST')
    const data = res.data
    const s = actionState.value[key]
    if (!s) return
    s.status = data?.status
    if (data?.status === 'confirmed') {
      s.qrUrl = undefined
      if (data.credentials) {
        form.value.config[key] = data.credentials
        const c = store.settings.channels?.[channelId]
        if (c) {
          if (!c.config) c.config = {}
          c.config[key] = data.credentials
        }
      }
      show('登录成功')
    } else if (data?.status === 'expired') {
      s.qrUrl = undefined
      s.error = '二维码已过期，请重新生成'
    }
  } catch (e: any) {
    const s = actionState.value[key]
    if (s) s.error = e.message
  }
}

function openAdd() {
  editingId.value = null
  clearActionState()
  form.value = { name: '', type: plugins.value[0]?.type || '', config: {}, agent: '', saver: '', memories: [], wikis: [], workPath: '', streamVerbose: false, autoApproveAllTools: false, intentModel: '', intentPrompt: '', intentThreshold: 0.7 }
  showModal.value = true
}

function openEdit(id: string) {
  const c = channels.value[id]
  editingId.value = id
  clearActionState()
  form.value = { name: c.name, type: c.type, config: { ...c.config }, agent: c.agent, saver: c.saver, memories: c.memories || [], wikis: (c as any).wikis || [], workPath: c.workPath || '', streamVerbose: !!c.streamVerbose, autoApproveAllTools: !!c.autoApproveAllTools, intentModel: c.intentModel || '', intentPrompt: c.intentPrompt || '', intentThreshold: c.intentThreshold ?? 0.7 }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (!form.value.agent) { show(t('channels.select_agent'), 'error'); return }
  if (!form.value.saver) { show(t('channels.select_saver'), 'error'); return }
  try {
    const validMemIds = new Set(memoryOptions.value.map(m => m.id))
    const validWikiIds = new Set(wikiOptions.value.map(w => w.id))
    const processedConfig: Record<string, any> = {}
    const schema = currentSchema.value
    for (const [key, val] of Object.entries(form.value.config)) {
      const ft = schema[key]?.type
      if (ft === 'qrcode') {
        if (val && typeof val === 'object') processedConfig[key] = val
        continue
      }
      if (val !== '' && val !== undefined && val !== null) processedConfig[key] = typeof val === 'string' ? val.trim() : val
    }
    const payload: ChannelConfig = {
      name: form.value.name.trim(),
      type: form.value.type,
      agent: form.value.agent,
      saver: form.value.saver,
      memories: form.value.memories.filter(id => validMemIds.has(id)),
      wikis: (form.value.wikis || []).filter(id => validWikiIds.has(id)),
      config: processedConfig,
      workPath: form.value.workPath?.trim() || undefined,
      streamVerbose: form.value.streamVerbose || undefined,
      autoApproveAllTools: form.value.autoApproveAllTools || undefined,
      intentModel: form.value.intentModel || undefined,
      intentPrompt: form.value.intentPrompt?.trim() || undefined,
      intentThreshold: form.value.intentModel ? form.value.intentThreshold : undefined,
    }

    if (editingId.value) {
      await apiFetch(`/api/settings/channels/${editingId.value}`, 'PUT', payload)
      if (store.settings.channels) Object.assign(store.settings.channels[editingId.value], payload)
    } else {
      const res = await apiFetch('/api/settings/channels', 'POST', payload)
      const id = res.data?.id
      if (id) {
        if (!store.settings.channels) store.settings.channels = {}
        store.settings.channels[id] = payload
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
    await loadPlugins()
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
      <table v-if="!isMobile">
        <thead>
          <tr><th style="width:32px"></th><th>{{ t('common.name') }}</th><th>{{ t('common.id') }}</th><th>{{ t('common.type') }}</th><th>{{ t('common.agent') }}</th><th>{{ t('common.storage') }}</th><th>{{ t('common.memory') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(channels).length === 0">
            <td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">{{ t('channels.empty') }}</td>
          </tr>
          <template v-for="(c, id) in channels" :key="id">
            <tr
              @click="toggleExpand(id as string)"
              style="cursor:pointer"
              :style="expandedChannels[id as string] ? 'background:#f8fafc' : ''"
            >
              <td style="padding:6px 8px;text-align:center">
                <span style="color:#6b6b6b;font-size:10px">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
              </td>
              <td>{{ c.name }}</td>
              <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ id }}</td>
              <td>{{ c.type }}</td>
              <td>{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</td>
              <td>{{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</td>
              <td>{{ Array.isArray(c.memories) && c.memories.length ? c.memories.map(id => memoryOptions.find(m => m.id === id)?.label || id).join(', ') : '-' }}</td>
              <td @click.stop>
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
                            <th>{{ t('channels.use_channel_memories') }} / {{ t('channels.use_channel_wikis') }}</th>
                            <th>{{ t('directory.path_label') }}</th>
                            <th>Tokens</th>
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
                            <td>{{ Array.isArray(s.memories) && s.memories.length ? s.memories.map(id => memoryOptions.find(m => m.id === id)?.label || id).join(', ') : '-' }}</td>
                            <td style="text-align:center;white-space:nowrap">
                              <span v-if="s.useChannelMemories" style="color:#16a34a;font-size:13px">✓</span><span v-else style="color:#94a3b8">-</span>
                              /
                              <span v-if="s.useChannelWikis" style="color:#16a34a;font-size:13px">✓</span><span v-else style="color:#94a3b8">-</span>
                            </td>
                            <td style="font-family:monospace;font-size:11px;color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="s.workPath || ''">{{ s.workPath || '-' }}</td>
                            <td style="font-family:monospace;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap" :title="s.totalTokens > 0 ? `${t('usage.total')}: ${formatTokens(s.totalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.inputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.outputTokens)}` + (s.lastTotalTokens > 0 ? `\n${t('usage.last')}: ${formatTokens(s.lastTotalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.lastInputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.lastOutputTokens)}` : '') : ''">
                              <template v-if="s.totalTokens > 0">{{ formatTokens(s.totalTokens) }}</template>
                              <template v-else>-</template>
                            </td>
                            <td>
                              <div class="ops-cell">
                                <button v-if="c.saver" class="btn-outline btn-sm" @click="saverViewModal?.open(c.saver, saverOptions.find(o => o.id === c.saver)?.label || c.saver, threadId(id as string, c, s.sessionId))">{{ t('channels.history') }}</button>
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

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-for="(c, id) in channels" :key="id" class="mobile-card">
          <div class="mobile-card-header" @click="toggleExpand(id as string)" style="display:flex;justify-content:space-between;cursor:pointer">
            <span>{{ c.name }}</span>
            <span style="font-size:10px">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.type') }}</span>
            <span class="mobile-card-value">{{ c.type }}</span>
            <span class="mobile-card-label">{{ t('common.agent') }}</span>
            <span class="mobile-card-value">{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</span>
            <span class="mobile-card-label">{{ t('common.storage') }}</span>
            <span class="mobile-card-value">{{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</span>
            <span class="mobile-card-label">{{ t('common.memory') }}</span>
            <span class="mobile-card-value">{{ Array.isArray(c.memories) && c.memories.length ? c.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
          </div>
          <!-- Expandable detail -->
          <div v-if="expandedChannels[id as string]" style="margin-top:10px">
            <div class="detail-tab-bar">
              <button class="detail-tab-btn" :class="{ active: getChannelTab(id as string) === 'sessions' }" @click="setChannelTab(id as string, 'sessions')">{{ t('channels.sessions') }}</button>
              <button class="detail-tab-btn" :class="{ active: getChannelTab(id as string) === 'users' }" @click="setChannelTab(id as string, 'users')">{{ t('channels.users') }}</button>
            </div>
            <!-- Sessions -->
            <div v-if="getChannelTab(id as string) === 'sessions'" class="card-list" style="margin-top:8px">
              <div v-for="s in (sessionMap[id as string] || [])" :key="s.id" class="mobile-card" style="border-color:#e2e8f0">
                <div class="mobile-card-header" style="font-size:13px;display:flex;align-items:center;gap:4px">
                  <img v-if="s.avatar" :src="s.avatar" style="width:20px;height:20px;border-radius:50%;object-fit:cover" />
                  {{ s.sessionName || s.sessionId }}
                </div>
                <div class="mobile-card-fields">
                  <span class="mobile-card-label">{{ t('common.agent') }}</span>
                  <span class="mobile-card-value">{{ agentOptions.find(a => a.id === s.agentId)?.label || s.agentId || '-' }}</span>
                  <span class="mobile-card-label">{{ t('common.memory') }}</span>
                  <span class="mobile-card-value">{{ Array.isArray(s.memories) && s.memories.length ? s.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : '-' }}</span>
                  <span class="mobile-card-label">Tokens</span>
                  <span class="mobile-card-value" style="font-family:monospace;font-variant-numeric:tabular-nums" :title="s.totalTokens > 0 ? `${t('usage.total')}: ${formatTokens(s.totalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.inputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.outputTokens)}` + (s.lastTotalTokens > 0 ? `\n${t('usage.last')}: ${formatTokens(s.lastTotalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.lastInputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.lastOutputTokens)}` : '') : ''">{{ s.totalTokens > 0 ? formatTokens(s.totalTokens) : '-' }}</span>
                </div>
                <div class="mobile-card-ops">
                  <button class="btn-outline btn-sm" @click="openEditSession(s)">{{ t('common.edit') }}</button>
                  <button class="btn-danger btn-sm" @click="removeSession(id as string, s)">{{ t('common.delete') }}</button>
                </div>
              </div>
              <div v-if="channelLoading[id as string]" class="mobile-card-empty">{{ t('common.loading') }}</div>
              <div v-else-if="!(sessionMap[id as string] || []).length" class="mobile-card-empty">-</div>
            </div>
            <!-- Users -->
            <div v-if="getChannelTab(id as string) === 'users'" class="card-list" style="margin-top:8px">
              <div v-for="u in (userMap[id as string] || [])" :key="u.id" class="mobile-card" style="border-color:#e2e8f0">
                <div class="mobile-card-header" style="font-size:13px;display:flex;align-items:center;gap:4px">
                  <img v-if="u.avatar" :src="u.avatar" style="width:20px;height:20px;border-radius:50%;object-fit:cover" />
                  {{ u.userName || '-' }}
                </div>
                <div class="mobile-card-ops">
                  <button class="btn-outline btn-sm" @click="viewUser = u">{{ t('common.view') }}</button>
                  <button class="btn-danger btn-sm" @click="removeUser(id as string, u)">{{ t('common.delete') }}</button>
                </div>
              </div>
              <div v-if="!(userMap[id as string] || []).length" class="mobile-card-empty">-</div>
            </div>
          </div>
        </div>
        <div v-if="Object.keys(channels).length === 0" class="mobile-card-empty">{{ t('channels.empty') }}</div>
      </div>
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
            <label>{{ t('channels.display_name') }} *</label>
            <input v-model="form.name" :placeholder="t('channels.display_name_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('channels.channel_type') }} *</label>
            <select v-model="form.type" @change="form.config = {}" :disabled="!!editingId">
              <option v-for="p in plugins" :key="p.type" :value="p.type">{{ p.type }}</option>
            </select>
          </div>
          <template v-for="(field, key) in currentSchema" :key="key">
            <div v-if="field.type === 'qrcode'" class="form-group">
              <label>{{ field.label }}</label>
              <div style="display:flex;flex-direction:column;gap:8px">
                <button class="btn-outline" style="align-self:flex-start" :disabled="actionState[key]?.loading" @click="triggerAction(key as string)">
                  {{ actionState[key]?.loading ? '...' : field.label }}
                </button>
                <img v-if="actionState[key]?.qrUrl && actionState[key]?.qrType === 'image'" :src="actionState[key]!.qrUrl" style="width:200px;height:200px;border:1px solid #e8e6e3;border-radius:8px" />
                <a v-else-if="actionState[key]?.qrUrl && actionState[key]?.qrType === 'link'" :href="actionState[key]!.qrUrl" target="_blank" class="btn-outline" style="align-self:flex-start;text-align:center">打开二维码链接</a>
                <span v-if="actionState[key]?.status === 'scaned'" style="font-size:12px;color:#e6a700">已扫码，请在手机上确认...</span>
                <span v-if="actionState[key]?.status === 'wait' && actionState[key]?.qrUrl" style="font-size:12px;color:#888">请扫描二维码</span>
                <span v-if="actionState[key]?.status === 'confirmed'" style="font-size:12px;color:#16a34a">登录成功</span>
                <span v-if="actionState[key]?.error" style="font-size:12px;color:#dc2626">{{ actionState[key]!.error }}</span>
                <span v-if="field.description && !actionState[key]?.qrUrl" style="font-size:11px;color:#888">{{ field.description }}</span>
              </div>
            </div>
            <div v-else class="form-group">
              <label>{{ field.label }}{{ field.required ? ' *' : '' }}</label>
              <select v-if="field.type === 'select'" v-model="form.config[key]">
                <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
              <label v-else-if="field.type === 'boolean'" class="toggle-label">
                <input type="checkbox" v-model="form.config[key]" />
                <span>{{ field.description || '' }}</span>
              </label>
              <input v-else-if="field.type === 'number'" type="number" v-model.number="form.config[key]" :placeholder="field.description || ''" />
              <div v-else-if="field.type === 'password'" class="apikey-field">
                <input v-model="form.config[key]" :placeholder="field.description || ''" :type="passwordVisible[key] ? 'text' : 'password'" />
                <button type="button" class="apikey-toggle" @click="passwordVisible[key] = !passwordVisible[key]" :title="passwordVisible[key] ? t('common.hide') : t('common.show')">{{ passwordVisible[key] ? t('common.hide') : t('common.show') }}</button>
              </div>
              <input v-else v-model="form.config[key]" :placeholder="field.description || ''" />
            </div>
          </template>
          <div class="form-group">
            <label>{{ t('common.agent') }} *</label>
            <select v-model="form.agent">
              <option value="" disabled>{{ t('channels.select_agent') }}</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
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
            <MultiSelect v-model="form.memories" :options="memoryOptions" />
          </div>
          <div class="form-group">
            <label>{{ t('common.wiki') }}</label>
            <MultiSelect :model-value="form.wikis || []" :options="wikiOptions" @update:model-value="form.wikis = $event" />
          </div>
          <div class="form-group">
            <label>{{ t('directory.path_label') }}</label>
            <div style="display:flex;gap:6px">
              <input v-model="form.workPath" type="text" :placeholder="t('directory.path_placeholder')" style="flex:1" />
              <button class="btn-outline btn-sm" @click="pathPicker?.open(form.workPath || '')">{{ t('directory.browse') }}</button>
            </div>
          </div>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.streamVerbose" />
              <span>{{ t('channels.stream_verbose') }}</span>
            </label>
            <span style="font-size:11px;color:#888">{{ t('channels.stream_verbose_hint') }}</span>
          </div>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.autoApproveAllTools" />
              <span>{{ t('settings.auto_approve_all') }}</span>
            </label>
            <span style="font-size:11px;color:#888">{{ t('settings.auto_approve_all_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('channels.intent_model') }}</label>
            <select v-model="form.intentModel">
              <option value="">{{ t('common.not_use') }}</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <span style="font-size:11px;color:#888">{{ t('channels.intent_model_hint') }}</span>
          </div>
          <template v-if="form.intentModel">
            <div class="form-group">
              <label>{{ t('channels.intent_threshold') }}</label>
              <input v-model.number="form.intentThreshold" type="number" min="0" max="1" step="0.1" />
              <span style="font-size:11px;color:#888">{{ t('channels.intent_threshold_hint') }}</span>
            </div>
            <div class="form-group">
              <label>{{ t('channels.intent_prompt') }}</label>
              <textarea v-model="form.intentPrompt" rows="4" :placeholder="t('channels.intent_prompt_placeholder')" style="font-size:12px" />
            </div>
          </template>
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
              <option value="">{{ t('channels.use_channel_default') }}</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.storage') }}</label>
            <select v-model="sessionForm.saver">
              <option value="">{{ t('channels.use_channel_default') }}</option>
              <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('common.memory') }}</label>
            <MultiSelect v-model="sessionForm.memories" :options="memoryOptions" />
            <label class="toggle-label" style="margin-top:4px">
              <input type="checkbox" v-model="sessionForm.useChannelMemories" />
              <span>{{ t('channels.use_channel_memories') }}</span>
            </label>
            <span style="font-size:11px;color:#888">{{ t('channels.use_channel_memories_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('common.wiki') }}</label>
            <MultiSelect v-model="sessionForm.wikis" :options="wikiOptions" />
            <label class="toggle-label" style="margin-top:4px">
              <input type="checkbox" v-model="sessionForm.useChannelWikis" />
              <span>{{ t('channels.use_channel_wikis') }}</span>
            </label>
            <span style="font-size:11px;color:#888">{{ t('channels.use_channel_wikis_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('directory.path_label') }}</label>
            <div style="display:flex;gap:6px">
              <input v-model="sessionForm.workPath" type="text" :placeholder="t('directory.path_placeholder')" style="flex:1" />
              <button class="btn-outline btn-sm" @click="pathPicker?.open(sessionForm.workPath)">{{ t('directory.browse') }}</button>
            </div>
            <span style="font-size:11px;color:#888">{{ t('channels.work_path_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('channels.stream_verbose') }}</label>
            <select :value="sessionForm.streamVerbose ?? ''" @change="sessionForm.streamVerbose = ($event.target as HTMLSelectElement).value === '' ? null : ($event.target as HTMLSelectElement).value === 'true'">
              <option value="">{{ t('channels.use_channel_default') }}</option>
              <option value="true">{{ t('common.enabled') }}</option>
              <option value="false">{{ t('common.disabled') }}</option>
            </select>
            <span style="font-size:11px;color:#888">{{ t('channels.stream_verbose_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('settings.auto_approve_all') }}</label>
            <select :value="sessionForm.autoApproveAllTools ?? ''" @change="sessionForm.autoApproveAllTools = ($event.target as HTMLSelectElement).value === '' ? null : ($event.target as HTMLSelectElement).value === 'true'">
              <option value="">{{ t('channels.use_channel_default') }}</option>
              <option value="true">{{ t('common.enabled') }}</option>
              <option value="false">{{ t('common.disabled') }}</option>
            </select>
            <span style="font-size:11px;color:#888">{{ t('settings.auto_approve_all_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('channels.intent_model') }}</label>
            <select :value="sessionForm.intentModel ?? '__default__'" @change="sessionForm.intentModel = ($event.target as HTMLSelectElement).value === '__default__' ? null : ($event.target as HTMLSelectElement).value">
              <option value="__default__">{{ t('channels.use_channel_default') }}</option>
              <option value="">{{ t('common.not_use') }}</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <span style="font-size:11px;color:#888">{{ t('channels.intent_model_hint') }}</span>
          </div>
          <template v-if="sessionForm.intentModel">
            <div class="form-group">
              <label>{{ t('channels.intent_threshold') }}</label>
              <input v-model.number="sessionForm.intentThreshold" type="number" min="0" max="1" step="0.1" />
              <span style="font-size:11px;color:#888">{{ t('channels.intent_threshold_hint') }}</span>
            </div>
            <div class="form-group">
              <label>{{ t('channels.intent_prompt') }}</label>
              <textarea v-model="sessionForm.intentPrompt" rows="4" :placeholder="t('channels.intent_prompt_placeholder')" style="font-size:12px" />
            </div>
          </template>
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
          <h3>{{ t('users.detail_title', { name: viewUser.userName || viewUser.userId }) }}</h3>
          <button class="modal-close" @click="viewUser = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.id') }}</label>
            <input :value="viewUser.id" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.user_id') }}</label>
            <input :value="viewUser.userId" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.username') }}</label>
            <input :value="viewUser.userName" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.channel') }}</label>
            <input :value="viewUser.channelId" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.user_info') }}</label>
            <textarea :value="formatUserInfo(viewUser.userInfo)" disabled rows="16" style="font-family:monospace;font-size:12px" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewUser = null">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <SaverViewModal ref="saverViewModal" />
    <PathPickerModal ref="pathPicker" @confirm="p => { if (editingSession) sessionForm.workPath = p; else form.workPath = p }" />
  </div>
</template>

<style scoped>
.apikey-field {
  display: flex;
  gap: 0;
}
.apikey-field input {
  flex: 1;
  border-radius: 6px 0 0 6px;
  border-right: none;
}
.apikey-toggle {
  padding: 0 12px;
  font-size: 12px;
  background: #f4f3f1;
  border: 1px solid #d1d0ce;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  color: #555;
  white-space: nowrap;
  transition: background .15s;
}
.apikey-toggle:hover { background: #eceae6; }
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
