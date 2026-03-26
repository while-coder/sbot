<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import MultiSelect from '@/components/MultiSelect.vue'

const { t } = useI18n()

const { show } = useToast()

const emit = defineEmits<{ created: [sessionId: string] }>()

const showModal = ref(false)
const saving = ref(false)
const form = ref({ agent: '', saver: '', memories: [] as string[] })

const agentOptions = computed(() =>
  Object.entries(store.settings.agents || {}).map(([id, a]) => ({ id, label: (a as any).name || id }))
)
const saverOptions = computed(() =>
  Object.entries(store.settings.savers || {}).map(([id, s]) => ({ id, label: (s as any).name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(store.settings.memories || {}).map(([id, m]) => ({ id, label: (m as any).name || id }))
)

function open() {
  form.value = { agent: '', saver: '', memories: [] }
  showModal.value = true
}

function autoName(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function create() {
  if (!form.value.agent) { show(t('new_session.error_agent'), 'error'); return }
  if (!form.value.saver) { show(t('new_session.error_saver'), 'error'); return }
  saving.value = true
  try {
    const body: any = { name: autoName(), agent: form.value.agent, saver: form.value.saver, memories: form.value.memories }
    const res = await apiFetch('/api/settings/sessions', 'POST', body)
    const id = res.data.id as string
    if (!store.settings.sessions) store.settings.sessions = {}
    store.settings.sessions[id] = body
    showModal.value = false
    emit('created', id)
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
        <h3>{{ t('new_session.title') }}</h3>
        <button class="modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="modal-body">
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
        <button class="btn-primary" :disabled="saving" @click="create">{{ t('common.create') }}</button>
      </div>
    </div>
  </div>
</template>
