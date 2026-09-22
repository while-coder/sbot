<script lang="ts">
import { ref } from "vue"

let modalId = 0
//当前打开的模态框数量（含嵌套）：供 SFloatWindow 等 Esc 消费方避让——模态开着时浮窗不响应 Esc
export const openModalCount = ref(0)
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, useAttrs, watch } from "vue"

defineOptions({ name: "SModal", inheritAttrs: false })
const props = withDefaults(defineProps<{
  show?: boolean
  /** show 的别名（历史约定）：v-model:visible 亦可驱动 */
  visible?: boolean
  title?: string
  preset?: string
  style?: any
  /** 卡片形态宽度：预设 sm/md/lg/xl（400/560/720/920px）或具体值；不传保持默认 560px */
  width?: number | string
  closable?: boolean
  maskClosable?: boolean
  closeOnEsc?: boolean
  /** maskClosable 的别名 */
  closeOnOverlay?: boolean
  /** closeOnEsc 的别名 */
  closeOnEscape?: boolean
  nested?: boolean
  draggable?: boolean
  resizable?: boolean
}>(), { closable: true, maskClosable: true, closeOnEsc: true })
const emit = defineEmits<{ "update:show": [value: any]; "update:visible": [value: any]; close: [] }>()
const attrs = useAttrs()

const isShown = computed(() => props.show || props.visible)
//closeOnOverlay/closeOnEscape 为别名：传了以别名为准，否则回退 maskClosable/closeOnEsc
const canMaskClose = computed(() => props.closeOnOverlay ?? props.maskClosable)
const canEscClose = computed(() => props.closeOnEscape ?? props.closeOnEsc)

const titleId = `s-modal-title-${++modalId}`
const box = ref<HTMLElement | null>(null)
//拖拽仅在带标题栏的卡片形态下生效（bare 形态没有把手）。
//标题栏按下发起，pointer capture 跟踪移动，偏移用 translate3d 应用；
//位置始终 clamp 在视口内，窗口缩放或内容变化导致越界时自动拉回。
const canDrag = computed(() => props.draggable === true)
const offset = reactive({ x: 0, y: 0 })
const dragging = ref(false)
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let dragStartOffsetX = 0
let dragStartOffsetY = 0
let dragHandle: HTMLElement | null = null
let dragResizeObserver: ResizeObserver | null = null

//偏移为零且未在拖拽时不写 transform，让位给出入场 CSS 动画
const dragStyle = computed(() =>
  canDrag.value && (offset.x || offset.y) ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : undefined
)
const boxStyle = computed(() => (canDrag.value ? [props.style, widthStyle.value, dragStyle.value] : [props.style, widthStyle.value]))

const widthStyle = computed(() => {
  if (props.width == null) return undefined
  const preset = ({ sm: "400px", md: "560px", lg: "720px", xl: "920px" } as Record<string, string>)[props.width as string] ?? props.width
  return { width: `min(${preset}, calc(100vw - 32px))` }
})

function clampDragOffset(x: number, y: number) {
  const el = box.value
  if (!el) return { x, y }
  const margin = 8
  //弹窗比视口还大时，至少留这么宽一段标题栏用来拖回来
  const rescueSize = 64
  const rect = el.getBoundingClientRect()
  const baseLeft = rect.left - offset.x
  const baseTop = rect.top - offset.y
  const fitsWidth = rect.width <= window.innerWidth - margin * 2
  const fitsHeight = rect.height <= window.innerHeight - margin * 2
  return {
    x: fitsWidth
      ? Math.min(Math.max(x, margin - baseLeft), window.innerWidth - margin - rect.width - baseLeft)
      : Math.min(Math.max(x, margin + rescueSize - baseLeft - rect.width), window.innerWidth - margin - rescueSize - baseLeft),
    //高于视口就贴顶，余下内容靠弹窗主体自身滚动查看
    y: fitsHeight
      ? Math.min(Math.max(y, margin - baseTop), window.innerHeight - margin - rect.height - baseTop)
      : margin - baseTop,
  }
}

function startDrag(event: PointerEvent) {
  if (!canDrag.value || event.button !== 0 || event.pointerType === "touch") return
  //不劫持标题栏里的按钮/链接
  if ((event.target as Element).closest("button, a, input, select, textarea")) return
  event.preventDefault()
  dragPointerId = event.pointerId
  dragStartX = event.clientX
  dragStartY = event.clientY
  dragStartOffsetX = offset.x
  dragStartOffsetY = offset.y
  dragging.value = true
  dragHandle = event.currentTarget as HTMLElement
  dragHandle.setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragPointerId) return
  const next = clampDragOffset(dragStartOffsetX + event.clientX - dragStartX, dragStartOffsetY + event.clientY - dragStartY)
  offset.x = next.x
  offset.y = next.y
}

function finishDrag(event?: PointerEvent) {
  if (event && dragPointerId !== null && event.pointerId !== dragPointerId) return
  if (dragPointerId !== null && dragHandle?.hasPointerCapture(dragPointerId)) dragHandle.releasePointerCapture(dragPointerId)
  dragging.value = false
  dragPointerId = null
  dragHandle = null
}

function keepBoxInViewport() {
  if (!canDrag.value) return
  const next = clampDragOffset(offset.x, offset.y)
  offset.x = next.x
  offset.y = next.y
}

