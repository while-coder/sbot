<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast, SButton, SCard, SPageToolbar, SPageContent } from 'sbot-ui'
import AgentModal from './AgentModal.vue'
import AgentMcpModal from './AgentMcpModal.vue'
import AgentSkillsModal from './AgentSkillsModal.vue'
import McpToolsModal from '@/components/McpToolsModal.vue'
import SkillViewerModal from '@/components/SkillViewerModal.vue'
import type { SkillItem, McpItem, McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/types'
import { sourceBadgeStyle, badgePrivate } from '@/utils/badges'
import { serverAddr } from '@/utils/mcpSchema'
import { useResponsive } from '../../composables/useResponsive'

const { t } = useI18n()
const { isMobile } = useResponsive()
const { show } = useToast()

const agents = computed(() => store.settings.agents || {})
const sortedAgentEntries = computed(() => {
  const entries = Object.entries(agents.value)
  return entries.sort(([, a], [, b]) => {
    const order = (type: string) => type === 'react' ? 0 : type === 'single' ? 1 : type === 'acp' ? 2 : type === 'generative' ? 3 : 4
    return order(a.type) - order(b.type)
  })
})
const modelName = (id: string) => (store.settings.models?.[id] as any)?.name || id

const agentModal       = ref<InstanceType<typeof AgentModal>>()
const agentMcpModal    = ref<InstanceType<typeof AgentMcpModal>>()
const agentSkillsModal = ref<InstanceType<typeof AgentSkillsModal>>()

const expandedIds   = ref<Set<string>>(new Set())
const activeTabs    = ref<Record<string, 'config' | 'skills' | 'mcp'>>({})
const skillsMap     = ref<Record<string, SkillItem[]>>({})
const mcpServersMap = ref<Record<string, McpItem[]>>({})

function isExpanded(id: string) { return expandedIds.value.has(id) }
function getTab(id: string): 'config' | 'skills' | 'mcp' { return activeTabs.value[id] ?? 'config' }
function getSkills(id: string)  { return skillsMap.value[id]     ?? [] }
function getGlobals(id: string) {
  const skills = (store.settings.agents || {})[id]?.skills
  if (skills === '*') return store.allSkills
  const ids = new Set<string>(skills ?? [])
  return store.allSkills.filter((s: SkillItem) => ids.has(s.name))
}
function getMcpServers(id: string) { return mcpServersMap.value[id] ?? [] }

function getMcpGlobals(id: string) {
  const mcp = (store.settings.agents || {})[id]?.mcp
  if (mcp === '*') return store.allMcps
  const ids = new Set<string>(mcp ?? [])
  return store.allMcps.filter((m: McpItem) => ids.has(m.id))
}

async function loadSkills(id: string) {
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/skills`)
    skillsMap.value[id] = res.data?.skills || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadMcp(id: string) {
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/mcp`)
    mcpServersMap.value[id] = res.data?.servers || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
    expandedIds.value = new Set(expandedIds.value)
    return
  }
  expandedIds.value = new Set([...expandedIds.value, id])
  if (!activeTabs.value[id]) activeTabs.value[id] = 'config'
  await Promise.all([loadSkills(id), loadMcp(id)])
}

function switchTab(id: string, tab: 'config' | 'skills' | 'mcp') {
  activeTabs.value[id] = tab
  if (tab === 'skills') loadSkills(id)
  if (tab === 'mcp')    loadMcp(id)
}

