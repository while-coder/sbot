<script lang="ts">
import { type ComputedRef, type InjectionKey } from "vue"

export interface NavTabBarContext {
  active: ComputedRef<string | number | undefined>
  select: (value: string | number) => void
  variant: ComputedRef<"underline" | "card">
}
//provide/inject 用 Symbol key，避免与 wm 已有符号冲突
export const navTabBarKey: InjectionKey<NavTabBarContext> = Symbol("s-nav-tab-bar")
</script>

<script setup lang="ts">
import { computed, provide, useAttrs } from "vue"

defineOptions({ name: "STabBar", inheritAttrs: false })
const props = withDefaults(defineProps<{
  /** 当前选中的页签 name，配合 SNavTab 使用（v-model:active） */
  active?: string | number
  variant?: "underline" | "card"
}>(), {
  variant: "underline",
})
const emit = defineEmits<{
  "update:active": [value: string | number]
}>()
const attrs = useAttrs()

provide(navTabBarKey, {
  active: computed(() => props.active),
  select: value => emit("update:active", value),
  variant: computed(() => props.variant),
})
</script>

<template>
  <div v-bind="attrs" class="s-tab-bar" :class="`type-${props.variant}`" role="tablist">
    <slot />
  </div>
</template>

<style scoped>
.s-tab-bar { display: flex; flex-shrink: 0; align-items: center; padding: 0 20px; border-bottom: 1px solid var(--sui-border); background: var(--sui-bg); }
.s-tab-bar.type-card { align-items: flex-end; background: var(--sui-bg-subtle); }
</style>
