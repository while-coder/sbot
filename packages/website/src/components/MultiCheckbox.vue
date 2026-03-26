<script setup lang="ts">
interface Option { id: string; label: string }

const props = defineProps<{
  options: Option[]
  modelValue: string[]
  compact?: boolean   // 工具栏紧凑模式
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

function toggle(id: string) {
  const cur = props.modelValue
  emit('update:modelValue', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
}
</script>

<template>
  <div class="mc-list" :class="{ compact }">
    <div v-if="options.length === 0" class="mc-empty">—</div>
    <label
      v-for="opt in options"
      :key="opt.id"
      class="mc-item"
      :class="{ checked: modelValue.includes(opt.id) }"
    >
      <input type="checkbox" :checked="modelValue.includes(opt.id)" @change="toggle(opt.id)" />
      <span class="mc-label">{{ opt.label }}</span>
    </label>
  </div>
</template>

<style scoped>
.mc-list {
  border: 1px solid #e2e0dc;
  border-radius: 6px;
  overflow-y: auto;
  max-height: 160px;
  background: #fff;
}
.mc-list.compact {
  max-height: 88px;
  border-radius: 5px;
}
.mc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid #f0eeeb;
  transition: background .1s;
  user-select: none;
}
.mc-item:last-child { border-bottom: none; }
.mc-item:hover { background: #f8f7f6; }
.mc-item.checked { background: #f0f4f8; }
.mc-item input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
  accent-color: #1c1c1c;
  cursor: pointer;
  width: 14px;
  height: 14px;
}
.mc-label {
  font-size: 13px;
  color: #1c1c1c;
  line-height: 1.3;
}
.mc-item.checked .mc-label { font-weight: 500; }
.mc-empty {
  padding: 8px 10px;
  font-size: 13px;
  color: #94a3b8;
}
</style>
