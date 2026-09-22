<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "SButton", inheritAttrs: false })
const props = withDefaults(defineProps<{
  type?: string
  size?: string
  loading?: boolean
  disabled?: boolean
  text?: boolean
  tertiary?: boolean
  block?: boolean
}>(), { type: "default", size: "medium" })
const attrs = useAttrs()

//type 兼容别名：danger→error（危险色实底）、outline→default（wm 默认即描边款）；size 兼容 sm/md 缩写
const normalizedType = computed(() => props.type === "danger" ? "error" : props.type === "outline" ? "default" : props.type)
const normalizedSize = computed(() => props.size === "sm" ? "small" : props.size === "md" ? "medium" : props.size)
const isText = computed(() => props.text || props.type === "text")
</script>

<template>
  <button v-bind="attrs" :type="(attrs as any).type ?? 'button'" :disabled="props.disabled || props.loading"
    :class="['s-button', `type-${normalizedType}`, `size-${normalizedSize}`, { text: isText, tertiary: props.tertiary, block: props.block, loading: props.loading }]">
    <span v-if="props.loading" class="s-spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.s-button { display: inline-flex; min-height: 32px; align-items: center; justify-content: center; gap: 6px; padding: 5px 12px; border: 1px solid var(--sui-border-strong); border-radius: var(--sui-radius-md); background: var(--sui-bg); color: var(--sui-fg-secondary); cursor: pointer; font: inherit; line-height: 1.35; white-space: nowrap; transition: background var(--sui-transition), border-color var(--sui-transition), color var(--sui-transition); }
.s-button:hover:not(:disabled) { background: var(--sui-bg-hover); }
.s-button:disabled { cursor: not-allowed; opacity: 0.5; }
.s-button.size-small { min-height: 28px; padding: 3px 9px; font-size: 12px; }
.s-button.type-primary { border-color: var(--sui-primary); background: var(--sui-primary); color: var(--sui-on-primary); }
.s-button.type-primary:hover:not(:disabled) { background: var(--sui-primary-hover); }
.s-button.type-error { border-color: var(--sui-danger); background: var(--sui-danger); color: #fff; }
.s-button.text { min-height: 24px; padding: 0 4px; border-color: transparent; background: transparent; color: var(--sui-primary); }
.s-button.tertiary { background: transparent; }
.s-button.block { width: 100%; }
</style>
