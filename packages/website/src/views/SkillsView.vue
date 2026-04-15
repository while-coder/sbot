<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { SkillItem } from '@/types'
import { sourceBadgeStyle, BADGE_CLAWHUB, BADGE_SKILLSSH, BADGE_INSTALLED } from '@/utils/badges'

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

const installedNames = computed(() => new Set(allSkills.value.map(s => s.name)))

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
  if (!confirm(t('skills.confirm_delete', { name }))) return
  try {
    await apiFetch(`/api/skills/${encodeURIComponent(name)}`, 'DELETE')
    show(t('common.deleted'))
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
  provider: 'clawhub' | 'skills.sh'
  score?: number
  updatedAt?: number
  installs?: number
}

const showHub = ref(false)
const hubTab = ref<'url' | 'search'>('search')
const hubQuery = ref('')
const hubResults = ref<HubSkillResult[]>([])
const hubSearching = ref(false)
const hubSearched = ref(false)

// Direct URL install
const hubUrlInput = ref('')
const hubUrlInstalling = ref(false)
const hubUrlOverwrite = ref(false)

async function installByUrl() {
  const url = hubUrlInput.value.trim()
  if (!url) return
  hubUrlInstalling.value = true
  try {
    const res = await apiFetch('/api/skill-hub/install', 'POST', {
      url,
      overwrite: hubUrlOverwrite.value,
    })
    show(`已安装：${res.data?.name ?? url}`)
    hubUrlInput.value = ''
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubUrlInstalling.value = false
  }
}

