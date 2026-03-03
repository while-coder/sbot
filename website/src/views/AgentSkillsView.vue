<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const agentName = route.params.agentName as string
const skills = ref<SkillItem[]>([])
const globals = ref<SkillItem[]>([])

function apiBase() {
  return `/api/agents/${encodeURIComponent(agentName)}/skills`
}

async function load() {
  try {
    const res = await apiFetch(apiBase())
    skills.value = res.data?.skills || []
    globals.value = res.data?.globals || []
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const showModal = ref(false)
const editingName = ref<string | null>(null)
const form = ref({ name: '', content: '' })

function openAdd() {
  editingName.value = null
  form.value = { name: '', content: '---\nname: \ndescription: ""\n---\n\n' }
  showModal.value = true
}

async function openEdit(name: string) {
  editingName.value = name
  form.value = { name, content: '' }
  showModal.value = true
  try {
    const res = await apiFetch(`${apiBase()}/${encodeURIComponent(name)}`)
    form.value.content = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function save() {
  if (!form.value.name.trim()) { show('名称不能为空', 'error'); return }
  if (!form.value.content.trim()) { show('内容不能为空', 'error'); return }
  try {
    await apiFetch(`${apiBase()}/${encodeURIComponent(form.value.name)}`, 'PUT', { content: form.value.content })
    show('保存成功')
    showModal.value = false
    await load()
  } catch (e: any) {
    show(e.message, 'error')
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

onMounted(load)
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="router.push('/agents')">← 返回</button>
      <span class="page-toolbar-title" style="margin-left:12px">Agent: {{ agentName }} — Skills 配置</span>
      <button class="btn-outline btn-sm" style="margin-left:8px" @click="load">刷新</button>
      <button class="btn-primary btn-sm" style="margin-left:auto" @click="openAdd">+ 添加 Skill</button>
    </div>
    <div class="page-content">
      <div style="margin-bottom:16px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569">
        技能目录：<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
      </div>
      <table>
        <thead>
          <tr><th>名称</th><th>描述</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="globals.length === 0 && skills.length === 0">
            <td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">暂无 Skill</td>
          </tr>
          <tr v-for="s in globals" :key="'g-' + s.name">
            <td style="font-family:monospace">
              {{ s.name }}
              <span v-if="(s as any).isBuiltin !== false"
                style="margin-left:6px;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
              <span v-else
                style="margin-left:6px;background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">全局</span>
            </td>
            <td>{{ s.description || '-' }}</td>
            <td>-</td>
          </tr>
          <tr v-for="s in skills" :key="s.name">
            <td style="font-family:monospace">{{ s.name }}</td>
            <td>{{ s.description || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openEdit(s.name)">编辑</button>
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
          <h3>{{ editingName ? '编辑 Skill' : '添加 Skill' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称 (kebab-case) *</label>
            <input v-model="form.name" :disabled="!!editingName" placeholder="如 my-skill" />
          </div>
          <div class="form-group">
            <label>SKILL.md 内容 *</label>
            <textarea
              v-model="form.content"
              rows="18"
              style="font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.5"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
