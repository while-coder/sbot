<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle } from '@/utils/badges'
import SkillHubModal from '@/components/SkillHubModal.vue'

const { t } = useI18n()

const emit = defineEmits<{ saved: [agentName: string] }>()
const { show } = useToast()

const visible    = ref(false)
const agentName  = ref('')
const agentDisplayName = computed(() => (store.settings.agents?.[agentName.value] as any)?.name || agentName.value)

const skills     = ref<SkillItem[]>([])
const activeTab  = ref('all')

// ── Global skills ─────────────────────────────────────────────────
const useAllSkills     = ref(false)
const origUseAll       = ref(false)
const agentSkillNames  = ref<string[]>([])
const selectedSkills   = ref<string[]>([])
const skillSearch      = ref('')

const skillsChanged = computed(() => {
  if (useAllSkills.value !== origUseAll.value) return true
  if (useAllSkills.value) return false
  const a = [...selectedSkills.value].sort().join(',')
  const b = [...agentSkillNames.value].sort().join(',')
  return a !== b
})
const allGlobalSkills = computed(() => store.allSkills)
const sources = computed(() => {
  const seen = new Set<string>()
  for (const s of allGlobalSkills.value) if (s.source) seen.add(s.source)
  return Array.from(seen)
})

const filteredGlobalSkills = computed(() => {
  const list = activeTab.value === 'all'
    ? allGlobalSkills.value
    : allGlobalSkills.value.filter(s => s.source === activeTab.value)
  const q = skillSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
})

function apiBase() {
  return `/api/agents/${encodeURIComponent(agentName.value)}/skills`
}

