<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store, applyMcpList } from '@/shared/store'
import { useToast, useConfirm, SButton, SCard, SPageToolbar, SPageContent, STable, SInfoTable, SInfoRow, SModal, SInput, type STableColumn } from 'sbot-ui'
import AgentModal from './modals/AgentModal.vue'
import AgentMcpModal from './modals/AgentMcpModal.vue'
import AgentSkillsModal from './modals/AgentSkillsModal.vue'
import McpToolsModal from '@/components/modals/McpToolsModal.vue'
import SkillViewerModal from '@/components/modals/SkillViewerModal.vue'
import type { SkillItem, McpItem, McpTool, McpPrompt, McpResource, McpResourceTemplate } from '@/shared/types'
import { sourceBadgeStyle, badgePrivate } from '@/utils/badges'
import { serverAddr } from '@/utils/mcpSchema'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const agents = computed(() => store.settings.agents || {})
type AgentRow = Record<string, any> & { id: string }
const sortedAgentRows = computed<AgentRow[]>(() => {
  const order = (type: string) => type === 'react' ? 0 : type === 'single' ? 1 : type === 'acp' ? 2 : type === 'generative' ? 3 : 4
  return Object.entries(agents.value)
    .map(([id, a]) => ({ id, ...(a as any) }))
    .sort((a, b) => order(a.type) - order(b.type))
})
const modelName = (id: string) => (store.settings.models?.[id] as any)?.name || id

const columns = computed<STableColumn[]>(() => [
  { key: 'name',  label: t('agents.name_col'),  primary: true, ellipsis: true },
  { key: 'type',  label: t('agents.type_col'),  width: '120px' },
  { key: 'model', label: t('agents.model_col'), ellipsis: true },
  { key: 'ops',   label: t('common.ops'),       ops: true, width: '380px' },
])

const agentModal       = ref<InstanceType<typeof AgentModal>>()
const agentMcpModal    = ref<InstanceType<typeof AgentMcpModal>>()
const agentSkillsModal = ref<InstanceType<typeof AgentSkillsModal>>()

const expandedIds   = ref<string[]>([])
const activeTabs    = ref<Record<string, 'config' | 'skills' | 'mcp'>>({})
const skillsMap     = ref<Record<string, SkillItem[]>>({})
const mcpServersMap = ref<Record<string, McpItem[]>>({})

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

