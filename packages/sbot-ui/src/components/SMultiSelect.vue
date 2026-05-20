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
  <div ref="root" class="s-ms" :class="{ 's-ms--compact': compact, 's-ms--open': open }">
    <button type="button" class="s-ms-trigger" @click="open = !open">
      <span class="s-ms-value">
        <template v-if="selectedLabels.length">
          <span v-for="label in selectedLabels" :key="label" class="s-ms-chip">{{ label }}</span>
        </template>
        <span v-else class="s-ms-placeholder">{{ placeholder ?? '—' }}</span>
      </span>
      <svg class="s-ms-arrow" viewBox="0 0 10 6" width="10" height="6">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
    </button>
    <div v-if="open" class="s-ms-dropdown">
      <div v-if="options.length === 0" class="s-ms-empty">—</div>
      <label
        v-for="opt in options"
        :key="opt.id"
        class="s-ms-option"
        :class="{ 's-ms-option--checked': modelValue.includes(opt.id) }"
      >
        <input type="checkbox" :checked="modelValue.includes(opt.id)" @change="toggle(opt.id)" />
        <span>{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.s-ms {
  position: relative;
  display: inline-flex;
  flex-direction: column;
}
.s-ms-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px 5px 10px;
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg);
  cursor: pointer;
  text-align: left;
  transition: border-color .15s;
  min-height: 32px;
  gap: 6px;
}
.s-ms--compact .s-ms-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.s-ms-trigger:hover, .s-ms--open .s-ms-trigger { border-color: var(--sui-border-strong); }
.s-ms-value {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.s-ms-chip {
  background: var(--sui-fg);
  color: var(--sui-bg);
  font-size: var(--sui-fs-sm);
  padding: 1px 7px;
  border-radius: 99px;
  white-space: nowrap;
}
.s-ms--compact .s-ms-chip { font-size: var(--sui-fs-xs); padding: 0 6px; }
.s-ms-placeholder {
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-disabled);
  line-height: 1.6;
}
.s-ms-arrow {
  color: var(--sui-fg-muted);
  flex-shrink: 0;
  transition: transform .15s;
}
.s-ms--open .s-ms-arrow { transform: rotate(180deg); }
.s-ms-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  width: max-content;
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  box-shadow: var(--sui-shadow-md);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}
.s-ms-option {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--sui-fs-md);
  color: var(--sui-fg);
  border-bottom: 1px solid var(--sui-border-subtle);
  user-select: none;
  transition: background .1s;
}
.s-ms-option:last-child { border-bottom: none; }
.s-ms-option:hover { background: var(--sui-bg-hover); }
.s-ms-option--checked { background: var(--sui-bg-active); font-weight: 500; }
.s-ms-option input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--sui-fg);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.s-ms-empty {
  padding: var(--sui-sp-3) var(--sui-sp-4);
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-disabled);
}
</style>
