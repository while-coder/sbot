<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { useChatSocket } from '@/composables/useChatSocket'
import DirectoryModal from './modals/DirectoryModal.vue'
import SaverViewModal from './modals/SaverViewModal.vue'
import MemoryViewModal from './modals/MemoryViewModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'
import ChatArea from '@/components/ChatArea.vue'
import { dirThreadId, WsCommandType } from 'sbot.commons'
import type { WebChatEvent } from 'sbot.commons'

const { t } = useI18n()

type LocalDirCfg = { agent?: string; saver?: string; memories?: string[] }

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const { show } = useToast()
const chatSocket = useChatSocket()
const { send: wsSend, onMessage: wsOnMessage, offMessage: wsOffMessage, waitForOpen } = chatSocket
const directoryModal  = ref<InstanceType<typeof DirectoryModal>>()
const saverViewModal  = ref<InstanceType<typeof SaverViewModal>>()
const memoryViewModal = ref<InstanceType<typeof MemoryViewModal>>()
const chatAreaRef     = ref<InstanceType<typeof ChatArea>>()

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

const historyUrl = computed<string | null>(() => {
  if (!activeDir.value || !activeCfg.value?.saver) return null
  return `/api/savers/${encodeURIComponent(activeCfg.value.saver)}/threads/${encodeURIComponent(dirThreadId(activeDir.value))}/history`
})

function dirDisplayName(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || p
}

