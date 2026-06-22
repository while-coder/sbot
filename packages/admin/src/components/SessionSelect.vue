<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { SSelect } from 'sbot-ui'
import { store } from '@/shared/store'
import { cachedChannelSessions, loadChannelSessions, type ChannelSession } from '@/composables/useChannelSessions'

const props = withDefaults(defineProps<{
  /** 选中的频道会话 db id；null = 未选 / 自动。 */
  modelValue: number | null
  /** 仅展示绑定到该 agenda 模板的会话；无匹配时回退到全部，避免下拉为空。 */
  agenda?: string
  /** 是否提供"空"选项（none / auto）。 */
  includeEmpty?: boolean
  /** 空选项的显示文案，缺省 "--"。 */
  emptyLabel?: string
  /** 空选项是否禁用（必选场景下作占位符）。 */
  emptyDisabled?: boolean
  size?: 'sm' | 'md'
}>(), {
  includeEmpty: true,
  emptyDisabled: false,
  size: 'md',
})

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const sessions = ref<ChannelSession[]>(cachedChannelSessions())

onMounted(async () => {
  try {
    sessions.value = await loadChannelSessions()
  } catch {
    sessions.value = []
  }
})

interface Group { channelName: string; sessions: ChannelSession[] }

function channelName(channelId: string): string {
  const channels = store.settings.channels as Record<string, { name?: string }> | undefined
  return channels?.[channelId]?.name || channelId
}

function sessionText(s: ChannelSession): string {
  return s.sessionName || s.autoSessionName || s.sessionId || `#${s.id}`
}

/** 按频道分组（optgroup 头即频道名，便于识别）。agenda 过滤无匹配时回退全部。 */
const groups = computed<Group[]>(() => {
  let list = sessions.value
  if (props.agenda) {
    const matched = list.filter(s => s.agenda === props.agenda)
    list = matched.length ? matched : list
  }
  const map = new Map<string, ChannelSession[]>()
  for (const s of list) {
    const arr = map.get(s.channelId) || []
    arr.push(s)
    map.set(s.channelId, arr)
  }
  return [...map.entries()].map(([channelId, arr]) => ({ channelName: channelName(channelId), sessions: arr }))
})

// 选中值不在可见分组里（会话被删/未绑定该 agenda）时补一条占位，避免值显示丢失。
const orphan = computed<ChannelSession | null>(() => {
  const v = props.modelValue
  if (v == null || v <= 0) return null
  if (groups.value.some(g => g.sessions.some(s => s.id === v))) return null
  return sessions.value.find(s => s.id === v) ?? { id: v, channelId: '', sessionId: String(v) }
})

const selectValue = computed(() => (props.modelValue == null || props.modelValue <= 0) ? '' : String(props.modelValue))

function onUpdate(v: string | number) {
  const s = String(v)
  emit('update:modelValue', s === '' ? null : Number(s))
}
</script>

<template>
  <SSelect :model-value="selectValue" :size="size" @update:model-value="onUpdate">
    <option v-if="includeEmpty" value="" :disabled="emptyDisabled">{{ emptyLabel || '--' }}</option>
    <option v-if="orphan" :value="String(orphan.id)">{{ sessionText(orphan) }}</option>
    <optgroup v-for="g in groups" :key="g.channelName" :label="g.channelName">
      <option v-for="s in g.sessions" :key="s.id" :value="String(s.id)">{{ sessionText(s) }}</option>
    </optgroup>
  </SSelect>
</template>
