<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from 'sbot-ui'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle } from '@/utils/badges'
import SkillHubModal from '@/components/SkillHubModal.vue'
import SkillViewerModal from '@/components/SkillViewerModal.vue'
import { SModal, SButton, SInput, STabBar, STab, SCheckCard } from 'sbot-ui'

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
const skillViewRef = ref<InstanceType<typeof SkillViewerModal>>()

function openView(name: string, badge = '') {
  const isGlobal = badge !== t('agents.skills_exclusive_tab')
  const base = isGlobal ? '/api/skills' : apiBase()
  skillViewRef.value?.open(name, badge, base)
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
    <SModal v-model:visible="visible" width="xl">
      <template #header>
        <h3 class="s-modal-title">{{ agentDisplayName }} — {{ t('agents.skills_title') }}</h3>
        <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      </template>

      <!-- Tab bar -->
      <template #toolbar>
        <STabBar v-model="activeTab" style="padding:0;border:none;background:transparent">
          <STab name="all" :count="allGlobalSkills.length">{{ t('common.all') }}</STab>
          <STab
            v-for="src in sources"
            :key="src"
            :name="src"
            :count="allGlobalSkills.filter(s => s.source === src).length"
          >{{ src }}</STab>
          <STab :name="t('agents.skills_exclusive_tab')" :count="skills.length">{{ t('agents.skills_exclusive_tab') }}</STab>
        </STabBar>
      </template>

      <div style="height:62vh;overflow:auto">
        <!-- Global skills tab -->
        <template v-if="activeTab !== t('agents.skills_exclusive_tab')">
          <div class="picker-toolbar">
            <SCheckCard v-model="useAllSkills">{{ t('agents.use_all') }}</SCheckCard>
            <SInput v-if="!useAllSkills" v-model="skillSearch" :placeholder="t('skills.search_placeholder')" size="sm" style="flex:1" />
            <div v-else style="flex:1" />
            <SButton type="primary" size="sm" :disabled="!skillsChanged" @click="saveGlobalSkills">{{ t('common.save') }}</SButton>
            <span v-if="skillsChanged" class="picker-unsaved">{{ t('common.unsaved_changes') }}</span>
          </div>
          <div v-if="allGlobalSkills.length === 0" class="picker-empty">{{ t('skills.no_global') }}</div>
          <div v-else class="picker-list">
            <div v-if="filteredGlobalSkills.length === 0" class="picker-list-empty">{{ t('skills.no_match') }}</div>
            <label
              v-for="s in filteredGlobalSkills" :key="s.name"
              class="picker-row"
              :class="{ checked: selectedSkills.includes(s.name) }"
            >
              <input type="checkbox" :value="s.name" v-model="selectedSkills" :disabled="useAllSkills" :checked="useAllSkills || selectedSkills.includes(s.name)" />
              <span :style="`flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
              <span class="picker-row-name">{{ s.name }}</span>
              <span class="picker-row-desc">{{ s.description || '-' }}</span>
              <SButton type="outline" size="sm" @click.prevent="openView(s.name, s.source)">{{ t('common.view') }}</SButton>
            </label>
          </div>
        </template>

        <!-- Agent-specific skills tab -->
        <template v-else>
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <SButton type="primary" size="sm" @click="openAdd">{{ t('skills.add') }}</SButton>
          </div>
          <div class="dir-hint-panel">
            {{ t('skills.skills_dir') }}<code class="dir-hint-code">~/.sbot/agents/{{ agentName }}/skills/</code>
          </div>
          <div v-if="skills.length === 0" class="picker-empty">{{ t('skills.no_exclusive') }}</div>
          <table v-else>
            <thead><tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('common.ops') }}</th></tr></thead>
            <tbody>
              <tr v-for="s in skills" :key="s.name">
                <td style="font-family:var(--sui-font-mono)">{{ s.name }}</td>
                <td>{{ s.description || '-' }}</td>
                <td><div class="ops-cell">
                  <SButton type="outline" size="sm" @click="openView(s.name, t('agents.skills_exclusive_tab'))">{{ t('common.view') }}</SButton>
                  <SButton type="danger" size="sm" @click="remove(s.name)">{{ t('common.delete') }}</SButton>
                </div></td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </SModal>

    <SkillViewerModal ref="skillViewRef" />

    <SkillHubModal
      ref="hubRef"
      :install-api-url="'/api/agents/' + encodeURIComponent(agentName) + '/skill-hub/install'"
      :install-dir="'~/.sbot/agents/' + agentName + '/skills/'"
      @installed="load"
    />
  </template>
</template>

<style scoped>
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-4);
}
.picker-unsaved {
  font-size: var(--sui-fs-sm);
  color: var(--sui-warning);
  white-space: nowrap;
}
.picker-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.picker-list {
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  overflow: hidden;
}
.picker-list-empty {
  padding: 20px;
  text-align: center;
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-4);
  padding: var(--sui-sp-3) var(--sui-sp-5);
  cursor: pointer;
  border-bottom: 1px solid var(--sui-border-subtle);
  font-size: var(--sui-fs-md);
}
.picker-row:last-child { border-bottom: none; }
.picker-row.checked { background: var(--sui-bg-subtle); }
.picker-row input[type="checkbox"] { cursor: pointer; flex-shrink: 0; width: 14px; height: 14px; }
.picker-row-name {
  font-family: var(--sui-font-mono);
  font-weight: 500;
  width: 200px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-row-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.dir-hint-panel {
  margin-bottom: var(--sui-sp-4);
  padding: var(--sui-sp-3) var(--sui-sp-5);
  background: var(--sui-bg-soft);
  border-radius: var(--sui-radius-md);
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-secondary);
}
.dir-hint-code {
  font-family: var(--sui-font-mono);
  background: var(--sui-border);
  padding: 2px var(--sui-sp-2);
  border-radius: var(--sui-radius-xs);
}
</style>
