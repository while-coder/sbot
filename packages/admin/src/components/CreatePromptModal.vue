<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from 'sbot-ui'
import { SModal, SButton, SFormItem, SInput, STextarea } from 'sbot-ui'

const props = defineProps<{
  prefix: string
  defaultExt?: string
  visible: boolean
}>()

const emit = defineEmits<{
  created: [filePath: string, fileName: string]
  'update:visible': [value: boolean]
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

function onClose() {
  emit('update:visible', false)
  emit('close')
}
</script>

<template>
  <SModal :visible="visible" :title="t('prompts.create_title')" width="sm" nested @update:visible="emit('update:visible', $event)" @close="emit('close')">
    <SFormItem :label="t('prompts.filename')">
      <div style="display:flex;align-items:center;gap:4px">
        <span class="prefix-hint">{{ prefix }}</span>
        <SInput v-model="name" :placeholder="`my-prompt${ext}`" style="flex:1" @keyup.enter="create" />
      </div>
    </SFormItem>
    <SFormItem :label="t('prompts.content')">
      <STextarea v-model="content" :rows="8" class="content-area" />
    </SFormItem>
    <template #footer>
      <SButton type="outline" @click="onClose">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" @click="create">{{ t('common.create') }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.prefix-hint {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
  flex-shrink: 0;
}
.content-area :deep(textarea) {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-md);
}
</style>
