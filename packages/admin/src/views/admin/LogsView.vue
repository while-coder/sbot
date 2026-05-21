<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, SButton, SSelect, SInput, SPageToolbar } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()

const files = ref<string[]>([])
const selectedFile = ref('')
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

const levels = ['', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const intervalOptions = [3, 5, 10, 30]

async function loadFiles() {
  try {
    const res = await apiFetch('/api/logs')
    files.value = res.data || []
    if (files.value.length && !selectedFile.value) {
      selectedFile.value = files.value[0]
    }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function loadContent() {
  if (!selectedFile.value) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (tailCount.value > 0) params.set('tail', String(tailCount.value))
    if (levelFilter.value) params.set('level', levelFilter.value)
    if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
    const qs = params.toString()
    const res = await apiFetch(`/api/logs/${selectedFile.value}${qs ? '?' + qs : ''}`)
    lines.value = res.data?.lines || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
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

watch(selectedFile, () => loadContent())

onMounted(async () => {
  await loadFiles()
  if (selectedFile.value) loadContent()
})

onUnmounted(() => stopAutoRefresh())
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar :title="t('logs.title')">
      <SSelect v-model="selectedFile" size="sm" class="logs-file-select">
        <option v-for="f in files" :key="f" :value="f">{{ f }}</option>
      </SSelect>
      <SSelect v-model="levelFilter" size="sm" @change="loadContent()">
        <option value="">{{ t('logs.all_levels') }}</option>
        <option v-for="lv in levels.slice(1)" :key="lv" :value="lv">{{ lv }}</option>
      </SSelect>
      <SInput v-model="keyword" size="sm" :placeholder="t('logs.search_placeholder')" class="logs-keyword" @keyup.enter="loadContent()" />
      <SSelect v-model.number="tailCount" size="sm" @change="loadContent()">
        <option :value="200">{{ t('logs.last_n', { n: 200 }) }}</option>
        <option :value="500">{{ t('logs.last_n', { n: 500 }) }}</option>
        <option :value="1000">{{ t('logs.last_n', { n: 1000 }) }}</option>
        <option :value="0">{{ t('logs.all_lines') }}</option>
      </SSelect>
      <SButton type="outline" size="sm" @click="loadContent()">{{ t('common.refresh') }}</SButton>
      <label class="auto-refresh-toggle">
        <input type="checkbox" v-model="autoRefresh" />
        <span>{{ t('logs.auto_refresh') }}</span>
      </label>
      <SSelect v-if="autoRefresh" v-model.number="refreshInterval" size="sm">
        <option v-for="sec in intervalOptions" :key="sec" :value="sec">{{ t('logs.every_n_seconds', { n: sec }) }}</option>
      </SSelect>
    </SPageToolbar>
    <div ref="logRef" class="log-viewer">
      <div v-if="loading" class="log-empty">{{ t('common.loading') }}</div>
      <div v-else-if="!lines.length" class="log-empty">{{ t('logs.empty') }}</div>
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
  .logs-keyword { flex: 1 1 calc(50% - 4px); width: auto; }
}
</style>
