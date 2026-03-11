<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'

const { show } = useToast()
const router = useRouter()

const agents = computed(() => store.settings.agents || {})
const modelName = (id: string) => (store.settings.models?.[id] as any)?.name || id

// ── Row dropdown ──
const dropdownOpen = ref<string | null>(null)
function toggleDropdown(name: string) {
  dropdownOpen.value = dropdownOpen.value === name ? null : name
}
function closeDropdown() {
  dropdownOpen.value = null
}

// ── Modal refs ──
const agentModal = ref<InstanceType<typeof AgentModal>>()

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
    store.skillBuiltins = skillRes.data?.builtins || []
    store.globalSkills = skillRes.data?.skills || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden" @click="closeDropdown">
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
            <td><span style="font-weight:500">{{ (a as any).name || id }}</span></td>
            <td>{{ a.type }}</td>
            <td>{{ a.model ? modelName(a.model) : '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="agentModal?.open(id as string)">编辑</button>
                <div class="row-dropdown">
                  <button class="btn-outline btn-sm" @click.stop="toggleDropdown(id as string)">···</button>
                  <div v-if="dropdownOpen === id" class="row-dropdown-menu">
                    <button :disabled="a.type !== 'single'" @click="router.push(`/mcp/agent/${id}`); closeDropdown()">MCP</button>
                    <button :disabled="a.type !== 'single'" @click="router.push(`/agents/${id}/skills`); closeDropdown()">Skills</button>
                    <button @click="copyAgent(id as string); closeDropdown()">复制</button>
                  </div>
                </div>
                <button class="btn-danger btn-sm" @click="removeAgent(id as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AgentModal ref="agentModal" />
  </div>
</template>
