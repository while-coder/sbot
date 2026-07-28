<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import type { StoredMessage, ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import MessageList from './MessageList.vue'

const props = withDefaults(defineProps<{
  thinksUrlPrefix: string
  tasksUrlPrefix?: string | null
  labels?: ChatLabels
  fetchFn?: (url: string) => Promise<any>
}>(), {
  tasksUrlPrefix: null,
  fetchFn: undefined,
})

const L = computed(() => resolveLabels(props.labels))

interface ThinkLayer {
  id: string
  messages: StoredMessage[]
  loading: boolean
  taskId: string | null
  view: 'think' | 'task'
  taskMessages: StoredMessage[]
  taskLoading: boolean
  taskLoaded: boolean
  /** 子任务仍在执行：定时重拉 `/thinks/:id`，让思考过程实时增长 */
  live: boolean
  timer: ReturnType<typeof setInterval> | null
  /** 已轮询次数，达上限后自停，防止子任务异常未收尾时无限拉取 */
  polls: number
}

/** 轮询间隔与上限（2.5s × 240 ≈ 10 分钟） */
const POLL_INTERVAL_MS = 2500
const POLL_MAX = 240

const visible = ref(false)
const thinkStack = ref<ThinkLayer[]>([])
const bodyEl = ref<HTMLElement | null>(null)

function doFetch(url: string): Promise<any> {
  if (props.fetchFn) return props.fetchFn(url)
  return fetch(url).then(r => r.json())
}

/** 距底部 40px 内视为“贴底”，此时新内容才自动滚动，避免打断向上翻阅 */
function isAtBottom(): boolean {
  const el = bodyEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function scrollToBottom() {
  await nextTick()
  const el = bodyEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 拉取一层的 think 消息。`silent` 用于轮询：不打 loading 态，避免列表闪烁。 */
async function loadThink(layer: ThinkLayer, silent = false) {
  if (!silent) layer.loading = true
  const stick = silent ? isAtBottom() : true
  try {
    const res = await doFetch(`${props.thinksUrlPrefix}/${encodeURIComponent(layer.id)}`)
    const payload = res.data
    layer.messages = Array.isArray(payload) ? payload : (payload?.messages || [])
  } catch {
    if (!silent) layer.messages = []
  } finally {
    layer.loading = false
  }
  if (stick) await scrollToBottom()
}

function stopPolling(layer: ThinkLayer) {
  if (layer.timer) {
    clearInterval(layer.timer)
    layer.timer = null
  }
  layer.live = false
}

function startPolling(layer: ThinkLayer) {
  if (layer.timer) return
  layer.live = true
  layer.polls = 0
  layer.timer = setInterval(() => {
    if (layer.polls >= POLL_MAX) { stopPolling(layer); return }
    layer.polls++
    // task 视图不参与轮询（子任务历史与 think 同源，切回时按需加载）
    if (layer.view === 'think') void loadThink(layer, true)
  }, POLL_INTERVAL_MS)
}

/** 供外部（MessageList）在子任务结束/开始时切换轮询 */
function setLive(thinkId: string, live: boolean) {
  const layer = thinkStack.value.find(s => s.id === thinkId)
  if (!layer) return
  if (live) startPolling(layer)
  else {
    stopPolling(layer)
    void loadThink(layer, true)   // 停轮询前补最后一拉，确保收尾内容不丢
  }
}

async function open(thinkId: string, taskId?: string, opts?: { live?: boolean }) {
  const existing = thinkStack.value.find(s => s.id === thinkId)
  if (existing) {
    // 该层已在栈中：仅在需要时补启轮询（例如结果未到、用户重新点入）
    if (opts?.live) startPolling(existing)
    return
  }

  thinkStack.value.push({
    id: thinkId,
    messages: [],
    loading: true,
    taskId: taskId ?? null,
    view: 'think',
    taskMessages: [],
    taskLoading: false,
    taskLoaded: false,
    live: false,
    timer: null,
    polls: 0,
  })
  visible.value = true

  // 必须从 ref 中取回响应式代理再改（直接改字面量对象不会触发更新）
  const layer = thinkStack.value[thinkStack.value.length - 1]
  await loadThink(layer)
  if (opts?.live) startPolling(layer)
}

async function loadTask(layer: ThinkLayer) {
  if (!layer.taskId || !props.tasksUrlPrefix || layer.taskLoaded || layer.taskLoading) return
  layer.taskLoading = true
  try {
    const res = await doFetch(`${props.tasksUrlPrefix}/${encodeURIComponent(layer.taskId)}`)
    const payload = res.data
    layer.taskMessages = Array.isArray(payload) ? payload : (payload?.messages || [])
    layer.taskLoaded = true
  } catch {
    layer.taskMessages = []
  } finally {
    layer.taskLoading = false
  }
}

async function setView(layer: ThinkLayer, view: 'think' | 'task') {
  if (layer.view === view) return
  layer.view = view
  if (view === 'task') await loadTask(layer)
}

function popLayer() {
  const layer = thinkStack.value.pop()
  if (layer) stopPolling(layer)
  if (thinkStack.value.length === 0) visible.value = false
}

function close() {
  visible.value = false
  thinkStack.value.forEach(stopPolling)
  thinkStack.value = []
}

onUnmounted(() => thinkStack.value.forEach(stopPolling))

const currentLayer = computed(() => thinkStack.value[thinkStack.value.length - 1])
const currentMessages = computed(() => {
  const l = currentLayer.value
  if (!l) return []
  return l.view === 'task' ? l.taskMessages : l.messages
})
const currentLoading = computed(() => {
  const l = currentLayer.value
  if (!l) return false
  return l.view === 'task' ? l.taskLoading : l.loading
})
const showTabs = computed(() => {
  const l = currentLayer.value
  return !!(l && l.taskId && props.tasksUrlPrefix)
})

function refreshCurrent() {
  const l = currentLayer.value
  if (!l) return
  if (l.view === 'task') {
    l.taskLoaded = false
    void loadTask(l)
  } else {
    void loadThink(l, true)
  }
}

defineExpose({ open, setLive })
</script>

<template>
  <Teleport to="body">
    <Transition name="think-drawer">
      <div v-if="visible" class="think-drawer-backdrop" @click="close">
        <div class="think-drawer" @click.stop>
          <div class="think-drawer-header">
            <button v-if="thinkStack.length > 1" class="think-drawer-back" @click="popLayer">←</button>
            <span class="think-drawer-title">
              {{ L.think }}
              <span v-if="thinkStack.length > 1" class="think-drawer-depth">({{ thinkStack.length }} layers)</span>
              <span v-if="currentLayer?.live" class="think-drawer-live">
                <span class="think-live-dot" />{{ L.thinking }}
              </span>
            </span>
            <button class="think-drawer-refresh" :title="L.refresh" @click="refreshCurrent">⟳</button>
            <button class="think-drawer-close" @click="close">×</button>
          </div>

          <div v-if="showTabs && currentLayer" class="think-drawer-tabs">
            <button
              type="button"
              class="think-drawer-tab"
              :class="{ active: currentLayer.view === 'think' }"
              @click="setView(currentLayer, 'think')"
            >
              {{ L.think }}
              <span class="tab-count">{{ currentLayer.messages.length }}</span>
            </button>
            <button
              type="button"
              class="think-drawer-tab"
              :class="{ active: currentLayer.view === 'task' }"
              @click="setView(currentLayer, 'task')"
            >
              Task
              <span v-if="currentLayer.taskLoaded" class="tab-count">{{ currentLayer.taskMessages.length }}</span>
            </button>
          </div>

          <div v-if="thinkStack.length > 1" class="think-drawer-breadcrumb">
            <span v-for="(layer, i) in thinkStack" :key="layer.id" class="think-breadcrumb-item">
              <span v-if="i > 0" class="think-breadcrumb-sep">›</span>
              <span :class="{ active: i === thinkStack.length - 1 }">Think #{{ i + 1 }}</span>
            </span>
          </div>

          <div class="think-drawer-body" ref="bodyEl">
            <template v-if="currentLayer">
              <div v-if="currentLoading" class="think-drawer-loading">
                {{ L.loading }}
              </div>
              <MessageList
                v-else
                :messages="currentMessages"
                :thinks-url-prefix="thinksUrlPrefix"
                :tasks-url-prefix="tasksUrlPrefix"
                :labels="labels"
                :fetch-fn="fetchFn"
                :on-think-click="open"
              />
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.think-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
}
.think-drawer {
  width: min(560px, 85vw);
  height: 100%;
  background: var(--chatui-bg-surface);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.think-drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--chatui-border);
  flex-shrink: 0;
}
.think-drawer-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: var(--chatui-fg-primary);
}
.think-drawer-depth {
  font-weight: 400;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
  margin-left: 4px;
}
.think-drawer-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  font-weight: 400;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
}
.think-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--chatui-accent, #3b82f6);
  animation: think-live-pulse 1.2s ease-in-out infinite;
}
@keyframes think-live-pulse {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}
.think-drawer-back,
.think-drawer-refresh,
.think-drawer-close {
  background: none;
  border: 1px solid var(--chatui-border);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  color: var(--chatui-fg-secondary);
  flex-shrink: 0;
}
.think-drawer-back:hover,
.think-drawer-refresh:hover,
.think-drawer-close:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg-primary);
}
.think-drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--chatui-border-subtle);
  flex-shrink: 0;
}
.think-drawer-tab {
  flex: 0 0 auto;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.think-drawer-tab:hover {
  background: var(--chatui-bg-hover);
  color: var(--chatui-fg-primary);
}
.think-drawer-tab.active {
  background: var(--chatui-bg-active);
  color: var(--chatui-fg-primary);
  border-color: var(--chatui-border);
}
.think-drawer-tab .tab-count {
  font-size: 11px;
  color: var(--chatui-fg-secondary);
  background: var(--chatui-bg-hover);
  border-radius: 8px;
  padding: 0 6px;
}
.think-drawer-tab.active .tab-count {
  background: var(--chatui-bg-surface);
}
.think-drawer-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  font-size: 11px;
  color: var(--chatui-fg-secondary);
  border-bottom: 1px solid var(--chatui-border-subtle);
  flex-shrink: 0;
}
.think-breadcrumb-sep { margin: 0 2px; }
.think-breadcrumb-item .active {
  color: var(--chatui-fg-primary);
  font-weight: 500;
}
.think-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.think-drawer-loading {
  text-align: center;
  color: var(--chatui-fg-secondary);
  padding: 40px 0;
  font-size: 13px;
}

/* Transitions */
.think-drawer-enter-active,
.think-drawer-leave-active { transition: opacity 0.2s ease; }
.think-drawer-enter-active .think-drawer,
.think-drawer-leave-active .think-drawer { transition: transform 0.25s ease; }
.think-drawer-enter-from,
.think-drawer-leave-to { opacity: 0; }
.think-drawer-enter-from .think-drawer,
.think-drawer-leave-to .think-drawer { transform: translateX(-100%); }
</style>
