<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { badgeClawhub, badgeSkillssh } from '@/utils/badges'
import { SModal, SButton, SInput, STabBar, STab, SCheckCard, STable, type STableColumn } from 'sbot-ui'

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
const hubTab = ref<'url' | 'search' | 'zip'>('search')
const hubQuery = ref('')
const hubResults = ref<HubSkillResult[]>([])
const hubSearching = ref(false)
const hubSearched = ref(false)

// URL install
const hubUrlInput = ref('')
const hubUrlInstalling = ref(false)
const hubUrlOverwrite = ref(false)

// Zip install
const zipFiles = ref<File[]>([])
const zipInstalling = ref(false)
const zipOverwrite = ref(false)
const zipResults = ref<{ name: string; ok: boolean; msg: string }[]>([])
const zipInstallUrl = computed(() => props.installApiUrl.replace(/\/install$/, '/install-zip'))

// Install confirm
const showInstall = ref(false)
const installing = ref(false)
const selected = ref<HubSkillResult | null>(null)

const hubColumns = computed<STableColumn[]>(() => [
  { key: 'name',        label: t('common.name'),            primary: true, ellipsis: true, width: '180px' },
  { key: 'description', label: t('common.description'),     ellipsis: true },
  { key: 'popularity',  label: t('skills.popularity_col'),  width: '80px' },
  { key: 'source',      label: t('skills.source_col'),      width: '90px' },
  { key: 'link',        label: t('skills.link_col'),        width: '50px' },
  { key: 'ops',         label: t('common.ops'),             ops: true,     width: '90px' },
])

function hubRowKey(row: HubSkillResult): string {
  return row.provider + ':' + row.id
}
const overwrite = ref(false)

function open() {
  hubTab.value = 'search'
  hubQuery.value = ''
  hubResults.value = []
  hubSearched.value = false
  hubUrlInput.value = ''
  hubUrlOverwrite.value = false
  zipFiles.value = []
  zipOverwrite.value = false
  zipResults.value = []
  visible.value = true
}

function onZipFilesChange(e: Event) {
  const input = e.target as HTMLInputElement
  zipFiles.value = input.files ? Array.from(input.files) : []
  zipResults.value = []
}

