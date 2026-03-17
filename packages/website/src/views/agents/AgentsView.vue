<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import AgentMcpModal from './AgentMcpModal.vue'
import AgentSkillsModal from './AgentSkillsModal.vue'
import type { SkillItem, McpItem, McpTool } from '@/types'
import { sourceBadgeStyle, BADGE_PRIVATE } from '@/utils/badges'
import { renderToolParams, serverAddr } from '@/utils/mcpSchema'

const { show } = useToast()

const agents = computed(() => store.settings.agents || {})
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
    show('已复制')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function removeAgent(id: string) {
  const label = (agents.value[id] as any)?.name || id
  if (!confirm(`确定要删除 Agent "${label}" 吗？`)) return
  try {
    const res = await apiFetch(`/api/settings/agents/${encodeURIComponent(id)}`, 'DELETE')
    Object.assign(store.settings, res.data)
    expandedIds.value.delete(id)
    expandedIds.value = new Set(expandedIds.value)
    show('删除成功')
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

const viewParsed = computed(() => {
  const content = viewContent.value
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { description: '', body: content }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) meta[m[1]] = m[2]
  }
  return { description: meta.description || '', body: match[2].trim() }
})

async function openSkillView(agentId: string, name: string, isPrivate: boolean) {
  viewTitle.value   = name
  viewBadge.value   = isPrivate ? '专属技能' : ''
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
const expandedTools  = reactive(new Set<number>())

function toggleTool(i: number) {
  if (expandedTools.has(i)) expandedTools.delete(i)
  else expandedTools.add(i)
}

async function openMcpView(agentId: string, id: string, isPrivate: boolean) {
  toolsTitle.value   = isPrivate
    ? (getMcpServers(agentId).find(s => s.id === id)?.name || id)
    : (store.allMcps.find((m: McpItem) => m.id === id)?.name || id)
  toolsList.value    = []
  toolsLoading.value = true
  expandedTools.clear()
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
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="agentModal?.open()">+ 添加 Agent</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>名称</th>
            <th>类型</th>
            <th>模型</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(agents).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无 Agent</td>
          </tr>

          <template v-for="(a, id) in agents" :key="id">
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
              <td>{{ a.type }}</td>
              <td>{{ a.model ? modelName(a.model) : '-' }}</td>
              <td @click.stop>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="agentModal?.open(id as string)">编辑</button>
                  <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">MCP</button>
                  <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">Skills</button>
                  <button class="btn-outline btn-sm" @click="copyAgent(id as string)">复制</button>
                  <button class="btn-danger btn-sm" @click="removeAgent(id as string)">删除</button>
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
                      { key: 'config', label: '配置' },
                      { key: 'skills', label: `技能 (${getSkills(id as string).length + getGlobals(id as string).length})` },
                      { key: 'mcp',    label: `工具 (${getMcpGlobals(id as string).length + getMcpServers(id as string).length})` },
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
                    <div v-if="!a" style="text-align:center;color:#94a3b8;padding:24px">Agent 不存在</div>
                    <template v-else>
                      <div class="card">
                        <div class="card-title">基本信息</div>
                        <table style="margin:0">
                          <tbody>
                            <tr>
                              <td style="width:140px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">ID</td>
                              <td style="font-family:monospace;padding:7px 12px">{{ id }}</td>
                            </tr>
                            <tr v-if="(a as any).name">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">名称</td>
                              <td style="padding:7px 12px">{{ (a as any).name }}</td>
                            </tr>
                            <tr>
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">类型</td>
                              <td style="padding:7px 12px"><span style="font-family:monospace;background:#f5f4f2;padding:1px 8px;border-radius:4px;font-size:12px">{{ a.type }}</span></td>
                            </tr>
                            <tr v-if="a.model">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">模型</td>
                              <td style="padding:7px 12px">{{ modelName(a.model) }}</td>
                            </tr>
                            <tr v-if="(a as any).memory">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">记忆</td>
                              <td style="font-family:monospace;padding:7px 12px">{{ (a as any).memory }}</td>
                            </tr>
                            <tr v-if="(a as any).saver">
                              <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">存储</td>
                              <td style="font-family:monospace;padding:7px 12px">{{ (a as any).saver }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div v-if="(a as any).systemPrompt" class="card">
                        <div class="card-title">系统提示词</div>
                        <pre style="margin:0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#1e293b;max-height:180px;overflow:auto">{{ (a as any).systemPrompt }}</pre>
                      </div>

                      <!-- react -->
                      <template v-if="a.type === 'react'">
                        <div class="card">
                          <div class="card-title">ReAct 配置</div>
                          <table style="margin:0">
                            <tbody>
                              <tr>
                                <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px">Think 模型</td>
                                <td style="padding:7px 12px">{{ (a as any).think ? modelName((a as any).think) : '-' }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div v-if="((a as any).agents as any[] | undefined)?.length" class="card">
                          <div class="card-title">子 Agents</div>
                          <div v-for="sub in ((a as any).agents as any[])" :key="sub.id" class="sub-agent-item">
                            <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ sub.id }}</span></div>
                            <div class="sub-agent-item-desc">{{ sub.desc }}</div>
                          </div>
                        </div>
                      </template>
                    </template>
                  </template>

                  <!-- ── Skills ── -->
                  <template v-else-if="getTab(id as string) === 'skills'">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                      <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">管理 Skills</button>
                      <div style="font-size:13px;color:#475569">此 Agent 已启用以下技能</div>
                    </div>
                    <div v-if="getGlobals(id as string).length === 0 && getSkills(id as string).length === 0" style="text-align:center;color:#94a3b8;padding:24px">
                      尚未配置任何技能
                      <div style="margin-top:10px">
                        <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">前往配置</button>
                      </div>
                    </div>
                    <table v-else style="table-layout:fixed;width:100%">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>名称</th><th>来源</th><th>描述</th><th style="white-space:nowrap">操作</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getGlobals(id as string)" :key="'g-' + s.name">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, false)">查看</button></td>
                        </tr>
                        <tr v-for="s in getSkills(id as string)" :key="s.name">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td><span :style="BADGE_PRIVATE">专属</span></td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openSkillView(id as string, s.name, true)">查看</button></td>
                        </tr>
                      </tbody>
                    </table>
                  </template>

                  <!-- ── MCP ── -->
                  <template v-else-if="getTab(id as string) === 'mcp'">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                      <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">管理工具</button>
                      <div style="font-size:13px;color:#475569">此 Agent 已启用以下 MCP 工具服务器</div>
                    </div>
                    <table style="table-layout:fixed;width:100%">
                      <colgroup>
                        <col /><col style="width:60px" /><col /><col style="width:180px" /><col style="width:70px" />
                      </colgroup>
                      <thead>
                        <tr><th>名称</th><th>来源</th><th>描述</th><th>地址/命令</th><th style="white-space:nowrap">操作</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="s in getMcpGlobals(id as string)" :key="'g-' + s.id">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td>
                            <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                          </td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px">{{ serverAddr(s as any) }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, false)">查看</button></td>
                        </tr>
                        <tr v-for="s in getMcpServers(id as string)" :key="'s-' + s.id">
                          <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</td>
                          <td><span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle('专属')}`">专属</span></td>
                          <td style="color:#6b6b6b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">{{ serverAddr(s as any) }}</td>
                          <td style="white-space:nowrap"><button class="btn-outline btn-sm" @click="openMcpView(id as string, s.id, true)">查看</button></td>
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
    </div>

    <AgentModal ref="agentModal" />
    <AgentMcpModal ref="agentMcpModal" />
    <AgentSkillsModal ref="agentSkillsModal" @saved="(id) => loadSkills(id)" />

    <!-- ── MCP Tools viewer modal ── -->
    <div v-if="showToolsModal" class="modal-overlay" @click.self="showToolsModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>{{ toolsTitle }}<span v-if="!toolsLoading" style="font-size:12px;color:#9b9b9b;margin-left:8px;font-weight:400">({{ toolsList.length }} 个工具)</span></h3>
          <button class="modal-close" @click="showToolsModal = false">&times;</button>
        </div>
        <div class="modal-body" style="padding:0">
          <div v-if="toolsLoading" style="text-align:center;color:#94a3b8;padding:40px">连接中，正在获取工具列表…</div>
          <div v-else-if="toolsList.length === 0" style="text-align:center;color:#94a3b8;padding:40px">该 MCP 服务没有可用的工具</div>
          <ul v-else class="tools-list">
            <li v-for="(tool, i) in toolsList" :key="tool.name">
              <div class="tool-header"><div class="tool-name" :class="{ expanded: expandedTools.has(i) }" @click="toggleTool(i)">{{ tool.name }}</div></div>
              <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
              <div class="tool-params" :class="{ show: expandedTools.has(i) }" v-html="renderToolParams((tool as any).parameters)"></div>
            </li>
          </ul>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showToolsModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- ── Skill viewer modal ── -->
    <div v-if="viewVisible" class="modal-overlay" @click.self="viewVisible = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span v-if="viewBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(viewBadge)}`">{{ viewBadge }}</span>
            <h3 style="margin:0;font-family:monospace">{{ viewTitle }}</h3>
          </div>
          <button class="modal-close" @click="viewVisible = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">加载中...</div>
          <template v-else>
            <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
            <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body || viewContent }}</pre>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewVisible = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
