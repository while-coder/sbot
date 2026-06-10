<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SInput, STextarea, SSelect, SFormItem, SMultiSelect, SButton, SFormDetails } from 'sbot-ui'
import { ApprovalTimeoutValue, type AgendaConfig, type InsightConfig } from 'sbot.commons'
import { apiFetch } from '@/shared/api'
import CreatePromptModal from '@/components/modals/CreatePromptModal.vue'

export interface DataConfigValue {
  agentId: string | null
  saver: string | null
  notes: string[] | null
  wikis: string[] | null
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
  insight: InsightConfig | null
  agenda: AgendaConfig | null
}

export type DataConfigMode = 'channel' | 'profile'
export type DataConfigSection = 'common' | 'resources' | 'runtime' | 'automation'
export type ConfigSource = 'session' | 'profile' | 'channel' | 'none'

interface Option { id: string; label: string; type?: string }

const props = withDefaults(defineProps<{
  modelValue: DataConfigValue
  mode?: DataConfigMode
  defaultOpenSections?: DataConfigSection[]
  sources?: Partial<Record<keyof DataConfigValue, ConfigSource>>
  resolved?: Partial<Record<keyof DataConfigValue, any>>
  agentOptions: Option[]
  saverOptions: Option[]
  noteOptions: Option[]
  wikiOptions: Option[]
  modelOptions: Option[]
}>(), {
  mode: 'profile',
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: DataConfigValue): void
  (e: 'browse-path'): void
}>()

const { t } = useI18n()
const inheritToken = '__inherit__'
const isProfileMode = () => props.mode === 'profile'

const resolvedDefaultOpenSections = computed<DataConfigSection[]>(() =>
  props.defaultOpenSections ?? (isProfileMode() ? ['common'] : ['common', 'resources'])
)

function isSectionOpen(section: DataConfigSection): boolean {
  return resolvedDefaultOpenSections.value.includes(section)
}

function update<K extends keyof DataConfigValue>(key: K, val: DataConfigValue[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: val })
}

type Formatter = (v: any) => string
function inheritLabel<K extends keyof DataConfigValue>(field: K, formatter?: Formatter): string {
  if (!isProfileMode()) return ''
  const src = props.sources?.[field]
  if (!src || src === 'none' || src === 'session') return ''
  const v = props.resolved?.[field]
  if (v == null || v === '') return t('channels.inherit_label_unset', { source: sourceText(src) })
  const display = formatter ? formatter(v) : String(v)
  return t('channels.inherit_label', { source: sourceText(src), value: display })
}

function sourceText(src: ConfigSource): string {
  switch (src) {
    case 'profile': return t('channels.source_profile')
    case 'channel': return t('channels.source_channel')
    default: return ''
  }
}

const fmtAgent = (v: any) => props.agentOptions.find(a => a.id === v)?.label || String(v ?? '')
const fmtSaver = (v: any) => props.saverOptions.find(s => s.id === v)?.label || String(v ?? '')
const fmtModel = (v: any) => props.modelOptions.find(m => m.id === v)?.label || String(v ?? '')
const fmtBool = (v: any) => v ? t('common.enabled') : t('common.disabled')
const fmtList = (v: any) => Array.isArray(v) ? `${v.length} ${t('channels.items_count_suffix')}` : String(v ?? '')
const fmtApprovalValue = (v: any) => v === ApprovalTimeoutValue.Allow ? t('channels.approval_timeout_value_allow') : v === ApprovalTimeoutValue.Deny ? t('channels.approval_timeout_value_deny') : String(v ?? '')
const fmtFeature = (v: any) => v?.enabled ? t('common.enabled') : t('common.disabled')

const resourcesBadge = computed(() => {
  let n = 0
  if ((props.modelValue.notes?.length ?? 0) > 0) n++
  if ((props.modelValue.wikis?.length ?? 0) > 0) n++
  if (props.modelValue.useChannelNotes !== null) n++
  if (props.modelValue.useChannelWikis !== null) n++
  if (props.modelValue.workPath) n++
  if (props.modelValue.disableWorkspaceContext) n++
  if (props.modelValue.disableWorkspaceSkills) n++
  return n || ''
})

