<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { store } from '@/store'
import { Bar, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, PointElement, LineElement,
  Tooltip, Legend, Filler,
} from 'chart.js'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, PointElement, LineElement,
  Tooltip, Legend, Filler,
)

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
const chartType = ref<'bar' | 'area' | 'table'>('bar')

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

const COLORS = {
  input: '#3b82f6',
  output: '#8b5cf6',
  cacheRead: '#22c55e',
  cacheCreation: '#94a3b8',
}

function shortDate(date: string): string {
  const parts = date.split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

const chartLabels = computed(() => dailyData.value.map(d => shortDate(d.date)))

const barChartData = computed(() => ({
  labels: chartLabels.value,
  datasets: [
    { label: t('usage.cache_read'), data: dailyData.value.map(d => d.cacheReadTokens), backgroundColor: COLORS.cacheRead },
    { label: t('usage.cache_creation'), data: dailyData.value.map(d => d.cacheCreationTokens), backgroundColor: COLORS.cacheCreation },
    { label: t('usage.input_tokens'), data: dailyData.value.map(d => Math.max(0, d.inputTokens - d.cacheReadTokens - d.cacheCreationTokens)), backgroundColor: COLORS.input },
    { label: t('usage.output_tokens'), data: dailyData.value.map(d => d.outputTokens), backgroundColor: COLORS.output },
  ],
}))

const barChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      reverse: true,
      callbacks: {
        afterTitle: (items: any[]) => {
          const idx = items[0]?.dataIndex
          if (idx != null) return `${t('usage.total_tokens')}: ${formatNumber(dailyData.value[idx]?.totalTokens ?? 0)}`
          return ''
        },
        label: (ctx: any) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`,
      },
    },
  },
  scales: {
    x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, color: '#9b9b9b' } },
    y: {
      stacked: true,
      grid: { color: '#f0efed' },
      ticks: { font: { size: 11 }, color: '#9b9b9b', callback: (v: string | number) => formatCompact(Number(v)) },
    },
  },
}))

const areaChartData = computed(() => ({
  labels: chartLabels.value,
  datasets: [
    { label: t('usage.cache_read'), data: dailyData.value.map(d => d.cacheReadTokens), borderColor: COLORS.cacheRead, backgroundColor: COLORS.cacheRead + '40', tension: 0.3, pointRadius: 0, fill: true },
    { label: t('usage.cache_creation'), data: dailyData.value.map(d => d.cacheCreationTokens), borderColor: COLORS.cacheCreation, backgroundColor: COLORS.cacheCreation + '40', tension: 0.3, pointRadius: 0, fill: true },
    { label: t('usage.input_tokens'), data: dailyData.value.map(d => Math.max(0, d.inputTokens - d.cacheReadTokens - d.cacheCreationTokens)), borderColor: COLORS.input, backgroundColor: COLORS.input + '40', tension: 0.3, pointRadius: 0, fill: true },
    { label: t('usage.output_tokens'), data: dailyData.value.map(d => d.outputTokens), borderColor: COLORS.output, backgroundColor: COLORS.output + '40', tension: 0.3, pointRadius: 0, fill: true },
  ],
}))

const areaChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      reverse: true,
      callbacks: {
        afterTitle: (items: any[]) => {
          const idx = items[0]?.dataIndex
          if (idx != null) return `${t('usage.total_tokens')}: ${formatNumber(dailyData.value[idx]?.totalTokens ?? 0)}`
          return ''
        },
        label: (ctx: any) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`,
      },
    },
  },
  scales: {
    x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, color: '#9b9b9b' } },
    y: {
      stacked: true,
      grid: { color: '#f0efed' },
      ticks: { font: { size: 11 }, color: '#9b9b9b', callback: (v: string | number) => formatCompact(Number(v)) },
    },
  },
}))

const chartTabs = [
  { key: 'bar' as const, label: () => t('usage.chart_bar') },
  { key: 'area' as const, label: () => t('usage.chart_area') },
  { key: 'table' as const, label: () => t('usage.chart_table') },
]

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

      <!-- Chart Section -->
      <div v-if="dailyData.length > 0 || chartType === 'table'" class="chart-section card">
        <div class="chart-header">
          <div class="card-title">{{ t('usage.daily_chart') }}</div>
          <div class="chart-tabs">
            <button
              v-for="tab in chartTabs"
              :key="tab.key"
              class="chart-tab"
              :class="{ active: chartType === tab.key }"
              @click="chartType = tab.key"
            >{{ tab.label() }}</button>
          </div>
        </div>

        <!-- Bar Chart -->
        <div v-if="chartType === 'bar'" class="chart-canvas-wrap">
          <Bar :data="barChartData" :options="barChartOptions" />
        </div>

        <!-- Area Chart -->
        <div v-if="chartType === 'area'" class="chart-canvas-wrap">
          <Line :data="areaChartData" :options="areaChartOptions" />
        </div>

        <!-- Table -->
        <div v-if="chartType === 'table'" class="chart-table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>{{ t('usage.date') }}</th>
                <th>{{ t('usage.input_tokens') }}</th>
                <th>{{ t('usage.output_tokens') }}</th>
                <th>{{ t('usage.cache_read') }}</th>
                <th>{{ t('usage.cache_creation') }}</th>
                <th>{{ t('usage.total_tokens') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in dailyData" :key="row.date">
                <td>{{ row.date }}</td>
                <td>{{ formatNumber(row.inputTokens) }}</td>
                <td>{{ formatNumber(row.outputTokens) }}</td>
                <td>{{ formatNumber(row.cacheReadTokens) }}</td>
                <td>{{ formatNumber(row.cacheCreationTokens) }}</td>
                <td style="font-weight:600">{{ formatNumber(row.totalTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Legend -->
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.input }"></span>{{ t('usage.input_tokens') }}</span>
          <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.output }"></span>{{ t('usage.output_tokens') }}</span>
          <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.cacheRead }"></span>{{ t('usage.cache_read') }}</span>
          <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.cacheCreation }"></span>{{ t('usage.cache_creation') }}</span>
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
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.chart-tabs {
  display: flex;
  gap: 2px;
  background: #f5f4f2;
  border-radius: 6px;
  padding: 2px;
}
.chart-tab {
  border: none;
  background: none;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: #9b9b9b;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.chart-tab.active {
  background: #fff;
  color: #1c1c1c;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.chart-canvas-wrap {
  height: 280px;
  margin-top: 12px;
}
/* Table */
.chart-table-wrap {
  margin-top: 12px;
  max-height: 400px;
  overflow-y: auto;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.usage-table th {
  text-align: right;
  padding: 8px 12px;
  font-weight: 600;
  color: #6b7280;
  font-size: 12px;
  border-bottom: 2px solid #e8e6e3;
  position: sticky;
  top: 0;
  background: #fff;
}
.usage-table th:first-child {
  text-align: left;
}
.usage-table td {
  text-align: right;
  padding: 7px 12px;
  color: #1c1c1c;
  border-bottom: 1px solid #f0efed;
  font-variant-numeric: tabular-nums;
}
.usage-table td:first-child {
  text-align: left;
  color: #6b7280;
}
.usage-table tbody tr:hover {
  background: #fafaf9;
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
