<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import type { ChatMessage } from '@/types'
import DirectoryModal from './modals/DirectoryModal.vue'
import SaverViewModal from './modals/SaverViewModal.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import { dirThreadId } from 'sbot.commons'

type LocalDirCfg = { agent?: string; saver?: string; memory?: string }

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const { show } = useToast()
const { send: wsSend, onMessage: wsOnMessage, offMessage: wsOffMessage, waitForOpen } = useChatSocket()
const directoryModal = ref<InstanceType<typeof DirectoryModal>>()
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

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
  const threadId = dirThreadId(activeDir.value)
  return `/api/savers/${encodeURIComponent(activeCfg.value.saver)}/threads/${encodeURIComponent(threadId)}/history`
}

async function refreshHistory() {
  const url = historyUrl()
  if (!url) { messages.value = []; return }
  try {
    const res = await apiFetch(url)
    messages.value = res.data || []
    await nextTick()
    chatPanelRef.value?.scrollToBottom()
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
const chatSending     = ref(false)
const isStreaming     = ref(false)
const streamingContent   = ref('')
const streamingToolCalls = ref<{ name: string; args: unknown }[]>([])

// tool approval state
const pendingToolCall = ref<{ id: string; name: string; args: Record<string, any> } | null>(null)

function approveToolCall(approval: string) {
  if (!pendingToolCall.value) return
  const id = pendingToolCall.value.id
  pendingToolCall.value = null
  apiFetch('/api/tool-approval', 'POST', { id, approval }).catch(() => {})
}

async function onPanelSend(query: string, atts: Attachment[]) {
  if (!activeDir.value)         { show('请先选择目录', 'error'); return }
  if (!activeCfg.value?.agent)  { show('请先配置 Agent', 'error'); return }
  if (!activeCfg.value?.saver)  { show('请先配置存储', 'error'); return }
  if (!query && atts.length === 0) return
  await sendOne(query, atts)
}

async function sendOne(query: string, atts: Attachment[]) {
  chatSending.value = true
  isStreaming.value = true
  streamingContent.value = ''
  streamingToolCalls.value = []

  const displayContent = [query, ...atts.map(a => `[附件: ${a.name}]`)].filter(Boolean).join('\n')
  messages.value.push({ role: 'human', content: displayContent, timestamp: new Date().toISOString() })
  await nextTick()
  chatPanelRef.value?.scrollToBottom(true)

  try {
    await waitForOpen()
    wsSend({
      query,
      workPath: activeDir.value!,
      attachments: atts.length ? atts : undefined,
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
  } else if (evt.type === 'message') {
    messages.value.push({
      role: evt.role, content: evt.content,
      tool_calls: evt.tool_calls, tool_call_id: evt.tool_call_id,
      timestamp: new Date().toISOString(),
    })
    streamingContent.value = ''
    streamingToolCalls.value = []
  } else if (evt.type === 'tool_call') {
    const tcId = evt.id ?? `tc-${Date.now()}`
    pendingToolCall.value = { id: tcId, name: evt.name, args: evt.args }
  } else if (evt.type === 'done') {
    isStreaming.value = false
    chatSending.value = false
    pendingToolCall.value = null
    await refreshHistory()
  } else if (evt.type === 'error') {
    show(evt.message, 'error')
    isStreaming.value = false
    chatSending.value = false
    pendingToolCall.value = null
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

        <!-- 工具栏 -->
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

        <!-- Tool approval bar + 聊天面板 -->
        <template v-else>
          <div v-if="pendingToolCall" class="tool-approval-bar">
            <span class="tool-approval-label">执行工具：<strong>{{ pendingToolCall.name }}</strong></span>
            <div class="tool-approval-btns">
              <button class="btn-primary btn-sm" @click="approveToolCall('allow')">允许</button>
              <button class="btn-outline btn-sm" @click="approveToolCall('alwaysArgs')">总是允许（相同参数）</button>
              <button class="btn-outline btn-sm" @click="approveToolCall('alwaysTool')">总是允许（所有参数）</button>
              <button class="btn-danger btn-sm" @click="approveToolCall('deny')">拒绝</button>
            </div>
          </div>
          <ChatPanel
            ref="chatPanelRef"
            :messages="messages"
            :is-streaming="isStreaming"
            :streaming-content="streamingContent"
            :streaming-tool-calls="streamingToolCalls"
            :chat-sending="chatSending"
            :empty-text="!activeCfg?.agent || !activeCfg?.saver ? '请先在工具栏配置 Agent 和存储' : '暂无对话历史，发送消息开始对话'"
            :show-attachments="true"
            @send="onPanelSend"
          />
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

/* ── 工具审批条 ── */
.tool-approval-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #fffbeb;
  border-bottom: 1px solid #fcd34d;
  flex-shrink: 0;
  font-size: 13px;
}
.tool-approval-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-approval-btns  { display: flex; gap: 6px; flex-shrink: 0; }
</style>
