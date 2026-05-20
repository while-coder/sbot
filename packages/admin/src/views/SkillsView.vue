<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast, SButton, SInput, STabBar, STab, SPageToolbar, SPageContent } from 'sbot-ui'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle } from '@/utils/badges'
import SkillHubModal from '@/components/SkillHubModal.vue'
import SkillViewerModal from '@/components/SkillViewerModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const allSkills = ref<SkillItem[]>([])

const searchQuery = ref('')
const activeTab = ref('all')

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

function openView(name: string, badge = '') {
  skillViewRef.value?.open(name, badge)
}

async function remove(name: string) {
  if (!confirm(t('skills.confirm_delete', { name }))) return
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
      <table v-if="!isMobile" style="table-layout:fixed;width:100%">
        <colgroup>
          <col style="width:240px" />
          <col />
          <col style="width:120px" />
        </colgroup>
        <thead>
          <tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('common.ops') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="filteredSkills.length === 0">
            <td colspan="3" class="skills-empty">
              {{ searchQuery.trim() ? t('skills.no_match') : t('skills.empty') }}
            </td>
          </tr>
          <tr v-for="s in filteredSkills" :key="s.name">
            <td class="skills-name">
              <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>{{ s.name }}
            </td>
            <td class="skills-desc">{{ s.description || '-' }}</td>
            <td class="skills-ops">
              <div class="ops-cell">
                <SButton type="outline" size="sm" @click="openView(s.name, s.source)">{{ t('common.view') }}</SButton>
                <SButton v-if="s.source === '全局'" type="danger" size="sm" @click="remove(s.name)">{{ t('common.delete') }}</SButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="card-list">
        <div v-for="s in filteredSkills" :key="s.name" class="mobile-card">
          <div class="mobile-card-header">
            <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>
            {{ s.name }}
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.description') }}</span>
            <span class="mobile-card-value">{{ s.description || '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <SButton type="outline" size="sm" @click="openView(s.name, s.source)">{{ t('common.view') }}</SButton>
            <SButton v-if="s.source === '全局'" type="danger" size="sm" @click="remove(s.name)">{{ t('common.delete') }}</SButton>
          </div>
        </div>
        <div v-if="filteredSkills.length === 0" class="mobile-card-empty">
          {{ searchQuery.trim() ? t('skills.no_match') : t('skills.empty') }}
        </div>
      </div>
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
.skills-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
}
.skills-name {
  font-family: var(--sui-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skills-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skills-ops {
  white-space: nowrap;
}
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
