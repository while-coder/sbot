<script setup lang="ts">
import { ref, computed } from 'vue'
import { MessageRole, ContentPartType } from '../types'
import type { StoredMessage, ToolCall, ChatLabels } from '../types'
import { getContentParts, renderMd, fmtTs, fmtDateSep, toggleToolCall } from '../messageRender'
import { inlineArgs, resultPreview } from '../toolCallFormat'
import { resolveLabels, tpl } from '../labels'
import ThinkDrawer from './ThinkDrawer.vue'
import ImageLightbox from './ImageLightbox.vue'

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  thinksUrlPrefix?: string | null
  showDateSeparators?: boolean
  isStreaming?: boolean
  streamingContent?: string | any[]
  queuedMessages?: (string | any[])[]
  labels?: ChatLabels
  fetchFn?: (url: string) => Promise<any>
  onThinkClick?: (thinkId: string) => void
}>(), {
  thinksUrlPrefix: null,
  showDateSeparators: false,
  isStreaming: false,
  streamingContent: '',
  onThinkClick: undefined,
})

const L = computed(() => resolveLabels(props.labels))

// ── Date separators ──
function showDateSep(idx: number) {
  if (!props.showDateSeparators) return false
  const msg = props.messages[idx]
  if (!msg.createdAt) return false
  if (idx === 0) return true
  const prev = props.messages[idx - 1]
  if (!prev.createdAt) return false
  return new Date(msg.createdAt * 1000).toDateString() !== new Date(prev.createdAt * 1000).toDateString()
}

// ── Image lightbox ──
const lightboxRef = ref<InstanceType<typeof ImageLightbox>>()
function openLightbox(src: string) {
  lightboxRef.value?.open(src)
}

// ── Think drawer ──
const thinkDrawerRef = ref<InstanceType<typeof ThinkDrawer>>()
function openThink(thinkId: string) {
  if (props.onThinkClick) {
    props.onThinkClick(thinkId)
  } else {
    thinkDrawerRef.value?.open(thinkId)
  }
}
</script>

