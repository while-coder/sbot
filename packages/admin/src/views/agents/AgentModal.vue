<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { AgentMode } from '@/types'
import type { Agent, SubAgentRef } from '@/types'

const { t } = useI18n()

const emit = defineEmits<{ saved: [] }>()

const acpPresets = [
  { label: 'Claude Code', command: 'npx', args: '-y @anthropic-ai/claude-code@latest --acp' },
  { label: 'OpenCode', command: 'npx', args: '-y @anthropic-ai/opencode@latest --acp' },
  { label: 'Codex', command: 'npx', args: '-y @openai/codex@latest --acp' },
  { label: 'Cline', command: 'npx', args: '-y cline@latest --acp' },
  { label: 'Qwen Code', command: 'npx', args: '-y qwen-agent-acp@latest' },
]

function applyPreset(idx: number) {
  if (idx < 0) return
  const p = acpPresets[idx]
  form.value.command = p.command
  form.value.args = p.args
}
const { show } = useToast()

const agents      = computed(() => store.settings.agents || {})
const modelOptions  = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]) => ({ id, label: m.name || id }))
)
const agentOptions  = computed(() =>
  Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id, type: (a as any).type || '' }))
)

// ── Main modal ──
const showModal  = ref(false)
const editingId  = ref<string | null>(null)
const form = ref({
  id: '',
  name: '',
  type: AgentMode.Single as string,
  model: '',
  compactModel: '',
  compactPrompt: '',
  systemPrompt: '',
  autoApproveAllTools: false,
  modelCallTimeout: undefined as number | undefined,
  // acp
  command: '',
  args: '',
  env: [] as { key: string; value: string }[],
  sessionMode: 'persistent' as 'transient' | 'persistent',
})
const tempSubAgents = ref<SubAgentRef[]>([])

function open(id?: string) {
  if (id) {
    const a = agents.value[id]
    editingId.value = id
    form.value = {
      id: id,
      name: (a as any).name || '',
      type: a.type || AgentMode.Single,
      model: a.model || '',
      compactModel: (a as any).compactModel || '',
      compactPrompt: (a as any).compactPrompt || '',
      systemPrompt: a.systemPrompt || '',
      autoApproveAllTools: !!(a as any).autoApproveAllTools,
      modelCallTimeout: (a as any).modelCallTimeout ?? undefined,
      command: a.command || '',
      args: Array.isArray(a.args) ? a.args.join(' ') : '',
      env: a.env ? Object.entries(a.env).map(([key, value]) => ({ key, value })) : [],
      sessionMode: (a as any).sessionMode || 'persistent',
    }
    tempSubAgents.value = Array.isArray(a.agents) ? [...a.agents] : []
  } else {
    editingId.value = null
    tempSubAgents.value = []
    form.value = {
      id: '', name: '', type: AgentMode.Single, model: '', compactModel: '', compactPrompt: '',
      systemPrompt: '', autoApproveAllTools: false, modelCallTimeout: undefined,
      command: '', args: '', env: [], sessionMode: 'persistent',
    }
  }
  showModal.value = true
}

