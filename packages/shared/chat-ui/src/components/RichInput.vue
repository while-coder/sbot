<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ContentPart } from '../types'
import type { CommandInfo } from '../transport'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

const props = withDefaults(defineProps<{
  placeholder?: string
  maxHeight?: number
  commands?: CommandInfo[]
}>(), {
  placeholder: '',
  maxHeight: 160,
  commands: () => [],
})

const emit = defineEmits<{
  submit: []
  files: [files: File[]]
}>()

// ── Slash command menu ──
const menuOpen = ref(false)
const menuItems = ref<CommandInfo[]>([])
const menuIndex = ref(0)
const menuEl = ref<HTMLElement | null>(null)

function scrollActiveIntoView() {
  nextTick(() => {
    menuEl.value?.querySelector('.slash-menu-item--active')?.scrollIntoView({ block: 'nearest' })
  })
}

function updateSlashMenu() {
  const ed = editor.value
  if (!ed || !props.commands.length) { menuOpen.value = false; return }
  const { state } = ed.view
  const { $from, empty } = state.selection
  if (!empty) { menuOpen.value = false; return }
  const start = $from.start()
  const textBefore = state.doc.textBetween(start, $from.pos, '\n', '\n')
  const m = textBefore.match(/^\/(\S*)$/)
  if (!m) { menuOpen.value = false; return }
  const query = m[1].toLowerCase()
  const items = props.commands.filter(c => c.name.toLowerCase().startsWith(query))
  if (items.length === 0) { menuOpen.value = false; return }
  menuItems.value = items
  menuIndex.value = Math.min(menuIndex.value, items.length - 1)
  if (!menuOpen.value) menuIndex.value = 0
  menuOpen.value = true
}

function moveMenu(delta: number) {
  const len = menuItems.value.length
  if (len === 0) return
  menuIndex.value = (menuIndex.value + delta + len) % len
  scrollActiveIntoView()
}

function closeMenu() {
  menuOpen.value = false
}

function applyCommand(cmd?: CommandInfo) {
  const ed = editor.value
  if (!ed || !cmd) return
  const { state } = ed.view
  const { $from } = state.selection
  const start = $from.start()
  ed.view.dispatch(state.tr.insertText(`/${cmd.name} `, start, $from.pos))
  ed.commands.focus()
  closeMenu()
}

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      dropcursor: { color: 'var(--chatui-border-focus)', width: 2 },
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
  ],
  editorProps: {
    handleDrop: (_view, event, _slice, moved) => {
      if (moved || !event.dataTransfer?.files.length) return false
      event.preventDefault()
      event.stopPropagation()
      emit('files', Array.from(event.dataTransfer.files))
      return true
    },
    handlePaste: (_view, event) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return false
      event.preventDefault()
      emit('files', files)
      return true
    },
    handleKeyDown: (_view, event) => {
      if (event.isComposing) return false
      if (menuOpen.value && menuItems.value.length > 0) {
        if (event.key === 'ArrowDown') { event.preventDefault(); moveMenu(1); return true }
        if (event.key === 'ArrowUp') { event.preventDefault(); moveMenu(-1); return true }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          applyCommand(menuItems.value[menuIndex.value])
          return true
        }
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return true }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        emit('submit')
        return true
      }
      return false
    },
  },
  onUpdate: updateSlashMenu,
  onSelectionUpdate: updateSlashMenu,
  onBlur: () => { setTimeout(closeMenu, 120) },
})

watch(() => props.placeholder, (val) => {
  const ext = editor.value?.extensionManager.extensions.find(e => e.name === 'placeholder')
  if (ext) ext.options.placeholder = val
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function getContent(): { content: ContentPart[] } {
  if (!editor.value) return { content: [] }
  const paragraphs: string[] = []
  editor.value.state.doc.forEach((node) => {
    if (node.type.name === 'paragraph') {
      paragraphs.push(node.textBetween(0, node.content.size, '', '\n'))
    }
  })
  const text = paragraphs.join('\n').trim()
  return { content: text ? [{ type: 'text', text }] : [] }
}

function clear() {
  editor.value?.commands.clearContent()
  closeMenu()
}

function focus() {
  editor.value?.commands.focus()
}

function isEmpty(): boolean {
  if (!editor.value) return true
  return editor.value.isEmpty
}

defineExpose({ getContent, clear, focus, isEmpty })
</script>

<template>
  <div class="rich-input-wrap">
    <div v-if="menuOpen" ref="menuEl" class="slash-menu" @mousedown.prevent>
      <button
        v-for="(cmd, i) in menuItems"
        :key="cmd.name"
        class="slash-menu-item"
        :class="{ 'slash-menu-item--active': i === menuIndex }"
        @mouseenter="menuIndex = i"
        @click="applyCommand(cmd)"
      >
        <span class="slash-menu-name">/{{ cmd.name }}</span>
        <span class="slash-menu-desc">{{ cmd.description }}</span>
      </button>
    </div>
    <div class="rich-input" :style="{ maxHeight: maxHeight + 'px' }">
      <EditorContent :editor="editor" />
    </div>
  </div>
</template>

<style scoped>
.rich-input-wrap {
  position: relative;
  width: 100%;
}
.rich-input {
  overflow-y: auto;
  width: 100%;
}

/* Slash command menu — floats above the input */
.slash-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 50;
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--chatui-border);
  border-radius: 10px;
  background: var(--chatui-bg-surface);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
}
.slash-menu-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--chatui-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.slash-menu-item--active {
  background: var(--chatui-bg-active, var(--chatui-bg-hover));
}
.slash-menu-name {
  flex-shrink: 0;
  font-family: var(--chatui-font-family-mono, monospace);
  font-size: 13px;
  color: var(--chatui-fg);
}
.slash-menu-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--chatui-fg-secondary);
}

.rich-input :deep(.tiptap) {
  outline: none;
  min-height: 40px;
  padding: 0;
  font-size: var(--chatui-font-size);
  font-family: var(--chatui-font-family);
  line-height: 1.5;
  color: var(--chatui-fg);
}

.rich-input :deep(.tiptap p) {
  margin: 0;
}

.rich-input :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--chatui-fg-secondary);
  pointer-events: none;
  height: 0;
}

</style>
