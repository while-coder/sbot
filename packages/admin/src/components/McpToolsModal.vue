<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/types'
import { renderToolParams } from '@/utils/mcpSchema'

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

function toggleTool(i: number) {
  if (expandedTools.has(i)) expandedTools.delete(i)
  else expandedTools.add(i)
}

function togglePrompt(i: number) {
  if (expandedPrompts.has(i)) expandedPrompts.delete(i)
  else expandedPrompts.add(i)
}

function close() {
  expandedTools.clear()
  expandedPrompts.clear()
  activeTab.value = 'tools'
  emit('update:visible', false)
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-box wide">
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="modal-close" @click="close">&times;</button>
      </div>
      <div class="modal-body" style="padding:0">
        <div v-if="loading" class="tools-loading">{{ t('mcp.connecting') }}</div>
        <template v-else>
          <!-- Tabs -->
          <div class="mcp-tabs">
            <button
              class="mcp-tab"
              :class="{ active: activeTab === 'tools' }"
              @click="activeTab = 'tools'"
            >
              {{ t('mcp.tab_tools') }}
              <span class="tab-count">{{ tools.length }}</span>
            </button>
            <button
              class="mcp-tab"
              :class="{ active: activeTab === 'prompts' }"
              @click="activeTab = 'prompts'"
            >
              {{ t('mcp.tab_prompts') }}
              <span class="tab-count">{{ prompts.length }}</span>
            </button>
            <button
              class="mcp-tab"
              :class="{ active: activeTab === 'resources' }"
              @click="activeTab = 'resources'"
            >
              {{ t('mcp.tab_resources') }}
              <span class="tab-count">{{ resources.length + resourceTemplates.length }}</span>
            </button>
          </div>

          <!-- Tools Tab -->
          <div v-show="activeTab === 'tools'">
            <div v-if="tools.length === 0" class="tools-loading">{{ t('mcp.no_tools') }}</div>
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
                      <span v-if="arg.required" class="prompt-required">{{ t('mcp.prompt_required') }}</span>
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
                  <div class="tool-name" style="cursor:default">{{ res.name }}</div>
                </div>
                <div v-if="res.description" class="tool-desc">{{ res.description }}</div>
                <div class="resource-meta">
                  <span class="resource-label">{{ t('mcp.resource_uri') }}:</span>
                  <code class="resource-uri">{{ res.uri }}</code>
                  <span v-if="res.mimeType" class="resource-mime">{{ res.mimeType }}</span>
                </div>
              </li>
              <li v-for="tmpl in resourceTemplates" :key="tmpl.uriTemplate" class="resource-template-item">
                <div class="tool-header">
                  <div class="tool-name" style="cursor:default">
                    {{ tmpl.name }}
                    <span class="resource-template-badge">{{ t('mcp.resource_template') }}</span>
                  </div>
                </div>
                <div v-if="tmpl.description" class="tool-desc">{{ tmpl.description }}</div>
                <div class="resource-meta">
                  <span class="resource-label">{{ t('mcp.resource_uri') }}:</span>
                  <code class="resource-uri">{{ tmpl.uriTemplate }}</code>
                  <span v-if="tmpl.mimeType" class="resource-mime">{{ tmpl.mimeType }}</span>
                </div>
              </li>
            </ul>
          </div>
        </template>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="close">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-tabs {
  display: flex;
  border-bottom: 1px solid #e8e6e3;
  padding: 0 16px;
  background: #fafaf9;
}
.mcp-tab {
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #9b9b9b;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s;
}
.mcp-tab.active {
  color: #1c1c1c;
  border-bottom-color: #1c1c1c;
}
.tab-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 5px;
  border-radius: 10px;
  font-weight: 600;
  background: #f0efed;
  color: #6b6b6b;
}
.mcp-tab.active .tab-count {
  background: #1c1c1c;
  color: #fff;
}
.prompt-args {
  padding: 8px 12px;
}
.prompt-args-title {
  font-size: 11px;
  font-weight: 600;
  color: #6b6b6b;
  margin-bottom: 6px;
  text-transform: uppercase;
}
.prompt-arg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
.prompt-arg-item code {
  font-family: monospace;
  background: #f5f5f4;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
.prompt-required {
  font-size: 10px;
  padding: 1px 5px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 3px;
  font-weight: 500;
}
.prompt-arg-desc {
  color: #64748b;
}
.resource-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
}
.resource-label {
  color: #6b6b6b;
  font-weight: 500;
}
.resource-uri {
  font-family: monospace;
  background: #f5f5f4;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  word-break: break-all;
}
.resource-mime {
  font-size: 10px;
  padding: 1px 5px;
  background: #eff6ff;
  color: #2563eb;
  border-radius: 3px;
}
.resource-template-badge {
  font-size: 10px;
  padding: 1px 5px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 3px;
  margin-left: 6px;
  font-weight: 500;
}
</style>
