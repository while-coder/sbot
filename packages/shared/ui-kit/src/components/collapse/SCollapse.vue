<script lang="ts">
import type { InjectionKey } from "vue"

export interface CollapseContext { defaults: Set<unknown> }
export const collapseKey: InjectionKey<CollapseContext> = Symbol("collapse")
</script>

<script setup lang="ts">
import { provide, useAttrs } from "vue"

defineOptions({ name: "SCollapse", inheritAttrs: false })
const props = withDefaults(defineProps<{ defaultExpandedNames?: unknown[] }>(), { defaultExpandedNames: () => [] })
const attrs = useAttrs()

provide(collapseKey, { defaults: new Set(props.defaultExpandedNames) })
</script>

<template>
  <div v-bind="attrs" class="s-collapse">
    <slot />
  </div>
</template>

<style scoped>
.s-collapse { border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); overflow: hidden; }
/* 相邻 SCollapseItem 的根元素带本组件 scope id，可以直接命中 */
.s-collapse-item + .s-collapse-item { border-top: 1px solid var(--sui-border); }
</style>