async function save() {
  if (!editingId.value && !form.value.id.trim()) { show('ID is required', 'error'); return }
  if (!form.value.name.trim()) { show(t('common.name_required'), 'error'); return }
  const { type } = form.value
  if (type !== AgentMode.ACP && !form.value.model) { show(t('agents.error_model'), 'error'); return }
  if (type === AgentMode.ACP && !form.value.command.trim()) { show(t('agents.error_command'), 'error'); return }
  if (type === AgentMode.ReAct && tempSubAgents.value.length === 0) {
    show(t('agents.error_sub_agents'), 'error'); return
  }
  try {
    const config: Agent = { type, model: form.value.model }

    if (form.value.systemPrompt) config.systemPrompt = form.value.systemPrompt
    if (form.value.compactModel) (config as any).compactModel = form.value.compactModel
    if (form.value.compactPrompt) (config as any).compactPrompt = form.value.compactPrompt
    if (form.value.autoApproveAllTools) (config as any).autoApproveAllTools = true
    if (form.value.modelCallTimeout != null && form.value.modelCallTimeout > 0) config.modelCallTimeout = form.value.modelCallTimeout
    if (type === AgentMode.ReAct) {
      config.agents = tempSubAgents.value
    }
    if (type === AgentMode.ACP) {
      config.command = form.value.command.trim()
      const argsStr = form.value.args.trim()
      if (argsStr) config.args = argsStr.split(/\s+/)
      const envEntries = form.value.env.filter(e => e.key.trim())
      if (envEntries.length) config.env = Object.fromEntries(envEntries.map(e => [e.key.trim(), e.value]))
      if (form.value.sessionMode !== 'persistent') config.sessionMode = form.value.sessionMode
    }
    // 保留在专属页面配置的字段（generative/acp 模式无工具/技能，不保留）
    const existing = editingId.value ? agents.value[editingId.value] : null
    if (type !== AgentMode.Generative && type !== AgentMode.ACP) {
      if (existing?.mcp)    config.mcp    = existing.mcp
      if (existing?.skills) config.skills = existing.skills
      if ((existing as any)?.autoApproveTools) (config as any).autoApproveTools = (existing as any).autoApproveTools
    }

    if (form.value.name.trim()) (config as any).name = form.value.name.trim()
    const id = editingId.value
    if (id) {
      await apiFetch(`/api/agents/${encodeURIComponent(id)}`, 'PUT', config)
    } else {
      if (form.value.id.trim()) (config as any).id = form.value.id.trim()
      await apiFetch('/api/agents', 'POST', config)
    }
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
    show(t('common.saved'))
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
const subForm        = ref({ id: '', desc: '' })
const subAgentExclude = ref('')

function addSubAgent() {
  editingSubIdx.value   = -1
  subModalTitle.value   = t('agents.add_sub_title')
  subAgentExclude.value = form.value.name
  subForm.value         = { id: '', desc: '' }
  showSubModal.value    = true
}

function editSubAgent(idx: number) {
  editingSubIdx.value   = idx
  subModalTitle.value   = t('agents.edit_sub_title')
  subAgentExclude.value = form.value.name
  subForm.value         = { ...tempSubAgents.value[idx] }
  showSubModal.value    = true
}

function saveSubAgent() {
  if (!subForm.value.id)             { show(t('agents.error_agent'), 'error'); return }
  if (!subForm.value.desc.trim())    { show(t('agents.error_desc'),  'error'); return }
  const ref: SubAgentRef = { id: subForm.value.id, desc: subForm.value.desc.trim() }
  if (editingSubIdx.value >= 0) {
    tempSubAgents.value[editingSubIdx.value] = ref
  } else {
    tempSubAgents.value.push(ref)
  }
  showSubModal.value = false
  show(t('agents.sub_updated'))
}

function deleteSubAgent(idx: number) {
  if (!window.confirm(t('agents.confirm_delete_sub'))) return
  tempSubAgents.value.splice(idx, 1)
  show(t('agents.sub_deleted'))
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
        <h3>{{ editingId ? t('agents.edit_title') : t('agents.add_title') }}</h3>
        <button class="modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" v-if="!editingId">
          <label>ID *</label>
          <input v-model="form.id" placeholder="ID" />
          <span style="font-size:0.78rem;color:var(--color-text-muted,#888);margin-top:2px">{{ t('agents.id_hint') }}</span>
        </div>
        <div class="form-group">
          <label>{{ t('agents.name') }} *</label>
          <input v-model="form.name" :placeholder="t('agents.name_placeholder')" />
        </div>
        <div class="form-group">
          <label>{{ t('common.type') }} *</label>
          <select v-model="form.type">
            <option :value="AgentMode.Single">{{ t('agents.type_single') }}</option>
            <option :value="AgentMode.ReAct">{{ t('agents.type_react') }}</option>
            <option :value="AgentMode.Generative">{{ t('agents.type_generative') }}</option>
            <option :value="AgentMode.ACP">{{ t('agents.type_acp') }}</option>
          </select>
        </div>

        <!-- 系统提示词（所有类型） -->
        <div class="form-group">
          <label>{{ t('agents.system_prompt') }}</label>
          <textarea v-model="form.systemPrompt" rows="3" :placeholder="t('agents.system_prompt_placeholder')" />
        </div>

        <!-- Model (ACP 模式不需要本地模型) -->
        <div class="form-group" v-if="form.type !== AgentMode.ACP">
          <label>{{ t('agents.model_col') }} *</label>
          <select v-model="form.model">
            <option value="">{{ t('common.select_placeholder') }}</option>
            <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>

        <!-- Compact Model (Single 模式) -->
        <div class="form-group" v-if="form.type === AgentMode.Single">
          <label>{{ t('agents.compact_model') }}</label>
          <select v-model="form.compactModel">
            <option value="">{{ t('agents.compact_model_placeholder') }}</option>
            <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>

        <!-- Compact Prompt (Single 模式，配置了 compactModel 时) -->
        <div class="form-group" v-if="form.type === AgentMode.Single && form.compactModel">
          <label>{{ t('agents.compact_prompt') }}</label>
          <textarea v-model="form.compactPrompt" rows="3" :placeholder="t('agents.compact_prompt_placeholder')" />
        </div>

        <!-- ACP 专属字段 -->
        <template v-if="form.type === AgentMode.ACP">
          <div class="form-group">
            <label>{{ t('agents.acp_preset') }}</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button v-for="(p, i) in acpPresets" :key="i" class="btn-outline btn-sm" @click="applyPreset(i)">{{ p.label }}</button>
            </div>
          </div>
          <div class="form-group">
            <label>{{ t('agents.acp_command') }} *</label>
            <input v-model="form.command" :placeholder="t('agents.acp_command_placeholder')" />
          </div>
          <div class="form-group">
            <label>{{ t('agents.acp_args') }}</label>
            <input v-model="form.args" :placeholder="t('agents.acp_args_placeholder')" />
            <span style="font-size:0.78rem;color:var(--color-text-muted,#888);margin-top:2px">{{ t('agents.acp_args_hint') }}</span>
          </div>
          <div class="form-group">
            <label>{{ t('agents.acp_session_mode') }}</label>
            <select v-model="form.sessionMode">
              <option value="persistent">Persistent</option>
              <option value="transient">Transient</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('agents.acp_env') }}</label>
            <div v-for="(item, i) in form.env" :key="i" style="display:flex;gap:6px;margin-bottom:4px">
              <input v-model="item.key" placeholder="KEY" style="flex:1" />
              <input v-model="item.value" placeholder="VALUE" style="flex:2" />
              <button class="btn-danger btn-sm" @click="form.env.splice(i, 1)" style="flex-shrink:0">&times;</button>
            </div>
            <button class="btn-outline btn-sm" @click="form.env.push({ key: '', value: '' })">+ {{ t('agents.acp_env_add') }}</button>
          </div>
        </template>

        <!-- autoApproveAllTools (ACP 不需要) -->
        <div class="form-group" v-if="form.type !== AgentMode.ACP" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" v-model="form.autoApproveAllTools" id="autoApproveAll" style="width:14px;height:14px;cursor:pointer" />
          <label for="autoApproveAll" style="cursor:pointer;margin:0">{{ t('agents.auto_approve_all_tools') }}</label>
        </div>

        <!-- modelCallTimeout (ACP/Generative 不需要) -->
        <div class="form-group" v-if="form.type !== AgentMode.Generative && form.type !== AgentMode.ACP">
          <label>{{ t('agents.model_call_timeout') }}</label>
          <input type="number" v-model.number="form.modelCallTimeout" min="0" step="1" :placeholder="t('agents.model_call_timeout_placeholder')" />
        </div>

        <!-- ReAct fields -->
        <template v-if="form.type === AgentMode.ReAct">
          <div class="form-section">
            <div class="form-section-title">
              {{ t('agents.sub_agents') }}
              <button class="btn-outline btn-sm" @click="addSubAgent">{{ t('agents.add_sub') }}</button>
            </div>
            <div v-for="(ref, i) in tempSubAgents" :key="i" class="sub-agent-item">
              <div class="sub-agent-item-header">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span class="sub-agent-item-name">{{ (agents[ref.id] as any)?.name || ref.id }}</span>
                </div>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="editSubAgent(i)">{{ t('common.edit') }}</button>
                  <button class="btn-danger btn-sm" @click="deleteSubAgent(i)">{{ t('common.delete') }}</button>
                </div>
              </div>
              <div class="sub-agent-item-desc">{{ ref.desc }}</div>
            </div>
            <div v-if="tempSubAgents.length === 0" style="color:#94a3b8;font-size:12px;padding:4px">{{ t('agents.no_sub') }}</div>
          </div>
        </template>


      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="save">{{ t('common.save') }}</button>
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
          <label>{{ t('agents.sub_agent_label') }} *</label>
          <select v-model="subForm.id">
            <option value="">{{ t('common.select_placeholder') }}</option>
            <option v-for="a in subAgentSelectOptions()" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
          </select>
        </div>
        <div class="form-group">
          <label>{{ t('agents.sub_desc_label') }} *</label>
          <textarea v-model="subForm.desc" :placeholder="t('agents.sub_desc_placeholder')" rows="3" style="resize:vertical" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="showSubModal = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="saveSubAgent">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>
