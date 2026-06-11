<script setup lang="ts">
import SessionDataConfigEditor from './SessionDataConfigEditor.vue'
import type { ConfigSource as DataConfigSource, DataConfigSection, DataConfigValue } from './SessionDataConfigEditor.vue'

export type SessionOverrides = DataConfigValue
export type ConfigSource = DataConfigSource

interface Option { id: string; label: string; type?: string }

defineProps<{
  modelValue: SessionOverrides
  defaultOpenSections?: DataConfigSection[]
  sources?: Partial<Record<keyof SessionOverrides, ConfigSource>>
  resolved?: Partial<Record<keyof SessionOverrides, any>>
  agentOptions: Option[]
  saverOptions: Option[]
  noteOptions: Option[]
  wikiOptions: Option[]
  modelOptions: Option[]
  insightProfileOptions: Option[]
  agendaProfileOptions: Option[]
}>()

defineEmits<{
  (e: 'update:modelValue', v: SessionOverrides): void
  (e: 'browse-path'): void
}>()
</script>

<template>
  <SessionDataConfigEditor
    :model-value="modelValue"
    mode="profile"
    :default-open-sections="defaultOpenSections"
    :sources="sources"
    :resolved="resolved"
    :agent-options="agentOptions"
    :saver-options="saverOptions"
    :note-options="noteOptions"
    :wiki-options="wikiOptions"
    :model-options="modelOptions"
    :insight-profile-options="insightProfileOptions"
    :agenda-profile-options="agendaProfileOptions"
    @update:model-value="$emit('update:modelValue', $event)"
    @browse-path="$emit('browse-path')"
  />
</template>
