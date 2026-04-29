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
    <div
      class="input-bar"
      :class="{ 'drag-over': isDragging }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.capture="isDragging = false"
      @drop="onDrop"
    >
      <input ref="fileInputEl" type="file" multiple style="display:none" @change="onFileChange" />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div v-if="attachments.length > 0" class="attachment-list">
          <div v-for="(att, i) in attachments" :key="att.name" class="attachment-chip">
            <img v-if="isImageAtt(att) && att.dataUrl" :src="att.dataUrl" class="attachment-thumb" />
            <span v-else class="attachment-icon">📄</span>
            <span class="attachment-name">{{ att.name }}</span>
            <button class="attachment-remove" @click="removeAttachment(i)">×</button>
          </div>
        </div>
        <RichInput
          ref="richInputRef"
          :placeholder="L.inputPlaceholder"
          @submit="onSend"
          @files="onFilesFromEditor"
        />
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-end">
        <button v-if="showAttachments" class="btn-attach" @click="fileInputEl?.click()" :title="L.addAttachment">
          {{ L.attachment }}
        </button>
        <button class="btn-send" :disabled="isStreaming" @click="onSend">
          {{ L.send }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { StoredMessage, AgentOption, SaverOption, MemoryOption, ContentPart, ChatLabels, Attachment } from '../types';
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
  showAttachments?: boolean;
}>(), {
  thinksUrlPrefix: null,
  onCancel: undefined,
  fetchFn: undefined,
  showAttachments: false,
});

const L = computed(() => resolveLabels(props.labels))

const emit = defineEmits<{
  send: [parts: ContentPart[], attachments: Attachment[]];
  updateConfig: [field: string, value: any];
}>();

const messagesEl = ref<HTMLElement>();
const richInputRef = ref<InstanceType<typeof RichInput>>();
const fileInputEl = ref<HTMLInputElement | null>(null);
const attachments = ref<Attachment[]>([]);
const isDragging = ref(false);
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(() => props.streamingContent, scrollToBottom);

// ── Attachments ──

function isTextMime(type: string) {
  return type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/xhtml+xml'
}

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    if (isTextMime(file.type)) {
      reader.onload = () => resolve({ name: file.name, type: file.type, content: reader.result as string })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
      reader.readAsDataURL(file)
    }
  })
}

async function addFiles(files: File[]) {
  for (const file of files) {
    if (attachments.value.find(a => a.name === file.name)) continue
    const att = await readFile(file)
    attachments.value.push(att)
  }
}

function isImageAtt(att: Attachment) {
  return att.type.startsWith('image/')
}

function removeAttachment(idx: number) {
  attachments.value.splice(idx, 1)
}

async function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  await addFiles(Array.from(files))
  ;(e.target as HTMLInputElement).value = ''
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
  isDragging.value = true
}

function onDragLeave() {
  dragLeaveTimer = setTimeout(() => { isDragging.value = false }, 80)
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  e.preventDefault()
  if (!e.dataTransfer?.files?.length) return
  const nonImageFiles = Array.from(e.dataTransfer.files).filter(f => !f.type.startsWith('image/'))
  if (nonImageFiles.length > 0) addFiles(nonImageFiles)
}

function onFilesFromEditor(files: File[]) {
  addFiles(files)
}

// ── Send ──

function onSend() {
  if (!richInputRef.value || props.isStreaming) return;
  const { parts } = richInputRef.value.getContent();
  const fileAtts = attachments.value.splice(0);
  if (parts.length === 0 && fileAtts.length === 0) return;
  emit('send', parts, fileAtts);
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
.input-bar.drag-over {
  outline: 2px dashed var(--vscode-focusBorder, #007fd4);
  outline-offset: -2px;
  background: rgba(0, 127, 212, 0.05);
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

/* Attachments */
.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.attachment-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--vscode-badge-background, rgba(255,255,255,0.1));
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  border-radius: 12px;
  font-size: 12px;
  color: var(--vscode-badge-foreground, var(--chatui-fg-primary));
  max-width: 200px;
}
.attachment-thumb {
  width: 18px;
  height: 18px;
  object-fit: cover;
  border-radius: 2px;
  flex-shrink: 0;
}
.attachment-icon { font-size: 13px; flex-shrink: 0; }
.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground));
  font-size: 14px;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}

.btn-attach {
  padding: 0 8px;
  height: 28px;
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
  border-radius: 6px;
  background: transparent;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground));
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-attach:hover {
  background: var(--vscode-list-hoverBackground);
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
