<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
const { t } = useI18n()

const { show } = useToast()

const httpPort = ref<number | ''>('')
const httpUrl = ref('')
const maxImageSize = ref<number | ''>('')
const autoApproveAllTools = ref(false)
const autoApproveToolsText = ref('')
const startupCommands = ref<string[]>([])

watch(() => store.settings, (s) => {
  httpPort.value = s.httpPort ?? ''
  httpUrl.value = s.httpUrl || ''
  maxImageSize.value = s.maxImageSize ?? ''
  autoApproveAllTools.value = s.autoApproveAllTools ?? false
  autoApproveToolsText.value = (s.autoApproveTools ?? []).join(', ')
  startupCommands.value = [...(s.startupCommands ?? [])]
}, { immediate: true, deep: true })

function addStartupCommand() {
  startupCommands.value.push('')
}
function removeStartupCommand(index: number) {
  startupCommands.value.splice(index, 1)
}

// ── Drag & Drop ──────────────────────────────────────────────────
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index
  e.dataTransfer!.effectAllowed = 'move'
}
function onDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  dropIndex.value = index
}
function onDragLeave() {
  dropIndex.value = null
}
function onDrop(index: number) {
  const from = dragIndex.value
  if (from !== null && from !== index) {
    const item = startupCommands.value.splice(from, 1)[0]
    startupCommands.value.splice(index, 0, item)
  }
  dragIndex.value = null
  dropIndex.value = null
}
function onDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}

// 当前浏览器访问端口
const currentPort = parseInt(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80)

// 配置端口与当前访问端口不一致时显示提醒
const portMismatch = computed(() => {
  const p = httpPort.value === '' ? 5500 : Number(httpPort.value)
  return p !== currentPort
})

async function save() {
  try {
    const tools = autoApproveToolsText.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const cmds = startupCommands.value.filter(s => s.trim())
    const res = await apiFetch('/api/settings/general', 'PUT', {
      httpPort: httpPort.value === '' ? undefined : Number(httpPort.value),
      httpUrl: httpUrl.value.trim() || undefined,
      maxImageSize: maxImageSize.value === '' ? undefined : Number(maxImageSize.value),
      autoApproveAllTools: autoApproveAllTools.value,
      autoApproveTools: tools,
      startupCommands: cmds,
    })
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div v-if="portMismatch" class="port-mismatch-banner">
      {{ t('settings.port_changed') }}
    </div>
    <div class="page-toolbar">
      <button class="btn-primary btn-sm" @click="save">{{ t('common.save') }}</button>
    </div>
    <div class="page-content">
      <div class="card">
        <div class="card-title">{{ t('settings.service') }}</div>
        <div class="inline-form">
          <div class="form-group">
            <label>{{ t('settings.http_port') }}</label>
            <input v-model.number="httpPort" type="number" placeholder="5500" min="1" max="65535" />
          </div>
          <div class="form-group">
            <label>{{ t('settings.http_url') }}</label>
            <input v-model="httpUrl" type="text" placeholder="http://localhost:5500" />
          </div>
          <div class="form-group">
            <label>{{ t('settings.max_image_size') }}</label>
            <input v-model.number="maxImageSize" type="number" placeholder="1024" min="0" />
            <div class="form-hint">{{ t('settings.max_image_size_hint') }}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">{{ t('settings.tool_approval') }}</div>
        <div class="inline-form">
          <div class="form-group form-group-checkbox">
            <label>
              <input type="checkbox" v-model="autoApproveAllTools" />
              {{ t('settings.auto_approve_all') }}
            </label>
            <div class="form-hint">{{ t('settings.auto_approve_all_hint') }}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">{{ t('settings.startup_commands') }}</div>
        <div class="form-hint" style="margin-bottom:8px">{{ t('settings.startup_commands_hint') }}</div>
        <div
          v-for="(_, index) in startupCommands"
          :key="index"
          class="startup-cmd-item"
          :class="{ 'drag-over': dropIndex === index && dragIndex !== index, 'dragging': dragIndex === index }"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver(index, $event)"
          @dragleave="onDragLeave"
          @drop="onDrop(index)"
          @dragend="onDragEnd"
        >
          <span class="drag-handle" :title="t('settings.startup_commands_drag')">⠿</span>
          <textarea v-model="startupCommands[index]" rows="3" :placeholder="t('settings.startup_commands_placeholder')" />
          <button class="btn-icon btn-danger-text" @click="removeStartupCommand(index)" :title="t('common.delete')">✕</button>
        </div>
        <button class="btn-sm btn-outline" @click="addStartupCommand">{{ t('settings.startup_commands_add') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-group-checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.form-group-checkbox input[type='checkbox'] {
  width: auto;
  margin: 0;
}
.form-hint {
  font-size: 0.78rem;
  color: var(--color-text-muted, #888);
  margin-top: 4px;
}
.form-group.disabled label,
.form-group.disabled .form-hint {
  opacity: 0.45;
}
.port-mismatch-banner {
  background: var(--color-warning-bg, #7c5a0020);
  border-bottom: 1px solid var(--color-warning, #a07020);
  color: var(--color-warning, #c08020);
  font-size: 0.85rem;
  padding: 8px 16px;
  text-align: center;
}

.startup-cmd-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
  border-radius: 4px;
  transition: background 0.15s, opacity 0.15s;
}
.startup-cmd-item.dragging {
  opacity: 0.4;
}
.startup-cmd-item.drag-over {
  background: var(--color-primary-bg, rgba(100, 149, 237, 0.1));
  box-shadow: 0 -2px 0 0 var(--color-primary, #4a8fd4) inset;
}
.drag-handle {
  cursor: grab;
  user-select: none;
  padding: 6px 2px;
  color: var(--color-text-muted, #888);
  font-size: 1.1rem;
  line-height: 1;
  flex-shrink: 0;
}
.drag-handle:active {
  cursor: grabbing;
}
.startup-cmd-item textarea {
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
  resize: vertical;
}
.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 1rem;
  line-height: 1;
}
.btn-danger-text {
  color: var(--color-danger, #d44);
}
.btn-outline {
  background: none;
  border: 1px dashed var(--color-border, #ccc);
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 12px;
  color: var(--color-text-muted, #888);
}

@media (max-width: 768px) {
  .inline-form { flex-direction: column; }
  .card { padding: 12px; }
}
</style>
