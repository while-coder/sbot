<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'

const { show } = useToast()

const skills = ref<SkillItem[]>([])
const builtins = ref<SkillItem[]>([])

async function load() {
  try {
    const res = await apiFetch('/api/skills')
    skills.value = res.data?.skills || []
    builtins.value = res.data?.builtins || []
    store.skillBuiltins = builtins.value
    store.globalSkills = skills.value
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── View Skill modal ──────────────────────────────────────────────
const showModal = ref(false)
const viewName = ref('')
const viewBadge = ref('')
const viewContent = ref('')
const viewLoading = ref(false)

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
  viewName.value = name
  viewBadge.value = badge
  viewContent.value = ''
  viewLoading.value = true
  showModal.value = true
  try {
    const res = await apiFetch(`/api/skills/${encodeURIComponent(name)}`)
    viewContent.value = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    showModal.value = false
  } finally {
    viewLoading.value = false
  }
}

async function remove(name: string) {
  if (!confirm(`确定要删除 Skill "${name}" 吗？此操作将删除整个 Skill 目录！`)) return
  try {
    await apiFetch(`/api/skills/${encodeURIComponent(name)}`, 'DELETE')
    show('删除成功')
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Skill Hub modal ───────────────────────────────────────────────
interface HubSkillResult {
  id: string
  name: string
  description: string
  version: string
  sourceUrl: string
  provider: 'clawhub' | 'skillssh'
}

const showHub = ref(false)
const hubQuery = ref('')
const hubResults = ref<HubSkillResult[]>([])
const hubSearching = ref(false)
const hubSearched = ref(false)

function openAdd() {
  hubQuery.value = ''
  hubResults.value = []
  hubSearched.value = false
  showHub.value = true
}

async function hubSearch() {
  if (!hubQuery.value.trim()) return
  hubSearching.value = true
  hubSearched.value = false
  hubResults.value = []
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

function hubKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') hubSearch()
}

// Install sub-modal
const showInstall = ref(false)
const installing = ref(false)
const selected = ref<HubSkillResult | null>(null)
const overwrite = ref(false)

function openInstall(skill: HubSkillResult) {
  selected.value = skill
  overwrite.value = false
  showInstall.value = true
}

async function confirmInstall() {
  if (!selected.value) return
  installing.value = true
  try {
    const res = await apiFetch('/api/skill-hub/install', 'POST', {
      skill: selected.value,
      overwrite: overwrite.value,
    })
    show(`已安装：${res.data?.name ?? selected.value.name}`)
    showInstall.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    installing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="load">刷新</button>
      <button class="btn-primary btn-sm" @click="openAdd">+ 添加 Skill</button>
    </div>
    <div class="page-content">
      <div style="margin-bottom:16px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569">
        技能目录：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/skills/</code>
      </div>
      <table>
        <thead>
          <tr><th>名称</th><th>描述</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="builtins.length === 0 && skills.length === 0">
            <td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">暂无 Skill</td>
          </tr>
          <tr v-for="s in builtins" :key="'b-' + s.name">
            <td style="font-family:monospace">
              {{ s.name }}
              <span style="margin-left:6px;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
            </td>
            <td>{{ s.description || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openView(s.name, '内置')">查看</button>
              </div>
            </td>
          </tr>
          <tr v-for="s in skills" :key="s.name">
            <td style="font-family:monospace">{{ s.name }}</td>
            <td>{{ s.description || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openView(s.name)">查看</button>
                <button class="btn-danger btn-sm" @click="remove(s.name)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- View Skill modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>查看 Skill</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">加载中...</div>
          <template v-else>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ viewName }}</span>
              <span v-if="viewBadge === '内置'" style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
              <span v-else-if="viewBadge === '全局'" style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">全局</span>
            </div>
            <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
            <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body }}</pre>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- Skill Hub modal -->
    <div v-if="showHub" class="modal-overlay" @click.self="showHub = false">
      <div class="modal-box wide" style="max-width:960px;width:90vw;display:flex;flex-direction:column;max-height:80vh">
        <div class="modal-header" style="flex-shrink:0">
          <h3>Skill Hub</h3>
          <button class="modal-close" @click="showHub = false">&times;</button>
        </div>
        <div class="modal-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <!-- Search bar -->
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-shrink:0">
            <input
              v-model="hubQuery"
              placeholder="搜索 Skill（如 code-review、web-scraper）"
              style="flex:1"
              @keydown="hubKeydown"
            />
            <button class="btn-primary" :disabled="hubSearching || !hubQuery.trim()" @click="hubSearch">
              {{ hubSearching ? '搜索中...' : '搜索' }}
            </button>
          </div>

          <!-- Results area (scrollable) -->
          <div style="flex:1;overflow-y:auto;min-height:0">
            <div v-if="hubSearching" style="text-align:center;color:#94a3b8;padding:40px">搜索中...</div>
            <template v-else-if="hubSearched">
              <div v-if="hubResults.length === 0" style="text-align:center;color:#94a3b8;padding:40px">未找到相关 Skill</div>
              <table v-else style="width:100%">
                <thead>
                  <tr><th>名称</th><th>描述</th><th>版本</th><th>来源</th><th>操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in hubResults" :key="s.provider + ':' + s.id">
                    <td style="font-family:monospace;white-space:nowrap">{{ s.name || s.id }}</td>
                    <td style="color:#475569;font-size:13px">{{ s.description || '-' }}</td>
                    <td style="font-size:12px;color:#94a3b8;white-space:nowrap">{{ s.version || '-' }}</td>
                    <td>
                      <span v-if="s.provider === 'clawhub'"
                        style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
                      <span v-else
                        style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
                    </td>
                    <td style="white-space:nowrap;width:70px">
                      <button class="btn-primary btn-sm" @click="openInstall(s)">安装</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
            <div v-else style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
              输入关键词搜索 Skill Hub
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Install confirm modal (stacked on top of hub) -->
    <div v-if="showInstall && selected" class="modal-overlay" @click.self="showInstall = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>安装 Skill</h3>
          <button class="modal-close" @click="showInstall = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ selected.name || selected.id }}</span>
              <span v-if="selected.provider === 'clawhub'"
                style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
              <span v-else
                style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
            </div>
            <div v-if="selected.description" style="font-size:13px;color:#475569">{{ selected.description }}</div>
          </div>
          <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            安装到：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/skills/</code>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" v-model="overwrite" />
            覆盖已存在的同名 Skill
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showInstall = false">取消</button>
          <button class="btn-primary" :disabled="installing" @click="confirmInstall">
            {{ installing ? '安装中...' : '确认安装' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
