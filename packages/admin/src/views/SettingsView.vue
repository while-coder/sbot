<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, SButton, SInput, STextarea, SCard, SFormItem, SCheckCard, SPageToolbar, SPageContent } from 'sbot-ui'
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

const currentPort = parseInt(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80)

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
    <SPageToolbar>
      <SButton type="primary" size="sm" @click="save">{{ t('common.save') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <SCard :title="t('settings.service')">
        <div class="inline-form">
          <SFormItem :label="t('settings.http_port')">
            <SInput v-model.number="httpPort" type="number" placeholder="5500" min="1" max="65535" />
          </SFormItem>
          <SFormItem :label="t('settings.http_url')">
            <SInput v-model="httpUrl" type="text" placeholder="http://localhost:5500" />
          </SFormItem>
          <SFormItem :label="t('settings.max_image_size')" :hint="t('settings.max_image_size_hint')">
            <SInput v-model.number="maxImageSize" type="number" placeholder="1024" min="0" />
          </SFormItem>
        </div>
      </SCard>
      <SCard :title="t('settings.tool_approval')">
        <SCheckCard v-model="autoApproveAllTools">
          {{ t('settings.auto_approve_all') }}
        </SCheckCard>
        <div class="form-hint" style="margin-top:6px">{{ t('settings.auto_approve_all_hint') }}</div>
      </SCard>
      <SCard :title="t('settings.startup_commands')">
        <div class="form-hint">{{ t('settings.startup_commands_hint') }}</div>
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
          <STextarea v-model="startupCommands[index]" :rows="3" :placeholder="t('settings.startup_commands_placeholder')" class="startup-cmd-textarea" />
          <SButton type="text" size="sm" :title="t('common.delete')" class="startup-cmd-remove" @click="removeStartupCommand(index)">✕</SButton>
        </div>
        <SButton type="outline" size="sm" @click="addStartupCommand">{{ t('settings.startup_commands_add') }}</SButton>
      </SCard>
    </SPageContent>
  </div>
</template>

<style scoped>
.form-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-3);
}
.port-mismatch-banner {
  background: var(--sui-warning-bg);
  border-bottom: 1px solid var(--sui-warning-fg);
  color: var(--sui-warning-fg);
  font-size: var(--sui-fs-md);
  padding: var(--sui-sp-3) var(--sui-sp-7);
  text-align: center;
}

.startup-cmd-item {
  display: flex;
  gap: var(--sui-sp-3);
  align-items: flex-start;
  margin-bottom: var(--sui-sp-3);
  border-radius: var(--sui-radius-sm);
  transition: background 0.15s, opacity 0.15s;
}
.startup-cmd-item.dragging {
  opacity: 0.4;
}
.startup-cmd-item.drag-over {
  background: var(--sui-info-soft);
  box-shadow: 0 -2px 0 0 var(--sui-info) inset;
}
.drag-handle {
  cursor: grab;
  user-select: none;
  padding: var(--sui-sp-2) 2px;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xl);
  line-height: 1;
  flex-shrink: 0;
}
.drag-handle:active {
  cursor: grabbing;
}
.startup-cmd-textarea {
  flex: 1;
}
.startup-cmd-textarea :deep(textarea) {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-md);
}
.startup-cmd-remove {
  flex-shrink: 0;
}

.inline-form { display: flex; gap: var(--sui-sp-7); flex-wrap: wrap; }
.inline-form > * { flex: 1; min-width: 200px; }

@media (max-width: 768px) {
  .inline-form { flex-direction: column; }
}
</style>
