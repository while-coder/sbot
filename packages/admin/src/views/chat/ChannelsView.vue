<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '@/composables/useResponsive'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SModal, SInput, STextarea, SSelect, SFormItem, SFormSection, SPageToolbar, SPageContent, SMultiSelect } from 'sbot-ui'
import QRCode from 'qrcode'
import { ApprovalTimeoutValue, type ChannelConfig } from '@/shared/types'
import SaverViewModal from '@/components/modals/SaverViewModal.vue'
import TodoListModal from '@/components/modals/TodoListModal.vue'
import { PathPickerModal, WebSocketTransport } from '@sbot/chat-ui'
import SessionConfigOverridesEditor, { type SessionOverrides, type ConfigSource } from '@/components/SessionConfigOverridesEditor.vue'

const { t } = useI18n()
const { isMobile } = useResponsive()
const { confirm } = useConfirm()

interface PluginInfo {
  type: string
  label: string
  builtin: boolean
  configSchema: Record<string, { label: string; type: string; required?: boolean; description?: string; default?: string | boolean | number; options?: Array<{ label: string; value: string }> }>
  tools?: { name: string; label: string }[]
}

interface ChannelSessionRow {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
  autoSessionName: string
  avatar: string
  profileId: number
  createdAt: number
}

interface ProfileOption {
  id: number
  name: string
  autoForSessionId: number | null
  sessionCount?: number
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

const pickerTransport = new WebSocketTransport()
const pickerLabels = computed(() => ({
  selectDirTitle: t('directory.select_dir_title'),
  myComputer: t('directory.my_computer'),
  upDir: t('directory.up_dir'),
  newFolder: t('directory.new_folder'),
  newFolderPlaceholder: t('directory.new_folder_placeholder'),
  selectThis: t('directory.select_this'),
  noSubdirs: t('directory.no_subdirs'),
  loading: t('common.loading'),
  cancel: t('common.cancel'),
}))

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

const currentToolOptions = computed(() => {
  const p = plugins.value.find(p => p.type === form.value.type)
  return (p?.tools ?? []).map(t => ({ id: t.name, label: t.label }))
})

const channels = computed(() => store.settings.channels || {})
const agentOptions  = computed(() => Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name  || id, type: (a as any).type || '' })))
const saverOptions  = computed(() => Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name  || id })))
const memoryOptions = computed(() => Object.entries(store.settings.memories  || {}).map(([id, m]) => ({ id, label: m.name  || id })))
const wikiOptions   = computed(() => Object.entries(store.settings.wikis    || {}).map(([id, w]) => ({ id, label: (w as any).name  || id })))
const modelOptions  = computed(() => Object.entries(store.settings.models   || {}).map(([id, m]) => ({ id, label: (m as any).name  || id })))

const saverViewModal = ref<InstanceType<typeof SaverViewModal>>()
const todoListModal  = ref<InstanceType<typeof TodoListModal>>()
const pathPicker     = ref<InstanceType<typeof PathPickerModal>>()

const expandedChannels  = ref<Record<string, boolean>>({})
const channelTabs       = ref<Record<string, 'sessions' | 'users'>>({})

function getChannelTab(id: string): 'sessions' | 'users' { return channelTabs.value[id] ?? 'sessions' }
function setChannelTab(id: string, tab: 'sessions' | 'users') { channelTabs.value[id] = tab }
const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
const userMap          = ref<Record<string, UserRow[]>>({})
const channelLoading   = ref<Record<string, boolean>>({})
const viewUser         = ref<UserRow | null>(null)

const editingSession = ref<ChannelSessionRow | null>(null)

interface ProfileFull extends ProfileOption {
  agentId?: string | null
  saver?: string | null
  memories?: string | null
  wikis?: string | null
  useChannelMemories?: boolean | null
  useChannelWikis?: boolean | null
  workPath?: string | null
  streamVerbose?: boolean | null
  autoApproveAllTools?: boolean | null
  approvalTimeout?: number | null
  approvalTimeoutValue?: ApprovalTimeoutValue | null
  askTimeout?: number | null
  askTimeoutMessage?: string | null
  intentModel?: string | null
  intentPrompt?: string | null
  intentThreshold?: number | null
}

const editingProfile = ref<ProfileFull | null>(null)
const visibleProfiles = ref<ProfileOption[]>([])
const effectiveSources = ref<Partial<Record<keyof SessionOverrides, ConfigSource>>>({})
const effectiveResolved = ref<Partial<Record<keyof SessionOverrides, any>>>({})

const sessionForm = ref<{ name: string; overrides: SessionOverrides }>({
  name: '',
  overrides: emptyOverrides(),
})

