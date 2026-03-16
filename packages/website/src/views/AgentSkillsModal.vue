<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'

const { show } = useToast()

const visible    = ref(false)
const agentName  = ref('')
const agentDisplayName = computed(() => (store.settings.agents?.[agentName.value] as any)?.name || agentName.value)

const skills     = ref<SkillItem[]>([])
const activeTab  = ref<'globals' | 'skills'>('globals')

// ── Global skills ─────────────────────────────────────────────────
const agentSkillNames  = ref<string[]>([])
const selectedSkills   = ref<string[]>([])
const skillSearch      = ref('')

const skillsChanged = computed(() => {
  const a = [...selectedSkills.value].sort().join(',')
  const b = [...agentSkillNames.value].sort().join(',')
  return a !== b
})
const allGlobalSkills = computed(() => [
  ...store.skillBuiltins.map(s => ({ name: s.name, description: s.description, isBuiltin: true })),
  ...store.globalSkills.map(s => ({ name: s.name, description: s.description, isBuiltin: false })),
])
const filteredGlobalSkills = computed(() => {
  const q = skillSearch.value.trim().toLowerCase()
  if (!q) return allGlobalSkills.value
  return allGlobalSkills.value.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
})

function apiBase() {
  return `/api/agents/${encodeURIComponent(agentName.value)}/skills`
}

