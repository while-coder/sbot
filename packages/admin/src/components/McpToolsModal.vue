<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { McpTool } from '@/types'
import { renderToolParams } from '@/utils/mcpSchema'

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
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-box wide">
      <div class="modal-header">
        <h3>{{ title }}<span v-if="!loading" class="tools-count">({{ tools.length }} {{ t('mcp.tools_suffix') }})</span></h3>
        <button class="modal-close" @click="close">&times;</button>
      </div>
      <div class="modal-body" style="padding:0">
        <div v-if="loading" class="tools-loading">{{ t('mcp.connecting') }}</div>
        <div v-else-if="tools.length === 0" class="tools-loading">{{ t('mcp.no_tools') }}</div>
        <template v-else>
          <div class="tools-approve-bar">
            <span class="tools-approve-label">{{ t('mcp.auto_approve') }}</span>
            <button v-if="!allApproved" class="btn-outline btn-sm" @click="emit('approve-all')">{{ t('mcp.approve_all') }}</button>
            <button v-else class="btn-outline btn-sm" @click="emit('revoke-all')">{{ t('mcp.revoke_all') }}</button>
          </div>
          <ul class="tools-list">
            <li v-for="(tool, i) in tools" :key="tool.name">
              <div class="tool-header">
                <div class="tool-name" :class="{ expanded: expandedTools.has(i) }" @click="toggleTool(i)">{{ tool.name }}</div>
                <label class="auto-approve-switch" :title="t('mcp.auto_approve')" @click.stop>
                  <input type="checkbox" :checked="autoApprovedTools.includes(tool.name)" @change="emit('toggle-auto-approve', tool.name)" />
                  <span class="switch-track"></span>
                  <span class="switch-label">{{ t('mcp.auto_approve') }}</span>
                </label>
              </div>
              <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
              <div class="tool-params" :class="{ show: expandedTools.has(i) }" v-html="renderToolParams((tool as any).parameters)"></div>
            </li>
          </ul>
        </template>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="close">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>
