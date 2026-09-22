<template>
  <slot />
</template>

<script lang="ts">
// ── 排序引擎 ──
// 拖拽/键盘排序的全部实现收在本文件：SSortableList 提供作用域（每列表一个 controller），
// 插槽里的 SSortableItem 通过 inject 拿到 controller 渲染行。引擎不再有文件外的调用方。
import { computed, getCurrentScope, inject, onScopeDispose, provide, ref, type InjectionKey, type Ref } from "vue"

export type DropEdge = "before" | "after"

export interface SortableItemController {
  readonly scopeId: string
  isDragging(index: number): boolean
  dropEdge(index: number): DropEdge | null
  canMove(index: number, offset: -1 | 1): boolean
  pointerDown(index: number, event: PointerEvent): void
  move(index: number, offset: -1 | 1): void
}

export interface SortableListController<T> extends SortableItemController {
  key(item: T): string
}

//列表与行组件的连线：列表 provide controller，行组件 inject。
//行组件渲染在列表的插槽里，父实例链经过列表，注入天然可达。
export interface SortableListContext {
  controller: SortableItemController
  label: Readonly<Ref<string | undefined>>
}
export const SortableListContextKey: InjectionKey<SortableListContext> = Symbol("SSortableList")

export function injectSortableListContext(): SortableListContext | null {
  return inject(SortableListContextKey, null)
}

//对象按实例身份给稳定的 v-for key（无 id 字段的行也适用），全局共享一张 WeakMap
const objectKeys = new WeakMap<object, number>()
let nextObjectKey = 0

export function sortableItemKey(item: unknown): string {
  if ((typeof item === "object" && item !== null) || typeof item === "function") {
    const object = item as object
    let value = objectKeys.get(object)
    if (value === undefined) {
      value = ++nextObjectKey
      objectKeys.set(object, value)
    }
    return `sortable-object-${value}`
  }
  return `sortable-value-${typeof item}-${String(item)}`
}

//光标靠近可视区边缘时开始滚动的距离，以及每帧的最大滚动速度
const autoscrollEdge = 56
const autoscrollSpeed = 16

let nextScopeId = 0

/**
 * 为一个响应式数组提供统一的拖拽和键盘排序规则。
 *
 * 拖动时克隆一份行元素作为跟随光标的「影分身」，原行保留在列表里当作落点占位；
 * 列表只在 drop 或键盘移动时一次性更新，拖动过程中不改数据，避免输入框组件反复重建。
 * 行元素用 SSortableItem 渲染（带 data-sortable-scope/index 属性与拖拽把手）。
 */
