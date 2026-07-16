<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import {
  useToast,
  SButton,
  SSelect,
  SCard,
  SPageToolbar,
  SPageContent,
  STable,
  type STableColumn,
} from 'sbot-ui'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
)

const { t } = useI18n()
const { show } = useToast()

type Granularity = 'daily' | 'hourly'
type ChartType = 'bar' | 'line' | 'table'

interface TrendRow {
  date?: string
  hour?: string
  startMs?: number
  endMs?: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  calls: number
}

interface Summary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  calls: number
}

interface BreakdownRow extends Summary {
  key: string
  label: string
}

interface Dashboard {
  summary: Summary
  byModel: BreakdownRow[]
  byAgent: BreakdownRow[]
  byProvider: BreakdownRow[]
  byChannel: BreakdownRow[]
}

interface UsageLog extends Omit<Summary, 'calls'> {
  id: number
  timestamp: number
  agentName: string
  modelName: string
  provider: string
  channelId: string
  sessionId: number
  profileId: number
}

interface FilterOption {
  id: string
  label: string
}

interface FilterOptions {
  agents: FilterOption[]
  models: FilterOption[]
  providers: string[]
  channels: FilterOption[]
}

interface AppliedFilters {
  startDate: string
  endDate: string
  agentId: string
  modelId: string
  provider: string
  channelId: string
  granularity: Granularity
}

interface TimeRangeMs {
  startMs: number
  endMs: number
}

interface SelectedBucket extends TimeRangeMs {
  key: string
  label: string
  index: number
  row: TrendRow
}

const EMPTY_SUMMARY: Summary = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  calls: 0,
}

const EMPTY_DASHBOARD: Dashboard = {
  summary: { ...EMPTY_SUMMARY },
  byModel: [],
  byAgent: [],
  byProvider: [],
  byChannel: [],
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function initialRange(): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 2)
  return { startDate: formatDate(start), endDate: formatDate(end) }
}

const initial = initialRange()
const startDate = ref(initial.startDate)
const endDate = ref(initial.endDate)
const agentId = ref('')
const modelId = ref('')
const provider = ref('')
const channelId = ref('')
const granularity = ref<Granularity>('daily')
const activePreset = ref('3')

const loading = ref(false)
const detailLoading = ref(false)
const logsLoading = ref(false)
const dashboard = ref<Dashboard>({ ...EMPTY_DASHBOARD })
const detailDashboard = ref<Dashboard>({ ...EMPTY_DASHBOARD })
const trendRows = ref<TrendRow[]>([])
const filterOptions = ref<FilterOptions>({ agents: [], models: [], providers: [], channels: [] })
const logRows = ref<UsageLog[]>([])
const logTotal = ref(0)
const logPage = ref(0)
const pageSize = ref(50)

const chartType = ref<ChartType>('bar')
const selectedBucket = ref<SelectedBucket | null>(null)
const appliedFilters = ref<AppliedFilters>({
  startDate: initial.startDate,
  endDate: initial.endDate,
  agentId: '',
  modelId: '',
  provider: '',
  channelId: '',
  granularity: 'daily',
})

let querySequence = 0
let detailSequence = 0
let logSequence = 0

function updatePreset(days: number) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  startDate.value = formatDate(start)
  endDate.value = formatDate(end)
  activePreset.value = String(days)
}

async function setPreset(days: number) {
  updatePreset(days)
  await runQuery()
}

function markCustomRange() {
  activePreset.value = ''
}

async function onDateChange() {
  markCustomRange()
  await runQuery()
}

async function resetFilters() {
  updatePreset(3)
  agentId.value = ''
  modelId.value = ''
  provider.value = ''
  channelId.value = ''
  granularity.value = 'daily'
  await runQuery()
}

function currentFilters(): AppliedFilters {
  return {
    startDate: startDate.value,
    endDate: endDate.value,
    agentId: agentId.value,
    modelId: modelId.value,
    provider: provider.value,
    channelId: channelId.value,
    granularity: granularity.value,
  }
}

function rangeMs(filters: AppliedFilters): TimeRangeMs {
  return {
    startMs: new Date(`${filters.startDate}T00:00:00`).getTime(),
    endMs: new Date(`${filters.endDate}T00:00:00`).getTime() + 24 * 3600_000,
  }
}

