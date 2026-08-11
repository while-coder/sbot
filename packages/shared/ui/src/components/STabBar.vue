<script setup lang="ts">
import { computed, provide } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string | number
  variant?: 'underline' | 'card'
}>(), {
  variant: 'underline',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

provide('sTabBar', {
  active: computed(() => props.modelValue),
  select: (v: string | number) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="s-tab-bar" :class="`s-tab-bar--${variant}`">
    <slot />
  </div>
</template>

<style scoped>
.s-tab-bar {
  display: flex;
  align-items: center;
  padding: 0 var(--sui-sp-8);
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg);
  flex-shrink: 0;
}
</style>
