<script setup lang="ts">
import { ref, computed } from 'vue'
import type { UsageInfo, ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import { useCompact } from '../composables/useCompact'

const isCompact = useCompact()

const props = defineProps<{
  usage: UsageInfo | null
  contextWindow?: number
  labels?: ChatLabels
  hasSaver: boolean
}>()

const emit = defineEmits<{
  refresh: []
  clearHistory: []
}>()

const L = computed(() => resolveLabels(props.labels))
const showDetail = ref(false)

// ── Ring constants ──
const RING_R = 9
const RING_C = 2 * Math.PI * RING_R // ~56.55

const contextPercent = computed(() => {
  if (!props.contextWindow || !props.usage?.lastInputTokens) return null
  return Math.min(100, Math.round(props.usage.lastInputTokens / props.contextWindow * 100))
})

const ctxRingColor = computed(() => {
  const p = contextPercent.value
  if (p == null) return ''
  if (p < 60) return 'var(--chatui-usage-cache, #22c55e)'
  if (p < 85) return '#eab308'
  return '#ef4444'
})

const ctxDashOffset = computed(() => {
  const p = contextPercent.value
  if (p == null) return RING_C
  return RING_C * (1 - p / 100)
})

const cachePercent = computed(() => {
  if (!props.usage) return null
  const read = props.usage.cacheReadTokens ?? 0
  if (read === 0) return null
  const total = props.usage.inputTokens + read + (props.usage.cacheCreationTokens ?? 0)
  if (total === 0) return null
  return Math.round(read / total * 100)
})

const cacheDashOffset = computed(() => {
  const p = cachePercent.value
  if (p == null) return RING_C
  return RING_C * (1 - p / 100)
})

const hasCache = computed(() => {
  if (!props.usage) return false
  return (props.usage.cacheReadTokens ?? 0) > 0 || (props.usage.cacheCreationTokens ?? 0) > 0
})

// ── Stacked bar segments ──
const barSegments = computed(() => {
  if (!props.usage || props.usage.totalTokens === 0) return []
  const u = props.usage
  const cacheRead = u.cacheReadTokens ?? 0
  const cacheCreate = u.cacheCreationTokens ?? 0
  const pureInput = Math.max(0, u.inputTokens - cacheRead - cacheCreate)
  const total = pureInput + u.outputTokens + cacheRead + cacheCreate
  if (total === 0) return []
  return [
    { color: 'var(--chatui-usage-input)', pct: pureInput / total * 100, label: 'Input' },
    { color: 'var(--chatui-usage-output)', pct: u.outputTokens / total * 100, label: 'Output' },
    { color: 'var(--chatui-usage-cache, #22c55e)', pct: cacheRead / total * 100, label: 'Cache Read' },
    { color: 'var(--chatui-usage-cache-creation, #94a3b8)', pct: cacheCreate / total * 100, label: 'Cache Write' },
  ].filter(s => s.pct > 0)
})

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtFull(n: number): string {
  return n.toLocaleString()
}

function toggleDetail() {
  showDetail.value = !showDetail.value
}

function onClickOutside(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest('.chatui-usage-detail')
  if (!el) showDetail.value = false
}
</script>

<template>
  <div class="chatui-status-bar" :class="{ 'chatui-compact': isCompact }">
    <div class="chatui-usage-stats" v-if="usage && usage.totalTokens > 0" @click="toggleDetail">

      <!-- Context ring -->
      <span v-if="contextPercent != null" class="chatui-ring-wrap"
        :title="`Context: ${fmtFull(usage!.lastInputTokens)} / ${fmtFull(contextWindow!)}`">
        <svg class="chatui-ring" viewBox="0 0 24 24">
          <circle cx="12" cy="12" :r="RING_R" fill="none" stroke="var(--chatui-usage-track)" stroke-width="3" />
          <circle cx="12" cy="12" :r="RING_R" fill="none" :stroke="ctxRingColor" stroke-width="3"
            stroke-linecap="round" :stroke-dasharray="RING_C" :stroke-dashoffset="ctxDashOffset"
            class="chatui-ring-fg" />
        </svg>
        <span class="chatui-ring-label">{{ contextPercent }}%</span>
      </span>

      <span class="chatui-usage-sep" v-if="contextPercent != null" />

      <!-- Compact mode -->
      <template v-if="isCompact">
        <span class="chatui-usage-item" :title="`Total: ${fmtFull(usage!.totalTokens)}`">
          <span class="chatui-usage-total-val">{{ fmtCompact(usage!.totalTokens) }}</span>
        </span>
        <span v-if="cachePercent != null" class="chatui-ring-wrap" :title="`Cache: ${cachePercent}%`">
          <svg class="chatui-ring" viewBox="0 0 24 24">
            <circle cx="12" cy="12" :r="RING_R" fill="none" stroke="var(--chatui-usage-track)" stroke-width="3" />
            <circle cx="12" cy="12" :r="RING_R" fill="none" stroke="var(--chatui-usage-cache, #22c55e)" stroke-width="3"
              stroke-linecap="round" :stroke-dasharray="RING_C" :stroke-dashoffset="cacheDashOffset"
              class="chatui-ring-fg" />
          </svg>
        </span>
      </template>

      <!-- Full mode -->
      <template v-else>
        <!-- Last turn -->
        <span class="chatui-usage-group"
          :title="`Last: ↓${fmtFull(usage!.lastInputTokens)} ↑${fmtFull(usage!.lastOutputTokens)}`">
          <span class="chatui-usage-label">{{ L.usageLast }}</span>
          <span class="chatui-usage-val chatui-usage-in">↓{{ fmtCompact(usage!.lastInputTokens) }}</span>
          <span class="chatui-usage-val chatui-usage-out">↑{{ fmtCompact(usage!.lastOutputTokens) }}</span>
        </span>

        <span class="chatui-usage-sep" />

        <!-- Session total -->
        <span class="chatui-usage-group"
          :title="`Total: ↓${fmtFull(usage!.inputTokens)} ↑${fmtFull(usage!.outputTokens)}`">
          <span class="chatui-usage-label">{{ L.usageTotal }}</span>
          <span class="chatui-usage-val chatui-usage-in">↓{{ fmtCompact(usage!.inputTokens) }}</span>
          <span class="chatui-usage-val chatui-usage-out">↑{{ fmtCompact(usage!.outputTokens) }}</span>
        </span>

        <!-- Cache ring -->
        <template v-if="hasCache">
          <span class="chatui-usage-sep" />
          <span class="chatui-ring-wrap"
            :title="`Cache Read: ${fmtFull(usage!.cacheReadTokens ?? 0)} / Write: ${fmtFull(usage!.cacheCreationTokens ?? 0)}`">
            <svg class="chatui-ring" viewBox="0 0 24 24">
              <circle cx="12" cy="12" :r="RING_R" fill="none" stroke="var(--chatui-usage-track)" stroke-width="3" />
              <circle v-if="cachePercent != null" cx="12" cy="12" :r="RING_R" fill="none"
                stroke="var(--chatui-usage-cache, #22c55e)" stroke-width="3"
                stroke-linecap="round" :stroke-dasharray="RING_C" :stroke-dashoffset="cacheDashOffset"
                class="chatui-ring-fg" />
            </svg>
            <span class="chatui-ring-label chatui-usage-cache-text" v-if="cachePercent != null">{{ cachePercent }}%</span>
          </span>
        </template>

        <span class="chatui-usage-sep" />

        <!-- Grand total -->
        <span class="chatui-usage-total-val" :title="`${fmtFull(usage!.totalTokens)} tokens`">
          Σ{{ fmtCompact(usage!.totalTokens) }}
        </span>

        <!-- Stacked mini bar -->
        <div class="chatui-mini-bar" v-if="barSegments.length > 0">
          <div v-for="(seg, i) in barSegments" :key="i"
            class="chatui-mini-bar-seg"
            :style="{ width: seg.pct + '%', background: seg.color }"
            :title="`${seg.label}: ${seg.pct.toFixed(0)}%`" />
        </div>
      </template>
    </div>

    <!-- Detail popup -->
    <Teleport to="body">
      <div v-if="showDetail && usage && usage.totalTokens > 0" class="chatui-usage-detail-backdrop" @click="onClickOutside">
        <div class="chatui-usage-detail">
          <div class="chatui-detail-title">Token Usage</div>

          <!-- Last turn section -->
          <div class="chatui-detail-section">
            <div class="chatui-detail-section-label">{{ L.usageLast }}</div>
            <div class="chatui-detail-row">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-input)" />
              <span class="chatui-detail-key">Input</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.lastInputTokens) }}</span>
            </div>
            <div class="chatui-detail-row">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-output)" />
              <span class="chatui-detail-key">Output</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.lastOutputTokens) }}</span>
            </div>
            <div class="chatui-detail-row chatui-detail-row-total">
              <span class="chatui-detail-dot" style="background: transparent" />
              <span class="chatui-detail-key">Total</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.lastTotalTokens) }}</span>
            </div>
          </div>

          <!-- Session total section -->
          <div class="chatui-detail-section">
            <div class="chatui-detail-section-label">{{ L.usageTotal }}</div>
            <div class="chatui-detail-row">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-input)" />
              <span class="chatui-detail-key">Input</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.inputTokens) }}</span>
            </div>
            <div class="chatui-detail-row">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-output)" />
              <span class="chatui-detail-key">Output</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.outputTokens) }}</span>
            </div>
            <div class="chatui-detail-row chatui-detail-row-total">
              <span class="chatui-detail-dot" style="background: transparent" />
              <span class="chatui-detail-key">Total</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.totalTokens) }}</span>
            </div>
          </div>

          <!-- Cache section -->
          <div class="chatui-detail-section" v-if="hasCache">
            <div class="chatui-detail-section-label">{{ L.usageCache }}</div>
            <div class="chatui-detail-row" v-if="usage!.cacheReadTokens">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-cache, #22c55e)" />
              <span class="chatui-detail-key">Read</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.cacheReadTokens!) }}</span>
            </div>
            <div class="chatui-detail-row" v-if="usage!.cacheCreationTokens">
              <span class="chatui-detail-dot" style="background: var(--chatui-usage-cache-creation, #94a3b8)" />
              <span class="chatui-detail-key">{{ L.usageCacheCreation }}</span>
              <span class="chatui-detail-val">{{ fmtFull(usage!.cacheCreationTokens!) }}</span>
            </div>
            <div class="chatui-detail-row" v-if="cachePercent != null">
              <span class="chatui-detail-dot" style="background: transparent" />
              <span class="chatui-detail-key">{{ L.usageSaved }}</span>
              <span class="chatui-detail-val chatui-usage-cache-text">{{ cachePercent }}%</span>
            </div>
          </div>

          <!-- Composition bar -->
          <div class="chatui-detail-bar" v-if="barSegments.length > 0">
            <div v-for="(seg, i) in barSegments" :key="i"
              class="chatui-detail-bar-seg"
              :style="{ width: seg.pct + '%', background: seg.color }" />
          </div>
        </div>
      </div>
    </Teleport>

    <div class="chatui-toolbar-actions">
      <button class="chatui-btn-outline chatui-btn-sm" @click="emit('refresh')">{{ L.refresh }}</button>
      <button class="chatui-btn-danger chatui-btn-sm" :disabled="!hasSaver" @click="emit('clearHistory')">{{ L.clearHistory }}</button>
    </div>
  </div>
