<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { MessageRole } from '@/types'
import type { StoredMessage, ToolCall } from '@/types'

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

function renderMd(content: string): string {
  return marked.parse(content) as string
}

// ── Think viewer ──
const thinkData = ref<Record<string, StoredMessage[]>>({})
const thinkExpanded = ref<Record<string, boolean>>({})
const thinkLoading = ref<Record<string, boolean>>({})

async function toggleThink(thinkId: string) {
  if (thinkExpanded.value[thinkId]) {
    thinkExpanded.value[thinkId] = false
    return
  }
  thinkExpanded.value[thinkId] = true
  if (thinkData.value[thinkId]) return
  if (!props.thinksUrlPrefix) return
  thinkLoading.value[thinkId] = true
  try {
    const res = await apiFetch(`${props.thinksUrlPrefix}/${encodeURIComponent(thinkId)}`)
    thinkData.value[thinkId] = res.data || []
  } catch {
    thinkData.value[thinkId] = []
  } finally {
    thinkLoading.value[thinkId] = false
  }
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
              </div>
              <div class="md-content" v-html="renderMd(msg.message.content)" />
            </div>
            <div v-if="msg.message.tool_calls && msg.message.tool_calls.length > 0" class="msg-tool-calls">
              <div class="msg-role">{{ t('chat.tool_calls', { count: msg.message.tool_calls.length }) }}</div>
              <div v-for="tc in msg.message.tool_calls" :key="(tc as ToolCall).id" class="tool-call-item">
                <div class="tool-call-header" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                  <span class="tool-call-name">{{ (tc as ToolCall).name }}</span>
                </div>
                <div class="tool-call-detail">
                  <div class="tool-call-args">{{ JSON.stringify((tc as ToolCall).args, null, 2) }}</div>
                  <template v-for="m2 in messages" :key="'r' + (m2.message.tool_call_id || '')">
                    <div v-if="m2.message.role === MessageRole.Tool && m2.message.tool_call_id === (tc as ToolCall).id" class="tool-call-result">
                      <div class="tool-call-result-label">{{ t('chat.tool_result') }}</div>
                      <div class="md-content tool-result-content" v-html="renderMd(m2.message.content || '')" />
                      <template v-if="m2.thinkId && thinksUrlPrefix">
                        <div class="think-toggle" @click="toggleThink(m2.thinkId!)">
                          <span>{{ thinkExpanded[m2.thinkId!] ? '▾' : '▸' }}</span>
                          <span>Think</span>
                          <span v-if="thinkLoading[m2.thinkId!]" class="think-loading">...</span>
                        </div>
                        <div v-if="thinkExpanded[m2.thinkId!] && thinkData[m2.thinkId!]" class="think-messages">
                          <template v-for="(tm, ti) in thinkData[m2.thinkId!]" :key="ti">
                            <div v-if="tm.message.role === MessageRole.Human" class="think-msg think-human">
                              <span class="think-role">User</span>
                              <div>{{ tm.message.content }}</div>
                            </div>
                            <div v-else-if="tm.message.role === MessageRole.AI && tm.message.content" class="think-msg think-ai">
                              <span class="think-role">AI</span>
                              <div class="md-content" v-html="renderMd(tm.message.content || '')" />
                            </div>
                            <div v-else-if="tm.message.role === MessageRole.AI && tm.message.tool_calls?.length" class="think-msg think-ai">
                              <span class="think-role">AI</span>
                              <div v-for="ttc in tm.message.tool_calls" :key="(ttc as ToolCall).id" class="think-tool-call">
                                <span class="tool-call-name">{{ (ttc as ToolCall).name }}</span>
                                <span class="think-tool-args">{{ JSON.stringify((ttc as ToolCall).args) }}</span>
                              </div>
                            </div>
                            <div v-else-if="tm.message.role === MessageRole.Tool" class="think-msg think-tool">
                              <span class="think-role">Tool</span>
                              <div class="md-content tool-result-content" v-html="renderMd(tm.message.content || '')" />
                            </div>
                          </template>
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
  </div>
</template>