async function selectDir(dirPath: string) {
  if (activeDir.value === dirPath) return
  activeDir.value = dirPath
  activeCfg.value = null
  loadingCfg.value = true
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(dirPath)}`)
    activeCfg.value = (res.data?.config as LocalDirCfg | null) ?? {}
    // historyUrl computed 变化后 ChatArea 自动刷新历史
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loadingCfg.value = false
  }
}

async function deleteDir(dirPath: string) {
  if (!window.confirm(t('directory.confirm_remove', { name: dirDisplayName(dirPath) }))) return
  try {
    await apiFetch(`/api/directories?path=${encodeURIComponent(dirPath)}`, 'DELETE')
    if (store.settings.directories) delete store.settings.directories[dirPath]
    if (activeDir.value === dirPath) { activeDir.value = null; activeCfg.value = null }
    show(t('directory.removed'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function onSaved(dirPath: string, cfg: LocalDirCfg) {
  activeCfg.value = cfg
  activeDir.value = dirPath
  // historyUrl computed 变化后 ChatArea 自动刷新历史
}

// ── 保存目录配置（工具栏下拉切换）────────────────────────
async function saveConfig(patch: Partial<LocalDirCfg>) {
  if (!activeDir.value || !activeCfg.value) return
  const updated: any = { ...activeCfg.value, ...patch }
  try {
    await apiFetch('/api/directories', 'PUT', { path: activeDir.value, ...updated })
    Object.assign(activeCfg.value, patch)
    // saver 变化时 historyUrl computed 变化，ChatArea 自动刷新
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── WebSocket 事件处理 ────────────────────────────────────
async function handleWsEvent(evt: WebChatEvent & { threadId?: string }) {
  const expectedThreadId = activeDir.value ? dirThreadId(activeDir.value) : undefined
  if (evt.threadId && evt.threadId !== expectedThreadId) return
  await chatAreaRef.value?.handleWsEvent(evt)
}

watch(chatSocket.connected, (val, oldVal) => {
  if (!val && oldVal) {
    show(t('chat.ws_reconnecting'), 'error')
    chatAreaRef.value?.reset()
  }
})

function onChatAreaDone() {
  chatAreaRef.value?.refreshHistory()
}

// ── 切换目录时恢复 session 状态 ──────────────────────────
async function fetchAndRestoreSessionStatus(dirPath: string | null) {
  if (!dirPath) { chatAreaRef.value?.restoreSessionStatus(null); return }
  try {
    const res = await apiFetch(`/api/session-status?workPath=${encodeURIComponent(dirPath)}`)
    chatAreaRef.value?.restoreSessionStatus(res ?? null)
  } catch {
    chatAreaRef.value?.restoreSessionStatus(null)
  }
}

watch(activeDir, (dir) => fetchAndRestoreSessionStatus(dir))

// ── 发送消息 ──────────────────────────────────────────────
async function onPanelSend(query: string, atts: Attachment[]) {
  if (!activeDir.value)         { show('请先选择目录', 'error'); return }
  if (!activeCfg.value?.agent)  { show('请先配置 Agent', 'error'); return }
  if (!activeCfg.value?.saver)  { show('请先配置存储', 'error'); return }
  if (!query && atts.length === 0) return
  await sendOne(query, atts)
}

async function sendOne(query: string, atts: Attachment[]) {
  try {
    await waitForOpen()
    wsSend({
      type: WsCommandType.Query,
      query,
      threadId: dirThreadId(activeDir.value!),
      workPath: activeDir.value!,
      attachments: atts.length ? atts : undefined,
    })
    chatAreaRef.value?.addQueuedMessage(query)
  } catch (e: any) {
    chatAreaRef.value?.reset()
    show(e.message, 'error')
  }
}

onUnmounted(() => { wsOffMessage(handleWsEvent); chatAreaRef.value?.cleanup() })
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <!-- 顶部提示条 -->
    <div class="dir-banner">
      <span class="dir-banner-label">{{ t('directory.title') }}</span>
      <span class="dir-banner-hint">
        {{ t('directory.info') }}
      </span>
      <button class="btn-primary btn-sm" @click="directoryModal?.open()">{{ t('directory.add') }}</button>
    </div>

    <!-- 无效路径错误条 -->
    <div v-if="invalidDirs.length > 0" class="dir-invalid-bar">
      <span class="dir-invalid-icon">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;margin-bottom:4px">{{ t('directory.invalid_dirs') }}</div>
        <div v-for="d in invalidDirs" :key="d" class="dir-invalid-row">
          <span class="dir-invalid-path" :title="d">{{ d }}</span>
          <button class="btn-danger btn-sm" @click="removeInvalidDir(d)">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- 主体：左侧目录列表 + 右侧聊天 -->
    <div style="flex:1;display:flex;overflow:hidden;min-height:0">

      <!-- 左侧边栏 -->
      <div style="width:200px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
        <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
          <button class="btn-outline btn-sm" style="width:100%" @click="directoryModal?.open()">{{ t('directory.add_short') }}</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px">
          <div v-if="Object.keys(directories).length === 0"
               style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
            {{ t('directory.empty') }}<br>{{ t('directory.add_hint') }}
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
              <button class="dir-del-btn" @click.stop="deleteDir(dirPath as string)" :title="t('common.delete')">×</button>
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
            <label class="toolbar-label">{{ t('common.agent') }}</label>
            <select
              class="toolbar-select-sm"
              :value="activeCfg.agent || ''"
              @change="saveConfig({ agent: ($event.target as HTMLSelectElement).value })"
            >
              <option value="" disabled>{{ t('common.select_placeholder') }}</option>
              <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>

            <!-- Saver -->
            <label class="toolbar-label">{{ t('common.storage') }}</label>
            <select
              class="toolbar-select-sm"
              :value="activeCfg.saver || ''"
              @change="saveConfig({ saver: ($event.target as HTMLSelectElement).value })"
            >
              <option value="" disabled>{{ t('common.select_placeholder') }}</option>
              <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
            <button
              v-if="activeCfg.saver"
              class="chat-info-chip"
              @click="saverViewModal?.open(activeCfg!.saver!, saverOptions.find(s => s.id === activeCfg!.saver)?.label || activeCfg!.saver!, activeDir!)"
            >{{ t('common.view') }}</button>

            <!-- Memory -->
            <label class="toolbar-label">{{ t('common.memory') }}</label>
            <MultiSelect
              :model-value="activeCfg.memories || []"
              :options="memoryOptions"
              compact
              style="min-width:140px"
              @update:model-value="saveConfig({ memories: $event })"
            />
            <template v-for="mid in (activeCfg.memories || [])" :key="mid">
              <button class="chat-info-chip" @click="memoryViewModal?.open(mid, store.settings.memories?.[mid] ?? {}, store.settings.memories?.[mid]?.share ? undefined : dirThreadId(activeDir!))">{{ memoryOptions.find(m => m.id === mid)?.label || t('common.view') }}</button>
            </template>

            <button
              class="btn-outline btn-sm"
              style="margin-left:auto"
              @click="directoryModal?.open(activeDir!, activeCfg ?? undefined)"
            >{{ t('common.edit') }}</button>
            <button class="btn-outline btn-sm" @click="chatAreaRef?.refreshHistory()">{{ t('common.refresh') }}</button>
            <button class="btn-danger btn-sm" :disabled="!activeCfg.saver" @click="chatAreaRef?.clearHistory()">{{ t('chat.clear_history') }}</button>
          </template>

          <template v-else-if="activeDir && loadingCfg">
            <span style="font-size:13px;color:#94a3b8">{{ t('directory.reading') }}</span>
          </template>

          <span v-else style="font-size:13px;color:#94a3b8">{{ t('directory.select_hint') }}</span>
        </div>

        <!-- 未选目录 -->
        <div v-if="!activeDir"
             style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px">
          {{ t('directory.select_or_add') }}
        </div>

        <!-- 聊天区域 -->
        <template v-else>
          <ChatArea
            ref="chatAreaRef"
            :history-url="historyUrl"
            :show-attachments="true"
            :empty-text="!activeCfg?.agent || !activeCfg?.saver ? '请先在工具栏配置 Agent 和存储' : '暂无对话历史，发送消息开始对话'"
            :cancel-thread-id="activeDir ? dirThreadId(activeDir) : undefined"
            @send="onPanelSend"
            @done="onChatAreaDone"
          />
        </template>

      </div>
    </div>

    <DirectoryModal ref="directoryModal" @saved="onSaved" />
    <SaverViewModal ref="saverViewModal" />
    <MemoryViewModal ref="memoryViewModal" />
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
</style>
