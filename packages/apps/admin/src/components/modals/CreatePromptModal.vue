<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { toast } from '@sbot/ui-kit'
import { SModal, SButton, SFormItem, SInput, STextarea } from '@sbot/ui-kit'

const props = defineProps<{
  prefix: string
  defaultExt?: string
  show: boolean
}>()

const emit = defineEmits<{
  created: [filePath: string, fileName: string]
  'update:show': [value: boolean]
  close: []
}>()

const { t } = useI18n()

const name = ref('')
const content = ref('')

const ext = props.defaultExt || '.txt'

async function create() {
  const n = name.value.trim()
  if (!n) { toast.show('error', t('common.name_required')); return }
  const fileName = `${n}${n.endsWith('.txt') || n.endsWith('.md') ? '' : ext}`
  const filePath = `${props.prefix}${fileName}`
  try {
    await apiFetch('/api/prompts/content', 'PUT', { path: filePath, content: content.value })
    toast.show('success', t('common.created'))
    emit('created', filePath, fileName)
  } catch (e: any) {
    toast.show('error', e.message)
  }
}

function onClose() {
  emit('update:show', false)
  emit('close')
}
</script>

<template>
  <SModal :show="show" :title="t('prompts.create_title')" width="sm" nested @update:show="emit('update:show', $event)" @close="emit('close')">
    <SFormItem :label="t('prompts.filename')">
      <div style="display:flex;align-items:center;gap:4px">
        <span class="prefix-hint">{{ prefix }}</span>
        <SInput v-model:value="name" :placeholder="`my-prompt${ext}`" style="flex:1" @keyup.enter="create" />
      </div>
    </SFormItem>
    <SFormItem :label="t('prompts.content')">
      <STextarea v-model:value="content" :rows="8" class="content-area" />
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
