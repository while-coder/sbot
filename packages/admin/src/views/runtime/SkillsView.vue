<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, STabBar, STab, SPageToolbar, SPageContent, STable, type STableColumn } from 'sbot-ui'
import type { SkillItem } from '@/shared/types'
import { sourceBadgeStyle } from '@/utils/badges'
import SkillHubModal from '@/components/modals/SkillHubModal.vue'
import SkillViewerModal from '@/components/modals/SkillViewerModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

const allSkills = ref<SkillItem[]>([])

const searchQuery = ref('')
const activeTab = ref('all')

const columns = computed<STableColumn[]>(() => [
  { key: 'name',        label: t('common.name'),        primary: true, ellipsis: true, width: '240px' },
  { key: 'description', label: t('common.description'), ellipsis: true },
  { key: 'ops',         label: t('common.ops'),         ops: true,     width: '120px' },
])

const sources = computed(() => {
  const seen = new Set<string>()
  for (const s of allSkills.value) if (s.source) seen.add(s.source)
  return Array.from(seen)
})

const filteredSkills = computed(() => {
  const list = activeTab.value === 'all'
    ? allSkills.value
    : allSkills.value.filter(s => s.source === activeTab.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(s =>
    s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
  )
})

async function load() {
  try {
    const res = await apiFetch('/api/skills')
    allSkills.value = res.data || []
    store.allSkills = allSkills.value
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const skillViewRef = ref<InstanceType<typeof SkillViewerModal>>()

function openView(row: SkillItem) {
  skillViewRef.value?.open(row.name, row.source || '', row.path || '')
}

async function remove(name: string) {
  if (!await confirm(t('skills.confirm_delete', { name }), { danger: true })) return
  try {
    await apiFetch(`/api/skills/${encodeURIComponent(name)}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

const hubRef = ref<InstanceType<typeof SkillHubModal>>()

function openAdd() {
  hubRef.value?.open()
}

onMounted(load)
</script>

<template>
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      <SButton type="primary" size="sm" @click="openAdd">{{ t('skills.add') }}</SButton>
    </SPageToolbar>
    <STabBar v-model="activeTab">
      <STab name="all" :count="allSkills.length">{{ t('common.all') }}</STab>
      <STab
        v-for="src in sources"
        :key="src"
        :name="src"
        :count="allSkills.filter(s => s.source === src).length"
      >{{ src }}</STab>
      <div class="tab-bar-spacer" />
      <SInput v-model="searchQuery" size="sm" :placeholder="t('skills.search_placeholder')" class="skills-search" />
    </STabBar>
    <SPageContent>
      <div class="dir-hint-panel">
        {{ t('skills.skills_dir') }}<code class="dir-hint-code">~/.sbot/skills/</code>
      </div>
      <STable
        :columns="columns"
        :rows="filteredSkills"
        row-key="name"
        :empty-text="searchQuery.trim() ? t('skills.no_match') : t('skills.empty')"
      >
        <template #name="{ row }">
          <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(row.source)}`">{{ row.source }}</span>
          <span style="font-family:var(--sui-font-mono)">{{ row.name }}</span>
        </template>
        <template #description="{ row }">{{ row.description || '-' }}</template>
        <template #ops="{ row }">
          <div class="ops-cell">
            <SButton type="outline" size="sm" @click="openView(row)">{{ t('common.view') }}</SButton>
            <SButton v-if="row.source === '全局'" type="danger" size="sm" @click="remove(row.name)">{{ t('common.delete') }}</SButton>
          </div>
        </template>
      </STable>
    </SPageContent>

    <SkillViewerModal ref="skillViewRef" />

    <SkillHubModal
      ref="hubRef"
      install-api-url="/api/skill-hub/install"
      install-dir="~/.sbot/skills/"
      :title="t('skills.hub_title')"
      :url-formats="['https://clawhub.ai/{slug}', 'https://skills.sh/{owner}/{repo}/{skill}']"
      @installed="load"
    />
  </div>
</template>

<style scoped>
.tab-bar-spacer { flex: 1; }
.skills-search { width: 220px; }
.dir-hint-panel {
  margin-bottom: var(--sui-sp-7);
  padding: var(--sui-sp-4) var(--sui-sp-6);
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
