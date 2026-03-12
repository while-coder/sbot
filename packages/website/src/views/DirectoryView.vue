<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import type { LocalConfig } from '@/types'
import NewSessionModal from './NewSessionModal.vue'

const { show } = useToast()
const router = useRouter()
const _win = window as any

// ── Workspace state ──
const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null)
const workspaceName = computed(() => workspaceHandle.value?.name ?? '')
const workspaceConfig = ref<LocalConfig | null>(null)
const workspaceHasConfig = ref(false)
const loading = ref(false)

// Recent dirs (name only — FileSystemDirectoryHandle 不可序列化)
const recentDirs = ref<string[]>(
  JSON.parse(localStorage.getItem('sbot-recent-dirs') || '[]')
)

const newSessionModal = ref<InstanceType<typeof NewSessionModal>>()

// ── Helpers ──
function autoName(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function readConfig(handle: FileSystemDirectoryHandle): Promise<LocalConfig | null> {
  try {
    const sbotDir = await handle.getDirectoryHandle('.sbot')
    const fileHandle = await sbotDir.getFileHandle('settings.json')
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text()) as LocalConfig
  } catch {
    return null
  }
}

function addToRecent(name: string) {
  const list = recentDirs.value.filter(d => d !== name)
  list.unshift(name)
  if (list.length > 10) list.pop()
  recentDirs.value = list
  localStorage.setItem('sbot-recent-dirs', JSON.stringify(list))
}

async function applyHandle(handle: FileSystemDirectoryHandle) {
  workspaceHandle.value = handle
  workspaceConfig.value = await readConfig(handle)
  workspaceHasConfig.value = workspaceConfig.value !== null
  addToRecent(handle.name)
}

