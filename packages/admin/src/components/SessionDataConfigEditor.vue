<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SInput, STextarea, SSelect, SFormItem, SMultiSelect, SButton, SFormDetails } from 'sbot-ui'
import { ApprovalTimeoutValue, IntentFilterMode } from 'sbot.commons'

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
  disableWorkspaceMcp: boolean | null
  approvalTimeout: number | null
  approvalTimeoutValue: ApprovalTimeoutValue | null
  askTimeout: number | null
  askTimeoutMessage: string | null
  intentFilterMode: IntentFilterMode | null
  intentModel: string | null
  intentPrompt: string | null
  intentThreshold: number | null
  /** memoryProfiles 中的 UUID；profile 模式下 null = 沿用 channel；channel 模式下 null = 不启用 */
  memory: string | null
  /** agendaProfiles 中的 UUID；profile 模式下 null = 沿用 channel；channel 模式下 null = 不启用 */
  agenda: string | null
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
  memoryProfileOptions: Option[]
  agendaProfileOptions: Option[]
}>(), {
  mode: 'profile',
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: DataConfigValue): void
  (e: 'browse-path'): void
}>()

const { t } = useI18n()
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
const fmtMemory = (v: any) => props.memoryProfileOptions.find(p => p.id === v)?.label || String(v ?? '')
const fmtAgenda = (v: any) => props.agendaProfileOptions.find(p => p.id === v)?.label || String(v ?? '')
const fmtIntentFilterMode = (v: any) => {
  switch (v) {
    case IntentFilterMode.Off: return t('channels.intent_filter_mode_off')
    case IntentFilterMode.All: return t('channels.intent_filter_mode_all')
    case IntentFilterMode.Auto: return t('channels.intent_filter_mode_auto')
    default: return String(v ?? '')
  }
}

const resourcesBadge = computed(() => {
  let n = 0
  if ((props.modelValue.notes?.length ?? 0) > 0) n++
  if ((props.modelValue.wikis?.length ?? 0) > 0) n++
  if (props.modelValue.useChannelNotes) n++
  if (props.modelValue.useChannelWikis) n++
  if (props.modelValue.workPath) n++
  if (props.modelValue.disableWorkspaceContext) n++
  if (props.modelValue.disableWorkspaceSkills) n++
  if (props.modelValue.disableWorkspaceMcp) n++
  return n || ''
})

const automationBadge = computed(() => {
  let n = 0
  if (props.modelValue.memory) n++
  if (props.modelValue.agenda) n++
  return n || ''
})

const runtimeBadge = computed(() => {
  let n = 0
  if (props.modelValue.streamVerbose !== null && props.modelValue.streamVerbose !== false) n++
  if (props.modelValue.autoApproveAllTools !== null && props.modelValue.autoApproveAllTools !== false) n++
  if (props.modelValue.approvalTimeout && props.modelValue.approvalTimeout > 0) n++
  if (props.modelValue.askTimeout && props.modelValue.askTimeout > 0) n++
  if (props.modelValue.intentFilterMode != null && props.modelValue.intentFilterMode !== IntentFilterMode.Auto) n++
  if (props.modelValue.intentModel !== null && props.modelValue.intentModel !== '') n++
  return n || ''
})

function booleanSelectValue(key: 'streamVerbose' | 'autoApproveAllTools' | 'disableWorkspaceContext' | 'disableWorkspaceSkills' | 'disableWorkspaceMcp'): string {
  const v = props.modelValue[key]
  if (isProfileMode() && v === null) return ''
  return v ? 'true' : 'false'
}

function updateBool(key: 'streamVerbose' | 'autoApproveAllTools' | 'disableWorkspaceContext' | 'disableWorkspaceSkills' | 'disableWorkspaceMcp', value: string) {
  update(key, isProfileMode() && value === '' ? null : value === 'true')
}

/**
 * 工作目录自动注入类字段：底层存的是 disable* （关闭）语义，UI 上以正向「自动注入 启用/禁用」呈现，
 * 因此这里对 select 的 true/false 做一次反转：启用注入 = disable false，禁用注入 = disable true。
 */
type WorkspaceInjectKey = 'disableWorkspaceContext' | 'disableWorkspaceSkills' | 'disableWorkspaceMcp'
function injectSelectValue(key: WorkspaceInjectKey): string {
  const v = props.modelValue[key]
  if (isProfileMode() && v === null) return ''
  return v ? 'false' : 'true'
}

function updateInject(key: WorkspaceInjectKey, value: string) {
  update(key, isProfileMode() && value === '' ? null : value !== 'true')
}

