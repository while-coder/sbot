<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

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
    <div class="page-toolbar">
      <span class="page-toolbar-title">{{ t('logs.title') }}</span>
      <select v-model="selectedFile" style="font-size:12px;padding:3px 8px;border:1px solid #e8e6e3;border-radius:4px;font-family:monospace">
        <option v-for="f in files" :key="f" :value="f">{{ f }}</option>
      </select>
      <select v-model="levelFilter" @change="loadContent()" style="font-size:12px;padding:3px 8px;border:1px solid #e8e6e3;border-radius:4px">
        <option value="">{{ t('logs.all_levels') }}</option>
        <option v-for="lv in levels.slice(1)" :key="lv" :value="lv">{{ lv }}</option>
      </select>
      <input v-model="keyword" @keyup.enter="loadContent()" :placeholder="t('logs.search_placeholder')"
        style="font-size:12px;padding:3px 8px;border:1px solid #e8e6e3;border-radius:4px;width:180px" />
      <select v-model.number="tailCount" @change="loadContent()" style="font-size:12px;padding:3px 8px;border:1px solid #e8e6e3;border-radius:4px">
        <option :value="200">{{ t('logs.last_n', { n: 200 }) }}</option>
        <option :value="500">{{ t('logs.last_n', { n: 500 }) }}</option>
        <option :value="1000">{{ t('logs.last_n', { n: 1000 }) }}</option>
        <option :value="0">{{ t('logs.all_lines') }}</option>
      </select>
      <button class="btn-outline btn-sm" @click="loadContent()">{{ t('common.refresh') }}</button>
      <label class="auto-refresh-toggle">
        <input type="checkbox" v-model="autoRefresh" />
        <span>{{ t('logs.auto_refresh') }}</span>
      </label>
      <select v-if="autoRefresh" v-model.number="refreshInterval" style="font-size:12px;padding:3px 8px;border:1px solid #e8e6e3;border-radius:4px">
        <option v-for="sec in intervalOptions" :key="sec" :value="sec">{{ t('logs.every_n_seconds', { n: sec }) }}</option>
      </select>
    </div>
    <div ref="logRef" class="log-viewer">
      <div v-if="loading" style="padding:20px;color:#9b9b9b;text-align:center">{{ t('common.loading') }}</div>
      <div v-else-if="!lines.length" style="padding:20px;color:#9b9b9b;text-align:center">{{ t('logs.empty') }}</div>
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
  padding: 12px 16px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
}
.log-line {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}
.auto-refresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  user-select: none;
}
.auto-refresh-toggle input { margin: 0; cursor: pointer; }
.log-error { color: #f87171; }
.log-warn { color: #fbbf24; }
.log-debug { color: #9ca3af; }

@media (max-width: 768px) {
  :deep(.page-toolbar) {
    flex-wrap: wrap;
    gap: 6px;
  }
  :deep(.page-toolbar) select,
  :deep(.page-toolbar) input {
    min-width: 0;
    flex: 1 1 calc(50% - 4px);
  }
}
</style>