function queryParams(filters: AppliedFilters, overrideRange?: TimeRangeMs): URLSearchParams {
  const { startMs, endMs } = overrideRange ?? rangeMs(filters)
  const params = new URLSearchParams({ start: String(startMs), end: String(endMs) })
  if (filters.agentId) params.set('agentId', filters.agentId)
  if (filters.modelId) params.set('modelId', filters.modelId)
  if (filters.provider) params.set('provider', filters.provider)
  if (filters.channelId) params.set('channelId', filters.channelId)
  params.set('granularity', filters.granularity)
  return params
}

function validateFilters(filters: AppliedFilters): boolean {
  if (!filters.startDate || !filters.endDate || filters.startDate > filters.endDate) {
    show(t('usage.invalid_range'), 'error')
    return false
  }
  return true
}

function normalizeFilterOptions(data: any): FilterOptions {
  return {
    agents: Array.isArray(data?.agents) ? data.agents : [],
    models: Array.isArray(data?.models) ? data.models : [],
    providers: Array.isArray(data?.providers) ? data.providers : [],
    channels: Array.isArray(data?.channels)
      ? data.channels.map((channel: string | FilterOption) => typeof channel === 'string'
        ? { id: channel, label: '' }
        : channel)
      : [],
  }
}

async function runQuery() {
  const filters = currentFilters()
  if (!validateFilters(filters)) return

  const sequence = ++querySequence
  ++detailSequence
  ++logSequence
  selectedBucket.value = null
  detailLoading.value = false
  const params = queryParams(filters)
  const logParams = new URLSearchParams(params)
  logParams.set('limit', String(pageSize.value))
  logParams.set('offset', '0')

  loading.value = true
  logsLoading.value = true
  try {
    const [overviewRes, logsRes] = await Promise.all([
      apiFetch(`/api/usage-overview?${params}`),
      apiFetch(`/api/usage-logs?${logParams}`),
    ])
    if (sequence !== querySequence) return

    dashboard.value = overviewRes.data ?? { ...EMPTY_DASHBOARD }
    detailDashboard.value = dashboard.value
    trendRows.value = overviewRes.data?.trend ?? []
    filterOptions.value = normalizeFilterOptions(overviewRes.data?.filterOptions)
    logRows.value = logsRes.data?.rows ?? []
    logTotal.value = logsRes.data?.total ?? 0
    logPage.value = 0
    appliedFilters.value = filters
  } catch (error: any) {
    if (sequence === querySequence) show(error?.message || t('usage.query_failed'), 'error')
  } finally {
    if (sequence === querySequence) {
      loading.value = false
      logsLoading.value = false
    }
  }
}

async function loadLogPage(page: number) {
  const totalPages = Math.max(1, Math.ceil(logTotal.value / pageSize.value))
  if (page < 0 || page >= totalPages) return

  const sequence = ++logSequence
  const params = queryParams(appliedFilters.value, selectedBucket.value ?? undefined)
  params.set('limit', String(pageSize.value))
  params.set('offset', String(page * pageSize.value))
  logsLoading.value = true
  try {
    const res = await apiFetch(`/api/usage-logs?${params}`)
    if (sequence !== logSequence) return
    logRows.value = res.data?.rows ?? []
    logTotal.value = res.data?.total ?? 0
    logPage.value = page
  } catch (error: any) {
    if (sequence === logSequence) show(error?.message || t('usage.query_failed'), 'error')
  } finally {
    if (sequence === logSequence) logsLoading.value = false
  }
}

function onPageSizeChange(value: string | number) {
  pageSize.value = Number(value)
  loadLogPage(0)
}

function bucketForRow(row: TrendRow, index: number): SelectedBucket {
  if (appliedFilters.value.granularity === 'hourly') {
    const hour = String(row.hour)
    const startMs = row.startMs ?? new Date(`${hour}:00:00`).getTime()
    return {
      key: hour,
      label: `${hour.replace('T', ' ')}:00–${hour.slice(11)}:59`,
      startMs,
      endMs: row.endMs ?? startMs + 3600_000,
      index,
      row,
    }
  }

  const date = String(row.date)
  const startMs = row.startMs ?? new Date(`${date}T00:00:00`).getTime()
  return { key: date, label: date, startMs, endMs: row.endMs ?? startMs + 24 * 3600_000, index, row }
}