/** 继承值显示：底层 disable=true 表示「禁用注入」，disable=false 表示「启用注入」 */
const fmtInject = (v: any) => v ? t('common.disabled') : t('common.enabled')

/** memory/agenda 引用：profile 模式下空串 = 沿用 channel；channel 模式下空串 = 不启用 */
function refSelectValue(key: 'memory' | 'agenda'): string {
  return props.modelValue[key] ?? ''
}

function updateRef(key: 'memory' | 'agenda', value: string) {
  update(key, value ? value : null)
}

/**
 * 超时三态：
 * - inherit: profile 模式下，null = 继承 channel 默认
 * - off: 0 = 显式不超时（在 profile 模式下可覆盖 channel 的非零超时）
 * - custom: > 0 = 自定义秒数
 * channel 模式下没有 inherit 选项；channel 的 null 视作 off（沿用旧行为）。
 */
function timeoutMode(key: 'approvalTimeout' | 'askTimeout'): 'inherit' | 'off' | 'custom' {
  const v = props.modelValue[key]
  if (v == null) return isProfileMode() ? 'inherit' : 'off'
  if (v === 0) return 'off'
  return 'custom'
}

function setTimeoutMode(key: 'approvalTimeout' | 'askTimeout', mode: string) {
  if (mode === 'inherit') update(key, null)
  else if (mode === 'off') update(key, isProfileMode() ? 0 : null)
  else {
    const cur = props.modelValue[key]
    update(key, cur != null && cur > 0 ? cur : 30)
  }
}

function intentFilterModeValue(): string {
  if (isProfileMode() && props.modelValue.intentFilterMode == null) return '__default__'
  return props.modelValue.intentFilterMode ?? IntentFilterMode.Auto
}

function updateIntentFilterMode(value: string) {
  const mode = isProfileMode() && value === '__default__' ? null : value as IntentFilterMode
  const next: DataConfigValue = { ...props.modelValue, intentFilterMode: mode }
  if (mode === IntentFilterMode.Off || mode === IntentFilterMode.All) {
    next.intentModel = null
    next.intentPrompt = null
    next.intentThreshold = null
  }
  emit('update:modelValue', next)
}

