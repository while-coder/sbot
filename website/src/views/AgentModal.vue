<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { Agent, SubAgentRef } from '@/types'

const emit = defineEmits<{ saved: [] }>()
const { show } = useToast()

const agents      = computed(() => store.settings.agents || {})
const modelOptions  = computed(() => Object.keys(store.settings.models   || {}))
const memoryOptions = computed(() => Object.keys(store.settings.memories || {}))
const saverOptions  = computed(() => Object.keys(store.settings.savers   || {}))
const agentOptions  = computed(() => Object.keys(store.settings.agents   || {}))
const mcpOptions    = computed(() => [...store.mcpBuiltins.map(b => b.name), ...Object.keys(store.mcpServers)])
const skillOptions  = computed(() => [
  ...store.skillBuiltins.map(s => s.name),
  ...store.globalSkills.map(s => s.name),
])

// ── Main modal ──
const showModal  = ref(false)
const editingName = ref<string | null>(null)
const form = ref({
  name: '',
  type: 'single',
  model: '',
  systemPrompt: '',
  selectedMcp: [] as string[],
  selectedSkills: [] as string[],
  maxIterations: 5,
  think: '',
  reflect: '',
  summarizer: '',
  maxRounds: 10,
  supervisor: '',
  finalize: '',
  memory: '',
  saver: '',
})
const tempSubAgents = ref<SubAgentRef[]>([])