async function selectTrendBucket(index: number) {
  const row = trendRows.value[index]
  if (!row) return

  const bucket = bucketForRow(row, index)
  if (selectedBucket.value?.key === bucket.key) return

  const sequence = ++detailSequence
  ++logSequence
  selectedBucket.value = bucket
  detailDashboard.value = { ...EMPTY_DASHBOARD }
  logRows.value = []
  logTotal.value = 0
  logPage.value = 0
  detailLoading.value = true
  logsLoading.value = true

  const params = queryParams(appliedFilters.value, bucket)
  const logParams = new URLSearchParams(params)
  logParams.set('limit', String(pageSize.value))
  logParams.set('offset', '0')
  try {
    const [overviewRes, logsRes] = await Promise.all([
      apiFetch(`/api/usage-overview?${params}`),
      apiFetch(`/api/usage-logs?${logParams}`),
    ])
    if (sequence !== detailSequence) return
    detailDashboard.value = overviewRes.data ?? { ...EMPTY_DASHBOARD }
    logRows.value = logsRes.data?.rows ?? []
    logTotal.value = logsRes.data?.total ?? 0
  } catch (error: any) {
    if (sequence === detailSequence) show(error?.message || t('usage.query_failed'), 'error')
  } finally {
    if (sequence === detailSequence) {
      detailLoading.value = false
      logsLoading.value = false
    }
  }
}

function clearTrendSelection() {
  ++detailSequence
  ++logSequence
  selectedBucket.value = null
  detailDashboard.value = dashboard.value
  logPage.value = 0
  loadLogPage(0)
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString()
}