function openAdd() {
  hubTab.value = 'search'
  hubQuery.value = ''
  hubResults.value = []
  hubSearched.value = false
  hubUrlInput.value = ''
  hubUrlOverwrite.value = false
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
      url: selected.value.sourceUrl,
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

    <!-- View Skill modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>{{ t('common.view') }} Skill</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
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
        <div class="modal-footer">
          <button class="btn-outline" @click="showModal = false">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <!-- Skill Hub modal -->
    <div v-if="showHub" class="modal-overlay" @click.self="showHub = false">
      <div class="modal-box wide" style="max-width:960px;width:90vw;display:flex;flex-direction:column;max-height:80vh">
        <div class="modal-header" style="flex-shrink:0">
          <h3>{{ t('skills.hub_title') }}</h3>
          <button class="modal-close" @click="showHub = false">&times;</button>
        </div>
        <!-- Tabs -->
        <div style="display:flex;border-bottom:1px solid #e2e8f0;flex-shrink:0;padding:0 20px">
          <button
            v-for="tab in ([{key:'url',label:t('skills.url_install_tab')},{key:'search',label:t('skills.search_tab')}] as const)"
            :key="tab.key"
            @click="hubTab = tab.key"
            style="padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px"
            :style="hubTab === tab.key ? 'color:#4f46e5;border-bottom-color:#4f46e5' : 'color:#64748b'"
          >{{ tab.label }}</button>
        </div>
        <div class="modal-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <!-- Tab: URL install -->
          <template v-if="hubTab === 'url'">
            <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
              <input
                v-model="hubUrlInput"
                :placeholder="t('skills.url_placeholder')"
                style="flex:1"
                @keydown.enter="installByUrl"
              />
              <button class="btn-primary" :disabled="hubUrlInstalling || !hubUrlInput.trim()" @click="installByUrl">
                {{ hubUrlInstalling ? t('common.loading') : '安装' }}
              </button>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" v-model="hubUrlOverwrite" /> {{ t('skills.override') }}
            </label>
            <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#64748b;line-height:1.7">
              {{ t('skills.support_formats') }}<br>
              <code style="font-family:monospace">https://clawhub.ai/{slug}</code><br>
              <code style="font-family:monospace">https://skills.sh/{owner}/{repo}/{skill}</code>
            </div>
          </template>

          <!-- Tab: Search -->
          <template v-else>
            <div style="display:flex;gap:8px;margin-bottom:16px;flex-shrink:0">
              <input
                v-model="hubQuery"
                :placeholder="t('skills.search_placeholder_hub')"
                style="flex:1"
                @keydown="hubKeydown"
              />
              <button class="btn-primary" :disabled="hubSearching || !hubQuery.trim()" @click="hubSearch">
                {{ hubSearching ? t('skills.searching') : '搜索' }}
              </button>
            </div>
            <!-- Results area (scrollable) -->
            <div style="flex:1;overflow-y:auto;min-height:0">
              <div v-if="hubSearching" style="text-align:center;color:#94a3b8;padding:40px">{{ t('skills.searching') }}</div>
              <template v-else-if="hubSearched">
                <div v-if="hubResults.length === 0" style="text-align:center;color:#94a3b8;padding:40px">{{ t('skills.no_search_result') }}</div>
                <table v-else style="width:100%;table-layout:fixed">
                  <colgroup>
                    <col style="width:180px" />
                    <col />
                    <col style="width:80px" />
                    <col style="width:90px" />
                    <col style="width:50px" />
                    <col style="width:90px" />
                  </colgroup>
                  <thead>
                    <tr><th>{{ t('common.name') }}</th><th>{{ t('common.description') }}</th><th>{{ t('skills.popularity_col') }}</th><th>{{ t('skills.source_col') }}</th><th>{{ t('skills.link_col') }}</th><th>{{ t('common.ops') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in hubResults" :key="s.provider + ':' + s.id">
                      <td style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.name || s.id }}</td>
                      <td style="color:#475569;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ s.description || '-' }}</td>
                      <td style="font-size:12px;color:#94a3b8;white-space:nowrap">
                        <template v-if="s.installs != null">{{ s.installs >= 1000 ? (s.installs / 1000).toFixed(1) + 'K' : s.installs }} installs</template>
                        <template v-else-if="s.score != null">{{ s.score.toFixed(1) }}</template>
                        <template v-else>-</template>
                      </td>
                      <td>
                        <span :style="s.provider === 'skills.sh' ? BADGE_SKILLSSH : BADGE_CLAWHUB">{{ s.provider === 'skills.sh' ? 'Skills.sh' : 'ClawHub' }}</span>
                      </td>
                      <td>
                        <a :href="s.sourceUrl" target="_blank" rel="noopener" style="color:#4f46e5;font-size:12px" title="Open">&#x2197;</a>
                      </td>
                      <td style="white-space:nowrap">
                        <span v-if="installedNames.has(s.name || s.id)"
                          :style="BADGE_INSTALLED">{{ t('skills.installed_badge') }}</span>
                        <button v-else class="btn-primary btn-sm" style="white-space:nowrap" @click="openInstall(s)">{{ t('skills.install_title') }}</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <div v-else style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
                输入关键词搜索 Skill Hub
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Install confirm modal (stacked on top of hub) -->
    <div v-if="showInstall && selected" class="modal-overlay" @click.self="showInstall = false">
      <div class="modal-box">
        <div class="modal-header">
          <h3>{{ t('skills.install_title') }}</h3>
          <button class="modal-close" @click="showInstall = false">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ selected.name || selected.id }}</span>
              <span :style="selected.provider === 'skills.sh' ? BADGE_SKILLSSH : BADGE_CLAWHUB">{{ selected.provider === 'skills.sh' ? 'Skills.sh' : 'ClawHub' }}</span>
            </div>
            <div v-if="selected.description" style="font-size:13px;color:#475569">{{ selected.description }}</div>
          </div>
          <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px">
            {{ t('skills.install_to') }}<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">~/.sbot/skills/</code>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" v-model="overwrite" />
            {{ t('skills.override') }}
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="showInstall = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="installing" @click="confirmInstall">
            {{ installing ? t('common.loading') : t('skills.confirm_install') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
