<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

type LocalDirCfg = { agent?: string; saver?: string; memory?: string }

const { show } = useToast()

const emit = defineEmits<{ saved: [path: string, cfg: LocalDirCfg] }>()

const showModal = ref(false)
const saving    = ref(false)
const reading   = ref(false)

// editingPath: 非空表示编辑模式，空表示新建模式
const editingPath = ref('')
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
  form.value = {
    path,
    agent:  cfg?.agent  || '',
    saver:  cfg?.saver  || '',
    memory: cfg?.memory || '',
  }
  showModal.value = true
}

// ── 目录浏览器 ──────────────────────────────────────────
const pickerOpen    = ref(false)
const pickerLoading = ref(false)
const pickerPath    = ref('')               // 当前浏览路径
const pickerParent  = ref<string | null>(null)
const pickerItems   = ref<string[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<HTMLInputElement | null>(null)
const pickerQuickDirs = ref<{ label: string; path: string }[]>([])

function itemLabel(p: string): string {
  // Windows 驱动器根：C:\ → 直接显示
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).filter(Boolean).pop() || p
}

async function navigatePicker(dir: string): Promise<boolean> {
  pickerCreating.value = false
  pickerNewName.value  = ''
  pickerLoading.value  = true
  try {
    const q = dir ? `?dir=${encodeURIComponent(dir)}` : ''
    const res = await apiFetch(`/api/fs/list${q}`)
    pickerPath.value   = res.data.path
    pickerParent.value = res.data.parent
    pickerItems.value  = res.data.items
    return true
  } catch (e: any) {
    if (dir) show(e.message, 'error')
    return false
  } finally {
    pickerLoading.value = false
  }
}

function startCreate() {
  pickerCreating.value = true
  pickerNewName.value  = ''
  nextTick(() => newNameInput.value?.focus())
}

function cancelCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

async function confirmCreate() {
  const name = pickerNewName.value.trim()
  if (!name) return
  try {
    const res = await apiFetch('/api/fs/mkdir', 'POST', { path: `${pickerPath.value}/${name}` })
    await navigatePicker(res.data.path)
  } catch (e: any) {
    show(e.message, 'error')
  }
}

async function openPicker() {
  pickerPath.value      = ''
  pickerParent.value    = null
  pickerItems.value     = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true
  // 并行：加载快速目录 + 导航到起始路径
  apiFetch('/api/fs/quickdirs').then(r => { pickerQuickDirs.value = r.data ?? [] }).catch(() => {})
  const startDir = form.value.path.trim()
  if (startDir && await navigatePicker(startDir)) return
  await navigatePicker('')
}

