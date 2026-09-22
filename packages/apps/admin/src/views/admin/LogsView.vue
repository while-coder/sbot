<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { SButton, SSelect, SInput, SPageToolbar, STabBar, SNavTab, toast } from '@sbot/ui-kit'

const { t } = useI18n()

type LogTab = 'normal' | 'lifecycle'

const files = ref<string[]>([])
const activeTab = ref<LogTab>('normal')
const selectedNormalFile = ref('')
const lines = ref<string[]>([])
const loading = ref(false)
const levelFilter = ref('')
const keyword = ref('')
const tailCount = ref(500)
const autoScroll = ref(true)
const autoRefresh = ref(false)
const refreshInterval = ref(3)

const logRef = ref<HTMLElement | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null
let loadSequence = 0

const levels = ['', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const intervalOptions = [3, 5, 10, 30]
const intervalSelectOptions = computed(() => intervalOptions.map(sec => ({ value: sec, label: t('logs.every_n_seconds', { n: sec }) })))
const normalFileOptions = computed(() => normalFiles.value.map(f => ({ value: f, label: f })))
const levelFilterOptions = computed(() => [
  { value: '', label: t('logs.all_levels') },
  ...levels.slice(1).map(lv => ({ value: lv, label: lv })),
])
const tailCountOptions = computed(() => [
  { value: 200, label: t('logs.last_n', { n: 200 }) },
  { value: 500, label: t('logs.last_n', { n: 500 }) },
  { value: 1000, label: t('logs.last_n', { n: 1000 }) },
  { value: 0, label: t('logs.all_lines') },
])
const lifecycleLogFile = 'process.log'
const normalFiles = computed(() => files.value.filter(file => file !== lifecycleLogFile))
const hasLifecycleLog = computed(() => files.value.includes(lifecycleLogFile))
const isLifecycleLog = computed(() => activeTab.value === 'lifecycle')
const selectedFile = computed(() => {
  if (isLifecycleLog.value) return hasLifecycleLog.value ? lifecycleLogFile : ''
  return selectedNormalFile.value
})
const emptyText = computed(() => isLifecycleLog.value ? t('logs.lifecycle_empty') : t('logs.empty'))

async function loadFiles() {
  try {
    const res = await apiFetch('/api/logs')
    files.value = res.data || []
    if (!normalFiles.value.includes(selectedNormalFile.value)) {
      selectedNormalFile.value = normalFiles.value[0] || ''
    }
    if (!normalFiles.value.length && hasLifecycleLog.value) {
      activeTab.value = 'lifecycle'
    }
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

async function loadContent() {
  const sequence = ++loadSequence
  const filename = selectedFile.value
  if (!filename) {
    lines.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (tailCount.value > 0) params.set('tail', String(tailCount.value))
    if (levelFilter.value) params.set('level', levelFilter.value)
    if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
    const qs = params.toString()
    const res = await apiFetch(`/api/logs/${encodeURIComponent(filename)}${qs ? '?' + qs : ''}`)
    if (sequence !== loadSequence) return
    lines.value = res.data?.lines || []
  } catch (e: any) {
    if (sequence === loadSequence) toast.show('error', e.message)
  } finally {
    if (sequence !== loadSequence) return
    loading.value = false
    if (autoScroll.value) {
      await nextTick()
      scrollToBottom()
    }
  }
}

function scrollToBottom() {
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
}

function downloadFile() {
  if (!selectedFile.value) return
  const a = document.createElement('a')
  a.href = `/api/logs/${encodeURIComponent(selectedFile.value)}/download`
  a.download = selectedFile.value
  a.click()
}

function lineClass(line: string): string {
  if (line.includes('[ERROR]')) return 'log-error'
  if (line.includes('[WARN]')) return 'log-warn'
  if (line.includes('[DEBUG]')) return 'log-debug'
  return ''
}

function startAutoRefresh() {
  stopAutoRefresh()
  if (autoRefresh.value) {
    refreshTimer = setInterval(() => loadContent(), refreshInterval.value * 1000)
  }
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

watch(autoRefresh, (val) => {
  if (val) startAutoRefresh()
  else stopAutoRefresh()
})

watch(refreshInterval, () => {
  if (autoRefresh.value) startAutoRefresh()
})

watch([activeTab, selectedNormalFile], () => loadContent())

onMounted(async () => {
  await loadFiles()
  if (!selectedFile.value) loadContent()
})

onUnmounted(() => stopAutoRefresh())
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar :title="t('logs.title')">
      <template #actions>
        <SButton type="outline" size="sm" :loading="loading" :disabled="!selectedFile" @click="loadContent()">{{ t('common.refresh') }}</SButton>
        <SButton type="outline" size="sm" :disabled="!selectedFile" @click="downloadFile()">{{ t('logs.download') }}</SButton>
        <label class="auto-refresh-toggle">
          <input v-model="autoRefresh" type="checkbox" />
          <span>{{ t('logs.auto_refresh') }}</span>
        </label>
        <SSelect v-if="autoRefresh" v-model:value.number="refreshInterval" size="sm" :options="intervalSelectOptions" />
      </template>
    </SPageToolbar>
    <STabBar v-model:active="activeTab" class="logs-tab-bar">
      <SNavTab name="normal" :count="normalFiles.length">{{ t('logs.normal') }}</SNavTab>
      <SNavTab name="lifecycle" :count="hasLifecycleLog ? 1 : 0">{{ t('logs.lifecycle') }}</SNavTab>
      <div class="logs-inline-filters">
        <SSelect v-if="!isLifecycleLog" v-model:value="selectedNormalFile" size="sm" class="logs-file-select" :options="normalFileOptions" />
        <span v-else class="logs-current-file">{{ t('logs.lifecycle_file') }}</span>
        <SSelect v-model:value="levelFilter" size="sm" :options="levelFilterOptions" @change="loadContent()" />
        <SInput v-model:value="keyword" size="sm" :placeholder="t('logs.search_placeholder')" class="logs-keyword" @keyup.enter="loadContent()" />
        <SSelect v-model:value.number="tailCount" size="sm" :options="tailCountOptions" @change="loadContent()" />
      </div>
    </STabBar>
    <div ref="logRef" class="log-viewer">
      <div v-if="loading" class="log-empty">{{ t('common.loading') }}</div>
      <div v-else-if="!lines.length" class="log-empty">{{ emptyText }}</div>
      <template v-else>
        <div v-for="(line, i) in lines" :key="i" class="log-line" :class="lineClass(line)">{{ line }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.log-viewer {
  flex: 1;
  overflow-y: auto;
  background: #1c1c1c;
  padding: var(--sui-sp-5) var(--sui-sp-7);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  line-height: 1.6;
}
.log-line {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-empty {
  padding: var(--sui-sp-8);
  color: var(--sui-fg-disabled);
  text-align: center;
}
.logs-file-select :deep(select) { font-family: var(--sui-font-mono); }
.logs-keyword { width: 180px; }
.logs-tab-bar {
  overflow-x: auto;
  overflow-y: hidden;
}
.logs-inline-filters {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  margin-left: auto;
  padding-left: var(--sui-sp-5);
  white-space: nowrap;
  flex-shrink: 0;
}
.logs-current-file {
  min-width: 180px;
  color: var(--sui-fg-muted);
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
}
.auto-refresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-1);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  cursor: pointer;
  user-select: none;
}
.auto-refresh-toggle input { margin: 0; cursor: pointer; }
.log-error { color: #f87171; }
.log-warn { color: #fbbf24; }
.log-debug { color: #9ca3af; }

@media (max-width: 768px) {
  .logs-keyword { width: 150px; }
}
</style>
