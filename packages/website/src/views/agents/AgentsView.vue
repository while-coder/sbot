<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import AgentMcpModal from './AgentMcpModal.vue'
import AgentSkillsModal from './AgentSkillsModal.vue'
import McpToolsModal from '@/components/McpToolsModal.vue'
import SkillViewerModal from '@/components/SkillViewerModal.vue'
import type { SkillItem, McpItem, McpTool } from '@/types'
import { sourceBadgeStyle, BADGE_PRIVATE } from '@/utils/badges'
import { serverAddr } from '@/utils/mcpSchema'
import { useResponsive } from '../../composables/useResponsive'

const { t } = useI18n()
const { isMobile } = useResponsive()

const { show } = useToast()

const agents = computed(() => store.settings.agents || {})
const sortedAgentEntries = computed(() => {
  const entries = Object.entries(agents.value)
  return entries.sort(([, a], [, b]) => {
    // react first, then single, then others
    const order = (type: string) => type === 'react' ? 0 : type === 'single' ? 1 : 2
    return order(a.type) - order(b.type)
  })
})
const modelName = (id: string) => (store.settings.models?.[id] as any)?.name || id

// ── Modal refs ──
const agentModal       = ref<InstanceType<typeof AgentModal>>()
const agentMcpModal    = ref<InstanceType<typeof AgentMcpModal>>()
const agentSkillsModal = ref<InstanceType<typeof AgentSkillsModal>>()

// ── Multi-expand state (keyed by agent id) ──
const expandedIds   = ref<Set<string>>(new Set())
const activeTabs    = ref<Record<string, 'config' | 'skills' | 'mcp'>>({})
const skillsMap     = ref<Record<string, SkillItem[]>>({})
const mcpServersMap = ref<Record<string, McpItem[]>>({})

function isExpanded(id: string) { return expandedIds.value.has(id) }
function getTab(id: string): 'config' | 'skills' | 'mcp' { return activeTabs.value[id] ?? 'config' }
function getSkills(id: string)  { return skillsMap.value[id]     ?? [] }
function getGlobals(id: string) {
  const ids = new Set<string>((store.settings.agents || {})[id]?.skills ?? [])
  return store.allSkills.filter((s: SkillItem) => ids.has(s.name))
}
function getMcpServers(id: string) { return mcpServersMap.value[id] ?? [] }

