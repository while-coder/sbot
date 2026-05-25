<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useToast, useConfirm, SButton, SBadge, SPageToolbar, SPageContent, STable } from 'sbot-ui'
import type { STableColumn } from 'sbot-ui'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

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

const columns = computed<STableColumn[]>(() => [
  { key: 'agentName',    label: t('processes.agent'), primary: true },
  { key: 'dbSessionId',  label: t('processes.session') },
  { key: 'createdAt',    label: t('processes.created') },
  { key: 'lastAccessed', label: t('processes.last_accessed') },
  { key: 'status',       label: t('processes.status') },
  { key: 'ops',          label: t('common.ops'), ops: true },
])

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
  if (!await confirm(t('processes.confirm_stop', { name: item.agentName }), { danger: true })) return
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
  if (!await confirm(t('processes.confirm_stop_all'), { danger: true })) return
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
    <SPageToolbar>
      <SButton type="outline" size="sm" @click="load">{{ t('common.refresh') }}</SButton>
      <SButton type="danger" size="sm" :disabled="!items.length" @click="stopAll">{{ t('processes.stop_all') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <STable :columns="columns" :rows="items" row-key="key" :empty-text="t('processes.empty')">
        <template #agentName="{ row }">
          <span class="processes-name">{{ row.agentName }}</span>
          <SBadge variant="success" pill class="processes-acp">ACP</SBadge>
        </template>
        <template #dbSessionId="{ row }">
          <span class="processes-session">{{ row.dbSessionId }}</span>
        </template>
        <template #createdAt="{ row }">
          <span class="cell-time">{{ fmtTime(row.createdAt) }}</span>
          <span class="cell-time-sub"> ({{ fmtDuration(row.createdAt) }})</span>
        </template>
        <template #lastAccessed="{ row }">
          <span class="cell-time">{{ fmtTime(row.lastAccessed) }}</span>
        </template>
        <template #status="{ row }">
          <SBadge :variant="row.alive ? 'success' : 'danger'">{{ row.alive ? t('processes.alive') : t('processes.dead') }}</SBadge>
        </template>
        <template #ops="{ row }">
          <SButton type="danger" size="sm" :disabled="!row.alive" @click="stop(row)">{{ t('processes.stop') }}</SButton>
        </template>
      </STable>
    </SPageContent>
  </div>
</template>

<style scoped>
.processes-name { font-weight: 500; }
.processes-acp { margin-left: var(--sui-sp-2); }
.processes-session {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
}
.cell-time {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.cell-time-sub {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}
</style>
