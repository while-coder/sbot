<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps<{
  content: string
  /** 文件路径或扩展名，用于挑选语法高亮 */
  path?: string
  /** 显式控制暗色；未传时跟随 <html data-theme="dark"> */
  dark?: boolean
  /** 长行是否自动换行；默认开 */
  lineWrap?: boolean
  /** 是否允许编辑；默认 false（只读） */
  editable?: boolean
}>()

const emit = defineEmits<{
  'update:content': [value: string]
}>()

// ── 暗色跟随 ──
const detectedDark = ref(false)
function detectDark(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'dark'
}
let observer: MutationObserver | null = null
onMounted(() => {
  detectedDark.value = detectDark()
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
  observer = new MutationObserver(() => { detectedDark.value = detectDark() })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => observer?.disconnect())

const isDark = computed(() => props.dark ?? detectedDark.value)

// ── 语言识别 ──
function pickLanguage(p: string): Extension | null {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'md': case 'markdown': return markdown()
    case 'ts': return javascript({ typescript: true })
    case 'tsx': return javascript({ typescript: true, jsx: true })
    case 'js': case 'mjs': case 'cjs': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'json': return json()
    case 'yaml': case 'yml': return yaml()
    case 'py': return python()
    default: return null
  }
}

const extensions = computed<Extension[]>(() => {
  const exts: Extension[] = [
    EditorState.readOnly.of(!props.editable),
    EditorView.editable.of(!!props.editable),
  ]
  if (props.lineWrap !== false) exts.push(EditorView.lineWrapping)
  const lang = pickLanguage(props.path ?? '')
  if (lang) exts.push(lang)
  if (isDark.value) exts.push(oneDark)
  return exts
})

function onUpdateModelValue(value: string) {
  if (props.editable) emit('update:content', value)
}
</script>

<template>
  <Codemirror
    :model-value="content"
    :extensions="extensions"
    :indent-with-tab="false"
    :tab-size="2"
    class="chatui-code-viewer"
    @update:model-value="onUpdateModelValue"
  />
</template>

<style scoped>
.chatui-code-viewer {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.chatui-code-viewer :deep(.cm-editor) {
  height: 100%;
  background: transparent;
}
.chatui-code-viewer :deep(.cm-scroller) {
  font-family: var(--chatui-font-mono, var(--sui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace));
  font-size: 12px;
  line-height: 1.6;
}
.chatui-code-viewer :deep(.cm-gutters) {
  background: transparent;
  border-right: 1px solid var(--chatui-border, var(--sui-border, #e5e7eb));
  color: var(--chatui-fg-secondary, var(--sui-fg-disabled, #9ca3af));
}
</style>