<template>
  <div class="chatui-messages">
    <template v-if="messages.length === 0 && !isStreaming">
      <div class="chatui-empty">{{ L.noHistory }}</div>
    </template>

    <template v-for="(msg, idx) in messages" :key="idx">
      <!-- Date separator -->
      <div v-if="showDateSep(idx)" class="chatui-date-sep">
        <span>{{ fmtDateSep(msg.createdAt, L.dateToday, L.dateYesterday) }}</span>
      </div>

      <!-- Skip tool messages embedded in AI messages -->
      <template v-if="!(msg.message.role === MessageRole.Tool && msg.message.tool_call_id)">
        <!-- Human message -->
        <div v-if="msg.message.role === MessageRole.Human" class="msg-row human">
          <div class="msg-bubble human">
            <div class="msg-role-bar">
              <span class="msg-role">{{ L.roleUser }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
              <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle think-toggle-human" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <template v-for="(part, pIdx) in getContentParts(msg.message.content)" :key="pIdx">
              <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
              <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
              </div>
              <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                <audio controls :src="part.url" />
              </div>
            </template>
          </div>
        </div>

        <!-- AI message -->
        <div v-else-if="msg.message.role === MessageRole.AI" class="msg-row ai">
          <div v-if="msg.message.content" class="msg-bubble ai">
            <div class="msg-role-bar">
              <span class="msg-role">{{ L.roleAi }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
              <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <template v-for="(part, pIdx) in getContentParts(msg.message.content)" :key="pIdx">
              <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
              <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
              </div>
              <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                <audio controls :src="part.url" />
              </div>
            </template>
          </div>
          <!-- Tool calls -->
          <div v-if="msg.message.tool_calls && msg.message.tool_calls.length > 0" class="msg-tool-calls">
            <div class="msg-role has-think">
              {{ tpl(L.toolCalls, { count: msg.message.tool_calls.length }) }}
              <div v-if="msg.thinkId && thinksUrlPrefix && !msg.message.content" class="think-toggle" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <div v-for="tc in msg.message.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
              <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                <span v-if="inlineArgs(tc as ToolCall)" class="tool-call-inline-args">{{ inlineArgs(tc as ToolCall) }}</span>
                <span v-if="resultPreview(messages, (tc as ToolCall).id)" class="tool-call-result-preview">↳ {{ resultPreview(messages, (tc as ToolCall).id) }}</span>
              </div>
              <div class="tool-call-detail">
                <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                <template v-for="m2 in messages" :key="'r' + (m2.message.tool_call_id || '')">
                  <div v-if="m2.message.role === MessageRole.Tool && m2.message.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                    <div class="tool-call-result-top">
                      <div class="tool-call-result-label">{{ L.toolResult }}</div>
                      <div v-if="m2.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(m2.thinkId!)">
                        <span>▸</span><span>{{ L.think }}</span>
                      </div>
                    </div>
                    <template v-for="(part, pIdx) in getContentParts(m2.message.content)" :key="'tr' + pIdx">
                      <div v-if="part.type === ContentPartType.Text" class="md-content tool-result-content" v-html="renderMd(part.text)" />
                      <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                        <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
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

        <!-- Tool message (standalone, no tool_call_id) -->
        <div v-else-if="msg.message.role === MessageRole.Tool" class="msg-row ai">
          <div class="msg-bubble tool">
            <div class="msg-role-bar">
              <span class="msg-role">Tool{{ msg.message.name ? ` · ${msg.message.name}` : '' }}</span>
            </div>
            <template v-for="(part, pIdx) in getContentParts(msg.message.content)" :key="pIdx">
              <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
              <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
              </div>
              <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                <audio controls :src="part.url" />
              </div>
            </template>
          </div>
        </div>

        <!-- System/other -->
        <div v-else class="msg-row ai">
          <div class="msg-bubble ai">
            <div class="msg-role-bar">
              <span class="msg-role">{{ msg.message.role }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
            </div>
            <template v-for="(part, pIdx) in getContentParts(msg.message.content)" :key="pIdx">
              <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
              <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
                <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
              </div>
              <div v-else-if="part.type === ContentPartType.Audio" class="inline-audio">
                <audio controls :src="part.url" />
              </div>
            </template>
          </div>
        </div>
      </template>
    </template>

    <!-- Streaming -->
    <div v-if="isStreaming" class="msg-row ai">
      <div class="msg-bubble ai streaming">
        <div class="msg-role-bar"><span class="msg-role">{{ L.roleAi }}</span></div>
        <template v-if="streamingContent && (typeof streamingContent === 'string' ? streamingContent : streamingContent.length)">
          <template v-for="(part, pIdx) in getContentParts(streamingContent)" :key="pIdx">
            <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
            <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
              <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
            </div>
          </template>
        </template>
        <span v-else class="chatui-thinking">{{ L.thinking }}</span>
      </div>
    </div>

    <!-- Queued messages -->
    <div v-for="(q, i) in queuedMessages" :key="'q' + i" class="msg-row human">
      <div class="msg-bubble human queued">
        <div class="msg-role-bar">
          <span class="msg-role">{{ L.roleUser }}</span>
          <span class="msg-queued-tag">{{ L.queued }}</span>
        </div>
        <template v-for="(part, pIdx) in getContentParts(q)" :key="pIdx">
          <div v-if="part.type === ContentPartType.Text" class="md-content" v-html="renderMd(part.text)" />
          <div v-else-if="part.type === ContentPartType.Image" class="inline-image">
            <img :src="part.url" class="inline-image-thumb" @click="openLightbox(part.url!)" />
          </div>
        </template>
      </div>
    </div>

    <ThinkDrawer
      v-if="thinksUrlPrefix"
      ref="thinkDrawerRef"
      :thinks-url-prefix="thinksUrlPrefix"
      :labels="labels"
      :fetch-fn="fetchFn"
    />
    <ImageLightbox ref="lightboxRef" :labels="labels" />
  </div>
</template>

<style scoped>
.chatui-messages {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chatui-empty {
  text-align: center;
  color: var(--chatui-fg-secondary);
  padding: 60px 0;
}
.chatui-date-sep {
  text-align: center;
  padding: 8px 0;
  font-size: 11px;
  color: var(--chatui-fg-secondary);
}
.chatui-date-sep span {
  background: var(--chatui-bg-surface);
  padding: 2px 12px;
  border-radius: 10px;
  border: 1px solid var(--chatui-border);
}

/* Message rows */
.msg-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.msg-row.human { align-items: flex-end; }
.msg-row.ai { align-items: flex-start; }

/* Bubbles */
.msg-bubble {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 8px;
  line-height: 1.5;
  word-break: break-word;
}
.msg-bubble.human {
  background: var(--chatui-bg-human);
  color: var(--chatui-fg-human);
  border-bottom-right-radius: 2px;
}
.msg-bubble.ai {
  background: var(--chatui-bg-ai);
  color: var(--chatui-fg-ai);
  border-bottom-left-radius: 2px;
}
.msg-bubble.tool {
  background: var(--chatui-bg-tool);
  color: var(--chatui-fg-tool);
  font-family: monospace;
  font-size: 12px;
  border-bottom-left-radius: 2px;
}
.msg-bubble.streaming { opacity: 0.85; }

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
  color: var(--chatui-fg-secondary);
}
.msg-time {
  font-size: 10px;
  color: var(--chatui-fg-secondary);
}

/* Markdown content */
.md-content :deep(p) { margin: 0 0 6px; }
.md-content :deep(p:last-child) { margin-bottom: 0; }
.md-content :deep(pre) {
  background: var(--chatui-bg-code);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}
.md-content :deep(code) {
  font-family: var(--chatui-font-family-mono);
  font-size: 0.9em;
}
.md-content :deep(:not(pre) > code) {
  background: var(--chatui-bg-code);
  padding: 1px 4px;
  border-radius: 3px;
}
.md-content :deep(ul), .md-content :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.md-content :deep(blockquote) {
  border-left: 3px solid var(--chatui-blockquote-border);
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
  background: var(--chatui-bg-ai);
  border: 1px solid var(--chatui-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 6px;
  font-size: 12px;
  max-width: 90%;
}
.msg-role.has-think {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-call-item {
  border: 1px solid var(--chatui-border);
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
  color: var(--chatui-fg-secondary);
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
  color: var(--chatui-fg-secondary);
}
.tool-call-result-preview {
  font-size: 11px;
  color: var(--chatui-fg-secondary);
}
.tool-call-header.expanded .tool-call-result-preview { display: none; }
.tool-call-detail { display: none; }
.tool-call-detail.show { display: block; }
.tool-call-args {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--chatui-fg-primary);
  background: var(--chatui-bg-code);
  padding: 6px 8px;
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
}
.tool-call-result {
  padding: 8px;
  border-top: 1px solid var(--chatui-border);
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
  color: var(--chatui-fg-secondary);
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
  color: var(--chatui-think-fg);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  background: var(--chatui-think-bg);
  border: 1px solid var(--chatui-think-border);
  transition: all 0.15s ease;
  white-space: nowrap;
}
.think-toggle:hover {
  background: rgba(124, 58, 237, 0.18);
}
.think-toggle-human {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
  color: #e9d5ff;
}
.think-toggle-human:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

/* Queued */
.msg-bubble.queued { opacity: 0.6; }
.msg-queued-tag {
  font-size: 10px;
  color: var(--chatui-fg-secondary);
  font-style: italic;
}

/* Thinking indicator */
.chatui-thinking {
  color: var(--chatui-fg-secondary);
}
</style>