async function installZips() {
  if (!zipFiles.value.length) return
  zipInstalling.value = true
  zipResults.value = []
  const ow = zipOverwrite.value ? '?overwrite=true' : ''
  let anyOk = false
  for (const file of zipFiles.value) {
    try {
      const buf = await file.arrayBuffer()
      const res = await axios.post(zipInstallUrl.value + ow, buf, {
        headers: { 'Content-Type': 'application/zip' },
      })
      const items: { name: string }[] = Array.isArray(res.data?.data) ? res.data.data : [res.data?.data ?? { name: file.name }]
      for (const item of items) {
        zipResults.value.push({ name: item.name, ok: true, msg: '安装成功' })
      }
      anyOk = true
    } catch (e: any) {
      const msg = e.response?.data?.message || e.response?.data?.error || e.message
      zipResults.value.push({ name: file.name, ok: false, msg })
    }
  }
  zipInstalling.value = false
  if (anyOk) emit('installed')
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
  <SModal v-model:visible="visible" :title="title || t('skills.hub_title')" width="xl">
    <template #toolbar>
      <STabBar v-model="hubTab" style="padding:0;border:none;background:transparent">
        <STab name="search">{{ t('skills.search_tab') }}</STab>
        <STab name="url">{{ t('skills.url_install_tab') }}</STab>
        <STab name="zip">{{ t('skills.zip_install_tab') }}</STab>
      </STabBar>
    </template>

    <div style="display:flex;flex-direction:column;height:60vh">
      <!-- Tab: URL install -->
      <template v-if="hubTab === 'url'">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <SInput
            v-model="hubUrlInput"
            :placeholder="t('skills.url_placeholder')"
            style="flex:1"
            @keydown.enter="installByUrl"
          />
          <SButton type="primary" :disabled="hubUrlInstalling || !hubUrlInput.trim()" @click="installByUrl">
            {{ hubUrlInstalling ? t('common.loading') : '安装' }}
          </SButton>
        </div>
        <SCheckCard v-model="hubUrlOverwrite">{{ t('skills.override') }}</SCheckCard>
        <div class="hub-info-panel">
          {{ t('skills.support_formats') }}<br>
          <code v-for="fmt in urlFormats" :key="fmt" style="font-family:var(--sui-font-mono);display:block">{{ fmt }}</code>
        </div>
      </template>

      <!-- Tab: ZIP install -->
      <template v-else-if="hubTab === 'zip'">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <input
            type="file"
            accept=".zip"
            multiple
            @change="onZipFilesChange"
            style="flex:1"
          />
          <SButton type="primary" :disabled="zipInstalling || !zipFiles.length" @click="installZips">
            {{ zipInstalling ? t('common.loading') : '安装' }}
          </SButton>
        </div>
        <div style="margin-bottom:12px">
          <SCheckCard v-model="zipOverwrite">{{ t('skills.override') }}</SCheckCard>
        </div>
        <div v-if="zipFiles.length && !zipResults.length" style="font-size:13px;color:var(--sui-fg-muted)">
          已选择 {{ zipFiles.length }} 个文件
        </div>
        <div v-if="zipResults.length" style="margin-top:8px">
          <div
            v-for="(r, i) in zipResults" :key="i"
            class="hub-zip-result"
            :class="r.ok ? 'ok' : 'err'"
          >
            <strong>{{ r.name }}</strong>: {{ r.msg }}
          </div>
        </div>
        <div v-if="!zipFiles.length && !zipResults.length" class="hub-info-panel">
          选择包含 SKILL.md 的 .zip 文件，支持多选批量安装
        </div>
      </template>

      <!-- Tab: Search -->
      <template v-else>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-shrink:0">
          <SInput
            v-model="hubQuery"
            :placeholder="t('skills.search_placeholder_hub')"
            style="flex:1"
            @keydown.enter="hubSearch"
          />
          <SButton type="primary" :disabled="hubSearching || !hubQuery.trim()" @click="hubSearch">
            {{ hubSearching ? t('skills.searching') : '搜索' }}
          </SButton>
        </div>
        <!-- Results area (scrollable) -->
        <div style="flex:1;overflow-y:auto;min-height:0">
          <div v-if="hubSearching" class="hub-empty-text">{{ t('skills.searching') }}</div>
          <template v-else-if="hubSearched">
            <STable
              :columns="hubColumns"
              :rows="hubResults"
              :row-key="hubRowKey"
              :empty-text="t('skills.no_search_result')"
            >
              <template #name="{ row }">
                <span style="font-family:var(--sui-font-mono)">{{ row.name || row.id }}</span>
              </template>
              <template #description="{ row }">
                <span style="color:var(--sui-fg-secondary)">{{ row.description || '-' }}</span>
              </template>
              <template #popularity="{ row }">
                <span style="font-size:var(--sui-fs-sm);color:var(--sui-fg-disabled);white-space:nowrap">
                  <template v-if="row.installs != null">{{ row.installs >= 1000 ? (row.installs / 1000).toFixed(1) + 'K' : row.installs }} installs</template>
                  <template v-else-if="row.score != null">{{ row.score.toFixed(1) }}</template>
                  <template v-else>-</template>
                </span>
              </template>
              <template #source="{ row }">
                <span :style="row.provider === 'skills.sh' ? badgeSkillssh() : badgeClawhub()">{{ row.provider === 'skills.sh' ? 'Skills.sh' : 'ClawHub' }}</span>
              </template>
              <template #link="{ row }">
                <a :href="row.sourceUrl" target="_blank" rel="noopener" class="hub-link" title="Open">&#x2197;</a>
              </template>
              <template #ops="{ row }">
                <SButton type="primary" size="sm" @click="openInstall(row)">{{ t('skills.install_title') }}</SButton>
              </template>
            </STable>
          </template>
          <div v-else class="hub-empty-text" style="padding:60px">
            输入关键词搜索 Skill Hub
          </div>
        </div>
      </template>
    </div>
  </SModal>

  <!-- Install confirm modal -->
  <SModal v-if="selected" v-model:visible="showInstall" :title="t('skills.install_title')" width="md" nested>
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="hub-install-name">{{ selected.name || selected.id }}</span>
        <span :style="selected.provider === 'skills.sh' ? badgeSkillssh() : badgeClawhub()">{{ selected.provider === 'skills.sh' ? 'Skills.sh' : 'ClawHub' }}</span>
      </div>
      <div v-if="selected.description" class="hub-install-desc">{{ selected.description }}</div>
    </div>
    <div class="hub-install-target">
      {{ t('skills.install_to') }}<code class="hub-install-code">{{ installDir }}</code>
    </div>
    <SCheckCard v-model="overwrite">{{ t('skills.override') }}</SCheckCard>

    <template #footer>
      <SButton type="outline" @click="showInstall = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" :disabled="installing" @click="confirmInstall">
        {{ installing ? t('common.loading') : t('skills.confirm_install') }}
      </SButton>
    </template>
  </SModal>
</template>

<style scoped>
.hub-info-panel {
  margin-top: var(--sui-sp-5);
  padding: var(--sui-sp-4) var(--sui-sp-5);
  background: var(--sui-bg-soft);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  line-height: 1.7;
}
.hub-zip-result {
  padding: var(--sui-sp-3) var(--sui-sp-4);
  border-radius: var(--sui-radius-md);
  margin-bottom: var(--sui-sp-2);
  font-size: var(--sui-fs-md);
}
.hub-zip-result.ok {
  background: var(--sui-success-soft);
  color: var(--sui-on-success-soft);
}
.hub-zip-result.err {
  background: var(--sui-danger-soft);
  color: var(--sui-on-danger-soft);
}
.hub-install-name {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xl);
  font-weight: 600;
  color: var(--sui-fg);
}
.hub-install-desc {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-secondary);
}
.hub-install-target {
  padding: var(--sui-sp-3) var(--sui-sp-4);
  background: var(--sui-bg-soft);
  border-radius: var(--sui-radius-md);
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-secondary);
  margin-bottom: var(--sui-sp-4);
}
.hub-install-code {
  font-family: var(--sui-font-mono);
  background: var(--sui-border);
  padding: 2px var(--sui-sp-2);
  border-radius: var(--sui-radius-xs);
}
.hub-empty-text {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: 40px;
  font-size: var(--sui-fs-md);
}
.hub-link {
  color: var(--sui-info-link);
  font-size: var(--sui-fs-sm);
}
</style>
