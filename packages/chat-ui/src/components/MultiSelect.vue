<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Option { id: string; label: string }

const props = defineProps<{
  options: Option[]
  modelValue: string[]
  placeholder?: string
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)
const root = ref<HTMLElement>()

const selectedLabels = computed(() =>
  props.options.filter(o => props.modelValue.includes(o.id)).map(o => o.label)
)

function toggle(id: string) {
  const cur = props.modelValue
  emit('update:modelValue', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
}

function onOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onOutside))
onUnmounted(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="root" class="chatui-ms-root" :class="{ compact, open }">
    <button type="button" class="chatui-ms-trigger" @click="open = !open">
      <span class="chatui-ms-value">
        <template v-if="selectedLabels.length">
          <span v-for="label in selectedLabels" :key="label" class="chatui-ms-chip">{{ label }}</span>
        </template>
        <span v-else class="chatui-ms-placeholder">{{ placeholder ?? '—' }}</span>
      </span>
      <svg class="chatui-ms-arrow" viewBox="0 0 10 6" width="10" height="6">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
    </button>
    <div v-if="open" class="chatui-ms-dropdown">
      <div v-if="options.length === 0" class="chatui-ms-empty">—</div>
      <label
        v-for="opt in options"
        :key="opt.id"
        class="chatui-ms-option"
        :class="{ checked: modelValue.includes(opt.id) }"
      >
        <input type="checkbox" :checked="modelValue.includes(opt.id)" @change="toggle(opt.id)" />
        <span>{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.chatui-ms-root { position: relative; display: inline-flex; flex-direction: column; }
.chatui-ms-trigger {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 8px 5px 10px; border: 1px solid var(--chatui-border);
  border-radius: 6px; background: var(--chatui-bg-surface);
  cursor: pointer; text-align: left; min-height: 32px; gap: 6px;
  color: var(--chatui-fg); font-size: inherit; font-family: inherit;
}
.chatui-ms-root.compact .chatui-ms-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.chatui-ms-trigger:hover, .chatui-ms-root.open .chatui-ms-trigger { border-color: var(--chatui-border-focus); }
.chatui-ms-value { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chatui-ms-chip {
  background: var(--chatui-chip-bg); color: var(--chatui-chip-fg);
  font-size: 12px; padding: 1px 7px; border-radius: 99px; white-space: nowrap;
}
.chatui-ms-root.compact .chatui-ms-chip { font-size: 11px; padding: 0 6px; }
.chatui-ms-placeholder { font-size: 13px; color: var(--chatui-fg-secondary); line-height: 1.6; }
.chatui-ms-arrow { color: var(--chatui-fg-secondary); flex-shrink: 0; transition: transform .15s; }
.chatui-ms-root.open .chatui-ms-arrow { transform: rotate(180deg); }
.chatui-ms-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 100%; width: max-content;
  background: var(--chatui-bg-surface); border: 1px solid var(--chatui-border);
  border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.1); z-index: 100;
  max-height: 200px; overflow-y: auto;
}
.chatui-ms-option {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  cursor: pointer; font-size: 13px; color: var(--chatui-fg);
  border-bottom: 1px solid var(--chatui-border-subtle); user-select: none;
}
.chatui-ms-option:last-child { border-bottom: none; }
.chatui-ms-option:hover { background: var(--chatui-bg-hover); }
.chatui-ms-option.checked { background: var(--chatui-bg-active); font-weight: 500; }
.chatui-ms-option input[type="checkbox"] {
  margin: 0; flex-shrink: 0; accent-color: var(--chatui-accent);
  width: 14px; height: 14px; cursor: pointer;
}
.chatui-ms-empty { padding: 8px 12px; font-size: 13px; color: var(--chatui-fg-secondary); }
</style>
