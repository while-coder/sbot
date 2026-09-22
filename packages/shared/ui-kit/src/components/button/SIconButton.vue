<template>
  <component :is="props.href ? 'a' : 'button'" v-bind="attrs" :type="props.href ? undefined : 'button'" :href="props.href"
    :rel="props.href ? 'noopener' : undefined" class="s-icon-button" :style="style"
    :class="[props.variant ? `variant-${props.variant}` : null, { danger: props.danger }]">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed, useAttrs } from "vue"

defineOptions({ name: "SIconButton", inheritAttrs: false })

const px = (value: number | string | undefined, fallback: number) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

//无文字的图标按钮：方形尺寸用 size 控制，内部 svg 尺寸交给插槽内容自己定（带 width/height 属性或外层样式均可）。
//variant 扩展：ghost（默认，透明底 hover 浮起）/ outline（描边）/ plain（纯图标无 hover 底）；danger 用危险色；href 时渲染为链接
const props = withDefaults(defineProps<{
  size?: number | string
  variant?: "ghost" | "outline" | "plain"
  danger?: boolean
  href?: string
}>(), { size: 24 })

const attrs = useAttrs()
const style = computed(() => [{ width: px(props.size, 24), height: px(props.size, 24) }, attrs.style])
</script>

<style scoped>
.s-icon-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--sui-radius-sm);
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--sui-transition), color var(--sui-transition), border-color var(--sui-transition);
}
.s-icon-button:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.s-icon-button:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 1px; }
.s-icon-button.variant-outline { border: 1px solid var(--sui-border-strong); }
.s-icon-button.variant-plain:hover { background: transparent; color: var(--sui-primary); }
.s-icon-button.danger { color: var(--sui-danger); }
.s-icon-button.danger:hover { background: var(--sui-danger-soft); color: var(--sui-danger-strong); }
</style>
