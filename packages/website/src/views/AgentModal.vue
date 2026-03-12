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

// ── Main modal ──
const showModal  = ref(false)
const editingId  = ref<string | null>(null)
const form = ref({
  name: '',
  type: 'single',
  model: '',
  systemPrompt: '',
  think: '',
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
      think: a.think || '',
    }
    tempSubAgents.value = Array.isArray(a.agents) ? [...a.agents] : []
  } else {
    editingId.value = null
    tempSubAgents.value = []
    form.value = {
      name: '', type: 'single', model: '', systemPrompt: '',
      think: '',
    }
  }
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  const { type } = form.value
  if (type === 'react') {
    if (!form.value.think) { show('ReAct 模式：Think 模型不能为空', 'error'); return }
  }
  try {
    const config: Agent = { type }

    if (form.value.systemPrompt) config.systemPrompt = form.value.systemPrompt
    if (type === 'single') {
      if (form.value.model) config.model = form.value.model
      // 保留在专属页面配置的 mcp 和 skills
      const existing = editingId.value ? agents.value[editingId.value] : null
      if (Array.isArray(existing?.mcp)    && existing.mcp.length)    config.mcp    = existing.mcp
      if (Array.isArray(existing?.skills) && existing.skills.length) config.skills = existing.skills
    } else if (type === 'react') {
      config.think  = form.value.think
      config.agents = tempSubAgents.value
      // 保留在专属页面配置的 mcp 和 skills
      const existingReact = editingId.value ? agents.value[editingId.value] : null
      if (Array.isArray(existingReact?.mcp)    && existingReact.mcp.length)    config.mcp    = existingReact.mcp
      if (Array.isArray(existingReact?.skills) && existingReact.skills.length) config.skills = existingReact.skills
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
const subForm        = ref({ id: '', name: '', desc: '' })
const subAgentExclude = ref('')

function addSubAgent() {
  editingSubIdx.value   = -1
  subModalTitle.value   = '添加子 Agent'
  subAgentExclude.value = form.value.name
  subForm.value         = { id: '', name: '', desc: '' }
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
  if (!subForm.value.id)             { show('请选择一个 Agent', 'error'); return }
  if (!subForm.value.name.trim())    { show('名称不能为空',     'error'); return }
  if (!subForm.value.desc.trim())    { show('描述不能为空',     'error'); return }
  const ref: SubAgentRef = { id: subForm.value.id, name: subForm.value.name.trim(), desc: subForm.value.desc.trim() }
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
  return agentOptions.value.filter(a =>
    a.id !== subAgentExclude.value &&
    (agents.value[a.id] as any)?.type === 'single'
  )
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
            <div class="form-group">
              <label>Think 模型 *</label>
              <select v-model="form.think">
                <option value="">请选择</option>
                <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
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
                <span class="sub-agent-item-name">{{ (agents[ref.id] as any)?.name || ref.id }}</span>
                <span style="font-size:11px;color:#94a3b8;margin-left:6px">{{ ref.name }}</span>
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
          <select v-model="subForm.id">
            <option value="">请选择</option>
            <option v-for="a in subAgentSelectOptions()" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>名称 *</label>
          <input v-model="subForm.name" placeholder="LLM 调用时使用的标识名" />
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

