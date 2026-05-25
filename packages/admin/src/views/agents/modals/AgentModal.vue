<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast } from 'sbot-ui'
import { AgentMode, ACPSessionMode, InsightScope, TodoScope } from '@/shared/types'
import type { Agent, SubAgentRef } from '@/shared/types'
import CreatePromptModal from '@/components/modals/CreatePromptModal.vue'
import { SModal, SButton, SInput, STextarea, SSelect, SFormItem, SFormSection, SHint, SCheckCard } from 'sbot-ui'

const { t } = useI18n()

const emit = defineEmits<{ saved: [] }>()

const acpPresets = [
  { label: 'Claude Code', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'], envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] },
  { label: 'OpenCode', command: 'opencode', args: ['acp'], envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'] },
  { label: 'Codex', command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@latest'], envKeys: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] },
  { label: 'Cline', command: 'npx', args: ['-y', 'cline@latest', '--acp'], envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'] },
  { label: 'Qwen Code', command: 'npx', args: ['-y', 'qwen-agent-acp@latest'], envKeys: ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL'] },
]

function applyPreset(idx: number) {
  if (idx < 0) return
  const p = acpPresets[idx]
  form.value.command = p.command
  form.value.args = [...p.args]
  const existing = new Set(form.value.env.map(e => e.key))
  for (const key of p.envKeys) {
    if (!existing.has(key)) {
      form.value.env.push({ key, value: '' })
    }
  }
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
  systemPrompt: '',
  insightScope: InsightScope.Disabled as string,
  insightExtractor: '',
  insightExtractorPromptFile: '',
  todoScope: TodoScope.Disabled as string,
  todoExtractor: '',
  todoExtractorPromptFile: '',
  autoApproveAllTools: false,
  modelCallTimeout: undefined as number | undefined,
  // acp
  command: '',
  args: [] as string[],
  env: [] as { key: string; value: string }[],
  sessionMode: ACPSessionMode.Persistent as ACPSessionMode,
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
      systemPrompt: a.systemPrompt || '',
      insightScope: (a as any).insight?.scope || InsightScope.Disabled,
      insightExtractor: (a as any).insight?.extractor || '',
      insightExtractorPromptFile: (a as any).insight?.extractorPromptFile || '',
      todoScope: (a as any).todo?.scope || TodoScope.Disabled,
      todoExtractor: (a as any).todo?.extractor || '',
      todoExtractorPromptFile: (a as any).todo?.extractorPromptFile || '',
      autoApproveAllTools: !!(a as any).autoApproveAllTools,
      modelCallTimeout: (a as any).modelCallTimeout ?? undefined,
      command: a.command || '',
      args: Array.isArray(a.args) ? [...a.args] : [],
      env: a.env ? Object.entries(a.env).map(([key, value]) => ({ key, value })) : [],
      sessionMode: (a as any).sessionMode || ACPSessionMode.Persistent,
    }
    tempSubAgents.value = Array.isArray(a.agents) ? [...a.agents] : []
  } else {
    editingId.value = null
    tempSubAgents.value = []
    form.value = {
      id: '', name: '', type: AgentMode.Single, model: '', compactModel: '',
      systemPrompt: '',
      insightScope: InsightScope.Disabled, insightExtractor: '', insightExtractorPromptFile: '',
      todoScope: TodoScope.Disabled, todoExtractor: '', todoExtractorPromptFile: '',
      autoApproveAllTools: false, modelCallTimeout: undefined, command: '', args: [], env: [], sessionMode: ACPSessionMode.Persistent,
    }
  }
  showModal.value = true
  loadInsightPrompts()
  loadTodoPrompts()
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
    const config: Agent = { type }

    if (type !== AgentMode.ACP) config.model = form.value.model
    if (type !== AgentMode.ACP && form.value.systemPrompt) config.systemPrompt = form.value.systemPrompt
    if (form.value.autoApproveAllTools) (config as any).autoApproveAllTools = true

    if (type === AgentMode.Single || type === AgentMode.ReAct) {
      if (form.value.compactModel) (config as any).compactModel = form.value.compactModel
      if (form.value.insightScope !== InsightScope.Disabled && !form.value.insightExtractor) {
        show(t('agents.error_insight_extractor'), 'error'); return
      }
      const insightCfg: any = { scope: form.value.insightScope }
      if (form.value.insightScope !== InsightScope.Disabled) {
        insightCfg.extractor = form.value.insightExtractor
        if (form.value.insightExtractorPromptFile) insightCfg.extractorPromptFile = form.value.insightExtractorPromptFile
      }
      config.insight = insightCfg

      if (form.value.todoScope !== TodoScope.Disabled && !form.value.todoExtractor) {
        show(t('agents.error_todo_extractor'), 'error'); return
      }
      const todoCfg: any = { scope: form.value.todoScope }
      if (form.value.todoScope !== TodoScope.Disabled) {
        todoCfg.extractor = form.value.todoExtractor
        if (form.value.todoExtractorPromptFile) todoCfg.extractorPromptFile = form.value.todoExtractorPromptFile
      }
      config.todo = todoCfg

      if (form.value.modelCallTimeout != null && form.value.modelCallTimeout > 0) config.modelCallTimeout = form.value.modelCallTimeout
    }
    if (type === AgentMode.ReAct) {
      config.agents = tempSubAgents.value
    }
    if (type === AgentMode.ACP) {
      config.command = form.value.command.trim()
      const filtered = form.value.args.map(s => s.trim()).filter(Boolean)
      if (filtered.length) config.args = filtered
      const envEntries = form.value.env.filter(e => e.key.trim())
      if (envEntries.length) config.env = Object.fromEntries(envEntries.map(e => [e.key.trim(), e.value]))
      if (form.value.sessionMode !== ACPSessionMode.Persistent) config.sessionMode = form.value.sessionMode
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

// ── Insight prompt files ──
const insightPrompts = ref<{ path: string; isUserOnly?: boolean }[]>([])
const showCreateInsightPrompt = ref(false)

async function loadInsightPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=insight/extractor')
    insightPrompts.value = res.data || []
  } catch {}
}

function openCreateInsightPrompt() {
  showCreateInsightPrompt.value = true
}

async function onInsightPromptCreated(filePath: string) {
  showCreateInsightPrompt.value = false
  await loadInsightPrompts()
  form.value.insightExtractorPromptFile = filePath
}

// ── Todo prompt files ──
const todoPrompts = ref<{ path: string; isUserOnly?: boolean }[]>([])
const showCreateTodoPrompt = ref(false)

async function loadTodoPrompts() {
  try {
    const res = await apiFetch('/api/prompts/files?prefix=todo/extractor')
    todoPrompts.value = res.data || []
  } catch {}
}

function openCreateTodoPrompt() {
  showCreateTodoPrompt.value = true
}

async function onTodoPromptCreated(filePath: string) {
  showCreateTodoPrompt.value = false
  await loadTodoPrompts()
  form.value.todoExtractorPromptFile = filePath
}

defineExpose({ open })
</script>

<template>
  <!-- Agent Modal -->
  <SModal v-model:visible="showModal" :title="editingId ? t('agents.edit_title') : t('agents.add_title')" width="lg">
    <SFormItem v-if="!editingId" label="ID *" :hint="t('agents.id_hint')">
      <SInput v-model="form.id" placeholder="ID" />
    </SFormItem>
    <SFormItem :label="t('agents.name') + ' *'">
      <SInput v-model="form.name" :placeholder="t('agents.name_placeholder')" />
    </SFormItem>
    <SFormItem :label="t('common.type') + ' *'">
      <SSelect v-model="form.type">
        <option :value="AgentMode.Single">{{ t('agents.type_single') }}</option>
        <option :value="AgentMode.ReAct">{{ t('agents.type_react') }}</option>
        <option :value="AgentMode.Generative">{{ t('agents.type_generative') }}</option>
        <option :value="AgentMode.ACP">{{ t('agents.type_acp') }}</option>
      </SSelect>
    </SFormItem>

    <!-- 系统提示词（ACP 模式无 systemPrompt，由外部 Agent 自行管理） -->
    <SFormItem v-if="form.type !== AgentMode.ACP" :label="t('agents.system_prompt')">
      <STextarea v-model="form.systemPrompt" :rows="3" :placeholder="t('agents.system_prompt_placeholder')" />
    </SFormItem>

    <!-- Model (ACP 模式不需要本地模型) -->
    <SFormItem v-if="form.type !== AgentMode.ACP" :label="t('agents.model_col') + ' *'">
      <SSelect v-model="form.model">
        <option value="">{{ t('common.select_placeholder') }}</option>
        <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
      </SSelect>
    </SFormItem>

    <!-- Compact Model (Generative/ACP 不支持) -->
    <SFormItem
      v-if="form.type !== AgentMode.Generative && form.type !== AgentMode.ACP"
      :label="t('agents.compact_model')"
      :hint="t('agents.compact_model_hint')"
    >
      <SSelect v-model="form.compactModel">
        <option value="">{{ t('agents.compact_model_placeholder') }}</option>
        <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
      </SSelect>
    </SFormItem>

    <!-- ACP 专属字段 -->
    <template v-if="form.type === AgentMode.ACP">
      <SFormItem :label="t('agents.acp_preset')">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <SButton v-for="(p, i) in acpPresets" :key="i" type="outline" size="sm" @click="applyPreset(i)">{{ p.label }}</SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('agents.acp_command') + ' *'">
        <SInput v-model="form.command" :placeholder="t('agents.acp_command_placeholder')" />
      </SFormItem>
      <SFormItem :label="t('agents.acp_args')">
        <div v-for="(_, i) in form.args" :key="i" style="display:flex;gap:6px;margin-bottom:4px">
          <SInput v-model="form.args[i]" :placeholder="t('agents.acp_args_placeholder')" style="flex:1" />
          <SButton type="danger" size="sm" @click="form.args.splice(i, 1)" style="flex-shrink:0">&times;</SButton>
        </div>
        <SButton type="outline" size="sm" @click="form.args.push('')">+ {{ t('agents.acp_args_add') }}</SButton>
      </SFormItem>
      <SFormItem :label="t('agents.acp_session_mode')" :hint="t('agents.acp_session_mode_hint')">
        <SSelect v-model="form.sessionMode">
          <option :value="ACPSessionMode.Persistent">{{ t('agents.acp_session_persistent') }}</option>
          <option :value="ACPSessionMode.Transient">{{ t('agents.acp_session_transient') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem :label="t('agents.acp_env')">
        <div v-for="(item, i) in form.env" :key="i" style="display:flex;gap:6px;margin-bottom:4px">
          <SInput v-model="item.key" placeholder="KEY" style="flex:1" />
          <SInput v-model="item.value" placeholder="VALUE" style="flex:2" />
          <SButton type="danger" size="sm" @click="form.env.splice(i, 1)" style="flex-shrink:0">&times;</SButton>
        </div>
        <SButton type="outline" size="sm" @click="form.env.push({ key: '', value: '' })">+ {{ t('agents.acp_env_add') }}</SButton>
      </SFormItem>
    </template>

    <!-- Insight -->
    <template v-if="form.type !== AgentMode.Generative && form.type !== AgentMode.ACP">
      <SFormItem :label="t('agents.insight_scope')" :hint="t('agents.insight_hint')">
        <SSelect v-model="form.insightScope">
          <option :value="InsightScope.Disabled">{{ t('agents.insight_disabled') }}</option>
          <option :value="InsightScope.Agent">{{ t('agents.insight_agent') }}</option>
          <option :value="InsightScope.Session">{{ t('agents.insight_session') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem
        v-if="form.insightScope !== InsightScope.Disabled"
        :label="t('agents.insight_extractor') + ' *'"
        :hint="t('agents.insight_extractor_hint')"
      >
        <SSelect v-model="form.insightExtractor">
          <option value="">{{ t('agents.insight_extractor_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem
        v-if="form.insightScope !== InsightScope.Disabled"
        :label="t('agents.insight_prompt_file')"
        :hint="t('agents.insight_prompt_file_hint')"
      >
        <div style="display:flex;gap:6px;align-items:center">
          <SSelect v-model="form.insightExtractorPromptFile" style="flex:1">
            <option value="">{{ t('agents.insight_prompt_file_default') }}</option>
            <option v-for="p in insightPrompts" :key="p.path" :value="p.path">{{ p.path.split('/').pop() }}</option>
          </SSelect>
          <SButton type="outline" size="sm" @click="openCreateInsightPrompt" title="+">+</SButton>
        </div>
      </SFormItem>

      <!-- Todo -->
      <SFormItem :label="t('agents.todo_scope')" :hint="t('agents.todo_hint')">
        <SSelect v-model="form.todoScope">
          <option :value="TodoScope.Disabled">{{ t('agents.todo_disabled') }}</option>
          <option :value="TodoScope.Session">{{ t('agents.todo_session') }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem
        v-if="form.todoScope !== TodoScope.Disabled"
        :label="t('agents.todo_extractor') + ' *'"
        :hint="t('agents.todo_extractor_hint')"
      >
        <SSelect v-model="form.todoExtractor">
          <option value="">{{ t('agents.todo_extractor_placeholder') }}</option>
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </SSelect>
      </SFormItem>
      <SFormItem
        v-if="form.todoScope !== TodoScope.Disabled"
        :label="t('agents.todo_prompt_file')"
        :hint="t('agents.todo_prompt_file_hint')"
      >
        <div style="display:flex;gap:6px;align-items:center">
          <SSelect v-model="form.todoExtractorPromptFile" style="flex:1">
            <option value="">{{ t('agents.todo_prompt_file_default') }}</option>
            <option v-for="p in todoPrompts" :key="p.path" :value="p.path">{{ p.path.split('/').pop() }}</option>
          </SSelect>
          <SButton type="outline" size="sm" @click="openCreateTodoPrompt" title="+">+</SButton>
        </div>
      </SFormItem>
    </template>

    <!-- autoApproveAllTools -->
    <SFormItem>
      <SCheckCard v-model="form.autoApproveAllTools">{{ t('agents.auto_approve_all_tools') }}</SCheckCard>
    </SFormItem>

    <!-- modelCallTimeout (ACP/Generative 不需要) -->
    <SFormItem
      v-if="form.type !== AgentMode.Generative && form.type !== AgentMode.ACP"
      :label="t('agents.model_call_timeout')"
    >
      <SInput v-model.number="form.modelCallTimeout" type="number" :placeholder="t('agents.model_call_timeout_placeholder')" />
    </SFormItem>

    <!-- ReAct fields -->
    <template v-if="form.type === AgentMode.ReAct">
      <SFormSection>
        <template #title>
          <span>{{ t('agents.sub_agents') }}</span>
          <SButton type="outline" size="sm" @click="addSubAgent">{{ t('agents.add_sub') }}</SButton>
        </template>
        <div v-for="(ref, i) in tempSubAgents" :key="i" class="sub-agent-item">
          <div class="sub-agent-item-header">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span class="sub-agent-item-name">{{ (agents[ref.id] as any)?.name || ref.id }}</span>
            </div>
            <div class="ops-cell">
              <SButton type="outline" size="sm" @click="editSubAgent(i)">{{ t('common.edit') }}</SButton>
              <SButton type="danger" size="sm" @click="deleteSubAgent(i)">{{ t('common.delete') }}</SButton>
            </div>
          </div>
          <div class="sub-agent-item-desc">{{ ref.desc }}</div>
        </div>
        <SHint v-if="tempSubAgents.length === 0">{{ t('agents.no_sub') }}</SHint>
      </SFormSection>
    </template>

    <template #footer>
      <SButton type="outline" @click="showModal = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" @click="save">{{ t('common.save') }}</SButton>
    </template>
  </SModal>

  <CreatePromptModal v-model:visible="showCreateInsightPrompt" prefix="insight/extractor/" default-ext=".txt" @created="onInsightPromptCreated" @close="showCreateInsightPrompt = false" />
  <CreatePromptModal v-model:visible="showCreateTodoPrompt" prefix="todo/extractor/" default-ext=".txt" @created="onTodoPromptCreated" @close="showCreateTodoPrompt = false" />

  <!-- Sub-agent Modal -->
  <SModal v-model:visible="showSubModal" :title="subModalTitle" width="sm" nested>
    <SFormItem :label="t('agents.sub_agent_label') + ' *'">
      <SSelect v-model="subForm.id">
        <option value="">{{ t('common.select_placeholder') }}</option>
        <option v-for="a in subAgentSelectOptions()" :key="a.id" :value="a.id">{{ a.label }} ({{ a.type }})</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('agents.sub_desc_label') + ' *'">
      <STextarea v-model="subForm.desc" :placeholder="t('agents.sub_desc_placeholder')" :rows="3" resize="vertical" />
    </SFormItem>

    <template #footer>
      <SButton type="outline" @click="showSubModal = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" @click="saveSubAgent">{{ t('common.save') }}</SButton>
    </template>
  </SModal>
</template>