function open(name?: string) {
  if (name) {
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
  } else {
    editingName.value = null
    tempSubAgents.value = []
    form.value = {
      name: '', type: 'single', model: '', systemPrompt: '',
      selectedMcp: [], selectedSkills: [],
      maxIterations: 5, think: '', reflect: '', summarizer: '',
      maxRounds: 10, supervisor: '', finalize: '',
      memory: '', saver: '',
    }
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  const { type } = form.value
  if (type === 'react') {
    if (!form.value.think)      { show('ReAct 模式：Think Agent 不能为空',     'error'); return }
    if (!form.value.reflect)    { show('ReAct 模式：Reflect 模型不能为空',      'error'); return }
    if (!form.value.summarizer) { show('ReAct 模式：Summarizer 模型不能为空',   'error'); return }
  } else if (type === 'supervisor') {
    if (!form.value.supervisor) { show('Supervisor 模式：Supervisor Agent 不能为空', 'error'); return }
    if (!form.value.summarizer) { show('Supervisor 模式：Summarizer 模型不能为空',   'error'); return }
    if (!form.value.finalize)   { show('Supervisor 模式：Finalize 模型不能为空',     'error'); return }
  }
  try {
    const { name } = form.value
    const config: Agent = { type }

    if (form.value.systemPrompt) config.systemPrompt = form.value.systemPrompt
    if (type === 'single') {
      if (form.value.model)               config.model        = form.value.model
      if (form.value.selectedMcp.length)  config.mcp          = form.value.selectedMcp
      if (form.value.selectedSkills.length) config.skills     = form.value.selectedSkills
    } else if (type === 'react') {
      config.maxIterations = form.value.maxIterations
      config.think         = form.value.think
      config.reflect       = form.value.reflect
      config.summarizer    = form.value.summarizer
      config.agents        = tempSubAgents.value
    } else if (type === 'supervisor') {
      config.maxRounds  = form.value.maxRounds
      config.supervisor = form.value.supervisor
      config.summarizer = form.value.summarizer
      config.finalize   = form.value.finalize
      config.agents     = tempSubAgents.value
    }

    if (form.value.memory) config.memory = form.value.memory
    if (form.value.saver)  config.saver  = form.value.saver

    if (!store.settings.agents) store.settings.agents = {}
    const oldName = editingName.value
    if (oldName && oldName !== name) {
      // 改名：由服务端统一同步所有引用
      const res = await apiFetch(`/api/agents/${encodeURIComponent(oldName)}/rename`, 'POST', { name })
      Object.assign(store.settings, res.data)
    }
    store.settings.agents![name] = config
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('保存成功')
    showModal.value = false
    emit('saved')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function addMcp(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  if (name && !form.value.selectedMcp.includes(name)) form.value.selectedMcp.push(name)
  ;(e.target as HTMLSelectElement).value = ''
}
function removeMcp(name: string) {
  form.value.selectedMcp = form.value.selectedMcp.filter(n => n !== name)
}
function addSkill(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  if (name && !form.value.selectedSkills.includes(name)) form.value.selectedSkills.push(name)
  ;(e.target as HTMLSelectElement).value = ''
}
function removeSkill(name: string) {
  form.value.selectedSkills = form.value.selectedSkills.filter(n => n !== name)
}

// ── Sub-agent modal ──
const showSubModal   = ref(false)
const subModalTitle  = ref('')
const editingSubIdx  = ref(-1)
const subForm        = ref({ name: '', desc: '' })
const subAgentExclude = ref('')

function addSubAgent() {
  editingSubIdx.value   = -1
  subModalTitle.value   = '添加子 Agent'
  subAgentExclude.value = form.value.name
  subForm.value         = { name: '', desc: '' }
  showSubModal.value    = true
}

function editSubAgent(idx: number) {
  editingSubIdx.value   = idx
  subModalTitle.value   = '编辑子 Agent'
  subAgentExclude.value = form.value.name
  subForm.value         = { ...tempSubAgents.value[idx] }
  showSubModal.value    = true
}

function saveSubAgent() {
  if (!subForm.value.name)           { show('请选择一个 Agent', 'error'); return }
  if (!subForm.value.desc.trim())    { show('描述不能为空',     'error'); return }
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

function subAgentSelectOptions() {
  return agentOptions.value.filter(n => n !== subAgentExclude.value)
}

defineExpose({ open })
</script>

<template>
  <!-- Agent Modal -->
  <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
    <div class="modal-box wide" style="max-height:90vh">
      <div class="modal-header">
        <h3>{{ editingName ? '编辑智能体' : '添加智能体' }}</h3>
        <button class="modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>名称 (唯一标识) *</label>
          <input v-model="form.name" placeholder="如 default, my-agent" />
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
        <div class="form-nodes-grid">
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

        <!-- 系统提示词（所有类型） -->
        <div class="form-group">
          <label>系统提示词</label>
          <textarea v-model="form.systemPrompt" rows="3" placeholder="可选" />
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
        </template>

        <!-- ReAct fields -->
        <template v-else-if="form.type === 'react'">
          <div class="form-section">
            <div class="form-section-title">节点配置</div>
            <div class="form-nodes-grid">
              <div class="form-group">
                <label>最大迭代次数</label>
                <input v-model.number="form.maxIterations" type="number" min="1" max="50" placeholder="5" />
              </div>
              <div class="form-group">
                <label>Think Agent *</label>
                <select v-model="form.think">
                  <option value="">请选择</option>
                  <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Reflect 模型 *</label>
                <select v-model="form.reflect">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
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
          <div class="form-section">
            <div class="form-section-title">节点配置</div>
            <div class="form-nodes-grid">
              <div class="form-group">
                <label>最大调度轮次</label>
                <input v-model.number="form.maxRounds" type="number" min="1" max="50" placeholder="10" />
              </div>
              <div class="form-group">
                <label>Supervisor Agent *</label>
                <select v-model="form.supervisor">
                  <option value="">请选择</option>
                  <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Finalize 模型 *</label>
                <select v-model="form.finalize">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
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

        <!-- MCP & Skills：仅 single 类型显示，折叠面板 -->
        <details v-if="form.type === 'single'" class="form-details">
          <summary class="form-details-summary">
            MCP / Skills
            <span v-if="form.selectedMcp.length + form.selectedSkills.length > 0" class="form-details-badge">
              {{ form.selectedMcp.length + form.selectedSkills.length }}
            </span>
          </summary>
          <div class="form-details-body">
            <div class="form-section-title" style="margin-top:0">MCP</div>
            <div class="tag-select-row">
              <span v-for="m in form.selectedMcp" :key="m" class="tag-item">
                {{ m }}<button type="button" class="tag-remove" @click="removeMcp(m)">&times;</button>
              </span>
              <select v-if="mcpOptions.filter(m => !form.selectedMcp.includes(m)).length > 0" class="tag-add-select" @change="addMcp">
                <option value="">+ 添加 MCP</option>
                <option v-for="m in mcpOptions.filter(m => !form.selectedMcp.includes(m))" :key="m" :value="m">{{ m }}</option>
              </select>
              <span v-else-if="mcpOptions.length === 0" style="color:#94a3b8;font-size:12px">暂无全局 MCP 服务器</span>
            </div>
            <div class="form-section-title">Skills</div>
            <div class="tag-select-row">
              <span v-for="s in form.selectedSkills" :key="s" class="tag-item">
                {{ s }}<button type="button" class="tag-remove" @click="removeSkill(s)">&times;</button>
              </span>
              <select v-if="skillOptions.filter(s => !form.selectedSkills.includes(s)).length > 0" class="tag-add-select" @change="addSkill">
                <option value="">+ 添加 Skill</option>
                <option v-for="s in skillOptions.filter(s => !form.selectedSkills.includes(s))" :key="s" :value="s">{{ s }}</option>
              </select>
              <span v-else-if="skillOptions.length === 0" style="color:#94a3b8;font-size:12px">暂无全局 Skills</span>
            </div>
          </div>
        </details>

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
</template>

<style scoped>
.form-nodes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
</style>
