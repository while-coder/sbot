<script setup lang="ts">
import { computed } from 'vue'
import type { SessionItem, AppSettings, ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import MultiSelect from './MultiSelect.vue'

const props = defineProps<{
  session: SessionItem | null
  settings: AppSettings
  labels?: ChatLabels
}>()

const emit = defineEmits<{
  updateConfig: [field: string, value: any]
  openPathPicker: [currentPath: string]
}>()

const L = computed(() => resolveLabels(props.labels))

const agentOptions = computed(() =>
  Object.entries(props.settings.agents || {}).map(([id, a]) => ({ id, label: a.name || id, type: a.type || '' }))
)
const saverOptions = computed(() =>
  Object.entries(props.settings.savers || {}).map(([id, s]) => ({ id, label: s.name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(props.settings.memories || {}).map(([id, m]) => ({ id, label: m.name || id }))
)
const wikiOptions = computed(() =>
  Object.entries(props.settings.wikis || {}).map(([id, w]) => ({ id, label: w.name || id }))
)
</script>

<template>
  <div class="chatui-config-toolbar">
    <template v-if="session">
      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.agent }}</label>
        <select class="chatui-toolbar-select"
          :value="session.agent"
          @change="emit('updateConfig', 'agent', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}{{ a.type ? ` (${a.type})` : '' }}</option>
        </select>
      </div>

      <div class="chatui-toolbar-sep" />

      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.storage }}</label>
        <select class="chatui-toolbar-select"
          :value="session.saver || ''"
          @change="emit('updateConfig', 'saver', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>

      <div class="chatui-toolbar-sep" />

      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.workpath }}</label>
        <input class="chatui-toolbar-input" :value="session.workPath || ''"
          :placeholder="L.workpathPlaceholder" readonly
          :title="session.workPath || L.workpathPlaceholder"
          style="max-width:180px" />
        <button class="chatui-btn-outline chatui-btn-sm" @click="emit('openPathPicker', session.workPath || '')">…</button>
        <button v-if="session.workPath" class="chatui-toolbar-clear" @click="emit('updateConfig', 'workPath', undefined)">×</button>
      </div>

      <div class="chatui-toolbar-sep" />

      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.memory }}</label>
        <MultiSelect
          :model-value="session.memories || []"
          :options="memoryOptions"
          compact
          style="min-width:140px"
          @update:model-value="emit('updateConfig', 'memories', $event)"
        />
      </div>

      <div class="chatui-toolbar-sep" />

      <div class="chatui-toolbar-group">
        <label class="chatui-toolbar-label">{{ L.wiki }}</label>
        <MultiSelect
          :model-value="session.wikis || []"
          :options="wikiOptions"
          compact
          style="min-width:140px"
          @update:model-value="emit('updateConfig', 'wikis', $event)"
        />
      </div>

      <div class="chatui-toolbar-group" style="margin-left:auto">
        <label class="chatui-toolbar-toggle">
          <input type="checkbox"
            :checked="!!session.autoApproveAllTools"
            @change="emit('updateConfig', 'autoApproveAllTools', ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ L.autoApproveAll }}</span>
        </label>
      </div>
    </template>
    <span v-else class="chatui-toolbar-placeholder">{{ L.selectOrCreate }}</span>
  </div>
</template>

<style scoped>
.chatui-config-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; flex-wrap: wrap;
  border-bottom: 1px solid var(--chatui-border);
  background: var(--chatui-bg-surface); flex-shrink: 0;
}
.chatui-toolbar-group { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.chatui-toolbar-label {
  font-size: 11px; font-weight: 600; color: var(--chatui-fg-secondary);
  text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
}
.chatui-toolbar-select {
  font-size: 12px; padding: 3px 6px;
  border: 1px solid var(--chatui-border); border-radius: 4px;
  background: var(--chatui-bg-surface); color: var(--chatui-fg);
  outline: none; font-family: inherit;
}
.chatui-toolbar-select:focus { border-color: var(--chatui-border-focus); }
.chatui-toolbar-input {
  font-size: 12px; padding: 2px 6px;
  border: 1px solid var(--chatui-border); border-radius: 4px;
  background: var(--chatui-bg-hover); color: var(--chatui-fg-secondary);
  font-family: monospace; overflow: hidden; text-overflow: ellipsis; cursor: default;
}
.chatui-toolbar-sep {
  width: 1px; height: 18px; background: var(--chatui-border); flex-shrink: 0;
}
.chatui-toolbar-clear {
  background: none; border: none; cursor: pointer;
  color: var(--chatui-btn-danger); font-size: 14px;
  padding: 0 4px; line-height: 1;
}
.chatui-toolbar-toggle {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; cursor: pointer; color: var(--chatui-fg); white-space: nowrap;
}
.chatui-toolbar-toggle input { cursor: pointer; }
.chatui-toolbar-placeholder { font-size: 13px; color: var(--chatui-fg-secondary); }
.chatui-btn-outline {
  padding: 4px 10px; border: 1px solid var(--chatui-border);
  border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--chatui-fg);
}
.chatui-btn-outline:hover { background: var(--chatui-bg-hover); }
.chatui-btn-sm { padding: 4px 10px; font-size: 12px; }

@media (max-width: 768px) {
  .chatui-config-toolbar { gap: 6px; padding: 6px 8px; }
  .chatui-toolbar-sep { display: none; }
  .chatui-toolbar-group { flex-wrap: wrap; }
}
</style>
