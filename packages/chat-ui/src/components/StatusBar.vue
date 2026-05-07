<script setup lang="ts">
import { computed } from 'vue'
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

const contextPercent = computed(() => {
  if (!props.contextWindow || !props.usage?.lastInputTokens) return null
  return Math.min(100, Math.round(props.usage.lastInputTokens / props.contextWindow * 100))
})

const contextBarColor = computed(() => {
  const p = contextPercent.value
  if (p == null) return ''
  if (p < 60) return '#22c55e'
  if (p < 85) return '#eab308'
  return '#ef4444'
})

function fmt(n: number): string {
  return n.toLocaleString()
}
</script>

<template>
  <div class="chatui-status-bar" :class="{ 'chatui-compact': isCompact }">
    <div class="chatui-usage-stats" v-if="usage && usage.totalTokens > 0">
      <span v-if="contextPercent != null" class="chatui-ctx-bar-wrap"
        :title="`${fmt(usage!.lastInputTokens)} / ${fmt(contextWindow!)}`">
        <div class="chatui-ctx-bar-track">
          <div class="chatui-ctx-bar-fill" :style="{ width: contextPercent + '%', background: contextBarColor }" />
        </div>
        <span class="chatui-ctx-bar-label">{{ contextPercent }}%</span>
      </span>
      <span class="chatui-usage-sep" v-if="contextPercent != null" />
      <span class="chatui-usage-item">
        <span class="chatui-usage-label">{{ L.usageLast }}</span>
        <span class="chatui-usage-val chatui-usage-in">{{ fmt(usage!.lastInputTokens) }}</span>
        <span class="chatui-usage-op">/</span>
        <span class="chatui-usage-val chatui-usage-out">{{ fmt(usage!.lastOutputTokens) }}</span>
      </span>
      <span class="chatui-usage-sep" />
      <span class="chatui-usage-item">
        <span class="chatui-usage-label">{{ L.usageTotal }}</span>
        <span class="chatui-usage-val chatui-usage-in">{{ fmt(usage!.inputTokens) }}</span>
        <span class="chatui-usage-op">/</span>
        <span class="chatui-usage-val chatui-usage-out">{{ fmt(usage!.outputTokens) }}</span>
      </span>
      <span class="chatui-usage-sep" v-if="usage!.cacheReadTokens" />
      <span class="chatui-usage-item" v-if="usage!.cacheReadTokens">
        <span class="chatui-usage-label">{{ L.usageCache }}</span>
        <span class="chatui-usage-val chatui-usage-cache">{{ fmt(usage!.cacheReadTokens!) }}</span>
      </span>
    </div>
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
  min-height: 30px; flex-shrink: 0;
  background: var(--chatui-bg-surface);
}
.chatui-usage-stats {
  display: flex; align-items: center; gap: 10px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--chatui-fg-secondary);
}
.chatui-usage-item { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.chatui-usage-label { color: var(--chatui-fg-secondary); font-weight: 500; }
.chatui-usage-val { font-weight: 600; }
.chatui-usage-in { color: var(--chatui-usage-input); }
.chatui-usage-out { color: var(--chatui-usage-output); }
.chatui-usage-cache { color: var(--chatui-usage-cache, #22c55e); }
.chatui-usage-op { color: var(--chatui-usage-op); font-size: 10px; }
.chatui-usage-sep { width: 1px; height: 12px; background: var(--chatui-usage-sep); flex-shrink: 0; }
.chatui-toolbar-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.chatui-ctx-bar-wrap { display: flex; align-items: center; gap: 6px; cursor: default; }
.chatui-ctx-bar-track {
  width: 80px; height: 6px; background: var(--chatui-usage-track);
  border-radius: 3px; overflow: hidden;
}
.chatui-ctx-bar-fill { height: 100%; border-radius: 3px; transition: width .3s, background .3s; }
.chatui-ctx-bar-label {
  font-size: 11px; color: var(--chatui-fg-secondary);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
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

.chatui-status-bar.chatui-compact { flex-wrap: wrap; padding: 4px 8px; gap: 6px; }
</style>
