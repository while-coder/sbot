<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { store } from '@/store'

const { t } = useI18n()
const { show } = useToast()

interface DailyRow {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}
interface Summary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

const loading = ref(false)
const dailyData = ref<DailyRow[]>([])
const summary = ref<Summary>({ totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })

const today = new Date()
const thirtyDaysAgo = new Date(today)
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

const startDate = ref(fmtDate(thirtyDaysAgo))
const endDate = ref(fmtDate(today))
const filterAgentId = ref('')
const filterModelId = ref('')

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const agentOptions = computed(() =>
  Object.entries(store.settings.agents || {}).map(([id, a]: [string, any]) => ({ id, label: a.name || id }))
)
const modelOptions = computed(() =>
  Object.entries(store.settings.models || {}).map(([id, m]: [string, any]) => ({ id, label: m.name || id }))
)

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

async function fetchUsage() {
  loading.value = true
  try {
    const params = new URLSearchParams({ start: startDate.value, end: endDate.value })
    if (filterAgentId.value) params.set('agentId', filterAgentId.value)
    if (filterModelId.value) params.set('modelId', filterModelId.value)
    const res = await apiFetch(`/api/usage-stats?${params}`)
    summary.value = res.data?.summary || { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
    dailyData.value = res.data?.daily || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

const maxDaily = computed(() => Math.max(...dailyData.value.map(d => d.totalTokens), 1))

function barPercent(value: number): string {
  return `${Math.max((value / maxDaily.value) * 100, 0.5)}%`
}

function shortDate(date: string): string {
  const parts = date.split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

onMounted(fetchUsage)
</script>

<template>
  <div class="page-content">
    <div style="margin-bottom:16px">
      <span style="font-size:12px;color:#9b9b9b">{{ t('nav.group_admin') }}</span>
      <span style="font-size:12px;color:#9b9b9b;margin:0 6px">/</span>
      <span style="font-size:15px;font-weight:600">{{ t('nav.token_usage') }}</span>
    </div>

    <!-- Toolbar -->
    <div class="usage-toolbar">
      <div class="usage-date-range">
        <input type="date" v-model="startDate" class="date-input" />
        <span class="date-sep">~</span>
        <input type="date" v-model="endDate" class="date-input" />
      </div>
      <select v-model="filterAgentId" class="usage-select" @change="fetchUsage">
        <option value="">{{ t('usage.all_agents') }}</option>
        <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
      </select>
      <select v-model="filterModelId" class="usage-select" @change="fetchUsage">
        <option value="">{{ t('usage.all_models') }}</option>
        <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>
      <button class="btn-primary btn-sm" @click="fetchUsage">{{ t('common.refresh') }}</button>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px 0;color:#94a3b8">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card summary-card-total">
          <div class="summary-label">{{ t('usage.total_tokens') }}</div>
          <div class="summary-value-lg">{{ formatNumber(summary.totalTokens) }}</div>
          <div class="summary-compact">{{ formatCompact(summary.totalTokens) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">{{ t('usage.input_tokens') }}</div>
          <div class="summary-value">{{ formatCompact(summary.inputTokens) }}</div>
          <div class="summary-sub">{{ formatNumber(summary.inputTokens) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">{{ t('usage.output_tokens') }}</div>
          <div class="summary-value">{{ formatCompact(summary.outputTokens) }}</div>
          <div class="summary-sub">{{ formatNumber(summary.outputTokens) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">{{ t('usage.cache_read') }}</div>
          <div class="summary-value" style="color:#22c55e">{{ formatCompact(summary.cacheReadTokens) }}</div>
          <div class="summary-sub">{{ formatNumber(summary.cacheReadTokens) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">{{ t('usage.cache_creation') }}</div>
          <div class="summary-value">{{ formatCompact(summary.cacheCreationTokens) }}</div>
          <div class="summary-sub">{{ formatNumber(summary.cacheCreationTokens) }}</div>
        </div>
      </div>

      <!-- Bar Chart -->
      <div v-if="dailyData.length > 0" class="chart-section card">
        <div class="card-title">{{ t('usage.daily_chart') }}</div>
        <div class="chart-container">
          <div class="chart-y-axis">
            <span>{{ formatCompact(maxDaily) }}</span>
            <span>{{ formatCompact(Math.round(maxDaily * 0.5)) }}</span>
            <span>0</span>
          </div>
          <div class="chart-bars">
            <div class="chart-grid-line" style="bottom:50%"></div>
            <div class="chart-grid-line" style="bottom:100%"></div>
            <div
              v-for="row in dailyData"
              :key="row.date"
              class="bar-col"
              :title="`${row.date}\n${t('usage.total_tokens')}: ${formatNumber(row.totalTokens)}\n${t('usage.input_tokens')}: ${formatNumber(row.inputTokens)}\n${t('usage.output_tokens')}: ${formatNumber(row.outputTokens)}\n${t('usage.cache_read')}: ${formatNumber(row.cacheReadTokens)}\n${t('usage.cache_creation')}: ${formatNumber(row.cacheCreationTokens)}`"
            >
              <div class="bar-stack">
                <div class="bar-segment bar-cache-read" :style="{ height: barPercent(row.cacheReadTokens) }"></div>
                <div class="bar-segment bar-input" :style="{ height: barPercent(row.inputTokens) }"></div>
                <div class="bar-segment bar-output" :style="{ height: barPercent(row.outputTokens) }"></div>
                <div class="bar-segment bar-cache-write" :style="{ height: barPercent(row.cacheCreationTokens) }"></div>
              </div>
              <div class="bar-date">{{ shortDate(row.date) }}</div>
            </div>
          </div>
        </div>
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>{{ t('usage.input_tokens') }}</span>
          <span class="legend-item"><span class="legend-dot" style="background:#8b5cf6"></span>{{ t('usage.output_tokens') }}</span>
          <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>{{ t('usage.cache_read') }}</span>
          <span class="legend-item"><span class="legend-dot" style="background:#94a3b8"></span>{{ t('usage.cache_creation') }}</span>
        </div>
      </div>

      <div v-else class="usage-empty">
        <div style="font-size:32px;margin-bottom:8px">📊</div>
        <div style="color:#94a3b8;font-size:13px">{{ t('usage.no_data') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.usage-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.usage-date-range {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  padding: 4px 10px;
}
.date-input {
  border: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  color: #1c1c1c;
  background: transparent;
  padding: 2px 4px;
}
.date-sep {
  color: #9b9b9b;
  font-size: 13px;
}
.usage-select {
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 13px;
  font-family: inherit;
  color: #1c1c1c;
  background: #fff;
  outline: none;
  cursor: pointer;
}

/* Summary Cards */
.summary-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.summary-card {
  flex: 1 1 140px;
  min-width: 130px;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 16px 18px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.summary-card-total {
  flex: 1 1 100%;
}
.summary-label {
  font-size: 12px;
  color: #9b9b9b;
  margin-bottom: 6px;
}
.summary-value-lg {
  font-size: 28px;
  font-weight: 700;
  color: #1c1c1c;
  letter-spacing: -0.02em;
}
.summary-compact {
  font-size: 13px;
  color: #6b7280;
  margin-top: 2px;
}
.summary-value {
  font-size: 22px;
  font-weight: 700;
  color: #1c1c1c;
}
.summary-sub {
  font-size: 12px;
  color: #9b9b9b;
  margin-top: 2px;
}

/* Chart */
.chart-section {
  margin-bottom: 20px;
}
.chart-container {
  display: flex;
  gap: 0;
  height: 220px;
  margin-top: 12px;
}
.chart-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding-right: 8px;
  font-size: 11px;
  color: #9b9b9b;
  min-width: 50px;
  padding-bottom: 22px;
}
.chart-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  border-bottom: 1px solid #e8e6e3;
  border-left: 1px solid #e8e6e3;
  position: relative;
  padding-bottom: 22px;
}
.chart-grid-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed #f0efed;
  pointer-events: none;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  cursor: default;
}
.bar-stack {
  width: 70%;
  max-width: 32px;
  display: flex;
  flex-direction: column-reverse;
  align-items: stretch;
  flex: 1;
  justify-content: flex-start;
}
.bar-segment {
  min-height: 0;
  transition: height 0.3s ease;
}
.bar-input {
  background: #3b82f6;
}
.bar-output {
  background: #8b5cf6;
}
.bar-cache-read {
  background: #22c55e;
}
.bar-cache-write {
  background: #94a3b8;
}
.bar-segment:first-child {
  border-radius: 0 0 2px 2px;
}
.bar-segment:last-child {
  border-radius: 2px 2px 0 0;
}
.bar-date {
  font-size: 10px;
  color: #9b9b9b;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* Legend */
.chart-legend {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}

/* Empty */
.usage-empty {
  text-align: center;
  padding: 80px 0;
}
</style>
