<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { McpTool } from '@/shared/types'
import { renderToolParams } from '@/utils/mcpSchema'
import { SModal, SButton, SSwitch } from '@qingfeng346/ui-kit'

defineProps<{
  visible: boolean
  title: string
  tools: McpTool[]
  loading: boolean
  autoApprovedTools: string[]
  allApproved: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'toggle-auto-approve', toolName: string): void
  (e: 'approve-all'): void
  (e: 'revoke-all'): void
}>()

const { t } = useI18n()

const expandedTools = reactive(new Set<number>())

function toggleTool(i: number) {
  if (expandedTools.has(i)) expandedTools.delete(i)
  else expandedTools.add(i)
}

function close() {
  expandedTools.clear()
  emit('update:visible', false)
}
</script>

<template>
  <SModal :visible="visible" :title="title" width="lg" @update:visible="emit('update:visible', $event)" @close="close">
    <div v-if="loading" class="tools-loading">{{ t('mcp.connecting') }}</div>
    <template v-else>
      <div v-if="tools.length === 0" class="tools-loading">{{ t('mcp.no_tools') }}</div>
      <template v-else>
        <div class="tools-approve-bar">
          <span class="tools-approve-label">{{ t('mcp.auto_approve') }}</span>
          <SButton v-if="!allApproved" type="outline" size="small" @click="emit('approve-all')">{{ t('mcp.approve_all') }}</SButton>
          <SButton v-else type="outline" size="small" @click="emit('revoke-all')">{{ t('mcp.revoke_all') }}</SButton>
        </div>
        <ul class="tools-list">
          <li v-for="(tool, i) in tools" :key="tool.name">
            <div class="tool-header">
              <div class="tool-name" :class="{ expanded: expandedTools.has(i) }" @click="toggleTool(i)">{{ tool.name }}</div>
              <SSwitch
                :value="autoApprovedTools.includes(tool.name)"
                :label="t('mcp.auto_approve')"
                :title="t('mcp.auto_approve')"
                @update:value="emit('toggle-auto-approve', tool.name)"
                @click.stop
              />
            </div>
            <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
            <div class="tool-params" :class="{ show: expandedTools.has(i) }" v-html="renderToolParams((tool as any).parameters)"></div>
          </li>
        </ul>
      </template>
    </template>

    <template #footer>
      <SButton type="outline" @click="close">{{ t('common.close') }}</SButton>
    </template>
  </SModal>
</template>
