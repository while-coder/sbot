<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import AgentMcpModal from './AgentMcpModal.vue'
import AgentSkillsModal from './AgentSkillsModal.vue'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle, BADGE_PRIVATE, BADGE_CLAWHUB, BADGE_GLOBAL_PILL, BADGE_PRIVATE_PILL } from '@/utils/badges'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const agentName = route.params.agentName as string
const activeTab = ref<'config' | 'skills' | 'mcp'>('config')

// ── Agent config ──
const agent = computed(() => (store.settings.agents || {})[agentName])
const agentModal = ref<InstanceType<typeof AgentModal>>()
const agentMcpModal = ref<InstanceType<typeof AgentMcpModal>>()
const agentSkillsModal = ref<InstanceType<typeof AgentSkillsModal>>()

function modelName(id: string) {
  return (store.settings.models?.[id] as any)?.name || id
}

// ── Skills tab ──
const skills = ref<SkillItem[]>([])
const globals = ref<SkillItem[]>([])

async function loadSkills() {
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName)}/skills`)
    skills.value = res.data?.skills || []
    globals.value = res.data?.globals || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── MCP tab ──
const agentMcpList = computed(() => {
  const a = agent.value
  return Array.isArray(a?.mcp) ? a.mcp : []
})
const agentMcpServers = ref<Record<string, any>>({})

function getMcpInfo(name: string) {
  const builtin = store.mcpBuiltins.find(b => b.name === name)
  if (builtin) return { isBuiltin: true, description: builtin.description }
  const server = store.mcpServers[name]
  if (server) return { isBuiltin: false, type: server.type, description: undefined }
  return null
}

async function loadMcp() {
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName)}/mcp`)
    agentMcpServers.value = res.data?.servers || {}
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Load ──
async function refresh() {
  try {
    const [settingsRes, mcpRes, skillRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/mcp'),
      apiFetch('/api/skills'),
    ])
    Object.assign(store.settings, settingsRes.data)
    store.mcpServers = mcpRes.data?.servers || {}
    store.mcpBuiltins = mcpRes.data?.builtins || []
    const allSkills = skillRes.data || []
    store.allSkills = allSkills
    await Promise.all([loadSkills(), loadMcp()])
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function switchTab(tab: 'config' | 'skills' | 'mcp') {
  activeTab.value = tab
  if (tab === 'skills') loadSkills()
  if (tab === 'mcp') loadMcp()
}

onMounted(refresh)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="router.push('/agents')">← 返回</button>
      <span class="page-toolbar-title" style="margin-left:12px">{{ agent?.name || agentName }}</span>
      <span v-if="agent?.type" style="margin-left:6px;font-size:11px;color:#6b6b6b;background:#f5f4f2;border:1px solid #e8e6e3;border-radius:4px;padding:1px 7px;font-family:monospace">{{ agent.type }}</span>
      <button class="btn-outline btn-sm" style="margin-left:auto" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="agentModal?.open(agentName)">编辑配置</button>
    </div>

    <!-- Tab bar -->
    <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#fff;padding:0 20px;flex-shrink:0">
      <button
        v-for="tab in [
          { key: 'config', label: '配置' },
          { key: 'skills', label: `技能 (${skills.length + globals.length})` },
          { key: 'mcp',    label: `工具 (${agentMcpList.length + Object.keys(agentMcpServers).length})` },
        ]"
        :key="tab.key"
        @click="switchTab(tab.key as any)"
        style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s"
        :style="activeTab === tab.key ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >{{ tab.label }}</button>
    </div>

    <!-- Content -->
    <div class="page-content">

      <!-- ── Tab: Config ── -->
      <template v-if="activeTab === 'config'">
        <div v-if="!agent" style="text-align:center;color:#94a3b8;padding:40px">Agent 不存在</div>
        <template v-else>
          <div class="card">
            <div class="card-title">基本信息</div>
            <table style="margin:0">
              <tbody>
                <tr>
                  <td style="width:150px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">ID</td>
                  <td style="font-family:monospace;padding:8px 12px">{{ agentName }}</td>
                </tr>
                <tr v-if="agent.name">
                  <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">名称</td>
                  <td style="padding:8px 12px">{{ agent.name }}</td>
                </tr>
                <tr>
                  <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">类型</td>
                  <td style="padding:8px 12px"><span style="font-family:monospace;background:#f5f4f2;padding:1px 8px;border-radius:4px;font-size:12px">{{ agent.type }}</span></td>
                </tr>
                <tr v-if="agent.model">
                  <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">模型</td>
                  <td style="padding:8px 12px">{{ modelName(agent.model) }}</td>
                </tr>
                <tr v-if="agent.memory">
                  <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">记忆</td>
                  <td style="font-family:monospace;padding:8px 12px">{{ agent.memory }}</td>
                </tr>
                <tr v-if="agent.saver">
                  <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">存储</td>
                  <td style="font-family:monospace;padding:8px 12px">{{ agent.saver }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="agent.systemPrompt" class="card">
            <div class="card-title">系统提示词</div>
            <pre style="margin:0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#1e293b;max-height:200px;overflow:auto">{{ agent.systemPrompt }}</pre>
          </div>

          <!-- Single -->
          <template v-if="agent.type === 'single'">
            <div v-if="agentMcpList.length || (agent.skills as string[] | undefined)?.length" class="card">
              <div class="card-title">工具 & 技能</div>
              <div v-if="agentMcpList.length" style="margin-bottom:12px">
                <div style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:6px">MCP 工具</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                  <span v-for="m in agentMcpList" :key="m" class="tag-item">{{ m }}</span>
                </div>
              </div>
              <div v-if="(agent.skills as string[] | undefined)?.length">
                <div style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:6px">Skills</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                  <span v-for="s in (agent.skills as string[])" :key="s" class="tag-item">{{ s }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- ReAct -->
          <template v-else-if="agent.type === 'react'">
            <div class="card">
              <div class="card-title">ReAct 配置</div>
              <table style="margin:0">
                <tbody>
                  <tr>
                    <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Think 模型</td>
                    <td style="padding:8px 12px">{{ agent.think ? modelName(agent.think as string) : '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="(agent.agents as any[] | undefined)?.length" class="card">
              <div class="card-title">子 Agents</div>
              <div v-for="a in (agent.agents as any[])" :key="a.id" class="sub-agent-item">
                <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ a.id }}</span></div>
                <div class="sub-agent-item-desc">{{ a.desc }}</div>
              </div>
            </div>
            <div v-if="agentMcpList.length || (agent.skills as string[] | undefined)?.length" class="card">
              <div class="card-title">工具 & 技能</div>
              <div v-if="agentMcpList.length" style="margin-bottom:12px">
                <div style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:6px">MCP 工具</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                  <span v-for="m in agentMcpList" :key="m" class="tag-item">{{ m }}</span>
                </div>
              </div>
              <div v-if="(agent.skills as string[] | undefined)?.length">
                <div style="font-size:12px;font-weight:600;color:#6b6b6b;margin-bottom:6px">Skills</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                  <span v-for="s in (agent.skills as string[])" :key="s" class="tag-item">{{ s }}</span>
                </div>
              </div>
            </div>
          </template>

        </template>
      </template>

      <!-- ── Tab: Skills ── -->
      <template v-else-if="activeTab === 'skills'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:13px;color:#475569">此 Agent 已启用以下技能</div>
          <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(agentName)">管理 Skills →</button>
        </div>
        <div v-if="globals.length === 0 && skills.length === 0" style="text-align:center;color:#94a3b8;padding:40px">
          尚未配置任何技能
          <div style="margin-top:10px">
            <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(agentName)">前往配置</button>
          </div>
        </div>
        <table v-else>
          <thead>
            <tr><th>名称</th><th>来源</th><th>描述</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in globals" :key="'g-' + s.name">
              <td style="font-family:monospace">{{ s.name }}</td>
              <td>
                <span v-if="s.source" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
              </td>
              <td style="color:#6b6b6b;font-size:13px">{{ s.description || '-' }}</td>
            </tr>
            <tr v-for="s in skills" :key="s.name">
              <td style="font-family:monospace">{{ s.name }}</td>
              <td>
                <span :style="BADGE_PRIVATE">专属技能</span>
              </td>
              <td style="color:#6b6b6b;font-size:13px">{{ s.description || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ── Tab: MCP ── -->
      <template v-else-if="activeTab === 'mcp'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:13px;color:#475569">此 Agent 已启用以下 MCP 工具服务器</div>
          <button class="btn-outline btn-sm" @click="agentMcpModal?.open(agentName)">管理工具 →</button>
        </div>
        <table>
          <thead>
            <tr><th>名称</th><th>来源</th><th>类型</th><th>描述</th></tr>
          </thead>
          <tbody>
            <tr v-for="name in agentMcpList" :key="'g-' + name">
              <td style="font-family:monospace">{{ name }}</td>
              <td>
                <span v-if="getMcpInfo(name)?.isBuiltin"
                  :style="BADGE_CLAWHUB">内置</span>
                <span v-else
                  :style="BADGE_GLOBAL_PILL">全局</span>
              </td>
              <td style="font-size:12px;color:#6b6b6b">{{ (getMcpInfo(name) as any)?.type || '-' }}</td>
              <td style="color:#6b6b6b;font-size:13px">{{ getMcpInfo(name)?.description || '-' }}</td>
            </tr>
            <tr v-for="(s, name) in agentMcpServers" :key="'s-' + name">
              <td style="font-family:monospace">{{ name }}</td>
              <td>
                <span :style="BADGE_PRIVATE_PILL">专属</span>
              </td>
              <td style="font-size:12px;color:#6b6b6b">{{ (s as any).type || '-' }}</td>
              <td style="color:#6b6b6b;font-size:13px">{{ (s as any).description || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </template>

    </div>

    <!-- ── Modals ── -->
    <AgentModal ref="agentModal" />
    <AgentMcpModal ref="agentMcpModal" />
    <AgentSkillsModal ref="agentSkillsModal" />
  </div>
</template>