async function exportAgent(id: string) {
  try {
    const res = await apiFetch(`/api/agent-store/export?id=${encodeURIComponent(id)}`)
    const pkg = res.data ?? res
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pkg.name || id}.json`
    a.click()
    URL.revokeObjectURL(url)
    show(t('agentStore.export_success'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function removeAgent(id: string) {
  const label = (agents.value[id] as any)?.name || id
  if (!window.confirm(t('agents.confirm_delete', { name: label }))) return
  try {
    await apiFetch(`/api/agents/${encodeURIComponent(id)}`, 'DELETE')
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
    expandedIds.value.delete(id)
    expandedIds.value = new Set(expandedIds.value)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const skillViewRef = ref<InstanceType<typeof SkillViewerModal>>()

function openSkillView(agentId: string, name: string, isPrivate: boolean) {
  const badge = isPrivate ? t('agents.skills_exclusive_tab') : ''
  const apiBase = isPrivate ? `/api/agents/${encodeURIComponent(agentId)}/skills` : '/api/skills'
  skillViewRef.value?.open(name, badge, apiBase)
}

const showToolsModal = ref(false)
const toolsTitle     = ref('')
const toolsList      = ref<McpTool[]>([])
const promptsList    = ref<McpPrompt[]>([])
const resourcesList  = ref<McpResource[]>([])
const resourceTemplatesList = ref<McpResourceTemplate[]>([])
const toolsLoading   = ref(false)
const toolsAgentId   = ref('')

async function openMcpView(agentId: string, id: string, isPrivate: boolean) {
  toolsTitle.value   = isPrivate
    ? (getMcpServers(agentId).find(s => s.id === id)?.name || id)
    : (store.allMcps.find((m: McpItem) => m.id === id)?.name || id)
  toolsList.value    = []
  promptsList.value  = []
  resourcesList.value = []
  resourceTemplatesList.value = []
  toolsLoading.value = true
  toolsAgentId.value = agentId
  showToolsModal.value = true
  const url = isPrivate
    ? `/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(id)}/details`
    : `/api/mcp/${encodeURIComponent(id)}/details`
  try {
    const res = await apiFetch(url, 'GET')
    toolsList.value = res.data?.tools || []
    promptsList.value = res.data?.prompts || []
    resourcesList.value = res.data?.resources || []
    resourceTemplatesList.value = res.data?.resourceTemplates || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
  }
}

function getAgentAutoApproveTools(): string[] {
  return ((store.settings.agents || {})[toolsAgentId.value] as any)?.autoApproveTools ?? []
}

const allToolsApproved = computed(() =>
  toolsList.value.length > 0 && toolsList.value.every(tool => getAgentAutoApproveTools().includes(tool.name))
)

async function saveAutoApprove(next: string[]) {
  try {
    const existing = (store.settings.agents || {})[toolsAgentId.value] || {}
    await apiFetch(
      `/api/agents/${encodeURIComponent(toolsAgentId.value)}`,
      'PUT',
      { ...existing, autoApproveTools: next },
    )
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function toggleAutoApprove(toolName: string) {
  const current = getAgentAutoApproveTools()
  const next = current.includes(toolName)
    ? current.filter((n: string) => n !== toolName)
    : [...current, toolName]
  await saveAutoApprove(next)
}

async function approveAll() {
  const names = toolsList.value.map(t => t.name)
  const current = getAgentAutoApproveTools()
  const next = Array.from(new Set([...current, ...names]))
  await saveAutoApprove(next)
}

async function revokeAll() {
  const names = new Set(toolsList.value.map(t => t.name))
  const next = getAgentAutoApproveTools().filter((n: string) => !names.has(n))
  await saveAutoApprove(next)
}

async function refresh() {
  try {
    const res    = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const mcpRes = await apiFetch('/api/mcp')
    applyMcpList(mcpRes.data || [])
    const skillRes = await apiFetch('/api/skills')
    store.allSkills = skillRes.data || []
    await Promise.all(
      [...expandedIds.value].flatMap(id => [loadSkills(id), loadMcp(id)])
    )
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function tabsForAgent(id: string, type: string): { key: 'config' | 'skills' | 'mcp'; label: string }[] {
  const tabs: { key: 'config' | 'skills' | 'mcp'; label: string }[] = [{ key: 'config', label: t('agents.tab_config') }]
  if (type !== 'acp') {
    tabs.push({ key: 'skills', label: `${t('agents.tab_skills')} (${getSkills(id).length + getGlobals(id).length})` })
    tabs.push({ key: 'mcp', label: `${t('agents.tab_tools')} (${getMcpGlobals(id).length + getMcpServers(id).length})` })
  }
  return tabs
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="agentModal?.open()">{{ t('agents.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th class="col-toggle"></th>
            <th>{{ t('agents.name_col') }}</th>
            <th>{{ t('agents.type_col') }}</th>
            <th>{{ t('agents.model_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="sortedAgentEntries.length === 0">
            <td colspan="5" class="agents-empty">{{ t('agents.empty') }}</td>
          </tr>

          <template v-for="[id, a] in sortedAgentEntries" :key="id">
            <tr
              @click="toggleExpand(id as string)"
              class="agent-row"
              :class="{ 'agent-row-expanded': isExpanded(id as string) }"
            >
              <td class="col-toggle col-toggle-cell">
                <span class="toggle-icon">{{ isExpanded(id as string) ? '▼' : '▶' }}</span>
              </td>
              <td>
                <span class="agent-name">{{ (a as any).name || id }}</span>
                <span v-if="(a as any).id" class="config-badge config-badge-id">{{ (a as any).id }}</span>
                <span v-if="a.skills === '*'" class="config-badge config-badge-info">{{ t('agents.tab_skills') }} *</span>
                <span v-if="a.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.tab_tools') }} *</span>
                <span v-if="(a as any).autoApproveAllTools" class="config-badge config-badge-warn">{{ t('agents.auto_approve_all_tools') }}</span>
              </td>
              <td><span :class="'agent-type-badge agent-type-' + a.type">{{ a.type }}</span></td>
              <td>
                <template v-if="a.type === 'acp'">
                  <span class="acp-command">{{ (a as any).command }}</span>
                </template>
                <template v-else>{{ a.model ? modelName(a.model) : '-' }}</template>
              </td>
              <td @click.stop>
                <div class="ops-cell">
                  <SButton type="outline" size="sm" @click="agentModal?.open(id as string)">{{ t('common.edit') }}</SButton>
                  <SButton v-if="a.type !== 'acp'" type="outline" size="sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.tab_tools') }}</SButton>
                  <SButton v-if="a.type !== 'acp'" type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.tab_skills') }}</SButton>
                  <SButton type="outline" size="sm" @click="exportAgent(id as string)">{{ t('agentStore.export_btn') }}</SButton>
                  <SButton type="danger" size="sm" @click="removeAgent(id as string)">{{ t('common.delete') }}</SButton>
                </div>
              </td>
            </tr>

            <tr v-if="isExpanded(id as string)">
              <td colspan="5" class="agent-detail-cell">
                <div class="agent-tab-bar">
                  <button
                    v-for="tab in tabsForAgent(id as string, a.type)"
                    :key="tab.key"
                    @click="switchTab(id as string, tab.key)"
                    class="agent-tab"
                    :class="{ active: getTab(id as string) === tab.key }"
                  >{{ tab.label }}</button>
                </div>

                <div class="agent-tab-content">
                  <template v-if="getTab(id as string) === 'config'">
                    <SCard :title="t('agents.basic_info')" class="agent-info-card">
                      <table class="agent-info-table">
                        <tbody>
                          <tr>
                            <td class="info-label">{{ t('common.id') }}</td>
                            <td class="info-value mono">{{ id }}</td>
                          </tr>
                          <tr v-if="(a as any).name">
                            <td class="info-label">{{ t('common.name') }}</td>
                            <td class="info-value">{{ (a as any).name }}</td>
                          </tr>
                          <tr>
                            <td class="info-label">{{ t('common.type') }}</td>
                            <td class="info-value"><span class="type-tag">{{ a.type }}</span></td>
                          </tr>
                          <template v-if="a.type === 'acp'">
                            <tr>
                              <td class="info-label">{{ t('agents.acp_command') }}</td>
                              <td class="info-value mono">{{ (a as any).command }}</td>
                            </tr>
                            <tr v-if="(a as any).args?.length">
                              <td class="info-label">{{ t('agents.acp_args') }}</td>
                              <td class="info-value mono">{{ (a as any).args.join(' ') }}</td>
                            </tr>
                            <tr>
                              <td class="info-label">{{ t('agents.acp_session_mode') }}</td>
                              <td class="info-value"><span class="type-tag">{{ (a as any).sessionMode || 'persistent' }}</span></td>
                            </tr>
                            <tr v-if="(a as any).env && Object.keys((a as any).env).length">
                              <td class="info-label">{{ t('agents.acp_env') }}</td>
                              <td class="info-value">
                                <div v-for="(v, k) in (a as any).env" :key="k" class="env-line">{{ k }}={{ v }}</div>
                              </td>
                            </tr>
                          </template>
                          <template v-else>
                            <tr v-if="a.model">
                              <td class="info-label">{{ t('agents.model_col') }}</td>
                              <td class="info-value">{{ modelName(a.model) }}</td>
                            </tr>
                            <tr v-if="(a as any).saver">
                              <td class="info-label">{{ t('agents.storage_label') }}</td>
                              <td class="info-value mono">{{ (a as any).saver }}</td>
                            </tr>
                            <tr>
                              <td class="info-label">{{ t('agents.tab_skills') }}</td>
                              <td class="info-value">
                                <span v-if="a.skills === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                                <span v-else-if="Array.isArray(a.skills) && a.skills.length" class="info-count">{{ a.skills.length }} {{ t('agents.items_selected') }}</span>
                                <span v-else class="info-dash">-</span>
                              </td>
                            </tr>
                            <tr>
                              <td class="info-label">{{ t('agents.tab_tools') }}</td>
                              <td class="info-value">
                                <span v-if="a.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                                <span v-else-if="Array.isArray(a.mcp) && a.mcp.length" class="info-count">{{ a.mcp.length }} {{ t('agents.items_selected') }}</span>
                                <span v-else class="info-dash">-</span>
                              </td>
                            </tr>
                            <tr v-if="(a as any).autoApproveAllTools">
                              <td class="info-label">{{ t('agents.auto_approve_all_tools') }}</td>
                              <td class="info-value"><span class="config-badge config-badge-warn">ON</span></td>
                            </tr>
                          </template>
                        </tbody>
                      </table>
                    </SCard>

                    <SCard v-if="(a as any).systemPrompt" :title="t('agents.system_prompt')" class="agent-info-card">
                      <pre class="agent-system-prompt">{{ (a as any).systemPrompt }}</pre>
                    </SCard>

                    <template v-if="a.type === 'react'">
                      <SCard v-if="((a as any).agents as any[] | undefined)?.length" :title="t('agents.sub_agents')" class="agent-info-card">
                        <div v-for="sub in ((a as any).agents as any[])" :key="sub.id" class="sub-agent-item">
                          <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ (agents[sub.id] as any)?.name || sub.id }}</span></div>
                          <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                        </div>
                      </SCard>
                    </template>
                  </template>

                  <template v-else-if="getTab(id as string) === 'skills'">
                    <div class="manage-row">
                      <SButton type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.manage_skills') }}</SButton>
                      <div class="manage-hint">{{ t('agents.agent_skills') }}</div>
                    </div>
                    <div v-if="getGlobals(id as string).length === 0 && getSkills(id as string).length === 0" class="tab-empty">
                      {{ t('agents.no_skills') }}
                      <div class="tab-empty-action">
                        <SButton type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.configure_skills') }}</SButton>
                      </div>
                    </div>
                    <table v-else class="agent-detail-table">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th class="col-nowrap">{{ t('common.ops') }}</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getGlobals(id as string)" :key="'g-' + s.name">
                          <td class="cell-mono cell-truncate">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                          <td class="col-nowrap"><SButton type="outline" size="sm" @click="openSkillView(id as string, s.name, false)">{{ t('common.view') }}</SButton></td>
                        </tr>
                        <tr v-for="s in getSkills(id as string)" :key="s.name">
                          <td class="cell-mono cell-truncate">{{ s.name }}</td>
                          <td><span :style="badgePrivate()">{{ t('agents.skills_exclusive_tab') }}</span></td>
                          <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                          <td class="col-nowrap"><SButton type="outline" size="sm" @click="openSkillView(id as string, s.name, true)">{{ t('common.view') }}</SButton></td>
                        </tr>
                      </tbody>
                    </table>
                  </template>

                  <template v-else-if="getTab(id as string) === 'mcp'">
                    <div class="manage-row">
                      <SButton type="outline" size="sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.manage_tools') }}</SButton>
                      <div class="manage-hint">{{ t('agents.agent_mcps') }}</div>
                    </div>
                    <table class="agent-detail-table">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:180px" /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th>{{ t('mcp.address_col') }}</th><th class="col-nowrap">{{ t('common.ops') }}</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getMcpGlobals(id as string)" :key="'g-' + s.id">
                          <td class="cell-mono cell-truncate">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                          <td class="cell-addr cell-truncate">{{ serverAddr(s as any) }}</td>
                          <td class="col-nowrap"><SButton type="outline" size="sm" @click="openMcpView(id as string, s.id, false)">{{ t('common.view') }}</SButton></td>
                        </tr>
                        <tr v-for="s in getMcpServers(id as string)" :key="'s-' + s.id">
                          <td class="cell-mono cell-truncate">{{ s.name }}</td>
                          <td><span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(t('agents.mcp_exclusive_tab'))}`">{{ t('agents.mcp_exclusive_tab') }}</span></td>
                          <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                          <td class="cell-addr-priv cell-truncate">{{ serverAddr(s as any) }}</td>
                          <td class="col-nowrap"><SButton type="outline" size="sm" @click="openMcpView(id as string, s.id, true)">{{ t('common.view') }}</SButton></td>
                        </tr>
                      </tbody>
                    </table>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <div v-else class="card-list">
        <div v-for="[id, a] in sortedAgentEntries" :key="id" class="mobile-card">
          <div class="mobile-card-header agent-mobile-header" @click="toggleExpand(id as string)">
            <span>
              {{ (a as any).name || id }}
              <span v-if="a.skills === '*'" class="config-badge config-badge-info">{{ t('agents.tab_skills') }} *</span>
              <span v-if="a.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.tab_tools') }} *</span>
              <span v-if="(a as any).autoApproveAllTools" class="config-badge config-badge-warn">{{ t('agents.auto_approve_all_tools') }}</span>
            </span>
            <span class="toggle-icon">{{ isExpanded(id as string) ? '▼' : '▶' }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('agents.type_col') }}</span>
            <span class="mobile-card-value"><span :class="'agent-type-badge agent-type-' + a.type">{{ a.type }}</span></span>
            <span class="mobile-card-label">{{ a.type === 'acp' ? t('agents.acp_command') : t('agents.model_col') }}</span>
            <span class="mobile-card-value">
              <template v-if="a.type === 'acp'"><span class="acp-command">{{ (a as any).command }}</span></template>
              <template v-else>{{ a.model ? modelName(a.model) : '-' }}</template>
            </span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="outline" size="sm" @click="agentModal?.open(id as string)">{{ t('common.edit') }}</SButton>
            <SButton v-if="a.type !== 'acp'" type="outline" size="sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.tab_tools') }}</SButton>
            <SButton v-if="a.type !== 'acp'" type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.tab_skills') }}</SButton>
            <SButton type="outline" size="sm" @click="exportAgent(id as string)">{{ t('agentStore.export_btn') }}</SButton>
            <SButton type="danger" size="sm" @click="removeAgent(id as string)">{{ t('common.delete') }}</SButton>
          </div>

          <div v-if="isExpanded(id as string)" class="agent-mobile-detail">
            <div class="agent-tab-bar agent-tab-bar-mobile">
              <button
                v-for="tab in tabsForAgent(id as string, a.type)"
                :key="tab.key"
                @click="switchTab(id as string, tab.key)"
                class="agent-tab"
                :class="{ active: getTab(id as string) === tab.key }"
              >{{ tab.label }}</button>
            </div>

            <div class="agent-tab-content agent-tab-content-mobile">
              <template v-if="getTab(id as string) === 'config'">
                <SCard :title="t('agents.basic_info')" class="agent-info-card">
                  <table class="agent-info-table">
                    <tbody>
                      <tr>
                        <td class="info-label">{{ t('common.id') }}</td>
                        <td class="info-value mono">{{ id }}</td>
                      </tr>
                      <tr v-if="(a as any).name">
                        <td class="info-label">{{ t('common.name') }}</td>
                        <td class="info-value">{{ (a as any).name }}</td>
                      </tr>
                      <tr>
                        <td class="info-label">{{ t('common.type') }}</td>
                        <td class="info-value"><span class="type-tag">{{ a.type }}</span></td>
                      </tr>
                      <template v-if="a.type === 'acp'">
                        <tr>
                          <td class="info-label">{{ t('agents.acp_command') }}</td>
                          <td class="info-value mono">{{ (a as any).command }}</td>
                        </tr>
                        <tr v-if="(a as any).args?.length">
                          <td class="info-label">{{ t('agents.acp_args') }}</td>
                          <td class="info-value mono">{{ (a as any).args.join(' ') }}</td>
                        </tr>
                        <tr>
                          <td class="info-label">{{ t('agents.acp_session_mode') }}</td>
                          <td class="info-value"><span class="type-tag">{{ (a as any).sessionMode || 'persistent' }}</span></td>
                        </tr>
                        <tr v-if="(a as any).env && Object.keys((a as any).env).length">
                          <td class="info-label">{{ t('agents.acp_env') }}</td>
                          <td class="info-value">
                            <div v-for="(v, k) in (a as any).env" :key="k" class="env-line">{{ k }}={{ v }}</div>
                          </td>
                        </tr>
                      </template>
                      <template v-else>
                        <tr v-if="a.model">
                          <td class="info-label">{{ t('agents.model_col') }}</td>
                          <td class="info-value">{{ modelName(a.model) }}</td>
                        </tr>
                        <tr v-if="(a as any).saver">
                          <td class="info-label">{{ t('agents.storage_label') }}</td>
                          <td class="info-value mono">{{ (a as any).saver }}</td>
                        </tr>
                        <tr>
                          <td class="info-label">{{ t('agents.tab_skills') }}</td>
                          <td class="info-value">
                            <span v-if="a.skills === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                            <span v-else-if="Array.isArray(a.skills) && a.skills.length" class="info-count">{{ a.skills.length }} {{ t('agents.items_selected') }}</span>
                            <span v-else class="info-dash">-</span>
                          </td>
                        </tr>
                        <tr>
                          <td class="info-label">{{ t('agents.tab_tools') }}</td>
                          <td class="info-value">
                            <span v-if="a.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                            <span v-else-if="Array.isArray(a.mcp) && a.mcp.length" class="info-count">{{ a.mcp.length }} {{ t('agents.items_selected') }}</span>
                            <span v-else class="info-dash">-</span>
                          </td>
                        </tr>
                        <tr v-if="(a as any).autoApproveAllTools">
                          <td class="info-label">{{ t('agents.auto_approve_all_tools') }}</td>
                          <td class="info-value"><span class="config-badge config-badge-warn">ON</span></td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </SCard>

                <SCard v-if="(a as any).systemPrompt" :title="t('agents.system_prompt')" class="agent-info-card">
                  <pre class="agent-system-prompt">{{ (a as any).systemPrompt }}</pre>
                </SCard>

                <template v-if="a.type === 'react'">
                  <SCard v-if="((a as any).agents as any[] | undefined)?.length" :title="t('agents.sub_agents')" class="agent-info-card">
                    <div v-for="sub in ((a as any).agents as any[])" :key="sub.id" class="sub-agent-item">
                      <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ (agents[sub.id] as any)?.name || sub.id }}</span></div>
                      <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                    </div>
                  </SCard>
                </template>
              </template>

              <template v-else-if="getTab(id as string) === 'skills'">
                <div class="manage-row">
                  <SButton type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.manage_skills') }}</SButton>
                  <div class="manage-hint">{{ t('agents.agent_skills') }}</div>
                </div>
                <div v-if="getGlobals(id as string).length === 0 && getSkills(id as string).length === 0" class="tab-empty">
                  {{ t('agents.no_skills') }}
                  <div class="tab-empty-action">
                    <SButton type="outline" size="sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.configure_skills') }}</SButton>
                  </div>
                </div>
                <table v-else class="agent-detail-table">
                  <colgroup>
                    <col /><col style="width:60px" /><col /><col style="width:70px" />
                  </colgroup>
                  <thead>
                    <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th class="col-nowrap">{{ t('common.ops') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in getGlobals(id as string)" :key="'g-' + s.name">
                      <td class="cell-mono cell-truncate">{{ s.name }}</td>
                      <td>
                        <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                      </td>
                      <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                      <td class="col-nowrap"><SButton type="outline" size="sm" @click="openSkillView(id as string, s.name, false)">{{ t('common.view') }}</SButton></td>
                    </tr>
                    <tr v-for="s in getSkills(id as string)" :key="s.name">
                      <td class="cell-mono cell-truncate">{{ s.name }}</td>
                      <td><span :style="badgePrivate()">{{ t('agents.skills_exclusive_tab') }}</span></td>
                      <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                      <td class="col-nowrap"><SButton type="outline" size="sm" @click="openSkillView(id as string, s.name, true)">{{ t('common.view') }}</SButton></td>
                    </tr>
                  </tbody>
                </table>
              </template>

              <template v-else-if="getTab(id as string) === 'mcp'">
                <div class="manage-row">
                  <SButton type="outline" size="sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.manage_tools') }}</SButton>
                  <div class="manage-hint">{{ t('agents.agent_mcps') }}</div>
                </div>
                <table class="agent-detail-table">
                  <colgroup>
                    <col /><col style="width:60px" /><col /><col style="width:180px" /><col style="width:70px" />
                  </colgroup>
                  <thead>
                    <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th>{{ t('mcp.address_col') }}</th><th class="col-nowrap">{{ t('common.ops') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in getMcpGlobals(id as string)" :key="'g-' + s.id">
                      <td class="cell-mono cell-truncate">{{ s.name }}</td>
                      <td>
                        <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                      </td>
                      <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                      <td class="cell-addr cell-truncate">{{ serverAddr(s as any) }}</td>
                      <td class="col-nowrap"><SButton type="outline" size="sm" @click="openMcpView(id as string, s.id, false)">{{ t('common.view') }}</SButton></td>
                    </tr>
                    <tr v-for="s in getMcpServers(id as string)" :key="'s-' + s.id">
                      <td class="cell-mono cell-truncate">{{ s.name }}</td>
                      <td><span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(t('agents.mcp_exclusive_tab'))}`">{{ t('agents.mcp_exclusive_tab') }}</span></td>
                      <td class="cell-desc cell-truncate">{{ s.description || '-' }}</td>
                      <td class="cell-addr-priv cell-truncate">{{ serverAddr(s as any) }}</td>
                      <td class="col-nowrap"><SButton type="outline" size="sm" @click="openMcpView(id as string, s.id, true)">{{ t('common.view') }}</SButton></td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </div>
          </div>
        </div>
        <div v-if="sortedAgentEntries.length === 0" class="mobile-card-empty">-</div>
      </div>
    </SPageContent>

    <AgentModal ref="agentModal" />
    <AgentMcpModal ref="agentMcpModal" />
    <AgentSkillsModal ref="agentSkillsModal" @saved="(id) => loadSkills(id)" />

    <McpToolsModal
      :visible="showToolsModal"
      :title="toolsTitle"
      :tools="toolsList"
      :prompts="promptsList"
      :resources="resourcesList"
      :resource-templates="resourceTemplatesList"
      :loading="toolsLoading"
      :auto-approved-tools="getAgentAutoApproveTools()"
      :all-approved="allToolsApproved"
      @update:visible="showToolsModal = $event"
      @toggle-auto-approve="toggleAutoApprove"
      @approve-all="approveAll"
      @revoke-all="revokeAll"
    />

    <SkillViewerModal ref="skillViewRef" />
  </div>
</template>

<style scoped>
.col-toggle { width: 32px; }
.col-toggle-cell { padding: 6px 8px; text-align: center; }
.col-nowrap { white-space: nowrap; }
.toggle-icon {
  color: var(--sui-fg-muted);
  font-size: 10px;
}
.agent-row { cursor: pointer; }
.agent-row-expanded > td { background: var(--sui-bg-subtle); }
.agent-detail-cell {
  padding: 0;
  border-bottom: 2px solid var(--sui-border);
}
.agents-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}

.agent-name {
  font-weight: 500;
  color: var(--sui-fg);
}
.acp-command {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  color: #0f766e;
}

.agent-type-badge {
  display: inline-block;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--sui-radius-sm);
}
.agent-type-react { background: #ede9fe; color: #6d28d9; }
.agent-type-single { background: #f0f4f8; color: #64748b; }
.agent-type-generative { background: #fef3c7; color: #b45309; }
.agent-type-acp { background: #ccfbf1; color: #0f766e; }

.config-badge {
  display: inline-block;
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: var(--sui-sp-3);
  vertical-align: middle;
}
.config-badge-id { background: #e0f2fe; color: #0369a1; }
.config-badge-info { background: #dbeafe; color: #1d4ed8; }
.config-badge-warn { background: #fef3c7; color: #b45309; }

/* Detail tabs */
.agent-tab-bar {
  display: flex;
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg-subtle);
  padding: 0 var(--sui-sp-6);
}
.agent-tab-bar-mobile { padding: 0 var(--sui-sp-4); }
.agent-tab {
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
.agent-tab.active { color: var(--sui-fg); border-bottom-color: var(--sui-fg); }
.agent-tab-content {
  padding: var(--sui-sp-5) var(--sui-sp-6);
  max-height: 480px;
  overflow: auto;
  background: var(--sui-bg-subtle);
}
.agent-tab-content-mobile { padding: var(--sui-sp-4) var(--sui-sp-4); }
.agent-mobile-detail { margin-top: var(--sui-sp-4); }
.agent-mobile-header {
  display: flex;
  justify-content: space-between;
  cursor: pointer;
}

/* Info table */
.agent-info-card { margin-bottom: var(--sui-sp-4); }
.agent-info-table { margin: 0; }
.agent-info-table .info-label {
  width: 140px;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 7px 12px;
}
.agent-info-table .info-value {
  padding: 7px 12px;
  color: var(--sui-fg);
}
.agent-info-table .info-value.mono { font-family: var(--sui-font-mono); }
.type-tag {
  font-family: var(--sui-font-mono);
  background: var(--sui-bg-hover);
  padding: 1px 8px;
  border-radius: var(--sui-radius-sm);
  font-size: var(--sui-fs-sm);
}
.env-line {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
}
.info-count {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-secondary);
}
.info-dash {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}

.agent-system-prompt {
  margin: 0;
  padding: var(--sui-sp-4);
  background: var(--sui-bg-subtle);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--sui-fg);
  max-height: 220px;
  overflow: auto;
}

.sub-agent-item {
  padding: var(--sui-sp-3) 0;
  border-bottom: 1px solid var(--sui-border);
}
.sub-agent-item:last-child { border-bottom: none; }
.sub-agent-item-header { margin-bottom: 2px; }
.sub-agent-item-name {
  font-family: var(--sui-font-mono);
  font-weight: 600;
  color: var(--sui-fg);
}
.sub-agent-item-desc {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}

.manage-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
}
.manage-hint {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-secondary);
}
.tab-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: var(--sui-sp-6);
}
.tab-empty-action { margin-top: var(--sui-sp-3); }

.agent-detail-table {
  table-layout: fixed;
  width: 100%;
}
.cell-mono { font-family: var(--sui-font-mono); }
.cell-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-desc {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-md);
}
.cell-addr {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
.cell-addr-priv { font-size: var(--sui-fs-sm); }

/* Dark theme overrides */
html[data-theme="dark"] .agent-type-react { background: #3b2d5c; color: #c4b5fd; }
html[data-theme="dark"] .agent-type-single { background: #2a2a2a; color: #aaa; }
html[data-theme="dark"] .agent-type-generative { background: #422006; color: #fcd34d; }
html[data-theme="dark"] .agent-type-acp { background: #134e4a; color: #5eead4; }
html[data-theme="dark"] .config-badge-id { background: #0c4a6e; color: #7dd3fc; }
html[data-theme="dark"] .config-badge-info { background: #1e3a5f; color: #93c5fd; }
html[data-theme="dark"] .config-badge-warn { background: #422006; color: #fcd34d; }
html[data-theme="dark"] .acp-command { color: #5eead4; }
</style>