function formatCompact(value: number): string {
  const n = Number(value || 0)
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatTime(timestamp: number): string {
  const d = new Date(Number(timestamp))
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function channelName(id: string): string {
  const configuredName = (store.settings.channels as Record<string, { name?: string }> | undefined)?.[id]?.name
  if (configuredName) return configuredName

  const option = (filterOptions.value.channels as unknown as Array<string | FilterOption>)
    .find(item => (typeof item === 'string' ? item : item.id) === id)
  const optionLabel = typeof option === 'string' ? '' : option?.label
  return optionLabel && optionLabel !== id ? optionLabel : t('usage.unknown_channel_with_id', { id })
}

function trendLabel(row: TrendRow): string {
  if (appliedFilters.value.granularity === 'hourly') {
    const [date, hour] = String(row.hour || '').split('T')
    return `${date?.slice(5)} ${hour}:00`
  }
  return String(row.date || '').slice(5)
}

const summary = computed(() => dashboard.value.summary ?? EMPTY_SUMMARY)
const channelOptions = computed<FilterOption[]>(() => {
  const ids = new Set<string>()
  for (const item of filterOptions.value.channels as unknown as Array<string | FilterOption>) {
    const id = typeof item === 'string' ? item : item.id
    if (id) ids.add(id)
  }
  for (const row of dashboard.value.byChannel) {
    if (row.key) ids.add(row.key)
  }
  return Array.from(ids, id => ({ id, label: channelName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
const detailSummary = computed(() => detailDashboard.value.summary ?? EMPTY_SUMMARY)
const averagePerCall = computed(() => summary.value.calls ? summary.value.totalTokens / summary.value.calls : 0)
const cacheHitRate = computed(() => {
  const inputSide = summary.value.inputTokens + summary.value.cacheReadTokens + summary.value.cacheCreationTokens
  return inputSide ? summary.value.cacheReadTokens / inputSide * 100 : 0
})
const totalPages = computed(() => Math.max(1, Math.ceil(logTotal.value / pageSize.value)))

const COLORS = {
  input: '#3b82f6',
  output: '#8b5cf6',
  cacheRead: '#22c55e',
  cacheCreation: '#94a3b8',
}

function bucketColors(color: string): string[] {
  return trendRows.value.map((_, index) => !selectedBucket.value || selectedBucket.value.index === index ? color : `${color}38`)
}

const trendChartData = computed(() => ({
  labels: trendRows.value.map(trendLabel),
  datasets: [
    {
      label: t('usage.cache_read'),
      data: trendRows.value.map(row => row.cacheReadTokens),
      backgroundColor: bucketColors(COLORS.cacheRead),
      borderColor: COLORS.cacheRead,
      fill: chartType.value === 'line',
      tension: 0.25,
    },
    {
      label: t('usage.cache_creation'),
      data: trendRows.value.map(row => row.cacheCreationTokens),
      backgroundColor: bucketColors(COLORS.cacheCreation),
      borderColor: COLORS.cacheCreation,
      fill: chartType.value === 'line',
      tension: 0.25,
    },
    {
      label: t('usage.uncached_input'),
      data: trendRows.value.map(row => Math.max(0, row.inputTokens - row.cacheReadTokens - row.cacheCreationTokens)),
      backgroundColor: bucketColors(COLORS.input),
      borderColor: COLORS.input,
      fill: chartType.value === 'line',
      tension: 0.25,
    },
    {
      label: t('usage.output_tokens'),
      data: trendRows.value.map(row => row.outputTokens),
      backgroundColor: bucketColors(COLORS.output),
      borderColor: COLORS.output,
      fill: chartType.value === 'line',
      tension: 0.25,
    },
  ],
}))

const trendChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  onClick: (_event: any, elements: any[]) => {
    const index = elements[0]?.index
    if (index !== undefined) selectTrendBucket(index)
  },
  onHover: (event: any, elements: any[]) => {
    const target = event.native?.target as HTMLElement | undefined
    if (target) target.style.cursor = elements.length ? 'pointer' : 'default'
  },
  plugins: {
    legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, usePointStyle: true } },
    tooltip: {
      callbacks: {
        afterTitle: (items: any[]) => {
          const row = trendRows.value[items[0]?.dataIndex]
          return row ? `${t('usage.total_tokens')}: ${formatNumber(row.totalTokens)}` : ''
        },
        afterBody: (items: any[]) => {
          const row = trendRows.value[items[0]?.dataIndex]
          if (!row) return ''
          const avg = row.calls ? row.totalTokens / row.calls : 0
          return `${t('usage.calls')}: ${formatNumber(row.calls)}\n${t('usage.avg_per_call')}: ${formatNumber(Math.round(avg))}`
        },
      },
    },
  },
  scales: {
    x: { stacked: chartType.value === 'bar', grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
    y: { stacked: chartType.value === 'bar', beginAtZero: true, ticks: { callback: (value: string | number) => formatCompact(Number(value)) } },
  },
}))

const dimensionSections = computed(() => [
  { kind: 'model', label: t('usage.dimension_model'), rows: detailDashboard.value.byModel },
  { kind: 'agent', label: t('usage.dimension_agent'), rows: detailDashboard.value.byAgent },
  { kind: 'provider', label: t('usage.dimension_provider'), rows: detailDashboard.value.byProvider },
  { kind: 'channel', label: t('usage.dimension_channel'), rows: detailDashboard.value.byChannel },
].map(group => ({
  key: group.kind,
  label: group.label,
  rows: group.rows.map((row, index) => ({
    id: `${group.kind}:${row.key}`,
    rank: index + 1,
    name: group.kind === 'channel' ? channelName(row.key) : (row.label || row.key || '—'),
    calls: formatNumber(row.calls),
    inputTokens: formatNumber(row.inputTokens),
    outputTokens: formatNumber(row.outputTokens),
    cacheReadTokens: formatNumber(row.cacheReadTokens),
    cacheCreationTokens: formatNumber(row.cacheCreationTokens),
    totalTokens: formatNumber(row.totalTokens),
    share: detailSummary.value.totalTokens ? `${(row.totalTokens / detailSummary.value.totalTokens * 100).toFixed(1)}%` : '0.0%',
    average: formatNumber(row.calls ? Math.round(row.totalTokens / row.calls) : 0),
  })),
})))

const dimensionColumns = computed<STableColumn[]>(() => [
  { key: 'rank', label: '#', width: '48px', align: 'right' },
  { key: 'name', label: t('usage.name'), primary: true, ellipsis: true },
  { key: 'calls', label: t('usage.calls'), align: 'right' },
  { key: 'inputTokens', label: t('usage.input_tokens'), align: 'right' },
  { key: 'outputTokens', label: t('usage.output_tokens'), align: 'right' },
  { key: 'cacheReadTokens', label: t('usage.cache_read'), align: 'right' },
  { key: 'cacheCreationTokens', label: t('usage.cache_creation'), align: 'right' },
  { key: 'totalTokens', label: t('usage.total_tokens'), align: 'right' },
  { key: 'share', label: t('usage.share'), align: 'right' },
  { key: 'average', label: t('usage.avg_per_call'), align: 'right' },
])

const logDisplayRows = computed(() => logRows.value.map(row => ({
  id: row.id,
  time: formatTime(row.timestamp),
  agentName: row.agentName || '—',
  modelName: row.modelName || '—',
  provider: row.provider || '—',
  channelId: channelName(row.channelId),
  sessionId: String(row.sessionId || 0),
  profileId: String(row.profileId || 0),
  inputTokens: formatNumber(row.inputTokens),
  outputTokens: formatNumber(row.outputTokens),
  cacheReadTokens: formatNumber(row.cacheReadTokens),
  cacheCreationTokens: formatNumber(row.cacheCreationTokens),
  totalTokens: formatNumber(row.totalTokens),
})))

const logColumns = computed<STableColumn[]>(() => [
  { key: 'time', label: t('usage.column_time'), primary: true, width: '165px' },
  { key: 'agentName', label: t('usage.agent'), ellipsis: true },
  { key: 'modelName', label: t('usage.model'), ellipsis: true },
  { key: 'provider', label: t('usage.provider'), ellipsis: true },
  { key: 'channelId', label: t('usage.channel'), ellipsis: true },
  { key: 'sessionId', label: t('usage.session_id'), align: 'right' },
  { key: 'profileId', label: t('usage.profile_id'), align: 'right' },
  { key: 'inputTokens', label: t('usage.input_tokens'), align: 'right' },
  { key: 'outputTokens', label: t('usage.output_tokens'), align: 'right' },
  { key: 'cacheReadTokens', label: t('usage.cache_read'), align: 'right' },
  { key: 'cacheCreationTokens', label: t('usage.cache_creation'), align: 'right' },
  { key: 'totalTokens', label: t('usage.total_tokens'), align: 'right' },
])

onMounted(runQuery)
</script>

<template>
  <div class="usage-page">
    <SPageToolbar>
      <div class="query-panel">
        <div class="query-row">
          <div class="preset-group">
            <button
              v-for="days in [1, 3, 7, 30, 90]"
              :key="days"
              type="button"
              class="preset-button"
              :class="{ active: activePreset === String(days) }"
              @click="setPreset(days)"
            >{{ days === 1 ? t('usage.today') : t('usage.last_days', { days }) }}</button>
          </div>

          <div class="date-range">
            <input v-model="startDate" type="date" class="date-input" :max="endDate" @change="onDateChange" />
            <span>~</span>
            <input v-model="endDate" type="date" class="date-input" :min="startDate" @change="onDateChange" />
          </div>

          <SSelect v-model="granularity" size="sm" class="granularity-select" @change="runQuery">
            <option value="daily">{{ t('usage.granularity_daily') }}</option>
            <option value="hourly">{{ t('usage.granularity_hourly') }}</option>
          </SSelect>
        </div>

        <div class="query-row">
          <SSelect v-model="agentId" size="sm" class="filter-select" @change="runQuery">
            <option value="">{{ t('usage.all_agents') }}</option>
            <option v-for="option in filterOptions.agents" :key="option.id" :value="option.id">{{ option.label }}</option>
          </SSelect>
          <SSelect v-model="modelId" size="sm" class="filter-select" @change="runQuery">
            <option value="">{{ t('usage.all_models') }}</option>
            <option v-for="option in filterOptions.models" :key="option.id" :value="option.id">{{ option.label }}</option>
          </SSelect>
          <SSelect v-model="provider" size="sm" class="filter-select" @change="runQuery">
            <option value="">{{ t('usage.all_providers') }}</option>
            <option v-for="option in filterOptions.providers" :key="option" :value="option">{{ option }}</option>
          </SSelect>
          <SSelect v-model="channelId" size="sm" class="filter-select" @change="runQuery">
            <option value="">{{ t('usage.all_channels') }}</option>
            <option v-for="option in channelOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
          </SSelect>
          <div class="query-actions">
            <SButton size="sm" @click="resetFilters">{{ t('usage.reset') }}</SButton>
            <SButton type="primary" size="sm" :disabled="loading" @click="runQuery">{{ t('common.refresh') }}</SButton>
          </div>
        </div>
      </div>
    </SPageToolbar>

    <SPageContent>
      <div class="summary-grid" :class="{ muted: loading }">
        <div class="summary-card primary">
          <span class="summary-label">{{ t('usage.total_tokens') }}</span>
          <strong>{{ formatCompact(summary.totalTokens) }}</strong>
          <small>{{ formatNumber(summary.totalTokens) }}</small>
        </div>
        <div class="summary-card">
          <span class="summary-label">{{ t('usage.calls') }}</span>
          <strong>{{ formatNumber(summary.calls) }}</strong>
          <small>{{ t('usage.filtered_result') }}</small>
        </div>
        <div class="summary-card">
          <span class="summary-label">{{ t('usage.avg_per_call') }}</span>
          <strong>{{ formatNumber(Math.round(averagePerCall)) }}</strong>
          <small>Token / {{ t('usage.call_unit') }}</small>
        </div>
        <div class="summary-card">
          <span class="summary-label">{{ t('usage.input_tokens') }}</span>
          <strong>{{ formatCompact(summary.inputTokens) }}</strong>
          <small>{{ formatNumber(summary.inputTokens) }}</small>
        </div>
        <div class="summary-card">
          <span class="summary-label">{{ t('usage.output_tokens') }}</span>
          <strong>{{ formatCompact(summary.outputTokens) }}</strong>
          <small>{{ formatNumber(summary.outputTokens) }}</small>
        </div>
        <div class="summary-card">
          <span class="summary-label">{{ t('usage.cache_hit_rate') }}</span>
          <strong>{{ cacheHitRate.toFixed(1) }}%</strong>
          <small>{{ t('usage.cache_read') }} {{ formatCompact(summary.cacheReadTokens) }} · {{ t('usage.cache_creation') }} {{ formatCompact(summary.cacheCreationTokens) }}</small>
        </div>
      </div>

      <div class="sections-content">
        <SCard class="section-card">
          <div class="section-header">
            <div>
              <h3>{{ t('usage.usage_trend') }}</h3>
              <p>{{ appliedFilters.startDate }} ~ {{ appliedFilters.endDate }} · {{ t('usage.click_chart_hint') }}</p>
            </div>
            <div class="segmented-control">
              <button v-for="type in (['bar', 'line', 'table'] as ChartType[])" :key="type" :class="{ active: chartType === type }" @click="chartType = type">
                {{ t(`usage.chart_${type === 'line' ? 'area' : type}`) }}
              </button>
            </div>
          </div>

          <div v-if="loading" class="section-state">{{ t('common.loading') }}</div>
          <div v-else-if="trendRows.length === 0" class="section-state">{{ t('usage.no_data') }}</div>
          <div v-else-if="chartType !== 'table'" class="trend-chart">
            <Bar v-if="chartType === 'bar'" :data="trendChartData" :options="trendChartOptions" />
            <Line v-else :data="trendChartData" :options="trendChartOptions" />
          </div>
          <div v-else class="table-scroll">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>{{ appliedFilters.granularity === 'hourly' ? t('usage.column_time') : t('usage.date') }}</th>
                  <th>{{ t('usage.calls') }}</th>
                  <th>{{ t('usage.input_tokens') }}</th>
                  <th>{{ t('usage.output_tokens') }}</th>
                  <th>{{ t('usage.cache_read') }}</th>
                  <th>{{ t('usage.cache_creation') }}</th>
                  <th>{{ t('usage.total_tokens') }}</th>
                  <th>{{ t('usage.avg_per_call') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in trendRows"
                  :key="row.date || row.hour"
                  :class="{ selected: selectedBucket?.index === index }"
                  @click="selectTrendBucket(index)"
                >
                  <td>{{ trendLabel(row) }}</td>
                  <td>{{ formatNumber(row.calls) }}</td>
                  <td>{{ formatNumber(row.inputTokens) }}</td>
                  <td>{{ formatNumber(row.outputTokens) }}</td>
                  <td>{{ formatNumber(row.cacheReadTokens) }}</td>
                  <td>{{ formatNumber(row.cacheCreationTokens) }}</td>
                  <td class="strong-cell">{{ formatNumber(row.totalTokens) }}</td>
                  <td>{{ formatNumber(row.calls ? Math.round(row.totalTokens / row.calls) : 0) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="selectedBucket" class="drilldown-bar">
            <div class="drilldown-period">
              <span>{{ t('usage.selected_period') }}</span>
              <strong>{{ selectedBucket.label }}</strong>
            </div>
            <div class="drilldown-stat">
              <span>{{ t('usage.calls') }}</span>
              <strong>{{ formatNumber(selectedBucket.row.calls) }}</strong>
            </div>
            <div class="drilldown-stat">
              <span>{{ t('usage.total_tokens') }}</span>
              <strong>{{ formatNumber(selectedBucket.row.totalTokens) }}</strong>
            </div>
            <SButton size="sm" @click="clearTrendSelection">{{ t('usage.view_all') }}</SButton>
          </div>
        </SCard>

        <SCard class="section-card">
          <div class="section-header">
            <div>
              <h3>
                {{ t('usage.dimension_analysis') }}
                <span v-if="selectedBucket" class="period-chip">{{ selectedBucket.label }}</span>
              </h3>
              <p>{{ selectedBucket ? t('usage.drilldown_hint') : t('usage.dimension_analysis_hint') }}</p>
            </div>
          </div>
          <div class="dimension-sections">
            <section v-for="section in dimensionSections" :key="section.key" class="dimension-section">
              <div class="dimension-section-title">
                <h4>{{ section.label }}</h4>
                <span>{{ section.rows.length }}</span>
              </div>
              <div class="table-scroll">
                <STable :columns="dimensionColumns" :rows="section.rows" row-key="id" :loading="loading || detailLoading" :empty-text="t('usage.no_data')" />
              </div>
            </section>
          </div>
        </SCard>
      </div>

      <div class="sections-content call-log-section">
        <SCard class="section-card">
          <div class="section-header">
            <div>
              <h3>
                {{ t('usage.call_logs') }}
                <span v-if="selectedBucket" class="period-chip">{{ selectedBucket.label }}</span>
              </h3>
              <p>{{ selectedBucket ? t('usage.drilldown_logs_hint') : t('usage.call_logs_hint') }}</p>
            </div>
            <div class="pager">
              <SSelect v-model="pageSize" size="sm" @change="onPageSizeChange">
                <option :value="20">20 / {{ t('usage.page') }}</option>
                <option :value="50">50 / {{ t('usage.page') }}</option>
                <option :value="100">100 / {{ t('usage.page') }}</option>
              </SSelect>
              <span>{{ t('usage.page_of', { cur: logPage + 1, total: totalPages }) }}</span>
              <SButton size="sm" :disabled="logPage === 0 || logsLoading" @click="loadLogPage(logPage - 1)">{{ t('usage.prev_page') }}</SButton>
              <SButton size="sm" :disabled="logPage >= totalPages - 1 || logsLoading" @click="loadLogPage(logPage + 1)">{{ t('usage.next_page') }}</SButton>
            </div>
          </div>
          <div class="table-scroll log-table">
            <STable :columns="logColumns" :rows="logDisplayRows" row-key="id" :loading="logsLoading" :empty-text="t('usage.no_data')" />
          </div>
        </SCard>
      </div>
    </SPageContent>
  </div>
</template>

<style scoped>
.usage-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.query-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}

.query-row {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  flex-wrap: wrap;
}

.preset-group,
.segmented-control {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg-hover);
}

.preset-button,
.segmented-control button {
  border: none;
  background: transparent;
  color: var(--sui-fg-muted);
  border-radius: var(--sui-radius-sm);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--sui-fs-sm);
  cursor: pointer;
  white-space: nowrap;
}

.preset-button.active,
.segmented-control button.active {
  color: var(--sui-fg);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
}

.date-range {
  height: 32px;
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: 0 var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
  color: var(--sui-fg-disabled);
}

.date-input {
  border: none;
  outline: none;
  color: var(--sui-fg);
  background: transparent;
  font: inherit;
  font-size: var(--sui-fs-sm);
}

.filter-select { min-width: 170px; }
.granularity-select { min-width: 110px; }
.query-actions { display: flex; gap: var(--sui-sp-2); margin-left: auto; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(135px, 1fr));
  gap: var(--sui-sp-3);
  transition: opacity .15s;
}

.summary-grid.muted { opacity: .55; }

.summary-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--sui-sp-5);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
}

.summary-card.primary { border-top: 3px solid var(--sui-primary); padding-top: calc(var(--sui-sp-5) - 2px); }
.summary-label { color: var(--sui-fg-muted); font-size: var(--sui-fs-sm); }
.summary-card strong { color: var(--sui-fg); font-size: 24px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.summary-card small { min-height: 1.3em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sui-fg-disabled); }

.sections-content { padding-top: var(--sui-sp-6); }
.call-log-section { padding-top: 0; }
.section-card { margin-bottom: var(--sui-sp-6); }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sui-sp-4);
  flex-wrap: wrap;
  margin-bottom: var(--sui-sp-5);
}

