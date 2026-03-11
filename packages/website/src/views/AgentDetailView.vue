<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import type { SkillItem } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const agentName = route.params.agentName as string
const activeTab = ref<'config' | 'skills' | 'mcp'>('config')

// ── Agent config ──
const agent = computed(() => (store.settings.agents || {})[agentName])
const agentModal = ref<InstanceType<typeof AgentModal>>()

function modelName(id: string) {
  return (store.settings.models?.[id] as any)?.name || id
}

// ── Skills tab ──
const skills = ref<SkillItem[]>([])
const globals = ref<SkillItem[]>([])
const skillsLoaded = ref(false)

function skillApiBase() {
  return `/api/agents/${encodeURIComponent(agentName)}/skills`
}

async function loadSkills() {
  try {
    const res = await apiFetch(skillApiBase())
    skills.value = res.data?.skills || []
    globals.value = res.data?.globals || []
    skillsLoaded.value = true
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── View Skill modal ──
const showViewModal = ref(false)
const viewName = ref('')
const viewBadge = ref('')
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

async function openView(name: string, badge = '') {
  viewName.value = name
  viewBadge.value = badge
  viewContent.value = ''
  viewLoading.value = true
  showViewModal.value = true
  const isGlobal = badge === '内置' || badge === '全局'
  const url = isGlobal
    ? `/api/skills/${encodeURIComponent(name)}`
    : `${skillApiBase()}/${encodeURIComponent(name)}`
  try {
    const res = await apiFetch(url)
    viewContent.value = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    showViewModal.value = false
  } finally {
    viewLoading.value = false
  }
}

// ── Edit Skill modal ──
const SKILL_TEMPLATE = `---\ndescription: ""\n---\n\n`
const showEditModal = ref(false)
const editName = ref('')
const editContent = ref('')
const editSaving = ref(false)

async function openEditSkill(name: string) {
  editName.value = name
  editContent.value = ''
  showEditModal.value = true
  try {
    const res = await apiFetch(`${skillApiBase()}/${encodeURIComponent(name)}`)
    editContent.value = res.data?.content || SKILL_TEMPLATE
  } catch (e: any) {
    show(e.message, 'error')
    showEditModal.value = false
  }
}

async function saveSkill() {
  const name = editName.value.trim()
  if (!name) { show('Skill 名称不能为空', 'error'); return }
  if (!editContent.value.trim()) { show('内容不能为空', 'error'); return }
  editSaving.value = true
  try {
    await apiFetch(`${skillApiBase()}/${encodeURIComponent(name)}`, 'PUT', { content: editContent.value })
    show('保存成功')
    showEditModal.value = false
    await loadSkills()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    editSaving.value = false
  }
}

async function removeSkill(name: string) {
  if (!confirm(`确定要删除 Skill "${name}" 吗？`)) return
  try {
    await apiFetch(`${skillApiBase()}/${encodeURIComponent(name)}`, 'DELETE')
    show('删除成功')
    await loadSkills()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Skill Hub modal ──
interface HubSkillResult {
  id: string
  name: string
  description: string
  version: string
  sourceUrl: string
  provider: 'clawhub' | 'skillssh' | 'skillsmp'
}

const showHub = ref(false)
const hubTab = ref<'url' | 'search'>('search')
const hubQuery = ref('')
const hubResults = ref<HubSkillResult[]>([])
const hubSearching = ref(false)
const hubSearched = ref(false)
const hubUrlInput = ref('')
const hubUrlInstalling = ref(false)
const hubUrlOverwrite = ref(false)

async function installByUrl() {
  const url = hubUrlInput.value.trim()
  if (!url) return
  hubUrlInstalling.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName)}/skill-hub/install-url`, 'POST', {
      url,
      overwrite: hubUrlOverwrite.value,
    })
    show(`已安装：${res.data?.name ?? url}`)
    hubUrlInput.value = ''
    await loadSkills()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubUrlInstalling.value = false
  }
}

function openAddSkill() {
  hubTab.value = 'search'
  hubQuery.value = ''
  hubResults.value = []
  hubSearched.value = false
  hubUrlInput.value = ''
  hubUrlOverwrite.value = false
  showHub.value = true
}

async function hubSearch() {
  if (!hubQuery.value.trim()) return
  hubSearching.value = true
  hubSearched.value = false
  hubResults.value = []
  try {
    const res = await apiFetch(`/api/skill-hub/search?q=${encodeURIComponent(hubQuery.value.trim())}&limit=30`)
    hubResults.value = Array.isArray(res) ? res : (res.data ?? [])
    hubSearched.value = true
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubSearching.value = false
  }
}

function hubKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') hubSearch()
}

const showInstall = ref(false)
const installing = ref(false)
const selected = ref<HubSkillResult | null>(null)
const overwrite = ref(false)

function openInstall(skill: HubSkillResult) {
  selected.value = skill
  overwrite.value = false
  showInstall.value = true
}

async function confirmInstall() {
  if (!selected.value) return
  installing.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName)}/skill-hub/install`, 'POST', {
      skill: selected.value,
      overwrite: overwrite.value,
    })
    show(`已安装：${res.data?.name ?? selected.value.name}`)
    showInstall.value = false
    await loadSkills()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    installing.value = false
  }
}

