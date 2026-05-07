<script setup lang="ts">
import { ref, computed } from 'vue'
import type { IChatTransport } from '../transport'
import type { ChatLabels, AppSettings } from '../types'
import { resolveLabels } from '../labels'
import MultiSelect from './MultiSelect.vue'

const props = defineProps<{
  transport: IChatTransport
  settings: AppSettings
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{ created: [sessionId: string] }>()

const showModal = ref(false)
const saving = ref(false)
const error = ref('')
const form = ref({ agent: '', saver: '', memories: [] as string[], wikis: [] as string[] })

const agentOptions = computed(() =>
  Object.entries(props.settings.agents || {}).map(([id, a]) => ({ id, label: a.name || id, type: a.type || '' }))
)
const saverOptions = computed(() =>
  Object.entries(props.settings.savers || {}).map(([id, s]) => ({ id, label: s.name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(props.settings.memories || {}).map(([id, m]) => ({ id, label: m.name || id }))
)
const wikiOptions = computed(() =>
  Object.entries(props.settings.wikis || {}).map(([id, w]) => ({ id, label: w.name || id }))
)

function open() {
  form.value = { agent: '', saver: '', memories: [], wikis: [] }
  error.value = ''
  showModal.value = true
}

function autoName(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function create() {
  error.value = ''
  if (!form.value.agent || !form.value.saver) {
    error.value = !form.value.agent ? L.value.errorNoAgent : L.value.errorNoSaver
    return
  }
  saving.value = true
  try {
    const res = await props.transport.createSession({
      name: autoName(),
      agent: form.value.agent,
      saver: form.value.saver,
      memories: form.value.memories,
      wikis: form.value.wikis,
    })
    showModal.value = false
    emit('created', res.id)
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <div v-if="showModal" class="chatui-modal-overlay" @click.self="showModal = false">
    <div class="chatui-modal-box" style="width:420px">
      <div class="chatui-modal-header">
        <h3>{{ L.newSessionTitle }}</h3>
        <button class="chatui-modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="chatui-modal-body">
        <div class="chatui-form-group">
          <label>{{ L.agent }} *</label>
          <select v-model="form.agent" class="chatui-select">
            <option value="" disabled>{{ L.selectPlaceholder }}</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}{{ a.type ? ` (${a.type})` : '' }}</option>
          </select>
        </div>
        <div class="chatui-form-group">
          <label>{{ L.storage }} *</label>
          <select v-model="form.saver" class="chatui-select">
            <option value="" disabled>{{ L.selectPlaceholder }}</option>
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="chatui-form-group">
          <label>{{ L.memory }}</label>
          <MultiSelect v-model="form.memories" :options="memoryOptions" />
        </div>
        <div class="chatui-form-group">
          <label>{{ L.wiki }}</label>
          <MultiSelect v-model="form.wikis" :options="wikiOptions" />
        </div>
      </div>
      <div class="chatui-modal-footer">
        <span v-if="error" class="chatui-form-error">{{ error }}</span>
        <button class="chatui-btn-outline" @click="showModal = false">{{ L.cancel }}</button>
        <button class="chatui-btn-primary" :disabled="saving" @click="create">{{ L.create }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chatui-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.chatui-modal-box {
  background: var(--chatui-bg-surface); border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18); max-width: 90vw;
}
.chatui-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--chatui-border);
}
.chatui-modal-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--chatui-fg); }
.chatui-modal-close {
  background: none; border: none; font-size: 20px; cursor: pointer;
  color: var(--chatui-fg-secondary); padding: 0 4px; line-height: 1;
}
.chatui-modal-close:hover { color: var(--chatui-fg); }
.chatui-modal-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.chatui-modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--chatui-border);
}
.chatui-form-group { display: flex; flex-direction: column; gap: 4px; }
.chatui-form-group label {
  font-size: 12px; font-weight: 600; color: var(--chatui-fg-secondary);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.chatui-select {
  padding: 6px 8px; border: 1px solid var(--chatui-border);
  border-radius: 6px; font-size: 13px; outline: none;
  background: var(--chatui-bg-surface); color: var(--chatui-fg);
  font-family: inherit;
}
.chatui-select:focus { border-color: var(--chatui-border-focus); }
.chatui-btn-outline {
  padding: 6px 14px; border: 1px solid var(--chatui-border);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 13px; color: var(--chatui-fg);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover); }
.chatui-btn-primary {
  padding: 6px 14px; border: none; border-radius: 6px;
  background: var(--chatui-btn-bg); color: var(--chatui-btn-fg);
  cursor: pointer; font-size: 13px;
}
.chatui-btn-primary:hover { background: var(--chatui-btn-hover); }
.chatui-btn-primary:disabled { opacity: 0.5; cursor: default; }
.chatui-form-error {
  font-size: 12px; color: var(--chatui-btn-danger, #ef4444); margin-right: auto;
}
</style>
