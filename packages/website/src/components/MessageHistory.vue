<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { MessageRole } from '@/types'
import type { StoredMessage, ToolCall } from '@/types'
import { inlineArgs, resultPreview } from '@/utils/toolCallFormat'
import ThinkDrawer from './ThinkDrawer.vue'

const { t } = useI18n()

const props = withDefaults(defineProps<{ messages: StoredMessage[]; thinksUrlPrefix?: string | null }>(), { thinksUrlPrefix: null })

function fmtTs(ts?: number) {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return time
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
  } catch { return '' }
}

function fmtDateSep(ts?: number) {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    if (d.toDateString() === now.toDateString()) return t('chat.date_today')
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return t('chat.date_yesterday')
    if (d.getFullYear() === now.getFullYear())
      return `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
  } catch { return '' }
}

function showDateSep(idx: number) {
  const msg = props.messages[idx]
  if (!msg.createdAt) return false
  if (idx === 0) return true
  const prev = props.messages[idx - 1]
  if (!prev.createdAt) return false
  return new Date(msg.createdAt * 1000).toDateString() !== new Date(prev.createdAt * 1000).toDateString()
}

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

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

// ── Think drawer ──
const thinkDrawerRef = ref<InstanceType<typeof ThinkDrawer>>()

function openThink(thinkId: string) {
  thinkDrawerRef.value?.open(thinkId)
}
</script>

<template>
  <div class="history-messages">
    <template v-if="messages.length === 0">
      <div style="text-align:center;color:#94a3b8;padding:60px">{{ t('chat.no_history') }}</div>
    </template>
    <template v-else>
      <template v-for="(msg, idx) in messages" :key="idx">
        <!-- Date separator -->
        <div v-if="showDateSep(idx)" class="msg-date-sep">
          <span>{{ fmtDateSep(msg.createdAt) }}</span>
        </div>

        <!-- skip tool messages that are embedded in AI messages -->
        <template v-if="!(msg.message.role === MessageRole.Tool && msg.message.tool_call_id)">
          <!-- Human message -->
          <div v-if="msg.message.role === MessageRole.Human" class="msg-row human">
            <div class="msg-bubble human">
              <div class="msg-role-bar">
                <span class="msg-role">{{ t('chat.role_user') }}</span>
                <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
                <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle think-toggle-human" @click="openThink(msg.thinkId!)">
                  <span>▸</span>
                  <span>{{ t('chat.think') }}</span>
                </div>
              </div>
              {{ msg.message.content }}
            </div>
          </div>

          <!-- AI message -->
          <div v-else-if="msg.message.role === MessageRole.AI" class="msg-row ai">
            <div v-if="msg.message.content" class="msg-bubble ai">
              <div class="msg-role-bar">
                <span class="msg-role">{{ t('chat.role_ai') }}</span>
                <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
                <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                  <span>▸</span>
                  <span>{{ t('chat.think') }}</span>
                </div>
              </div>
              <div class="md-content" v-html="renderMd(msg.message.content)" />
            </div>
            <div v-if="msg.message.tool_calls && msg.message.tool_calls.length > 0" class="msg-tool-calls">
              <div class="msg-role has-think">
                {{ t('chat.tool_calls', { count: msg.message.tool_calls.length }) }}
                <div v-if="msg.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(msg.thinkId!)">
                  <span>▸</span>
                  <span>{{ t('chat.think') }}</span>
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
                        <div class="tool-call-result-label">{{ t('chat.tool_result') }}</div>
                        <div v-if="m2.thinkId && thinksUrlPrefix" class="think-toggle" @click="openThink(m2.thinkId!)">
                          <span>▸</span>
                          <span>{{ t('chat.think') }}</span>
                        </div>
                      </div>
                      <div class="md-content tool-result-content" v-html="renderMd(m2.message.content || '')" />
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
              {{ msg.message.content }}
            </div>
          </div>

          <!-- System/other -->
          <div v-else class="msg-row ai">
            <div class="msg-bubble ai">
              <div class="msg-role-bar">
                <span class="msg-role">{{ msg.message.role }}</span>
                <span v-if="msg.createdAt" class="msg-time">{{ fmtTs(msg.createdAt) }}</span>
              </div>
              {{ msg.message.content }}
            </div>
          </div>
        </template>
      </template>
    </template>
    <ThinkDrawer v-if="thinksUrlPrefix" ref="thinkDrawerRef" :thinks-url-prefix="thinksUrlPrefix" />
  </div>
</template>
