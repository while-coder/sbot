<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import {
  useToast, useConfirm,
  SButton, SInput, SCard, SFormItem, SCheckCard, SBadge,
  SPageToolbar, SPageContent,
} from 'sbot-ui'
import { TunnelProviderType, type TunnelStatus, type TunnelConfig } from 'sbot.commons'

const { t } = useI18n()
const { show } = useToast()
const { confirm } = useConfirm()

// ── State ────────────────────────────────────────────────────────
const statuses = ref<TunnelStatus[]>([])
/** 本地编辑中的 tunnel 列表（保存到后端前一直是本地状态） */
const tunnels = reactive<TunnelConfig[]>([])
const expanded = reactive<Record<string, boolean>>({})
const busy = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

function statusOf(id: string): TunnelStatus | undefined {
  return statuses.value.find(s => s.id === id)
}

function elapsedText(startedAt?: number): string {
  if (!startedAt) return ''
  const sec = Math.floor((Date.now() - startedAt) / 1000)
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ── Load / Save ──────────────────────────────────────────────────
function pull(list: TunnelConfig[] | undefined): void {
  tunnels.splice(0, tunnels.length)
  for (const c of list ?? []) {
    tunnels.push({ ...c })
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const res = await apiFetch('/api/tunnel/status')
    statuses.value = res.data as TunnelStatus[]
  } catch {
    /* 静默 */
  }
}

function genId(prefix: string): string {
  let i = 1
  while (tunnels.find(t => t.id === `${prefix}-${i}`)) i++
  return `${prefix}-${i}`
}

function addTunnel(type: TunnelProviderType): void {
  const idPrefix = type === TunnelProviderType.CloudflareQuick ? 'cf-quick'
    : type === TunnelProviderType.CloudflareToken ? 'cf-token'
    : 'lt'
  const id = genId(idPrefix)
  tunnels.push({ id, name: '', enabled: true, type })
  expanded[id] = true
}

async function removeTunnel(idx: number): Promise<void> {
  const c = tunnels[idx]
  if (!c) return
  if (!await confirm(t('tunnel.delete_confirm', { id: c.id }), { danger: true })) return
  tunnels.splice(idx, 1)
  delete expanded[c.id]
}

const isDirty = computed(() => {
  const saved = store.settings.tunnel ?? []
  return JSON.stringify(saved) !== JSON.stringify(tunnels)
})

async function persistConfig(): Promise<void> {
  const ids = new Set<string>()
  for (const c of tunnels) {
    if (!c.id || !/^[A-Za-z0-9_\-.]{1,64}$/.test(c.id)) {
      throw new Error(t('tunnel.invalid_id', { id: c.id }))
    }
    if (ids.has(c.id)) {
      throw new Error(t('tunnel.duplicate_id', { id: c.id }))
    }
    ids.add(c.id)
  }
  const body = tunnels.map(c => ({ ...c }))
  const res = await apiFetch('/api/tunnel/config', 'PUT', body)
  store.settings.tunnel = res.data.tunnel
  pull(res.data.tunnel)
  statuses.value = res.data.status
}

async function saveConfig(): Promise<void> {
  busy.value = true
  try {
    await persistConfig()
    show(t('common.saved'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    busy.value = false
  }
}

async function startAll(): Promise<void> {
  busy.value = true
  try {
    if (isDirty.value) await persistConfig()
    const res = await apiFetch('/api/tunnel/start', 'POST')
    statuses.value = res.data
    show(t('tunnel.started'))
  } catch (e: any) {
    show(e.message, 'error')
    await refreshStatus()
  } finally { busy.value = false }
}

async function stopAll(): Promise<void> {
  busy.value = true
  try {
    const res = await apiFetch('/api/tunnel/stop', 'POST')
    statuses.value = res.data
    show(t('tunnel.stopped'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally { busy.value = false }
}

async function startEntry(id: string): Promise<void> {
  busy.value = true
  try {
    if (isDirty.value) await persistConfig()
    const res = await apiFetch(`/api/tunnel/entries/${encodeURIComponent(id)}/start`, 'POST')
    statuses.value = res.data
  } catch (e: any) {
    show(e.message, 'error')
    await refreshStatus()
  } finally { busy.value = false }
}

async function stopEntry(id: string): Promise<void> {
  busy.value = true
  try {
    const res = await apiFetch(`/api/tunnel/entries/${encodeURIComponent(id)}/stop`, 'POST')
    statuses.value = res.data
  } catch (e: any) {
    show(e.message, 'error')
  } finally { busy.value = false }
}

async function copyUrl(url?: string): Promise<void> {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    show(t('tunnel.copied'))
  } catch {
    show(t('tunnel.copy_failed'), 'error')
  }
}

async function copyAllUrls(): Promise<void> {
  const urls = statuses.value.filter(s => s.publicUrl).map(s => s.publicUrl).join('\n')
  if (!urls) return
  try {
    await navigator.clipboard.writeText(urls)
    show(t('tunnel.copied'))
  } catch {
    show(t('tunnel.copy_failed'), 'error')
  }
}

// ── Lifecycle ────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const res = await apiFetch('/api/settings')
    store.settings.tunnel = res.data.tunnel
  } catch { /* 失败时退回 store 已有值 */ }
  pull(store.settings.tunnel)
  await refreshStatus()
  pollTimer = setInterval(refreshStatus, 3000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const runningCount = computed(() => statuses.value.filter(s => s.running).length)
const hasAnyUrl = computed(() => statuses.value.some(s => s.publicUrl))

// 暴露 enum 给模板
const PT = TunnelProviderType
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <SPageToolbar>
      <SButton type="primary" size="sm" :disabled="busy || !isDirty" @click="saveConfig">
        {{ t('common.save') }}{{ isDirty ? ' *' : '' }}
      </SButton>
      <SButton type="primary" size="sm" :disabled="busy || tunnels.length === 0" @click="startAll">
        {{ t('tunnel.start_all') }}
      </SButton>
      <SButton type="danger" size="sm" :disabled="busy || runningCount === 0" @click="stopAll">
        {{ t('tunnel.stop_all') }}
      </SButton>
      <SButton type="outline" size="sm" :disabled="!hasAnyUrl" @click="copyAllUrls">
        {{ t('tunnel.copy_all_urls') }}
      </SButton>
    </SPageToolbar>
    <SPageContent>
      <SCard :title="t('tunnel.title')">
        <div class="form-hint privacy-warn">⚠ {{ t('tunnel.privacy_warning') }}</div>
        <div class="form-hint">{{ t('tunnel.intro_hint') }}</div>

        <div class="entries-toolbar">
          <SButton type="outline" size="sm" @click="addTunnel(PT.CloudflareQuick)">+ {{ t('tunnel.provider_cloudflare_quick') }}</SButton>
          <SButton type="outline" size="sm" @click="addTunnel(PT.CloudflareToken)">+ {{ t('tunnel.provider_cloudflare_token') }}</SButton>
          <SButton type="outline" size="sm" @click="addTunnel(PT.Localtunnel)">+ {{ t('tunnel.provider_localtunnel') }}</SButton>
        </div>

        <div v-if="tunnels.length === 0" class="empty">{{ t('tunnel.empty') }}</div>

        <div v-for="(tunnel, idx) in tunnels" :key="tunnel.id" class="entry-card">
          <div class="entry-head" @click="expanded[tunnel.id] = !expanded[tunnel.id]">
            <span class="entry-toggle">{{ expanded[tunnel.id] ? '▼' : '▶' }}</span>
            <span class="entry-name">{{ tunnel.name || tunnel.id }}</span>
            <span class="entry-type">{{ t(`tunnel.provider_${tunnel.type.replace(/-/g, '_')}`) }}</span>
            <SBadge v-if="statusOf(tunnel.id)?.running" type="success">{{ t('tunnel.running') }}</SBadge>
            <SBadge v-else-if="statusOf(tunnel.id)?.error" type="danger">{{ t('tunnel.error') }}</SBadge>
            <SBadge v-else-if="tunnel.enabled === false" type="default">{{ t('tunnel.disabled') }}</SBadge>
            <SBadge v-else type="default">{{ t('tunnel.stopped_state') }}</SBadge>
            <span class="entry-url" v-if="statusOf(tunnel.id)?.publicUrl" @click.stop>
              <a :href="statusOf(tunnel.id)?.publicUrl" target="_blank">{{ statusOf(tunnel.id)?.publicUrl }}</a>
            </span>
            <span class="entry-actions" @click.stop>
              <SButton
                v-if="!statusOf(tunnel.id)?.running"
                type="primary"
                size="sm"
                :disabled="busy || tunnel.enabled === false"
                @click="startEntry(tunnel.id)"
              >
                {{ t('tunnel.start') }}
              </SButton>
              <SButton
                v-else
                type="danger"
                size="sm"
                :disabled="busy"
                @click="stopEntry(tunnel.id)"
              >
                {{ t('tunnel.stop') }}
              </SButton>
              <SButton
                v-if="statusOf(tunnel.id)?.publicUrl"
                type="text"
                size="sm"
                @click="copyUrl(statusOf(tunnel.id)?.publicUrl)"
              >
                {{ t('tunnel.copy') }}
              </SButton>
              <SButton type="text" size="sm" :title="t('common.delete')" @click="removeTunnel(idx)">✕</SButton>
            </span>
          </div>

          <div v-if="expanded[tunnel.id]" class="entry-body">
            <div class="inline-form">
              <SFormItem :label="t('tunnel.entry_id_label')" :hint="t('tunnel.entry_id_hint')">
                <SInput v-model="tunnel.id" type="text" placeholder="cf-quick-1" />
              </SFormItem>
              <SFormItem :label="t('tunnel.entry_name_label')">
                <SInput v-model="tunnel.name" type="text" :placeholder="t('tunnel.entry_name_placeholder')" />
              </SFormItem>
              <SFormItem :label="t('tunnel.entry_enabled_label')">
                <SCheckCard v-model="tunnel.enabled">{{ t('tunnel.entry_enabled') }}</SCheckCard>
              </SFormItem>

              <template v-if="tunnel.type === PT.CloudflareQuick">
                <div class="form-hint">{{ t('tunnel.quick_hint') }}</div>
              </template>

              <template v-if="tunnel.type === PT.CloudflareToken">
                <SFormItem :label="t('tunnel.token_label')" :hint="t('tunnel.token_hint')">
                  <SInput v-model="tunnel.cloudflareToken" type="password" placeholder="eyJhIjoi..." />
                </SFormItem>
                <SFormItem :label="t('tunnel.token_url_label')" :hint="t('tunnel.token_url_hint')">
                  <SInput v-model="tunnel.cloudflareTokenPublicUrl" type="text" placeholder="https://bot.example.com" />
                </SFormItem>
              </template>

              <template v-if="tunnel.type === PT.Localtunnel">
                <SFormItem :label="t('tunnel.lt_subdomain_label')" :hint="t('tunnel.lt_subdomain_hint')">
                  <SInput v-model="tunnel.localtunnelSubdomain" type="text" placeholder="my-sbot" />
                </SFormItem>
                <div class="form-hint">{{ t('tunnel.lt_first_visit_hint') }}</div>
              </template>

              <div class="status-line" v-if="statusOf(tunnel.id)">
                <span v-if="statusOf(tunnel.id)?.startedAt" class="status-meta">
                  {{ t('tunnel.uptime') }}: {{ elapsedText(statusOf(tunnel.id)?.startedAt) }}
                </span>
                <span v-if="statusOf(tunnel.id)?.error" class="error-text">
                  {{ t('tunnel.last_error') }}: {{ statusOf(tunnel.id)?.error }}
                </span>
              </div>

              <div class="logs-block">
                <div class="logs-label">{{ t('tunnel.logs_title') }}</div>
                <pre class="logs">{{ (statusOf(tunnel.id)?.recentLogs ?? []).join('\n') || t('tunnel.no_logs') }}</pre>
              </div>
            </div>
          </div>
        </div>
      </SCard>
    </SPageContent>
  </div>
</template>

<style scoped>
.form-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-3);
}
.privacy-warn {
  color: var(--sui-fg-warning, #b88200);
  margin-bottom: var(--sui-sp-3);
}
.inline-form {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.entries-toolbar {
  display: flex;
  gap: var(--sui-sp-2);
  margin-bottom: var(--sui-sp-3);
  flex-wrap: wrap;
}
.empty {
  color: var(--sui-fg-muted);
  text-align: center;
  padding: var(--sui-sp-4);
  font-size: var(--sui-fs-sm);
}
.entry-card {
  border: 1px solid var(--sui-border, #2a2a2a);
  border-radius: var(--sui-radius-md, 6px);
  margin-bottom: var(--sui-sp-2);
  overflow: hidden;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-2) var(--sui-sp-3);
  background: var(--sui-bg-subtle, #1a1a1a);
  cursor: pointer;
  user-select: none;
}
.entry-head:hover {
  background: var(--sui-bg-hover, #222);
}
.entry-toggle {
  width: 12px;
  font-size: 10px;
  color: var(--sui-fg-muted);
}
.entry-name {
  font-weight: 600;
  min-width: 100px;
}
.entry-type {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.entry-url {
  margin-left: auto;
  font-size: var(--sui-fs-sm);
}
.entry-url a {
  color: var(--sui-fg-link, #2563eb);
  text-decoration: none;
  word-break: break-all;
}
.entry-url a:hover {
  text-decoration: underline;
}
.entry-actions {
  display: flex;
  gap: var(--sui-sp-1);
  margin-left: var(--sui-sp-2);
}
.entry-body {
  padding: var(--sui-sp-3);
  border-top: 1px solid var(--sui-border, #2a2a2a);
}
.status-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sui-sp-3);
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.error-text {
  color: var(--sui-fg-danger, #dc2626);
  word-break: break-all;
}
.logs-block {
  margin-top: var(--sui-sp-2);
}
.logs-label {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-1);
}
.logs {
  background: var(--sui-bg-code, #1e1e1e);
  color: var(--sui-fg-code, #d4d4d4);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: var(--sui-fs-sm);
  padding: var(--sui-sp-3);
  max-height: 250px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  border-radius: var(--sui-radius-sm, 4px);
}
</style>