const automationBadge = computed(() => {
  let n = 0
  if (props.modelValue.insight?.enabled) n++
  if (props.modelValue.agenda?.enabled) n++
  if (props.modelValue.insight?.enabled === false || props.modelValue.agenda?.enabled === false) n++
  return n || ''
})

const runtimeBadge = computed(() => {
  let n = 0
  if (props.modelValue.streamVerbose !== null && props.modelValue.streamVerbose !== false) n++
  if (props.modelValue.autoApproveAllTools !== null && props.modelValue.autoApproveAllTools !== false) n++
  if (props.modelValue.approvalTimeout && props.modelValue.approvalTimeout > 0) n++
  if (props.modelValue.askTimeout && props.modelValue.askTimeout > 0) n++
  if (props.modelValue.intentModel !== null && props.modelValue.intentModel !== '') n++
  return n || ''
})

const insightPrompts = ref<{ path: string; isUserOnly?: boolean }[]>([])
const showCreateInsightPrompt = ref(false)
const agendaPrompts = ref<{ path: string; isUserOnly?: boolean }[]>([])
const showCreateAgendaPrompt = ref(false)

async function loadInsightPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=insight/extractor')
    insightPrompts.value = res.data || []
  } catch {}
}

async function loadAgendaPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=agenda/sync')
    agendaPrompts.value = res.data || []
  } catch {}
}

function booleanSelectValue(key: 'streamVerbose' | 'autoApproveAllTools' | 'disableWorkspaceContext' | 'disableWorkspaceSkills'): string {
  const v = props.modelValue[key]
  if (isProfileMode() && v === null) return ''
  return v ? 'true' : 'false'
}

function updateBool(key: 'streamVerbose' | 'autoApproveAllTools' | 'disableWorkspaceContext' | 'disableWorkspaceSkills', value: string) {
  update(key, isProfileMode() && value === '' ? null : value === 'true')
}

function insightEnabledValue(): string {
  const insight = props.modelValue.insight
  if (isProfileMode() && !insight) return inheritToken
  return insight?.enabled ? 'true' : 'false'
}

function updateInsightEnabled(value: string) {
  if (value === inheritToken) {
    update('insight', null)
    return
  }
  if (value === 'false') {
    update('insight', isProfileMode() ? { enabled: false, extractor: '' } : null)
    return
  }
  update('insight', {
    enabled: true,
    extractor: props.modelValue.insight?.extractor || '',
    extractorPromptFile: props.modelValue.insight?.extractorPromptFile,
  })
}

function updateInsightField<K extends keyof InsightConfig>(key: K, value: InsightConfig[K]) {
  update('insight', {
    ...(props.modelValue.insight || {}),
    enabled: true,
    [key]: value,
  })
}

function agendaEnabledValue(): string {
  const agenda = props.modelValue.agenda
  if (isProfileMode() && !agenda) return inheritToken
  return agenda?.enabled ? 'true' : 'false'
}

function updateAgendaEnabled(value: string) {
  if (value === inheritToken) {
    update('agenda', null)
    return
  }
  if (value === 'false') {
    update('agenda', isProfileMode() ? { enabled: false } : null)
    return
  }
  update('agenda', {
    enabled: true,
    syncModel: props.modelValue.agenda?.syncModel || '',
    syncPromptFile: props.modelValue.agenda?.syncPromptFile,
  })
}

function updateAgendaField<K extends keyof AgendaConfig>(key: K, value: AgendaConfig[K]) {
  update('agenda', {
    ...(props.modelValue.agenda || {}),
    enabled: true,
    [key]: value,
  })
}

function openCreateInsightPrompt() {
  showCreateInsightPrompt.value = true
}

async function onInsightPromptCreated(filePath: string) {
  showCreateInsightPrompt.value = false
  await loadInsightPrompts()
  updateInsightField('extractorPromptFile', filePath)
}

