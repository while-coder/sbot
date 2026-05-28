<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

type ThemeMode = 'light' | 'dark' | 'system'

defineProps<{ mode: ThemeMode }>()
const emit = defineEmits<{ update: [ThemeMode] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const options: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const labelOf = (m: ThemeMode) => options.find(o => o.value === m)!.label

function pick(m: ThemeMode) {
  emit('update', m)
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="theme-menu">
    <button
      class="theme-trigger"
      :title="`主题：${labelOf(mode)}`"
      @click="open = !open"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <span>{{ labelOf(mode) }}</span>
    </button>
    <div v-if="open" class="theme-dropdown">
      <div
        v-for="o in options"
        :key="o.value"
        class="theme-option"
        :class="{ active: mode === o.value }"
        @click.stop="pick(o.value)"
      >{{ o.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.theme-menu { position: relative; display: inline-block; }
.theme-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--chatui-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--chatui-fg);
}
.theme-trigger:hover { background: var(--chatui-bg-hover); }
.theme-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 110px;
  background: var(--chatui-bg-surface);
  border: 1px solid var(--chatui-border);
  border-radius: 4px;
  padding: 4px 0;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}
.theme-option {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--chatui-fg);
  cursor: pointer;
  white-space: nowrap;
}
.theme-option:hover { background: var(--chatui-bg-hover); }
.theme-option.active { font-weight: 600; color: var(--chatui-accent); }
</style>
