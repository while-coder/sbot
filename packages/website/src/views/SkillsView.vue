<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle } from '@/utils/badges'
import SkillHubModal from '@/components/SkillHubModal.vue'
import SkillViewModal from '@/components/SkillViewModal.vue'

const { t } = useI18n()
const { show } = useToast()
const { isMobile } = useResponsive()

const allSkills = ref<SkillItem[]>([])

// ── Search & tab filter ──
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

// ── View Skill modal ──────────────────────────────────────────────
const skillViewRef = ref<InstanceType<typeof SkillViewModal>>()

function openView(name: string, badge = '') {
  skillViewRef.value?.open(name, badge, `/api/skills/${encodeURIComponent(name)}`)
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
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
      <button class="btn-primary btn-sm" @click="openAdd">{{ t('skills.add') }}</button>
    </div>
    <!-- Tab bar + search -->
    <div style="display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #e8e6e3;background:#fff;gap:0;flex-shrink:0">
      <button
        key="all"
        @click="activeTab = 'all'"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
        :style="activeTab === 'all' ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ t('common.all') }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="activeTab === 'all' ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ allSkills.length }}</span>
      </button>
      <button
        v-for="src in sources"
        :key="src"
        @click="activeTab = src"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s"
        :style="activeTab === src ? 'color:#1c1c1c;border-bottom-color:#1c1c1c' : 'color:#9b9b9b'"
      >
        {{ src }}
        <span style="margin-left:4px;font-size:11px;padding:0 5px;border-radius:10px;font-weight:600"
          :style="activeTab === src ? 'background:#1c1c1c;color:#fff' : 'background:#f0efed;color:#6b6b6b'"
        >{{ allSkills.filter(s => s.source === src).length }}</span>
      </button>
      <div style="flex:1" />
      <input
        v-model="searchQuery"
        :placeholder="t('skills.search_placeholder')"
        style="width:220px;padding:5px 10px;border:1px solid #e8e6e3;border-radius:6px;font-size:12px;color:#1c1c1c;outline:none;background:#fafaf9"
        @focus="($event.target as HTMLInputElement).style.borderColor='#1c1c1c'"
        @blur="($event.target as HTMLInputElement).style.borderColor='#e8e6e3'"
      />
    </div>
    <div class="page-content">
      <div style="margin-bottom:16px;padding:10px 14px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569">
        {{ t('skills.skills_dir') }}<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/skills/</code>
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
            <td colspan="3" style="text-align:center;color:#94a3b8;padding:40px">
              {{ searchQuery.trim() ? t('skills.no_match') : t('skills.empty') }}
            </td>
          </tr>
          <tr v-for="s in filteredSkills" :key="s.name">
            <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <span :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px;${sourceBadgeStyle(s.source)}`">{{ s.source }}</span>{{ s.name }}
            </td>
            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
            <td style="white-space:nowrap">
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="openView(s.name, s.source)">{{ t('common.view') }}</button>
                <button v-if="s.source === '全局'" class="btn-danger btn-sm" @click="remove(s.name)">{{ t('common.delete') }}</button>
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
            <button class="btn-outline btn-sm" @click="openView(s.name, s.source)">{{ t('common.view') }}</button>
            <button v-if="s.source === '全局'" class="btn-danger btn-sm" @click="remove(s.name)">{{ t('common.delete') }}</button>
          </div>
        </div>
        <div v-if="filteredSkills.length === 0" class="mobile-card-empty">
          {{ searchQuery.trim() ? t('skills.no_match') : t('skills.empty') }}
        </div>
      </div>
    </div>

    <SkillViewModal ref="skillViewRef" />

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
