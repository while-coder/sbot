<script setup lang="ts">
import { ref, computed } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
// DirectoryConfig 是空接口（全局注册用），目录本地文件的实际结构用此类型
type LocalDirCfg = { agent?: string; saver?: string; memory?: string }

const { show } = useToast()
const _win = window as any

const emit = defineEmits<{ saved: [path: string, cfg: LocalDirCfg] }>()

const showModal = ref(false)
const saving   = ref(false)
const reading  = ref(false)
const browsing = ref(false)

// editingPath: 非空表示编辑模式，空表示新建模式
const editingPath = ref('')
const browsedName = ref('')   // showDirectoryPicker 返回的目录名（仅供参考）
const form = ref({ path: '', agent: '', saver: '', memory: '' })

const agentOptions  = computed(() =>
  Object.entries(store.settings.agents   || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)
const saverOptions  = computed(() =>
  Object.entries(store.settings.savers   || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)

function open(path = '', cfg?: LocalDirCfg) {
  editingPath.value = path
  browsedName.value = ''
  form.value = {
    path:   path,
    agent:  cfg?.agent  || '',
    saver:  cfg?.saver  || '',
    memory: cfg?.memory || '',
  }
  showModal.value = true
}

// 系统目录选择器（浏览器 File System Access API）
// 只能获取目录名，无法获得完整路径，但可直接读取本地 .sbot/settings.json 自动填充配置
async function browse() {
  if (!_win.showDirectoryPicker) { show('当前浏览器不支持目录选择', 'error'); return }
  browsing.value = true
  try {
    const handle = await _win.showDirectoryPicker({ mode: 'read' }) as FileSystemDirectoryHandle
    browsedName.value = handle.name
    if (!form.value.path.trim()) form.value.path = handle.name
    try {
      const sbotDir = await handle.getDirectoryHandle('.sbot')
      const fileHandle = await sbotDir.getFileHandle('settings.json')
      const file = await fileHandle.getFile()
      const cfg = JSON.parse(await file.text()) as any
      form.value.agent  = cfg.agent  || ''
      form.value.saver  = cfg.saver  || ''
      form.value.memory = cfg.memory || ''
      show('已读取配置')
    } catch {
      // 目录下无 .sbot/settings.json，仅填入目录名
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') show(e.message, 'error')
  } finally {
    browsing.value = false
  }
}

// 从目录的 .sbot/settings.json 读取 DirectoryConfig
async function readLocalConfig() {
  const dir = form.value.path.trim()
  if (!dir) { show('请先输入目录路径', 'error'); return }
  reading.value = true
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(dir)}`)
    if (!res.data?.exists) { show('路径不存在或不是目录', 'error'); return }
    const cfg = res.data.config as LocalDirCfg | null
    if (!cfg) { show('未找到 .sbot/settings.json', 'error'); return }
    form.value.agent  = cfg.agent  || ''
    form.value.saver  = cfg.saver  || ''
    form.value.memory = cfg.memory || ''
    show('配置读取成功')
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    reading.value = false
  }
}

async function save() {
  const dir = form.value.path.trim()
  if (!dir)              { show('请输入目录路径', 'error'); return }
  if (!form.value.agent) { show('请选择 Agent', 'error'); return }
  if (!form.value.saver) { show('请选择存储', 'error'); return }
  saving.value = true
  try {
    const body: any = { path: dir, agent: form.value.agent, saver: form.value.saver }
    if (form.value.memory) body.memory = form.value.memory
    const isEdit = !!editingPath.value
    await apiFetch('/api/directories', isEdit ? 'PUT' : 'POST', body)
    const cfg: LocalDirCfg = { agent: form.value.agent, saver: form.value.saver }
    if (form.value.memory) cfg.memory = form.value.memory
    // 更新 store（全局 settings.directories 只记空值，本地配置由后端写入文件）
    if (!store.settings.directories) store.settings.directories = {}
    store.settings.directories[dir] = {}
    showModal.value = false
    emit('saved', dir, cfg)
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
    <div class="modal-box">
      <div class="modal-header">
        <h3>{{ editingPath ? '编辑目录' : '新增目录' }}</h3>
        <button class="modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>目录路径 *</label>
          <div style="display:flex;gap:6px">
            <input
              v-model="form.path"
              type="text"
              :disabled="!!editingPath"
              placeholder="本地目录完整路径，如 D:/Work/myproject"
              style="flex:1"
            />
            <button class="btn-outline btn-sm" :disabled="browsing || !!editingPath" @click="browse">
              {{ browsing ? '选择中…' : '浏览…' }}
            </button>
            <button class="btn-outline btn-sm" :disabled="reading" @click="readLocalConfig">
              {{ reading ? '读取中…' : '读取配置' }}
            </button>
          </div>
          <span v-if="browsedName" class="hint">已选择目录：{{ browsedName }}（浏览器限制无法获取完整路径，请在上方确认）</span>
          <span v-else class="hint">「浏览」打开系统选择框自动填充配置；「读取配置」从输入路径读取</span>
        </div>
        <div class="form-group">
          <label>Agent *</label>
          <select v-model="form.agent">
            <option value="" disabled>请选择</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>存储 *</label>
          <select v-model="form.saver">
            <option value="" disabled>请选择</option>
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>记忆</label>
          <select v-model="form.memory">
            <option value="">不使用</option>
            <option v-for="m in memoryOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="showModal = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
