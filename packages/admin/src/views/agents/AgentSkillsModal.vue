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
import { SModal, SButton, SInput, STabBar, STab, SCheckCard, STable, type STableColumn } from 'sbot-ui'

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

const exclusiveColumns = computed<STableColumn[]>(() => [
  { key: 'name',        label: t('common.name'), primary: true },
  { key: 'description', label: t('common.description') },
  { key: 'ops',         label: t('common.ops'), ops: true },
])

const globalColumns = computed<STableColumn[]>(() => [
  { key: 'select',      label: '',                      width: '40px' },
  { key: 'name',        label: t('common.name'),        primary: true, width: '280px' },
  { key: 'description', label: t('common.description'), ellipsis: true },
  { key: 'ops',         label: t('common.ops'),         ops: true, width: '90px' },
])

const filteredGlobalSkills = computed(() => {
  const list = activeTab.value === 'all'
    ? allGlobalSkills.value
    : allGlobalSkills.value.filter(s => s.source === activeTab.value)
  const q = skillSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
})

const globalEmptyText = computed(() =>
  allGlobalSkills.value.length === 0 ? t('skills.no_global') : t('skills.no_match'),
)

function globalRowClass(row: SkillItem): string {
  return selectedSkills.value.includes(row.name) ? 'is-checked' : ''
}

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
        <div style="display:flex;align-items:center;gap:var(--sui-sp-4)">
          <h3 class="s-modal-title">{{ agentDisplayName }} — {{ t('agents.skills_title') }}</h3>
          <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
        </div>
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
          <STable
            :columns="globalColumns"
            :rows="filteredGlobalSkills"
            row-key="name"
            :empty-text="globalEmptyText"
            :row-class-name="globalRowClass"
          >
            <template #select="{ row }">
              <input
                type="checkbox"
                :value="row.name"
                v-model="selectedSkills"
                :disabled="useAllSkills"
                :checked="useAllSkills || selectedSkills.includes(row.name)"
              />
            </template>
            <template #name="{ row }">
              <div class="name-cell">
                <span :style="`flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(row.source)}`">{{ row.source }}</span>
                <span style="font-family:var(--sui-font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ row.name }}</span>
              </div>
            </template>
            <template #description="{ row }">
              <span style="color:var(--sui-fg-muted);font-size:var(--sui-fs-sm)">{{ row.description || '-' }}</span>
            </template>
            <template #ops="{ row }">
              <SButton type="outline" size="sm" @click="openView(row.name, row.source)">{{ t('common.view') }}</SButton>
            </template>
          </STable>
        </template>

        <!-- Agent-specific skills tab -->
        <template v-else>
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <SButton type="primary" size="sm" @click="openAdd">{{ t('skills.add') }}</SButton>
          </div>
          <div class="dir-hint-panel">
            {{ t('skills.skills_dir') }}<code class="dir-hint-code">~/.sbot/agents/{{ agentName }}/skills/</code>
          </div>
          <STable
            :columns="exclusiveColumns"
            :rows="skills"
            row-key="name"
            :empty-text="t('skills.no_exclusive')"
          >
            <template #name="{ row }">
              <span style="font-family:var(--sui-font-mono)">{{ row.name }}</span>
            </template>
            <template #description="{ row }">{{ row.description || '-' }}</template>
            <template #ops="{ row }">
              <div class="ops-cell">
                <SButton type="outline" size="sm" @click="openView(row.name, t('agents.skills_exclusive_tab'))">{{ t('common.view') }}</SButton>
                <SButton type="danger" size="sm" @click="remove(row.name)">{{ t('common.delete') }}</SButton>
              </div>
            </template>
          </STable>
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
:deep(tr.is-checked > td) { background: var(--sui-bg-subtle); }
:deep(input[type="checkbox"]) { cursor: pointer; width: 14px; height: 14px; }
.name-cell {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  min-width: 0;
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
