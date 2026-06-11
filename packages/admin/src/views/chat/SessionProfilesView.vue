<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, SFormItem, SPageToolbar, SPageContent, STable, SModal } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'
import { ApprovalTimeoutValue } from 'sbot.commons'
import { PathPickerModal, WebSocketTransport } from '@sbot/chat-ui'
import SessionConfigOverridesEditor, { type SessionOverrides } from '@/components/SessionConfigOverridesEditor.vue'

interface ProfileRow {
  id: number
  name: string
  autoForSessionId: number | null
  agentId: string | null
  saver: string | null
  notes: string | null
  wikis: string | null
  useChannelNotes: boolean | null
  useChannelWikis: boolean | null
  workPath: string | null
  streamVerbose: boolean | null
  autoApproveAllTools: boolean | null
  disableWorkspaceContext: boolean | null
  disableWorkspaceSkills: boolean | null
  approvalTimeout: number | null
  approvalTimeoutValue: ApprovalTimeoutValue | null
  askTimeout: number | null
  askTimeoutMessage: string | null
  intentModel: string | null
  intentPrompt: string | null
  intentThreshold: number | null
  insight: string | null
  agenda: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  createdAt: number
  sessionCount?: number
}

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

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
const pathPicker = ref<InstanceType<typeof PathPickerModal>>()

const profiles = ref<ProfileRow[]>([])

interface SessionLite {
  id: number
  channelId: string
  sessionId: string
  sessionName: string
  autoSessionName: string
}
const sessionsModalVisible = ref(false)
const sessionsModalProfile = ref<ProfileRow | null>(null)
const sessionsModalRows = ref<SessionLite[]>([])
const sessionsModalLoading = ref(false)

const channelLabel = (channelId: string): string => {
  const c = (store.settings.channels as Record<string, any> | undefined)?.[channelId]
  return c?.name || channelId
}

async function openSessions(p: ProfileRow) {
  if (!(p.sessionCount ?? 0)) return
  sessionsModalProfile.value = p
  sessionsModalRows.value = []
  sessionsModalVisible.value = true
  sessionsModalLoading.value = true
  try {
    const res = await apiFetch(`/api/session-profiles/${p.id}`)
    sessionsModalRows.value = ((res.data as any)?.sessions || []) as SessionLite[]
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    sessionsModalLoading.value = false
  }
}

const agentOptions = computed(() => Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id, type: (a as any).type || '' })))
const saverOptions = computed(() => Object.entries(store.settings.savers || {}).map(([id, s]) => ({ id, label: (s as any).name || id })))
const noteOptions = computed(() => Object.entries(store.settings.notes || {}).map(([id, n]: [string, any]) => ({ id, label: n.name || id })))
const wikiOptions = computed(() => Object.entries(store.settings.wikis || {}).map(([id, w]) => ({ id, label: (w as any).name || id })))
const modelOptions = computed(() => Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id })))
const insightProfileOptions = computed(() => Object.entries(store.settings.insightProfiles || {}).map(([id, p]) => ({ id, label: (p as any).name || id })))
const agendaProfileOptions  = computed(() => Object.entries(store.settings.agendaProfiles  || {}).map(([id, p]) => ({ id, label: (p as any).name || id })))

