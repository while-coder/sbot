<script setup lang="ts">
import { computed, useAttrs, useSlots } from "vue"

defineOptions({ name: "SInput", inheritAttrs: false })
const props = withDefaults(defineProps<{
  value?: string | number | null
  type?: string
  readonly?: boolean
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
  autosize?: boolean | Record<string, unknown>
  size?: string
  invalid?: boolean
}>(), { type: "text" })
const emit = defineEmits<{ "update:value": [value: any]; change: [value: any]; clear: [] }>()
const attrs = useAttrs()
const slots = useSlots()

//数字输入（type="number"）：空串发 null、其余转 Number，值语义与文本输入在这里分叉
const coerce = (raw: string) => props.type === "number" ? (raw === "" ? null : Number(raw)) : raw

const canClear = computed(() => props.clearable && props.value !== "" && props.value != null && !props.readonly && !props.disabled)
const rows = computed(() => (props.autosize as any)?.minRows ?? (attrs as any).rows ?? 4)
const onInput = (event: Event) => emit("update:value", coerce((event.target as HTMLInputElement).value))
const onChange = (event: Event) => emit("change", coerce((event.target as HTMLInputElement).value))
const clear = () => { emit("update:value", coerce("")); emit("change", coerce("")); emit("clear") }
</script>

<template>
  <span :class="['s-input-wrap', { 'has-suffix': Boolean(slots.suffix), 'has-clear': canClear }]">
    <textarea v-if="type === 'textarea'" v-bind="attrs" class="s-input" :class="{ invalid: props.invalid }" :value="value ?? ''" :readonly="readonly"
      :disabled="disabled" :placeholder="placeholder" :rows="rows" @input="onInput" @change="onChange" />
    <input v-else v-bind="attrs" class="s-input" :class="{ invalid: props.invalid }" :type="type" :value="value ?? ''" :readonly="readonly"
      :disabled="disabled" :placeholder="placeholder" @input="onInput" @change="onChange" />
    <button v-if="canClear" type="button" class="s-input-clear" aria-label="清空" @click="clear">×</button>
    <span v-if="slots.suffix" class="s-input-suffix"><slot name="suffix" /></span>
  </span>
</template>

<style scoped>
.s-input.invalid { border-color: var(--sui-danger); }
textarea.s-input { resize: vertical; line-height: 1.5; }
.s-input-clear { position: absolute; right: 7px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--sui-fg-muted); cursor: pointer; }
.s-input-clear:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.s-input-wrap.has-suffix .s-input-clear { right: 36px; }
</style>
