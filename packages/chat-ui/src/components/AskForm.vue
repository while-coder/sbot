<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AskEvent, AskAnswerPayload, ChatLabels } from '../types'
import { AskQuestionType } from '../types'
import { resolveLabels } from '../labels'

const props = withDefaults(defineProps<{
  askEvent: AskEvent
  labels?: ChatLabels
  initialCountdown?: number
}>(), {
  initialCountdown: 600,
})

const emit = defineEmits<{ submit: [payload: AskAnswerPayload] }>()
const L = computed(() => resolveLabels(props.labels))

const CUSTOM_SENTINEL = '__custom__'
const answers = ref<Record<number, string | string[]>>({})
const customInputs = ref<Record<number, string>>({})
const countdown = ref(props.initialCountdown)
let timer: ReturnType<typeof setInterval> | null = null

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
  countdown.value = props.initialCountdown
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
        <label v-for="opt in q.options" :key="opt" class="chatui-ask-option">
          <input type="radio" :name="`ask_${askEvent.id}_${i}`" :value="opt" v-model="answers[i]" />
          {{ opt }}
        </label>
        <label class="chatui-ask-option">
          <input type="radio" :name="`ask_${askEvent.id}_${i}`" :value="CUSTOM_SENTINEL" v-model="answers[i]" />
          {{ L.askOther }}
        </label>
        <input v-if="answers[i] === CUSTOM_SENTINEL" type="text" class="chatui-ask-input chatui-ask-custom-input"
          v-model="customInputs[i]" :placeholder="L.askOtherPlaceholder" />
      </div>
      <div v-else-if="q.type === AskQuestionType.Checkbox" class="chatui-ask-options">
        <label v-for="opt in q.options" :key="opt" class="chatui-ask-option">
          <input type="checkbox" :value="opt" v-model="(answers[i] as string[])" />
          {{ opt }}
        </label>
        <label class="chatui-ask-option">
          <input type="checkbox" :value="CUSTOM_SENTINEL" v-model="(answers[i] as string[])" />
          {{ L.askOther }}
        </label>
        <input v-if="(answers[i] as string[])?.includes(CUSTOM_SENTINEL)" type="text" class="chatui-ask-input chatui-ask-custom-input"
          v-model="customInputs[i]" :placeholder="L.askOtherPlaceholder" />
      </div>
      <input v-else type="text" class="chatui-ask-input" v-model="(answers[i] as string)"
        :placeholder="q.placeholder ?? ''" />
    </div>
    <div class="chatui-ask-footer">
      <button class="chatui-btn-primary chatui-btn-sm" @click="submitAsk">{{ L.askSubmit }} ({{ countdown }}s)</button>
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
.chatui-ask-option { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--chatui-fg); }
.chatui-ask-option input { cursor: pointer; }
.chatui-ask-input {
  padding: 5px 8px; border: 1px solid var(--chatui-ask-border);
  border-radius: 4px; font-size: 13px; outline: none;
  background: var(--chatui-bg-surface); color: var(--chatui-fg);
}
.chatui-ask-input:focus { border-color: var(--chatui-ask-focus); }
.chatui-ask-custom-input { margin-top: 4px; margin-left: 20px; }
.chatui-ask-footer { display: flex; justify-content: flex-end; padding-top: 4px; }
.chatui-btn-primary {
  border: none; border-radius: 6px;
  background: var(--chatui-btn-bg); color: var(--chatui-btn-fg);
  cursor: pointer;
}
.chatui-btn-primary:hover { background: var(--chatui-btn-hover); }
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }
</style>