// ── MCP tab ──
const agentMcpList = computed(() => {
  const a = agent.value
  return Array.isArray(a?.mcp) ? a.mcp : []
})

function getMcpInfo(name: string) {
  const builtin = store.mcpBuiltins.find(b => b.name === name)
  if (builtin) return { isBuiltin: true, description: builtin.description }
  const server = store.mcpServers[name]
  if (server) return { isBuiltin: false, type: server.type, description: undefined }
  return null
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
    store.skillBuiltins = skillRes.data?.builtins || []
    store.globalSkills = skillRes.data?.skills || []
    await loadSkills()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function switchTab(tab: 'config' | 'skills' | 'mcp') {
  activeTab.value = tab
  if (tab === 'skills' && !skillsLoaded.value) loadSkills()
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
          { key: 'mcp',    label: `工具 (${agentMcpList.length})` },
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
                    <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">最大迭代次数</td>
                    <td style="padding:8px 12px">{{ agent.maxIterations ?? 5 }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Think Agent</td>
                    <td style="font-family:monospace;padding:8px 12px">{{ agent.think || '-' }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Reflect 模型</td>
                    <td style="padding:8px 12px">{{ agent.reflect ? modelName(agent.reflect as string) : '-' }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Summarizer 模型</td>
                    <td style="padding:8px 12px">{{ agent.summarizer ? modelName(agent.summarizer as string) : '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="(agent.agents as any[] | undefined)?.length" class="card">
              <div class="card-title">子 Agents</div>
              <div v-for="a in (agent.agents as any[])" :key="a.name" class="sub-agent-item">
                <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ a.name }}</span></div>
                <div class="sub-agent-item-desc">{{ a.desc }}</div>
              </div>
            </div>
          </template>

          <!-- Supervisor -->
          <template v-else-if="agent.type === 'supervisor'">
            <div class="card">
              <div class="card-title">Supervisor 配置</div>
              <table style="margin:0">
                <tbody>
                  <tr>
                    <td style="width:160px;color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">最大调度轮次</td>
                    <td style="padding:8px 12px">{{ agent.maxRounds ?? 10 }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Supervisor Agent</td>
                    <td style="font-family:monospace;padding:8px 12px">{{ agent.supervisor || '-' }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Summarizer 模型</td>
                    <td style="padding:8px 12px">{{ agent.summarizer ? modelName(agent.summarizer as string) : '-' }}</td>
                  </tr>
                  <tr>
                    <td style="color:#6b6b6b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">Finalize 模型</td>
                    <td style="padding:8px 12px">{{ agent.finalize ? modelName(agent.finalize as string) : '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="(agent.agents as any[] | undefined)?.length" class="card">
              <div class="card-title">Worker Agents</div>
              <div v-for="a in (agent.agents as any[])" :key="a.name" class="sub-agent-item">
                <div class="sub-agent-item-header"><span class="sub-agent-item-name">{{ a.name }}</span></div>
                <div class="sub-agent-item-desc">{{ a.desc }}</div>
              </div>
            </div>
          </template>
        </template>
      </template>

      <!-- ── Tab: Skills ── -->
      <template v-else-if="activeTab === 'skills'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;flex:1;margin-right:12px">
            技能目录：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
          </div>
          <button class="btn-primary btn-sm" @click="openAddSkill">+ 添加 Skill</button>
        </div>
        <table>
          <thead>
            <tr><th>名称</th><th>描述</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-if="globals.length === 0 && skills.length === 0">
              <td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">暂无 Skill</td>
            </tr>
            <tr v-for="s in globals" :key="'g-' + s.name">
              <td style="font-family:monospace">
                {{ s.name }}
                <span v-if="(s as any).isBuiltin !== false"
                  style="margin-left:6px;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
                <span v-else
                  style="margin-left:6px;background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">全局</span>
              </td>
              <td>{{ s.description || '-' }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm"
                    @click="openView(s.name, (s as any).isBuiltin !== false ? '内置' : '全局')">查看</button>
                </div>
              </td>
            </tr>
            <tr v-for="s in skills" :key="s.name">
              <td style="font-family:monospace">{{ s.name }}</td>
              <td>{{ s.description || '-' }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="openView(s.name)">查看</button>
                  <button class="btn-outline btn-sm" @click="openEditSkill(s.name)">编辑</button>
                  <button class="btn-danger btn-sm" @click="removeSkill(s.name)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ── Tab: MCP ── -->
      <template v-else-if="activeTab === 'mcp'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:13px;color:#475569">此 Agent 已启用以下 MCP 工具服务器</div>
          <button class="btn-outline btn-sm" @click="router.push(`/mcp/agent/${agentName}`)">管理工具 →</button>
        </div>
        <div v-if="agentMcpList.length === 0" style="text-align:center;color:#94a3b8;padding:40px">
          尚未配置任何 MCP 工具
          <div style="margin-top:10px">
            <button class="btn-outline btn-sm" @click="router.push(`/mcp/agent/${agentName}`)">前往配置</button>
          </div>
        </div>
        <table v-else>
          <thead>
            <tr><th>名称</th><th>类型</th><th>描述</th></tr>
          </thead>
          <tbody>
            <tr v-for="name in agentMcpList" :key="name">
              <td style="font-family:monospace">{{ name }}</td>
              <td>
                <span v-if="getMcpInfo(name)?.isBuiltin"
                  style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
                <span v-else-if="getMcpInfo(name)"
                  style="background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">{{ (getMcpInfo(name) as any).type || '自定义' }}</span>
                <span v-else
                  style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">未知</span>
              </td>
              <td style="color:#6b6b6b;font-size:13px">{{ getMcpInfo(name)?.description || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </template>

    </div>

    <!-- ── Modals ── -->

    <!-- View Skill modal -->
    <div v-if="showViewModal" class="modal-overlay" @click.self="showViewModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>查看 Skill</h3>
          <button class="modal-close" @click="showViewModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">加载中...</div>
          <template v-else>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ viewName }}</span>
              <span v-if="viewBadge === '内置'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
              <span v-else-if="viewBadge === '全局'" style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">全局</span>
            </div>
            <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
            <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body }}</pre>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showViewModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- Edit Skill modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>编辑 Skill</h3>
          <button class="modal-close" @click="showEditModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Skill 名称</label>
            <input :value="editName" disabled />
          </div>
          <div class="form-group">
            <label>SKILL.md 内容 *</label>
            <textarea v-model="editContent" rows="20"
              style="font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showEditModal = false">取消</button>
          <button class="btn-primary" :disabled="editSaving" @click="saveSkill">
            {{ editSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Skill Hub modal -->
    <div v-if="showHub" class="modal-overlay" @click.self="showHub = false">
      <div class="modal-box wide" style="max-width:960px;width:90vw;display:flex;flex-direction:column;max-height:80vh">
        <div class="modal-header" style="flex-shrink:0">
          <h3>添加 Skill</h3>
          <button class="modal-close" @click="showHub = false">&times;</button>
        </div>
        <div style="display:flex;border-bottom:1px solid #e2e8f0;flex-shrink:0;padding:0 20px">
          <button
            v-for="tab in ([{key:'search',label:'搜索'},{key:'url',label:'URL 安装'}] as const)"
            :key="tab.key"
            @click="hubTab = tab.key"
            style="padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px"
            :style="hubTab === tab.key ? 'color:#4f46e5;border-bottom-color:#4f46e5' : 'color:#64748b'"
          >{{ tab.label }}</button>
        </div>
        <div class="modal-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <template v-if="hubTab === 'search'">
            <div style="display:flex;gap:8px;margin-bottom:16px;flex-shrink:0">
              <input v-model="hubQuery" placeholder="搜索 Skill（如 code-review、web-scraper）"
                style="flex:1" @keydown="hubKeydown" />
              <button class="btn-primary" :disabled="hubSearching || !hubQuery.trim()" @click="hubSearch">
                {{ hubSearching ? '搜索中...' : '搜索' }}
              </button>
            </div>
            <div style="flex:1;overflow-y:auto;min-height:0">
              <div v-if="hubSearching" style="text-align:center;color:#94a3b8;padding:40px">搜索中...</div>
              <template v-else-if="hubSearched">
                <div v-if="hubResults.length === 0" style="text-align:center;color:#94a3b8;padding:40px">未找到相关 Skill</div>
                <table v-else style="width:100%">
                  <thead><tr><th>名称</th><th>描述</th><th>版本</th><th>来源</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="s in hubResults" :key="s.provider + ':' + s.id">
                      <td style="font-family:monospace;white-space:nowrap">{{ s.name || s.id }}</td>
                      <td style="color:#475569;font-size:13px">{{ s.description || '-' }}</td>
                      <td style="font-size:12px;color:#94a3b8;white-space:nowrap">{{ s.version || '-' }}</td>
                      <td>
                        <span v-if="s.provider === 'clawhub'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
                        <span v-else-if="s.provider === 'skillsmp'" style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">SkillsMP</span>
                        <span v-else style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
                      </td>
                      <td style="white-space:nowrap;width:70px">
                        <button class="btn-primary btn-sm" @click="openInstall(s)">安装</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <div v-else style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">输入关键词搜索 Skill Hub</div>
            </div>
          </template>
          <template v-else-if="hubTab === 'url'">
            <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
              <input v-model="hubUrlInput"
                placeholder="输入 URL 安装（如 https://skills.sh/owner/repo/skill）"
                style="flex:1" @keydown.enter="installByUrl" />
              <button class="btn-primary" :disabled="hubUrlInstalling || !hubUrlInput.trim()" @click="installByUrl">
                {{ hubUrlInstalling ? '安装中...' : '安装' }}
              </button>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" v-model="hubUrlOverwrite" /> 覆盖已存在的同名 Skill
            </label>
            <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#64748b;line-height:1.7">
              支持格式：<br>
              <code style="font-family:monospace">https://skills.sh/{owner}/{repo}/{skill}</code><br>
              <code style="font-family:monospace">https://clawhub.ai/{slug}</code><br>
              <code style="font-family:monospace">https://skillsmp.com/skills/{slug}</code>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Install confirm modal -->
    <div v-if="showInstall && selected" class="modal-overlay" @click.self="showInstall = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>安装 Skill</h3>
          <button class="modal-close" @click="showInstall = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ selected.name || selected.id }}</span>
              <span v-if="selected.provider === 'clawhub'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
              <span v-else-if="selected.provider === 'skillsmp'" style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">SkillsMP</span>
              <span v-else style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
            </div>
            <div v-if="selected.description" style="font-size:13px;color:#475569">{{ selected.description }}</div>
          </div>
          <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            安装到：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" v-model="overwrite" />
            覆盖已存在的同名 Skill
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showInstall = false">取消</button>
          <button class="btn-primary" :disabled="installing" @click="confirmInstall">
            {{ installing ? '安装中...' : '确认安装' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AgentModal for editing config -->
    <AgentModal ref="agentModal" />
  </div>
</template>