.section-header h3 { margin: 0; color: var(--sui-fg); font-size: var(--sui-fs-lg); }
.section-header p { margin: 4px 0 0; color: var(--sui-fg-disabled); font-size: var(--sui-fs-sm); }
.trend-chart { height: 340px; }
.section-state { height: 220px; display: flex; align-items: center; justify-content: center; color: var(--sui-fg-disabled); }

.drilldown-bar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-6);
  margin-top: var(--sui-sp-5);
  padding: var(--sui-sp-3) var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-left: 3px solid var(--sui-primary);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg-soft);
}

.drilldown-period,
.drilldown-stat {
  display: flex;
  align-items: baseline;
  gap: var(--sui-sp-2);
  white-space: nowrap;
}

.drilldown-period { flex: 1; }
.drilldown-period span,
.drilldown-stat span { color: var(--sui-fg-muted); font-size: var(--sui-fs-sm); }
.drilldown-period strong,
.drilldown-stat strong { color: var(--sui-fg); font-variant-numeric: tabular-nums; }

.period-chip {
  display: inline-flex;
  margin-left: var(--sui-sp-2);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
  font-weight: 500;
  vertical-align: middle;
}

.table-scroll { width: 100%; overflow-x: auto; }
.log-table { min-height: 320px; }

.dimension-sections {
  display: flex;
  flex-direction: column;
}

