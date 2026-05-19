<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  prefix: string
  defaultExt?: string
}>()

const emit = defineEmits<{
  created: [filePath: string, fileName: string]
  close: []
}>()

const { t } = useI18n()
const { show } = useToast()

const name = ref('')
const content = ref('')

const ext = props.defaultExt || '.txt'

async function create() {
  const n = name.value.trim()
  if (!n) { show(t('common.name_required'), 'error'); return }
  const fileName = `${n}${n.endsWith('.txt') || n.endsWith('.md') ? '' : ext}`
  const filePath = `${props.prefix}${fileName}`
  try {
    await apiFetch('/api/prompts/content', 'PUT', { path: filePath, content: content.value })
    show(t('common.created'))
    emit('created', filePath, fileName)
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div class="modal-overlay" style="z-index:1100" @click.self="emit('close')">
    <div class="modal-box" style="width:480px">
      <div class="modal-header">
        <h3>{{ t('prompts.create_title') }}</h3>
        <button class="modal-close" @click="emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>{{ t('prompts.filename') }}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="color:#9b9b9b;font-size:13px;flex-shrink:0">{{ prefix }}</span>
            <input v-model="name" :placeholder="`my-prompt${ext}`" style="flex:1" @keyup.enter="create" />
          </div>
        </div>
        <div class="form-group">
          <label>{{ t('prompts.content') }}</label>
          <textarea v-model="content" rows="8" style="font-family:'Consolas','Monaco',monospace;font-size:13px" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="create">{{ t('common.create') }}</button>
      </div>
    </div>
  </div>
</template>
