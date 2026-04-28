<template>
  <div class="chat-view">
    <!-- Config toolbar -->
    <div class="chat-toolbar">
      <div class="toolbar-row">
        <div class="toolbar-group">
          <label class="toolbar-label">Agent</label>
          <select
            class="toolbar-select"
            :value="currentAgent"
            @change="$emit('updateConfig', 'agent', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name || a.id }}</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label class="toolbar-label">Saver</label>
          <select
            class="toolbar-select"
            :value="currentSaver"
            @change="$emit('updateConfig', 'saver', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="s in savers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <div class="toolbar-row" v-if="memories.length">
        <div class="toolbar-group" style="flex:1">
          <label class="toolbar-label">Memory</label>
          <div class="memory-chips">
            <label
              v-for="m in memories"
              :key="m.id"
              class="memory-chip"
              :class="{ active: currentMemories.includes(m.id) }"
            >
              <input
                type="checkbox"
                :checked="currentMemories.includes(m.id)"
                @change="toggleMemory(m.id)"
                style="display:none"
              />
              {{ m.name }}
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div class="messages" ref="messagesEl">
      <MessageList
        :messages="messages"
        :is-streaming="isStreaming"
        :streaming-content="streamingContent"
        :thinks-url-prefix="thinksUrlPrefix"
        :labels="labels"
        :fetch-fn="fetchFn"
      />
    </div>

    <!-- Stop bar -->
    <div v-if="onCancel && isStreaming" class="chat-stop-bar">
      <button class="btn-stop" @click="onCancel">{{ L.stop }}</button>
    </div>

    <!-- Input bar -->
    <div class="input-bar">
      <RichInput
        ref="richInputRef"
        :placeholder="L.inputPlaceholder"
        @submit="onSend"
      />
      <button class="btn-send" :disabled="isStreaming" @click="onSend">
        {{ L.send }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { StoredMessage, AgentOption, SaverOption, MemoryOption, ContentPart, ChatLabels } from '../types';
import { resolveLabels } from '../labels';
import MessageList from './MessageList.vue';
import RichInput from './RichInput.vue';

const props = withDefaults(defineProps<{
  messages: StoredMessage[];
  streamingContent: string | any[];
  isStreaming: boolean;
  agents: AgentOption[];
  savers: SaverOption[];
  memories: MemoryOption[];
  currentAgent: string;
  currentSaver: string;
  currentMemories: string[];
  labels?: ChatLabels;
  thinksUrlPrefix?: string | null;
  onCancel?: () => void;
  fetchFn?: (url: string) => Promise<any>;
}>(), {
  thinksUrlPrefix: null,
  onCancel: undefined,
  fetchFn: undefined,
});

const L = computed(() => resolveLabels(props.labels))

const emit = defineEmits<{
  send: [parts: ContentPart[]];
  updateConfig: [field: string, value: any];
}>();

const messagesEl = ref<HTMLElement>();
const richInputRef = ref<InstanceType<typeof RichInput>>();

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(() => props.streamingContent, scrollToBottom);

function onSend() {
  if (!richInputRef.value || props.isStreaming) return;
  const { parts } = richInputRef.value.getContent();
  if (parts.length === 0) return;
  emit('send', parts);
  richInputRef.value.clear();
}

function toggleMemory(id: string) {
  const current = [...props.currentMemories];
  const idx = current.indexOf(id);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(id);
  }
  emit('updateConfig', 'memories', current);
}
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.chat-toolbar {
  border-bottom: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  padding: 6px 10px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.toolbar-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground));
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.toolbar-select {
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid var(--chatui-border, var(--vscode-input-border, rgba(255,255,255,0.1)));
  border-radius: 3px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  outline: none;
  font-family: inherit;
  max-width: 120px;
}
.toolbar-select:focus {
  border-color: var(--vscode-focusBorder);
}

/* Memory chips */
.memory-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.memory-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground));
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.memory-chip.active {
  background: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  border-color: transparent;
}
.memory-chip:hover {
  background: var(--vscode-list-hoverBackground);
}

/* Messages */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* Stop bar */
.chat-stop-bar {
  display: flex;
  justify-content: center;
  padding: 6px 10px;
  border-top: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
}
.btn-stop {
  padding: 4px 20px;
  border: 1px solid var(--vscode-errorForeground, #f48771);
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-errorForeground, #f48771);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}
.btn-stop:hover {
  background: rgba(244, 135, 113, 0.1);
}

/* Input bar */
.input-bar {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  background: var(--chatui-bg-surface, var(--vscode-editor-background));
  align-items: flex-end;
}
.input-bar .rich-input {
  flex: 1;
  border: 1px solid var(--chatui-border, var(--vscode-input-border, rgba(255,255,255,0.1)));
  border-radius: 6px;
  background: var(--vscode-input-background);
  padding: 6px 8px;
}
.input-bar .rich-input:focus-within {
  border-color: var(--vscode-focusBorder);
}
.btn-send {
  padding: 0 12px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-send:hover { background: var(--vscode-button-hoverBackground); }
.btn-send:disabled { opacity: 0.5; cursor: default; }
</style>
