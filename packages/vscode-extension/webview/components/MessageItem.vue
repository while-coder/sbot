<template>
  <div class="msg-row" :class="role">
    <div class="msg-bubble" :class="role" v-html="rendered"></div>
    <div class="msg-time" v-if="time">{{ time }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

const props = defineProps<{
  role: string;
  content: string | any[];
  createdAt?: number;
}>();

const rendered = computed(() => {
  const c = props.content;
  if (!c) return '';
  if (Array.isArray(c)) {
    const text = c
      .filter((p: any) => typeof p === 'string' || p?.type === 'text')
      .map((p: any) => (typeof p === 'string' ? p : p.text ?? ''))
      .join('\n');
    return marked.parse(text) as string;
  }
  return marked.parse(c) as string;
});

const time = computed(() => {
  if (!props.createdAt) return '';
  const d = new Date(props.createdAt * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
});
</script>

<style scoped>
.msg-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
}
.msg-row.human {
  align-items: flex-end;
}
.msg-row.ai {
  align-items: flex-start;
}
.msg-bubble {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 8px;
  line-height: 1.5;
  word-break: break-word;
}
.msg-bubble.human {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-bottom-right-radius: 2px;
}
.msg-bubble.ai {
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.08));
  color: var(--vscode-foreground);
  border-bottom-left-radius: 2px;
}
.msg-time {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
  padding: 0 4px;
}
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
.msg-bubble :deep(:not(pre) > code) {
  background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
  padding: 1px 4px;
  border-radius: 3px;
}
.msg-bubble :deep(ul), .msg-bubble :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.msg-bubble :deep(blockquote) {
  border-left: 3px solid var(--vscode-textBlockQuote-border);
  padding: 2px 10px;
  margin: 4px 0;
  opacity: 0.85;
}
</style>
