<script setup lang="ts">
import { useAttrs } from "vue"

defineOptions({ name: "SCard", inheritAttrs: false })
const props = withDefaults(defineProps<{
  title?: string
  size?: string
  bordered?: boolean
  closable?: boolean
}>(), { bordered: true })
const emit = defineEmits<{ close: [] }>()
const attrs = useAttrs()
</script>

<template>
  <section v-bind="attrs" :class="['s-card', `size-${props.size ?? 'medium'}`, { bordered: props.bordered }]">
    <header v-if="props.title || $slots.title || $slots['header-extra'] || props.closable" class="s-card-header">
      <div class="s-card-title"><slot name="title">{{ props.title }}</slot></div>
      <div class="s-card-extra">
        <slot name="header-extra" />
        <button v-if="props.closable" class="s-icon-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>
    <div v-if="$slots.toolbar" class="s-card-toolbar"><slot name="toolbar" /></div>
    <div class="s-card-body"><slot /></div>
    <footer v-if="$slots.footer" class="s-card-footer"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.s-card { min-width: 0; border-radius: var(--sui-radius-lg); background: var(--sui-bg); color: var(--sui-fg); box-shadow: var(--sui-shadow-sm); }
.s-card.bordered { border: 1px solid var(--sui-border); }
.s-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 10px 14px; border-bottom: 1px solid var(--sui-border); }
.s-card-title { font-size: 14px; font-weight: 600; }
.s-card-extra { display: flex; align-items: center; gap: 8px; }
.s-card-toolbar { padding: 10px 14px 0; }
.s-card-body { padding: 14px; }
.s-card.size-small .s-card-header { min-height: 36px; padding: 8px 12px; }
.s-card.size-small .s-card-body { padding: 12px; }
.s-card-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--sui-border); }
</style>