.dimension-section {
  padding: var(--sui-sp-5) 0;
  border-top: 1px solid var(--sui-border);
}

.dimension-section:first-child {
  padding-top: 0;
  border-top: none;
}

.dimension-section:last-child { padding-bottom: 0; }

.dimension-section-title {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  margin-bottom: var(--sui-sp-3);
}

.dimension-section-title h4 {
  margin: 0;
  color: var(--sui-fg);
  font-size: var(--sui-fs-md);
}

.dimension-section-title span {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg-muted);
  text-align: center;
  font-size: var(--sui-fs-xs);
  font-weight: 600;
}

.detail-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
}

.detail-table th,
.detail-table td {
  padding: var(--sui-sp-3) var(--sui-sp-4);
  text-align: right;
  border-bottom: 1px solid var(--sui-border);
  font-variant-numeric: tabular-nums;
}

.detail-table th { color: var(--sui-fg-muted); font-weight: 600; }
.detail-table th:first-child,
.detail-table td:first-child { text-align: left; }
.strong-cell { font-weight: 600; }
.detail-table tbody tr { cursor: pointer; }
.detail-table tbody tr:hover { background: var(--sui-bg-soft); }
.detail-table tbody tr.selected { background: var(--sui-bg-hover); }

.pager {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  flex-wrap: nowrap;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-sm);
}

.pager span { white-space: nowrap; }

@media (max-width: 1200px) {
  .summary-grid { grid-template-columns: repeat(3, minmax(150px, 1fr)); }
  .query-actions { margin-left: 0; }
}

@media (max-width: 720px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(130px, 1fr)); }
  .filter-select { flex: 1 1 150px; min-width: 0; }
  .query-actions { width: 100%; justify-content: flex-end; }
  .trend-chart { height: 280px; }
  .drilldown-bar { align-items: flex-start; flex-wrap: wrap; gap: var(--sui-sp-3); }
  .drilldown-period { flex-basis: 100%; }
}
</style>
