<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'

const props = defineProps<{
  name: string | number
  count?: number | string
  disabled?: boolean
}>()

const ctx = inject<{
  active: ComputedRef<string | number | undefined>
  select: (v: string | number) => void
}>('sTabBar')

const active = computed(() => ctx?.active.value === props.name)

function onClick() {
  if (!props.disabled) ctx?.select(props.name)
}
</script>

<template>
  <button
    type="button"
    class="s-tab"
    :class="{ 's-tab--active': active, 's-tab--disabled': disabled }"
    :disabled="disabled"
    @click="onClick"
  >
    <slot />
    <span v-if="count !== undefined && count !== ''" class="s-tab__count" :class="{ 's-tab__count--active': active }">
      {{ count }}
    </span>
  </button>
</template>

<style scoped>
.s-tab {
  padding: var(--sui-sp-4) var(--sui-sp-6);
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--sui-fs-md);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  color: var(--sui-fg-disabled);
  transition: color var(--sui-transition-base);
  font-family: inherit;
}
.s-tab:hover:not(.s-tab--disabled) { color: var(--sui-fg-secondary); }
.s-tab--active { color: var(--sui-fg); border-bottom-color: var(--sui-fg); }
.s-tab--disabled { opacity: 0.5; cursor: not-allowed; }
.s-tab__count {
  margin-left: var(--sui-sp-1);
  font-size: var(--sui-fs-xs);
  padding: 0 5px;
  border-radius: 10px;
  font-weight: 600;
  background: var(--sui-bg-soft);
  color: var(--sui-fg-muted);
}
.s-tab__count--active { background: var(--sui-fg); color: var(--sui-bg); }
</style>
