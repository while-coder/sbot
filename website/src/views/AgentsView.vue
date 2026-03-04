<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import AgentModal from './AgentModal.vue'
import SaverViewModal from './SaverViewModal.vue'
import MemoryViewModal from './MemoryViewModal.vue'

const { show } = useToast()
const router = useRouter()

const agents = computed(() => store.settings.agents || {})

// ── Row dropdown ──
const dropdownOpen = ref<string | null>(null)
function toggleDropdown(name: string) {
  dropdownOpen.value = dropdownOpen.value === name ? null : name
}
function closeDropdown() {
  dropdownOpen.value = null
}

// ── Modal refs ──
const agentModal      = ref<InstanceType<typeof AgentModal>>()
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()

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
          <tr><th>名称</th><th>类型</th><th>模型</th><th>存储</th><th>记忆</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(agents).length === 0">
            <td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">暂无 Agent</td>
          </tr>
          <tr v-for="(a, name) in agents" :key="name">
            <td>
              <span style="font-family:monospace;font-weight:500">{{ name }}</span>
              <span v-if="store.settings.agent === name" style="margin-left:6px;background:#6366f1;color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">活跃</span>
            </td>
            <td>{{ a.type }}</td>
            <td>{{ a.model || '-' }}</td>
            <td>
              <button v-if="a.saver" class="table-link-btn" @click.stop="saverViewModal?.open(a.saver!)">{{ a.saver }}</button>
              <span v-else style="color:#c0bdb8">-</span>
            </td>
            <td>
              <button v-if="a.memory" class="table-link-btn" @click.stop="memoryViewModal?.open(a.memory!)">{{ a.memory }}</button>
              <span v-else style="color:#c0bdb8">-</span>
            </td>
            <td>
              <div class="ops-cell">
                <button
                  class="btn-outline btn-sm"
                  :disabled="store.settings.agent === name"
                  @click="activateAgent(name as string)"
                >激活</button>
                <button class="btn-outline btn-sm" @click="agentModal?.open(name as string)">编辑</button>
                <div class="row-dropdown">
                  <button class="btn-outline btn-sm" @click.stop="toggleDropdown(name as string)">···</button>
                  <div v-if="dropdownOpen === name" class="row-dropdown-menu">
                    <button :disabled="a.type !== 'single'" @click="router.push(`/mcp/agent/${name}`); closeDropdown()">MCP</button>
                    <button :disabled="a.type !== 'single'" @click="router.push(`/agents/${name}/skills`); closeDropdown()">Skills</button>
                    <button @click="copyAgent(name as string); closeDropdown()">复制</button>
                  </div>
                </div>
                <button class="btn-danger btn-sm" @click="removeAgent(name as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AgentModal ref="agentModal" />
    <SaverViewModal ref="saverViewModal" />
    <MemoryViewModal ref="memoryViewModal" />
  </div>
</template>