async function load() {
  try {
    const [agentRes, skillsRes] = await Promise.all([
      apiFetch(apiBase()),
      apiFetch('/api/skills'),
    ])
    skills.value = agentRes.data?.skills || []
    const selectedFromApi: string[] = (agentRes.data?.globals || []).map((g: any) => g.name)
    agentSkillNames.value  = selectedFromApi
    selectedSkills.value   = [...selectedFromApi]
    store.skillBuiltins    = skillsRes.data?.builtins || []
    store.globalSkills     = skillsRes.data?.skills   || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function saveGlobalSkills() {
  try {
    const existing = (store.settings.agents || {})[agentName.value] || {}
    const res = await apiFetch(
      `/api/settings/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, skills: selectedSkills.value },
    )
    Object.assign(store.settings, res.data)
    agentSkillNames.value = [...selectedSkills.value]
    show('保存成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── View modal ────────────────────────────────────────────────────
const showViewModal  = ref(false)
const viewName       = ref('')
const viewBadge      = ref('')
const viewContent    = ref('')
const viewLoading    = ref(false)

const viewParsed = computed(() => {
  const content = viewContent.value
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { description: '', body: content }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) meta[m[1]] = m[2]
  }
  return { description: meta.description || '', body: match[2].trim() }
})

async function openView(name: string, badge = '') {
  viewName.value    = name
  viewBadge.value   = badge
  viewContent.value = ''
  viewLoading.value = true
  showViewModal.value = true
  const isGlobal = badge === '内置' || badge === '全局'
  const url = isGlobal
    ? `/api/skills/${encodeURIComponent(name)}`
    : `${apiBase()}/${encodeURIComponent(name)}`
  try {
    const res = await apiFetch(url)
    viewContent.value = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    showViewModal.value = false
  } finally {
    viewLoading.value = false
  }
}

async function remove(name: string) {
  if (!confirm(`确定要删除 Skill "${name}" 吗？`)) return
  try {
    await apiFetch(`${apiBase()}/${encodeURIComponent(name)}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Skill Hub ────────────────────────────────────────────────────
interface HubSkillResult {
  id: string; name: string; description: string; version: string
  sourceUrl: string; provider: 'clawhub' | 'skillssh' | 'skillsmp'
}
const showHub        = ref(false)
const hubTab         = ref<'url' | 'search'>('search')
const hubQuery       = ref('')
const hubResults     = ref<HubSkillResult[]>([])
const hubSearching   = ref(false)
const hubSearched    = ref(false)
const hubUrlInput    = ref('')
const hubUrlInstalling = ref(false)
const hubUrlOverwrite  = ref(false)

async function installByUrl() {
  const url = hubUrlInput.value.trim()
  if (!url) return
  hubUrlInstalling.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName.value)}/skill-hub/install-url`, 'POST', { url, overwrite: hubUrlOverwrite.value })
    show(`已安装：${res.data?.name ?? url}`)
    hubUrlInput.value = ''
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubUrlInstalling.value = false
  }
}

function openAdd() {
  hubTab.value = 'search'; hubQuery.value = ''; hubResults.value = []; hubSearched.value = false
  hubUrlInput.value = ''; hubUrlOverwrite.value = false; showHub.value = true
}

async function hubSearch() {
  if (!hubQuery.value.trim()) return
  hubSearching.value = true; hubSearched.value = false; hubResults.value = []
  try {
    const res = await apiFetch(`/api/skill-hub/search?q=${encodeURIComponent(hubQuery.value.trim())}&limit=30`)
    hubResults.value = Array.isArray(res) ? res : (res.data ?? [])
    hubSearched.value = true
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubSearching.value = false
  }
}
function hubKeydown(e: KeyboardEvent) { if (e.key === 'Enter') hubSearch() }

const showInstall = ref(false)
const installing  = ref(false)
const selected    = ref<HubSkillResult | null>(null)
const overwrite   = ref(false)

function openInstall(skill: HubSkillResult) { selected.value = skill; overwrite.value = false; showInstall.value = true }

async function confirmInstall() {
  if (!selected.value) return
  installing.value = true
  try {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(agentName.value)}/skill-hub/install`, 'POST', { skill: selected.value, overwrite: overwrite.value })
    show(`已安装：${res.data?.name ?? selected.value.name}`)
    showInstall.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    installing.value = false
  }
}

// ── Public API ───────────────────────────────────────────────────
function open(name: string) {
  agentName.value     = name
  skills.value        = []
  agentSkillNames.value = []
  selectedSkills.value  = []
  activeTab.value     = 'globals'
  skillSearch.value   = ''
  visible.value       = true
  load()
}

defineExpose({ open })
</script>

<template>
  <template v-if="visible">
    <!-- ── Main modal ──────────────────────────────────────────── -->
    <div class="modal-overlay" @click.self="visible = false">
      <div class="modal-box" style="width:90vw;max-width:1100px;height:82vh;display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="modal-header" style="padding:14px 20px;flex-shrink:0">
          <h3>{{ agentDisplayName }} — Skills 配置</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn-outline btn-sm" @click="load">刷新</button>
            <button class="modal-close" @click="visible = false">&times;</button>
          </div>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#fff;padding:0 20px;flex-shrink:0">
          <button
            v-for="tab in [
              { key: 'globals', label: '全局技能', count: selectedSkills.length },
              { key: 'skills',  label: '专属技能', count: skills.length },
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

        <!-- Content -->
        <div style="flex:1;overflow:auto;padding:16px 20px">
          <!-- Global skills tab -->
          <template v-if="activeTab === 'globals'">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <input v-model="skillSearch" placeholder="搜索 Skill 名称或描述..." style="flex:1;padding:6px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;outline:none" />
              <button class="btn-primary btn-sm" :disabled="!skillsChanged" @click="saveGlobalSkills">保存</button>
              <span v-if="skillsChanged" style="font-size:12px;color:#f59e0b;white-space:nowrap">● 有未保存的更改</span>
            </div>
            <div v-if="allGlobalSkills.length === 0" style="text-align:center;color:#94a3b8;padding:40px">暂无全局 Skill</div>
            <div v-else style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden">
              <div v-if="filteredGlobalSkills.length === 0" style="padding:20px;text-align:center;color:#9b9b9b;font-size:13px">无匹配结果</div>
              <label
                v-for="s in filteredGlobalSkills" :key="s.name"
                style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:13px"
                :style="selectedSkills.includes(s.name) ? 'background:#fafaf9' : ''"
              >
                <input type="checkbox" :value="s.name" v-model="selectedSkills" style="cursor:pointer;flex-shrink:0;width:14px;height:14px" />
                <span v-if="s.isBuiltin" style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">内置</span>
                <span v-else style="flex-shrink:0;background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">全局</span>
                <span style="font-family:monospace;font-weight:500;width:200px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#64748b">{{ s.description || '-' }}</span>
                <button class="btn-outline btn-sm" style="flex-shrink:0;padding:2px 8px;font-size:11px" @click.prevent="openView(s.name, s.isBuiltin ? '内置' : '全局')">查看</button>
              </label>
            </div>
          </template>

          <!-- Agent-specific skills tab -->
          <template v-else-if="activeTab === 'skills'">
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
              <button class="btn-primary btn-sm" @click="openAdd">+ 添加 Skill</button>
            </div>
            <div style="margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569">
              技能目录：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
            </div>
            <div v-if="skills.length === 0" style="text-align:center;color:#94a3b8;padding:40px">暂无专属 Skill</div>
            <table v-else>
              <thead><tr><th>名称</th><th>描述</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="s in skills" :key="s.name">
                  <td style="font-family:monospace">{{ s.name }}</td>
                  <td>{{ s.description || '-' }}</td>
                  <td><div class="ops-cell">
                    <button class="btn-outline btn-sm" @click="openView(s.name)">查看</button>
                    <button class="btn-danger btn-sm" @click="remove(s.name)">删除</button>
                  </div></td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>

    <!-- ── View sub-modal ────────────────────────────────────────── -->
    <div v-if="showViewModal" class="modal-overlay" @click.self="showViewModal = false">
      <div class="modal-box wide">
        <div class="modal-header"><h3>查看 Skill</h3><button class="modal-close" @click="showViewModal = false">&times;</button></div>
        <div class="modal-body">
          <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">加载中...</div>
          <template v-else>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span v-if="viewBadge === '内置'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">内置</span>
              <span v-else-if="viewBadge === '全局'" style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600">全局</span>
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ viewName }}</span>
            </div>
            <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
            <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body }}</pre>
          </template>
        </div>
        <div class="modal-footer"><button class="btn-outline" @click="showViewModal = false">关闭</button></div>
      </div>
    </div>

    <!-- ── Skill Hub sub-modal ───────────────────────────────────── -->
    <div v-if="showHub" class="modal-overlay" @click.self="showHub = false">
      <div class="modal-box wide" style="max-width:960px;width:90vw;display:flex;flex-direction:column;max-height:80vh">
        <div class="modal-header" style="flex-shrink:0"><h3>添加 Skill</h3><button class="modal-close" @click="showHub = false">&times;</button></div>
        <div style="display:flex;border-bottom:1px solid #e2e8f0;flex-shrink:0;padding:0 20px">
          <button v-for="tab in ([{key:'search',label:'搜索'},{key:'url',label:'URL 安装'}] as const)" :key="tab.key"
            @click="hubTab = tab.key"
            style="padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px"
            :style="hubTab === tab.key ? 'color:#4f46e5;border-bottom-color:#4f46e5' : 'color:#64748b'"
          >{{ tab.label }}</button>
        </div>
        <div class="modal-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <template v-if="hubTab === 'search'">
            <div style="display:flex;gap:8px;margin-bottom:16px;flex-shrink:0">
              <input v-model="hubQuery" placeholder="搜索 Skill（如 code-review、web-scraper）" style="flex:1" @keydown="hubKeydown" />
              <button class="btn-primary" :disabled="hubSearching || !hubQuery.trim()" @click="hubSearch">{{ hubSearching ? '搜索中...' : '搜索' }}</button>
            </div>
            <div style="flex:1;overflow-y:auto;min-height:0">
              <div v-if="hubSearching" style="text-align:center;color:#94a3b8;padding:40px">搜索中...</div>
              <template v-else-if="hubSearched">
                <div v-if="hubResults.length === 0" style="text-align:center;color:#94a3b8;padding:40px">未找到相关 Skill</div>
                <table v-else style="width:100%;table-layout:fixed">
                  <colgroup><col style="width:200px"/><col/><col style="width:80px"/><col style="width:90px"/><col style="width:70px"/></colgroup>
                  <thead><tr><th>名称</th><th>描述</th><th>版本</th><th>来源</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="s in hubResults" :key="s.provider + ':' + s.id">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name || s.id }}</td>
                      <td style="color:#475569;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="font-size:12px;color:#94a3b8;white-space:nowrap">{{ s.version || '-' }}</td>
                      <td>
                        <span v-if="s.provider==='clawhub'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
                        <span v-else-if="s.provider==='skillsmp'" style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">SkillsMP</span>
                        <span v-else style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
                      </td>
                      <td><button class="btn-primary btn-sm" @click="openInstall(s)">安装</button></td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <div v-else style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">输入关键词搜索 Skill Hub</div>
            </div>
          </template>
          <template v-else-if="hubTab === 'url'">
            <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
              <input v-model="hubUrlInput" placeholder="输入 URL 安装（如 https://skills.sh/owner/repo/skill）" style="flex:1" @keydown.enter="installByUrl" />
              <button class="btn-primary" :disabled="hubUrlInstalling || !hubUrlInput.trim()" @click="installByUrl">{{ hubUrlInstalling ? '安装中...' : '安装' }}</button>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" v-model="hubUrlOverwrite" /> 覆盖已存在的同名 Skill</label>
            <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#64748b;line-height:1.7">
              支持格式：<br>
              <code style="font-family:monospace">https://skills.sh/{owner}/{repo}/{skill}</code><br>
              <code style="font-family:monospace">https://clawhub.ai/{slug}</code><br>
              <code style="font-family:monospace">https://skillsmp.com/skills/{slug}</code>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Install confirm sub-modal ────────────────────────────── -->
    <div v-if="showInstall && selected" class="modal-overlay" @click.self="showInstall = false">
      <div class="modal-box">
        <div class="modal-header"><h3>安装 Skill</h3><button class="modal-close" @click="showInstall = false">&times;</button></div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ selected.name || selected.id }}</span>
              <span v-if="selected.provider==='clawhub'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
              <span v-else-if="selected.provider==='skillsmp'" style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">SkillsMP</span>
              <span v-else style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
            </div>
            <div v-if="selected.description" style="font-size:13px;color:#475569">{{ selected.description }}</div>
          </div>
          <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            安装到：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" v-model="overwrite" /> 覆盖已存在的同名 Skill</label>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showInstall = false">取消</button>
          <button class="btn-primary" :disabled="installing" @click="confirmInstall">{{ installing ? '安装中...' : '确认安装' }}</button>
        </div>
      </div>
    </div>
  </template>
</template>
