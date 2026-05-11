<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { isMobile } = useResponsive()
const { show } = useToast()

interface ProcessInfo {
  key: string
  agentId: string
  agentName: string
  dbSessionId: string
  createdAt: number
  lastAccessed: number
  alive: boolean
}

const items = ref<ProcessInfo[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/acp-sessions')
    items.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function stop(item: ProcessInfo) {
  if (!window.confirm(t('processes.confirm_stop', { name: item.agentName }))) return
  try {
    await apiFetch(`/api/acp-sessions/${encodeURIComponent(item.key)}`, 'DELETE')
    show(t('processes.stopped'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function stopAll() {
  if (!items.value.length) return
  if (!window.confirm(t('processes.confirm_stop_all'))) return
  try {
    await apiFetch('/api/acp-sessions', 'DELETE')
    show(t('processes.stopped'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, { hour12: false })
}

function fmtDuration(ts: number) {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h ${min % 60}m`
}

onMounted(() => {
  load()
  timer = setInterval(load, 10000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
      <button class="btn-danger btn-sm" @click="stopAll" :disabled="!items.length">{{ t('processes.stop_all') }}</button>
    </div>
    <div class="page-content">

      <!-- Desktop table -->
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th>{{ t('processes.agent') }}</th>
            <th>{{ t('processes.session') }}</th>
            <th>{{ t('processes.created') }}</th>
            <th>{{ t('processes.last_accessed') }}</th>
            <th>{{ t('processes.status') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="items.length === 0">
            <td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">{{ t('processes.empty') }}</td>
          </tr>
          <tr v-for="item in items" :key="item.key">
            <td>
              <span style="font-weight:500">{{ item.agentName }}</span>
              <span class="config-badge" style="background:#ccfbf1;color:#0f766e;margin-left:6px">ACP</span>
            </td>
            <td style="font-family:monospace;font-size:12px">{{ item.dbSessionId }}</td>
            <td style="font-size:12px;color:#6b6b6b">{{ fmtTime(item.createdAt) }}<br><span style="color:#94a3b8">{{ fmtDuration(item.createdAt) }}</span></td>
            <td style="font-size:12px;color:#6b6b6b">{{ fmtTime(item.lastAccessed) }}</td>
            <td>
              <span v-if="item.alive" style="display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:4px;background:#dcfce7;color:#16a34a">{{ t('processes.alive') }}</span>
              <span v-else style="display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:4px;background:#fee2e2;color:#dc2626">{{ t('processes.dead') }}</span>
            </td>
            <td>
              <button class="btn-danger btn-sm" @click="stop(item)" :disabled="!item.alive">{{ t('processes.stop') }}</button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile cards -->
      <div v-else class="card-list">
        <div v-for="item in items" :key="item.key" class="mobile-card">
          <div class="mobile-card-header">
            {{ item.agentName }}
            <span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;background:#ccfbf1;color:#0f766e;margin-left:6px">ACP</span>
          </div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('processes.session') }}</span>
            <span class="mobile-card-value" style="font-family:monospace;font-size:12px">{{ item.dbSessionId }}</span>
            <span class="mobile-card-label">{{ t('processes.created') }}</span>
            <span class="mobile-card-value" style="font-size:12px">{{ fmtTime(item.createdAt) }} ({{ fmtDuration(item.createdAt) }})</span>
            <span class="mobile-card-label">{{ t('processes.status') }}</span>
            <span class="mobile-card-value">
              <span v-if="item.alive" style="font-size:11px;font-weight:600;padding:1px 8px;border-radius:4px;background:#dcfce7;color:#16a34a">{{ t('processes.alive') }}</span>
              <span v-else style="font-size:11px;font-weight:600;padding:1px 8px;border-radius:4px;background:#fee2e2;color:#dc2626">{{ t('processes.dead') }}</span>
            </span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-danger btn-sm" @click="stop(item)" :disabled="!item.alive">{{ t('processes.stop') }}</button>
          </div>
        </div>
        <div v-if="items.length === 0" class="mobile-card-empty" style="text-align:center;color:#94a3b8;padding:40px">{{ t('processes.empty') }}</div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.config-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  vertical-align: middle;
}
</style>
