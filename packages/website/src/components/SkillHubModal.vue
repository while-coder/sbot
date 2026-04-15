<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { BADGE_CLAWHUB, BADGE_SKILLSSH } from '@/utils/badges'

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

const props = withDefaults(defineProps<{
  installApiUrl: string
  installDir: string
  title?: string
  urlFormats?: string[]
}>(), {
  title: '',
  urlFormats: () => ['https://clawhub.ai/{slug}'],
})

const emit = defineEmits<{ installed: [] }>()

const { t } = useI18n()
const { show } = useToast()

// ── Hub state ────────────────────────────────────────────────────
const visible = ref(false)
const hubTab = ref<'url' | 'search'>('search')
const hubQuery = ref('')
const hubResults = ref<HubSkillResult[]>([])
const hubSearching = ref(false)
const hubSearched = ref(false)

// URL install
const hubUrlInput = ref('')
const hubUrlInstalling = ref(false)
const hubUrlOverwrite = ref(false)

// Install confirm
const showInstall = ref(false)
const installing = ref(false)
const selected = ref<HubSkillResult | null>(null)
const overwrite = ref(false)

function open() {
  hubTab.value = 'search'
  hubQuery.value = ''
  hubResults.value = []
  hubSearched.value = false
  hubUrlInput.value = ''
  hubUrlOverwrite.value = false
  visible.value = true
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

async function installByUrl() {
  const url = hubUrlInput.value.trim()
  if (!url) return
  hubUrlInstalling.value = true
  try {
    const res = await apiFetch(props.installApiUrl, 'POST', {
      url,
      overwrite: hubUrlOverwrite.value,
    })
    show(`已安装：${res.data?.name ?? url}`)
    hubUrlInput.value = ''
    emit('installed')
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    hubUrlInstalling.value = false
  }
}

function openInstall(skill: HubSkillResult) {
  selected.value = skill
  overwrite.value = false
  showInstall.value = true
}

async function confirmInstall() {
  if (!selected.value) return
  installing.value = true
  try {
    const res = await apiFetch(props.installApiUrl, 'POST', {
      url: selected.value.sourceUrl,
      overwrite: overwrite.value,
    })
    show(`已安装：${res.data?.name ?? selected.value.name}`)
    showInstall.value = false
    emit('installed')
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    installing.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <!-- Skill Hub modal -->
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box wide" style="max-width:960px;width:90vw;display:flex;flex-direction:column;max-height:80vh">
      <div class="modal-header" style="flex-shrink:0">
        <h3>{{ title || t('skills.hub_title') }}</h3>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <!-- Tabs -->
      <div style="display:flex;border-bottom:1px solid #e2e8f0;flex-shrink:0;padding:0 20px">
        <button
          v-for="tab in ([{key:'search',label:t('skills.search_tab')},{key:'url',label:t('skills.url_install_tab')}] as const)"
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
            <code v-for="fmt in urlFormats" :key="fmt" style="font-family:monospace;display:block">{{ fmt }}</code>
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
                      <button class="btn-primary btn-sm" style="white-space:nowrap" @click="openInstall(s)">{{ t('skills.install_title') }}</button>
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

  <!-- Install confirm modal -->
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
          {{ t('skills.install_to') }}<code style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:3px">{{ installDir }}</code>
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
</template>
