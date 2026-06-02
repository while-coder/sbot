<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SInput, STextarea, SSelect, SFormItem, SMultiSelect, SButton } from 'sbot-ui'
import { ApprovalTimeoutValue } from 'sbot.commons'

/**
 * profile 上的可覆盖配置字段。null = 跟随 ChannelConfig 默认值。
 * memories/wikis 使用数组形式（提交时父组件负责 JSON.stringify）。
 */
export interface SessionOverrides {
  agentId: string | null
  saver: string | null
  memories: string[] | null
  wikis: string[] | null
  useChannelMemories: boolean | null
  useChannelWikis: boolean | null
  workPath: string | null
  streamVerbose: boolean | null
  autoApproveAllTools: boolean | null
  approvalTimeout: number | null
  approvalTimeoutValue: ApprovalTimeoutValue | null
  askTimeout: number | null
  askTimeoutMessage: string | null
  intentModel: string | null
  intentPrompt: string | null
  intentThreshold: number | null
}

export type ConfigSource = 'session' | 'profile' | 'channel' | 'none'

interface Option { id: string; label: string; type?: string }

const props = defineProps<{
  modelValue: SessionOverrides
  /** 来自后端 effective-config 的字段来源 */
  sources?: Partial<Record<keyof SessionOverrides, ConfigSource>>
  resolved?: Partial<Record<keyof SessionOverrides, any>>
  agentOptions: Option[]
  saverOptions: Option[]
  memoryOptions: Option[]
  wikiOptions: Option[]
  modelOptions: Option[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: SessionOverrides): void
  (e: 'browse-path'): void
}>()

const { t } = useI18n()

function update<K extends keyof SessionOverrides>(key: K, val: SessionOverrides[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: val })
}

type Formatter = (v: any) => string
function inheritLabel<K extends keyof SessionOverrides>(field: K, formatter?: Formatter): string {
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
</script>

<template>
  <div class="overrides-editor">
    <h4 class="form-section-title">{{ t('channels.section_common') }}</h4>

    <SFormItem :label="t('common.agent')" :hint="inheritLabel('agentId', fmtAgent)">
      <SSelect :model-value="modelValue.agentId ?? ''" @update:model-value="v => update('agentId', v === '' ? null : String(v))">
        <option value="">{{ t('channels.use_channel_default') }}</option>
        <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}{{ a.type ? ` (${a.type})` : '' }}</option>
      </SSelect>
    </SFormItem>

    <SFormItem :label="t('common.storage')" :hint="inheritLabel('saver', fmtSaver)">
      <SSelect :model-value="modelValue.saver ?? ''" @update:model-value="v => update('saver', v === '' ? null : String(v))">
        <option value="">{{ t('channels.use_channel_default') }}</option>
        <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
      </SSelect>
    </SFormItem>

    <SFormItem :label="t('common.memory')" :hint="inheritLabel('memories', fmtList)">
      <SMultiSelect :model-value="modelValue.memories ?? []" :options="memoryOptions" @update:model-value="v => update('memories', v as string[])" />
      <SFormItem :label="t('channels.use_channel_memories')" :hint="t('channels.use_channel_memories_hint')" class="nested-form-item">
        <SSelect :model-value="modelValue.useChannelMemories === null ? '' : String(modelValue.useChannelMemories)" @update:model-value="v => update('useChannelMemories', v === '' ? null : v === 'true')">
          <option value="">{{ t('channels.use_channel_default') }}</option>
          <option value="true">{{ t('common.enabled') }}</option>
          <option value="false">{{ t('common.disabled') }}</option>
        </SSelect>
      </SFormItem>
    </SFormItem>

    <SFormItem :label="t('common.wiki')" :hint="inheritLabel('wikis', fmtList)">
      <SMultiSelect :model-value="modelValue.wikis ?? []" :options="wikiOptions" @update:model-value="v => update('wikis', v as string[])" />
      <SFormItem :label="t('channels.use_channel_wikis')" :hint="t('channels.use_channel_wikis_hint')" class="nested-form-item">
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

    <h4 class="form-section-title">{{ t('channels.section_advanced') }}</h4>

    <SFormItem :label="t('channels.stream_verbose')" :hint="inheritLabel('streamVerbose', fmtBool) || t('channels.stream_verbose_hint')">
      <SSelect :model-value="modelValue.streamVerbose === null ? '' : String(modelValue.streamVerbose)" @update:model-value="v => update('streamVerbose', v === '' ? null : v === 'true')">
        <option value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('settings.auto_approve_all')" :hint="inheritLabel('autoApproveAllTools', fmtBool) || t('settings.auto_approve_all_hint')">
      <SSelect :model-value="modelValue.autoApproveAllTools === null ? '' : String(modelValue.autoApproveAllTools)" @update:model-value="v => update('autoApproveAllTools', v === '' ? null : v === 'true')">
        <option value="">{{ t('channels.use_channel_default') }}</option>
        <option value="true">{{ t('common.enabled') }}</option>
        <option value="false">{{ t('common.disabled') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('channels.approval_timeout')" :hint="inheritLabel('approvalTimeout') || t('channels.approval_timeout_hint')">
      <SInput :model-value="modelValue.approvalTimeout ?? ''" type="number" placeholder="0" @update:model-value="v => update('approvalTimeout', (v === '' || v === null || Number(v) <= 0) ? null : Number(v))" />
    </SFormItem>
    <SFormItem v-if="modelValue.approvalTimeout != null && modelValue.approvalTimeout > 0" :label="t('channels.approval_timeout_value')" :hint="inheritLabel('approvalTimeoutValue', fmtApprovalValue)">
      <SSelect :model-value="modelValue.approvalTimeoutValue ?? ''" @update:model-value="v => update('approvalTimeoutValue', v === '' ? null : v as ApprovalTimeoutValue)">
        <option value="">{{ t('channels.use_channel_default') }}</option>
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
      <SSelect :model-value="modelValue.intentModel ?? '__default__'" @update:model-value="v => update('intentModel', v === '__default__' ? null : String(v))">
        <option value="__default__">{{ t('channels.use_channel_default') }}</option>
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
  </div>
</template>

<style scoped>
.form-section-title {
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  color: var(--sui-fg-secondary);
  margin: var(--sui-sp-2) 0 var(--sui-sp-3);
  padding-bottom: var(--sui-sp-2);
  border-bottom: 1px solid var(--sui-border);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.path-row {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: stretch;
}
.path-input { flex: 1; }
.nested-form-item { margin-top: var(--sui-sp-3); }
</style>