async function loadAll() {
  try {
    const res = await apiFetch('/api/session-profiles')
    profiles.value = (res.data || []) as ProfileRow[]
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(loadAll)

const columns = computed<STableColumn[]>(() => [
  { key: 'name',         label: t('session_profiles.name'), primary: true },
  { key: 'agent',        label: t('common.agent') },
  { key: 'saver',        label: t('common.storage') },
  { key: 'sessionCount', label: '#' },
  { key: 'ops',          label: t('common.ops'), ops: true },
])

const editing = ref<ProfileRow | null>(null)
const isCreating = ref(false)

interface ProfileForm {
  name: string
  overrides: SessionOverrides
}

function emptyOverrides(): SessionOverrides {
  return {
    agentId: null, saver: null, notes: null, wikis: null,
    useChannelNotes: null, useChannelWikis: null,
    workPath: null, streamVerbose: null, autoApproveAllTools: null,
    disableWorkspaceContext: null, disableWorkspaceSkills: null,
    approvalTimeout: null, approvalTimeoutValue: null,
    askTimeout: null, askTimeoutMessage: null,
    intentModel: null, intentPrompt: null, intentThreshold: null,
    insight: null,
    agenda: null,
  }
}

function emptyForm(): ProfileForm {
  return { name: '', overrides: emptyOverrides() }
}

const form = ref<ProfileForm>(emptyForm())

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

function openAdd() {
  isCreating.value = true
  editing.value = { id: 0, name: '' } as ProfileRow
  form.value = emptyForm()
}

function openEdit(p: ProfileRow) {
  isCreating.value = false
  editing.value = p
  const toTriBool = (v: any): boolean | null => v == null ? null : !!v
  form.value = {
    name: p.name || '',
    overrides: {
      agentId: p.agentId,
      saver: p.saver,
      notes: p.notes == null ? null : parseList(p.notes),
      wikis: p.wikis == null ? null : parseList(p.wikis),
      useChannelNotes: toTriBool(p.useChannelNotes),
      useChannelWikis: toTriBool(p.useChannelWikis),
      workPath: p.workPath,
      streamVerbose: toTriBool(p.streamVerbose),
      autoApproveAllTools: toTriBool(p.autoApproveAllTools),
      disableWorkspaceContext: toTriBool(p.disableWorkspaceContext),
      disableWorkspaceSkills: toTriBool(p.disableWorkspaceSkills),
      approvalTimeout: p.approvalTimeout,
      approvalTimeoutValue: p.approvalTimeoutValue,
      askTimeout: p.askTimeout,
      askTimeoutMessage: p.askTimeoutMessage,
      intentModel: p.intentModel ?? null,
      intentPrompt: p.intentPrompt,
      intentThreshold: p.intentThreshold,
      insight: p.insight,
      agenda: p.agenda,
    },
  }
}

async function save() {
  const f = form.value
  if (!f.name.trim()) { show(t('common.name_required'), 'error'); return }
  // 编辑时若被多 session 共享，弹警告
  if (!isCreating.value && editing.value) {
    const count = editing.value.sessionCount ?? 0
    if (count > 1) {
      const ok = await confirm(t('channels.profile_shared_warn', { n: count }), { danger: true })
      if (!ok) return
    }
  }

  try {
    if (isCreating.value) {
      const created = await apiFetch('/api/session-profiles', 'POST', { name: f.name.trim() })
      await apiFetch(`/api/session-profiles/${(created.data as any).id}`, 'PUT', buildPayload(f))
    } else {
      if (!editing.value) return
      await apiFetch(`/api/session-profiles/${editing.value.id}`, 'PUT', buildPayload(f))
    }
    show(t('common.saved'))
    editing.value = null
    await loadAll()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function buildPayload(f: ProfileForm): Record<string, any> {
  const o = f.overrides
  const validNote = new Set(noteOptions.value.map(n => n.id))
  const validWiki = new Set(wikiOptions.value.map(w => w.id))
  return {
    name: f.name.trim(),
    agentId: o.agentId,
    saver: o.saver,
    notes: o.notes == null ? null : o.notes.filter(id => validNote.has(id)),
    wikis: o.wikis == null ? null : o.wikis.filter(id => validWiki.has(id)),
    useChannelNotes: o.useChannelNotes,
    useChannelWikis: o.useChannelWikis,
    workPath: o.workPath,
    streamVerbose: o.streamVerbose,
    autoApproveAllTools: o.autoApproveAllTools,
    disableWorkspaceContext: o.disableWorkspaceContext,
    disableWorkspaceSkills: o.disableWorkspaceSkills,
    approvalTimeout: o.approvalTimeout,
    approvalTimeoutValue: o.approvalTimeoutValue,
    askTimeout: o.askTimeout,
    askTimeoutMessage: o.askTimeoutMessage,
    intentModel: o.intentModel,
    intentPrompt: o.intentModel == null ? null : o.intentPrompt,
    intentThreshold: o.intentModel == null ? null : o.intentThreshold,
    insight: o.insight,
    agenda: o.agenda,
  }
}

async function remove(p: ProfileRow) {
  if ((p.sessionCount ?? 0) > 0) {
    show(t('session_profiles.delete_in_use', { n: p.sessionCount }), 'error')
    return
  }
  if (!await confirm(t('session_profiles.confirm_delete', { name: p.name }), { danger: true })) return
  try {
    await apiFetch(`/api/session-profiles/${p.id}`, 'DELETE')
    show(t('common.deleted'))
    await loadAll()
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="loadAll">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('session_profiles.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable :columns="columns" :rows="profiles" row-key="id" :empty-text="t('session_profiles.empty')">
        <template #agent="{ row }">
          <span v-if="row.agentId">{{ agentOptions.find(a => a.id === row.agentId)?.label || row.agentId }}</span>
          <span v-else style="color: var(--sui-fg-disabled)">—</span>
        </template>
        <template #saver="{ row }">
          <span v-if="row.saver">{{ saverOptions.find(s => s.id === row.saver)?.label || row.saver }}</span>
          <span v-else style="color: var(--sui-fg-disabled)">—</span>
        </template>
        <template #sessionCount="{ row }">
          <a v-if="row.sessionCount" href="#" class="session-count-link" @click.prevent="openSessions(row)">
            {{ t('session_profiles.used_by_n', { n: row.sessionCount }) }}
          </a>
          <span v-else style="color: var(--sui-fg-disabled)">{{ t('session_profiles.used_by_none') }}</span>
        </template>
        <template #ops="{ row }">
          <SButton type="outline" size="sm" @click="openEdit(row)">{{ t('common.edit') }}</SButton>
          <SButton type="danger" size="sm" :disabled="(row.sessionCount ?? 0) > 0" @click="remove(row)">{{ t('common.delete') }}</SButton>
        </template>
      </STable>
    </SPageContent>

    <Transition name="drawer-fade">
      <div v-if="editing" class="drawer-overlay" @click.self="editing = null"></div>
    </Transition>
    <Transition name="drawer-slide">
      <div v-if="editing" class="drawer-panel">
        <div class="drawer-header">
          <h3>{{ isCreating ? t('session_profiles.add_title') : t('session_profiles.edit_title', { name: editing.name }) }}</h3>
          <button class="drawer-close" @click="editing = null">&times;</button>
        </div>
        <div class="drawer-body">
          <SFormItem :label="t('session_profiles.name') + ' *'">
            <SInput v-model="form.name" :placeholder="t('session_profiles.name_placeholder')" />
          </SFormItem>

          <SessionConfigOverridesEditor
            v-model="form.overrides"
            :default-open-sections="['common']"
            :agent-options="agentOptions"
            :saver-options="saverOptions"
            :note-options="noteOptions"
            :wiki-options="wikiOptions"
            :model-options="modelOptions"
            :insight-profile-options="insightProfileOptions"
            :agenda-profile-options="agendaProfileOptions"
            @browse-path="pathPicker?.open(form.overrides.workPath || '')"
          />
        </div>
        <div class="drawer-footer">
          <SButton type="outline" @click="editing = null">{{ t('common.cancel') }}</SButton>
          <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
        </div>
      </div>
    </Transition>

    <PathPickerModal
      ref="pathPicker"
      :transport="pickerTransport"
      :labels="pickerLabels"
      @confirm="p => { form.overrides.workPath = p }"
      @error="msg => show(msg, 'error')"
    />

    <SModal v-model:visible="sessionsModalVisible" width="md">
      <template #header>
        <h3 class="s-modal-title">
          {{ t('session_profiles.sessions_modal_title', { name: sessionsModalProfile?.name || '' }) }}
        </h3>
      </template>
      <div v-if="sessionsModalLoading" class="modal-loading">{{ t('common.loading') }}</div>
      <div v-else-if="sessionsModalRows.length === 0" class="modal-empty">{{ t('session_profiles.used_by_none') }}</div>
      <ul v-else class="sess-list">
        <li v-for="s in sessionsModalRows" :key="s.id" class="sess-row">
          <span class="sess-channel">{{ channelLabel(s.channelId) }}</span>
          <span class="sess-name">{{ s.sessionName || s.autoSessionName || s.sessionId }}</span>
        </li>
      </ul>
    </SModal>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed; inset: 0;
  background: var(--sui-mask-soft);
  z-index: 100;
}
.drawer-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 520px; max-width: 100vw;
  background: var(--sui-bg);
  border-left: 1px solid var(--sui-border);
  display: flex; flex-direction: column;
  z-index: 101;
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sui-sp-5) var(--sui-sp-7);
  border-bottom: 1px solid var(--sui-border);
}
.drawer-header h3 { margin: 0; font-size: var(--sui-fs-lg); }
.drawer-close { background: none; border: none; cursor: pointer; font-size: 24px; color: var(--sui-fg-muted); }
.drawer-body { flex: 1; overflow-y: auto; padding: var(--sui-sp-5) var(--sui-sp-7); }
.drawer-footer {
  display: flex; gap: var(--sui-sp-3); justify-content: flex-end;
  padding: var(--sui-sp-5) var(--sui-sp-7);
  border-top: 1px solid var(--sui-border);
}
.drawer-fade-enter-active, .drawer-fade-leave-active { transition: opacity 0.2s; }
.drawer-fade-enter-from, .drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: transform 0.25s ease; }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform: translateX(100%); }

.session-count-link { color: var(--sui-fg-link, var(--sui-accent)); text-decoration: none; cursor: pointer; }
.session-count-link:hover { text-decoration: underline; }

.modal-loading, .modal-empty { padding: var(--sui-sp-6); text-align: center; color: var(--sui-fg-muted); }
.sess-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sui-sp-2); }
.sess-row {
  display: flex; align-items: center; gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius);
}
.sess-channel { color: var(--sui-fg-muted); font-size: var(--sui-fs-sm); min-width: 120px; }
.sess-name { flex: 1; }
</style>
