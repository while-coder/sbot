<template>
  <div class="msg-row" :class="role">
    <div class="msg-bubble" :class="role">
      <template v-for="(part, idx) in displayParts" :key="idx">
        <div v-if="part.type === 'text'" class="md-content" v-html="renderMd(part.text!)"></div>
        <div v-else-if="part.type === 'image'" class="inline-image">
          <img :src="part.url" />
        </div>
      </template>
    </div>
    <div class="msg-time" v-if="time">{{ time }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

interface DisplayPart {
  type: 'text' | 'image';
  text?: string;
  url?: string;
}

const props = defineProps<{
  role: string;
  content: string | any[];
  createdAt?: number;
}>();

function renderMd(text: string): string {
  return marked.parse(text) as string;
}

function resolveImageUrl(c: any): string | null {
  if (c?.type === 'image_url' && c.image_url?.url) return c.image_url.url;
  if (c?.type === 'image' && c.dataUrl) return c.dataUrl;
  if (c?.type === 'image' && c.data && c.mimeType) return `data:${c.mimeType};base64,${c.data}`;
  if (c?.type === 'inlineData' && c.inlineData?.data) return `data:${c.inlineData.mimeType};base64,${c.inlineData.data}`;
  return null;
}

const displayParts = computed<DisplayPart[]>(() => {
  const c = props.content;
  if (!c) return [];
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  const parts: DisplayPart[] = [];
  for (const item of c) {
    if (typeof item === 'string') {
      parts.push({ type: 'text', text: item });
    } else if (item?.type === 'text' && item.text) {
      parts.push({ type: 'text', text: item.text });
    } else {
      const url = resolveImageUrl(item);
      if (url) parts.push({ type: 'image', url });
    }
  }
  return parts;
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
  background: var(--chatui-bg-human);
  color: var(--chatui-fg-human);
  border-bottom-right-radius: 2px;
}
.msg-bubble.ai {
  background: var(--chatui-bg-ai);
  color: var(--chatui-fg-ai);
  border-bottom-left-radius: 2px;
}
.msg-time {
  font-size: 11px;
  color: var(--chatui-fg-secondary);
  margin-top: 2px;
  padding: 0 4px;
}
.msg-bubble :deep(p) { margin: 0 0 6px; }
.msg-bubble :deep(p:last-child) { margin-bottom: 0; }
.msg-bubble :deep(pre) {
  background: var(--chatui-bg-code);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 6px 0;
}
.msg-bubble :deep(code) {
  font-family: var(--chatui-font-family-mono);
  font-size: 0.9em;
}
.msg-bubble :deep(:not(pre) > code) {
  background: var(--chatui-bg-code);
  padding: 1px 4px;
  border-radius: 3px;
}
.msg-bubble :deep(ul), .msg-bubble :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.msg-bubble :deep(blockquote) {
  border-left: 3px solid var(--chatui-blockquote-border);
  padding: 2px 10px;
  margin: 4px 0;
  opacity: 0.85;
}
.inline-image {
  margin: 6px 0;
}
.inline-image img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
  cursor: pointer;
  object-fit: contain;
}
</style>
