<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'

const router = useRouter()
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

function openAdd() {
  show('请直接在服务器 ~/.sbot/skills/ 目录下创建 Skill 目录', 'error')
}

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

onMounted(load)
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="load">刷新</button>
      <button class="btn-outline btn-sm" @click="router.push('/skills/hub')">Skill Hub</button>
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
  </div>
</template>