async function onExpand(row: AgentRow, expanded: boolean) {
  if (!expanded) return
  if (!activeTabs.value[row.id]) activeTabs.value[row.id] = 'config'
  await Promise.all([loadSkills(row.id), loadMcp(row.id)])
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
  if (!await confirm(t('agents.confirm_delete', { name: label }), { danger: true })) return
  try {
    await apiFetch(`/api/agents/${encodeURIComponent(id)}`, 'DELETE')
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
    expandedIds.value = expandedIds.value.filter(x => x !== id)
    show(t('common.deleted'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const skillViewRef = ref<InstanceType<typeof SkillViewerModal>>()

function openSkillView(skill: SkillItem, isPrivate: boolean) {
  const badge = isPrivate ? t('agents.skills_exclusive_tab') : (skill.source || '')
  skillViewRef.value?.open(skill.name, badge, skill.id || '')
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
      expandedIds.value.flatMap(id => [loadSkills(id), loadMcp(id)])
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

const skillCols = computed<STableColumn[]>(() => [
  { key: 'name',   label: t('common.name'),  primary: true, ellipsis: true },
  { key: 'source', label: '来源',             width: '80px' },
  { key: 'desc',   label: '描述',             ellipsis: true },
  { key: 'ops',    label: t('common.ops'),   ops: true, width: '90px' },
])

const mcpCols = computed<STableColumn[]>(() => [
  { key: 'name',   label: t('common.name'),       primary: true, ellipsis: true },
  { key: 'source', label: '来源',                  width: '80px' },
  { key: 'desc',   label: '描述',                  ellipsis: true },
  { key: 'addr',   label: t('mcp.address_col'),   width: '200px', ellipsis: true },
  { key: 'ops',    label: t('common.ops'),        ops: true, width: '180px' },
])

type SkillRow = SkillItem & { _key: string; _private: boolean }
function skillRows(id: string): SkillRow[] {
  return [
    ...getGlobals(id).map(s => ({ ...s, _key: 'g-' + s.name, _private: false })),
    ...getSkills(id).map(s  => ({ ...s, _key: 's-' + s.name, _private: true  })),
  ]
}

type McpRow = McpItem & { _key: string; _private: boolean }
function mcpRows(id: string): McpRow[] {
  return [
    ...getMcpGlobals(id).map(m => ({ ...m, _key: 'g-' + m.id, _private: false })),
    ...getMcpServers(id).map(m => ({ ...m, _key: 's-' + m.id, _private: true  })),
  ]
}

// ── MCP params editor (mirrors AgentMcpModal) ────────────────────
const showParamsModal = ref(false)
const paramsAgentId   = ref('')
const paramsMcpId     = ref('')
const paramsRows      = ref<{ key: string; value: string }[]>([])

function getAgentMcpParams(agentId: string, mcpId: string): Record<string, string> {
  const agent = (store.settings.agents || {})[agentId] as any
  return agent?.mcpParams?.[mcpId] || {}
}

function paramsCount(agentId: string, mcpId: string): number {
  return Object.keys(getAgentMcpParams(agentId, mcpId)).length
}

function openMcpParams(agentId: string, mcpId: string) {
  paramsAgentId.value = agentId
  paramsMcpId.value   = mcpId
  paramsRows.value    = Object.entries(getAgentMcpParams(agentId, mcpId)).map(([key, value]) => ({ key, value }))
  showParamsModal.value = true
}

async function saveMcpParams() {
  try {
    const agentId  = paramsAgentId.value
    const mcpId    = paramsMcpId.value
    const existing = (store.settings.agents || {})[agentId] || {}
    const obj = Object.fromEntries(
      paramsRows.value.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
    )
    const nextParams = { ...((existing as any).mcpParams || {}) }
    if (Object.keys(obj).length > 0) nextParams[mcpId] = obj
    else delete nextParams[mcpId]
    const payload: any = { ...existing }
    if (Object.keys(nextParams).length > 0) payload.mcpParams = nextParams
    else delete payload.mcpParams
    await apiFetch(
      `/api/agents/${encodeURIComponent(agentId)}`,
      'PUT',
      payload,
    )
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
    show(t('common.saved'))
    showParamsModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="refresh">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="agentModal?.open()">{{ t('agents.add') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable
        :columns="columns"
        :rows="sortedAgentRows"
        row-key="id"
        expandable
        v-model:expandedKeys="expandedIds"
        :empty-text="t('agents.empty')"
        @expand="onExpand"
      >
        <template #name="{ row }">
          <span class="agent-name">{{ row.name || row.id }}</span>
          <span v-if="row.id" class="config-badge config-badge-id">{{ row.id }}</span>
          <span v-if="row.skills === '*'" class="config-badge config-badge-info">{{ t('agents.tab_skills') }} *</span>
          <span v-if="row.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.tab_tools') }} *</span>
          <span v-if="row.autoApproveAllTools" class="config-badge config-badge-warn">{{ t('agents.auto_approve_all_tools') }}</span>
        </template>

        <template #type="{ row }">
          <span :class="'agent-type-badge agent-type-' + row.type">{{ row.type }}</span>
        </template>

        <template #model="{ row }">
          <template v-if="row.type === 'acp'">
            <span class="acp-command">{{ row.command }}</span>
          </template>
          <template v-else>{{ row.model ? modelName(row.model) : '-' }}</template>
        </template>

        <template #ops="{ row }">
          <div class="ops-cell">
            <SButton type="outline" size="sm" @click="agentModal?.open(row.id)">{{ t('common.edit') }}</SButton>
            <SButton v-if="row.type !== 'acp'" type="outline" size="sm" @click="agentMcpModal?.open(row.id)">{{ t('agents.tab_tools') }}</SButton>
            <SButton v-if="row.type !== 'acp'" type="outline" size="sm" @click="agentSkillsModal?.open(row.id)">{{ t('agents.tab_skills') }}</SButton>
            <SButton type="outline" size="sm" @click="exportAgent(row.id)">{{ t('agentStore.export_btn') }}</SButton>
            <SButton type="danger" size="sm" @click="removeAgent(row.id)">{{ t('common.delete') }}</SButton>
          </div>
        </template>

        <template #_expanded="{ row }">
          <div class="agent-tab-bar">
            <button
              v-for="tab in tabsForAgent(row.id, row.type)"
              :key="tab.key"
              @click="switchTab(row.id, tab.key)"
              class="agent-tab"
              :class="{ active: getTab(row.id) === tab.key }"
            >{{ tab.label }}</button>
          </div>

          <div class="agent-tab-content">
            <template v-if="getTab(row.id) === 'config'">
              <SCard :title="t('agents.basic_info')" class="agent-info-card">
                <SInfoTable variant="compact" label-width="140px">
                  <SInfoRow :label="t('common.id')" mono>{{ row.id }}</SInfoRow>
                  <SInfoRow v-if="row.name" :label="t('common.name')">{{ row.name }}</SInfoRow>
                  <SInfoRow :label="t('common.type')">
                    <span class="type-tag">{{ row.type }}</span>
                  </SInfoRow>
                  <template v-if="row.type === 'acp'">
                    <SInfoRow :label="t('agents.acp_command')" mono>{{ row.command }}</SInfoRow>
                    <SInfoRow v-if="row.args?.length" :label="t('agents.acp_args')" mono>{{ row.args.join(' ') }}</SInfoRow>
                    <SInfoRow :label="t('agents.acp_session_mode')">
                      <span class="type-tag">{{ row.sessionMode || 'persistent' }}</span>
                    </SInfoRow>
                    <SInfoRow v-if="row.initTimeout" :label="t('agents.acp_init_timeout')">{{ row.initTimeout }}s</SInfoRow>
                    <SInfoRow v-if="row.env && Object.keys(row.env).length" :label="t('agents.acp_env')">
                      <div v-for="(v, k) in row.env" :key="k" class="env-line">{{ k }}={{ v }}</div>
                    </SInfoRow>
                  </template>
                  <template v-else>
                    <SInfoRow v-if="row.model" :label="t('agents.model_col')">{{ modelName(row.model) }}</SInfoRow>
                    <SInfoRow v-if="row.saver" :label="t('agents.storage_label')" mono>{{ row.saver }}</SInfoRow>
                    <SInfoRow :label="t('agents.tab_skills')">
                      <span v-if="row.skills === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                      <span v-else-if="Array.isArray(row.skills) && row.skills.length" class="info-count">{{ row.skills.length }} {{ t('agents.items_selected') }}</span>
                      <span v-else class="info-dash">-</span>
                    </SInfoRow>
                    <SInfoRow :label="t('agents.tab_tools')">
                      <span v-if="row.mcp === '*'" class="config-badge config-badge-info">{{ t('agents.use_all') }}</span>
                      <span v-else-if="Array.isArray(row.mcp) && row.mcp.length" class="info-count">{{ row.mcp.length }} {{ t('agents.items_selected') }}</span>
                      <span v-else class="info-dash">-</span>
                    </SInfoRow>
                    <SInfoRow v-if="row.autoApproveAllTools" :label="t('agents.auto_approve_all_tools')">
                      <span class="config-badge config-badge-warn">ON</span>
                    </SInfoRow>
                  </template>
                </SInfoTable>
              </SCard>

              <SCard v-if="row.systemPrompt" :title="t('agents.system_prompt')" class="agent-info-card">
                <pre class="agent-system-prompt">{{ row.systemPrompt }}</pre>
              </SCard>

              <template v-if="row.type === 'react'">
                <SCard v-if="(row.agents as any[] | undefined)?.length" :title="t('agents.sub_agents')" class="agent-info-card">
                  <div v-for="sub in (row.agents as any[])" :key="sub.id" class="sub-agent-item">
                    <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ (agents[sub.id] as any)?.name || sub.id }}</span></div>
                    <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                  </div>
                </SCard>
              </template>
            </template>

            <template v-else-if="getTab(row.id) === 'skills'">
              <div class="manage-row">
                <SButton type="outline" size="sm" @click="agentSkillsModal?.open(row.id)">{{ t('agents.manage_skills') }}</SButton>
                <div class="manage-hint">{{ t('agents.agent_skills') }}</div>
              </div>
              <STable :columns="skillCols" :rows="skillRows(row.id)" row-key="_key">
                <template #name="{ row: s }"><span class="cell-mono">{{ s.name }}</span></template>
                <template #source="{ row: s }">
                  <span v-if="s._private" :style="badgePrivate()">{{ t('agents.skills_exclusive_tab') }}</span>
                  <span v-else-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                </template>
                <template #desc="{ row: s }"><span class="cell-desc">{{ s.description || '-' }}</span></template>
                <template #ops="{ row: s }">
                  <SButton type="outline" size="sm" @click="openSkillView(s, s._private)">{{ t('common.view') }}</SButton>
                </template>
                <template #_empty>
                  <div>{{ t('agents.no_skills') }}</div>
                  <div class="tab-empty-action">
                    <SButton type="outline" size="sm" @click="agentSkillsModal?.open(row.id)">{{ t('agents.configure_skills') }}</SButton>
                  </div>
                </template>
              </STable>
            </template>

            <template v-else-if="getTab(row.id) === 'mcp'">
              <div class="manage-row">
                <SButton type="outline" size="sm" @click="agentMcpModal?.open(row.id)">{{ t('agents.manage_tools') }}</SButton>
                <div class="manage-hint">{{ t('agents.agent_mcps') }}</div>
              </div>
              <STable :columns="mcpCols" :rows="mcpRows(row.id)" row-key="_key">
                <template #name="{ row: s }"><span class="cell-mono">{{ s.name }}</span></template>
                <template #source="{ row: s }">
                  <span v-if="s._private" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(t('agents.mcp_exclusive_tab'))}`">{{ t('agents.mcp_exclusive_tab') }}</span>
                  <span v-else-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                </template>
                <template #desc="{ row: s }"><span class="cell-desc">{{ s.description || '-' }}</span></template>
                <template #addr="{ row: s }"><span :class="s._private ? 'cell-addr-priv' : 'cell-addr'">{{ serverAddr(s as any) }}</span></template>
                <template #ops="{ row: s }">
                  <SButton v-if="!s._private" type="outline" size="sm" @click="openMcpParams(row.id, s.id)">
                    {{ t('agents.mcp_params') }}<span v-if="paramsCount(row.id, s.id) > 0" class="params-badge">{{ paramsCount(row.id, s.id) }}</span>
                  </SButton>
                  <SButton type="outline" size="sm" @click="openMcpView(row.id, s.id, s._private)">{{ t('common.view') }}</SButton>
                </template>
              </STable>
            </template>
          </div>
        </template>
      </STable>

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

    <SModal v-model:visible="showParamsModal" :title="t('agents.mcp_params_title', { name: paramsMcpId })" width="md">
      <div class="params-hint">{{ t('agents.mcp_params_hint') }}</div>
      <div v-for="(row, i) in paramsRows" :key="i" class="params-row">
        <SInput v-model="row.key" placeholder="Key" size="sm" style="flex:1" />
        <SInput v-model="row.value" placeholder="Value" size="sm" style="flex:2" />
        <SButton type="danger" size="sm" @click="paramsRows.splice(i,1)">×</SButton>
      </div>
      <SButton type="outline" size="sm" @click="paramsRows.push({key:'',value:''})">{{ t('agents.mcp_params_add') }}</SButton>

      <template #footer>
        <SButton type="outline" @click="showParamsModal = false">{{ t('common.cancel') }}</SButton>
        <SButton type="primary" @click="saveMcpParams">{{ t('common.confirm') }}</SButton>
      </template>
    </SModal>
  </div>
</template>

<style scoped>
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

/* Info table */
.agent-info-card { margin-bottom: var(--sui-sp-4); }
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
.tab-empty-action { margin-top: var(--sui-sp-3); }

.cell-mono { font-family: var(--sui-font-mono); }
.cell-desc {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-md);
}
.cell-addr {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
.cell-addr-priv { font-size: var(--sui-fs-sm); }

.params-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 8px;
  background: var(--sui-bg-subtle);
  color: var(--sui-fg-muted);
}
.params-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-3);
}
.params-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

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
