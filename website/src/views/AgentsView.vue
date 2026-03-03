<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { Agent, SubAgentRef } from '@/types'

const { show } = useToast()
const router = useRouter()

const agents = computed(() => store.settings.agents || {})
const modelOptions = computed(() => Object.keys(store.settings.models || {}))
const memoryOptions = computed(() => Object.keys(store.settings.memories || {}))
const saverOptions = computed(() => Object.keys(store.settings.savers || {}))
const agentOptions = computed(() => Object.keys(store.settings.agents || {}))
const mcpOptions = computed(() => [...store.mcpBuiltins, ...Object.keys(store.mcpServers)])
const skillOptions = computed(() => [
  ...store.skillBuiltins.map(s => s.name),
  ...store.globalSkills.map(s => s.name),
])

// ── Modal state ──
const showModal = ref(false)
const editingName = ref<string | null>(null)
const form = ref({
  name: '',
  type: 'single',
  // single
  model: '',
  systemPrompt: '',
  selectedMcp: [] as string[],
  selectedSkills: [] as string[],
  // react
  maxIterations: 5,
  think: '',
  reflect: '',
  summarizer: '',
  // supervisor
  maxRounds: 10,
  supervisor: '',
  finalize: '',
  // shared
  memory: '',
  saver: '',
})
const tempSubAgents = ref<SubAgentRef[]>([])

function openAdd() {
  editingName.value = null
  tempSubAgents.value = []
  form.value = {
    name: '', type: 'single', model: '', systemPrompt: '',
    selectedMcp: [], selectedSkills: [],
    maxIterations: 5, think: '', reflect: '', summarizer: '',
    maxRounds: 10, supervisor: '', finalize: '',
    memory: '', saver: '',
  }
  showModal.value = true
}