// 仅更换工作目录，不创建会话
async function selectWorkspace() {
  if (!_win.showDirectoryPicker) { show('当前浏览器不支持目录选择', 'error'); return }
  loading.value = true
  try {
    const handle = await _win.showDirectoryPicker({ mode: 'read' }) as FileSystemDirectoryHandle
    await applyHandle(handle)
  } catch (e: any) {
    if (e.name !== 'AbortError') show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function createSession(cfg: LocalConfig) {
  const body: any = { name: autoName(), agent: cfg.agentId, saver: cfg.saverId }
  if (cfg.memoryId) body.memory = cfg.memoryId
  const res = await apiFetch('/api/settings/sessions', 'POST', body)
  const id = res.data.id as string
  if (!store.settings.sessions) store.settings.sessions = {}
  store.settings.sessions[id] = body
  return id
}

// 新建：选目录 → 读配置 → 创建会话 / 弹框
async function openNew() {
  if (!_win.showDirectoryPicker) { newSessionModal.value?.open(); return }
  loading.value = true
  try {
    const handle = await _win.showDirectoryPicker({ mode: 'read' }) as FileSystemDirectoryHandle
    await applyHandle(handle)
    if (workspaceConfig.value?.agentId && workspaceConfig.value?.saverId) {
      await createSession(workspaceConfig.value)
      show('会话已创建')
      router.push('/chat')
    } else {
      newSessionModal.value?.open()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

// 右侧面板：直接用当前目录配置新建会话
async function useCurrentConfig() {
  if (!workspaceConfig.value) return
  loading.value = true
  try {
    await createSession(workspaceConfig.value)
    show('会话已创建')
    router.push('/chat')
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

function onSessionCreated() {
  router.push('/chat')
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <!-- 顶部提示框：工作目录选择器 -->
    <div class="workspace-bar">
      <span class="workspace-bar-label">工作目录</span>
      <span v-if="workspaceName" class="workspace-bar-path">{{ workspaceName }}</span>
      <span v-else class="workspace-bar-hint">未选择本地目录（只支持宿主本机路径）</span>
      <button class="btn-outline btn-sm" :disabled="loading" @click="selectWorkspace">
        {{ workspaceName ? '更换目录' : '选择目录' }}
      </button>
    </div>

    <!-- 主体 -->
    <div style="flex:1;display:flex;overflow:hidden;min-height:0">

      <!-- 左侧边栏 -->
      <div style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
        <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
          <button class="btn-outline btn-sm" style="width:100%" :disabled="loading" @click="openNew">+ 新建</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px">
          <div v-if="recentDirs.length === 0" style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
            暂无记录
          </div>
          <template v-else>
            <div style="padding:6px 8px 2px;font-size:11px;color:#9b9b9b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">
              最近使用
            </div>
            <div
              v-for="name in recentDirs"
              :key="name"
              class="dir-item"
              :class="{ active: workspaceName === name }"
            >
              <span class="dir-item-name" :title="name">{{ name }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

        <div class="page-toolbar">
          <span class="page-toolbar-title">{{ workspaceName || '目录' }}</span>
        </div>

        <div class="page-content">

          <!-- 未选目录 -->
          <div v-if="!workspaceHandle" style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
            <div style="margin-bottom:12px">请先选择一个本地目录，或点击「新建」选择目录并创建会话</div>
            <button class="btn-outline" @click="selectWorkspace">选择目录</button>
          </div>

          <!-- 已选目录 -->
          <template v-else>
            <div class="card">
              <div class="card-title">目录信息</div>
              <div style="font-size:13px;color:#3d3d3d;margin-bottom:6px">
                <span style="color:#9b9b9b">名称：</span>{{ workspaceName }}
              </div>
              <div style="font-size:13px;color:#3d3d3d">
                <span style="color:#9b9b9b">配置文件：</span>
                <span v-if="workspaceHasConfig" style="color:#16a34a">.sbot/settings.json 已找到</span>
                <span v-else style="color:#ef4444">未找到 .sbot/settings.json</span>
              </div>
            </div>

            <!-- 有配置：展示并提供快速新建 -->
            <div v-if="workspaceHasConfig && workspaceConfig" class="card">
              <div class="card-title">本地配置 (LocalConfig)</div>
              <div class="form-group">
                <label>Agent ID</label>
                <input type="text" :value="workspaceConfig.agentId" disabled />
              </div>
              <div class="form-group">
                <label>Saver ID</label>
                <input type="text" :value="workspaceConfig.saverId" disabled />
              </div>
              <div class="form-group">
                <label>Memory ID</label>
                <input type="text" :value="workspaceConfig.memoryId ?? '（未设置）'" disabled />
              </div>
              <button class="btn-primary" :disabled="loading" @click="useCurrentConfig">
                使用此配置新建会话
              </button>
            </div>

            <!-- 无配置：引导手动选择 -->
            <div v-else class="card">
              <div style="color:#9b9b9b;font-size:13px;margin-bottom:12px">
                该目录未包含 .sbot/settings.json，请手动选择会话配置。
              </div>
              <button class="btn-outline" @click="newSessionModal?.open()">手动选择 Agent / 存储</button>
            </div>
          </template>
        </div>

      </div>
    </div>

    <NewSessionModal ref="newSessionModal" @created="onSessionCreated" />
  </div>
</template>

<style scoped>
.workspace-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #f8f7f5;
  border-bottom: 2px solid #e8e6e3;
  flex-shrink: 0;
  font-size: 13px;
}
.workspace-bar-label {
  font-size: 12px;
  font-weight: 600;
  color: #9b9b9b;
  white-space: nowrap;
}
.workspace-bar-path {
  flex: 1;
  min-width: 0;
  font-family: monospace;
  font-size: 13px;
  color: #1c1c1c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 5px;
  padding: 3px 8px;
}
.workspace-bar-hint {
  flex: 1;
  font-size: 12px;
  color: #b0aead;
  font-style: italic;
}
.dir-item {
  padding: 7px 10px;
  border-radius: 6px;
  margin-bottom: 2px;
}
.dir-item.active { background: #f0efed; }
.dir-item-name {
  font-size: 12px;
  color: #3d3d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  font-family: monospace;
}
</style>
