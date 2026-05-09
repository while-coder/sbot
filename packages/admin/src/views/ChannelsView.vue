<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import QRCode from 'qrcode'
import type { ChannelConfig } from '@/types'
import SaverViewModal from './modals/SaverViewModal.vue'
import PathPickerModal from './modals/PathPickerModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'

const { t } = useI18n()
const { isMobile } = useResponsive()

interface PluginInfo {
  type: string
  label: string
  builtin: boolean
  configSchema: Record<string, { label: string; type: string; required?: boolean; description?: string; default?: string | boolean | number; options?: Array<{ label: string; value: string }> }>
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


const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<ChannelConfig>({
  name: '', type: '', config: {}, agent: '', saver: '', memories: [],
  workPath: '', streamVerbose: false, autoApproveAllTools: false,
  intentModel: '', intentPrompt: '', intentThreshold: 0.7,
  mergeWindow: 0,
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
const actionState = ref<Record<string, { loading: boolean; qrUrl?: string; qrLink?: string; qrType?: 'image' | 'link'; status?: string; error?: string }>>({})

function clearActionState() {
  actionState.value = {}
}

async function triggerAction(key: string) {
  const channelId = editingId.value
  const type = form.value.type
  if (!type) { show('请先选择频道类型', 'error'); return }

  actionState.value[key] = { loading: true }
  try {
    const url = channelId
      ? `/api/channels/${channelId}/qrcode/${key}`
      : `/api/channel-plugins/${type}/qrcode/${key}`
    const res = await apiFetch(url, 'POST', form.value.config)
    const data = res.data
    if (data?.url) {
      let qrUrl = data.url
      let qrLink: string | undefined
      const qrType = data.type || 'link'
      if (qrType === 'link') {
        qrLink = data.url
        qrUrl = await QRCode.toDataURL(data.url, { width: 200, margin: 2 })
      }
      actionState.value[key] = { loading: false, qrUrl, qrLink, qrType: 'image', status: 'wait' }
      await waitForQRConfirm(key, channelId, type)
    } else {
      actionState.value[key] = { loading: false, status: 'done' }
    }
  } catch (e: any) {
    actionState.value[key] = { loading: false, error: e.message }
  }
}

/** Long-polls backend until QR scan confirmed or expired */
async function waitForQRConfirm(key: string, channelId: string | null, type: string) {
  try {
    const url = channelId
      ? `/api/channels/${channelId}/qrcode/${key}/confirm`
      : `/api/channel-plugins/${type}/qrcode/${key}/confirm`
    const res = await apiFetch(url, 'POST')
    const data = res.data
    const s = actionState.value[key]
    if (!s) return
    s.status = data?.status
    if (data?.status === 'confirmed') {
      s.qrUrl = undefined
      if (data.credentials) {
        form.value.config[key] = data.credentials
        if (channelId) {
          const c = store.settings.channels?.[channelId]
          if (c) {
            if (!c.config) c.config = {}
            c.config[key] = data.credentials
          }
        }
      }
      show('登录成功，请记得保存')
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
  const defaultType = plugins.value.find(p => !p.builtin)?.type || ''
  form.value = { name: '', type: defaultType, config: {}, agent: '', saver: '', memories: [], wikis: [], workPath: '', streamVerbose: false, autoApproveAllTools: false, intentModel: '', intentPrompt: '', intentThreshold: 0.7, mergeWindow: 0 }
  showModal.value = true
}

function openEdit(id: string) {
  const c = channels.value[id]
  editingId.value = id
  clearActionState()
  form.value = { name: c.name, type: c.type, config: { ...c.config }, agent: c.agent, saver: c.saver, memories: c.memories || [], wikis: (c as any).wikis || [], workPath: c.workPath || '', streamVerbose: !!c.streamVerbose, autoApproveAllTools: !!c.autoApproveAllTools, intentModel: c.intentModel || '', intentPrompt: c.intentPrompt || '', intentThreshold: c.intentThreshold ?? 0.7, mergeWindow: c.mergeWindow || 0 }
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
      mergeWindow: form.value.mergeWindow || undefined,
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

function isBuiltin(id: string): boolean {
  const c = channels.value[id]
  if (!c) return false
  return plugins.value.some(p => p.type === c.type && p.builtin)
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
      <div v-if="!isMobile" class="channel-cards">
        <div v-if="Object.keys(channels).length === 0" class="detail-empty">{{ t('channels.empty') }}</div>
        <div v-for="(c, id) in channels" :key="id" class="channel-card" :class="{ expanded: expandedChannels[id as string] }">
          <!-- Card header -->
          <div class="channel-card-header" @click="toggleExpand(id as string)">
            <div class="channel-card-left">
              <span class="channel-expand-icon">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
              <span class="channel-card-name">{{ c.name }}</span>
              <span class="channel-card-type-badge">{{ plugins.find(p => p.type === c.type)?.label || c.type }}</span>
            </div>
            <div class="channel-card-right" @click.stop>
              <span class="channel-card-agent">{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</span>
              <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
              <button v-if="!isBuiltin(id as string)" class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
            </div>
          </div>
          <!-- Card meta -->
          <div class="channel-card-meta">
            <span class="session-meta-id">{{ id }}</span>
            <span class="session-meta-chip">{{ t('common.storage') }}: {{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</span>
            <span class="session-meta-chip" :class="Array.isArray(c.memories) && c.memories.length ? '' : 'muted'">{{ t('common.memory') }}: {{ Array.isArray(c.memories) && c.memories.length ? c.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="Array.isArray((c as any).wikis) && (c as any).wikis.length ? '' : 'muted'">{{ t('common.wiki') }}: {{ Array.isArray((c as any).wikis) && (c as any).wikis.length ? (c as any).wikis.map((wid: string) => wikiOptions.find(w => w.id === wid)?.label || wid).join(', ') : t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="c.workPath ? 'blue' : 'muted'">{{ t('directory.path_label') }}: {{ c.workPath || t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="c.streamVerbose ? 'green' : 'muted'">{{ t('channels.stream_verbose') }}: {{ c.streamVerbose ? t('common.enabled') : t('common.disabled') }}</span>
            <span class="session-meta-chip" :class="c.autoApproveAllTools ? 'orange' : 'muted'">{{ t('settings.auto_approve_all') }}: {{ c.autoApproveAllTools ? t('common.enabled') : t('common.disabled') }}</span>
            <span class="session-meta-chip" :class="c.intentModel ? '' : 'muted'">{{ t('channels.intent_model') }}: {{ c.intentModel ? (modelOptions.find(m => m.id === c.intentModel)?.label || c.intentModel) : t('common.not_configured') }}</span>
          </div>
          <!-- Expanded content -->
          <div v-if="expandedChannels[id as string]" class="channel-card-detail">
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
            <div class="detail-tab-content">
              <div v-if="channelLoading[id as string]" class="detail-empty">{{ t('common.loading') }}</div>
              <template v-else>
                <!-- Sessions tab -->
                <template v-if="getChannelTab(id as string) === 'sessions'">
                  <div v-if="(sessionMap[id as string] || []).length === 0" class="detail-empty">{{ t('channels.no_sessions') }}</div>
                  <div v-else class="session-list">
                    <div v-for="s in sessionMap[id as string] || []" :key="s.id" class="session-item">
                      <div class="session-item-header">
                        <div class="session-item-left">
                          <img v-if="s.avatar" :src="s.avatar" class="session-avatar" />
                          <span class="session-item-name">{{ s.sessionName || s.sessionId }}</span>
                          <span v-if="agentOptions.find(a => a.id === s.agentId)" class="session-item-agent">{{ agentOptions.find(a => a.id === s.agentId)?.label }}</span>
                          <span v-if="s.totalTokens > 0" class="session-item-tokens" :title="`${t('usage.total')}: ${formatTokens(s.totalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.inputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.outputTokens)}` + (s.lastTotalTokens > 0 ? `\n${t('usage.last')}: ${formatTokens(s.lastTotalTokens)} tokens` : '')">{{ formatTokens(s.totalTokens) }} tok</span>
                        </div>
                        <div class="ops-cell">
                          <button v-if="s.saver || c.saver" class="btn-outline btn-sm" @click="saverViewModal?.openByDbId(s.id, saverOptions.find(o => o.id === (s.saver || c.saver))?.label || (s.saver || c.saver))">{{ t('channels.history') }}</button>
                          <button class="btn-outline btn-sm" @click="openEditSession(s)">{{ t('common.edit') }}</button>
                          <button class="btn-danger btn-sm" @click="removeSession(id as string, s)">{{ t('common.delete') }}</button>
                        </div>
                      </div>
                      <div class="session-meta">
                        <span class="session-meta-id">{{ s.sessionId }}</span>
                        <span v-if="Array.isArray(s.memories) && s.memories.length" class="session-meta-chip">{{ t('common.memory') }}: {{ s.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') }}</span>
                        <span v-if="s.useChannelMemories" class="session-meta-chip green">{{ t('channels.use_channel_memories') }}</span>
                        <span v-if="s.useChannelWikis" class="session-meta-chip green">{{ t('channels.use_channel_wikis') }}</span>
                        <span v-if="s.workPath" class="session-meta-chip">{{ t('directory.path_label') }}: {{ s.workPath }}</span>
                        <span class="session-meta-chip" :class="s.streamVerbose === true ? 'green' : 'muted'">{{ t('channels.stream_verbose') }}: {{ s.streamVerbose === true ? t('common.enabled') : s.streamVerbose === false ? t('common.disabled') : t('channels.use_channel_default') }}</span>
                        <span class="session-meta-chip" :class="s.autoApproveAllTools === true ? 'orange' : 'muted'">{{ t('settings.auto_approve_all') }}: {{ s.autoApproveAllTools === true ? t('common.enabled') : s.autoApproveAllTools === false ? t('common.disabled') : t('channels.use_channel_default') }}</span>
                        <span v-if="s.intentModel" class="session-meta-chip">{{ t('channels.intent_model') }}: {{ modelOptions.find(m => m.id === s.intentModel)?.label || s.intentModel }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <!-- Users tab -->
                <template v-if="getChannelTab(id as string) === 'users'">
                  <div v-if="(userMap[id as string] || []).length === 0" class="detail-empty">{{ t('channels.no_users') }}</div>
                  <div v-else class="session-list">
                    <div v-for="u in userMap[id as string] || []" :key="u.id" class="session-item">
                      <div class="session-item-header">
                        <div class="session-item-left">
                          <img v-if="u.avatar" :src="u.avatar" class="session-avatar" />
                          <span class="session-item-name">{{ u.userName || '-' }}</span>
                          <span class="session-meta-id">{{ u.userId }}</span>
                        </div>
                        <div class="ops-cell">
                          <button class="btn-outline btn-sm" @click="viewUser = u">{{ t('common.view') }}</button>
                          <button class="btn-danger btn-sm" @click="removeUser(id as string, u)">{{ t('common.delete') }}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-for="(c, id) in channels" :key="id" class="mobile-card">
          <div class="mobile-card-header" @click="toggleExpand(id as string)" style="display:flex;justify-content:space-between;cursor:pointer">
            <span>{{ c.name }}</span>
            <span style="font-size:10px">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.type') }}</span>
            <span class="mobile-card-value">{{ plugins.find(p => p.type === c.type)?.label || c.type }}</span>
            <span class="mobile-card-label">{{ t('common.agent') }}</span>
            <span class="mobile-card-value">{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</span>
            <span class="mobile-card-label">{{ t('common.storage') }}</span>
            <span class="mobile-card-value">{{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</span>
            <span class="mobile-card-label">{{ t('common.memory') }}</span>
            <span class="mobile-card-value">{{ Array.isArray(c.memories) && c.memories.length ? c.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="openEdit(id as string)">{{ t('common.edit') }}</button>
            <button v-if="!isBuiltin(id as string)" class="btn-danger btn-sm" @click="remove(id as string)">{{ t('common.delete') }}</button>
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

    <Transition name="drawer-fade">
      <div v-if="showModal" class="drawer-overlay" @click.self="showModal = false"></div>
    </Transition>
    <Transition name="drawer-slide">
      <div v-if="showModal" class="drawer-panel">
        <div class="drawer-header">
          <h3>{{ editingId ? t('channels.edit_title') : t('channels.add_title') }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="drawer-body">
          <!-- ── 基本信息 ── -->
          <h4 class="section-title">{{ t('channels.section_basic') }}</h4>
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
              <option v-for="p in plugins.filter(p => !p.builtin || editingId)" :key="p.type" :value="p.type">{{ p.label }}</option>
            </select>
          </div>
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

          <!-- ── 插件配置 ── -->
          <template v-if="Object.keys(currentSchema).length > 0">
            <h4 class="section-title">{{ t('channels.section_plugin') }}</h4>
            <template v-for="(field, key) in currentSchema" :key="key">
              <div v-if="field.type === 'qrcode'" class="form-group">
                <label>{{ field.label }}</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                  <button class="btn-outline" style="align-self:flex-start" :disabled="actionState[key]?.loading" @click="triggerAction(key as string)">
                    {{ actionState[key]?.loading ? '...' : field.label }}
                  </button>
                  <img v-if="actionState[key]?.qrUrl" :src="actionState[key]!.qrUrl" style="width:200px;height:200px;border:1px solid #e8e6e3;border-radius:8px" />
                  <a v-if="actionState[key]?.qrLink" :href="actionState[key]!.qrLink" target="_blank" style="font-size:11px;color:#888;align-self:flex-start">打开二维码链接</a>
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
          </template>

          <!-- ── 资源配置 ── -->
          <h4 class="section-title">{{ t('channels.section_resources') }}</h4>
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

          <!-- ── 高级设置 ── -->
          <h4 class="section-title">{{ t('channels.section_advanced') }}</h4>
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
          <div class="form-group">
            <label>{{ t('channels.merge_window') }}</label>
            <input v-model.number="form.mergeWindow" type="number" min="0" step="100" placeholder="0" />
            <span style="font-size:11px;color:#888">{{ t('channels.merge_window_hint') }}</span>
          </div>
        </div>
        <div class="drawer-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </Transition>

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
/* ── Channel cards ── */
.channel-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.channel-card {
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  transition: box-shadow 0.15s;
}
.channel-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.channel-card.expanded {
  border-color: #d1d0ce;
}
.channel-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  gap: 12px;
}
.channel-card-header:hover {
  background: #fafaf9;
}
.channel-card-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.channel-expand-icon {
  color: #6b6b6b;
  font-size: 10px;
  flex-shrink: 0;
}
.channel-card-name {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channel-card-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f1f5f9;
  color: #475569;
  white-space: nowrap;
  flex-shrink: 0;
}
.channel-card-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.channel-card-agent {
  font-size: 12px;
  color: #6b7280;
  margin-right: 4px;
}
.channel-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 0 16px 12px 38px;
  font-size: 11px;
}
.channel-card-detail {
  border-top: 1px solid #e8e6e3;
}
/* ── Session list (inside expanded card) ── */
.session-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.session-item {
  padding: 10px 0;
  border-bottom: 1px solid #f0eeeb;
}
.session-item:last-child {
  border-bottom: none;
}
.session-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.session-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.session-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #2d2d2d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}
.session-item-agent {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
}
.session-item-tokens {
  font-family: monospace;
  font-size: 11px;
  color: #9b9b9b;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.session-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 11px;
  margin-top: 6px;
  padding-left: 36px;
}
.session-meta-id {
  font-family: monospace;
  color: #b0b0b0;
}
.session-meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 9px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-meta-chip.blue {
  background: #eff6ff;
  color: #2563eb;
}
.session-meta-chip.green {
  background: #ecfdf5;
  color: #16a34a;
}
.session-meta-chip.orange {
  background: #fff7ed;
  color: #c2410c;
}
.session-meta-chip.muted {
  background: #f8fafc;
  color: #94a3b8;
}
/* ── Drawer ── */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 999;
}
.drawer-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 560px;
  max-width: 100vw;
  background: #fff;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.drawer-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: #1c1c1c;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 20px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0eeeb;
}
.section-title:first-child {
  margin-top: 0;
}
/* ── Drawer transitions ── */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.3s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.3s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
