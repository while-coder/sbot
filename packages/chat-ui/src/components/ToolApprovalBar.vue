<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { ToolCallEvent, ToolApprovalPayload, ToolApprovalType, ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = withDefaults(defineProps<{
  toolCall: ToolCallEvent
  labels?: ChatLabels
  initialCountdown?: number
}>(), {
  initialCountdown: 300,
})

const emit = defineEmits<{ approve: [payload: ToolApprovalPayload] }>()
const L = computed(() => resolveLabels(props.labels))

const countdown = ref(props.initialCountdown)
const argsExpanded = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  countdown.value = props.initialCountdown
  timer = setInterval(() => { if (countdown.value > 0) countdown.value-- }, 1000)
}

function stopTimer() {
  if (timer !== null) { clearInterval(timer); timer = null }
}

function approve(type: ToolApprovalType) {
  stopTimer()
  emit('approve', { approvalId: props.toolCall.approvalId, approval: type })
}

function formatArgVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.length} items]`
  return '{…}'
}

watch(() => props.toolCall, () => { argsExpanded.value = false; startTimer() })
onMounted(startTimer)
onUnmounted(stopTimer)
</script>

<template>
  <div class="chatui-tool-approval">
    <div class="chatui-tool-approval-top">
      <span class="chatui-tool-approval-label">{{ L.executeTool }}<strong>{{ toolCall.name }}</strong></span>
      <div class="chatui-tool-approval-btns">
        <button class="chatui-btn-primary chatui-btn-sm" @click="approve('allow')">{{ L.allow }}</button>
        <button class="chatui-btn-outline chatui-btn-sm" @click="approve('alwaysArgs')">{{ L.alwaysAllowArgs }}</button>
        <button class="chatui-btn-outline chatui-btn-sm" @click="approve('alwaysTool')">{{ L.alwaysAllowAll }}</button>
        <button class="chatui-btn-danger chatui-btn-sm" @click="approve('deny')">{{ L.deny }} ({{ countdown }}s)</button>
      </div>
    </div>
    <div v-if="Object.keys(toolCall.args).length" class="chatui-tool-approval-args" @click="argsExpanded = !argsExpanded">
      <span class="chatui-args-toggle">{{ argsExpanded ? '▾' : '▸' }}</span>
      <template v-if="!argsExpanded">
        <span v-for="[k, v] in Object.entries(toolCall.args)" :key="k" class="chatui-args-kv">
          <span class="chatui-args-key">{{ k }}:</span>
          <span class="chatui-args-val">{{ formatArgVal(v) }}</span>
        </span>
      </template>
      <pre v-else class="chatui-args-full" @click.stop>{{ JSON.stringify(toolCall.args, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.chatui-tool-approval {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 16px; background: var(--chatui-approval-bg, #fffbeb);
  border-bottom: 1px solid var(--chatui-approval-border, #fcd34d);
  flex-shrink: 0; font-size: 13px;
}
.chatui-tool-approval-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chatui-tool-approval-label { flex: 1; min-width: 0; color: var(--chatui-fg, #1c1c1c); }
.chatui-tool-approval-btns { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
.chatui-tool-approval-args {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px;
  padding: 4px 8px; background: rgba(254, 249, 195, 0.5); border-radius: 4px;
  font-size: 12px; cursor: pointer; user-select: none;
}
.chatui-args-toggle { color: #92400e; flex-shrink: 0; }
.chatui-args-kv { display: inline-flex; gap: 3px; }
.chatui-args-key { color: #78350f; font-weight: 500; }
.chatui-args-val { color: #44403c; font-family: monospace; word-break: break-all; }
.chatui-args-full {
  margin: 4px 0 0; width: 100%; padding: 6px 8px;
  background: rgba(254, 243, 199, 0.5); border-radius: 4px;
  font-size: 11px; font-family: monospace; white-space: pre-wrap;
  word-break: break-all; max-height: 200px; overflow-y: auto;
  cursor: text; user-select: text;
}
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }
.chatui-btn-primary {
  border: none; border-radius: 6px;
  background: var(--chatui-btn-bg, #1c1c1c); color: var(--chatui-btn-fg, #fff);
  cursor: pointer;
}
.chatui-btn-primary:hover { background: var(--chatui-btn-hover, #333); }
.chatui-btn-outline {
  border: 1px solid var(--chatui-border, #d1d5db); border-radius: 6px;
  background: transparent; cursor: pointer; color: var(--chatui-fg, #374151);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover, #f5f4f2); }
.chatui-btn-danger {
  border: 1px solid var(--chatui-btn-danger, #ef4444); border-radius: 6px;
  background: transparent; cursor: pointer; color: var(--chatui-btn-danger, #ef4444);
}
.chatui-btn-danger:hover { background: rgba(239, 68, 68, 0.08); }
</style>
