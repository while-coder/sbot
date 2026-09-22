<script lang="ts">
import { ref } from "vue"

// ── 模块级浮窗栈（所有 SFloatWindow 实例共享，仿 dock 的 floats：数组序即 z 序）──
//activeId 为当前焦点窗；新窗入栈顶，pointerdown 提到栈顶，z-index 按栈下标计算
const floatStack = ref<string[]>([])
const floatActiveId = ref("")
let floatUid = 0

/**外部读取焦点状态的入口（父组件高亮/联动用）*/
export function useFloatWindowStack() {
  return { activeId: floatActiveId, stack: floatStack }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue"
import { openModalCount } from "./SModal.vue"

defineOptions({ name: "SFloatWindow" })
const props = withDefaults(defineProps<{
  title?: string
  closable?: boolean
  /**焦点覆盖（不传则用全局栈的 activeId）*/
  active?: boolean
  /**右下角缩放手柄，默认开启*/
  resizable?: boolean
  /**标题栏拖动，默认开启*/
  draggable?: boolean
  /**Esc 关闭，默认关闭；仅在自己持有焦点且没有模态框打开时响应（避免和 SModal 的 Esc 消费冲突）*/
  closeOnEsc?: boolean
}>(), { closable: true, resizable: true, draggable: true, closeOnEsc: false })
const emit = defineEmits<{ close: []; focus: [] }>()

const x = defineModel("x", { type: Number, default: 80 })
const y = defineModel("y", { type: Number, default: 60 })
const width = defineModel("width", { type: Number, default: 480 })
const height = defineModel("height", { type: Number, default: 320 })

const MIN_WIDTH = 260
const MIN_HEIGHT = 140
//拖出视口时至少留这么宽一段标题栏用来拖回来（同 SModal 的 rescue 思路）
const RESCUE_WIDTH = 64
const HEADER_HEIGHT = 40

const id = `float-${++floatUid}`
const active = computed(() => props.active ?? floatActiveId.value === id)
//栈里没有自己（理论上只在挂载前的一帧）时按栈顶兜底，避免闪到内容层底下
const zIndex = computed(() => {
  const index = floatStack.value.indexOf(id)
  return `calc(var(--sui-z-float) + ${index < 0 ? floatStack.value.length : index})`
})

function clampX(value: number) {
  return Math.min(Math.max(value, RESCUE_WIDTH - width.value), window.innerWidth - RESCUE_WIDTH)
}
function clampY(value: number) {
  return Math.min(Math.max(value, 0), window.innerHeight - HEADER_HEIGHT)
}

function focusWindow() {
  const index = floatStack.value.indexOf(id)
  if (index < 0) floatStack.value.push(id)
  else if (index !== floatStack.value.length - 1) {
    floatStack.value.splice(index, 1)
    floatStack.value.push(id)
  }
  floatActiveId.value = id
  emit("focus")
}

// ↓ 标题栏拖动：pointer capture 跟踪，坐标直接写 x/y（非 transform 偏移，方便父层持久化）

let drag: { pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null = null

function startDrag(event: PointerEvent) {
  if (!props.draggable || event.button !== 0) return
  //不劫持标题栏里的按钮/链接
  if ((event.target as Element).closest("button, a, input, select, textarea")) return
  event.preventDefault()
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: x.value, baseY: y.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  x.value = clampX(drag.baseX + event.clientX - drag.startX)
  y.value = clampY(drag.baseY + event.clientY - drag.startY)
}

function finishDrag(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  drag = null
}

// ↓ 右下角缩放手柄（同 dock 的 startFloatResize）

let resize: { pointerId: number; startX: number; startY: number; baseW: number; baseH: number } | null = null

function startResize(event: PointerEvent) {
  if (!props.resizable || event.button !== 0) return
  event.preventDefault()
  resize = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseW: width.value, baseH: height.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function moveResize(event: PointerEvent) {
  if (!resize || event.pointerId !== resize.pointerId) return
  width.value = Math.min(Math.max(resize.baseW + event.clientX - resize.startX, MIN_WIDTH), window.innerWidth - x.value)
  height.value = Math.min(Math.max(resize.baseH + event.clientY - resize.startY, MIN_HEIGHT), window.innerHeight - y.value)
}

function finishResize(event?: PointerEvent) {
  if (!resize || (event && event.pointerId !== resize.pointerId)) return
  resize = null
}

//视口缩小时把窗拉回可见范围（尺寸卡到最小值保底）
//Esc 关闭：仅在自己持有焦点且没有模态框打开时消费，避免抢 SModal 的 Esc
function onKey(event: KeyboardEvent) {
  if (props.closeOnEsc && event.key === "Escape" && active.value && openModalCount.value === 0) emit("close")
}

function keepInViewport() {
  x.value = clampX(x.value)
  y.value = clampY(y.value)
  width.value = Math.min(Math.max(width.value, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - x.value))
  height.value = Math.min(Math.max(height.value, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - y.value))
}

onMounted(() => {
  //持久化恢复的 x/y 可能已越界（如上次退出时的屏幕比现在大），先校正
  keepInViewport()
  //新窗置顶并获得焦点（Windows 窗口语义）
  focusWindow()
  window.addEventListener("pointermove", moveDrag)
  window.addEventListener("pointerup", finishDrag)
  window.addEventListener("pointercancel", finishDrag)
  window.addEventListener("pointermove", moveResize)
  window.addEventListener("pointerup", finishResize)
  window.addEventListener("pointercancel", finishResize)
  window.addEventListener("blur", finishDrag)
  window.addEventListener("blur", finishResize)
  window.addEventListener("resize", keepInViewport)
  document.addEventListener("keydown", onKey)
})

onBeforeUnmount(() => {
  const index = floatStack.value.indexOf(id)
  if (index >= 0) floatStack.value.splice(index, 1)
  if (floatActiveId.value === id) floatActiveId.value = floatStack.value[floatStack.value.length - 1] ?? ""
  window.removeEventListener("pointermove", moveDrag)
  window.removeEventListener("pointerup", finishDrag)
  window.removeEventListener("pointercancel", finishDrag)
  window.removeEventListener("pointermove", moveResize)
  window.removeEventListener("pointerup", finishResize)
  window.removeEventListener("pointercancel", finishResize)
  window.removeEventListener("blur", finishDrag)
  window.removeEventListener("blur", finishResize)
  window.removeEventListener("resize", keepInViewport)
  document.removeEventListener("keydown", onKey)
})
</script>

<template>
  <Teleport to="body">
    <section
      class="s-float-window"
      :class="{ inactive: !active }"
      :style="{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`, zIndex }"
      role="dialog"
      :aria-label="title"
      @pointerdown="focusWindow"
      @focusin="focusWindow"
    >
      <header class="s-float-head" :class="{ draggable }" @pointerdown="startDrag">
        <h2>{{ title }}</h2>
        <button v-if="closable" type="button" class="s-icon-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <div class="s-float-body"><slot /></div>
      <div v-if="resizable" class="s-float-resizer" @pointerdown="startResize" />
    </section>
  </Teleport>
</template>

<style scoped>
.s-float-window { position: fixed; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--sui-border); border-radius: 10px; background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); color: var(--sui-fg); }
.s-float-window.inactive { border-color: transparent; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18); }
.s-float-head { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; height: var(--sui-float-header, 40px); padding: 0 12px; border-bottom: 1px solid var(--sui-border); }
.s-float-head.draggable { cursor: grab; touch-action: none; user-select: none; }
.s-float-head.draggable:active { cursor: grabbing; }
.s-float-head h2 { min-width: 0; margin: 0; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.s-float-window.inactive .s-float-head h2 { color: var(--sui-fg-muted); }
.s-float-head .s-icon-close { flex: 0 0 auto; }
.s-float-body { flex: 1 1 0; min-height: 0; padding: 12px; overflow: auto; }
.s-float-resizer { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; }
</style>
