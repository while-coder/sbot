<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { MessageRole, ContentPartType } from '../types'
import type { StoredMessage, ToolCall, ChatLabels } from '../types'
import { getContentParts, renderMd } from '../messageRender'
import { inlineArgs, resultPreview } from '../toolCallFormat'
import { resolveLabels } from '../labels'

const props = withDefaults(defineProps<{
  thinksUrlPrefix: string
  labels?: ChatLabels
  fetchFn?: (url: string) => Promise<any>
}>(), {
  fetchFn: undefined,
})

const L = computed(() => resolveLabels(props.labels))

const visible = ref(false)
const thinkStack = ref<{ id: string; messages: StoredMessage[]; loading: boolean }[]>([])
const drawerEl = ref<HTMLElement | null>(null)
const lightboxUrl = ref<string | null>(null)

function doFetch(url: string): Promise<any> {
  if (props.fetchFn) return props.fetchFn(url)
  return fetch(url).then(r => r.json())
}

function toggleTc(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

async function open(thinkId: string) {
  const existing = thinkStack.value.find(s => s.id === thinkId)
  if (existing) return

  thinkStack.value.push({ id: thinkId, messages: [] as StoredMessage[], loading: true })
  visible.value = true

  const layer = thinkStack.value[thinkStack.value.length - 1]
  try {
    const res = await doFetch(`${props.thinksUrlPrefix}/${encodeURIComponent(thinkId)}`)
    layer.messages = res.data || []
  } catch {
    layer.messages = []
  } finally {
    layer.loading = false
  }
  await nextTick()
  if (drawerEl.value) {
    drawerEl.value.scrollTop = drawerEl.value.scrollHeight
  }
}

function popLayer() {
  thinkStack.value.pop()
  if (thinkStack.value.length === 0) visible.value = false
}

function close() {
  visible.value = false
  thinkStack.value = []
}

function onNestedThink(thinkId: string) {
  open(thinkId)
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <Transition name="think-drawer">
      <div v-if="visible" class="think-drawer-backdrop" @click="close">
        <div class="think-drawer" ref="drawerEl" @click.stop>
          <div class="think-drawer-header">
            <button v-if="thinkStack.length > 1" class="think-drawer-back" @click="popLayer">←</button>
            <span class="think-drawer-title">
              {{ L.think }}
              <span v-if="thinkStack.length > 1" class="think-drawer-depth">({{ thinkStack.length }} layers)</span>
            </span>
            <button class="think-drawer-close" @click="close">×</button>
          </div>

          <div v-if="thinkStack.length > 1" class="think-drawer-breadcrumb">
            <span v-for="(layer, i) in thinkStack" :key="layer.id" class="think-breadcrumb-item">
              <span v-if="i > 0" class="think-breadcrumb-sep">›</span>
              <span :class="{ active: i === thinkStack.length - 1 }">Think #{{ i + 1 }}</span>
            </span>
          </div>

          <div class="think-drawer-body">
            <template v-if="thinkStack.length > 0">
              <div v-if="thinkStack[thinkStack.length - 1].loading" class="think-drawer-loading">
                {{ L.loading }}
              </div>
              <div v-else class="think-messages">
                <template v-for="(tm, ti) in thinkStack[thinkStack.length - 1].messages" :key="ti">
                  <template v-if="tm.message.role !== MessageRole.Tool">
                    <!-- Human -->
                    <div v-if="tm.message.role === MessageRole.Human" class="msg-row human">
                      <div class="msg-bubble human">
                        <div class="msg-role-bar"><span class="msg-role">{{ L.roleUser }}</span></div>
                        <template v-for="(part, pIdx) in getContentParts(tm.message.content)" :key="pIdx">
                          <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
                          <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                            <img :src="part.url" class="inline-image-thumb" @click="lightboxUrl = part.url!" />
                          </div>
                          <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                            <audio controls :src="part.url" />
                          </div>
                        </template>
                      </div>
                    </div>
                    <!-- AI -->
                    <div v-else-if="tm.message.role === MessageRole.AI" class="msg-row ai">
                      <div v-if="tm.message.content" class="msg-bubble ai">
                        <div class="msg-role-bar"><span class="msg-role">{{ L.roleAi }}</span></div>
                        <template v-for="(part, pIdx) in getContentParts(tm.message.content)" :key="pIdx">
                          <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
                          <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                            <img :src="part.url" class="inline-image-thumb" @click="lightboxUrl = part.url!" />
                          </div>
                          <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                            <audio controls :src="part.url" />
                          </div>
                        </template>
                      </div>
                      <!-- Tool calls -->
                      <div v-if="tm.message.tool_calls && tm.message.tool_calls.length > 0" class="msg-tool-calls">
                        <div class="msg-role has-think">
                          {{ L.toolCalls?.replace('{count}', String(tm.message.tool_calls.length)) }}
                          <div v-if="tm.thinkId" class="think-toggle" @click="onNestedThink(tm.thinkId!)">
                            <span>▸</span><span>{{ L.think }}</span>
                          </div>
                        </div>
                        <div v-for="ttc in tm.message.tool_calls" :key="(ttc as ToolCall).id" class="tool-call-item">
                          <div class="tool-call-header" @click="toggleTc($event.currentTarget as HTMLElement)">
                            <span class="tool-call-name">{{ (ttc as ToolCall).name }}</span>
                            <span v-if="inlineArgs(ttc as ToolCall)" class="tool-call-inline-args">{{ inlineArgs(ttc as ToolCall) }}</span>
                            <span v-if="resultPreview(thinkStack[thinkStack.length - 1].messages, (ttc as ToolCall).id)" class="tool-call-result-preview">↳ {{ resultPreview(thinkStack[thinkStack.length - 1].messages, (ttc as ToolCall).id) }}</span>
                          </div>
                          <div class="tool-call-detail">
                            <div class="tool-call-args">{{ JSON.stringify((ttc as ToolCall).args, null, 2) }}</div>
                            <template v-for="m2 in thinkStack[thinkStack.length - 1].messages" :key="'r' + (m2.message.tool_call_id || '')">
                              <div v-if="m2.message.role === MessageRole.Tool && m2.message.tool_call_id === (ttc as ToolCall).id" class="tool-call-result">
                                <div class="tool-call-result-top">
                                  <div class="tool-call-result-label">{{ L.toolResult }}</div>
                                  <div v-if="m2.thinkId" class="think-toggle" @click="onNestedThink(m2.thinkId!)">
                                    <span>▸</span><span>{{ L.think }}</span>
                                  </div>
                                </div>
                                <template v-for="(part, pIdx) in getContentParts(m2.message.content)" :key="'tr' + pIdx">
                                  <div v-if="part.type === ContentPartType.Text" class="md-content tool-result-content" v-html="renderMd(part.text)" />
                                  <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                                    <img :src="part.url" class="inline-image-thumb" @click="lightboxUrl = part.url!" />
                                  </div>
                                  <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                                    <audio controls :src="part.url" />
                                  </div>
                                </template>
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

    <div v-if="lightboxUrl" class="think-lightbox-backdrop" @click="lightboxUrl = null">
      <img :src="lightboxUrl" class="think-lightbox-img" @click.stop />
    </div>
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
  background: var(--chatui-bg-surface, var(--vscode-editor-background, #fff));
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
  border-bottom: 1px solid var(--chatui-border, var(--vscode-widget-border, #e5e7eb));
  flex-shrink: 0;
}
.think-drawer-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
}
.think-drawer-depth {
  font-weight: 400;
  font-size: 12px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  margin-left: 4px;
}
.think-drawer-back,
.think-drawer-close {
  background: none;
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, #e5e7eb));
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #6b7280));
  flex-shrink: 0;
}
.think-drawer-back:hover,
.think-drawer-close:hover {
  background: var(--chatui-bg-ai, var(--vscode-list-hoverBackground, #f3f4f6));
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
}
.think-drawer-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  font-size: 11px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  border-bottom: 1px solid var(--chatui-border, var(--vscode-widget-border, #f3f4f6));
  flex-shrink: 0;
}
.think-breadcrumb-sep { margin: 0 2px; }
.think-breadcrumb-item .active {
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
  font-weight: 500;
}
.think-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.think-drawer-loading {
  text-align: center;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  padding: 40px 0;
  font-size: 13px;
}
.think-messages { display: flex; flex-direction: column; gap: 2px; }

/* Message rows — same as MessageList */
.msg-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.msg-row.human { align-items: flex-end; }
.msg-row.ai { align-items: flex-start; }

/* Bubbles */
.msg-bubble {
  max-width: 95%;
  padding: 8px 12px;
  border-radius: 8px;
  line-height: 1.5;
  word-break: break-word;
}
.msg-bubble.human {
  background: var(--chatui-bg-human, var(--vscode-button-background, #1c1c1c));
  color: var(--chatui-fg-human, var(--vscode-button-foreground, #fff));
  border-bottom-right-radius: 2px;
}
.msg-bubble.ai {
  background: var(--chatui-bg-ai, var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.08)));
  color: var(--chatui-fg-ai, var(--vscode-foreground, #1c1c1c));
  border-bottom-left-radius: 2px;
}

/* Role bar */
.msg-role-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.msg-role {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #6b7280));
}

/* Markdown content */
.md-content :deep(p) { margin: 0 0 6px; }
.md-content :deep(p:last-child) { margin-bottom: 0; }
.md-content :deep(pre) {
  background: var(--chatui-bg-code, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2)));
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}
.md-content :deep(code) {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.9em;
}
.md-content :deep(:not(pre) > code) {
  background: var(--chatui-bg-code, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2)));
  padding: 1px 4px;
  border-radius: 3px;
}
.md-content :deep(ul), .md-content :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.md-content :deep(blockquote) {
  border-left: 3px solid var(--vscode-textBlockQuote-border, #555);
  padding: 2px 10px;
  margin: 4px 0;
  opacity: 0.85;
}

/* Inline media */
.inline-image { margin: 6px 0; }
.inline-image-thumb {
  max-width: 240px;
  max-height: 240px;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.inline-image-thumb:hover { opacity: 0.85; }
.inline-audio { margin: 6px 0; }
.inline-audio audio { max-width: 100%; border-radius: 6px; }

/* Tool calls */
.msg-tool-calls {
  background: var(--chatui-bg-ai, var(--vscode-editor-inactiveSelectionBackground, rgba(0,0,0,0.04)));
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 6px;
  font-size: 12px;
  max-width: 95%;
}
.msg-role.has-think {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-call-item {
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  border-radius: 6px;
  margin-top: 6px;
  overflow: hidden;
}
.tool-call-header {
  padding: 6px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  user-select: none;
}
.tool-call-header::after {
  content: '▶';
  font-size: 10px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9b9b9b));
  margin-left: auto;
}
.tool-call-header.expanded::after { content: '▼'; }
.tool-call-name {
  font-family: monospace;
  font-size: 12px;
}
.tool-call-inline-args {
  font-family: monospace;
  font-size: 11px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #7a7a7a));
}
.tool-call-result-preview {
  font-size: 11px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9b9b9b));
}
.tool-call-header.expanded .tool-call-result-preview { display: none; }
.tool-call-detail { display: none; }
.tool-call-detail.show { display: block; }
.tool-call-args {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--chatui-fg-primary, var(--vscode-foreground, #3d3d3d));
  background: var(--chatui-bg-code, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.04)));
  padding: 6px 8px;
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
}
.tool-call-result {
  padding: 8px;
  border-top: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
}
.tool-call-result-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.tool-call-result-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #6b7280));
}
.tool-result-content { font-size: 12px; }

/* Think toggle */
.think-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--chatui-think-fg, #7c3aed);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  background: var(--chatui-think-bg, rgba(124, 58, 237, 0.1));
  border: 1px solid var(--chatui-think-border, rgba(124, 58, 237, 0.25));
  transition: all 0.15s ease;
  white-space: nowrap;
}
.think-toggle:hover {
  background: rgba(124, 58, 237, 0.18);
}

/* Lightbox */
.think-lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.think-lightbox-img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  cursor: default;
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