</template>

<style scoped>
.chatui-status-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 5px 16px; border-bottom: 1px solid var(--chatui-border-subtle);
  min-height: 32px; flex-shrink: 0;
  background: var(--chatui-bg-surface);
}

/* ── Usage stats row ── */
.chatui-usage-stats {
  display: flex; align-items: center; gap: 10px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--chatui-fg-secondary);
  overflow-x: auto; scrollbar-width: none;
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 4px;
  transition: background 0.15s;
}
.chatui-usage-stats:hover { background: var(--chatui-bg-hover); }
.chatui-usage-stats::-webkit-scrollbar { display: none; }

/* ── SVG Ring ── */
.chatui-ring-wrap { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.chatui-ring { width: 22px; height: 22px; transform: rotate(-90deg); flex-shrink: 0; }
.chatui-ring-fg { transition: stroke-dashoffset 0.4s ease, stroke 0.3s; }
.chatui-ring-label { font-size: 10px; font-weight: 600; color: var(--chatui-fg-secondary); }

/* ── Text stats ── */
.chatui-usage-group { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.chatui-usage-item { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.chatui-usage-label { color: var(--chatui-fg-secondary); font-weight: 500; margin-right: 2px; }
.chatui-usage-val { font-weight: 600; }
.chatui-usage-in { color: var(--chatui-usage-input); }
.chatui-usage-out { color: var(--chatui-usage-output); }
.chatui-usage-cache-text { color: var(--chatui-usage-cache, #22c55e); }
.chatui-usage-total-val { color: var(--chatui-usage-total, var(--chatui-fg)); font-weight: 700; font-size: 12px; white-space: nowrap; }
.chatui-usage-sep { width: 1px; height: 12px; background: var(--chatui-usage-sep); flex-shrink: 0; }

/* ── Mini stacked bar (inline) ── */
.chatui-mini-bar {
  display: flex; height: 4px; width: 60px; border-radius: 2px; overflow: hidden; flex-shrink: 0;
  background: var(--chatui-usage-track);
}
.chatui-mini-bar-seg { height: 100%; transition: width 0.3s; }

/* ── Detail popup ── */
.chatui-usage-detail-backdrop {
  position: fixed; inset: 0; z-index: 200;
}
.chatui-usage-detail {
  position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
  background: var(--chatui-bg-surface, #fff);
  border: 1px solid var(--chatui-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 16px 20px;
  min-width: 260px; max-width: 320px;
  z-index: 201;
  font-size: 12px;
  color: var(--chatui-fg);
}
.chatui-detail-title {
  font-size: 13px; font-weight: 700; margin-bottom: 12px;
  color: var(--chatui-fg);
}
.chatui-detail-section { margin-bottom: 10px; }
.chatui-detail-section-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  color: var(--chatui-fg-secondary); letter-spacing: 0.05em;
  margin-bottom: 4px;
}
.chatui-detail-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0;
  font-variant-numeric: tabular-nums;
}
.chatui-detail-row-total { font-weight: 700; border-top: 1px solid var(--chatui-border-subtle); margin-top: 2px; padding-top: 4px; }
.chatui-detail-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.chatui-detail-key { flex: 1; color: var(--chatui-fg-secondary); }
.chatui-detail-val { font-weight: 600; }

/* ── Detail composition bar ── */
.chatui-detail-bar {
  display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 8px;
  background: var(--chatui-usage-track);
}
.chatui-detail-bar-seg { height: 100%; transition: width 0.3s; }

/* ── Buttons ── */
.chatui-toolbar-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.chatui-btn-outline {
  padding: 4px 10px; border: 1px solid var(--chatui-border);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-fg);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover); }
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }
.chatui-btn-danger {
  padding: 4px 10px; border: 1px solid var(--chatui-btn-danger);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-btn-danger);
}
.chatui-btn-danger:hover { background: rgba(239, 68, 68, 0.08); }
.chatui-btn-danger:disabled { opacity: 0.5; cursor: default; }

/* ── Compact ── */
.chatui-status-bar.chatui-compact { flex-wrap: wrap; padding: 4px 8px; gap: 6px; }
</style>
