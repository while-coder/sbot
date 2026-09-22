<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SFormItem", inheritAttrs: false })
const props = defineProps<{
  label?: string
  /** 底部辅助说明（error 存在时不显示） */
  hint?: string
  /** 底部错误文案（优先于 hint） */
  error?: string
  required?: boolean
  /** 行内模式：flex:1 且最小宽度，用于表单行多列排布 */
  inline?: boolean
}>()
const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" :class="['s-form-item', { inline: props.inline }]">
    <label v-if="props.label || $slots.label" class="s-form-label">
      <slot name="label">{{ props.label }}</slot>
      <span v-if="props.required" class="s-form-req" aria-hidden="true">*</span>
    </label>
    <span class="s-form-control">
      <slot />
      <span v-if="props.error" class="s-form-error" role="alert">{{ props.error }}</span>
      <span v-else-if="props.hint || $slots.hint" class="s-form-hint"><slot name="hint">{{ props.hint }}</slot></span>
    </span>
  </div>
</template>

<style scoped>
.s-form-item { display: grid; gap: 6px; color: var(--sui-fg-secondary); font-size: 13px; }
.s-form-item.inline { flex: 1 1 0; min-width: 200px; }
.s-form-label { font-weight: 500; }
.s-form-req { margin-left: 2px; color: var(--sui-danger); }
.s-form-control { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.s-form-hint { color: var(--sui-fg-disabled); font-size: 11px; }
.s-form-error { color: var(--sui-danger); font-size: 11px; }
</style>
