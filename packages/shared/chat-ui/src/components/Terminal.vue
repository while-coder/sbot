<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { IChatTransport, ShellOption } from '../transport'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  cwd?: string
  labels?: ChatLabels
}>()

const emit = defineEmits<{
  exit: [code: number | null]
  title: [title: string]
}>()

const L = computed(() => resolveLabels(props.labels))

const hostEl = ref<HTMLElement | null>(null)
const shells = ref<ShellOption[]>([])
const selectedShell = ref<string>('')
const status = ref<'connecting' | 'open' | 'closed' | 'error'>('connecting')
const errorMsg = ref('')

let term: XTerm | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null
let pendingDataHandler: ((data: string) => void) | null = null

function shellLabel(path: string): string {
  return shells.value.find(s => s.path === path)?.label ?? path
}

async function loadShells() {
  if (!props.transport.listShells) return
  try {
    shells.value = await props.transport.listShells()
    if (!selectedShell.value && shells.value[0]) selectedShell.value = shells.value[0].path
  } catch (e) {
    console.error('[Terminal] listShells', e)
  }
}

function dispose() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (ws) {
    try { ws.onclose = null; ws.close() } catch { /* ignore */ }
    ws = null
  }
  if (pendingDataHandler && term) term.onData(() => {})
  pendingDataHandler = null
  fit = null
  term?.dispose()
  term = null
}

function connect() {
  if (!hostEl.value) return
  if (!props.transport.openPty) {
    status.value = 'error'
    errorMsg.value = 'transport.openPty not implemented'
    return
  }

  dispose()

  term = new XTerm({
    cursorBlink: true,
    fontFamily: 'Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    convertEol: false,
    scrollback: 5000,
    theme: { background: '#1e1e1e' },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(hostEl.value)
  fit.fit()
  emit('title', shellLabel(selectedShell.value))

  status.value = 'connecting'
  errorMsg.value = ''
  ws = props.transport.openPty()

  ws.onopen = () => {
    const { cols, rows } = term!
    ws!.send(JSON.stringify({
      type: 'open',
      shell: selectedShell.value || undefined,
      cwd: props.cwd,
      cols, rows,
    }))
  }

  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') {
      // Binary frames are not used by the server today, but pass through if seen.
      if (e.data instanceof Blob) e.data.text().then(t => term?.write(t))
      else if (e.data instanceof ArrayBuffer) term?.write(new Uint8Array(e.data) as unknown as string)
      return
    }
    // Most server → client frames are raw pty bytes (text). Control frames are JSON
    // and start with '{' — identify them quickly without parsing every chunk.
    if (e.data.startsWith('{')) {
      try {
        const msg = JSON.parse(e.data)
        if (msg && typeof msg.type === 'string') {
          if (msg.type === 'ready') { status.value = 'open'; return }
          if (msg.type === 'exit') {
            status.value = 'closed'
            term?.write(`\r\n\x1b[90m[process exited with code ${msg.code ?? 0}]\x1b[0m\r\n`)
            emit('exit', typeof msg.code === 'number' ? msg.code : null)
            return
          }
          if (msg.type === 'error') {
            status.value = 'error'
            errorMsg.value = String(msg.message ?? 'pty error')
            return
          }
        }
      } catch { /* not JSON, fall through */ }
    }
    term?.write(e.data)
  }

  ws.onerror = () => {
    status.value = 'error'
    if (!errorMsg.value) errorMsg.value = 'WebSocket error'
  }

  ws.onclose = () => {
    if (status.value !== 'closed') status.value = 'closed'
  }

  pendingDataHandler = (data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
    }
  }
  term.onData(pendingDataHandler)

  resizeObserver = new ResizeObserver(() => {
    if (!fit || !term) return
    try {
      fit.fit()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    } catch { /* ignore transient layout errors */ }
  })
  resizeObserver.observe(hostEl.value)
}

function reconnect() {
  connect()
}

watch(selectedShell, (v, prev) => {
  if (prev && v && v !== prev) connect()
})

onMounted(async () => {
  await loadShells()
  connect()
})

onBeforeUnmount(() => {
  dispose()
})

defineExpose({ focus: () => term?.focus(), reconnect })
</script>

<template>
  <div class="chatui-terminal">
    <div class="chatui-terminal-toolbar">
      <select
        v-if="shells.length > 0"
        v-model="selectedShell"
        class="chatui-terminal-shell"
        :title="L.terminalShell"
      >
        <option v-for="s in shells" :key="s.path" :value="s.path">{{ s.label }}</option>
      </select>
      <span v-else class="chatui-terminal-shell-empty">{{ L.terminalNoShell }}</span>

      <span class="chatui-terminal-status" :data-status="status">
        <template v-if="status === 'connecting'">●</template>
        <template v-else-if="status === 'open'">●</template>
        <template v-else-if="status === 'closed'">●</template>
        <template v-else>●</template>
      </span>

      <button
        v-if="status === 'closed' || status === 'error'"
        type="button"
        class="chatui-terminal-reconnect"
        :title="L.terminalReconnect"
        @click="reconnect"
      >↻</button>
    </div>

    <div v-if="errorMsg" class="chatui-terminal-error">{{ errorMsg }}</div>

    <div ref="hostEl" class="chatui-terminal-host" />
  </div>
</template>

<style scoped>
.chatui-terminal {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #1e1e1e;
}
.chatui-terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--chatui-bg-surface);
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
}
.chatui-terminal-shell {
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--chatui-border);
  background: var(--chatui-bg);
  color: var(--chatui-fg);
  font: inherit;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  outline: none;
}
.chatui-terminal-shell-empty {
  font-size: 12px;
  color: var(--chatui-fg-secondary);
}
.chatui-terminal-status {
  font-size: 10px;
  line-height: 1;
  margin-left: auto;
}
.chatui-terminal-status[data-status="connecting"] { color: #d6a341; }
.chatui-terminal-status[data-status="open"]       { color: #43a047; }
.chatui-terminal-status[data-status="closed"]     { color: var(--chatui-fg-secondary); }
.chatui-terminal-status[data-status="error"]      { color: #e57373; }
.chatui-terminal-reconnect {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--chatui-border);
  background: var(--chatui-bg);
  color: var(--chatui-fg-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.chatui-terminal-reconnect:hover { background: var(--chatui-bg-hover); color: var(--chatui-fg); }
.chatui-terminal-error {
  padding: 6px 10px;
  font-size: 12px;
  background: rgba(229, 115, 115, 0.12);
  color: #e57373;
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
}
.chatui-terminal-host {
  flex: 1;
  min-height: 0;
  padding: 4px 0 0 6px;
  overflow: hidden;
}
.chatui-terminal-host :deep(.xterm) {
  height: 100%;
}
.chatui-terminal-host :deep(.xterm .xterm-viewport) {
  background-color: transparent !important;
}
</style>
