<script setup lang="ts">
import { ref, computed } from 'vue'
import { MessageRole, MessageKind } from '../types'
import type { StoredMessage, ToolCall, ChatLabels, DisplayContent } from '../types'

function isArchived(m: StoredMessage): boolean {
  return m.kind === MessageKind.Archive
}
function isCommand(m: StoredMessage): boolean {
  return m.kind === MessageKind.Command
}
function isException(m: StoredMessage): boolean {
  return m.kind === MessageKind.Exception
}
function rowKindClass(m: StoredMessage) {
  return {
    archived:  isArchived(m),
    command:   isCommand(m),
    exception: isException(m),
  }
}
import { fmtTs, fmtDateSep, toggleToolCall } from '../messageRender'
import { inlineArgs, resultPreview } from '../toolCallFormat'
import { resolveLabels, tpl } from '../labels'
import ContentParts from './_ContentParts.vue'
import ThinkDrawer from './ThinkDrawer.vue'
import ImageLightbox from './ImageLightbox.vue'

const props = withDefaults(defineProps<{
  messages: StoredMessage[]
  thinksUrlPrefix?: string | null
  showDateSeparators?: boolean
  isStreaming?: boolean
  streamingContent?: DisplayContent
  queuedMessages?: DisplayContent[]
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

function sameDay(a?: number, b?: number) {
  if (!a || !b) return false
  return new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString()
}

function showDateSep(idx: number) {
  if (!props.showDateSeparators) return false
  const msg = props.messages[idx]
  if (!msg?.createdAt) return false
  if (idx === 0) return true
  return !sameDay(msg.createdAt, props.messages[idx - 1]?.createdAt)
}

const lightboxRef = ref<InstanceType<typeof ImageLightbox>>()
const openLightbox = (src: string) => lightboxRef.value?.open(src)

const thinkDrawerRef = ref<InstanceType<typeof ThinkDrawer>>()
function openThink(thinkId: string) {
  if (props.onThinkClick) props.onThinkClick(thinkId)
  else thinkDrawerRef.value?.open(thinkId)
}

function findToolResult(toolCallId: string): StoredMessage | undefined {
  return props.messages.find(m => m.message.role === MessageRole.Tool && m.message.tool_call_id === toolCallId)
}

/** True when the row should be skipped (tool results are rendered nested inside their AI parent). */
function isEmbeddedTool(msg: StoredMessage): boolean {
  return msg.message.role === MessageRole.Tool && !!msg.message.tool_call_id
}
</script>

<template>
  <div class="chatui-messages">
    <div v-if="messages.length === 0 && !isStreaming" class="chatui-empty">{{ L.noHistory }}</div>

    <template v-for="(msg, idx) in messages" :key="idx">
      <div v-if="showDateSep(idx)" class="chatui-date-sep">
        <span>{{ fmtDateSep(msg.createdAt, L.dateToday, L.dateYesterday) }}</span>
      </div>

      <template v-if="!isEmbeddedTool(msg)">
        <!-- Human message -->
        <div v-if="msg.message.role === MessageRole.Human" class="msg-row human" :class="rowKindClass(msg)">
          <div class="msg-bubble human">
            <div class="msg-role-bar">
              <span class="msg-role">{{ L.roleUser }}</span>
              <span v-if="isArchived(msg)" class="msg-archived-tag">{{ L.archivedTag }}</span>
              <span v-if="isCommand(msg)" class="msg-kind-tag msg-kind-command">{{ L.commandTag }}</span>
              <span v-if="isException(msg)" class="msg-kind-tag msg-kind-exception">{{ L.exceptionTag }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
              <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle think-toggle-human" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <ContentParts :content="msg.message.content" @open-image="openLightbox" />
          </div>
        </div>

        <!-- AI message -->
        <div v-else-if="msg.message.role === MessageRole.AI" class="msg-row ai" :class="rowKindClass(msg)">
          <div v-if="msg.message.content" class="msg-bubble ai">
            <div class="msg-role-bar">
              <span class="msg-role">{{ L.roleAi }}</span>
              <span v-if="isArchived(msg)" class="msg-archived-tag">{{ L.archivedTag }}</span>
              <span v-if="isCommand(msg)" class="msg-kind-tag msg-kind-command">{{ L.commandTag }}</span>
              <span v-if="isException(msg)" class="msg-kind-tag msg-kind-exception">{{ L.exceptionTag }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
              <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <ContentParts :content="msg.message.content" @open-image="openLightbox" />
          </div>

          <!-- Tool calls -->
          <div v-if="msg.message.tool_calls?.length" class="msg-tool-calls">
            <div class="msg-role has-think">
              {{ tpl(L.toolCalls, { count: msg.message.tool_calls.length }) }}
              <span v-if="isArchived(msg) && !msg.message.content" class="msg-archived-tag">{{ L.archivedTag }}</span>
              <span v-if="isCommand(msg) && !msg.message.content" class="msg-kind-tag msg-kind-command">{{ L.commandTag }}</span>
              <span v-if="isException(msg) && !msg.message.content" class="msg-kind-tag msg-kind-exception">{{ L.exceptionTag }}</span>
              <div v-if="msg.thinkId && thinksUrlPrefix && !msg.message.content" class="think-toggle" @click="openThink(msg.thinkId!)">
                <span>▸</span><span>{{ L.think }}</span>
              </div>
            </div>
            <div v-for="tc in (msg.message.tool_calls as ToolCall[])" :key="tc.id" class="tool-call-item">
              <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                <span class="tool-call-name">{{ tc.name }}</span>
                <span v-if="inlineArgs(tc)" class="tool-call-inline-args">{{ inlineArgs(tc) }}</span>
                <span v-if="resultPreview(messages, tc.id)" class="tool-call-result-preview">↳ {{ resultPreview(messages, tc.id) }}</span>
              </div>
              <div class="tool-call-detail">
                <div class="tool-call-args">{{ JSON.stringify(tc.args, null, 2) }}</div>
                <template v-if="findToolResult(tc.id) as StoredMessage | undefined">
                  <div class="tool-call-result">
                    <div class="tool-call-result-top">
                      <div class="tool-call-result-label">{{ L.toolResult }}</div>
                      <div v-if="findToolResult(tc.id)?.thinkId && thinksUrlPrefix"
                        class="think-toggle" @click="openThink(findToolResult(tc.id)!.thinkId!)">
                        <span>▸</span><span>{{ L.think }}</span>
                      </div>
                    </div>
                    <ContentParts :content="findToolResult(tc.id)!.message.content"
                      text-class="md-content tool-result-content"
                      @open-image="openLightbox" />
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Tool message (standalone, no tool_call_id) -->
        <div v-else-if="msg.message.role === MessageRole.Tool" class="msg-row ai" :class="rowKindClass(msg)">
          <div class="msg-bubble tool">
            <div class="msg-role-bar">
              <span class="msg-role">Tool{{ msg.message.name ? ` · ${msg.message.name}` : '' }}</span>
              <span v-if="isArchived(msg)" class="msg-archived-tag">{{ L.archivedTag }}</span>
              <span v-if="isCommand(msg)" class="msg-kind-tag msg-kind-command">{{ L.commandTag }}</span>
              <span v-if="isException(msg)" class="msg-kind-tag msg-kind-exception">{{ L.exceptionTag }}</span>
            </div>
            <ContentParts :content="msg.message.content" @open-image="openLightbox" />
          </div>
        </div>

        <!-- System / other -->
        <div v-else class="msg-row ai" :class="rowKindClass(msg)">
          <div class="msg-bubble ai">
            <div class="msg-role-bar">
              <span class="msg-role">{{ msg.message.role }}</span>
              <span v-if="isArchived(msg)" class="msg-archived-tag">{{ L.archivedTag }}</span>
              <span v-if="isCommand(msg)" class="msg-kind-tag msg-kind-command">{{ L.commandTag }}</span>
              <span v-if="isException(msg)" class="msg-kind-tag msg-kind-exception">{{ L.exceptionTag }}</span>
              <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
            </div>
            <ContentParts :content="msg.message.content" @open-image="openLightbox" />
          </div>
        </div>
      </template>
    </template>

    <!-- Streaming -->
    <div v-if="isStreaming" class="msg-row ai">
      <div class="msg-bubble ai streaming">
        <div class="msg-role-bar"><span class="msg-role">{{ L.roleAi }}</span></div>
        <template v-if="streamingContent && (typeof streamingContent === 'string' ? streamingContent : streamingContent.length)">
          <ContentParts :content="streamingContent" :show-audio="false" @open-image="openLightbox" />
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
        <ContentParts :content="q" :show-audio="false" @open-image="openLightbox" />
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
  overflow-wrap: break-word;
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
.msg-bubble.human .msg-role-bar {
  justify-content: flex-end;
}
.msg-role {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--chatui-fg-secondary);
  white-space: nowrap;
}
.msg-time {
  font-size: 10px;
  color: var(--chatui-fg-secondary);
  white-space: nowrap;
}

/* Markdown content */
:deep(.md-content p) { margin: 0 0 6px; }
:deep(.md-content p:last-child) { margin-bottom: 0; }
:deep(.md-content pre) {
  background: var(--chatui-bg-code);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}
:deep(.md-content code) {
  font-family: var(--chatui-font-family-mono);
  font-size: 0.9em;
}
:deep(.md-content :not(pre) > code) {
  background: var(--chatui-bg-code);
  padding: 1px 4px;
  border-radius: 3px;
}
:deep(.md-content ul), :deep(.md-content ol) {
  padding-left: 20px;
  margin: 4px 0;
}
:deep(.md-content blockquote) {
  border-left: 3px solid var(--chatui-blockquote-border);
  padding: 2px 10px;
  margin: 4px 0;
  opacity: 0.85;
}

/* Inline media */
:deep(.inline-image) { margin: 6px 0; }
:deep(.inline-image-thumb) {
  max-width: 240px;
  max-height: 240px;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}
:deep(.inline-image-thumb:hover) { opacity: 0.85; }
:deep(.inline-audio) { margin: 6px 0; }
:deep(.inline-audio audio) { max-width: 100%; border-radius: 6px; }

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
:deep(.tool-result-content) { font-size: 12px; }

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

/* Archived (历史快照) */
.msg-row.archived { opacity: 0.55; }
.msg-row.archived .msg-bubble,
.msg-row.archived .msg-tool-calls {
  filter: grayscale(0.6);
  border-left: 3px solid #cbd5e1;
}
.msg-row.archived:hover { opacity: 0.85; }
.msg-archived-tag {
  font-size: 10px;
  font-weight: 600;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* Command (指令型回调) — 不进入 LLM 上下文，仅作为旁路记录展示 */
.msg-row.command .msg-bubble,
.msg-row.command .msg-tool-calls {
  border-left: 3px solid #818cf8;
}
.msg-row.command .msg-bubble.ai,
.msg-row.command .msg-bubble.tool,
.msg-row.command .msg-tool-calls {
  background: rgba(99, 102, 241, 0.06);
}
.msg-kind-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.msg-kind-command {
  color: #4338ca;
  background: #e0e7ff;
  border: 1px solid #c7d2fe;
}

/* Exception (异常记录) — 标红警示 */
.msg-row.exception .msg-bubble,
.msg-row.exception .msg-tool-calls {
  border-left: 3px solid #f87171;
}
.msg-row.exception .msg-bubble.ai,
.msg-row.exception .msg-bubble.tool,
.msg-row.exception .msg-tool-calls {
  background: rgba(239, 68, 68, 0.06);
}
.msg-kind-exception {
  color: #b91c1c;
  background: #fee2e2;
  border: 1px solid #fca5a5;
}

/* Thinking indicator */
.chatui-thinking {
  color: var(--chatui-fg-secondary);
}
</style>
