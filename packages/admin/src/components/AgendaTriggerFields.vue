<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SButton, SFormItem, SInput, SSelect, STextarea } from 'sbot-ui'
import SessionSelect from '@/components/SessionSelect.vue'
import type { TriggerDraft } from '@/composables/agendaTriggerDraft'

// 单条触发器的字段表单：直接编辑传入的 reactive draft。
// 新增弹窗（AgendaTriggerEditModal）与事项编辑内联（AgendaBoard）共用本组件。
const props = defineProps<{
  draft: TriggerDraft
  /** 限定投递会话下拉到该 agenda 模板；不传则展示全部会话。 */
  agendaId?: string
}>()

// 任一字段变更时通知父组件（内联编辑据此打「未保存」脏标记）。
const emit = defineEmits<{ (e: 'change'): void }>()

const { t } = useI18n()

function onChange(): void { emit('change') }
</script>

<template>
  <div class="agenda-trigger-fields">
    <SFormItem :label="t('agenda.trigger_kind')">
      <SSelect v-model="props.draft.kind" class="agenda-trigger-kind" @update:model-value="onChange">
        <option value="absolute">{{ t('agenda.trigger_absolute') }}</option>
        <option value="interval">{{ t('agenda.trigger_interval') }}</option>
        <option value="cron">{{ t('agenda.trigger_cron') }}</option>
      </SSelect>
    </SFormItem>

    <div v-if="props.draft.kind === 'absolute'" class="agenda-trigger-block">
      <SFormItem :label="t('agenda.edit_trigger_at')">
        <input v-model="props.draft.at" type="datetime-local" class="agenda-trigger-datetime" @change="onChange" />
      </SFormItem>
    </div>

    <div v-else-if="props.draft.kind === 'interval'" class="agenda-trigger-block">
      <SFormItem :label="t('agenda.edit_trigger_every')">
        <div class="agenda-trigger-every">
          <SInput
            :model-value="String(props.draft.amount)"
            type="number"
            min="1"
            class="agenda-trigger-amount"
            @update:model-value="(v: string | number) => { props.draft.amount = Number(v); onChange() }"
          />
          <SSelect v-model="props.draft.unit" @update:model-value="onChange">
            <option value="minute">{{ t('agenda.unit_minute') }}</option>
            <option value="hour">{{ t('agenda.unit_hour') }}</option>
            <option value="day">{{ t('agenda.unit_day') }}</option>
            <option value="week">{{ t('agenda.unit_week') }}</option>
          </SSelect>
        </div>
      </SFormItem>
      <SFormItem :label="t('agenda.edit_trigger_start_at')" :hint="t('agenda.edit_trigger_start_at_hint')">
        <div class="agenda-trigger-due">
          <input v-model="props.draft.startAt" type="datetime-local" class="agenda-trigger-datetime" @change="onChange" />
          <SButton v-if="props.draft.startAt" type="outline" size="sm" @click="props.draft.startAt = ''; onChange()">{{ t('agenda.edit_clear_due') }}</SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('agenda.edit_trigger_count')" :hint="t('agenda.edit_trigger_count_hint')">
        <SInput
          v-model="props.draft.count"
          type="number"
          min="1"
          :placeholder="t('agenda.edit_trigger_count_placeholder')"
          @update:model-value="onChange"
        />
      </SFormItem>
    </div>

    <div v-else-if="props.draft.kind === 'cron'" class="agenda-trigger-block">
      <SFormItem :label="t('agenda.edit_trigger_cron_expr')" :hint="t('agenda.edit_trigger_cron_expr_hint')">
        <SInput v-model="props.draft.expr" :placeholder="'0 0 9 * * 1-5'" @update:model-value="onChange" />
      </SFormItem>
      <SFormItem :label="t('agenda.edit_trigger_start_at')" :hint="t('agenda.edit_trigger_start_at_hint')">
        <div class="agenda-trigger-due">
          <input v-model="props.draft.startAt" type="datetime-local" class="agenda-trigger-datetime" @change="onChange" />
          <SButton v-if="props.draft.startAt" type="outline" size="sm" @click="props.draft.startAt = ''; onChange()">{{ t('agenda.edit_clear_due') }}</SButton>
        </div>
      </SFormItem>
      <SFormItem :label="t('agenda.edit_trigger_count')" :hint="t('agenda.edit_trigger_count_hint')">
        <SInput
          v-model="props.draft.count"
          type="number"
          min="1"
          :placeholder="t('agenda.edit_trigger_count_placeholder')"
          @update:model-value="onChange"
        />
      </SFormItem>
    </div>

    <SFormItem :label="t('agenda.trigger_action')">
      <SSelect v-model="props.draft.action" @update:model-value="onChange">
        <option value="notify">{{ t('agenda.action_notify') }}</option>
        <option value="notify_and_record">{{ t('agenda.action_notify_and_record') }}</option>
        <option value="invoke">{{ t('agenda.action_invoke') }}</option>
      </SSelect>
    </SFormItem>
    <SFormItem :label="t('agenda.trigger_message') + ' *'">
      <STextarea
        v-model="props.draft.message"
        :placeholder="t('agenda.edit_trigger_message_placeholder')"
        :rows="3"
        @update:model-value="onChange"
      />
    </SFormItem>
    <SFormItem :label="t('agenda.edit_channel_session')" :hint="t('agenda.edit_channel_session_hint')">
      <SessionSelect
        :model-value="props.draft.channelSessionId || null"
        :agenda="agendaId"
        :empty-label="t('agenda.edit_channel_session_auto')"
        @update:model-value="(v: number | null) => { props.draft.channelSessionId = v ?? 0; onChange() }"
      />
    </SFormItem>
  </div>
</template>

<style scoped>
.agenda-trigger-fields {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-1);
}
.agenda-trigger-block {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-1);
}
.agenda-trigger-kind { width: 140px; }
.agenda-trigger-every {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.agenda-trigger-amount { width: 90px; }
.agenda-trigger-due {
  display: flex;
  gap: var(--sui-sp-2);
  align-items: center;
}
.agenda-trigger-datetime {
  flex: 1;
  height: 32px;
  padding: 0 var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-sm);
  background: var(--sui-bg);
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  font-family: inherit;
  outline: none;
  color-scheme: light dark;
}
.agenda-trigger-datetime:focus {
  border-color: var(--sui-primary);
}
</style>