function emptyOverrides(): SessionOverrides {
  return {
    agentId: null, saver: null, memories: null, wikis: null,
    useChannelMemories: null, useChannelWikis: null,
    workPath: null, streamVerbose: null, autoApproveAllTools: null,
    approvalTimeout: null, approvalTimeoutValue: null,
    askTimeout: null, askTimeoutMessage: null,
    intentModel: null, intentPrompt: null, intentThreshold: null,
  }
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

function profileToOverrides(p: ProfileFull): SessionOverrides {
  const toTriBool = (v: any): boolean | null => v == null ? null : !!v
  return {
    agentId: p.agentId ?? null,
    saver: p.saver ?? null,
    memories: p.memories == null ? null : parseList(p.memories),
    wikis: p.wikis == null ? null : parseList(p.wikis),
    useChannelMemories: toTriBool(p.useChannelMemories),
    useChannelWikis: toTriBool(p.useChannelWikis),
    workPath: p.workPath ?? null,
    streamVerbose: toTriBool(p.streamVerbose),
    autoApproveAllTools: toTriBool(p.autoApproveAllTools),
    approvalTimeout: p.approvalTimeout ?? null,
    approvalTimeoutValue: p.approvalTimeoutValue ?? null,
    askTimeout: p.askTimeout ?? null,
    askTimeoutMessage: p.askTimeoutMessage ?? null,
    intentModel: p.intentModel ?? null,
    intentPrompt: p.intentPrompt ?? null,
    intentThreshold: p.intentThreshold ?? null,
  }
}

const isCurrentProfileShared = computed(() => {
  const p = editingProfile.value
  return !!p && p.autoForSessionId == null && (p.sessionCount ?? 1) > 1
})
const isCurrentProfileAuto = computed(() => !!editingProfile.value?.autoForSessionId)

async function loadVisibleProfiles() {
  try {
    const res = await apiFetch('/api/session-profiles')
    visibleProfiles.value = (res.data || []) as ProfileOption[]
  } catch { visibleProfiles.value = [] }
}

async function loadProfileFull(profileId: number): Promise<ProfileFull | null> {
  try {
    const res = await apiFetch(`/api/session-profiles/${profileId}`)
    return res.data as ProfileFull
  } catch { return null }
}

async function loadEffective(sessionId: number) {
  try {
    const res = await apiFetch(`/api/channel-sessions/${sessionId}/effective-config`)
    const d = res.data as any
    effectiveResolved.value = d?.resolved ?? {}
    effectiveSources.value = d?.sources ?? {}
    return d
  } catch {
    effectiveResolved.value = {}
    effectiveSources.value = {}
    return null
  }
}

async function openEditSession(s: ChannelSessionRow) {
  editingSession.value = s
  sessionForm.value = { name: s.sessionName || '', overrides: emptyOverrides() }
  await loadVisibleProfiles()
  const eff = await loadEffective(s.id)
  if (eff?.profile) {
    // 用 GET /api/session-profiles/:id 拿 sessionCount，方便共享提示
    const pid = (eff.profile as any).id
    const full = await loadProfileFull(pid)
    if (full) {
      // 计算 sessionCount（visibleProfiles 不含 auto profile，对共享 visible 才有 sessionCount）
      const vp = visibleProfiles.value.find(v => v.id === pid)
      full.sessionCount = vp?.sessionCount ?? ((full as any).sessions?.length ?? 1)
      editingProfile.value = full
      sessionForm.value.overrides = profileToOverrides(full)
    } else {
      editingProfile.value = null
    }
  }
}

async function selectProfile(targetId: number | 'default') {
  const s = editingSession.value
  if (!s) return
  try {
    if (targetId === 'default') {
      await apiFetch(`/api/channel-sessions/${s.id}/detach-profile`, 'POST', {})
      show(t('channels.profile_detach_done'))
    } else {
      await apiFetch(`/api/channel-sessions/${s.id}`, 'PUT', { profileId: targetId })
    }
    await openEditSession(s)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function cloneProfileFromCurrent() {
  const s = editingSession.value
  if (!s) return
  try {
    const name = `${s.sessionName || s.sessionId}-profile`
    await apiFetch(`/api/channel-sessions/${s.id}/clone-profile`, 'POST', { name })
    show(t('channels.profile_clone_done'))
    await openEditSession(s)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function saveSession() {
  const s = editingSession.value
  const p = editingProfile.value
  if (!s || !p) return

  // 共享 profile 编辑警告
  if (isCurrentProfileShared.value) {
    const ok = await confirm(t('channels.profile_shared_warn', { n: p.sessionCount }), { danger: true })
    if (!ok) return
  }

  const validMemIds = new Set(memoryOptions.value.map(m => m.id))
  const validWikiIds = new Set(wikiOptions.value.map(w => w.id))
  const o = sessionForm.value.overrides
  const profilePayload = {
    agentId: o.agentId,
    saver: o.saver,
    memories: o.memories == null ? null : o.memories.filter(id => validMemIds.has(id)),
    wikis: o.wikis == null ? null : o.wikis.filter(id => validWikiIds.has(id)),
    useChannelMemories: o.useChannelMemories,
    useChannelWikis: o.useChannelWikis,
    workPath: o.workPath,
    streamVerbose: o.streamVerbose,
    autoApproveAllTools: o.autoApproveAllTools,
    approvalTimeout: o.approvalTimeout,
    approvalTimeoutValue: o.approvalTimeoutValue,
    askTimeout: o.askTimeout,
    askTimeoutMessage: o.askTimeoutMessage,
    intentModel: o.intentModel,
    intentPrompt: o.intentModel == null ? null : o.intentPrompt,
    intentThreshold: o.intentModel == null ? null : o.intentThreshold,
  }

  try {
    // session 自身只能改 sessionName / avatar
    await apiFetch(`/api/channel-sessions/${s.id}`, 'PUT', { sessionName: sessionForm.value.name.trim() })
    // 配置字段写到 profile
    await apiFetch(`/api/session-profiles/${p.id}`, 'PUT', profilePayload)
    s.sessionName = sessionForm.value.name.trim()
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
  approvalTimeout: 0, approvalTimeoutValue: ApprovalTimeoutValue.Deny,
  askTimeout: 0, askTimeoutMessage: '',
  intentModel: '', intentPrompt: '', intentThreshold: 0.7,
  mergeWindow: 0,
})
type ToolMode = 'default' | 'whitelist' | 'block'
const formTools = ref<string[]>([])
const formHeartbeatTools = ref<string[]>([])
const formToolsMode = ref<ToolMode>('default')
const formHeartbeatToolsMode = ref<ToolMode>('default')

function toolsToMode(arr: string[] | undefined): ToolMode {
  if (arr === undefined) return 'default'
  if (arr.length === 0) return 'block'
  return 'whitelist'
}
function modeToTools(mode: ToolMode, arr: string[]): string[] | undefined {
  if (mode === 'default') return undefined
  if (mode === 'block') return []
  return arr
}

async function loadChannelData(id: string) {
  channelLoading.value[id] = true
  try {
    const [sessRes, userRes] = await Promise.all([
      apiFetch(`/api/channel-sessions?channelId=${encodeURIComponent(id)}`),
      apiFetch(`/api/channel-users?channelId=${encodeURIComponent(id)}`),
    ])
    sessionMap.value[id] = (sessRes.data || []).map((s: any) => ({
      ...s, memories: s.memories || [], useChannelMemories: !!s.useChannelMemories, useChannelWikis: !!s.useChannelWikis,
      streamVerbose: s.streamVerbose == null ? null : !!s.streamVerbose,
      autoApproveAllTools: s.autoApproveAllTools == null ? null : !!s.autoApproveAllTools,
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
  if (!await confirm(t('channels.confirm_delete_session', { name: session.sessionId }), { danger: true })) return
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
  if (!await confirm(t('users.confirm_delete', { name: user.userName || user.userId }), { danger: true })) return
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
  form.value = { name: '', type: defaultType, config: {}, agent: '', saver: '', memories: [], wikis: [], workPath: '', streamVerbose: false, autoApproveAllTools: false, approvalTimeout: 0, approvalTimeoutValue: ApprovalTimeoutValue.Deny, askTimeout: 0, askTimeoutMessage: '', intentModel: '', intentPrompt: '', intentThreshold: 0.7, mergeWindow: 0 }
  formTools.value = []
  formHeartbeatTools.value = []
  formToolsMode.value = 'default'
  formHeartbeatToolsMode.value = 'default'
  showModal.value = true
}

function openEdit(id: string) {
  const c = channels.value[id]
  editingId.value = id
  clearActionState()
  form.value = { name: c.name, type: c.type, config: { ...c.config }, agent: c.agent, saver: c.saver, memories: c.memories || [], wikis: (c as any).wikis || [], workPath: c.workPath || '', streamVerbose: !!c.streamVerbose, autoApproveAllTools: !!c.autoApproveAllTools, approvalTimeout: c.approvalTimeout ?? 0, approvalTimeoutValue: c.approvalTimeoutValue ?? ApprovalTimeoutValue.Deny, askTimeout: c.askTimeout ?? 0, askTimeoutMessage: c.askTimeoutMessage || '', intentModel: c.intentModel || '', intentPrompt: c.intentPrompt || '', intentThreshold: c.intentThreshold ?? 0.7, mergeWindow: c.mergeWindow || 0 }
  formTools.value = [...(c.tools ?? [])]
  formHeartbeatTools.value = [...(c.heartbeatTools ?? [])]
  formToolsMode.value = toolsToMode(c.tools)
  formHeartbeatToolsMode.value = toolsToMode(c.heartbeatTools)
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  if (!form.value.agent) { show(t('channels.select_agent'), 'error'); return }
  if (!form.value.saver) { show(t('channels.select_saver'), 'error'); return }
  if (formToolsMode.value === 'whitelist' && formTools.value.length === 0) { show(t('channels.tools_whitelist_empty'), 'error'); return }
  if (formHeartbeatToolsMode.value === 'whitelist' && formHeartbeatTools.value.length === 0) { show(t('channels.tools_whitelist_empty'), 'error'); return }
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
      approvalTimeout: form.value.approvalTimeout && form.value.approvalTimeout > 0 ? form.value.approvalTimeout : undefined,
      approvalTimeoutValue: form.value.approvalTimeout && form.value.approvalTimeout > 0 ? form.value.approvalTimeoutValue : undefined,
      askTimeout: form.value.askTimeout && form.value.askTimeout > 0 ? form.value.askTimeout : undefined,
      askTimeoutMessage: form.value.askTimeoutMessage?.trim() || undefined,
      intentModel: form.value.intentModel || undefined,
      intentPrompt: form.value.intentPrompt?.trim() || undefined,
      intentThreshold: form.value.intentModel ? form.value.intentThreshold : undefined,
      mergeWindow: form.value.mergeWindow || undefined,
      tools: modeToTools(formToolsMode.value, formTools.value),
      heartbeatTools: modeToTools(formHeartbeatToolsMode.value, formHeartbeatTools.value),
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
  if (!await confirm(t('channels.confirm_delete', { name: label }), { danger: true })) return
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
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('channels.add') }}</SButton>
    </SPageToolbar>

    <SPageContent>
      <div v-if="!isMobile" class="channel-cards">
        <div v-if="Object.keys(channels).length === 0" class="detail-empty">{{ t('channels.empty') }}</div>
        <div v-for="(c, id) in channels" :key="id" class="channel-card" :class="{ expanded: expandedChannels[id as string] }">
          <div class="channel-card-header" @click="toggleExpand(id as string)">
            <div class="channel-card-left">
              <span class="channel-expand-icon">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
              <span class="channel-card-name">{{ c.name }}</span>
              <span class="channel-card-type-badge">{{ plugins.find(p => p.type === c.type)?.label || c.type }}</span>
            </div>
            <div class="channel-card-right" @click.stop>
              <span class="channel-card-agent">{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</span>
              <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
              <SButton v-if="!isBuiltin(id as string)" type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
            </div>
          </div>
          <div class="channel-card-meta">
            <span class="session-meta-id">{{ id }}</span>
            <span class="session-meta-chip">{{ t('common.storage') }}: {{ c.saver ? (saverOptions.find(s => s.id === c.saver)?.label || c.saver) : '-' }}</span>
            <span class="session-meta-chip" :class="Array.isArray(c.memories) && c.memories.length ? '' : 'muted'">{{ t('common.memory') }}: {{ Array.isArray(c.memories) && c.memories.length ? c.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="Array.isArray((c as any).wikis) && (c as any).wikis.length ? '' : 'muted'">{{ t('common.wiki') }}: {{ Array.isArray((c as any).wikis) && (c as any).wikis.length ? (c as any).wikis.map((wid: string) => wikiOptions.find(w => w.id === wid)?.label || wid).join(', ') : t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="c.workPath ? 'blue' : 'muted'">{{ t('directory.path_label') }}: {{ c.workPath || t('common.not_configured') }}</span>
            <span class="session-meta-chip" :class="c.streamVerbose ? 'green' : 'muted'">{{ t('channels.stream_verbose') }}: {{ c.streamVerbose ? t('common.enabled') : t('common.disabled') }}</span>
            <span class="session-meta-chip" :class="c.autoApproveAllTools ? 'orange' : 'muted'">{{ t('settings.auto_approve_all') }}: {{ c.autoApproveAllTools ? t('common.enabled') : t('common.disabled') }}</span>
            <span class="session-meta-chip" :class="c.intentModel ? '' : 'muted'">{{ t('channels.intent_model') }}: {{ c.intentModel ? (modelOptions.find(m => m.id === c.intentModel)?.label || c.intentModel) : t('common.not_configured') }}</span>
            <span v-if="c.tools !== undefined" class="session-meta-chip" :class="c.tools.length ? '' : 'orange'">{{ t('channels.tools') }}: {{ c.tools.length ? c.tools.map(n => plugins.find(p => p.type === c.type)?.tools?.find(t => t.name === n)?.label || n).join(', ') : t('channels.tools_blocked') }}</span>
            <span v-if="c.heartbeatTools !== undefined" class="session-meta-chip" :class="c.heartbeatTools.length ? '' : 'orange'">{{ t('channels.heartbeat_tools') }}: {{ c.heartbeatTools.length ? c.heartbeatTools.map(n => plugins.find(p => p.type === c.type)?.tools?.find(t => t.name === n)?.label || n).join(', ') : t('channels.tools_blocked') }}</span>
          </div>
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
                <template v-if="getChannelTab(id as string) === 'sessions'">
                  <div v-if="(sessionMap[id as string] || []).length === 0" class="detail-empty">{{ t('channels.no_sessions') }}</div>
                  <div v-else class="session-list">
                    <div v-for="s in sessionMap[id as string] || []" :key="s.id" class="session-item">
                      <div class="session-item-header">
                        <div class="session-item-left">
                          <img v-if="s.avatar" :src="s.avatar" class="session-avatar" />
                          <span class="session-item-name">{{ s.sessionName || s.autoSessionName || s.sessionId }}</span>
                          <span v-if="agentOptions.find(a => a.id === s.agentId)" class="session-item-agent">{{ agentOptions.find(a => a.id === s.agentId)?.label }}</span>
                          <span v-if="s.totalTokens > 0" class="session-item-tokens" :title="`${t('usage.total')}: ${formatTokens(s.totalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.inputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.outputTokens)}` + (s.lastTotalTokens > 0 ? `\n${t('usage.last')}: ${formatTokens(s.lastTotalTokens)} tokens` : '')">{{ formatTokens(s.totalTokens) }} tok</span>
                        </div>
                        <div class="ops-cell">
                          <SButton v-if="s.saver || c.saver" type="outline" size="sm" @click="saverViewModal?.openByDbId(s.id, saverOptions.find(o => o.id === (s.saver || c.saver))?.label || (s.saver || c.saver))">{{ t('channels.history') }}</SButton>
                          <SButton type="outline" size="sm" @click="todoListModal?.open(s.id, s.sessionName || s.autoSessionName || s.sessionId)">{{ t('todo.title') }}</SButton>
                          <SButton type="outline" size="sm" @click="openEditSession(s)">{{ t('common.edit') }}</SButton>
                          <SButton type="danger" size="sm" @click="removeSession(id as string, s)">{{ t('common.delete') }}</SButton>
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
                          <SButton type="outline" size="sm" @click="viewUser = u">{{ t('common.view') }}</SButton>
                          <SButton type="danger" size="sm" @click="removeUser(id as string, u)">{{ t('common.delete') }}</SButton>
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
          <div class="mobile-card-header mobile-card-header-clickable" @click="toggleExpand(id as string)">
            <span>{{ c.name }}</span>
            <span class="mobile-expand-icon">{{ expandedChannels[id as string] ? '▼' : '▶' }}</span>
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
            <SButton type="outline" size="sm" @click="openEdit(id as string)">{{ t('common.edit') }}</SButton>
            <SButton v-if="!isBuiltin(id as string)" type="danger" size="sm" @click="remove(id as string)">{{ t('common.delete') }}</SButton>
          </div>
          <div v-if="expandedChannels[id as string]" class="mobile-detail">
            <div class="detail-tab-bar">
              <button class="detail-tab-btn" :class="{ active: getChannelTab(id as string) === 'sessions' }" @click="setChannelTab(id as string, 'sessions')">{{ t('channels.sessions') }}</button>
              <button class="detail-tab-btn" :class="{ active: getChannelTab(id as string) === 'users' }" @click="setChannelTab(id as string, 'users')">{{ t('channels.users') }}</button>
            </div>
            <div v-if="getChannelTab(id as string) === 'sessions'" class="card-list mobile-sub-list">
              <div v-for="s in (sessionMap[id as string] || [])" :key="s.id" class="mobile-card mobile-sub-card">
                <div class="mobile-card-header mobile-sub-header">
                  <img v-if="s.avatar" :src="s.avatar" class="mobile-sub-avatar" />
                  {{ s.sessionName || s.autoSessionName || s.sessionId }}
                </div>
                <div class="mobile-card-fields">
                  <span class="mobile-card-label">{{ t('common.agent') }}</span>
                  <span class="mobile-card-value">{{ agentOptions.find(a => a.id === s.agentId)?.label || s.agentId || '-' }}</span>
                  <span class="mobile-card-label">{{ t('common.memory') }}</span>
                  <span class="mobile-card-value">{{ Array.isArray(s.memories) && s.memories.length ? s.memories.map(mid => memoryOptions.find(m => m.id === mid)?.label || mid).join(', ') : '-' }}</span>
                  <span class="mobile-card-label">Tokens</span>
                  <span class="mobile-card-value mobile-tokens" :title="s.totalTokens > 0 ? `${t('usage.total')}: ${formatTokens(s.totalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.inputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.outputTokens)}` + (s.lastTotalTokens > 0 ? `\n${t('usage.last')}: ${formatTokens(s.lastTotalTokens)} tokens\n  ${t('usage.input_tokens')}: ${formatTokens(s.lastInputTokens)} / ${t('usage.output_tokens')}: ${formatTokens(s.lastOutputTokens)}` : '') : ''">{{ s.totalTokens > 0 ? formatTokens(s.totalTokens) : '-' }}</span>
                </div>
                <div class="mobile-card-ops">
                  <SButton type="outline" size="sm" @click="todoListModal?.open(s.id, s.sessionName || s.autoSessionName || s.sessionId)">{{ t('todo.title') }}</SButton>
                  <SButton type="outline" size="sm" @click="openEditSession(s)">{{ t('common.edit') }}</SButton>
                  <SButton type="danger" size="sm" @click="removeSession(id as string, s)">{{ t('common.delete') }}</SButton>
                </div>
              </div>
              <div v-if="channelLoading[id as string]" class="mobile-card-empty">{{ t('common.loading') }}</div>
              <div v-else-if="!(sessionMap[id as string] || []).length" class="mobile-card-empty">-</div>
            </div>
            <div v-if="getChannelTab(id as string) === 'users'" class="card-list mobile-sub-list">
              <div v-for="u in (userMap[id as string] || [])" :key="u.id" class="mobile-card mobile-sub-card">
                <div class="mobile-card-header mobile-sub-header">
                  <img v-if="u.avatar" :src="u.avatar" class="mobile-sub-avatar" />
                  {{ u.userName || '-' }}
                </div>
                <div class="mobile-card-ops">
                  <SButton type="outline" size="sm" @click="viewUser = u">{{ t('common.view') }}</SButton>
                  <SButton type="danger" size="sm" @click="removeUser(id as string, u)">{{ t('common.delete') }}</SButton>
                </div>
              </div>
              <div v-if="!(userMap[id as string] || []).length" class="mobile-card-empty">-</div>
            </div>
          </div>
        </div>
        <div v-if="Object.keys(channels).length === 0" class="mobile-card-empty">{{ t('channels.empty') }}</div>
      </div>
    </SPageContent>

    <!-- Channel add/edit drawer (slide-in panel, not a centered modal) -->
    <Transition name="drawer-fade">
      <div v-if="showModal" class="drawer-overlay" @click.self="showModal = false"></div>
    </Transition>
    <Transition name="drawer-slide">
      <div v-if="showModal" class="drawer-panel">
        <div class="drawer-header">
          <h3>{{ editingId ? t('channels.edit_title') : t('channels.add_title') }}</h3>
          <button class="drawer-close" @click="showModal = false">&times;</button>
        </div>
        <div class="drawer-body">
          <SFormSection :title="t('channels.section_basic')">
            <SFormItem v-if="editingId" :label="t('common.id')">
              <SInput :model-value="editingId" disabled class="cell-mono" />
            </SFormItem>
            <SFormItem :label="t('channels.display_name') + ' *'">
              <SInput v-model="form.name" :placeholder="t('channels.display_name_placeholder')" />
            </SFormItem>
            <SFormItem :label="t('channels.channel_type') + ' *'">
              <SSelect v-model="form.type" @change="form.config = {}" :disabled="!!editingId">
                <option v-for="p in plugins.filter(p => !p.builtin || editingId)" :key="p.type" :value="p.type">{{ p.label }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('common.agent') + ' *'">
              <SSelect v-model="form.agent">
                <option value="" disabled>{{ t('channels.select_agent') }}</option>
                <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('common.storage') + ' *'">
              <SSelect v-model="form.saver">
                <option value="" disabled>{{ t('channels.select_saver') }}</option>
                <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
              </SSelect>
            </SFormItem>
          </SFormSection>

          <SFormSection v-if="Object.keys(currentSchema).length > 0" :title="t('channels.section_plugin')">
            <template v-for="(field, key) in currentSchema" :key="key">
              <SFormItem v-if="field.type === 'qrcode'" :label="field.label">
                <div class="qrcode-block">
                  <SButton type="outline" :disabled="actionState[key]?.loading" @click="triggerAction(key as string)">
                    {{ actionState[key]?.loading ? '...' : field.label }}
                  </SButton>
                  <img v-if="actionState[key]?.qrUrl" :src="actionState[key]!.qrUrl" class="qr-img" />
                  <a v-if="actionState[key]?.qrLink" :href="actionState[key]!.qrLink" target="_blank" class="qr-link">打开二维码链接</a>
                  <span v-if="actionState[key]?.status === 'scaned'" class="qr-msg qr-msg-warn">已扫码，请在手机上确认...</span>
                  <span v-if="actionState[key]?.status === 'wait' && actionState[key]?.qrUrl" class="qr-msg qr-msg-muted">请扫描二维码</span>
                  <span v-if="actionState[key]?.status === 'confirmed'" class="qr-msg qr-msg-success">登录成功</span>
                  <span v-if="actionState[key]?.error" class="qr-msg qr-msg-error">{{ actionState[key]!.error }}</span>
                  <span v-if="field.description && !actionState[key]?.qrUrl" class="qr-msg qr-msg-muted">{{ field.description }}</span>
                </div>
              </SFormItem>
              <SFormItem v-else :label="field.label + (field.required ? ' *' : '')" :hint="field.type === 'boolean' ? '' : field.description">
                <SSelect v-if="field.type === 'select'" v-model="form.config[key]">
                  <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </SSelect>
                <label v-else-if="field.type === 'boolean'" class="toggle-label">
                  <input type="checkbox" v-model="form.config[key]" />
                  <span>{{ field.description || '' }}</span>
                </label>
                <SInput v-else-if="field.type === 'number'" type="number" v-model.number="form.config[key]" :placeholder="field.description || ''" />
                <div v-else-if="field.type === 'password'" class="apikey-field">
                  <SInput v-model="form.config[key]" :placeholder="field.description || ''" :type="passwordVisible[key] ? 'text' : 'password'" class="apikey-input" />
                  <button type="button" class="apikey-toggle" @click="passwordVisible[key] = !passwordVisible[key]" :title="passwordVisible[key] ? t('common.hide') : t('common.show')">{{ passwordVisible[key] ? t('common.hide') : t('common.show') }}</button>
                </div>
                <SInput v-else v-model="form.config[key]" :placeholder="field.description || ''" />
              </SFormItem>
            </template>
          </SFormSection>

          <SFormSection :title="t('channels.section_resources')">
            <SFormItem :label="t('common.memory')">
              <SMultiSelect v-model="form.memories" :options="memoryOptions" />
            </SFormItem>
            <SFormItem :label="t('common.wiki')">
              <SMultiSelect :model-value="form.wikis || []" :options="wikiOptions" @update:model-value="form.wikis = $event" />
            </SFormItem>
            <SFormItem :label="t('directory.path_label')">
              <div class="path-row">
                <SInput v-model="form.workPath" type="text" :placeholder="t('directory.path_placeholder')" class="path-input" />
                <SButton type="outline" size="sm" @click="pathPicker?.open(form.workPath || '')">{{ t('directory.browse') }}</SButton>
              </div>
            </SFormItem>
          </SFormSection>

          <SFormSection :title="t('channels.section_advanced')">
            <SFormItem :hint="t('channels.stream_verbose_hint')">
              <label class="toggle-label">
                <input type="checkbox" v-model="form.streamVerbose" />
                <span>{{ t('channels.stream_verbose') }}</span>
              </label>
            </SFormItem>
            <SFormItem :hint="t('settings.auto_approve_all_hint')">
              <label class="toggle-label">
                <input type="checkbox" v-model="form.autoApproveAllTools" />
                <span>{{ t('settings.auto_approve_all') }}</span>
              </label>
            </SFormItem>
            <SFormItem :label="t('channels.intent_model')" :hint="t('channels.intent_model_hint')">
              <SSelect v-model="form.intentModel">
                <option value="">{{ t('common.not_use') }}</option>
                <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
              </SSelect>
            </SFormItem>
            <template v-if="form.intentModel">
              <SFormItem :label="t('channels.intent_threshold')" :hint="t('channels.intent_threshold_hint')">
                <SInput v-model.number="form.intentThreshold" type="number" />
              </SFormItem>
              <SFormItem :label="t('channels.intent_prompt')">
                <STextarea v-model="form.intentPrompt" :rows="4" :placeholder="t('channels.intent_prompt_placeholder')" />
              </SFormItem>
            </template>
            <SFormItem :label="t('channels.approval_timeout')" :hint="t('channels.approval_timeout_hint')">
              <SInput v-model.number="form.approvalTimeout" type="number" placeholder="0" />
            </SFormItem>
            <SFormItem v-if="form.approvalTimeout && form.approvalTimeout > 0" :label="t('channels.approval_timeout_value')">
              <SSelect v-model="form.approvalTimeoutValue">
                <option :value="ApprovalTimeoutValue.Deny">{{ t('channels.approval_timeout_value_deny') }}</option>
                <option :value="ApprovalTimeoutValue.Allow">{{ t('channels.approval_timeout_value_allow') }}</option>
              </SSelect>
            </SFormItem>
            <SFormItem :label="t('channels.ask_timeout')" :hint="t('channels.ask_timeout_hint')">
              <SInput v-model.number="form.askTimeout" type="number" placeholder="0" />
            </SFormItem>
            <SFormItem v-if="form.askTimeout && form.askTimeout > 0" :label="t('channels.ask_timeout_message')" :hint="t('channels.ask_timeout_message_hint')">
              <SInput v-model="form.askTimeoutMessage" type="text" />
            </SFormItem>
            <SFormItem :label="t('channels.merge_window')" :hint="t('channels.merge_window_hint')">
              <SInput v-model.number="form.mergeWindow" type="number" placeholder="0" />
            </SFormItem>
            <template v-if="currentToolOptions.length > 0">
              <SFormItem :label="t('channels.tools')" :hint="t('channels.tools_hint')">
                <SSelect v-model="formToolsMode">
                  <option value="default">{{ t('channels.tools_mode_default') }}</option>
                  <option value="whitelist">{{ t('channels.tools_mode_whitelist') }}</option>
                  <option value="block">{{ t('channels.tools_mode_block') }}</option>
                </SSelect>
                <SMultiSelect v-if="formToolsMode === 'whitelist'" v-model="formTools" :options="currentToolOptions" />
              </SFormItem>
              <SFormItem :label="t('channels.heartbeat_tools')" :hint="t('channels.heartbeat_tools_hint')">
                <SSelect v-model="formHeartbeatToolsMode">
                  <option value="default">{{ t('channels.tools_mode_default') }}</option>
                  <option value="whitelist">{{ t('channels.tools_mode_whitelist') }}</option>
                  <option value="block">{{ t('channels.tools_mode_block') }}</option>
                </SSelect>
                <SMultiSelect v-if="formHeartbeatToolsMode === 'whitelist'" v-model="formHeartbeatTools" :options="currentToolOptions" />
              </SFormItem>
            </template>
          </SFormSection>
        </div>
        <div class="drawer-footer">
          <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
          <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
        </div>
      </div>
    </Transition>

    <!-- Edit session drawer -->
    <Transition name="drawer-fade">
      <div v-if="editingSession" class="drawer-overlay" @click.self="editingSession = null"></div>
    </Transition>
    <Transition name="drawer-slide">
      <div v-if="editingSession" class="drawer-panel">
        <div class="drawer-header">
          <h3>{{ t('channels.edit_session_title', { name: editingSession.sessionId }) }}</h3>
          <button class="drawer-close" @click="editingSession = null">&times;</button>
        </div>
        <div class="drawer-body">
          <SFormItem :label="t('channels.session_id')">
            <SInput :model-value="editingSession.sessionId" disabled class="cell-mono" />
          </SFormItem>
          <SFormItem :label="t('channels.auto_session_name')">
            <SInput :model-value="editingSession.autoSessionName" disabled />
          </SFormItem>
          <SFormItem :label="t('channels.session_name')">
            <SInput v-model="sessionForm.name" :placeholder="t('channels.session_name_placeholder')" />
          </SFormItem>

          <SFormItem :label="t('channels.profile')" :hint="t('channels.profile_hint')">
            <SSelect
              :model-value="isCurrentProfileAuto ? 'default' : String(editingProfile?.id ?? '')"
              @update:model-value="v => selectProfile(v === 'default' ? 'default' : Number(v))"
            >
              <option value="default">{{ t('channels.profile_none') }}</option>
              <option v-for="p in visibleProfiles" :key="p.id" :value="String(p.id)">
                {{ p.name }}{{ p.sessionCount && p.sessionCount > 1 ? ` (${p.sessionCount})` : '' }}
              </option>
            </SSelect>
            <div class="profile-actions">
              <SButton v-if="isCurrentProfileAuto" type="outline" size="sm" @click="cloneProfileFromCurrent">{{ t('channels.profile_clone') }}</SButton>
              <SButton v-else type="outline" size="sm" @click="selectProfile('default')">{{ t('channels.profile_detach') }}</SButton>
            </div>
            <div v-if="isCurrentProfileShared && editingProfile" class="profile-shared-hint">
              ⓘ {{ t('channels.profile_shared_with', { n: (editingProfile.sessionCount ?? 1) - 1 }) }}
            </div>
          </SFormItem>

          <SessionConfigOverridesEditor
            v-model="sessionForm.overrides"
            :sources="effectiveSources"
            :resolved="effectiveResolved"
            :agent-options="agentOptions"
            :saver-options="saverOptions"
            :memory-options="memoryOptions"
            :wiki-options="wikiOptions"
            :model-options="modelOptions"
            @browse-path="pathPicker?.open(sessionForm.overrides.workPath || '')"
          />
        </div>
        <div class="drawer-footer">
          <SButton type="outline" @click="editingSession = null">{{ t('common.cancel') }}</SButton>
          <SButton type="primary" @click="saveSession">{{ t('common.save') }}</SButton>
        </div>
      </div>
    </Transition>

    <!-- View user modal -->
    <SModal :visible="!!viewUser" :title="viewUser ? t('users.detail_title', { name: viewUser.userName || viewUser.userId }) : ''" width="lg" @update:visible="v => { if (!v) viewUser = null }">
      <template v-if="viewUser">
        <SFormItem :label="t('common.id')">
          <SInput :model-value="String(viewUser.id)" disabled />
        </SFormItem>
        <SFormItem :label="t('users.user_id')">
          <SInput :model-value="viewUser.userId" disabled />
        </SFormItem>
        <SFormItem :label="t('users.username')">
          <SInput :model-value="viewUser.userName" disabled />
        </SFormItem>
        <SFormItem :label="t('users.channel')">
          <SInput :model-value="viewUser.channelId" disabled />
        </SFormItem>
        <SFormItem :label="t('users.user_info')">
          <STextarea :model-value="formatUserInfo(viewUser.userInfo)" disabled :rows="16" class="user-info-text" />
        </SFormItem>
      </template>
      <template #footer>
        <SButton type="outline" @click="viewUser = null">{{ t('common.close') }}</SButton>
      </template>
    </SModal>

    <SaverViewModal ref="saverViewModal" />
    <TodoListModal ref="todoListModal" />
    <PathPickerModal
      ref="pathPicker"
      :transport="pickerTransport"
      :labels="pickerLabels"
      @confirm="p => { if (editingSession) sessionForm.overrides.workPath = p; else form.workPath = p }"
      @error="msg => show(msg, 'error')"
    />
  </div>
</template>

<style scoped>
.cell-mono { font-family: var(--sui-font-mono); font-size: var(--sui-fs-xs); }
.profile-actions { display: flex; gap: var(--sui-sp-2); margin-top: var(--sui-sp-2); }
.profile-shared-hint { margin-top: var(--sui-sp-2); font-size: var(--sui-fs-sm); color: var(--sui-fg-muted); }
.user-info-text :deep(textarea) { font-family: var(--sui-font-mono); font-size: var(--sui-fs-sm); }

.apikey-field { display: flex; gap: 0; }
.apikey-input { flex: 1; }
.apikey-input :deep(input) { border-radius: var(--sui-radius-md) 0 0 var(--sui-radius-md); border-right: none; }
.apikey-toggle {
  padding: 0 12px;
  font-size: var(--sui-fs-sm);
  background: var(--sui-bg-hover);
  border: 1px solid var(--sui-border-strong);
  border-radius: 0 var(--sui-radius-md) var(--sui-radius-md) 0;
  cursor: pointer;
  color: var(--sui-fg-muted);
  white-space: nowrap;
  transition: background .15s;
}
.apikey-toggle:hover { background: var(--sui-bg-active); }

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  cursor: pointer;
}
.toggle-mt { margin-top: 4px; }

.path-row { display: flex; gap: var(--sui-sp-2); }
.path-input { flex: 1; }

.qrcode-block { display: flex; flex-direction: column; gap: var(--sui-sp-3); align-items: flex-start; }
.qr-img { width: 200px; height: 200px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-lg); }
.qr-link { font-size: var(--sui-fs-xs); color: var(--sui-fg-muted); }
.qr-msg { font-size: var(--sui-fs-sm); }
.qr-msg-warn { color: var(--sui-warning); }
.qr-msg-muted { color: var(--sui-fg-muted); }
.qr-msg-success { color: var(--sui-success); }
.qr-msg-error { color: var(--sui-danger); }

.session-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

/* Detail tab bar (sub-tabs inside expanded card) */
.detail-tab-bar {
  display: flex;
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg-subtle);
  padding: 0 20px;
}
.detail-tab-btn {
  padding: 9px 14px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--sui-fs-sm);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s;
  color: var(--sui-fg-disabled);
  font-family: inherit;
}
.detail-tab-btn:hover { color: var(--sui-fg); }
.detail-tab-btn.active { color: var(--sui-fg); border-bottom-color: var(--sui-fg); }
.detail-tab-content {
  padding: var(--sui-sp-4) 20px;
  background: var(--sui-bg-subtle);
  max-height: 400px;
  overflow: auto;
}
.detail-empty {
  text-align: center;
  padding: 24px;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}

/* Channel cards */
.channel-cards {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-4);
}
.channel-card {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  background: var(--sui-bg);
  overflow: hidden;
  transition: box-shadow 0.15s;
}
.channel-card:hover { box-shadow: var(--sui-shadow-sm); }
.channel-card.expanded { border-color: var(--sui-border-strong); }
.channel-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sui-sp-4) var(--sui-sp-5);
  cursor: pointer;
  gap: var(--sui-sp-4);
}
.channel-card-header:hover { background: var(--sui-bg-subtle); }
.channel-card-left {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
}
.channel-expand-icon {
  color: var(--sui-fg-muted);
  font-size: 10px;
  flex-shrink: 0;
}
.channel-card-name {
  font-size: var(--sui-fs-lg);
  font-weight: 600;
  color: var(--sui-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channel-card-type-badge {
  font-size: var(--sui-fs-xs);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}
.channel-card-right {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  flex-shrink: 0;
}
.channel-card-agent {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-right: 4px;
}
.channel-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--sui-sp-3);
  padding: 0 var(--sui-sp-5) var(--sui-sp-4) 38px;
  font-size: var(--sui-fs-xs);
}
.channel-card-detail {
  border-top: 1px solid var(--sui-border);
}

/* Session list (inside expanded card) */
.session-list {
  display: flex;
  flex-direction: column;
}
.session-item {
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border);
}
.session-item:last-child { border-bottom: none; }
.session-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-3);
}
.session-item-left {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
}
.session-item-name {
  font-size: var(--sui-fs-md);
  font-weight: 500;
  color: var(--sui-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}
.session-item-agent {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-muted);
  white-space: nowrap;
}
.session-item-tokens {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.session-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--sui-sp-3);
  font-size: var(--sui-fs-xs);
  margin-top: var(--sui-sp-2);
  padding-left: 36px;
}
.session-meta-id {
  font-family: var(--sui-font-mono);
  color: var(--sui-fg-disabled);
}
.session-meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 9px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg-secondary);
  font-size: var(--sui-fs-xs);
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-meta-chip.blue { background: var(--sui-accent-soft); color: var(--sui-on-accent-soft); }
.session-meta-chip.green { background: #ecfdf5; color: #16a34a; }
.session-meta-chip.orange { background: #fff7ed; color: #c2410c; }
.session-meta-chip.muted { background: var(--sui-bg-subtle); color: var(--sui-fg-disabled); }

html[data-theme="dark"] .session-meta-chip.green { background: #14532d; color: #86efac; }
html[data-theme="dark"] .session-meta-chip.orange { background: #431407; color: #fdba74; }

/* Mobile detail */
.mobile-card-header-clickable { display: flex; justify-content: space-between; cursor: pointer; }
.mobile-expand-icon { font-size: 10px; }
.mobile-detail { margin-top: var(--sui-sp-3); }
.mobile-sub-list { margin-top: var(--sui-sp-2); }
.mobile-sub-card { border-color: var(--sui-border); }
.mobile-sub-header {
  font-size: var(--sui-fs-md);
  display: flex;
  align-items: center;
  gap: 4px;
}
.mobile-sub-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}
.mobile-tokens { font-family: var(--sui-font-mono); font-variant-numeric: tabular-nums; }

/* Drawer (slide-in panel for channel add/edit) */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: var(--sui-z-modal);
}
.drawer-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 560px;
  max-width: 100vw;
  background: var(--sui-bg);
  z-index: calc(var(--sui-z-modal) + 1);
  display: flex;
  flex-direction: column;
  box-shadow: var(--sui-shadow-lg);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sui-sp-5) var(--sui-sp-6);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
}
.drawer-header h3 {
  font-size: var(--sui-fs-xl);
  font-weight: 600;
  color: var(--sui-fg);
}
.drawer-close {
  border: none;
  background: none;
  font-size: 22px;
  color: var(--sui-fg-muted);
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}
.drawer-close:hover { color: var(--sui-fg); }
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sui-sp-6);
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-4) var(--sui-sp-6);
  border-top: 1px solid var(--sui-border);
  flex-shrink: 0;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active { transition: opacity 0.3s ease; }
.drawer-fade-enter-from,
.drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.3s ease; }
.drawer-slide-enter-from,
.drawer-slide-leave-to { transform: translateX(100%); }

html[data-theme="dark"] .drawer-overlay { background: rgba(0, 0, 0, 0.55); }
</style>
