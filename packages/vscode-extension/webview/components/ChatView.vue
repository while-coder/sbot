<template>
  <div class="chat-view">
    <div class="messages" ref="messagesEl">
      <MessageItem
        v-for="(m, i) in messages"
        :key="i"
        :role="m.message.role"
        :content="m.message.content"
        :createdAt="m.createdAt"
      />
      <div v-if="isStreaming && streamingContent" class="msg-row ai">
        <div class="msg-bubble ai streaming" v-html="renderedStreaming"></div>
      </div>
    </div>
    <div class="input-area">
      <textarea
        ref="inputEl"
        v-model="inputText"
        @keydown="onKeydown"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        rows="1"
      ></textarea>
      <button class="btn-send" :disabled="!inputText.trim() || isStreaming" @click="onSend">
        发送
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { marked } from 'marked';
import type { StoredMessage } from '../composables/useChat';
import MessageItem from './MessageItem.vue';

const props = defineProps<{
  messages: StoredMessage[];
  streamingContent: string;
  isStreaming: boolean;
}>();

const emit = defineEmits<{ send: [text: string] }>();

const inputText = ref('');
const messagesEl = ref<HTMLElement>();
const inputEl = ref<HTMLTextAreaElement>();

const renderedStreaming = computed(() => {
  return marked.parse(props.streamingContent) as string;
});

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(() => props.streamingContent, scrollToBottom);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
}

function onSend() {
  const text = inputText.value.trim();
  if (!text || props.isStreaming) return;
  emit('send', text);
  inputText.value = '';
  nextTick(() => {
    if (inputEl.value) {
      inputEl.value.style.height = 'auto';
    }
  });
}
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.msg-row.ai { display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 12px; }
.msg-bubble.ai {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 8px;
  border-bottom-left-radius: 2px;
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.08));
  color: var(--vscode-foreground);
  line-height: 1.5;
  word-break: break-word;
}
.msg-bubble.streaming { opacity: 0.85; }
.msg-bubble :deep(p) { margin: 0 0 6px; }
.msg-bubble :deep(p:last-child) { margin-bottom: 0; }
.msg-bubble :deep(pre) {
  background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}
.msg-bubble :deep(code) {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.9em;
}
.input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  background: var(--vscode-editor-background);
}
.input-area textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 6px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 8px 10px;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.4;
  min-height: 36px;
  max-height: 120px;
}
.input-area textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}
.btn-send {
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.btn-send:hover { background: var(--vscode-button-hoverBackground); }
.btn-send:disabled { opacity: 0.5; cursor: default; }
</style>
