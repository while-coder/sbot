<script setup lang="ts">
import { computed, reactive, watch, onUnmounted, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  width?: 'sm' | 'md' | 'lg' | 'xl' | string   // sm=400, md=520(default), lg=660, xl=min(92vw,1040)
  nested?: boolean                              // 嵌套 modal，使用 z-modal-nest 层级
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  draggable?: boolean                           // 标题栏按住拖动移动窗口位置
}>(), {
  width: 'md',
  closeOnOverlay: true,
  closeOnEscape: true,
  draggable: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

const overlayRef = ref<HTMLDivElement | null>(null)
let mousedownTarget: EventTarget | null = null

// ── 标题栏拖动：pointer capture + 视口内 clamp（弹窗超出视口时至少留 64px 标题栏可拖回） ──

const boxRef = ref<HTMLDivElement | null>(null)
const dragOffset = reactive({ x: 0, y: 0 })
const dragging = ref(false)
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let dragStartOffsetX = 0
let dragStartOffsetY = 0

const dragStyle = computed(() =>
  props.draggable ? { transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)` } : undefined)

function clampOffset(x: number, y: number): { x: number; y: number } {
  const box = boxRef.value
  if (!box) return { x, y }
  const margin = 8
  const rescue = 64
  const rect = box.getBoundingClientRect()
  const baseLeft = rect.left - dragOffset.x
  const baseTop = rect.top - dragOffset.y
  const fitsW = rect.width <= window.innerWidth - margin * 2
  const fitsH = rect.height <= window.innerHeight - margin * 2
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  return {
    x: fitsW
      ? clamp(x, margin - baseLeft, window.innerWidth - margin - rect.width - baseLeft)
      : clamp(x, margin + rescue - baseLeft - rect.width, window.innerWidth - margin - rescue - baseLeft),
    y: fitsH
      ? clamp(y, margin - baseTop, window.innerHeight - margin - rect.height - baseTop)
      : clamp(y, margin - baseTop, window.innerHeight - margin - rescue - baseTop),
  }
}

function startDrag(e: PointerEvent) {
  if (!props.draggable || e.button !== 0) return
  if ((e.target as Element).closest('button, a, input, select, textarea')) return
  e.preventDefault()
  dragPointerId = e.pointerId
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartOffsetX = dragOffset.x
  dragStartOffsetY = dragOffset.y
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function moveDrag(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== dragPointerId) return
  const next = clampOffset(dragStartOffsetX + e.clientX - dragStartX, dragStartOffsetY + e.clientY - dragStartY)
  dragOffset.x = next.x
  dragOffset.y = next.y
}

function endDrag(e?: PointerEvent) {
  if (e && dragPointerId !== null && e.pointerId !== dragPointerId) return
  dragging.value = false
  dragPointerId = null
}

watch(() => props.visible, (v) => {
  if (v) document.addEventListener('keydown', onKeydown)
  else {
    document.removeEventListener('keydown', onKeydown)
    endDrag()
    dragOffset.x = 0
    dragOffset.y = 0
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

function close() {
  emit('update:visible', false)
  emit('close')
}

function onMousedown(e: MouseEvent) {
  mousedownTarget = e.target
}

function onOverlayClick(e: MouseEvent) {
  if (!props.closeOnOverlay) return
  // 仅当 mousedown 也发生在 overlay 上才关闭，防止从 modal 内拖动到外部松开误触关闭
  if (e.target === overlayRef.value && mousedownTarget === overlayRef.value) {
    close()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (props.closeOnEscape && e.key === 'Escape' && props.visible) {
    close()
  }
}

const widthStyle = computed(() => {
  const w = props.width
  if (w === 'sm') return { width: '400px' }
  if (w === 'md') return { width: '520px' }
  if (w === 'lg') return { width: '660px' }
  if (w === 'xl') return { width: 'min(92vw, 1040px)' }
  return { width: w }
})

const overlayStyle = computed(() => ({
  zIndex: props.nested ? 'var(--sui-z-modal-nest)' : 'var(--sui-z-modal)',
}))
</script>

<template>
  <Teleport to="body">
    <Transition name="s-modal">
      <div
        v-if="visible"
        ref="overlayRef"
        class="s-modal-overlay"
        :style="overlayStyle"
        @mousedown="onMousedown"
        @click="onOverlayClick"
      >
        <div
          v-bind="$attrs"
          ref="boxRef"
          class="s-modal-box"
          :class="{ dragging }"
          :style="[widthStyle, dragStyle]"
        >
          <div
            v-if="$slots.header || title"
            class="s-modal-header"
            :class="{ draggable: draggable }"
            @pointerdown="startDrag"
            @pointermove="moveDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
          >
            <slot name="header"><h3 class="s-modal-title">{{ title }}</h3></slot>
            <button type="button" class="s-modal-close" @click="close">&times;</button>
          </div>
          <div v-if="$slots.toolbar" class="s-modal-toolbar">
            <slot name="toolbar" />
          </div>
          <div class="s-modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="s-modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.s-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--sui-mask);
  display: flex;
  align-items: center;
  justify-content: center;
}
.s-modal-box {
  background: var(--sui-bg);
  border-radius: var(--sui-radius-xl);
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sui-shadow-lg);
  overflow: hidden;
}
.s-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sui-sp-6) var(--sui-sp-8);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
}
.s-modal-header.draggable {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.s-modal-box.dragging .s-modal-header {
  cursor: grabbing;
}
.s-modal-box.dragging {
  transition: none;
}
.s-modal-title {
  font-size: var(--sui-fs-xl);
  font-weight: 600;
  color: var(--sui-fg);
  margin: 0;
}
.s-modal-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-3) var(--sui-sp-7);
  border-bottom: 1px solid var(--sui-border);
  flex-shrink: 0;
}
.s-modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--sui-fg-disabled);
  cursor: pointer;
  padding: 0 var(--sui-sp-1);
  line-height: 1;
  transition: color var(--sui-transition-base);
}
.s-modal-close:hover { color: var(--sui-fg-secondary); }
.s-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sui-sp-7) var(--sui-sp-8);
  color: var(--sui-fg-secondary);
}
.s-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-5) var(--sui-sp-8);
  border-top: 1px solid var(--sui-border);
  flex-shrink: 0;
}

.s-modal-enter-active, .s-modal-leave-active { transition: opacity .12s; }
.s-modal-enter-active .s-modal-box, .s-modal-leave-active .s-modal-box {
  transition: transform .15s ease;
}
.s-modal-enter-from, .s-modal-leave-to { opacity: 0; }
.s-modal-enter-from .s-modal-box, .s-modal-leave-to .s-modal-box { transform: translateY(-8px); }
</style>
