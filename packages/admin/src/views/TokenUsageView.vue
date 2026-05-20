<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast, SButton, SSelect, SCard, SPageToolbar, SPageContent } from 'sbot-ui'
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
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <div class="usage-date-range">
        <input type="date" v-model="startDate" class="date-input" />
        <span class="date-sep">~</span>
        <input type="date" v-model="endDate" class="date-input" />
      </div>
      <SSelect v-model="filterAgentId" size="sm" class="usage-select" @change="fetchUsage">
        <option value="">{{ t('usage.all_agents') }}</option>
        <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
      </SSelect>
      <SSelect v-model="filterModelId" size="sm" class="usage-select" @change="fetchUsage">
        <option value="">{{ t('usage.all_models') }}</option>
        <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
      </SSelect>
      <SButton type="primary" size="sm" @click="fetchUsage">{{ t('common.refresh') }}</SButton>
    </SPageToolbar>

    <SPageContent>
      <div v-if="loading" class="usage-loading">{{ t('common.loading') }}</div>
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
            <div class="summary-value summary-value-cache">{{ formatCompact(summary.cacheReadTokens) }}</div>
            <div class="summary-sub">{{ formatNumber(summary.cacheReadTokens) }}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">{{ t('usage.cache_creation') }}</div>
            <div class="summary-value">{{ formatCompact(summary.cacheCreationTokens) }}</div>
            <div class="summary-sub">{{ formatNumber(summary.cacheCreationTokens) }}</div>
          </div>
        </div>

        <!-- Chart Section -->
        <SCard v-if="dailyData.length > 0 || chartType === 'table'" class="chart-section">
          <div class="chart-header">
            <div class="chart-title">{{ t('usage.daily_chart') }}</div>
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

          <div v-if="chartType === 'bar'" class="chart-canvas-wrap">
            <Bar :data="barChartData" :options="barChartOptions" />
          </div>

          <div v-if="chartType === 'area'" class="chart-canvas-wrap">
            <Line :data="areaChartData" :options="areaChartOptions" />
          </div>

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
                  <td class="usage-table-total">{{ formatNumber(row.totalTokens) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="chart-legend">
            <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.input }"></span>{{ t('usage.input_tokens') }}</span>
            <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.output }"></span>{{ t('usage.output_tokens') }}</span>
            <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.cacheRead }"></span>{{ t('usage.cache_read') }}</span>
            <span class="legend-item"><span class="legend-dot" :style="{ background: COLORS.cacheCreation }"></span>{{ t('usage.cache_creation') }}</span>
          </div>
        </SCard>

        <div v-else class="usage-empty">
          <div class="usage-empty-icon">📊</div>
          <div class="usage-empty-text">{{ t('usage.no_data') }}</div>
        </div>
      </template>
    </SPageContent>
  </div>
</template>

<style scoped>
.usage-date-range {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  padding: 4px 10px;
  background: var(--sui-bg);
}
.date-input {
  border: none;
  outline: none;
  font-size: var(--sui-fs-md);
  font-family: inherit;
  color: var(--sui-fg);
  background: transparent;
  padding: 2px 4px;
}
.date-sep {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
.usage-select { min-width: 140px; }

.usage-loading {
  text-align: center;
  padding: 60px 0;
  color: var(--sui-fg-disabled);
}

/* Summary Cards */
.summary-cards {
  display: flex;
  gap: var(--sui-sp-4);
  margin-bottom: var(--sui-sp-6);
  flex-wrap: wrap;
}
.summary-card {
  flex: 1 1 140px;
  min-width: 130px;
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  padding: var(--sui-sp-5) var(--sui-sp-6);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
}
.summary-card-total { flex: 1 1 100%; }
.summary-label {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  margin-bottom: var(--sui-sp-2);
}
.summary-value-lg {
  font-size: 28px;
  font-weight: 700;
  color: var(--sui-fg);
  letter-spacing: -0.02em;
}
.summary-compact {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-muted);
  margin-top: 2px;
}
.summary-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--sui-fg);
}
.summary-value-cache { color: var(--sui-success); }
.summary-sub {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  margin-top: 2px;
}

/* Chart */
.chart-section { margin-bottom: var(--sui-sp-6); }
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sui-sp-3);
}
.chart-title {
  font-size: var(--sui-fs-md);
  font-weight: 600;
  color: var(--sui-fg);
}
.chart-tabs {
  display: flex;
  gap: 2px;
  background: var(--sui-bg-hover);
  border-radius: var(--sui-radius-md);
  padding: 2px;
}
.chart-tab {
  border: none;
  background: none;
  padding: 5px 14px;
  font-size: var(--sui-fs-sm);
  font-weight: 500;
  font-family: inherit;
  color: var(--sui-fg-disabled);
  border-radius: var(--sui-radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}
.chart-tab.active {
  background: var(--sui-bg);
  color: var(--sui-fg);
  box-shadow: var(--sui-shadow-sm);
}
.chart-canvas-wrap {
  height: 280px;
  margin-top: var(--sui-sp-4);
}

/* Table */
.chart-table-wrap {
  margin-top: var(--sui-sp-4);
  max-height: 400px;
  overflow-y: auto;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--sui-fs-md);
}
.usage-table th {
  text-align: right;
  padding: var(--sui-sp-3) var(--sui-sp-4);
  font-weight: 600;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
  border-bottom: 2px solid var(--sui-border);
  position: sticky;
  top: 0;
  background: var(--sui-bg);
}
.usage-table th:first-child { text-align: left; }
.usage-table td {
  text-align: right;
  padding: 7px var(--sui-sp-4);
  color: var(--sui-fg);
  border-bottom: 1px solid var(--sui-border);
  font-variant-numeric: tabular-nums;
}
.usage-table td:first-child {
  text-align: left;
  color: var(--sui-fg-muted);
}
.usage-table tbody tr:hover { background: var(--sui-bg-subtle); }
.usage-table-total { font-weight: 600; }

/* Legend */
.chart-legend {
  display: flex;
  gap: var(--sui-sp-5);
  margin-top: var(--sui-sp-4);
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
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
.usage-empty-icon {
  font-size: 32px;
  margin-bottom: var(--sui-sp-3);
}
.usage-empty-text {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
}
</style>