function showIntentModelConfig(): boolean {
  return props.modelValue.intentFilterMode == null || props.modelValue.intentFilterMode === IntentFilterMode.Auto
}
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
        <SSelect :model-value="String(!!modelValue.useChannelNotes)" @update:model-value="v => update('useChannelNotes', v === 'true')">
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
    </SFormItem>

    <SFormItem :label="t('common.wiki')" :hint="inheritLabel('wikis', fmtList)">
      <SMultiSelect :model-value="modelValue.wikis ?? []" :options="wikiOptions" @update:model-value="v => update('wikis', v as string[])" />
      <SFormItem v-if="isProfileMode()" :label="t('channels.use_channel_wikis')" :hint="t('channels.use_channel_wikis_hint')" class="nested-form-item">
        <SSelect :model-value="String(!!modelValue.useChannelWikis)" @update:model-value="v => update('useChannelWikis', v === 'true')">
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

    <SFormItem :label="t('agents.disable_workspace_context')" :hint="inheritLabel('disableWorkspaceContext', fmtInject) || t('agents.disable_workspace_context_hint')">
      <SSelect :model-value="injectSelectValue('disableWorkspaceContext')" @update:model-value="v => updateInject('disableWorkspaceContext', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('agents.disable_workspace_skills')" :hint="inheritLabel('disableWorkspaceSkills', fmtInject) || t('agents.disable_workspace_skills_hint')">
      <SSelect :model-value="injectSelectValue('disableWorkspaceSkills')" @update:model-value="v => updateInject('disableWorkspaceSkills', String(v))">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('agents.disable_workspace_mcp')" :hint="inheritLabel('disableWorkspaceMcp', fmtInject) || t('agents.disable_workspace_mcp_hint')">
      <SSelect :model-value="injectSelectValue('disableWorkspaceMcp')" @update:model-value="v => updateInject('disableWorkspaceMcp', String(v))">
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
      <SSelect :model-value="timeoutMode('approvalTimeout')" @update:model-value="v => setTimeoutMode('approvalTimeout', String(v))">
        <option v-if="isProfileMode()" value="inherit">{{ t('channels.use_channel_default') }}</option>
        <option value="off">{{ t('channels.timeout_off') }}</option>
        <option value="custom">{{ t('channels.timeout_custom') }}</option>
      </SSelect>
      <SFormItem v-if="timeoutMode('approvalTimeout') === 'custom'" :label="t('channels.timeout_seconds')" class="nested-form-item">
        <SInput :model-value="modelValue.approvalTimeout ?? ''" type="number" min="1" placeholder="30" @update:model-value="v => update('approvalTimeout', (v === '' || v === null || Number(v) <= 0) ? 1 : Number(v))" />
      </SFormItem>
    </SFormItem>
    <SFormItem v-if="timeoutMode('approvalTimeout') === 'custom'" :label="t('channels.approval_timeout_value')" :hint="inheritLabel('approvalTimeoutValue', fmtApprovalValue)">
      <SSelect :model-value="modelValue.approvalTimeoutValue ?? ''" @update:model-value="v => update('approvalTimeoutValue', v === '' ? null : v as ApprovalTimeoutValue)">
        <option v-if="isProfileMode()" value="">{{ t('channels.use_channel_default') }}</option>
        <option :value="ApprovalTimeoutValue.Deny">{{ t('channels.approval_timeout_value_deny') }}</option>
        <option :value="ApprovalTimeoutValue.Allow">{{ t('channels.approval_timeout_value_allow') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('channels.ask_timeout')" :hint="inheritLabel('askTimeout') || t('channels.ask_timeout_hint')">
      <SSelect :model-value="timeoutMode('askTimeout')" @update:model-value="v => setTimeoutMode('askTimeout', String(v))">
        <option v-if="isProfileMode()" value="inherit">{{ t('channels.use_channel_default') }}</option>
        <option value="off">{{ t('channels.timeout_off') }}</option>
        <option value="custom">{{ t('channels.timeout_custom') }}</option>
      </SSelect>
      <SFormItem v-if="timeoutMode('askTimeout') === 'custom'" :label="t('channels.timeout_seconds')" class="nested-form-item">
        <SInput :model-value="modelValue.askTimeout ?? ''" type="number" min="1" placeholder="30" @update:model-value="v => update('askTimeout', (v === '' || v === null || Number(v) <= 0) ? 1 : Number(v))" />
      </SFormItem>
    </SFormItem>
    <SFormItem v-if="timeoutMode('askTimeout') === 'custom'" :label="t('channels.ask_timeout_message')" :hint="inheritLabel('askTimeoutMessage') || t('channels.ask_timeout_message_hint')">
      <SInput :model-value="modelValue.askTimeoutMessage ?? ''" type="text" @update:model-value="v => update('askTimeoutMessage', String(v).trim() ? String(v) : null)" />
    </SFormItem>
    <SFormItem :label="t('channels.intent_filter_mode')" :hint="inheritLabel('intentFilterMode', fmtIntentFilterMode) || t('channels.intent_filter_mode_hint')">
      <SSelect :model-value="intentFilterModeValue()" @update:model-value="v => updateIntentFilterMode(String(v))">
        <option v-if="isProfileMode()" value="__default__">{{ t('channels.use_channel_default') }}</option>
        <option :value="IntentFilterMode.Auto">{{ t('channels.intent_filter_mode_auto') }}</option>
        <option :value="IntentFilterMode.Off">{{ t('channels.intent_filter_mode_off') }}</option>
        <option :value="IntentFilterMode.All">{{ t('channels.intent_filter_mode_all') }}</option>
      </SSelect>
    </SFormItem>
    <template v-if="showIntentModelConfig()">
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
    </template>
    </SFormDetails>

    <SFormDetails :summary="t('channels.section_automation_memory')" :badge="automationBadge" :open="isSectionOpen('automation')">

    <SFormItem :label="t('agents.memory_enabled')" :hint="inheritLabel('memory', fmtMemory) || t('agents.memory_hint')">
      <SSelect :model-value="refSelectValue('memory')" @update:model-value="v => updateRef('memory', String(v))">
        <option value="">{{ isProfileMode() ? t('channels.use_channel_default') : t('agents.memory_disabled') }}</option>
        <option v-for="p in memoryProfileOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
      </SSelect>
    </SFormItem>

    <SFormItem :label="t('agents.agenda_enabled')" :hint="inheritLabel('agenda', fmtAgenda) || t('agents.agenda_hint')">
      <SSelect :model-value="refSelectValue('agenda')" @update:model-value="v => updateRef('agenda', String(v))">
        <option value="">{{ isProfileMode() ? t('channels.use_channel_default') : t('agents.agenda_disabled') }}</option>
        <option v-for="p in agendaProfileOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
      </SSelect>
    </SFormItem>
    </SFormDetails>
  </div>
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
