<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { SButton } from 'sbot-ui'
import type { ToolCallEvent, ToolApprovalPayload, ToolApprovalType, ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  toolCall: ToolCallEvent
  labels?: ChatLabels
}>()

const emit = defineEmits<{ approve: [payload: ToolApprovalPayload] }>()
const L = computed(() => resolveLabels(props.labels))

const countdown = ref(0)
const argsExpanded = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const hasCountdown = computed(() => (props.toolCall.remainSec ?? 0) > 0)
const timeoutOn = computed<ToolApprovalType>(() => props.toolCall.timeoutValue === 'allow' ? 'allow' : 'deny')

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function startTimer() {
  stopTimer()
  countdown.value = props.toolCall.remainSec ?? 0
  if (countdown.value <= 0) return
  timer = setInterval(() => { if (countdown.value > 0) countdown.value-- }, 1000)
}

function approve(type: ToolApprovalType) {
  stopTimer()
  emit('approve', { approvalId: props.toolCall.approvalId, approval: type })
}

function formatArgVal(v: unknown): string {
  if (v == null) return 'null'
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
        <SButton size="sm" @click="approve('allow')">{{ L.allow }}<span v-if="hasCountdown && timeoutOn === 'allow'"> ({{ countdown }}s)</span></SButton>
        <SButton type="outline" size="sm" @click="approve('alwaysArgs')">{{ L.alwaysAllowArgs }}</SButton>
        <SButton type="outline" size="sm" @click="approve('alwaysTool')">{{ L.alwaysAllowAll }}</SButton>
        <SButton type="danger" size="sm" @click="approve('deny')">{{ L.deny }}<span v-if="hasCountdown && timeoutOn === 'deny'"> ({{ countdown }}s)</span></SButton>
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
  padding: 8px 16px; background: var(--chatui-approval-bg);
  border-bottom: 1px solid var(--chatui-approval-border);
  flex-shrink: 0; font-size: 13px;
}
.chatui-tool-approval-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chatui-tool-approval-label { flex: 1; min-width: 0; color: var(--chatui-fg); }
.chatui-tool-approval-btns { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
.chatui-tool-approval-args {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px;
  padding: 4px 8px; background: var(--chatui-approval-args-bg); border-radius: 4px;
  font-size: 12px; cursor: pointer; user-select: none;
}
.chatui-args-toggle { color: var(--chatui-approval-toggle); flex-shrink: 0; }
.chatui-args-kv { display: inline-flex; gap: 3px; }
.chatui-args-key { color: var(--chatui-approval-key); font-weight: 500; }
.chatui-args-val { color: var(--chatui-approval-val); font-family: monospace; word-break: break-all; }
.chatui-args-full {
  margin: 4px 0 0; width: 100%; padding: 6px 8px;
  background: var(--chatui-approval-full-bg); border-radius: 4px;
  font-size: 11px; font-family: monospace; white-space: pre-wrap;
  word-break: break-all; max-height: 200px; overflow-y: auto;
  cursor: text; user-select: text;
}
</style>
