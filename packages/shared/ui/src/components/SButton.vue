<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  type?: 'primary' | 'outline' | 'danger' | 'text'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  htmlType?: 'button' | 'submit' | 'reset'
}>(), {
  type: 'primary',
  size: 'md',
  htmlType: 'button',
})

const cls = computed(() => [
  's-btn',
  `s-btn--${props.type}`,
  `s-btn--${props.size}`,
  { 's-btn--block': props.block, 's-btn--loading': props.loading },
])
</script>

<template>
  <button :type="htmlType" :class="cls" :disabled="disabled || loading">
    <span v-if="loading" class="s-btn__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.s-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-2) var(--sui-sp-6);
  border-radius: var(--sui-radius-md);
  font-family: inherit;
  font-size: var(--sui-fs-md);
  font-weight: 500;
  line-height: 1.4;
  border: none;
  cursor: pointer;
  transition: background var(--sui-transition-base), opacity var(--sui-transition-base), border-color var(--sui-transition-base);
  white-space: nowrap;
}
.s-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.s-btn--block { width: 100%; }
.s-btn--sm { padding: var(--sui-sp-1) var(--sui-sp-4); font-size: var(--sui-fs-sm); }

.s-btn--primary { background: var(--sui-primary); color: var(--sui-on-primary); }
.s-btn--primary:hover:not(:disabled) { background: var(--sui-primary-hover); }

.s-btn--outline {
  background: transparent;
  border: 1px solid var(--sui-border-strong);
  color: var(--sui-fg-secondary);
}
.s-btn--outline:hover:not(:disabled) { background: var(--sui-bg-soft); }

.s-btn--danger { background: var(--sui-danger); color: #fff; }
.s-btn--danger:hover:not(:disabled) { background: var(--sui-danger-hover); }

.s-btn--text {
  background: transparent;
  color: var(--sui-fg-secondary);
  padding: var(--sui-sp-1) var(--sui-sp-3);
}
.s-btn--text:hover:not(:disabled) { background: var(--sui-bg-soft); color: var(--sui-fg); }

.s-btn__spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: s-btn-spin .7s linear infinite;
}
@keyframes s-btn-spin { to { transform: rotate(360deg); } }
</style>