function getMcpGlobals(id: string) {
  const ids = new Set<string>((store.settings.agents || {})[id]?.mcp ?? [])
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

async function copyAgent(id: string) {
  const agent = agents.value[id]
  if (!agent) return
  try {
    const copy = JSON.parse(JSON.stringify(agent))
    if (copy.name) copy.name = copy.name + '-copy'
    const res = await apiFetch('/api/settings/agents', 'POST', copy)
    Object.assign(store.settings, res.data)
    show(t('agents.copy'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function removeAgent(id: string) {
  const label = (agents.value[id] as any)?.name || id
  if (!window.confirm(t('agents.confirm_delete', { name: label }))) return
  try {
    const res = await apiFetch(`/api/settings/agents/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    expandedIds.value.delete(id)
    expandedIds.value = new Set(expandedIds.value)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Inline viewer ──
const viewVisible = ref(false)
const viewTitle   = ref('')
const viewBadge   = ref('')
const viewContent = ref('')
const viewLoading = ref(false)

async function openSkillView(agentId: string, name: string, isPrivate: boolean) {
  viewTitle.value   = name
  viewBadge.value   = isPrivate ? t('agents.skills_exclusive_tab') : ''
  viewContent.value = ''
  viewLoading.value = true
  viewVisible.value = true
  const url = isPrivate
    ? `/api/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(name)}`
    : `/api/skills/${encodeURIComponent(name)}`
  try {
    const res = await apiFetch(url)
    viewContent.value = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    viewVisible.value = false
  } finally {
    viewLoading.value = false
  }
}

// ── MCP Tools viewer ──
const showToolsModal = ref(false)
const toolsTitle     = ref('')
const toolsList      = ref<McpTool[]>([])
const toolsLoading   = ref(false)
const toolsAgentId   = ref('')

async function openMcpView(agentId: string, id: string, isPrivate: boolean) {
  toolsTitle.value   = isPrivate
    ? (getMcpServers(agentId).find(s => s.id === id)?.name || id)
    : (store.allMcps.find((m: McpItem) => m.id === id)?.name || id)
  toolsList.value    = []
  toolsLoading.value = true
  toolsAgentId.value = agentId
  showToolsModal.value = true
  const url = isPrivate
    ? `/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(id)}/tools`
    : `/api/mcp/${encodeURIComponent(id)}/tools`
  try {
    const res = await apiFetch(url, 'GET')
    toolsList.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
  }
}

// ── Auto-approve tools (agent-level) ──
function getAgentAutoApproveTools(): string[] {
  return ((store.settings.agents || {})[toolsAgentId.value] as any)?.autoApproveTools ?? []
}

const allToolsApproved = computed(() =>
  toolsList.value.length > 0 && toolsList.value.every(tool => getAgentAutoApproveTools().includes(tool.name))
)

async function saveAutoApprove(next: string[]) {
  try {
    const existing = (store.settings.agents || {})[toolsAgentId.value] || {}
    const res = await apiFetch(
      `/api/settings/agents/${encodeURIComponent(toolsAgentId.value)}`,
      'PUT',
      { ...existing, autoApproveTools: next },
    )
    Object.assign(store.settings, res.data)
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
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="agentModal?.open()">{{ t('agents.add') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>{{ t('agents.name_col') }}</th>
            <th>{{ t('agents.type_col') }}</th>
            <th>{{ t('agents.model_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="sortedAgentEntries.length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">{{ t('agents.empty') }}</td>
          </tr>

          <template v-for="[id, a] in sortedAgentEntries" :key="id">
            <!-- ── Agent row ── -->
            <tr
              @click="toggleExpand(id as string)"
              style="cursor:pointer"
              :style="isExpanded(id as string) ? 'background:#f8fafc' : ''"
            >
              <td style="padding:6px 8px;text-align:center">
                <span style="color:#6b6b6b;font-size:10px">{{ isExpanded(id as string) ? '▼' : '▶' }}</span>
              </td>
              <td>
                <span style="font-weight:500;color:#1c1c1c">{{ (a as any).name || id }}</span>
              </td>
              <td><span :class="'agent-type-badge agent-type-' + a.type">{{ a.type }}</span></td>
              <td>{{ a.type === 'react' ? ((a as any).think ? modelName((a as any).think) : '-') : (a.model ? modelName(a.model) : '-') }}</td>
              <td @click.stop>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="agentModal?.open(id as string)">{{ t('common.edit') }}</button>
                  <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">MCP</button>
                  <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">Skills</button>
                  <button class="btn-outline btn-sm" @click="copyAgent(id as string)">{{ t('agents.copy') }}</button>
                  <button class="btn-danger btn-sm" @click="removeAgent(id as string)">{{ t('common.delete') }}</button>
                </div>
              </td>
            </tr>

            <!-- ── Detail row (expanded) ── -->
            <tr v-if="isExpanded(id as string)">
              <td colspan="5" style="padding:0;border-bottom:2px solid #e2e8f0">
                <!-- Tab bar -->
                <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#f0f4f8;padding:0 20px">
                  <button
                    v-for="tab in [
                      { key: 'config', label: t('agents.tab_config') },
                      { key: 'skills', label: `${t('agents.tab_skills')} (${getSkills(id as string).length + getGlobals(id as string).length})` },
                      { key: 'mcp',    label: `${t('agents.tab_tools')} (${getMcpGlobals(id as string).length + getMcpServers(id as string).length})` },
                    ]"
                    :key="tab.key"
                    @click="switchTab(id as string, tab.key as any)"
                    style="padding:9px 14px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s"
                    :style="getTab(id as string) === tab.key ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
                  >{{ tab.label }}</button>
                </div>

                <!-- Tab content -->
                <div style="padding:16px 20px;max-height:480px;overflow:auto;background:#f8fafc">

                  <!-- ── Config ── -->
                  <template v-if="getTab(id as string) === 'config'">
                    <div v-if="!a" style="text-align:center;color:#94a3b8;padding:24px">{{ t('agents.not_found') }}</div>
                    <template v-else>
                      <div class="card">
                        <div class="card-title">{{ t('agents.basic_info') }}</div>
                        <table style="margin:0">
                          <tbody>
                            <tr>
                              <td style="width:140px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.id') }}</td>
                              <td style="font-family:monospace;padding:7px 12px">{{ id }}</td>
                            </tr>
                            <tr v-if="(a as any).name">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.name') }}</td>
                              <td style="padding:7px 12px">{{ (a as any).name }}</td>
                            </tr>
                            <tr>
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.type') }}</td>
                              <td style="padding:7px 12px"><span style="font-family:monospace;background:#f5f4f2;padding:1px 8px;border-radius:4px;font-size:12px">{{ a.type }}</span></td>
                            </tr>
                            <tr v-if="a.model">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.model_col') }}</td>
                              <td style="padding:7px 12px">{{ modelName(a.model) }}</td>
                            </tr>
                            <tr v-if="(a as any).saver">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.storage_label') }}</td>
                              <td style="font-family:monospace;padding:7px 12px">{{ (a as any).saver }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div v-if="(a as any).systemPrompt" class="card">
                        <div class="card-title">{{ t('agents.system_prompt') }}</div>
                        <pre style="margin:0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#1e293b;max-height:180px;overflow:auto">{{ (a as any).systemPrompt }}</pre>
                      </div>

                      <!-- react -->
                      <template v-if="a.type === 'react'">
                        <div class="card">
                          <div class="card-title">{{ t('agents.react_config') }}</div>
                          <table style="margin:0">
                            <tbody>
                              <tr>
                                <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.think_model') }}</td>
                                <td style="padding:7px 12px">{{ (a as any).think ? modelName((a as any).think) : '-' }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div v-if="((a as any).agents as any[] | undefined)?.length" class="card">
                          <div class="card-title">{{ t('agents.sub_agents') }}</div>
                          <div v-for="sub in ((a as any).agents as any[])" :key="sub.id" class="sub-agent-item">
                            <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ (agents[sub.id] as any)?.name || sub.id }}</span></div>
                            <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                          </div>
                        </div>
                      </template>
                    </template>
                  </template>

                  <!-- ── Skills ── -->
                  <template v-else-if="getTab(id as string) === 'skills'">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                      <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.manage_skills') }}</button>
                      <div style="font-size:13px;color:#475569">{{ t('agents.agent_skills') }}</div>
                    </div>
                    <div v-if="getGlobals(id as string).length === 0 && getSkills(id as string).length === 0" style="text-align:center;color:#94a3b8;padding:24px">
                      {{ t('agents.no_skills') }}
                      <div style="margin-top:10px">
                        <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.configure_skills') }}</button>
                      </div>
                    </div>
                    <table v-else style="table-layout:fixed;width:100%">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th style="white-space:nowrap">{{ t('common.ops') }}</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getGlobals(id as string)" :key="'g-' + s.name">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, false)">{{ t('common.view') }}</button></td>
                        </tr>
                        <tr v-for="s in getSkills(id as string)" :key="s.name">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td><span :style="BADGE_PRIVATE">{{ t('agents.skills_exclusive_tab') }}</span></td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, true)">{{ t('common.view') }}</button></td>
                        </tr>
                      </tbody>
                    </table>
                  </template>

                  <!-- ── MCP ── -->
                  <template v-else-if="getTab(id as string) === 'mcp'">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                      <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.manage_tools') }}</button>
                      <div style="font-size:13px;color:#475569">{{ t('agents.agent_mcps') }}</div>
                    </div>
                    <table style="table-layout:fixed;width:100%">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:180px" /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th>{{ t('mcp.address_col') }}</th><th style="white-space:nowrap">{{ t('common.ops') }}</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getMcpGlobals(id as string)" :key="'g-' + s.id">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px">{{ serverAddr(s as any) }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, false)">{{ t('common.view') }}</button></td>
                        </tr>
                        <tr v-for="s in getMcpServers(id as string)" :key="'s-' + s.id">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td><span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(t('agents.mcp_exclusive_tab'))}`">{{ t('agents.mcp_exclusive_tab') }}</span></td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">{{ serverAddr(s as any) }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, true)">{{ t('common.view') }}</button></td>
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

      <!-- ── Mobile card layout ── -->
      <div v-else class="card-list">
        <div v-for="[id, a] in sortedAgentEntries" :key="id" class="mobile-card">
          <div class="mobile-card-header" @click="toggleExpand(id as string)" style="display:flex;justify-content:space-between;cursor:pointer">
            <span>{{ (a as any).name || id }}</span>
            <span style="font-size:10px">{{ isExpanded(id as string) ? '▼' : '▶' }}</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('agents.type_col') }}</span>
            <span class="mobile-card-value"><span :class="'agent-type-badge agent-type-' + a.type">{{ a.type }}</span></span>
            <span class="mobile-card-label">{{ t('agents.model_col') }}</span>
            <span class="mobile-card-value">{{ a.model ? modelName(a.model) : '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="agentModal?.open(id as string)">{{ t('common.edit') }}</button>
            <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">MCP</button>
            <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">Skills</button>
            <button class="btn-outline btn-sm" @click="copyAgent(id as string)">{{ t('agents.copy') }}</button>
            <button class="btn-danger btn-sm" @click="removeAgent(id as string)">{{ t('common.delete') }}</button>
          </div>

          <!-- Expandable detail -->
          <div v-if="isExpanded(id as string)" style="margin-top:10px">
            <!-- Tab bar -->
            <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#f0f4f8;padding:0 10px">
              <button
                v-for="tab in [
                  { key: 'config', label: t('agents.tab_config') },
                  { key: 'skills', label: `${t('agents.tab_skills')} (${getSkills(id as string).length + getGlobals(id as string).length})` },
                  { key: 'mcp',    label: `${t('agents.tab_tools')} (${getMcpGlobals(id as string).length + getMcpServers(id as string).length})` },
                ]"
                :key="tab.key"
                @click="switchTab(id as string, tab.key as any)"
                style="padding:9px 14px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s"
                :style="getTab(id as string) === tab.key ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
              >{{ tab.label }}</button>
            </div>

            <!-- Tab content -->
            <div style="padding:12px 10px;max-height:480px;overflow:auto;background:#f8fafc">

              <!-- ── Config ── -->
              <template v-if="getTab(id as string) === 'config'">
                <div v-if="!a" style="text-align:center;color:#94a3b8;padding:24px">{{ t('agents.not_found') }}</div>
                <template v-else>
                  <div class="card">
                    <div class="card-title">{{ t('agents.basic_info') }}</div>
                    <table style="margin:0">
                      <tbody>
                        <tr>
                          <td style="width:140px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.id') }}</td>
                          <td style="font-family:monospace;padding:7px 12px">{{ id }}</td>
                        </tr>
                        <tr v-if="(a as any).name">
                          <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.name') }}</td>
                          <td style="padding:7px 12px">{{ (a as any).name }}</td>
                        </tr>
                        <tr>
                          <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('common.type') }}</td>
                          <td style="padding:7px 12px"><span style="font-family:monospace;background:#f5f4f2;padding:1px 8px;border-radius:4px;font-size:12px">{{ a.type }}</span></td>
                        </tr>
                        <tr v-if="a.model">
                          <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.model_col') }}</td>
                          <td style="padding:7px 12px">{{ modelName(a.model) }}</td>
                        </tr>
                        <tr v-if="(a as any).saver">
                          <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.storage_label') }}</td>
                          <td style="font-family:monospace;padding:7px 12px">{{ (a as any).saver }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div v-if="(a as any).systemPrompt" class="card">
                    <div class="card-title">{{ t('agents.system_prompt') }}</div>
                    <pre style="margin:0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#1e293b;max-height:180px;overflow:auto">{{ (a as any).systemPrompt }}</pre>
                  </div>

                  <!-- react -->
                  <template v-if="a.type === 'react'">
                    <div class="card">
                      <div class="card-title">{{ t('agents.react_config') }}</div>
                      <table style="margin:0">
                        <tbody>
                          <tr>
                            <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">{{ t('agents.think_model') }}</td>
                            <td style="padding:7px 12px">{{ (a as any).think ? modelName((a as any).think) : '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div v-if="((a as any).agents as any[] | undefined)?.length" class="card">
                      <div class="card-title">{{ t('agents.sub_agents') }}</div>
                      <div v-for="sub in ((a as any).agents as any[])" :key="sub.id" class="sub-agent-item">
                        <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ (agents[sub.id] as any)?.name || sub.id }}</span></div>
                        <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                      </div>
                    </div>
                  </template>
                </template>
              </template>

              <!-- ── Skills ── -->
              <template v-else-if="getTab(id as string) === 'skills'">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                  <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.manage_skills') }}</button>
                  <div style="font-size:13px;color:#475569">{{ t('agents.agent_skills') }}</div>
                </div>
                <div v-if="getGlobals(id as string).length === 0 && getSkills(id as string).length === 0" style="text-align:center;color:#94a3b8;padding:24px">
                  {{ t('agents.no_skills') }}
                  <div style="margin-top:10px">
                    <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">{{ t('agents.configure_skills') }}</button>
                  </div>
                </div>
                <table v-else style="table-layout:fixed;width:100%">
                  <colgroup>
                    <col /><col style="width:60px" /><col /><col style="width:70px" />
                  </colgroup>
                  <thead>
                    <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th style="white-space:nowrap">{{ t('common.ops') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in getGlobals(id as string)" :key="'g-' + s.name">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                      <td>
                        <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                      </td>
                      <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, false)">{{ t('common.view') }}</button></td>
                    </tr>
                    <tr v-for="s in getSkills(id as string)" :key="s.name">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                      <td><span :style="BADGE_PRIVATE">{{ t('agents.skills_exclusive_tab') }}</span></td>
                      <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, true)">{{ t('common.view') }}</button></td>
                    </tr>
                  </tbody>
                </table>
              </template>

              <!-- ── MCP ── -->
              <template v-else-if="getTab(id as string) === 'mcp'">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                  <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">{{ t('agents.manage_tools') }}</button>
                  <div style="font-size:13px;color:#475569">{{ t('agents.agent_mcps') }}</div>
                </div>
                <table style="table-layout:fixed;width:100%">
                  <colgroup>
                    <col /><col style="width:60px" /><col /><col style="width:180px" /><col style="width:70px" />
                  </colgroup>
                  <thead>
                    <tr><th>{{ t('common.name') }}</th><th>来源</th><th>描述</th><th>{{ t('mcp.address_col') }}</th><th style="white-space:nowrap">{{ t('common.ops') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in getMcpGlobals(id as string)" :key="'g-' + s.id">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                      <td>
                        <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                      </td>
                      <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px">{{ serverAddr(s as any) }}</td>
                      <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, false)">{{ t('common.view') }}</button></td>
                    </tr>
                    <tr v-for="s in getMcpServers(id as string)" :key="'s-' + s.id">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                      <td><span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(t('agents.mcp_exclusive_tab'))}`">{{ t('agents.mcp_exclusive_tab') }}</span></td>
                      <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">{{ serverAddr(s as any) }}</td>
                      <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, true)">{{ t('common.view') }}</button></td>
                    </tr>
                  </tbody>
                </table>
              </template>

            </div>
          </div>
        </div>
        <div v-if="sortedAgentEntries.length === 0" class="mobile-card-empty">-</div>
      </div>

    </div>

    <AgentModal ref="agentModal" />
    <AgentMcpModal ref="agentMcpModal" />
    <AgentSkillsModal ref="agentSkillsModal" @saved="(id) => loadSkills(id)" />

    <McpToolsModal
      :visible="showToolsModal"
      :title="toolsTitle"
      :tools="toolsList"
      :loading="toolsLoading"
      :auto-approved-tools="getAgentAutoApproveTools()"
      :all-approved="allToolsApproved"
      @update:visible="showToolsModal = $event"
      @toggle-auto-approve="toggleAutoApprove"
      @approve-all="approveAll"
      @revoke-all="revokeAll"
    />

    <SkillViewerModal
      :visible="viewVisible"
      :title="viewTitle"
      :badge="viewBadge"
      :content="viewContent"
      :loading="viewLoading"
      @update:visible="viewVisible = $event"
    />
  </div>
</template>

<style scoped>
.agent-type-badge {
  display: inline-block;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 4px;
}
.agent-type-react {
  background: #ede9fe;
  color: #6d28d9;
}
.agent-type-single {
  background: #f0f4f8;
  color: #64748b;
}
</style>