async function load() {
  try {
    const agent = (store.settings.agents || {})[agentName.value]
    const isAll = agent?.skills === '*'
    useAllSkills.value = isAll
    origUseAll.value   = isAll
    const [agentRes, skillsRes] = await Promise.all([
      apiFetch(apiBase()),
      apiFetch('/api/skills'),
    ])
    skills.value = agentRes.data?.skills || []
    const selectedFromApi: string[] = (agentRes.data?.globals || []).map((g: any) => g.name)
    agentSkillNames.value  = isAll ? [] : selectedFromApi
    selectedSkills.value   = isAll ? [] : [...selectedFromApi]
    const allSkills = skillsRes.data || []
    store.allSkills = allSkills
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function saveGlobalSkills() {
  try {
    const existing = (store.settings.agents || {})[agentName.value] || {}
    const skillsValue = useAllSkills.value ? '*' : selectedSkills.value
    await apiFetch(
      `/api/agents/${encodeURIComponent(agentName.value)}`,
      'PUT',
      { ...existing, skills: skillsValue },
    )
    const settingsRes = await apiFetch('/api/settings')
    Object.assign(store.settings, settingsRes.data)
    origUseAll.value = useAllSkills.value
    agentSkillNames.value = useAllSkills.value ? [] : [...selectedSkills.value]
    show(t('common.saved'))
    emit('saved', agentName.value)
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
  const isGlobal = badge !== t('agents.skills_exclusive_tab')
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
  if (!window.confirm(t('skills.confirm_delete', { name }))) return
  try {
    await apiFetch(`${apiBase()}/${encodeURIComponent(name)}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Skill Hub ────────────────────────────────────────────────────
const hubRef = ref<InstanceType<typeof SkillHubModal>>()

function openAdd() {
  hubRef.value?.open()
}

// ── Public API ───────────────────────────────────────────────────
function open(name: string) {
  agentName.value     = name
  skills.value        = []
  agentSkillNames.value = []
  selectedSkills.value  = []
  activeTab.value     = 'all'
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
          <h3>{{ agentDisplayName }} — {{ t('agents.skills_title') }}</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
            <button class="modal-close" @click="visible = false">&times;</button>
          </div>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;border-bottom:1px solid #e8e6e3;background:#fff;padding:0 20px;flex-shrink:0">
          <button
            @click="activeTab = 'all'"
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
            :style="activeTab === 'all' ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
          >
            {{ t('common.all') }}
            <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
              :style="activeTab === 'all' ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
            >{{ allGlobalSkills.length }}</span>
          </button>
          <button
            v-for="src in sources"
            :key="src"
            @click="activeTab = src"
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
            :style="activeTab === src ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
          >
            {{ src }}
            <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
              :style="activeTab === src ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
            >{{ allGlobalSkills.filter(s => s.source === src).length }}</span>
          </button>
          <button
            @click="activeTab = t('agents.skills_exclusive_tab')"
            style="padding:11px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
            :style="activeTab === t('agents.skills_exclusive_tab') ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
          >
            {{ t('agents.skills_exclusive_tab') }}
            <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
              :style="activeTab === t('agents.skills_exclusive_tab') ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
            >{{ skills.length }}</span>
          </button>
        </div>

        <!-- Content -->
        <div style="flex:1;overflow:auto;padding:16px 20px">
          <!-- Global skills tab -->
          <template v-if="activeTab !== t('agents.skills_exclusive_tab')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;flex-shrink:0;padding:4px 10px;background:#f8fafc;border:1px solid #e8e6e3;border-radius:6px">
                <input type="checkbox" v-model="useAllSkills" style="width:14px;height:14px;cursor:pointer" />
                {{ t('agents.use_all') }}
              </label>
              <input v-if="!useAllSkills" v-model="skillSearch" :placeholder="t('skills.search_placeholder')" style="flex:1;padding:6px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;outline:none" />
              <div v-else style="flex:1" />
              <button class="btn-primary btn-sm" :disabled="!skillsChanged" @click="saveGlobalSkills">{{ t('common.save') }}</button>
              <span v-if="skillsChanged" style="font-size:12px;color:#f59e0b;white-space:nowrap">{{ t('common.unsaved_changes') }}</span>
            </div>
            <div v-if="allGlobalSkills.length === 0" style="text-align:center;color:#94a3b8;padding:40px">{{ t('skills.no_global') }}</div>
            <div v-else style="border:1px solid #e8e6e3;border-radius:6px;overflow:hidden">
              <div v-if="filteredGlobalSkills.length === 0" style="padding:20px;text-align:center;color:#9b9b9b;font-size:13px">{{ t('skills.no_match') }}</div>
              <label
                v-for="s in filteredGlobalSkills" :key="s.name"
                style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid #f5f4f2;font-size:13px"
                :style="selectedSkills.includes(s.name) ? 'background:#fafaf9' : ''"
              >
                <input type="checkbox" :value="s.name" v-model="selectedSkills" :disabled="useAllSkills" :checked="useAllSkills || selectedSkills.includes(s.name)" style="cursor:pointer;flex-shrink:0;width:14px;height:14px" />
                <span :style="`flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
                <span style="font-family:monospace;font-weight:500;width:200px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name }}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#64748b">{{ s.description || '-' }}</span>
                <button class="btn-outline btn-sm" style="flex-shrink:0;padding:2px 8px;font-size:11px" @click.prevent="openView(s.name, s.source)">{{ t('common.view') }}</button>
              </label>
            </div>
          </template>

          <!-- Agent-specific skills tab -->
          <template v-else>
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
              <button class="btn-primary btn-sm" @click="openAdd">{{ t('skills.add') }}</button>
            </div>
            <div style="margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569">
              {{ t('skills.skills_dir') }}<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/agents/{{ agentName }}/skills/</code>
            </div>
            <div v-if="skills.length === 0" style="text-align:center;color:#94a3b8;padding:40px">{{ t('skills.no_exclusive') }}</div>
            <table v-else>
              <thead><tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('common.ops') }}</th></tr></thead>
              <tbody>
                <tr v-for="s in skills" :key="s.name">
                  <td style="font-family:monospace">{{ s.name }}</td>
                  <td>{{ s.description || '-' }}</td>
                  <td><div class="ops-cell">
                    <button class="btn-outline btn-sm" @click="openView(s.name, t('agents.skills_exclusive_tab'))">{{ t('common.view') }}</button>
                    <button class="btn-danger btn-sm" @click="remove(s.name)">{{ t('common.delete') }}</button>
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
        <div class="modal-header"><h3>{{ t('common.view') }} Skill</h3><button class="modal-close" @click="showViewModal = false">&times;</button></div>
        <div class="modal-body">
          <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">{{ t('common.loading') }}</div>
          <template v-else>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span v-if="viewBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(viewBadge)}`">{{ viewBadge }}</span>
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ viewName }}</span>
            </div>
            <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
            <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body }}</pre>
          </template>
        </div>
        <div class="modal-footer"><button class="btn-outline" @click="showViewModal = false">{{ t('common.close') }}</button></div>
      </div>
    </div>

    <SkillHubModal
      ref="hubRef"
      :install-api-url="'/api/agents/' + encodeURIComponent(agentName) + '/skill-hub/install'"
      :install-dir="'~/.sbot/agents/' + agentName + '/skills/'"
      @installed="load"
    />
  </template>
</template>