//弹窗初始关闭时 box 尚不存在，ResizeObserver 随开关挂载/卸载
function observeBox() {
  if (canDrag.value && box.value && typeof ResizeObserver !== "undefined" && !dragResizeObserver) {
    dragResizeObserver = new ResizeObserver(keepBoxInViewport)
    dragResizeObserver.observe(box.value)
  }
}
function unobserveBox() {
  dragResizeObserver?.disconnect()
  dragResizeObserver = null
}
let previousFocus: HTMLElement | null = null
let modalCounted = false
const close = () => { emit("update:show", false); emit("update:visible", false); emit("close") }
const onKey = (event: KeyboardEvent) => { if (isShown.value && canEscClose.value && event.key === "Escape") close() }
const onMask = (event: MouseEvent) => { if (canMaskClose.value && event.target === event.currentTarget) close() }
watch(isShown, show => {
  if (show) {
    if (!modalCounted) { modalCounted = true; openModalCount.value++ }
    previousFocus = document.activeElement as HTMLElement | null
    document.addEventListener("keydown", onKey)
    nextTick(() => {
      (box.value?.querySelector<HTMLElement>("button, input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? box.value)?.focus()
      observeBox()
    })
  } else {
    if (modalCounted) { modalCounted = false; openModalCount.value-- }
    document.removeEventListener("keydown", onKey)
    previousFocus?.focus()
    previousFocus = null
    //关闭后结束拖拽并复位偏移，下次打开仍居中
    finishDrag()
    offset.x = 0
    offset.y = 0
    unobserveBox()
  }
}, { immediate: true })
onMounted(() => {
  window.addEventListener("pointermove", moveDrag)
  window.addEventListener("pointerup", finishDrag)
  window.addEventListener("pointercancel", finishDrag)
  window.addEventListener("blur", finishDrag as EventListener)
  window.addEventListener("resize", keepBoxInViewport)
})
onBeforeUnmount(() => {
  //开着时直接卸载（v-if 外层控制）也要回退计数
  if (modalCounted) { modalCounted = false; openModalCount.value-- }
  document.removeEventListener("keydown", onKey)
  unobserveBox()
  window.removeEventListener("pointermove", moveDrag)
  window.removeEventListener("pointerup", finishDrag)
  window.removeEventListener("pointercancel", finishDrag)
  window.removeEventListener("blur", finishDrag as EventListener)
  window.removeEventListener("resize", keepBoxInViewport)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="s-modal">
      <div v-if="isShown" v-bind="attrs" :class="['s-modal-overlay', { nested }, attrs.class]" @mousedown="onMask">
        <section v-if="preset === 'card' || title" ref="box" tabindex="-1"
          :class="['s-modal-box', { dragging, resizable }]" :style="boxStyle"
          role="dialog" aria-modal="true" :aria-labelledby="title ? titleId : undefined">
          <header class="s-modal-header" :class="{ draggable: canDrag }" @pointerdown="startDrag">
            <h2 :id="titleId">{{ title }}</h2>
            <button v-if="closable" type="button" class="s-icon-close" aria-label="关闭" @click="close">×</button>
          </header>
          <div class="s-modal-body"><slot /></div>
          <footer v-if="$slots.footer" class="s-modal-footer"><slot name="footer" /></footer>
        </section>
        <div v-else ref="box" tabindex="-1" class="s-modal-bare" :style="style" role="dialog" aria-modal="true">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.s-modal-overlay { position: fixed; inset: 0; z-index: var(--sui-z-modal); display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--sui-mask); }
.s-modal-overlay.nested { z-index: var(--sui-z-modal-nest); }
.s-modal-box { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--sui-border); border-radius: 10px; background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); color: var(--sui-fg); }
.s-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--sui-border); }
.s-modal-header.draggable { cursor: grab; touch-action: none; user-select: none; }
.s-modal-box.dragging .s-modal-header { cursor: grabbing; }
.s-modal-header h2 { min-width: 0; margin: 0; overflow: hidden; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.s-modal-header .s-icon-close { flex: 0 0 auto; }
.s-modal-body { min-height: 0; padding: 16px 18px; overflow: auto; }
.s-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--sui-border); }
.s-modal-bare { max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); }
/*右下角原生拖角缩放；overflow:hidden 已满足 resize 生效条件，尺寸变化由 ResizeObserver 联动位置 clamp*/
.s-modal-box.resizable { resize: both; min-width: 320px; min-height: 180px; max-width: calc(100vw - 32px); }
.s-modal-enter-active, .s-modal-leave-active { transition: opacity .12s ease; }
.s-modal-enter-active .s-modal-box, .s-modal-leave-active .s-modal-box { transition: transform .15s ease; }
.s-modal-enter-from, .s-modal-leave-to { opacity: 0; }
.s-modal-enter-from .s-modal-box, .s-modal-leave-to .s-modal-box { transform: translateY(-8px); }
@media (max-width: 720px) {
  .s-modal-overlay { padding: 0; align-items: stretch; }
  .s-modal-box { width: 100% !important; max-height: 100dvh; border: 0; border-radius: 0; }
  .s-modal-box.resizable { resize: none; }
}
</style>