function openEdit(name: string) {
  const a = agents.value[name]
  editingName.value = name
  form.value = {
    name,
    type: a.type || 'single',
    model: a.model || '',
    systemPrompt: a.systemPrompt || '',
    selectedMcp: Array.isArray(a.mcp) ? [...a.mcp] : [],
    selectedSkills: Array.isArray(a.skills) ? [...a.skills] : [],
    maxIterations: a.maxIterations || 5,
    think: a.think || '',
    reflect: a.reflect || '',
    summarizer: a.summarizer || '',
    maxRounds: a.maxRounds || 10,
    supervisor: a.supervisor || '',
    finalize: a.finalize || '',
    memory: a.memory || '',
    saver: a.saver || '',
  }
  tempSubAgents.value = Array.isArray(a.agents) ? [...a.agents] : []
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  const { type } = form.value
  if (type === 'react') {
    if (!form.value.think) { show('ReAct 模式：Think Agent 不能为空', 'error'); return }
    if (!form.value.reflect) { show('ReAct 模式：Reflect 模型不能为空', 'error'); return }
    if (!form.value.summarizer) { show('ReAct 模式：Summarizer 模型不能为空', 'error'); return }
  } else if (type === 'supervisor') {
    if (!form.value.supervisor) { show('Supervisor 模式：Supervisor Agent 不能为空', 'error'); return }
    if (!form.value.summarizer) { show('Supervisor 模式：Summarizer 模型不能为空', 'error'); return }
    if (!form.value.finalize) { show('Supervisor 模式：Finalize 模型不能为空', 'error'); return }
  }
  try {
    const { name } = form.value
    const config: Agent = { type }

    if (type === 'single') {
      if (form.value.model) config.model = form.value.model
      if (form.value.systemPrompt) config.systemPrompt = form.value.systemPrompt
      if (form.value.selectedMcp.length > 0) config.mcp = form.value.selectedMcp
      if (form.value.selectedSkills.length > 0) config.skills = form.value.selectedSkills
    } else if (type === 'react') {
      config.maxIterations = form.value.maxIterations
      config.think = form.value.think
      config.reflect = form.value.reflect
      config.summarizer = form.value.summarizer
      config.agents = tempSubAgents.value
    } else if (type === 'supervisor') {
      config.maxRounds = form.value.maxRounds
      config.supervisor = form.value.supervisor
      config.summarizer = form.value.summarizer
      config.finalize = form.value.finalize
      config.agents = tempSubAgents.value
    }

    if (form.value.memory) config.memory = form.value.memory
    if (form.value.saver) config.saver = form.value.saver

    if (!store.settings.agents) store.settings.agents = {}
    if (editingName.value && editingName.value !== name) {
      delete store.settings.agents[editingName.value]
      if (store.settings.agent === editingName.value) store.settings.agent = name
    }
    store.settings.agents[name] = config
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('保存成功')
    showModal.value = false
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function copyAgent(name: string) {
  const agent = agents.value[name]
  if (!agent) return
  let newName = name + '-copy'
  let i = 2
  while (store.settings.agents![newName]) newName = name + '-copy' + (i++)
  try {
    store.settings.agents![newName] = JSON.parse(JSON.stringify(agent))
    await apiFetch('/api/settings', 'PUT', store.settings)
    show(`已复制为 ${newName}`)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function activateAgent(name: string) {
  try {
    store.settings.agent = name
    await apiFetch('/api/settings', 'PUT', store.settings)
    show(`已激活 ${name}`)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function removeAgent(name: string) {
  if (!confirm(`确定要删除 Agent "${name}" 吗？`)) return
  try {
    delete store.settings.agents![name]
    if (store.settings.agent === name) {
      store.settings.agent = Object.keys(store.settings.agents!)[0] || ''
    }
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('删除成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function refresh() {
  try {
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const mcpRes = await apiFetch('/api/mcp')
    store.mcpServers = mcpRes.data?.servers || {}
    store.mcpBuiltins = mcpRes.data?.builtins || []
    const skillRes = await apiFetch('/api/skills')
    store.skillBuiltins = skillRes.data?.builtins || []
    store.globalSkills = skillRes.data?.skills || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Sub-agent modal ──
const showSubModal = ref(false)
const subModalTitle = ref('')
const editingSubIdx = ref(-1)
const subForm = ref({ name: '', desc: '' })
const subAgentExclude = ref('')

function addSubAgent() {
  editingSubIdx.value = -1
  subModalTitle.value = '添加子 Agent'
  subAgentExclude.value = form.value.name
  subForm.value = { name: '', desc: '' }
  showSubModal.value = true
}

function editSubAgent(idx: number) {
  editingSubIdx.value = idx
  subModalTitle.value = '编辑子 Agent'
  subAgentExclude.value = form.value.name
  subForm.value = { ...tempSubAgents.value[idx] }
  showSubModal.value = true
}

function saveSubAgent() {
  if (!subForm.value.name) { show('请选择一个 Agent', 'error'); return }
  if (!subForm.value.desc.trim()) { show('描述不能为空', 'error'); return }
  const ref: SubAgentRef = { name: subForm.value.name, desc: subForm.value.desc.trim() }
  if (editingSubIdx.value >= 0) {
    tempSubAgents.value[editingSubIdx.value] = ref
  } else {
    tempSubAgents.value.push(ref)
  }
  showSubModal.value = false
  show('子 Agent 已更新')
}

function deleteSubAgent(idx: number) {
  if (!confirm('确定要删除此子 Agent 吗？')) return
  tempSubAgents.value.splice(idx, 1)
  show('子 Agent 已删除')
}

function toggleMcp(name: string, checked: boolean) {
  if (checked) {
    if (!form.value.selectedMcp.includes(name)) form.value.selectedMcp.push(name)
  } else {
    form.value.selectedMcp = form.value.selectedMcp.filter(n => n !== name)
  }
}

function toggleSkill(name: string, checked: boolean) {
  if (checked) {
    if (!form.value.selectedSkills.includes(name)) form.value.selectedSkills.push(name)
  } else {
    form.value.selectedSkills = form.value.selectedSkills.filter(n => n !== name)
  }
}

function subAgentSelectOptions() {
  return agentOptions.value.filter(n => n !== subAgentExclude.value)
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="refresh">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加 Agent</button>
    </div>
    <div class="page-content">
      <table>
        <thead>
          <tr><th>名称</th><th>类型</th><th>模型</th><th>存储</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(agents).length === 0">
            <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无 Agent</td>
          </tr>
          <tr v-for="(a, name) in agents" :key="name">
            <td>
              <span style="font-family:monospace;font-weight:500">{{ name }}</span>
              <span v-if="store.settings.agent === name" style="margin-left:6px;background:#6366f1;color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">活跃</span>
            </td>
            <td>{{ a.type }}</td>
            <td>{{ a.model || '-' }}</td>
            <td>{{ a.saver || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button
                  class="btn-outline btn-sm"
                  :disabled="store.settings.agent === name"
                  @click="activateAgent(name as string)"
                >激活</button>
                <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                <button class="btn-outline btn-sm" :disabled="a.type !== 'single'" @click="router.push(`/mcp/agent/${name}`)">MCP</button>
                <button class="btn-outline btn-sm" :disabled="a.type !== 'single'" @click="router.push(`/agents/${name}/skills`)">Skills</button>
                <button class="btn-outline btn-sm" @click="copyAgent(name as string)">复制</button>
                <button class="btn-danger btn-sm" @click="removeAgent(name as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Agent Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box wide" style="max-height:90vh">
        <div class="modal-header">
          <h3>{{ editingName ? '编辑 Agent' : '添加 Agent' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 (唯一标识) *</label>
            <input v-model="form.name" :disabled="!!editingName" placeholder="如 default, my-agent" />
          </div>
          <div class="form-group">
            <label>类型 *</label>
            <select v-model="form.type">
              <option value="single">Single (单 Agent)</option>
              <option value="react">ReAct (迭代决策)</option>
              <option value="supervisor">Supervisor (主管调度)</option>
            </select>
          </div>

          <!-- Memory & Saver (all types) -->
          <div class="form-section">
            <div class="form-group">
              <label>记忆配置</label>
              <select v-model="form.memory">
                <option value="">不使用</option>
                <option v-for="m in memoryOptions" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>会话存储</label>
              <select v-model="form.saver">
                <option value="">不使用</option>
                <option v-for="s in saverOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <!-- Single-only fields -->
          <template v-if="form.type === 'single'">
            <div class="form-group">
              <label>模型</label>
              <select v-model="form.model">
                <option value="">不使用</option>
                <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>系统提示词</label>
              <textarea v-model="form.systemPrompt" rows="3" placeholder="可选" />
            </div>
          </template>

          <!-- ReAct fields -->
          <template v-else-if="form.type === 'react'">
            <div class="form-group">
              <label>最大迭代次数</label>
              <input v-model.number="form.maxIterations" type="number" min="1" max="50" placeholder="5" />
            </div>
            <div class="form-section">
              <div class="form-section-title">Think 节点</div>
              <div class="form-group">
                <label>Think Agent *</label>
                <select v-model="form.think">
                  <option value="">请选择</option>
                  <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">Reflect 节点</div>
              <div class="form-group">
                <label>Reflect 模型 *</label>
                <select v-model="form.reflect">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">Summarizer 节点</div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">
                子 Agents
                <button class="btn-outline btn-sm" @click="addSubAgent">+ 添加</button>
              </div>
              <div v-for="(ref, i) in tempSubAgents" :key="i" class="sub-agent-item">
                <div class="sub-agent-item-header">
                  <span class="sub-agent-item-name">{{ ref.name }}</span>
                  <div class="ops-cell">
                    <button class="btn-outline btn-sm" @click="editSubAgent(i)">编辑</button>
                    <button class="btn-danger btn-sm" @click="deleteSubAgent(i)">删除</button>
                  </div>
                </div>
                <div class="sub-agent-item-desc">{{ ref.desc }}</div>
              </div>
              <div v-if="tempSubAgents.length === 0" style="color:#94a3b8;font-size:12px;padding:4px">暂无子 Agent</div>
            </div>
          </template>

          <!-- Supervisor fields -->
          <template v-else-if="form.type === 'supervisor'">
            <div class="form-group">
              <label>最大调度轮次</label>
              <input v-model.number="form.maxRounds" type="number" min="1" max="50" placeholder="10" />
            </div>
            <div class="form-section">
              <div class="form-section-title">Supervisor 节点</div>
              <div class="form-group">
                <label>Supervisor Agent *</label>
                <select v-model="form.supervisor">
                  <option value="">请选择</option>
                  <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">Summarizer 节点</div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">Finalize 节点</div>
              <div class="form-group">
                <label>Finalize 模型 *</label>
                <select v-model="form.finalize">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">
                Worker Agents
                <button class="btn-outline btn-sm" @click="addSubAgent">+ 添加</button>
              </div>
              <div v-for="(ref, i) in tempSubAgents" :key="i" class="sub-agent-item">
                <div class="sub-agent-item-header">
                  <span class="sub-agent-item-name">{{ ref.name }}</span>
                  <div class="ops-cell">
                    <button class="btn-outline btn-sm" @click="editSubAgent(i)">编辑</button>
                    <button class="btn-danger btn-sm" @click="deleteSubAgent(i)">删除</button>
                  </div>
                </div>
                <div class="sub-agent-item-desc">{{ ref.desc }}</div>
              </div>
              <div v-if="tempSubAgents.length === 0" style="color:#94a3b8;font-size:12px;padding:4px">暂无子 Agent</div>
            </div>
          </template>

          <!-- MCP：仅 single 类型显示 -->
          <div v-if="form.type === 'single'" class="form-section">
            <div class="form-section-title">MCP</div>
            <div v-if="mcpOptions.length === 0" style="color:#94a3b8;font-size:12px;padding:4px">暂无全局 MCP 服务器</div>
            <div class="check-row">
              <label v-for="m in mcpOptions" :key="m" class="check-item">
                <input
                  type="checkbox"
                  :checked="form.selectedMcp.includes(m)"
                  @change="toggleMcp(m, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ m }}</span>
              </label>
            </div>
          </div>

          <!-- Skills：仅 single 类型显示 -->
          <div v-if="form.type === 'single'" class="form-section">
            <div class="form-section-title">Skills</div>
            <div v-if="skillOptions.length === 0" style="color:#94a3b8;font-size:12px;padding:4px">暂无全局 Skills</div>
            <div class="check-row">
              <label v-for="s in skillOptions" :key="s" class="check-item">
                <input
                  type="checkbox"
                  :checked="form.selectedSkills.includes(s)"
                  @change="toggleSkill(s, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ s }}</span>
              </label>
            </div>
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <!-- Sub-agent Modal -->
    <div v-if="showSubModal" class="modal-overlay" @click.self="showSubModal = false" style="z-index:1100">
      <div class="modal-box" style="width:400px">
        <div class="modal-header">
          <h3>{{ subModalTitle }}</h3>
          <button class="modal-close" @click="showSubModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Agent *</label>
            <select v-model="subForm.name">
              <option value="">请选择</option>
              <option v-for="a in subAgentSelectOptions()" :key="a" :value="a">{{ a }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>描述 *</label>
            <input v-model="subForm.desc" placeholder="Agent 描述，用于 LLM 规划时参考" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showSubModal = false">取消</button>
          <button class="btn-primary" @click="saveSubAgent">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