function openCreateAgendaPrompt() {
  showCreateAgendaPrompt.value = true
}

async function onAgendaPromptCreated(filePath: string) {
  showCreateAgendaPrompt.value = false
  await loadAgendaPrompts()
  updateAgendaField('syncPromptFile', filePath)
}

onMounted(() => {
  loadInsightPrompts()
  loadAgendaPrompts()
})
</script>

<template>
  <div class="data-config-editor">
    <SFormDetails :summary="t('channels.section_common')" :open="isSectionOpen('common')">

    <SFormItem :label="t('common.agent')" :hint="inheritLabel('agentId', fmtAgent)">
      <SSelect :model-value="modelValue.agentId ?? ''" @update:model-value="v => update('agentId', v === '' ? null : String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option v-else value="" disabled>{{ t('channels.select_agent') }}</option>
        <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}{{ a.type ? ` (${a.type})` : '' }}</option>
      </SSelect>
    </SFormItem>

    <SFormItem :label="t('common.storage')" :hint="inheritLabel('saver', fmtSaver)">
      <SSelect :model-value="modelValue.saver ?? ''" @update:model-value="v => update('saver', v === '' ? null : String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option v-else value="" disabled>{{ t('channels.select_saver') }}</option>
        <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
      </SSelect>
    </SFormItem>
    </SFormDetails>

    <SFormDetails :summary="t('channels.section_resources_workspace')" :badge="resourcesBadge" :open="isSectionOpen('resources')">

    <SFormItem :label="t('common.note')" :hint="inheritLabel('notes', fmtList)">
      <SMultiSelect :model-value="modelValue.notes ?? []" :options="noteOptions" @update:model-value="v => update('notes', v as string[])" />
      <SFormItem v-if="isProfileMode()" :label="t('channels.use_channel_notes')" :hint="t('channels.use_channel_notes_hint')" class="nested-form-item">
        <SSelect :model-value="modelValue.useChannelNotes === null ? '' : String(modelValue.useChannelNotes)" @update:model-value="v => update('useChannelNotes', v === '' ? null : v === 'true')">
          <option value="">{{ t('channels.use_channel_default') }}</option>
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
    </SFormItem>

    <SFormItem :label="t('common.wiki')" :hint="inheritLabel('wikis', fmtList)">
      <SMultiSelect :model-value="modelValue.wikis ?? []" :options="wikiOptions" @update:model-value="v => update('wikis', v as string[])" />
      <SFormItem v-if="isProfileMode()" :label="t('channels.use_channel_wikis')" :hint="t('channels.use_channel_wikis_hint')" class="nested-form-item">
        <SSelect :model-value="modelValue.useChannelWikis === null ? '' : String(modelValue.useChannelWikis)" @update:model-value="v => update('useChannelWikis', v === '' ? null : v === 'true')">
          <option value="">{{ t('channels.use_channel_default') }}</option>
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
    </SFormItem>

    <SFormItem :label="t('directory.path_label')" :hint="inheritLabel('workPath')">
      <div class="path-row">
        <SInput :model-value="modelValue.workPath ?? ''" type="text" class="path-input" @update:model-value="v => update('workPath', String(v).trim() ? String(v) : null)" />
        <SButton type="outline" size="sm" @click="emit('browse-path')">{{ t('directory.browse') }}</SButton>
      </div>
    </SFormItem>

    <SFormItem :label="t('agents.disable_workspace_context')" :hint="inheritLabel('disableWorkspaceContext', fmtBool) || t('agents.disable_workspace_context_hint')">
      <SSelect :model-value="booleanSelectValue('disableWorkspaceContext')" @update:model-value="v => updateBool('disableWorkspaceContext', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('agents.disable_workspace_skills')" :hint="inheritLabel('disableWorkspaceSkills', fmtBool) || t('agents.disable_workspace_skills_hint')">
      <SSelect :model-value="booleanSelectValue('disableWorkspaceSkills')" @update:model-value="v => updateBool('disableWorkspaceSkills', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    </SFormDetails>

    <SFormDetails :summary="t('channels.section_runtime')" :badge="runtimeBadge" :open="isSectionOpen('runtime')">

    <SFormItem :label="t('channels.stream_verbose')" :hint="inheritLabel('streamVerbose', fmtBool) || t('channels.stream_verbose_hint')">
      <SSelect :model-value="booleanSelectValue('streamVerbose')" @update:model-value="v => updateBool('streamVerbose', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('settings.auto_approve_all')" :hint="inheritLabel('autoApproveAllTools', fmtBool) || t('settings.auto_approve_all_hint')">
      <SSelect :model-value="booleanSelectValue('autoApproveAllTools')" @update:model-value="v => updateBool('autoApproveAllTools', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('channels.approval_timeout')" :hint="inheritLabel('approvalTimeout') || t('channels.approval_timeout_hint')">
      <SInput :model-value="modelValue.approvalTimeout ?? ''" type="number" placeholder="0" @update:model-value="v => update('approvalTimeout', (v === '' || v === null || Number(v) <= 0) ? null : Number(v))" />
    </SFormItem>
    <SFormItem v-if="modelValue.approvalTimeout != null && modelValue.approvalTimeout > 0" :label="t('channels.approval_timeout_value')" :hint="inheritLabel('approvalTimeoutValue', fmtApprovalValue)">
      <SSelect :model-value="modelValue.approvalTimeoutValue ?? ''" @update:model-value="v => update('approvalTimeoutValue', v === '' ? null : v as ApprovalTimeoutValue)">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option :value="ApprovalTimeoutValue.Deny">{{ t('channels.approval_timeout_value_deny') }}</option>
        <option :value="ApprovalTimeoutValue.Allow">{{ t('channels.approval_timeout_value_allow') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('channels.ask_timeout')" :hint="inheritLabel('askTimeout') || t('channels.ask_timeout_hint')">
      <SInput :model-value="modelValue.askTimeout ?? ''" type="number" placeholder="0" @update:model-value="v => update('askTimeout', (v === '' || v === null || Number(v) <= 0) ? null : Number(v))" />
    </SFormItem>
    <SFormItem v-if="modelValue.askTimeout != null && modelValue.askTimeout > 0" :label="t('channels.ask_timeout_message')" :hint="inheritLabel('askTimeoutMessage') || t('channels.ask_timeout_message_hint')">
      <SInput :model-value="modelValue.askTimeoutMessage ?? ''" type="text" @update:model-value="v => update('askTimeoutMessage', String(v).trim() ? String(v) : null)" />
    </SFormItem>
    <SFormItem :label="t('channels.intent_model')" :hint="inheritLabel('intentModel', fmtModel) || t('channels.intent_model_hint')">
      <SSelect :model-value="modelValue.intentModel ?? (isProfileMode() ? '__default__' : '')" @update:model-value="v => update('intentModel', v === '__default__' ? null : String(v))">
        <option v-if="isProfileMode()" value="__default__">{{ t('channels.use_channel_default') }}</option>
        <option value="">{{ t('common.not_use') }}</option>
        <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
      </SSelect>
    </SFormItem>
    <template v-if="modelValue.intentModel">
      <SFormItem :label="t('channels.intent_threshold')" :hint="inheritLabel('intentThreshold') || t('channels.intent_threshold_hint')">
        <SInput :model-value="modelValue.intentThreshold ?? ''" type="number" placeholder="0.7" @update:model-value="v => update('intentThreshold', v === '' || v === null ? null : Number(v))" />
      </SFormItem>
      <SFormItem :label="t('channels.intent_prompt')" :hint="inheritLabel('intentPrompt')">
        <STextarea :model-value="modelValue.intentPrompt ?? ''" :rows="4" :placeholder="t('channels.intent_prompt_placeholder')" @update:model-value="v => update('intentPrompt', String(v).trim() ? String(v) : null)" />
      </SFormItem>
    </template>
    </SFormDetails>

    <SFormDetails :summary="t('channels.section_automation_memory')" :badge="automationBadge" :open="isSectionOpen('automation')">

    <SFormItem :label="t('agents.insight_enabled')" :hint="inheritLabel('insight', fmtFeature) || t('agents.insight_hint')">
      <SSelect :model-value="insightEnabledValue()" @update:model-value="v => updateInsightEnabled(String(v))">
        <option v-if="isProfileMode()" :value="inheritToken">{{ t('channels.use_channel_default') }}</option>
        <option value="false">{{ t('agents.insight_disabled') }}</option>
        <option value="true">{{ t('agents.insight_profile') }}</option>
      </SSelect>
    </SFormItem>
    <template v-if="modelValue.insight?.enabled">
      <SFormItem :label="t('agents.insight_extractor') + ' *'" :hint="t('agents.insight_extractor_hint')">
        <SSelect :model-value="modelValue.insight?.extractor ?? ''" @update:model-value="v => updateInsightField('extractor', String(v))">
          <option value="">{{ t('agents.insight_extractor_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agents.insight_prompt_file')" :hint="t('agents.insight_prompt_file_hint')">
        <div class="prompt-row">
          <SSelect :model-value="modelValue.insight?.extractorPromptFile ?? ''" style="flex:1" @update:model-value="v => updateInsightField('extractorPromptFile', String(v) || undefined)">
            <option value="">{{ t('agents.insight_prompt_file_default') }}</option>
            <option v-for="p in insightPrompts" :key="p.path" :value="p.path">{{ p.path.split('/').pop() }}</option>
          </SSelect>
          <SButton type="outline" size="sm" @click="openCreateInsightPrompt" title="+">+</SButton>
        </div>
      </SFormItem>
    </template>

    <SFormItem :label="t('agents.agenda_enabled')" :hint="inheritLabel('agenda', fmtFeature) || t('agents.agenda_hint')">
      <SSelect :model-value="agendaEnabledValue()" @update:model-value="v => updateAgendaEnabled(String(v))">
        <option v-if="isProfileMode()" :value="inheritToken">{{ t('channels.use_channel_default') }}</option>
        <option value="false">{{ t('agents.agenda_disabled') }}</option>
        <option value="true">{{ t('agents.agenda_profile') }}</option>
      </SSelect>
    </SFormItem>
    <template v-if="modelValue.agenda?.enabled">
      <SFormItem :label="t('agents.agenda_sync_model')" :hint="t('agents.agenda_sync_model_hint')">
        <SSelect :model-value="modelValue.agenda?.syncModel ?? ''" @update:model-value="v => updateAgendaField('syncModel', String(v))">
          <option value="">{{ t('agents.agenda_sync_model_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agents.agenda_sync_prompt_file')" :hint="t('agents.agenda_sync_prompt_file_hint')">
        <div class="prompt-row">
          <SSelect :model-value="modelValue.agenda?.syncPromptFile ?? ''" style="flex:1" @update:model-value="v => updateAgendaField('syncPromptFile', String(v) || undefined)">
            <option value="">{{ t('agents.agenda_sync_prompt_file_default') }}</option>
            <option v-for="p in agendaPrompts" :key="p.path" :value="p.path">{{ p.path.split('/').pop() }}</option>
          </SSelect>
          <SButton type="outline" size="sm" @click="openCreateAgendaPrompt" title="+">+</SButton>
        </div>
      </SFormItem>
    </template>
    </SFormDetails>
  </div>

  <CreatePromptModal v-model:visible="showCreateInsightPrompt" prefix="insight/extractor/" default-ext=".txt" @created="onInsightPromptCreated" @close="showCreateInsightPrompt = false" />
  <CreatePromptModal v-model:visible="showCreateAgendaPrompt" prefix="agenda/sync/" default-ext=".txt" @created="onAgendaPromptCreated" @close="showCreateAgendaPrompt = false" />
</template>

<style scoped>
.data-config-editor :deep(.s-form-details:first-child) { margin-top: 0; }
.path-row {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: stretch;
}
.prompt-row {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.path-input { flex: 1; }
.nested-form-item { margin-top: var(--sui-sp-3); }
</style>
