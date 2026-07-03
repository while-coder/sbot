<script setup lang="ts">
import { computed } from 'vue'
import type { ChatLabels, RemoteEntry } from '../types'
import type { IChatTransport } from '../transport'
import type { ServerSelectionPhase } from '../composables/useServerSelection'
import { resolveLabels } from '../labels'
import ChatView from './ChatView.vue'
import ServerPicker from './ServerPicker.vue'

const props = withDefaults(defineProps<{
  phase: ServerSelectionPhase
  remotes: RemoteEntry[]
  transport: IChatTransport | null
  currentBaseUrl: string
  connectError?: string
  connecting?: boolean
  labels?: ChatLabels
  showAttachments?: boolean
  alwaysCompact?: boolean
}>(), {
  connectError: '',
  connecting: false,
  showAttachments: true,
  alwaysCompact: false,
})

const emit = defineEmits<{
  selectLocal: []
  selectRemote: [index: number]
  addRemote: [name: string, host: string, port: number, secure: boolean]
  updateRemote: [index: number, patch: Partial<RemoteEntry>]
  removeRemote: [index: number]
  switchServer: []
}>()

const L = computed(() => resolveLabels(props.labels))
</script>

<template>
  <div class="server-chat-shell">
    <div v-if="phase === 'server-pick'" class="server-chat-picker-actions">
      <slot name="picker-actions"></slot>
    </div>

    <template v-if="phase === 'server-pick'">
      <div v-if="connectError" class="server-chat-connect-error">{{ connectError }}</div>
      <div v-if="connecting" class="server-chat-connect-status">正在连接服务器...</div>
      <ServerPicker
        :remotes="remotes"
        :labels="labels"
        @select-local="emit('selectLocal')"
        @select-remote="(index) => emit('selectRemote', index)"
        @add-remote="(name, host, port, secure) => emit('addRemote', name, host, port, secure)"
        @update-remote="(index, patch) => emit('updateRemote', index, patch)"
        @remove-remote="(index) => emit('removeRemote', index)"
      />
    </template>

    <template v-else-if="transport">
      <div class="server-chat-bar">
        <span class="server-chat-url">{{ currentBaseUrl }}</span>
        <slot name="server-actions"></slot>
        <button class="server-chat-switch" @click="emit('switchServer')">{{ L.switchServer }}</button>
      </div>
      <ChatView
        :transport="transport"
        :labels="labels"
        :show-attachments="showAttachments"
        :always-compact="alwaysCompact"
      />
    </template>
  </div>
</template>

<style scoped>
.server-chat-shell {
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--server-chat-fg, var(--chatui-fg));
  background: var(--server-chat-bg, var(--chatui-bg));
}
.server-chat-picker-actions {
  position: fixed;
  top: var(--server-chat-picker-actions-top, 8px);
  right: var(--server-chat-picker-actions-right, 12px);
  z-index: var(--server-chat-picker-actions-z, 10);
}
.server-chat-bar {
  display: flex;
  align-items: center;
  gap: var(--server-chat-bar-gap, 8px);
  padding: var(--server-chat-bar-padding, 6px 12px);
  background: var(--server-chat-bar-bg, var(--chatui-bg-surface));
  border-bottom: 1px solid var(--server-chat-border, var(--chatui-border));
  flex-shrink: 0;
  font-size: var(--server-chat-bar-font-size, 12px);
}
.server-chat-url {
  flex: 1;
  min-width: 0;
  color: var(--server-chat-url-fg, var(--chatui-fg-secondary));
  font-family: var(--server-chat-url-font-family, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-chat-switch {
  padding: var(--server-chat-switch-padding, 2px 10px);
  border: 1px solid var(--server-chat-switch-border, var(--server-chat-border, var(--chatui-border)));
  border-radius: var(--server-chat-switch-radius, 4px);
  background: var(--server-chat-switch-bg, transparent);
  cursor: pointer;
  font-size: var(--server-chat-switch-font-size, var(--server-chat-bar-font-size, 12px));
  color: var(--server-chat-switch-fg, var(--chatui-fg));
  flex-shrink: 0;
}
.server-chat-switch:hover {
  background: var(--server-chat-switch-hover-bg, var(--chatui-bg-hover));
}
.server-chat-connect-error,
.server-chat-connect-status {
  padding: 8px 12px;
  margin: 8px 12px 0;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
}
.server-chat-connect-error {
  color: var(--server-chat-error-fg, var(--chatui-btn-danger, #d14343));
  background: var(--server-chat-error-bg, var(--chatui-bg-surface));
  border: 1px solid var(--server-chat-error-border, var(--chatui-btn-danger, #d14343));
}
.server-chat-connect-status {
  color: var(--server-chat-status-fg, var(--chatui-fg-secondary));
  background: var(--server-chat-status-bg, var(--chatui-bg-surface));
  border: 1px solid var(--server-chat-status-border, var(--server-chat-border, var(--chatui-border)));
}
</style>
