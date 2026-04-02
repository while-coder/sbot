<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { MessageRole } from '@/types'
import type { StoredMessage, ToolCall } from '@/types'

const props = defineProps<{
  thinksUrlPrefix: string
}>()

// ── Drawer state ──
const visible = ref(false)
/** Stack of think layers: each has id + loaded messages */
const thinkStack = ref<{ id: string; messages: StoredMessage[]; loading: boolean }[]>([])

const drawerEl = ref<HTMLElement | null>(null)

function renderMd(content: string | any[] | undefined | null): string {
  if (!content) return ''
  if (Array.isArray(content)) {
    return marked.parse(
      content
        .filter((c: any) => typeof c === 'string' || c?.type === 'text')
        .map((c: any) => (typeof c === 'string' ? c : c.text ?? ''))
        .join('\n')
    ) as string
  }
  return marked.parse(content) as string
}

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

/** Open drawer with a think id (push to stack) */
async function open(thinkId: string) {
  // Check if already in stack
  const existing = thinkStack.value.find(s => s.id === thinkId)
  if (existing) return

  thinkStack.value.push({ id: thinkId, messages: [] as StoredMessage[], loading: true })
  visible.value = true

  // Access through the reactive array so mutations are tracked
  const layer = thinkStack.value[thinkStack.value.length - 1]
  try {
    const res = await apiFetch(`${props.thinksUrlPrefix}/${encodeURIComponent(thinkId)}`)
    layer.messages = res.data || []
  } catch {
    layer.messages = []
  } finally {
    layer.loading = false
  }
  await nextTick()
  // Scroll to new layer
  if (drawerEl.value) {
    drawerEl.value.scrollTop = drawerEl.value.scrollHeight
  }
}

/** Pop a layer from the stack */
function popLayer() {
  thinkStack.value.pop()
  if (thinkStack.value.length === 0) {
    visible.value = false
  }
}

function close() {
  visible.value = false
  thinkStack.value = []
}

/** Handle nested think click */
function onNestedThink(thinkId: string) {
  open(thinkId)
}

defineExpose({ open })
</script>

<template>
  <!-- Backdrop -->
  <Teleport to="body">
    <Transition name="think-drawer">
      <div v-if="visible" class="think-drawer-backdrop" @click="close">
        <div class="think-drawer" ref="drawerEl" @click.stop>
          <!-- Header -->
          <div class="think-drawer-header">
            <button v-if="thinkStack.length > 1" class="think-drawer-back" @click="popLayer" title="Back">
              ←
            </button>
            <span class="think-drawer-title">
              Think
              <span v-if="thinkStack.length > 1" class="think-drawer-depth">({{ thinkStack.length }} layers)</span>
            </span>
            <button class="think-drawer-close" @click="close">×</button>
          </div>

          <!-- Breadcrumb -->
          <div v-if="thinkStack.length > 1" class="think-drawer-breadcrumb">
            <span v-for="(layer, i) in thinkStack" :key="layer.id" class="think-breadcrumb-item">
              <span v-if="i > 0" class="think-breadcrumb-sep">›</span>
              <span :class="{ active: i === thinkStack.length - 1 }">Think #{{ i + 1 }}</span>
            </span>
          </div>

          <!-- Content: show current (last) layer -->
          <div class="think-drawer-body">
            <template v-if="thinkStack.length > 0">
              <div v-if="thinkStack[thinkStack.length - 1].loading" class="think-drawer-loading">
                Loading...
              </div>
              <div v-else class="history-messages">
                <template v-for="(tm, ti) in thinkStack[thinkStack.length - 1].messages" :key="ti">
                  <template v-if="tm.message.role !== MessageRole.Tool">
                    <div v-if="tm.message.role === MessageRole.Human" class="msg-row human">
                      <div class="msg-bubble human">
                        <div class="msg-role-bar">
                          <span class="msg-role">User</span>
                        </div>
                        {{ tm.message.content }}
                      </div>
                    </div>
                    <div v-else-if="tm.message.role === MessageRole.AI" class="msg-row ai">
                      <div v-if="tm.message.content" class="msg-bubble ai">
                        <div class="msg-role-bar">
                          <span class="msg-role">AI</span>
                        </div>
                        <div class="md-content" v-html="renderMd(tm.message.content)" />
                      </div>
                      <div v-if="tm.message.tool_calls && tm.message.tool_calls.length > 0" class="msg-tool-calls">
                        <div class="msg-role" style="display:flex;align-items:center;gap:6px">
                          Tool Calls ({{ tm.message.tool_calls.length }})
                          <div v-if="tm.thinkId" class="think-toggle" @click="onNestedThink(tm.thinkId!)">
                            <span>▸</span>
                            <span>Think</span>
                          </div>
                        </div>
                        <div v-for="ttc in tm.message.tool_calls" :key="(ttc as ToolCall).id" class="tool-call-item">
                          <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                            <span class="tool-call-name">{{ (ttc as ToolCall).name }}</span>
                          </div>
                          <div class="tool-call-detail">
                            <div class="tool-call-args">{{ JSON.stringify((ttc as ToolCall).args, null, 2) }}</div>
                            <template v-for="m2 in thinkStack[thinkStack.length - 1].messages" :key="'r' + (m2.message.tool_call_id || '')">
                              <div v-if="m2.message.role === MessageRole.Tool && m2.message.tool_call_id === (ttc as ToolCall).id" class="tool-call-result">
                                <div class="tool-call-result-top">
                                  <div class="tool-call-result-label">Result</div>
                                  <div v-if="m2.thinkId" class="think-toggle" @click="onNestedThink(m2.thinkId!)">
                                    <span>▸</span>
                                    <span>Think</span>
                                  </div>
                                </div>
                                <div class="md-content tool-result-content" v-html="renderMd(m2.message.content || '')" />
                              </div>
                            </template>
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </template>
              </div>
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
  background: #fff;
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
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  background: #f9fafb;
}

.think-drawer-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: #374151;
}

.think-drawer-depth {
  font-weight: 400;
  font-size: 12px;
  color: #9ca3af;
  margin-left: 4px;
}

.think-drawer-back,
.think-drawer-close {
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  color: #6b7280;
  flex-shrink: 0;
}

.think-drawer-back:hover,
.think-drawer-close:hover {
  background: #f3f4f6;
  color: #374151;
}

.think-drawer-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  font-size: 11px;
  color: #9ca3af;
  background: #fafafa;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}

.think-breadcrumb-sep {
  color: #d1d5db;
  margin: 0 2px;
}

.think-breadcrumb-item .active {
  color: #374151;
  font-weight: 500;
}

.think-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.think-drawer-loading {
  text-align: center;
  color: #9ca3af;
  padding: 40px 0;
  font-size: 13px;
}

/* Transitions */
.think-drawer-enter-active,
.think-drawer-leave-active {
  transition: opacity 0.2s ease;
}
.think-drawer-enter-active .think-drawer,
.think-drawer-leave-active .think-drawer {
  transition: transform 0.25s ease;
}
.think-drawer-enter-from,
.think-drawer-leave-to {
  opacity: 0;
}
.think-drawer-enter-from .think-drawer,
.think-drawer-leave-to .think-drawer {
  transform: translateX(-100%);
}
</style>
