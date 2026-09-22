<script setup lang="ts">
import { computed, inject, useAttrs } from "vue"
import { navTabBarKey, type NavTabBarContext } from "./STabBar.vue"

defineOptions({ name: "SNavTab", inheritAttrs: false })
const props = defineProps<{
  /** 页签标识，须与 STabBar 的 active 值对应 */
  name: string | number
  count?: number | string
  disabled?: boolean
}>()
const attrs = useAttrs()

const ctx = inject<NavTabBarContext | null>(navTabBarKey, null)
const active = computed(() => ctx?.active.value === props.name)
const card = computed(() => ctx?.variant.value === "card")

function onClick() {
  if (!props.disabled) ctx?.select(props.name)
}
</script>

<template>
  <button v-bind="attrs" type="button" class="s-nav-tab" :class="{ card: card, active: active, disabled: props.disabled }" role="tab" :aria-selected="active" :disabled="props.disabled" @click="onClick">
    <slot />
    <span v-if="props.count !== undefined && props.count !== ''" class="s-nav-tab-count" :class="{ active: active }">{{ props.count }}</span>
  </button>
</template>

<style scoped>
.s-nav-tab { display: inline-flex; align-items: center; gap: 4px; padding: 10px 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--sui-fg-disabled); font-family: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: color var(--sui-transition), background var(--sui-transition), border-color var(--sui-transition); }
.s-nav-tab:hover:not(.disabled) { color: var(--sui-fg-secondary); }
.s-nav-tab.active { border-bottom-color: var(--sui-primary); color: var(--sui-primary); }
.s-nav-tab.disabled { opacity: 0.5; cursor: not-allowed; }
.s-nav-tab-count { padding: 0 5px; border-radius: var(--sui-radius-pill); background: var(--sui-bg-soft); color: var(--sui-fg-muted); font-size: 11px; font-weight: 600; }
.s-nav-tab-count.active { background: var(--sui-primary); color: var(--sui-on-primary); }
.s-nav-tab.card { margin-bottom: 0; border: 1px solid var(--sui-border); border-bottom: 0; border-radius: var(--sui-radius-md) var(--sui-radius-md) 0 0; }
.s-nav-tab.card.active { border-color: var(--sui-border-strong); background: var(--sui-bg-soft); box-shadow: inset 0 2px 0 var(--sui-primary); }
</style>
