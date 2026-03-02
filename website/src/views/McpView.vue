<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { McpEntry, McpTool } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

// If route has agentName param, we're in agent MCP mode
const agentName = computed(() => route.params.agentName as string | undefined)
const isAgentMode = computed(() => !!agentName.value)

const servers = ref<Record<string, McpEntry>>({})
const builtins = ref<string[]>([])

function apiBase() {
  return isAgentMode.value
    ? `/api/agents/${encodeURIComponent(agentName.value!)}/mcp`
    : '/api/mcp'
}

async function load() {
  try {
    const res = await apiFetch(apiBase())
    servers.value = res.data?.servers || {}
    if (!isAgentMode.value) {
      builtins.value = res.data?.builtins || []
      store.mcpServers = servers.value
      store.mcpBuiltins = builtins.value
    }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// Modal
const showModal = ref(false)
const editingName = ref<string | null>(null)
const form = ref({
  name: '',
  type: 'http',
  url: '',
  headers: {} as Record<string, string>,
  command: '',
  args: [] as string[],
  env: {} as Record<string, string>,
  cwd: '',
  toolTimeout: '',
})

// KV editors
const headerRows = ref<{ key: string; value: string }[]>([])
const argsList = ref<string[]>([])
const envRows = ref<{ key: string; value: string }[]>([])

function syncFromForm() {
  headerRows.value = Object.entries(form.value.headers).map(([key, value]) => ({ key, value }))
  argsList.value = [...form.value.args]
  envRows.value = Object.entries(form.value.env).map(([key, value]) => ({ key, value }))
}

function syncToForm() {
  form.value.headers = Object.fromEntries(headerRows.value.filter(r => r.key).map(r => [r.key, r.value]))
  form.value.args = argsList.value.filter(a => a)
  form.value.env = Object.fromEntries(envRows.value.filter(r => r.key).map(r => [r.key, r.value]))
}

function openAdd() {
  editingName.value = null
  form.value = { name: '', type: 'http', url: '', headers: {}, command: '', args: [], env: {}, cwd: '', toolTimeout: '' }
  syncFromForm()
  showModal.value = true
}

function openEdit(name: string) {
  const s = servers.value[name]
  editingName.value = name
  form.value = {
    name,
    type: s.type || 'http',
    url: s.url || '',
    headers: { ...(s.headers || {}) },
    command: s.command || '',
    args: [...(s.args || [])],
    env: { ...(s.env || {}) },
    cwd: s.cwd || '',
    toolTimeout: s.toolTimeout ? String(s.toolTimeout) : '',
  }
  syncFromForm()
  showModal.value = true
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  syncToForm()
  try {
    const { name, type, url, headers, command, args, env, cwd, toolTimeout } = form.value
    const config: McpEntry = { type }
    if (type === 'http') {
      if (!url.trim()) { show('URL 不能为空', 'error'); return }
      config.url = url.trim()
      if (Object.keys(headers).length > 0) config.headers = headers
    } else {
      if (!command.trim()) { show('Command 不能为空', 'error'); return }
      config.command = command.trim()
      if (args.length > 0) config.args = args
      if (Object.keys(env).length > 0) config.env = env
      if (cwd.trim()) config.cwd = cwd.trim()
    }
    if (toolTimeout) config.toolTimeout = parseInt(toolTimeout)

    const newServers = { ...servers.value }
    if (editingName.value && editingName.value !== name) {
      delete newServers[editingName.value]
    }
    newServers[name] = config

    await apiFetch(apiBase(), 'PUT', { servers: newServers })
    show('保存成功')
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function remove(name: string) {
  if (!confirm(`确定要删除 MCP "${name}" 吗？`)) return
  try {
    const newServers = { ...servers.value }
    delete newServers[name]
    await apiFetch(apiBase(), 'PUT', { servers: newServers })
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// Tools viewer
const showToolsModal = ref(false)
const toolsTitle = ref('')
const toolsList = ref<McpTool[]>([])

async function viewTools(name: string) {
  try {
    const res = await apiFetch(`/api/mcp/tools?server=${encodeURIComponent(name)}`)
    toolsTitle.value = `MCP Tools: ${name}`
    toolsList.value = res.data || []
    showToolsModal.value = true
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function serverAddr(s: McpEntry) {
  if (s.type === 'http') return s.url || '-'
  if (s.type === 'stdio') return [s.command, ...(s.args || [])].join(' ')
  return '-'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-toolbar">
      <template v-if="isAgentMode">
        <button class="btn-outline btn-sm" @click="router.push('/agents')">← 返回</button>
        <span class="page-toolbar-title" style="margin-left:12px">Agent: {{ agentName }} — MCP 配置</span>
        <button class="btn-outline btn-sm" style="margin-left:8px" @click="load">刷新</button>
      </template>
      <template v-else>
        <button class="btn-outline btn-sm" @click="load">刷新</button>
      </template>
      <button class="btn-primary btn-sm" style="margin-left:auto" @click="openAdd">+ 添加 MCP</button>
    </div>
    <div class="page-content">
      <!-- Builtins -->
      <template v-if="!isAgentMode && builtins.length > 0">
        <div style="margin-bottom:12px;font-size:12px;color:#64748b">
          内置 MCP 服务器：{{ builtins.join(', ') }}
        </div>
      </template>
      <table>
        <thead>
          <tr><th>名称</th><th>类型</th><th>地址/命令</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="Object.keys(servers).length === 0">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">暂无 MCP 配置</td>
          </tr>
          <tr v-for="(s, name) in servers" :key="name">
            <td style="font-family:monospace">{{ name }}</td>
            <td>{{ s.type }}</td>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ serverAddr(s) }}</td>
            <td>
              <div class="ops-cell">
                <button v-if="!isAgentMode" class="btn-outline btn-sm" @click="viewTools(name as string)">查看工具</button>
                <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                <button class="btn-danger btn-sm" @click="remove(name as string)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- MCP Edit Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ editingName ? '编辑 MCP 服务' : '添加 MCP 服务' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 (唯一标识) *</label>
            <input v-model="form.name" :disabled="!!editingName" placeholder="如 my-mcp-server" />
          </div>
          <div class="form-group">
            <label>传输类型 *</label>
            <select v-model="form.type">
              <option value="http">HTTP / SSE</option>
              <option value="stdio">Stdio (本地进程)</option>
            </select>
          </div>

          <!-- HTTP fields -->
          <template v-if="form.type === 'http'">
            <div class="form-group">
              <label>URL *</label>
              <input v-model="form.url" placeholder="http://example.com/mcp" />
            </div>
            <div class="form-section">
              <div class="form-section-title">Headers</div>
              <div v-for="(row, i) in headerRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="row.key" placeholder="Key" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <input v-model="row.value" placeholder="Value" style="flex:2;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="headerRows.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="headerRows.push({key:'',value:''})">+ Header</button>
            </div>
          </template>

          <!-- Stdio fields -->
          <template v-else>
            <div class="form-group">
              <label>Command *</label>
              <input v-model="form.command" placeholder="npx" />
            </div>
            <div class="form-section">
              <div class="form-section-title">Args</div>
              <div v-for="(_arg, i) in argsList" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="argsList[i]" placeholder="参数" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="argsList.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="argsList.push('')">+ Arg</button>
            </div>
            <div class="form-section">
              <div class="form-section-title">Env</div>
              <div v-for="(row, i) in envRows" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
                <input v-model="row.key" placeholder="Key" style="flex:1;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <input v-model="row.value" placeholder="Value" style="flex:2;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px" />
                <button class="btn-danger btn-sm" @click="envRows.splice(i,1)">×</button>
              </div>
              <button class="btn-outline btn-sm" @click="envRows.push({key:'',value:''})">+ Env</button>
            </div>
            <div class="form-group">
              <label>Cwd</label>
              <input v-model="form.cwd" placeholder="工作目录（可选）" />
            </div>
          </template>

          <div class="form-section">
            <div class="form-section-title">高级设置</div>
            <div class="form-group">
              <label>Tool 超时 (ms)</label>
              <input v-model="form.toolTimeout" type="number" placeholder="如 60000" />
              <div class="hint">可选，默认不限</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <!-- Tools Viewer Modal -->
    <div v-if="showToolsModal" class="modal-overlay" @click.self="showToolsModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>{{ toolsTitle }}</h3>
          <button class="modal-close" @click="showToolsModal = false">&times;</button>
        </div>
        <div class="modal-body" style="padding:0">
          <div v-if="toolsList.length === 0" style="padding:40px;text-align:center;color:#94a3b8">暂无工具</div>
          <div v-for="tool in toolsList" :key="tool.name" style="border-bottom:1px solid #e2e8f0;padding:12px 16px">
            <div style="font-family:monospace;font-weight:600;color:#6366f1;font-size:13px">{{ tool.name }}</div>
            <div v-if="tool.description" style="font-size:12px;color:#475569;margin-top:4px">{{ tool.description }}</div>
            <div v-if="tool.inputSchema?.properties" style="margin-top:8px">
              <div style="font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase">参数</div>
              <div v-for="(prop, pName) in tool.inputSchema.properties" :key="pName" style="font-size:12px;padding:3px 0;display:flex;gap:8px">
                <span style="font-family:monospace;color:#374151;font-weight:500">{{ pName }}</span>
                <span v-if="(tool.inputSchema?.required || []).includes(pName)" style="color:#ef4444;font-size:10px;font-weight:600">必填</span>
                <span style="color:#64748b">{{ (prop as any).description || (prop as any).type || '' }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showToolsModal = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
