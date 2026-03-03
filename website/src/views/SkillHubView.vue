<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { show } = useToast()

interface HubSkillResult {
  slug: string
  name: string
  description: string
  version: string
  sourceUrl: string
  provider: 'clawhub' | 'skillssh'
}

const query = ref('')
const results = ref<HubSkillResult[]>([])
const searching = ref(false)
const searched = ref(false)

async function search() {
  if (!query.value.trim()) return
  searching.value = true
  searched.value = false
  results.value = []
  try {
    const res = await apiFetch(`/api/skill-hub/search?q=${encodeURIComponent(query.value.trim())}&limit=30`)
    results.value = Array.isArray(res) ? res : (res.data ?? [])
    searched.value = true
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    searching.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') search()
}

// Install modal
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
      provider: selected.value.provider,
      bundleUrl: selected.value.sourceUrl,
      overwrite: overwrite.value,
    })
    show(`已安装：${res.data?.name ?? selected.value.name}`)
    showInstall.value = false
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    installing.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="router.push('/skills')">← 返回</button>
      <span class="page-toolbar-title" style="margin-left:12px">Skill Hub</span>
    </div>
    <div class="page-content">

      <!-- Search bar -->
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <input
          v-model="query"
          placeholder="搜索 Skill（如 code-review、web-scraper）"
          style="flex:1"
          @keydown="onKeydown"
        />
        <button class="btn-primary" :disabled="searching || !query.trim()" @click="search">
          {{ searching ? '搜索中...' : '搜索' }}
        </button>
      </div>

      <!-- Results -->
      <div v-if="searching" style="text-align:center;color:#94a3b8;padding:40px">搜索中...</div>

      <template v-else-if="searched">
        <div v-if="results.length === 0" style="text-align:center;color:#94a3b8;padding:40px">未找到相关 Skill</div>
        <table v-else>
          <thead>
            <tr><th>名称</th><th>描述</th><th>版本</th><th>来源</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in results" :key="s.provider + ':' + s.slug">
              <td style="font-family:monospace;white-space:nowrap">{{ s.name || s.slug }}</td>
              <td style="color:#475569;font-size:13px">{{ s.description || '-' }}</td>
              <td style="font-size:12px;color:#94a3b8;white-space:nowrap">{{ s.version || '-' }}</td>
              <td>
                <span v-if="s.provider === 'clawhub'"
                  style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">ClawHub</span>
                <span v-else
                  style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">Skills.sh</span>
              </td>
              <td>
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

    <!-- Install confirm modal -->
    <div v-if="showInstall && selected" class="modal-overlay" @click.self="showInstall = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>安装 Skill</h3>
          <button class="modal-close" @click="showInstall = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ selected.name || selected.slug }}</span>
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
