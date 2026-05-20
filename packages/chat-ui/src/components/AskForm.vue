<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { SRadio, SCheckbox, SInput, SButton } from 'sbot-ui'
import type { AskEvent, AskAnswerPayload, ChatLabels } from '../types'
import { AskQuestionType } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  askEvent: AskEvent
  labels?: ChatLabels
}>()

const emit = defineEmits<{ submit: [payload: AskAnswerPayload] }>()
const L = computed(() => resolveLabels(props.labels))

const CUSTOM_SENTINEL = '__custom__'
const answers = ref<Record<number, string | string[]>>({})
const customInputs = ref<Record<number, string>>({})
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const hasCountdown = computed(() => (props.askEvent.remainSec ?? 0) > 0)

function initAnswers() {
  const init: Record<number, string | string[]> = {}
  props.askEvent.questions.forEach((q, i) => {
    if (q.type === AskQuestionType.Checkbox) init[i] = []
  })
  answers.value = init
  customInputs.value = {}
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function startTimer() {
  stopTimer()
  countdown.value = props.askEvent.remainSec ?? 0
  if (countdown.value <= 0) return
  timer = setInterval(() => { if (countdown.value > 0) countdown.value-- }, 1000)
}

function resolveCustom(i: number, v: string): string {
  return v === CUSTOM_SENTINEL ? (customInputs.value[i] ?? '') : v
}

function submitAsk() {
  stopTimer()
  const result: Record<string, string | string[]> = {}
  props.askEvent.questions.forEach((_q, i) => {
    const val = answers.value[i]
    if (Array.isArray(val)) {
      const resolved = val.map(v => resolveCustom(i, v)).filter(Boolean)
      if (resolved.length > 0) result[String(i)] = resolved
    } else if (val !== undefined) {
      const resolved = resolveCustom(i, val)
      if (resolved !== '') result[String(i)] = resolved
    }
  })
  emit('submit', { askId: props.askEvent.id, answers: result })
}

onMounted(() => { initAnswers(); startTimer() })
onUnmounted(stopTimer)
</script>

<template>
  <div class="chatui-ask-form">
    <div v-if="askEvent.title" class="chatui-ask-title">{{ askEvent.title }}</div>
    <div v-for="(q, i) in askEvent.questions" :key="i" class="chatui-ask-question">
      <div class="chatui-ask-label">{{ q.label }}</div>
      <div v-if="q.type === AskQuestionType.Radio" class="chatui-ask-options">
        <SRadio
          v-for="opt in q.options"
          :key="opt"
          :name="`ask_${askEvent.id}_${i}`"
          :value="opt"
          :label="opt"
          v-model="(answers[i] as string)"
        />
        <SRadio
          :name="`ask_${askEvent.id}_${i}`"
          :value="CUSTOM_SENTINEL"
          :label="L.askOther"
          v-model="(answers[i] as string)"
        />
        <SInput
          v-if="answers[i] === CUSTOM_SENTINEL"
          class="chatui-ask-custom-input"
          size="sm"
          v-model="customInputs[i]"
          :placeholder="L.askOtherPlaceholder"
        />
      </div>
      <div v-else-if="q.type === AskQuestionType.Checkbox" class="chatui-ask-options">
        <SCheckbox
          v-for="opt in q.options"
          :key="opt"
          :value="opt"
          :label="opt"
          v-model="(answers[i] as string[])"
        />
        <SCheckbox
          :value="CUSTOM_SENTINEL"
          :label="L.askOther"
          v-model="(answers[i] as string[])"
        />
        <SInput
          v-if="(answers[i] as string[])?.includes(CUSTOM_SENTINEL)"
          class="chatui-ask-custom-input"
          size="sm"
          v-model="customInputs[i]"
          :placeholder="L.askOtherPlaceholder"
        />
      </div>
      <SInput
        v-else
        size="sm"
        v-model="(answers[i] as string)"
        :placeholder="q.placeholder ?? ''"
      />
    </div>
    <div class="chatui-ask-footer">
      <SButton size="sm" @click="submitAsk">{{ L.askSubmit }}<span v-if="hasCountdown"> ({{ countdown }}s)</span></SButton>
    </div>
  </div>
</template>

<style scoped>
.chatui-ask-form {
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px 16px; background: var(--chatui-ask-bg);
  border-bottom: 1px solid var(--chatui-ask-border);
  flex-shrink: 0; font-size: 13px; max-height: 50vh; overflow-y: auto;
}
.chatui-ask-title { font-weight: 600; font-size: 14px; color: var(--chatui-ask-title); }
.chatui-ask-question { display: flex; flex-direction: column; gap: 6px; }
.chatui-ask-label { font-weight: 500; color: var(--chatui-ask-label); }
.chatui-ask-options { display: flex; flex-direction: column; gap: 4px; }
.chatui-ask-custom-input { margin-top: 4px; margin-left: 20px; width: calc(100% - 20px); }
.chatui-ask-footer { display: flex; justify-content: flex-end; padding-top: 4px; }
</style>
