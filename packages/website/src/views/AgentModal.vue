<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { Agent, SubAgentRef } from '@/types'

const emit = defineEmits<{ saved: [] }>()
const { show } = useToast()

const agents      = computed(() => store.settings.agents || {})
const modelOptions  = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)
const agentOptions  = computed(() =>
  Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)
// MCP options with metadata
const mcpOptionsWithMeta = computed(() => [
  ...store.mcpBuiltins.map(b => ({ name: b.name, isBuiltin: true, desc: b.description || '' })),
  ...Object.keys(store.mcpServers).map(k => ({ name: k, isBuiltin: false, desc: store.mcpServers[k].type || '' })),
])
const skillOptionsWithMeta = computed(() => [
  ...store.skillBuiltins.map(s => ({ name: s.name, isBuiltin: true, desc: s.description || '' })),
  ...store.globalSkills.map(s => ({ name: s.name, isBuiltin: false, desc: s.description || '' })),
])

// Search filters & collapse state
const mcpSearch     = ref('')
const skillSearch   = ref('')
const mcpExpanded   = ref(false)
const skillExpanded = ref(false)

const filteredMcpOptions = computed(() => {
  const q = mcpSearch.value.trim().toLowerCase()
  if (!q) return mcpOptionsWithMeta.value
  return mcpOptionsWithMeta.value.filter(m => m.name.toLowerCase().includes(q))
})
const filteredSkillOptions = computed(() => {
  const q = skillSearch.value.trim().toLowerCase()
  if (!q) return skillOptionsWithMeta.value
  return skillOptionsWithMeta.value.filter(s =>
    s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
  )
})


// ── Main modal ──
const showModal  = ref(false)
const editingId  = ref<string | null>(null)
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
})
const tempSubAgents = ref<SubAgentRef[]>([])

function open(id?: string) {
  if (id) {
    const a = agents.value[id]
    editingId.value = id
    form.value = {
      name: (a as any).name || '',
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
    }
    tempSubAgents.value = Array.isArray(a.agents) ? [...a.agents] : []
  } else {
    editingId.value = null
    tempSubAgents.value = []
    form.value = {
      name: '', type: 'single', model: '', systemPrompt: '',
      selectedMcp: [], selectedSkills: [],
      maxIterations: 5, think: '', reflect: '', summarizer: '',
      maxRounds: 10, supervisor: '', finalize: '',
    }
  }
  mcpSearch.value = ''
  skillSearch.value = ''
  mcpExpanded.value = false
  skillExpanded.value = false
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

    if (form.value.name.trim()) (config as any).name = form.value.name.trim()
    const id = editingId.value
    const res = id
      ? await apiFetch(`/api/settings/agents/${encodeURIComponent(id)}`, 'PUT', config)
      : await apiFetch('/api/settings/agents', 'POST', config)
    Object.assign(store.settings, res.data)
    show('保存成功')
    showModal.value = false
    emit('saved')
  } catch (e: any) {
    show(e.message, 'error')
  }
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
  return agentOptions.value.filter(a => a.id !== subAgentExclude.value)
}

defineExpose({ open })
</script>

