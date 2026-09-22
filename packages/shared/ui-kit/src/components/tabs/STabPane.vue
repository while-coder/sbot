<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "STabPane", inheritAttrs: false })
defineProps<{ name?: any; tab?: string | number; count?: string | number; active?: boolean; displayDirective?: string; tabId?: string; panelId?: string }>()
const attrs = useAttrs()
</script>

<template>
  <section v-bind="attrs" :id="panelId" role="tabpanel" :aria-labelledby="tabId"
    :class="['s-tab-pane', { active }]" :style="[attrs.style, active ? null : { display: 'none' }]">
    <slot />
  </section>
</template>

<style scoped>
.s-tab-pane { width: 100%; height: 100%; min-width: 0; min-height: 0; flex: 1; overflow: auto; }
</style>
