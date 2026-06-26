<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SButton, SModal } from 'sbot-ui'
import AgendaTriggerFields from '@/components/AgendaTriggerFields.vue'
import type { AgendaRow } from '@/composables/useAgendas'
import { draftToSpec, emptyDraft, type TriggerDraft } from '@/composables/agendaTriggerDraft'

const { t } = useI18n()

// 本弹窗只负责「新增」触发器；编辑现有触发器在事项编辑弹窗内联完成。
// 触发器字段表单（AgendaTriggerFields）与编辑弹窗内联共用同一个组件。
const emit = defineEmits<{
  (e: 'submit', payload: { row: AgendaRow; spec: Record<string, unknown> }): void
}>()

const visible = ref(false)
const targetRow = ref<AgendaRow | null>(null)

const draft = reactive<TriggerDraft>(emptyDraft())

const spec = computed<Record<string, unknown> | null>(() => draftToSpec(draft))
const invalid = computed(() => spec.value == null)
const agendaId = computed(() => targetRow.value?.agendaId)

function openCreate(row: AgendaRow): void {
  targetRow.value = row
  Object.assign(draft, emptyDraft())
  visible.value = true
}

function submit(): void {
  const row = targetRow.value
  if (!row) return
  const built = spec.value
  if (!built) return
  emit('submit', { row, spec: built })
  visible.value = false
}

defineExpose({ openCreate })
</script>

<template>
  <SModal v-model:visible="visible" :title="t('agenda.trigger_edit_title_new')" width="md">
    <AgendaTriggerFields :draft="draft" :agenda-id="agendaId" />
    <p v-if="invalid" class="agenda-trigger-edit-error">{{ t('agenda.trigger_edit_invalid') }}</p>

    <template #footer>
      <SButton type="outline" @click="visible = false">{{ t('common.cancel') }}</SButton>
      <SButton type="primary" :disabled="invalid" @click="submit">{{ t('common.save') }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.agenda-trigger-edit-error {
  margin: var(--sui-sp-2) 0 0;
  color: var(--sui-danger);
  font-size: var(--sui-fs-sm);
}
</style>