<template>
  <!-- Agent Modal -->
  <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
    <div class="modal-box wide" style="max-height:90vh">
      <div class="modal-header">
        <h3>{{ editingId ? '编辑智能体' : '添加智能体' }}</h3>
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
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
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
                  <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Reflect 模型 *</label>
                <select v-model="form.reflect">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
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
                  <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Summarizer 模型 *</label>
                <select v-model="form.summarizer">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Finalize 模型 *</label>
                <select v-model="form.finalize">
                  <option value="">请选择</option>
                  <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
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

        <!-- MCP & Skills：仅 single 类型显示 -->
        <template v-if="form.type === 'single'">
          <!-- MCP 折叠面板 -->
          <div class="form-section" style="margin-top:16px">
            <div
              class="form-section-title"
              style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;margin-top:0"
              @click="mcpExpanded = !mcpExpanded"
            >
              <span style="font-size:10px;color:#9b9b9b;transition:transform .15s;display:inline-block"
                :style="mcpExpanded ? 'transform:rotate(90deg)' : ''">▶</span>
              MCP 工具
              <span v-if="form.selectedMcp.length" class="form-details-badge">{{ form.selectedMcp.length }}</span>
            </div>
            <template v-if="mcpExpanded">
              <div v-if="mcpOptionsWithMeta.length === 0" style="color:#94a3b8;font-size:12px;padding:6px 0">暂无可用 MCP 服务器</div>
              <template v-else>
                <input
                  v-model="mcpSearch"
                  placeholder="搜索 MCP..."
                  style="width:100%;margin-bottom:6px;padding:5px 8px;border:1px solid #e8e6e3;border-radius:5px;font-size:12px;outline:none"
                />
                <div style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden;max-height:160px;overflow-y:auto">
                  <div v-if="filteredMcpOptions.length === 0" style="padding:12px;text-align:center;color:#9b9b9b;font-size:12px">无匹配结果</div>
                  <label
                    v-for="m in filteredMcpOptions"
                    :key="m.name"
                    style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:12px"
                    :style="form.selectedMcp.includes(m.name) ? 'background:#f0f9ff' : ''"
                  >
                    <input type="checkbox" :value="m.name" v-model="form.selectedMcp" style="cursor:pointer;flex-shrink:0" />
                    <span style="font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.name }}</span>
                    <span v-if="m.isBuiltin" style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 5px;border-radius:8px;font-weight:600">内置</span>
                    <span v-else style="flex-shrink:0;background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 5px;border-radius:8px;font-weight:600">{{ m.desc || '自定义' }}</span>
                  </label>
                </div>
              </template>
            </template>
          </div>

          <!-- Skills 折叠面板 -->
          <div class="form-section">
            <div
              class="form-section-title"
              style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px"
              @click="skillExpanded = !skillExpanded"
            >
              <span style="font-size:10px;color:#9b9b9b;transition:transform .15s;display:inline-block"
                :style="skillExpanded ? 'transform:rotate(90deg)' : ''">▶</span>
              Skills
              <span v-if="form.selectedSkills.length" class="form-details-badge">{{ form.selectedSkills.length }}</span>
            </div>
            <template v-if="skillExpanded">
              <div v-if="skillOptionsWithMeta.length === 0" style="color:#94a3b8;font-size:12px;padding:6px 0">暂无可用 Skill</div>
              <template v-else>
                <input
                  v-model="skillSearch"
                  placeholder="搜索 Skill..."
                  style="width:100%;margin-bottom:6px;padding:5px 8px;border:1px solid #e8e6e3;border-radius:5px;font-size:12px;outline:none"
                />
                <div style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden;max-height:160px;overflow-y:auto">
                  <div v-if="filteredSkillOptions.length === 0" style="padding:12px;text-align:center;color:#9b9b9b;font-size:12px">无匹配结果</div>
                  <label
                    v-for="s in filteredSkillOptions"
                    :key="s.name"
                    style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:12px"
                    :style="form.selectedSkills.includes(s.name) ? 'background:#f0fdf4' : ''"
                  >
                    <input type="checkbox" :value="s.name" v-model="form.selectedSkills" style="cursor:pointer;flex-shrink:0" />
                    <span style="font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</span>
                    <span v-if="s.desc" style="flex-shrink:0;color:#6b6b6b;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.desc }}</span>
                    <span v-if="s.isBuiltin" style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 5px;border-radius:8px;font-weight:600">内置</span>
                    <span v-else style="flex-shrink:0;background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 5px;border-radius:8px;font-weight:600">全局</span>
                  </label>
                </div>
              </template>
            </template>
          </div>
        </template>

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
            <option v-for="a in subAgentSelectOptions()" :key="a.id" :value="a.id">{{ a.label }}</option>
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