async function confirmPicker() {
  const selected = pickerPath.value
  if (!selected) return
  pickerOpen.value = false
  form.value.path = selected
  // 自动静默读取本地配置
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(selected)}`)
    const cfg = res.data?.config as LocalDirCfg | null
    if (cfg) {
      form.value.agent  = cfg.agent  || ''
      form.value.saver  = cfg.saver  || ''
      form.value.memory = cfg.memory || ''
      show('已读取配置')
    }
  } catch { /* 无配置文件，忽略 */ }
}

// ── 手动读取配置 ─────────────────────────────────────────
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
  <!-- 主 Modal -->
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
            <button class="btn-outline btn-sm" :disabled="!!editingPath" @click="openPicker">
              浏览…
            </button>
            <button class="btn-outline btn-sm" :disabled="reading" @click="readLocalConfig">
              {{ reading ? '读取中…' : '读取配置' }}
            </button>
          </div>
          <span class="hint">「浏览」打开目录选择器并自动填充完整路径；「读取配置」从输入路径读取</span>
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

  <!-- 目录浏览器（叠在主 Modal 上方） -->
  <div v-if="pickerOpen" class="modal-overlay picker-overlay" @click.self="pickerOpen = false">
    <div class="modal-box picker-box">
      <div class="modal-header">
        <h3>选择目录</h3>
        <button class="modal-close" @click="pickerOpen = false">&times;</button>
      </div>

      <!-- 当前路径 -->
      <div class="picker-path-bar">
        {{ pickerPath || '我的电脑' }}
      </div>

      <!-- 快速跳转 -->
      <div v-if="pickerQuickDirs.length" class="picker-quickdirs">
        <button
          v-for="d in pickerQuickDirs"
          :key="d.path"
          class="picker-quickdir-chip"
          :class="{ active: pickerPath === d.path }"
          @click="navigatePicker(d.path)"
        >{{ d.label }}</button>
      </div>

      <!-- 目录列表 -->
      <div class="picker-list">
        <div v-if="pickerLoading" class="picker-empty">加载中…</div>
        <template v-else>
          <div
            v-if="pickerParent !== null"
            class="picker-item picker-up"
            @click="navigatePicker(pickerParent!)"
          >
            ↑ 上级目录
          </div>
          <!-- 新建文件夹输入行 -->
          <div v-if="pickerCreating" class="picker-create-row">
            <span class="picker-icon">▶</span>
            <input
              ref="newNameInput"
              v-model="pickerNewName"
              class="picker-create-input"
              placeholder="新文件夹名称"
              @keydown.enter="confirmCreate"
              @keydown.escape="cancelCreate"
            />
            <button class="picker-create-btn" title="确认" @click="confirmCreate">✓</button>
            <button class="picker-create-btn picker-create-cancel" title="取消" @click="cancelCreate">✕</button>
          </div>
          <div v-if="pickerItems.length === 0 && !pickerCreating" class="picker-empty">（无子目录）</div>
          <div
            v-for="item in pickerItems"
            :key="item"
            class="picker-item"
            @click="navigatePicker(item)"
          >
            <span class="picker-icon">▶</span>{{ itemLabel(item) }}
          </div>
        </template>
      </div>

      <div class="modal-footer">
        <button
          class="btn-outline btn-sm"
          style="margin-right:auto"
          :disabled="!pickerPath || pickerCreating"
          @click="startCreate"
        >+ 新建文件夹</button>
        <button class="btn-outline" @click="pickerOpen = false">取消</button>
        <button class="btn-primary" :disabled="!pickerPath" @click="confirmPicker">
          选择此目录
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay { z-index: 1001; }

.picker-box {
  width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.picker-path-bar {
  padding: 7px 14px;
  background: #f8f7f5;
  border-bottom: 1px solid #e8e6e3;
  font-family: monospace;
  font-size: 12px;
  color: #3d3d3d;
  word-break: break-all;
  flex-shrink: 0;
}

.picker-list {
  flex: 1;
  overflow-y: auto;
  min-height: 180px;
}

.picker-empty {
  text-align: center;
  padding: 40px;
  color: #94a3b8;
  font-size: 13px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 1px solid #f5f4f2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-item:hover { background: #f5f4f2; }

.picker-up {
  color: #6b7280;
  font-size: 12px;
  border-bottom: 1px solid #e8e6e3;
}

.picker-icon {
  color: #f59e0b;
  font-size: 10px;
  flex-shrink: 0;
}

.picker-quickdirs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 12px;
  border-bottom: 1px solid #e8e6e3;
  background: #fafaf9;
  flex-shrink: 0;
}

.picker-quickdir-chip {
  padding: 2px 10px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  color: #374151;
  line-height: 20px;
  transition: background .1s, border-color .1s;
}
.picker-quickdir-chip:hover { background: #f0efed; border-color: #9ca3af; }
.picker-quickdir-chip.active { background: #ede9fe; border-color: #a78bfa; color: #5b21b6; }

.picker-create-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-bottom: 1px solid #e8e6e3;
  background: #fafaf9;
}

.picker-create-input {
  flex: 1;
  height: 26px;
  padding: 0 6px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  outline: none;
}
.picker-create-input:focus { border-color: #6366f1; }

.picker-create-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #374151;
}
.picker-create-btn:hover { background: #f5f4f2; }
.picker-create-cancel { color: #9b9b9b; }
</style>
