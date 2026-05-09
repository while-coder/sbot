<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { show } = useToast()

interface UsageRow {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

const loading = ref(false)
const usageStats = ref<UsageRow[]>([])

const today = new Date()
const thirtyDaysAgo = new Date(today)
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

const startDate = ref(formatDate(thirtyDaysAgo))
const endDate = ref(formatDate(today))

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

async function fetchUsage() {
  loading.value = true
  try {
    const res = await apiFetch(`/api/usage-stats?start=${startDate.value}&end=${endDate.value}`)
    usageStats.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
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

    <div class="usage-toolbar">
      <div class="usage-date-range">
        <input type="date" v-model="startDate" class="date-input" />
        <span class="date-sep">~</span>
        <input type="date" v-model="endDate" class="date-input" />
      </div>
      <button class="btn-primary btn-sm" @click="fetchUsage">{{ t('common.refresh') }}</button>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px 0;color:#94a3b8">{{ t('common.loading') }}</div>
    <div v-else-if="usageStats.length === 0" class="usage-empty">
      <div style="font-size:32px;margin-bottom:8px">📊</div>
      <div style="color:#94a3b8;font-size:13px">{{ t('usage.no_data') }}</div>
    </div>
    <table v-else class="usage-table">
      <thead>
        <tr>
          <th>{{ t('usage.date') }}</th>
          <th style="text-align:right">{{ t('usage.input_tokens') }}</th>
          <th style="text-align:right">{{ t('usage.output_tokens') }}</th>
          <th style="text-align:right">{{ t('usage.total_tokens') }}</th>
          <th style="text-align:right">{{ t('usage.cache_read') }}</th>
          <th style="text-align:right">{{ t('usage.cache_creation') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in usageStats" :key="row.date">
          <td>{{ row.date }}</td>
          <td style="text-align:right">{{ formatNumber(row.inputTokens) }}</td>
          <td style="text-align:right">{{ formatNumber(row.outputTokens) }}</td>
          <td style="text-align:right;font-weight:600">{{ formatNumber(row.totalTokens) }}</td>
          <td style="text-align:right;color:#22c55e">{{ formatNumber(row.cacheReadTokens) }}</td>
          <td style="text-align:right;color:#94a3b8">{{ formatNumber(row.cacheCreationTokens) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.usage-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
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
.usage-empty {
  text-align: center;
  padding: 80px 0;
}
.usage-table {
  width: 100%;
}
</style>
