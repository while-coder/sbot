<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: 'xs' | 'sm' | 'md'
  variant?: 'ghost' | 'outline' | 'plain'   // plain = 无背景无边框，仅图标色
  danger?: boolean
  disabled?: boolean
  title?: string
  /** 提供 href 时按 <a> 渲染（链接、下载按钮等场景） */
  href?: string
  /** 仅在 href 存在时生效；target=_blank 会自动加上 rel="noopener noreferrer" */
  target?: '_blank' | '_self' | '_parent' | '_top'
}>(), {
  size: 'sm',
  variant: 'plain',
})

const cls = computed(() => [
  's-icon-btn',
  `s-icon-btn--${props.size}`,
  `s-icon-btn--${props.variant}`,
  { 's-icon-btn--danger': props.danger, 's-icon-btn--disabled': props.disabled && !!props.href },
])

const isLink = computed(() => !!props.href)
const linkRel = computed(() => (isLink.value && props.target === '_blank' ? 'noopener noreferrer' : undefined))
</script>

<template>
  <a
    v-if="isLink"
    :class="cls"
    :href="disabled ? undefined : href"
    :target="target"
    :rel="linkRel"
    :title="title"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : undefined"
  >
    <slot />
  </a>
  <button v-else type="button" :class="cls" :disabled="disabled" :title="title">
    <slot />
  </button>
</template>

<style scoped>
.s-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--sui-radius-sm);
  color: var(--sui-fg-disabled);
  font-family: inherit;
  line-height: 1;
  padding: 0 var(--sui-sp-1);
  transition: background var(--sui-transition-base), color var(--sui-transition-base);
}
.s-icon-btn:disabled,
.s-icon-btn--disabled { opacity: 0.45; cursor: not-allowed; }
.s-icon-btn--disabled { pointer-events: none; text-decoration: none; }
a.s-icon-btn { text-decoration: none; }

.s-icon-btn--xs { width: 16px; height: 16px; font-size: var(--sui-fs-sm); }
.s-icon-btn--sm { width: 20px; height: 20px; font-size: var(--sui-fs-md); }
.s-icon-btn--md { width: 28px; height: 28px; font-size: var(--sui-fs-lg); }

.s-icon-btn--plain:hover:not(:disabled) { color: var(--sui-fg-secondary); }
.s-icon-btn--ghost:hover:not(:disabled) { background: var(--sui-bg-soft); color: var(--sui-fg); }

.s-icon-btn--outline {
  border: 1px solid var(--sui-border-strong);
  color: var(--sui-fg-muted);
}
.s-icon-btn--outline:hover:not(:disabled) {
  background: var(--sui-bg-active);
  color: var(--sui-fg);
}

.s-icon-btn--danger:hover:not(:disabled) { color: var(--sui-danger-hover); }
</style>
