<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import AgentMcpModal from './AgentMcpModal.vue'
import AgentSkillsModal from './AgentSkillsModal.vue'

const { show } = useToast()
const router = useRouter()

const agents = computed(() => store.settings.agents || {})
const modelName = (id: string) => (store.settings.models?.[id] as any)?.name || id

// ── Modal refs ──
const agentModal      = ref<InstanceType<typeof AgentModal>>()
const agentMcpModal   = ref<InstanceType<typeof AgentMcpModal>>()
const agentSkillsModal = ref<InstanceType<typeof AgentSkillsModal>>()

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
    const allSkills = skillRes.data || []
    store.allSkills = allSkills
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
          <tr><th>名称</th><th>类型</th><th>模型</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(agents).length === 0">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">暂无 Agent</td>
          </tr>
          <tr v-for="(a, id) in agents" :key="id">
            <td>
              <span
                style="font-weight:500;color:#1c1c1c;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color .15s,color .15s"
                @mouseenter="($event.target as HTMLElement).style.textDecorationColor='#6b6b6b'"
                @mouseleave="($event.target as HTMLElement).style.textDecorationColor='transparent'"
                @click="router.push(`/agents/${id}`)"
              >{{ (a as any).name || id }}</span>
            </td>
            <td>{{ a.type }}</td>
            <td>{{ a.model ? modelName(a.model) : '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="agentModal?.open(id as string)">编辑</button>
                <button class="btn-outline btn-sm" @click="agentMcpModal?.open(id as string)">MCP</button>
                <button class="btn-outline btn-sm" @click="agentSkillsModal?.open(id as string)">Skills</button>
                <button class="btn-outline btn-sm" @click="copyAgent(id as string)">复制</button>
                <button class="btn-danger btn-sm" @click="removeAgent(id as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AgentModal ref="agentModal" />
    <AgentMcpModal ref="agentMcpModal" />
    <AgentSkillsModal ref="agentSkillsModal" />
  </div>
</template>
