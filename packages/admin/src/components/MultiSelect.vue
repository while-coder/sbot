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
  <div ref="root" class="ms-root" :class="{ compact, open }">
    <button type="button" class="ms-trigger" @click="open = !open">
      <span class="ms-value">
        <template v-if="selectedLabels.length">
          <span v-for="label in selectedLabels" :key="label" class="ms-chip">{{ label }}</span>
        </template>
        <span v-else class="ms-placeholder">{{ placeholder ?? '—' }}</span>
      </span>
      <svg class="ms-arrow" viewBox="0 0 10 6" width="10" height="6">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
    </button>
    <div v-if="open" class="ms-dropdown">
      <div v-if="options.length === 0" class="ms-empty">—</div>
      <label
        v-for="opt in options"
        :key="opt.id"
        class="ms-option"
        :class="{ checked: modelValue.includes(opt.id) }"
      >
        <input type="checkbox" :checked="modelValue.includes(opt.id)" @change="toggle(opt.id)" />
        <span>{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.ms-root {
  position: relative;
  display: inline-flex;
  flex-direction: column;
}
.ms-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px 5px 10px;
  border: 1px solid #d4d2ce;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: border-color .15s;
  min-height: 32px;
  gap: 6px;
}
.ms-root.compact .ms-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.ms-trigger:hover, .ms-root.open .ms-trigger { border-color: #999; }
.ms-value {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.ms-chip {
  background: #1c1c1c;
  color: #fff;
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 99px;
  white-space: nowrap;
}
.ms-root.compact .ms-chip { font-size: 11px; padding: 0 6px; }
.ms-placeholder {
  font-size: 13px;
  color: #aaa;
  line-height: 1.6;
}
.ms-arrow {
  color: #999;
  flex-shrink: 0;
  transition: transform .15s;
}
.ms-root.open .ms-arrow { transform: rotate(180deg); }
.ms-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  width: max-content;
  background: #fff;
  border: 1px solid #d4d2ce;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}
.ms-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 13px;
  color: #1c1c1c;
  border-bottom: 1px solid #f0eeeb;
  user-select: none;
  transition: background .1s;
}
.ms-option:last-child { border-bottom: none; }
.ms-option:hover { background: #f8f7f6; }
.ms-option.checked { background: #f4f4f4; font-weight: 500; }
.ms-option input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: #1c1c1c;
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.ms-empty {
  padding: 8px 12px;
  font-size: 13px;
  color: #94a3b8;
}
</style>
