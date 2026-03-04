<script setup lang="ts">
import { marked } from 'marked'
import type { ChatMessage, ToolCall } from '@/types'

const props = defineProps<{ messages: ChatMessage[] }>()

function fmtTs(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return time
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
  } catch { return '' }
}

function fmtDateSep(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    if (d.toDateString() === now.toDateString()) return '今天'
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return '昨天'
    if (d.getFullYear() === now.getFullYear())
      return `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
  } catch { return '' }
}

function showDateSep(idx: number) {
  const msg = props.messages[idx]
  if (!msg.timestamp) return false
  if (idx === 0) return true
  const prev = props.messages[idx - 1]
  if (!prev.timestamp) return false
  return new Date(msg.timestamp).toDateString() !== new Date(prev.timestamp).toDateString()
}

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

function renderMd(content: string): string {
  return marked.parse(content) as string
}
</script>

<template>
  <div class="history-messages">
    <template v-if="messages.length === 0">
      <div style="text-align:center;color:#94a3b8;padding:60px">暂无历史记录</div>
    </template>
    <template v-else>
      <template v-for="(msg, idx) in messages" :key="idx">
        <!-- Date separator -->
        <div v-if="showDateSep(idx)" class="msg-date-sep">
          <span>{{ fmtDateSep(msg.timestamp) }}</span>
        </div>

        <!-- skip tool messages that are embedded in AI messages -->
        <template v-if="!(msg.role === 'tool' && msg.tool_call_id)">
          <!-- Human message -->
          <div v-if="msg.role === 'human'" class="msg-row human">
            <div class="msg-bubble human">
              <div class="msg-role">用户</div>
              {{ msg.content }}
              <div v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</div>
            </div>
          </div>

          <!-- AI message -->
          <div v-else-if="msg.role === 'ai'" class="msg-row ai">
            <div v-if="msg.content" class="msg-bubble ai">
              <div class="msg-role">AI</div>
              <div class="md-content" v-html="renderMd(msg.content)" />
              <div v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</div>
            </div>
            <div v-if="msg.tool_calls && msg.tool_calls.length > 0" class="msg-tool-calls">
              <div class="msg-role">Tool Calls ({{ msg.tool_calls.length }})</div>
              <div v-for="tc in msg.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
                <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                  <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                </div>
                <div class="tool-call-detail">
                  <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                  <template v-for="m2 in messages" :key="'r' + (m2.tool_call_id || '')">
                    <div v-if="m2.role === 'tool' && m2.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                      <div class="tool-call-result-label">返回结果</div>
                      {{ m2.content }}
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Tool message (standalone, no tool_call_id) -->
          <div v-else-if="msg.role === 'tool'" class="msg-row ai">
            <div class="msg-bubble tool">
              <div class="msg-role">Tool{{ msg.name ? ` · ${msg.name}` : '' }}</div>
              {{ msg.content }}
            </div>
          </div>

          <!-- System/other -->
          <div v-else class="msg-row ai">
            <div class="msg-bubble ai">
              <div class="msg-role">{{ msg.role }}</div>
              {{ msg.content }}
              <div v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</div>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
