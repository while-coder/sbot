<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/types'
import { renderToolParams } from '@/utils/mcpSchema'
import { SModal, SButton, SBadge, SSwitch, STabBar, STab } from 'sbot-ui'

defineProps<{
  visible: boolean
  title: string
  tools: McpTool[]
  prompts: McpPrompt[]
  resources: McpResource[]
  resourceTemplates: McpResourceTemplate[]
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

const activeTab = ref<'tools' | 'prompts' | 'resources'>('tools')
const expandedTools = reactive(new Set<number>())
const expandedPrompts = reactive(new Set<number>())
const expandedResources = reactive(new Set<string>())

function toggleTool(i: number) {
  if (expandedTools.has(i)) expandedTools.delete(i)
  else expandedTools.add(i)
}

function togglePrompt(i: number) {
  if (expandedPrompts.has(i)) expandedPrompts.delete(i)
  else expandedPrompts.add(i)
}

function toggleResource(key: string) {
  if (expandedResources.has(key)) expandedResources.delete(key)
  else expandedResources.add(key)
}

function close() {
  expandedTools.clear()
  expandedPrompts.clear()
  expandedResources.clear()
  activeTab.value = 'tools'
  emit('update:visible', false)
}
</script>

<template>
  <SModal :visible="visible" :title="title" width="lg" @update:visible="emit('update:visible', $event)" @close="close">
    <div v-if="loading" class="tools-loading">{{ t('mcp.connecting') }}</div>
    <template v-else>
      <STabBar v-model="activeTab">
        <STab name="tools" :count="tools.length">{{ t('mcp.tab_tools') }}</STab>
        <STab name="prompts" :count="prompts.length">{{ t('mcp.tab_prompts') }}</STab>
        <STab name="resources" :count="resources.length + resourceTemplates.length">{{ t('mcp.tab_resources') }}</STab>
      </STabBar>

      <!-- Tools Tab -->
      <div v-show="activeTab === 'tools'">
        <div v-if="tools.length === 0" class="tools-loading">{{ t('mcp.no_tools') }}</div>
        <template v-else>
          <div class="tools-approve-bar">
            <span class="tools-approve-label">{{ t('mcp.auto_approve') }}</span>
            <SButton v-if="!allApproved" type="outline" size="sm" @click="emit('approve-all')">{{ t('mcp.approve_all') }}</SButton>
            <SButton v-else type="outline" size="sm" @click="emit('revoke-all')">{{ t('mcp.revoke_all') }}</SButton>
          </div>
          <ul class="tools-list">
            <li v-for="(tool, i) in tools" :key="tool.name">
              <div class="tool-header">
                <div class="tool-name" :class="{ expanded: expandedTools.has(i) }" @click="toggleTool(i)">{{ tool.name }}</div>
                <SSwitch
                  :model-value="autoApprovedTools.includes(tool.name)"
                  :label="t('mcp.auto_approve')"
                  :title="t('mcp.auto_approve')"
                  @update:model-value="emit('toggle-auto-approve', tool.name)"
                  @click.stop
                />
              </div>
              <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
              <div class="tool-params" :class="{ show: expandedTools.has(i) }" v-html="renderToolParams((tool as any).parameters)"></div>
            </li>
          </ul>
        </template>
      </div>

      <!-- Prompts Tab -->
      <div v-show="activeTab === 'prompts'">
        <div v-if="prompts.length === 0" class="tools-loading">{{ t('mcp.no_prompts') }}</div>
        <ul v-else class="tools-list">
          <li v-for="(prompt, i) in prompts" :key="prompt.name">
            <div class="tool-header">
              <div class="tool-name" :class="{ expanded: expandedPrompts.has(i) }" @click="togglePrompt(i)">{{ prompt.name }}</div>
            </div>
            <div v-if="prompt.description" class="tool-desc">{{ prompt.description }}</div>
            <div class="tool-params" :class="{ show: expandedPrompts.has(i) }">
              <div v-if="prompt.arguments?.length" class="prompt-args">
                <div class="prompt-args-title">{{ t('mcp.prompt_args') }}</div>
                <div v-for="arg in prompt.arguments" :key="arg.name" class="prompt-arg-item">
                  <code>{{ arg.name }}</code>
                  <SBadge v-if="arg.required" variant="danger" size="xs">{{ t('mcp.prompt_required') }}</SBadge>
                  <span v-if="arg.description" class="prompt-arg-desc">{{ arg.description }}</span>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Resources Tab -->
      <div v-show="activeTab === 'resources'">
        <div v-if="resources.length === 0 && resourceTemplates.length === 0" class="tools-loading">{{ t('mcp.no_resources') }}</div>
        <ul v-else class="tools-list">
          <li v-for="res in resources" :key="res.uri">
            <div class="tool-header">
              <div class="tool-name" :class="{ expanded: expandedResources.has(res.uri) }" @click="toggleResource(res.uri)">{{ res.name }}</div>
            </div>
            <div v-if="res.description" class="tool-desc">{{ res.description }}</div>
            <div class="tool-params" :class="{ show: expandedResources.has(res.uri) }">
              <div class="resource-meta">
                <span class="resource-label">{{ t('mcp.resource_uri') }}:</span>
                <code class="resource-uri">{{ res.uri }}</code>
                <SBadge v-if="res.mimeType" variant="info" size="xs">{{ res.mimeType }}</SBadge>
              </div>
            </div>
          </li>
          <li v-for="tmpl in resourceTemplates" :key="tmpl.uriTemplate" class="resource-template-item">
            <div class="tool-header">
              <div class="tool-name" :class="{ expanded: expandedResources.has(tmpl.uriTemplate) }" style="display:inline-flex; gap:6px; align-items:center" @click="toggleResource(tmpl.uriTemplate)">
                {{ tmpl.name }}
                <SBadge variant="warning" size="xs">{{ t('mcp.resource_template') }}</SBadge>
              </div>
            </div>
            <div v-if="tmpl.description" class="tool-desc">{{ tmpl.description }}</div>
            <div class="tool-params" :class="{ show: expandedResources.has(tmpl.uriTemplate) }">
              <div class="resource-meta">
                <span class="resource-label">{{ t('mcp.resource_uri') }}:</span>
                <code class="resource-uri">{{ tmpl.uriTemplate }}</code>
                <SBadge v-if="tmpl.mimeType" variant="info" size="xs">{{ tmpl.mimeType }}</SBadge>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <SButton type="outline" @click="close">{{ t('common.close') }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.prompt-args {
  padding: var(--sui-sp-3) var(--sui-sp-5);
}
.prompt-args-title {
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-2);
  text-transform: uppercase;
}
.prompt-arg-item {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-1) 0;
  font-size: var(--sui-fs-sm);
}
.prompt-arg-item code {
  font-family: var(--sui-font-mono);
  background: var(--sui-bg-soft);
  padding: 1px var(--sui-sp-2);
  border-radius: var(--sui-radius-xs);
  font-size: var(--sui-fs-sm);
}
.prompt-arg-desc {
  color: var(--sui-fg-muted);
}
.resource-meta {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-1) 0;
  font-size: var(--sui-fs-sm);
}
.resource-label {
  color: var(--sui-fg-muted);
  font-weight: 500;
}
.resource-uri {
  font-family: var(--sui-font-mono);
  background: var(--sui-bg-soft);
  padding: 1px var(--sui-sp-2);
  border-radius: var(--sui-radius-xs);
  font-size: var(--sui-fs-xs);
  word-break: break-all;
}
</style>
