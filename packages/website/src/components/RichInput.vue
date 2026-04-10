<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Dropcursor from '@tiptap/extension-dropcursor'

interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

const props = withDefaults(defineProps<{
  placeholder?: string
  maxHeight?: number
}>(), {
  placeholder: '',
  maxHeight: 200,
})

const emit = defineEmits<{
  submit: []
}>()

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

function handleImageDrop(view: any, event: DragEvent, _slice: any, moved: boolean): boolean {
  if (moved || !event.dataTransfer?.files?.length) return false
  const images = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'))
  if (images.length === 0) return false
  event.preventDefault()
  images.forEach(async (file) => {
    const dataUrl = await fileToDataUrl(file)
    editor.value?.chain().focus().setImage({ src: dataUrl, alt: file.name }).run()
  })
  return true
}

function handleImagePaste(view: any, event: ClipboardEvent): boolean {
  const items = Array.from(event.clipboardData?.items ?? [])
  const imageItems = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'))
  if (imageItems.length === 0) return false
  event.preventDefault()
  imageItems.forEach(async (item) => {
    const file = item.getAsFile()
    if (!file) return
    const name = file.name && file.name !== 'image.png'
      ? file.name
      : `paste-${Date.now()}.${file.type.split('/')[1] || 'png'}`
    const dataUrl = await fileToDataUrl(file)
    editor.value?.chain().focus().setImage({ src: dataUrl, alt: name }).run()
  })
  return true
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
    }),
    Image.configure({ inline: true, allowBase64: true }),
    Placeholder.configure({ placeholder: props.placeholder }),
    Dropcursor.configure({ color: '#1c1c1c', width: 2 }),
  ],
  editorProps: {
    handleDrop: handleImageDrop,
    handlePaste: handleImagePaste,
    handleKeyDown: (_view, event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        emit('submit')
        return true
      }
      return false
    },
  },
})

watch(() => props.placeholder, (val) => {
  editor.value?.extensionManager.extensions
    .find(e => e.name === 'placeholder')
    ?.options && (editor.value.extensionManager.extensions.find(e => e.name === 'placeholder')!.options.placeholder = val)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function getContent(): { text: string; images: Attachment[] } {
  if (!editor.value) return { text: '', images: [] }
  const text = editor.value.getText()
  const images: Attachment[] = []
  let imgCounter = 0
  editor.value.state.doc.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.src) {
      const src: string = node.attrs.src
      const alt: string = node.attrs.alt || ''
      if (src.startsWith('data:')) {
        const mimeMatch = src.match(/^data:(image\/\w+);/)
        const mimeType = mimeMatch?.[1] || 'image/png'
        const ext = mimeType.split('/')[1] || 'png'
        const name = alt || `image-${++imgCounter}.${ext}`
        images.push({ name, type: mimeType, dataUrl: src })
      }
    }
  })
  return { text, images }
}

function clear() {
  editor.value?.commands.clearContent()
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
  <div class="rich-input" :style="{ maxHeight: maxHeight + 'px' }">
    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.rich-input {
  overflow-y: auto;
  width: 100%;
}

.rich-input :deep(.tiptap) {
  outline: none;
  min-height: 60px;
  padding: 0;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
}

.rich-input :deep(.tiptap p) {
  margin: 0;
}

.rich-input :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #94a3b8;
  pointer-events: none;
  height: 0;
}

.rich-input :deep(.tiptap img) {
  max-height: 120px;
  max-width: 100%;
  border-radius: 6px;
  margin: 4px 0;
  cursor: default;
  object-fit: contain;
}

.rich-input :deep(.tiptap img.ProseMirror-selectednode) {
  outline: 2px solid #1c1c1c;
  outline-offset: 2px;
}
</style>