export function useSortableList<T>(
  getItems: () => readonly T[],
  updateItems: (items: T[]) => void
): SortableListController<T> {
  const scopeId = `sortable-${++nextScopeId}`
  const draggingIndex = ref<number | null>(null)
  const targetIndex = ref<number | null>(null)
  const targetEdge = ref<DropEdge | null>(null)
  let activePointerId: number | null = null
  let ghost: HTMLElement | null = null
  let sourceRow: HTMLElement | null = null
  let scrollContainer: HTMLElement | null = null
  let grabOffsetX = 0
  let grabOffsetY = 0
  let lastClientX = 0
  let lastClientY = 0
  let frameId: number | null = null

  function key(item: T): string {
    return sortableItemKey(item)
  }

  function rowSelector(): string {
    return `[data-sortable-scope="${scopeId}"][data-sortable-index]`
  }

  function reset(): void {
    if (frameId !== null) cancelAnimationFrame(frameId)
    frameId = null
    ghost?.remove()
    ghost = null
    sourceRow = null
    scrollContainer = null
    removePointerListeners()
    activePointerId = null
    draggingIndex.value = null
    targetIndex.value = null
    targetEdge.value = null
  }

  function isDragging(index: number): boolean {
    return draggingIndex.value === index
  }

  function dropEdge(index: number): DropEdge | null {
    return targetIndex.value === index ? targetEdge.value : null
  }

  function canMove(index: number, offset: -1 | 1): boolean {
    const nextIndex = index + offset
    return nextIndex >= 0 && nextIndex < getItems().length
  }

  function reorder(from: number, insertionIndex: number): void {
    const items = [...getItems()]
    if (from < 0 || from >= items.length) return
    const moved = items.splice(from, 1)[0]
    if (moved === undefined) return
    const to = Math.max(0, Math.min(items.length, insertionIndex - (from < insertionIndex ? 1 : 0)))
    items.splice(to, 0, moved)
    updateItems(items)
  }

  function createGhost(row: HTMLElement, event: PointerEvent): void {
    const rect = row.getBoundingClientRect()
    grabOffsetX = event.clientX - rect.left
    grabOffsetY = event.clientY - rect.top
    const clone = row.cloneNode(true) as HTMLElement
    clone.removeAttribute("data-sortable-index")
    //克隆会带出重复的 id 和输入框的实时内容，前者污染文档、后者值属性不会跟着走
    clone.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"))
    const originFields = row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    const cloneFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    originFields.forEach((field, index) => {
      const target = cloneFields[index]
      if (!target) return
      target.value = field.value
      if (target instanceof HTMLTextAreaElement) target.textContent = field.value
    })
    ghost = clone
    ghost.classList.add("sortable-ghost")
    //影分身样式全部内联：它是运行时插进 body 的克隆，吃不到组件的 scoped 样式
    Object.assign(ghost.style, {
      position: "fixed",
      left: "0",
      top: "0",
      margin: "0",
      width: `${rect.width}px`,
      zIndex: "1000",
      pointerEvents: "none",
      userSelect: "none",
      background: "var(--sui-bg)",
      borderRadius: "var(--sui-radius-sm)",
      outline: "1px solid var(--sui-border)",
      boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
      willChange: "transform"
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(ghost)
  }

  function positionGhost(): void {
    ghost?.style.setProperty(
      "transform",
      `translate(${lastClientX - grabOffsetX}px, ${lastClientY - grabOffsetY}px)`
    )
  }

  function scrollParent(row: HTMLElement): HTMLElement | null {
    let node = row.parentElement
    while (node && node !== document.body) {
      const overflowY = getComputedStyle(node).overflowY
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node
      node = node.parentElement
    }
    return null
  }

  //按光标到上/下边缘的距离给一个渐近的滚动速度，越贴边滚得越快
  function edgeDelta(y: number, top: number, bottom: number): number {
    if (y < top + autoscrollEdge) return -Math.min(autoscrollSpeed, (top + autoscrollEdge - y) * 0.4 + 2)
    if (y > bottom - autoscrollEdge) return Math.min(autoscrollSpeed, (y - (bottom - autoscrollEdge)) * 0.4 + 2)
    return 0
  }

  function autoScroll(): void {
    if (!sourceRow) return
    const container = scrollContainer
    if (container) {
      const bounds = container.getBoundingClientRect()
      if (lastClientY >= bounds.top && lastClientY <= bounds.bottom) {
        const delta = edgeDelta(lastClientY, bounds.top, bounds.bottom)
        if (delta) {
          container.scrollTop += delta
          return
        }
      }
    }
    const delta = edgeDelta(lastClientY, 0, window.innerHeight)
    if (delta) window.scrollBy(0, delta)
  }

  //拖拽期间每帧刷新：影分身跟随光标、落点指示和边缘自动滚动在光标不动时也要跟上滚动
  function frame(): void {
    if (draggingIndex.value === null) {
      frameId = null
      return
    }
    positionGhost()
    autoScroll()
    updateTarget(lastClientX, lastClientY)
    frameId = requestAnimationFrame(frame)
  }

  function pointerDown(index: number, event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return
    const handle = event.currentTarget
    const row = handle instanceof Element ? handle.closest<HTMLElement>(rowSelector()) : null
    if (!row) return
    event.preventDefault()
    reset()
    sourceRow = row
    scrollContainer = scrollParent(row)
    activePointerId = event.pointerId
    lastClientX = event.clientX
    lastClientY = event.clientY
    draggingIndex.value = index
    createGhost(row, event)
    updateTarget(event.clientX, event.clientY)
    if (handle instanceof Element) handle.setPointerCapture(event.pointerId)
    window.addEventListener("pointermove", onPointerMove, { passive: false })
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
    frameId = requestAnimationFrame(frame)
  }

  function updateTarget(clientX: number, clientY: number): void {
    const element = document.elementFromPoint(clientX, clientY)
    const row = element?.closest<HTMLElement>(rowSelector())
    if (!row) {
      targetIndex.value = null
      targetEdge.value = null
      return
    }
    const index = Number(row.dataset.sortableIndex)
    if (!Number.isInteger(index)) return
    const bounds = row.getBoundingClientRect()
    targetIndex.value = index
    targetEdge.value = clientY < bounds.top + bounds.height / 2 ? "before" : "after"
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return
    event.preventDefault()
    lastClientX = event.clientX
    lastClientY = event.clientY
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return
    updateTarget(lastClientX, lastClientY)
    const from = draggingIndex.value
    const index = targetIndex.value
    const edge = targetEdge.value
    if (from !== null && index !== null && edge !== null) reorder(from, index + (edge === "after" ? 1 : 0))
    reset()
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return
    reset()
  }

  function removePointerListeners(): void {
    if (typeof window === "undefined") return
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerCancel)
  }

  function move(index: number, offset: -1 | 1): void {
    if (!canMove(index, offset)) return
    reorder(index, index + offset + (offset > 0 ? 1 : 0))
  }

  if (getCurrentScope()) onScopeDispose(reset)

  return { scopeId, key, isDragging, dropEdge, canMove, pointerDown, move }
}
</script>

<script setup lang="ts" generic="T">
defineOptions({ name: "SSortableList", inheritAttrs: false })

//无渲染的排序作用域：内部持有 useSortableList 的 controller 并 provide 出去，
//插槽里的 SSortableItem 自动注入，调用方不再 import composable、自行创建并传递控制器。
//行元素仍由调用方模板渲染（scoped 样式、v-for key 保持原样），本组件不包任何 DOM。
const props = defineProps<{
  items: readonly T[]
  //行把手的无障碍描述，作用域内所有行共用；SSortableItem 的 label prop 可按行覆盖
  label?: string
}>()

const emit = defineEmits<{ reorder: [items: T[]] }>()

const controller = useSortableList(
  () => props.items,
  items => emit("reorder", items)
)

provide(SortableListContextKey, {
  controller,
  label: computed(() => props.label),
})
</script>
