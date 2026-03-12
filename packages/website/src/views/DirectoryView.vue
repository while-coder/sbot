<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { marked } from 'marked'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import type { ChatMessage, ToolCall } from '@/types'
import DirectoryModal from './DirectoryModal.vue'
import SaverViewModal from './SaverViewModal.vue'

type LocalDirCfg = { agent?: string; saver?: string; memory?: string }

const { show } = useToast()
const { send: wsSend, onMessage: wsOnMessage, offMessage: wsOffMessage, waitForOpen } = useChatSocket()
const directoryModal = ref<InstanceType<typeof DirectoryModal>>()
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()

// ── 无效路径 ──────────────────────────────────────────────
const invalidDirs = ref<string[]>([])

async function checkInvalidDirs() {
  const dirs = Object.keys(store.settings.directories || {})
  const results = await Promise.all(
    dirs.map(async (d) => {
      try {
        const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(d)}`)
        return { path: d, exists: res.data?.exists === true }
      } catch {
        return { path: d, exists: false }
      }
    })
  )
  invalidDirs.value = results.filter(r => !r.exists).map(r => r.path)
}

async function removeInvalidDir(dirPath: string) {
  try {
    await apiFetch(`/api/directories?path=${encodeURIComponent(dirPath)}`, 'DELETE')
    if (store.settings.directories) delete store.settings.directories[dirPath]
    invalidDirs.value = invalidDirs.value.filter(d => d !== dirPath)
    if (activeDir.value === dirPath) { activeDir.value = null; activeCfg.value = null }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(() => { checkInvalidDirs(); wsOnMessage(handleWsEvent) })

// ── 目录选择 ──────────────────────────────────────────────
const activeDir  = ref<string | null>(null)
const activeCfg  = ref<LocalDirCfg | null>(null)
const loadingCfg = ref(false)

const directories = computed(() => store.settings.directories || {})

const agentOptions  = computed(() =>
  Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)
const saverOptions  = computed(() =>
  Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)

function dirDisplayName(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || p
}

async function selectDir(dirPath: string) {
  if (activeDir.value === dirPath) return
  activeDir.value = dirPath
  activeCfg.value = null
  messages.value  = []
  streamingContent.value = ''
  loadingCfg.value = true
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(dirPath)}`)
    activeCfg.value = (res.data?.config as LocalDirCfg | null) ?? {}
    await refreshHistory()
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loadingCfg.value = false
  }
}

async function deleteDir(dirPath: string) {
  if (!confirm(`确定要移除目录 "${dirDisplayName(dirPath)}"？\n（只移除注册信息，不删除本地文件）`)) return
  try {
    await apiFetch(`/api/directories?path=${encodeURIComponent(dirPath)}`, 'DELETE')
    if (store.settings.directories) delete store.settings.directories[dirPath]
    if (activeDir.value === dirPath) { activeDir.value = null; activeCfg.value = null; messages.value = [] }
    show('已移除')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function onSaved(dirPath: string, cfg: LocalDirCfg) {
  activeCfg.value = cfg
  activeDir.value = dirPath
  messages.value  = []
  refreshHistory()
}

// ── 保存目录配置（工具栏下拉切换）────────────────────────
async function saveConfig(patch: Partial<LocalDirCfg>) {
  if (!activeDir.value || !activeCfg.value) return
  const updated: any = { ...activeCfg.value, ...patch }
  if (!updated.memory) delete updated.memory
  try {
    await apiFetch('/api/directories', 'PUT', { path: activeDir.value, ...updated })
    Object.assign(activeCfg.value, patch)
    if ('saver' in patch) { messages.value = []; await refreshHistory() }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── 历史记录 ──────────────────────────────────────────────
function historyUrl(): string | null {
  if (!activeDir.value || !activeCfg.value?.saver) return null
  // thread ID = 目录路径（HTTP chat 用 workPath 作为会话标识）
  return `/api/savers/${encodeURIComponent(activeCfg.value.saver)}/threads/${encodeURIComponent(activeDir.value)}/history`
}

async function refreshHistory() {
  const url = historyUrl()
  if (!url) { messages.value = []; return }
  try {
    const res = await apiFetch(url)
    messages.value = res.data || []
    await nextTick()
    scrollToBottom()
  } catch { messages.value = [] }
}

async function clearHistory() {
  const url = historyUrl()
  if (!url || !confirm('确定要清除该目录的对话历史吗？')) return
  try {
    await apiFetch(url, 'DELETE')
    show('历史已清除')
    await refreshHistory()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Chat state ────────────────────────────────────────────
const messages        = ref<ChatMessage[]>([])
const chatInput       = ref('')
const chatSending     = ref(false)
const isStreaming     = ref(false)
const streamingContent   = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])
const messagesEl      = ref<HTMLElement | null>(null)

function isAtBottom(): boolean {
  if (!messagesEl.value) return true
  const el = messagesEl.value
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function scrollToBottom(force = false) {
  if (messagesEl.value && (force || isAtBottom())) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

function renderMd(content: string): string {
  return marked.parse(content) as string
}

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

function toggleToolCall(el: HTMLElement) {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

async function send() {
  if (!activeDir.value)         { show('请先选择目录', 'error'); return }
  if (!activeCfg.value?.agent)  { show('请先配置 Agent', 'error'); return }
  if (!activeCfg.value?.saver)  { show('请先配置存储', 'error'); return }
  const query = chatInput.value.trim()
  if (!query) return
  chatInput.value = ''
  await sendOne(query)
}

async function sendOne(query: string) {
  chatSending.value = true
  isStreaming.value = true
  streamingContent.value = ''
  streamingToolCalls.value = []

  messages.value.push({ role: 'human', content: query, timestamp: new Date().toISOString() })
  await nextTick()
  scrollToBottom(true)

  try {
    await waitForOpen()
    wsSend({
      type: 'message',
      query,
      workPath: activeDir.value!,
    })
  } catch (e: any) {
    show(e.message, 'error')
    isStreaming.value = false
    chatSending.value = false
  }
}

async function handleWsEvent(evt: any) {
  if (evt.workPath && evt.workPath !== activeDir.value) return
  if (evt.type === 'stream') {
    streamingContent.value = evt.content
    await nextTick(); scrollToBottom()
  } else if (evt.type === 'message') {
    messages.value.push({
      role: evt.role, content: evt.content,
      tool_calls: evt.tool_calls, tool_call_id: evt.tool_call_id,
      timestamp: new Date().toISOString(),
    })
    streamingContent.value = ''
    streamingToolCalls.value = []
    await nextTick(); scrollToBottom()
  } else if (evt.type === 'tool_call') {
    messages.value.push({
      role: 'ai',
      tool_calls: [{ id: evt.id ?? `tc-${Date.now()}`, name: evt.name, args: evt.args }],
      timestamp: new Date().toISOString(),
    })
    streamingToolCalls.value.push({ name: evt.name, args: evt.args })
    await nextTick(); scrollToBottom()
  } else if (evt.type === 'done') {
    isStreaming.value = false
    chatSending.value = false
    await refreshHistory()
  } else if (evt.type === 'error') {
    show(evt.message, 'error')
    isStreaming.value = false
    chatSending.value = false
  }
}

onUnmounted(() => { wsOffMessage(handleWsEvent) })
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <!-- 顶部提示条 -->
    <div class="dir-banner">
      <span class="dir-banner-label">目录管理</span>
      <span class="dir-banner-hint">
        每个目录的配置（Agent / 存储 / 记忆）保存在该目录的 <code>.sbot/settings.json</code> 中
      </span>
      <button class="btn-primary btn-sm" @click="directoryModal?.open()">+ 新增目录</button>
    </div>

    <!-- 无效路径错误条 -->
    <div v-if="invalidDirs.length > 0" class="dir-invalid-bar">
      <span class="dir-invalid-icon">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;margin-bottom:4px">以下目录在宿主机上不存在，请删除无效记录：</div>
        <div v-for="d in invalidDirs" :key="d" class="dir-invalid-row">
          <span class="dir-invalid-path" :title="d">{{ d }}</span>
          <button class="btn-danger btn-sm" @click="removeInvalidDir(d)">删除</button>
        </div>
      </div>
    </div>

    <!-- 主体：左侧目录列表 + 右侧聊天 -->
    <div style="flex:1;display:flex;overflow:hidden;min-height:0">

      <!-- 左侧边栏 -->
      <div style="width:200px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
        <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
          <button class="btn-outline btn-sm" style="width:100%" @click="directoryModal?.open()">+ 新增</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px">
          <div v-if="Object.keys(directories).length === 0"
               style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
            暂无目录<br>点击上方新增
          </div>
          <div
            v-for="(_, dirPath) in directories"
            :key="dirPath"
            class="dir-item"
            :class="{ active: activeDir === dirPath }"
            @click="selectDir(dirPath as string)"
          >
            <div style="display:flex;align-items:center;gap:4px">
              <div style="flex:1;min-width:0">
                <div class="dir-item-name" :title="dirPath as string">
                  {{ dirDisplayName(dirPath as string) }}
                </div>
                <div class="dir-item-path" :title="dirPath as string">{{ dirPath }}</div>
              </div>
              <button class="dir-del-btn" @click.stop="deleteDir(dirPath as string)" title="移除目录">×</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧聊天面板 -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

        <!-- 工具栏（与 ChatView 保持一致） -->
        <div class="page-toolbar">
          <template v-if="activeDir && activeCfg !== null && !loadingCfg">
            <span class="page-toolbar-title" :title="activeDir">{{ dirDisplayName(activeDir) }}</span>

            <!-- Agent -->
            <label class="toolbar-label">Agent</label>
            <select
              class="toolbar-select-sm"
              :value="activeCfg.agent || ''"
              @change="saveConfig({ agent: ($event.target as HTMLSelectElement).value })"
            >
              <option value="" disabled>未配置</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>

            <!-- Saver -->
            <label class="toolbar-label">存储</label>
            <select
              class="toolbar-select-sm"
              :value="activeCfg.saver || ''"
              @change="saveConfig({ saver: ($event.target as HTMLSelectElement).value })"
            >
              <option value="" disabled>未配置</option>
              <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
            <button
              v-if="activeCfg.saver"
              class="chat-info-chip"
              @click="saverViewModal?.open(activeCfg.saver!, activeDir!)"
            >查看</button>

            <!-- Memory -->
            <label class="toolbar-label">记忆</label>
            <select
              class="toolbar-select-sm"
              :value="activeCfg.memory || ''"
              @change="saveConfig({ memory: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">(不使用)</option>
              <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>

            <button
              class="btn-outline btn-sm"
              style="margin-left:auto"
              @click="directoryModal?.open(activeDir!, activeCfg ?? undefined)"
            >编辑</button>
            <button class="btn-outline btn-sm" @click="refreshHistory">刷新</button>
            <button class="btn-danger btn-sm" :disabled="!activeCfg.saver" @click="clearHistory">清除历史</button>
          </template>

          <template v-else-if="activeDir && loadingCfg">
            <span style="font-size:13px;color:#94a3b8">读取配置中…</span>
          </template>

          <span v-else style="font-size:13px;color:#94a3b8">请从左侧选择目录</span>
        </div>

        <!-- 未选目录 -->
        <div v-if="!activeDir"
             style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px">
          请从左侧选择目录，或点击「新增目录」
        </div>

        <!-- 聊天区域 -->
        <template v-else>
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

            <!-- 消息列表 -->
            <div ref="messagesEl" style="flex:1;overflow-y:auto">
              <div class="history-messages">
                <template v-if="messages.length === 0 && !isStreaming">
                  <div style="text-align:center;color:#94a3b8;padding:60px">
                    <template v-if="!activeCfg?.agent || !activeCfg?.saver">
                      请先在工具栏配置 Agent 和存储
                    </template>
                    <template v-else>
                      暂无对话历史，发送消息开始对话
                    </template>
                  </div>
                </template>

                <template v-for="(msg, idx) in messages" :key="idx">
                  <template v-if="msg.role !== 'tool'">
                    <div v-if="msg.role === 'human'" class="msg-row human">
                      <div class="msg-bubble human">
                        <div class="msg-role-bar">
                          <span class="msg-role">用户</span>
                          <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                        </div>
                        {{ msg.content }}
                      </div>
                    </div>
                    <div v-else-if="msg.role === 'ai'" class="msg-row ai">
                      <div v-if="msg.content" class="msg-bubble ai">
                        <div class="msg-role-bar">
                          <span class="msg-role">AI</span>
                          <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                        </div>
                        <div class="md-content" v-html="renderMd(msg.content)" />
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
                    <div v-else class="msg-row ai">
                      <div class="msg-bubble ai">
                        <div class="msg-role-bar">
                          <span class="msg-role">{{ msg.role }}</span>
                          <span v-if="msg.timestamp" class="msg-time">{{ fmtTs(msg.timestamp) }}</span>
                        </div>
                        {{ msg.content }}
                      </div>
                    </div>
                  </template>
                </template>

                <!-- 流式输出 -->
                <div v-if="isStreaming" class="msg-row ai">
                  <div class="msg-bubble ai streaming">
                    <div class="msg-role-bar"><span class="msg-role">AI</span></div>
                    <div v-if="streamingContent" class="md-content" v-html="renderMd(streamingContent)" />
                    <span v-else style="color:#94a3b8">思考中…</span>
                  </div>
                  <div v-for="(tc, i) in streamingToolCalls" :key="i" class="msg-tool-calls">
                    <div class="msg-role">Tool Call</div>
                    <div class="tool-call-item">
                      <div class="tool-call-header expanded" @click="toggleToolCall($event.currentTarget as HTMLElement)">
                        <span class="tool-call-name">{{ tc.name }}</span>
                      </div>
                      <div class="tool-call-detail show">
                        <div class="tool-call-args">{{ JSON.stringify(tc.args, null, 2) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 输入栏 -->
            <div class="chat-input-bar">
              <div style="flex:1">
                <textarea
                  v-model="chatInput"
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
                  rows="3"
                  @keydown="onKeydown"
                  @input="autoResize"
                  style="resize:none;width:100%"
                />
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
                <button class="btn-primary" :disabled="chatSending" @click="send">发送</button>
              </div>
            </div>

          </div>
        </template>

      </div>
    </div>

    <DirectoryModal ref="directoryModal" @saved="onSaved" />
    <SaverViewModal ref="saverViewModal" />
  </div>
</template>

<style scoped>
/* ── 顶部条 ── */
.dir-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #f8f7f5;
  border-bottom: 2px solid #e8e6e3;
  flex-shrink: 0;
  font-size: 13px;
}
.dir-banner-label { font-size: 12px; font-weight: 700; color: #6b6b6b; white-space: nowrap; }
.dir-banner-hint  { flex: 1; font-size: 12px; color: #9b9b9b; }
.dir-banner-hint code {
  background: #eceae6;
  border-radius: 3px;
  padding: 1px 4px;
  font-family: monospace;
  font-size: 11px;
  color: #3d3d3d;
}

/* ── 无效路径条 ── */
.dir-invalid-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  background: #fef2f2;
  border-bottom: 1px solid #fca5a5;
  flex-shrink: 0;
  font-size: 13px;
}
.dir-invalid-icon {
  flex-shrink: 0;
  width: 20px; height: 20px;
  background: #ef4444; color: #fff;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  margin-top: 1px;
}
.dir-invalid-row  { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.dir-invalid-path {
  font-family: monospace; font-size: 12px; color: #b91c1c;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 600px;
}

/* ── 左侧目录列表 ── */
.dir-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
  margin-bottom: 2px;
}
.dir-item:hover  { background: #f5f4f2; }
.dir-item.active { background: #f0efed; }
.dir-item-name {
  font-size: 13px; font-weight: 500; color: #1c1c1c;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dir-item-path {
  font-size: 10px; color: #9b9b9b; font-family: monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 1px;
}
.dir-del-btn {
  background: none; border: none; cursor: pointer;
  color: transparent; font-size: 16px; padding: 0 2px; line-height: 1;
  flex-shrink: 0; transition: color .1s;
}
.dir-item:hover .dir-del-btn { color: #94a3b8; }
.dir-del-btn:hover { color: #ef4444 !important; }

/* ── 工具栏（与 ChatView 一致） ── */
.toolbar-label {
  font-size: 12px;
  color: #9b9b9b;
  white-space: nowrap;
}
.toolbar-select-sm {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: #fff;
  color: #1e293b;
  cursor: pointer;
  max-width: 120px;
}
.toolbar-select-sm:focus { outline: none; border-color: #1c1c1c; }

/* ── 消息区域（与 ChatView 一致） ── */
.history-messages { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.msg-row { display: flex; }
.msg-row.human { justify-content: flex-end; }
.msg-row.ai    { justify-content: flex-start; flex-direction: column; gap: 6px; }
.msg-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.msg-bubble.human { background: #1c1c1c; color: #fff; border-bottom-right-radius: 4px; }
.msg-bubble.ai    { background: #f5f4f2; color: #1c1c1c; border-bottom-left-radius: 4px; }
.msg-bubble.streaming { opacity: .85; }
.msg-role-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.msg-role  { font-size: 11px; font-weight: 600; opacity: .6; }
.msg-time  { font-size: 11px; opacity: .45; }
.msg-tool-calls {
  max-width: 72%;
  background: #fafaf9;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.tool-call-item  { margin-top: 6px; }
.tool-call-header {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; padding: 4px 0;
}
.tool-call-header::before { content: '▶'; font-size: 10px; color: #9b9b9b; transition: transform .15s; }
.tool-call-header.expanded::before { transform: rotate(90deg); }
.tool-call-name  { font-weight: 600; color: #374151; }
.tool-call-detail { display: none; }
.tool-call-detail.show { display: block; }
.tool-call-args  {
  font-family: monospace; font-size: 11px; color: #6b7280;
  background: #f8f7f5; border-radius: 4px;
  padding: 6px 8px; white-space: pre-wrap; word-break: break-all;
  max-height: 200px; overflow-y: auto;
}
.tool-call-result { margin-top: 6px; }
.tool-call-result-label { font-weight: 600; color: #374151; font-size: 11px; margin-bottom: 3px; }
</style>
