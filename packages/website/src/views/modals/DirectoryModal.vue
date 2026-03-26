<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import PathPickerModal from './PathPickerModal.vue'
import MultiSelect from '@/components/MultiSelect.vue'

const { t } = useI18n()

type LocalDirCfg = { agent?: string; saver?: string; memories?: string[] }

const { show } = useToast()

const emit = defineEmits<{ saved: [path: string, cfg: LocalDirCfg] }>()

const showModal = ref(false)
const saving    = ref(false)
const reading   = ref(false)

// editingPath: 非空表示编辑模式，空表示新建模式
const editingPath = ref('')
const form = ref({ path: '', agent: '', saver: '', memories: [] as string[] })

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
    memories: cfg?.memories || [],
  }
  showModal.value = true
}

// ── 目录浏览器 ──────────────────────────────────────────
const pathPicker = ref<InstanceType<typeof PathPickerModal>>()

function openPicker() {
  pathPicker.value?.open(form.value.path.trim())
}

async function onPickerConfirm(selected: string) {
  form.value.path = selected
  // 自动静默读取本地配置
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(selected)}`)
    const cfg = res.data?.config as LocalDirCfg | null
    if (cfg) {
      form.value.agent  = cfg.agent  || ''
      form.value.saver  = cfg.saver  || ''
      form.value.memories = cfg.memories || []
      show(t('directory.config_read'))
    }
  } catch { /* 无配置文件，忽略 */ }
}

// ── 手动读取配置 ─────────────────────────────────────────
async function readLocalConfig() {
  const dir = form.value.path.trim()
  if (!dir) { show(t('directory.error_no_path'), 'error'); return }
  reading.value = true
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(dir)}`)
    if (!res.data?.exists) { show(t('directory.error_invalid'), 'error'); return }
    const cfg = res.data.config as LocalDirCfg | null
    if (!cfg) { show(t('directory.error_no_settings'), 'error'); return }
    form.value.agent  = cfg.agent  || ''
    form.value.saver  = cfg.saver  || ''
    form.value.memory = cfg.memories?.[0] || ''
    show(t('directory.config_read_success'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    reading.value = false
  }
}

async function save() {
  const dir = form.value.path.trim()
  if (!dir)              { show(t('directory.error_no_path'), 'error'); return }
  if (!form.value.agent) { show(t('channels.select_agent'), 'error'); return }
  if (!form.value.saver) { show(t('channels.select_saver'), 'error'); return }
  saving.value = true
  try {
    const body: any = { path: dir, agent: form.value.agent, saver: form.value.saver, memories: form.value.memories }
    const isEdit = !!editingPath.value
    await apiFetch('/api/directories', isEdit ? 'PUT' : 'POST', body)
    const cfg: LocalDirCfg = { agent: form.value.agent, saver: form.value.saver, memories: form.value.memories }
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
        <h3>{{ editingPath ? t('directory.edit_title') : t('directory.add_title') }}</h3>
        <button class="modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>{{ t('directory.path_label') }} *</label>
          <div style="display:flex;gap:6px">
            <input
              v-model="form.path"
              type="text"
              :disabled="!!editingPath"
              :placeholder="t('directory.path_placeholder')"
              style="flex:1"
            />
            <button class="btn-outline btn-sm" :disabled="!!editingPath" @click="openPicker">
              {{ t('directory.browse') }}
            </button>
            <button class="btn-outline btn-sm" :disabled="reading" @click="readLocalConfig">
              {{ reading ? t('directory.reading_config') : t('directory.read_config') }}
            </button>
          </div>
          <span class="hint">{{ t('directory.browse_hint') }}</span>
        </div>
        <div class="form-group">
          <label>{{ t('common.agent') }} *</label>
          <select v-model="form.agent">
            <option value="" disabled>{{ t('common.select_placeholder') }}</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>{{ t('common.storage') }} *</label>
          <select v-model="form.saver">
            <option value="" disabled>{{ t('common.select_placeholder') }}</option>
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>{{ t('common.memory') }}</label>
          <MultiSelect v-model="form.memories" :options="memoryOptions" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="showModal = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>

  <PathPickerModal ref="pathPicker" @confirm="onPickerConfirm" />
</template>
