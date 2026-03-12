<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { McpEntry, McpBuiltin, McpTool } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

// If route has agentName param, we're in agent MCP mode
const agentName = computed(() => route.params.agentName as string | undefined)
const isAgentMode = computed(() => !!agentName.value)

const servers = ref<Record<string, McpEntry>>({})
const builtins = ref<McpBuiltin[]>([])

// Agent-mode globals: selected global/builtin MCP names + their resolved info
const agentGlobals = ref<string[]>([])
interface GlobalInfo extends McpEntry { isBuiltin: boolean }
const agentGlobalMap = ref<Record<string, GlobalInfo>>({})

// Agent mode: tab + global selection state
const activeTab     = ref<'globals' | 'servers'>('globals')
const selectedGlobals = ref<string[]>([])
const globalSearch  = ref('')
const globalsChanged = computed(() => {
  const a = [...selectedGlobals.value].sort().join(',')
  const b = [...agentGlobals.value].sort().join(',')
  return a !== b
})
const allGlobalMcps = computed(() => [
  ...store.mcpBuiltins.map(b => ({ name: b.name, isBuiltin: true, desc: b.description || '' })),
  ...Object.keys(store.mcpServers).map(k => ({ name: k, isBuiltin: false, desc: store.mcpServers[k].type || '' })),
])
const filteredGlobalMcps = computed(() => {
  const q = globalSearch.value.trim().toLowerCase()
  if (!q) return allGlobalMcps.value
  return allGlobalMcps.value.filter(m => m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q))
})

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
    } else {
      // Resolve selected globals against the global MCP registry
      const globalsFromApi: string[] = res.data?.globals || []
      agentGlobals.value = globalsFromApi
      selectedGlobals.value = [...globalsFromApi]
      try {
        const globalRes = await apiFetch('/api/mcp')
        const allBuiltins: McpBuiltin[] = globalRes.data?.builtins || []
        const allServers: Record<string, McpEntry> = globalRes.data?.servers || {}
        store.mcpBuiltins = allBuiltins
        store.mcpServers = allServers
        const map: Record<string, GlobalInfo> = {}
        for (const name of globalsFromApi) {
          if (allBuiltins.some(b => b.name === name)) {
            map[name] = { type: 'builtin', isBuiltin: true }
          } else if (allServers[name]) {
            map[name] = { ...allServers[name], isBuiltin: false }
          } else {
            map[name] = { type: 'unknown', isBuiltin: false }
          }
        }
        agentGlobalMap.value = map
      } catch {
        agentGlobalMap.value = {}
      }
    }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function saveGlobals() {
  try {
    const existing = (store.settings.agents || {})[agentName.value!] || {}
    const res = await apiFetch(
      `/api/settings/agents/${encodeURIComponent(agentName.value!)}`,
      'PUT',
      { ...existing, mcp: selectedGlobals.value }
    )
    Object.assign(store.settings, res.data)
    agentGlobals.value = [...selectedGlobals.value]
    show('保存成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function viewGlobalTools(name: string) {
  toolsTitle.value = name
  toolsList.value = []
  toolsLoading.value = true
  expandedTools.clear()
  showToolsModal.value = true
  try {
    const res = await apiFetch('/api/mcp/tools', 'POST', { name })
    toolsList.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
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

    const key = editingName.value ?? name
    const newServers = { ...servers.value, [key]: config }
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
const toolsLoading = ref(false)
const expandedTools = reactive(new Set<number>())

function toggleTool(i: number) {
  if (expandedTools.has(i)) expandedTools.delete(i)
  else expandedTools.add(i)
}

async function viewTools(name: string) {
  toolsTitle.value = name
  toolsList.value = []
  toolsLoading.value = true
  expandedTools.clear()
  showToolsModal.value = true
  try {
    const url = isAgentMode.value
      ? `/api/agents/${encodeURIComponent(agentName.value!)}/mcp/tools`
      : '/api/mcp/tools'
    const res = await apiFetch(url, 'POST', { name })
    toolsList.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
    showToolsModal.value = false
  } finally {
    toolsLoading.value = false
  }
}

// ── Schema rendering (ported from clientbackup) ──
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatParamType(s: any): string {
  if (!s) return 'any'
  if (Array.isArray(s.type)) {
    const nonNull = s.type.filter((t: string) => t !== 'null')
    const base = nonNull.length === 1 ? nonNull[0] : nonNull.join(' | ')
    return s.type.includes('null') ? base + '?' : base
  }
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.enum) return s.enum.map((v: any) => JSON.stringify(v)).join(' | ')
  if (s.type === 'array') {
    if (s.prefixItems) return '[' + s.prefixItems.map(formatParamType).join(', ') + ']'
    if (s.items) return formatParamType(s.items) + '[]'
    return 'any[]'
  }
  if (s.type === 'object') {
    if (s.additionalProperties && typeof s.additionalProperties === 'object')
      return 'Record<string, ' + formatParamType(s.additionalProperties) + '>'
    return 'object'
  }
  if (s.anyOf || s.oneOf) {
    const variants = (s.anyOf || s.oneOf)
    const nonNull = variants.filter((v: any) => v.type !== 'null')
    const base = (nonNull.length ? nonNull : variants).map(formatParamType).join(' | ')
    return variants.some((v: any) => v.type === 'null') ? base + '?' : base
  }
  if (s.allOf) return s.allOf.map(formatParamType).join(' & ')
  if (s.$ref) { const p = s.$ref.split('/'); return p[p.length - 1] }
  if (s.type) return s.type
  return 'any'
}

function renderSchemaChildren(s: any): string {
  if (!s) return ''
  const nest = (inner: string) => `<div style="margin-left:14px;margin-top:4px;border-left:2px solid #f1f5f9;padding-left:10px">${inner}</div>`
  if ((s.type === 'object' || !s.type) && s.properties) {
    const req = new Set(s.required || [])
    return nest(Object.entries(s.properties).map(([k, v]) => renderParamRow(k, v, req.has(k) && (v as any).default === undefined)).join(''))
  }
  if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object') {
    return `<div class="param-desc">值类型: ${esc(formatParamType(s.additionalProperties))}</div>` + renderSchemaChildren(s.additionalProperties)
  }
  if (s.type === 'array') {
    if (s.prefixItems) return nest(s.prefixItems.map((item: any, i: number) => renderParamRow(`[${i}]`, item, false)).join(''))
    if (s.items) return `<div class="param-desc">元素类型: ${esc(formatParamType(s.items))}</div>` +
      (s.items.properties || s.items.anyOf || s.items.allOf ? nest(renderSchemaChildren(s.items)) : '')
  }
  if (s.anyOf || s.oneOf) {
    const variants = (s.anyOf || s.oneOf).filter((v: any) => v.type !== 'null')
    return variants.map((v: any, i: number) => {
      const label = variants.length > 1 ? `<div class="param-desc" style="font-weight:600;margin-top:4px">联合类型 ${i + 1}: ${esc(formatParamType(v))}</div>` : ''
      return label + renderSchemaChildren(v)
    }).join('')
  }
  if (s.allOf) return s.allOf.map(renderSchemaChildren).join('')
  return ''
}

function renderParamRow(name: string, prop: any, isRequired: boolean): string {
  let html = '<div class="tool-param">'
  html += `<div><span class="param-name">${esc(name)}</span>`
  html += `<span class="param-type">${esc(formatParamType(prop))}</span>`
  if (isRequired) html += '<span class="param-required">*必填</span>'
  html += '</div>'
  if (prop.description) html += `<div class="param-desc">${esc(prop.description)}</div>`
  if (prop.const !== undefined) html += `<div class="param-enum">固定值: ${esc(JSON.stringify(prop.const))}</div>`
  if (prop.enum) html += `<div class="param-enum">可选值: ${prop.enum.map((v: any) => esc(JSON.stringify(v))).join(' | ')}</div>`
  if (prop.default !== undefined) html += `<div class="param-default">默认值: ${esc(JSON.stringify(prop.default))}</div>`
  html += renderSchemaChildren(prop)
  html += '</div>'
  return html
}

function renderToolParams(schema: any): string {
  if (!schema) return '<div class="tool-no-params">无参数</div>'
  if (schema.allOf) return schema.allOf.map(renderToolParams).join('') || '<div class="tool-no-params">无参数</div>'
  if (schema.anyOf || schema.oneOf) {
    const variants = (schema.anyOf || schema.oneOf).filter((v: any) => v.type !== 'null')
    if (variants.length === 1) return renderToolParams(variants[0])
    return variants.map((v: any, i: number) =>
      `<div class="param-desc" style="font-weight:600">联合类型 ${i + 1}:</div>` + renderToolParams(v)
    ).join('')
  }
  if (schema.type === 'array') {
    if (schema.prefixItems) return schema.prefixItems.map((item: any, i: number) => renderParamRow(`[${i}]`, item, false)).join('')
    if (schema.items) return renderParamRow('items', schema.items, false)
    return '<div class="tool-no-params">any[]</div>'
  }
  if (schema.properties && Object.keys(schema.properties).length > 0) {
    const required = new Set(schema.required || [])
    return Object.entries(schema.properties).map(([n, p]) =>
      renderParamRow(n, p, required.has(n) && (p as any).default === undefined)
    ).join('')
  }
  if (schema.type === 'object' && schema.additionalProperties) {
    return `<div class="tool-param"><span class="param-type">${esc(formatParamType(schema))}</span></div>`
  }
  return '<div class="tool-no-params">无参数</div>'
}

function serverAddr(s: McpEntry) {
  if (s.type === 'http') return s.url || '-'
  if (s.type === 'stdio') return [s.command, ...(s.args || [])].join(' ')
  return '-'
}

onMounted(load)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <!-- Toolbar -->
    <div class="page-toolbar">
      <template v-if="isAgentMode">
        <button class="btn-outline btn-sm" @click="router.push('/agents')">← 返回</button>
        <span class="page-toolbar-title" style="margin-left:12px">Agent: {{ agentName }} — MCP 配置</span>
        <button class="btn-outline btn-sm" style="margin-left:8px" @click="load">刷新</button>
      </template>
      <template v-else>
        <button class="btn-outline btn-sm" @click="load">刷新</button>
        <button class="btn-primary btn-sm" style="margin-left:auto" @click="openAdd">+ 添加 MCP</button>
      </template>
    </div>

    <!-- Agent mode: tab bar -->
    <div v-if="isAgentMode" style="display:flex;border-bottom:1px solid #e8e6e3;background:#fff;padding:0 20px;flex-shrink:0">
      <button
        v-for="tab in [
          { key: 'globals', label: `全局工具`, count: selectedGlobals.length },
          { key: 'servers', label: `专属服务`, count: Object.keys(servers).length },
        ]"
        :key="tab.key"
        @click="activeTab = tab.key as any"
        style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s"
        :style="activeTab === tab.key ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ tab.label }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="activeTab === tab.key ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ tab.count }}</span>
      </button>
    </div>

    <div class="page-content">
      <!-- ── Agent mode: Global MCP tab ── -->
      <template v-if="isAgentMode && activeTab === 'globals'">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <input
            v-model="globalSearch"
            placeholder="搜索 MCP 名称或类型..."
            style="flex:1;padding:6px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;outline:none"
          />
          <button
            class="btn-primary btn-sm"
            :disabled="!globalsChanged"
            @click="saveGlobals"
          >保存</button>
          <span v-if="globalsChanged" style="font-size:12px;color:#f59e0b;white-space:nowrap">● 有未保存的更改</span>
        </div>
        <div v-if="allGlobalMcps.length === 0" style="text-align:center;color:#94a3b8;padding:40px">暂无全局 MCP 服务器</div>
        <div v-else style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden">
          <div v-if="filteredGlobalMcps.length === 0" style="padding:20px;text-align:center;color:#9b9b9b;font-size:13px">无匹配结果</div>
          <label
            v-for="m in filteredGlobalMcps"
            :key="m.name"
            style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:13px"
            :style="selectedGlobals.includes(m.name) ? 'background:#fafaf9' : ''"
          >
            <input type="checkbox" :value="m.name" v-model="selectedGlobals" style="cursor:pointer;flex-shrink:0;width:14px;height:14px" />
            <span style="font-family:monospace;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.name }}</span>
            <span v-if="m.isBuiltin" style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">内置</span>
            <span v-else style="flex-shrink:0;background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">{{ m.desc || '自定义' }}</span>
            <button
              class="btn-outline btn-sm"
              style="flex-shrink:0;padding:2px 8px;font-size:11px"
              @click.prevent="viewGlobalTools(m.name)"
            >查看工具</button>
          </label>
        </div>
      </template>

      <!-- ── Agent mode: Dedicated servers tab ── -->
      <template v-else-if="isAgentMode && activeTab === 'servers'">
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <button class="btn-primary btn-sm" @click="openAdd">+ 添加 MCP</button>
        </div>
        <div v-if="Object.keys(servers).length === 0" style="text-align:center;color:#94a3b8;padding:40px">暂无专属 MCP 服务</div>
        <table v-else>
          <thead>
            <tr><th>名称</th><th>描述</th><th>类型</th><th>地址/命令</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, name) in servers" :key="name">
              <td style="font-family:monospace">{{ name }}</td>
              <td style="color:#64748b;font-size:12px">{{ (s as any).description || '—' }}</td>
              <td>{{ s.type }}</td>
              <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ serverAddr(s) }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="viewTools(name as string)">查看工具</button>
                  <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                  <button class="btn-danger btn-sm" @click="remove(name as string)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ── Global mode: original table ── -->
      <template v-else-if="!isAgentMode">
        <table>
          <thead>
            <tr><th>名称</th><th>描述</th><th>类型</th><th>地址/命令</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in builtins" :key="'builtin:' + b.name">
              <td style="font-family:monospace">
                {{ b.name }}
                <span style="margin-left:6px;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
              </td>
              <td style="color:#64748b;font-size:12px">{{ b.description || '—' }}</td>
              <td>builtin</td>
              <td style="color:#94a3b8">—</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="viewTools(b.name)">查看工具</button>
                </div>
              </td>
            </tr>
            <tr v-if="builtins.length === 0 && Object.keys(servers).length === 0">
              <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">暂无 MCP 配置</td>
            </tr>
            <tr v-for="(s, name) in servers" :key="name">
              <td style="font-family:monospace">{{ name }}</td>
              <td style="color:#64748b;font-size:12px">{{ (s as any).description || '—' }}</td>
              <td>{{ s.type }}</td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ serverAddr(s) }}</td>
              <td>
                <div class="ops-cell">
                  <button class="btn-outline btn-sm" @click="viewTools(name as string)">查看工具</button>
                  <button class="btn-outline btn-sm" @click="openEdit(name as string)">编辑</button>
                  <button class="btn-danger btn-sm" @click="remove(name as string)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
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
            <input v-model="form.name" placeholder="如 my-mcp-server" :disabled="!!editingName" />
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
          <h3>{{ toolsTitle }}<span v-if="!toolsLoading" class="tools-count">({{ toolsList.length }} 个工具)</span></h3>
          <button class="modal-close" @click="showToolsModal = false">&times;</button>
        </div>
        <div class="modal-body" style="padding:0">
          <div v-if="toolsLoading" class="tools-loading">连接中，正在获取工具列表…</div>
          <div v-else-if="toolsList.length === 0" class="tools-loading">该 MCP 服务没有可用的工具</div>
          <ul v-else class="tools-list">
            <li v-for="(tool, i) in toolsList" :key="tool.name">
              <div class="tool-header">
                <div class="tool-name" :class="{ expanded: expandedTools.has(i) }" @click="toggleTool(i)">{{ tool.name }}</div>
              </div>
              <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
              <div class="tool-params" :class="{ show: expandedTools.has(i) }" v-html="renderToolParams((tool as any).parameters)"></div>
            </li>
          </ul>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showToolsModal = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
