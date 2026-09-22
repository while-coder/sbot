<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, watch } from "vue"

defineOptions({ name: "SVirtualList", inheritAttrs: false })
const props = withDefaults(defineProps<{
  items?: any[]
  /** 取 key 的字段名；不填就用下标，此时头部裁剪会让已测行高错位，整表换引用时缓存直接清空 */
  itemKey?: string
  /** 没测量过的行按这个高度估算 */
  minSize?: number
  buffer?: number
}>(), { items: () => [], minSize: 20, buffer: 6 })
const attrs = useAttrs()

const host = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewHeight = ref(0)
//Map 本身不是响应式的，实测到新行高时靠这个版本号触发重新计算可视区
const measured = ref(0)
const heights = new Map<unknown, number>()
const elements = new Map<unknown, HTMLElement>()
let observer: ResizeObserver | null = null
let frame: number | null = null
let hostWidth = 0
let warnedKey = false
const KeyOf = (item: any, index: number) => props.itemKey ? item?.[props.itemKey] : index
//几何指纹：读到全部条目建立依赖，列表内容一动才重跑；期间依赖一直挂着，
//这样滚动期间不用逐条摸数组，追加/裁剪也能正确触发重算
let layoutTick = 0
const layout = computed(() => {
  const items = props.items
  measured.value
  for (let index = 0; index < items.length; ++index) KeyOf(items[index], index)
  return ++layoutTick
})
//前缀和缓存：只有行高或列表变化才重建(O(n))，滚动定位只做二分(O(log n))
let sumsTick = -1
let sums: number[] = []
const Sums = () => {
  const tick = layout.value
  if (sumsTick === tick) return sums
  const items = props.items
  const list = new Array(items.length + 1)
  list[0] = 0
  const seen = props.itemKey ? new Set<unknown>() : null
  for (let index = 0; index < items.length; ++index) {
    const key = KeyOf(items[index], index)
    if (seen && !warnedKey) {
      if (key == null) { warnedKey = true; console.warn("[SVirtualList] itemKey 字段取到 undefined，这些行会共用同一份测量缓存") }
      else if (seen.has(key)) { warnedKey = true; console.warn("[SVirtualList] itemKey 字段取值重复，测量缓存会互相覆盖") }
      else seen.add(key)
    }
    list[index + 1] = list[index] + (heights.get(key) ?? props.minSize)
  }
  sumsTick = tick
  sums = list
  return list
}
const range = computed(() => {
  const items = props.items
  const sums = Sums()
  const count = items.length
  //第一个"底边越过 scrollTop"的行；滚出总高时 start 会落到末尾，浏览器随后会把 scrollTop 夹回来
  let low = 0
  let high = count - 1
  let start = count
  while (low <= high) {
    const mid = (low + high) >> 1
    if (sums[mid + 1] > scrollTop.value) { start = mid; high = mid - 1 } else low = mid + 1
  }
  const first = Math.max(0, start - props.buffer)
  const top = sums[first]
  const bottom = scrollTop.value + viewHeight.value
  let end = count
  low = start
  high = count
  while (low <= high) {
    const mid = (low + high) >> 1
    if (sums[mid] >= bottom) { end = mid; high = mid - 1 } else low = mid + 1
  }
  const last = Math.min(count, end + props.buffer)
  return { first, last, top, total: sums[count] }
})
const visible = computed(() => {
  const { first, last } = range.value
  const result: { key: unknown; item: any; index: number }[] = []
  for (let index = first; index < last; ++index) {
    const item = props.items[index]
    result.push({ key: KeyOf(item, index), item, index })
  }
  return result
})
const Sync = () => {
  const element = host.value
  if (!element) return
  scrollTop.value = element.scrollTop
  viewHeight.value = element.clientHeight
}
const Measure = () => {
  let changed = false
  for (const [key, element] of elements) {
    const height = element.getBoundingClientRect().height
    //小于半像素的抖动不值得触发一轮重算
    if (height > 0 && Math.abs(height - (heights.get(key) ?? -1)) > 0.5) {
      heights.set(key, height)
      changed = true
    }
  }
  if (changed) measured.value++
}
//行高缓存按 key 只进不出会随会话无限膨胀，超出列表两倍后把已经不存在的 key 清掉
const Prune = () => {
  const items = props.items
  if (heights.size <= items.length * 2 + 32) return
  const alive = new Set<unknown>()
  for (let index = 0; index < items.length; ++index) alive.add(KeyOf(items[index], index))
  for (const key of heights.keys()) if (!alive.has(key)) heights.delete(key)
}
const Schedule = () => {
  if (frame != null) return
  frame = requestAnimationFrame(() => {
    frame = null
    Sync()
    Measure()
    Prune()
  })
}
const SetItemRef = (key: unknown, element: unknown) => {
  const el = element as HTMLElement | null
  const previous = elements.get(key)
  if (previous && previous !== el) observer?.unobserve(previous)
  if (!el) {
    elements.delete(key)
    return
  }
  elements.set(key, el)
  observer?.observe(el)
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    const width = host.value?.clientWidth ?? 0
    //容器变窄会改变每行的折行数，缓存的行高全部作废
    if (hostWidth > 0 && Math.abs(width - hostWidth) > 0.5) {
      heights.clear()
      measured.value++
    }
    hostWidth = width
    Schedule()
  })
  if (host.value) {
    hostWidth = host.value.clientWidth
    observer.observe(host.value)
  }
  for (const element of elements.values()) observer.observe(element)
  Sync()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  CancelStick()
  if (frame != null) cancelAnimationFrame(frame)
  frame = null
})
//贴底跟随：估算总高会随实测逐步修正，贴底后渲染出新行又被实测，总高一变就差几行，
//所以逐帧追到底，直到贴住或追满 6 帧
let stickFrame: number | null = null
let stickTries = 0
const CancelStick = () => {
  if (stickFrame != null) cancelAnimationFrame(stickFrame)
  stickFrame = null
}
const Stick = () => {
  stickFrame = null
  const element = host.value
  if (!element) return
  Measure()
  element.scrollTop = element.scrollHeight
  if (++stickTries < 6 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) stickFrame = requestAnimationFrame(Stick)
}
//换一份数据时滚动位置要回到顶部，否则会停在一个对新列表毫无意义的偏移上；
//追加请就地 push（引用不变，不触发回顶），整表换引用才走这里
watch(() => props.items, () => {
  CancelStick()
  //没有稳定 key 时下标缓存的行高对新列表毫无意义，直接清空
  if (!props.itemKey) heights.clear()
  if (host.value) host.value.scrollTop = 0
  scrollTop.value = 0
  Schedule()
})
defineExpose({
  element: host,
  scrollTo(options: { position?: string }) {
    const element = host.value
    if (!element) return
    if (options?.position === "top") {
      CancelStick()
      element.scrollTop = 0
      Schedule()
      return
    }
    if (options?.position !== "bottom") return
    element.scrollTop = element.scrollHeight
    CancelStick()
    stickTries = 0
    stickFrame = requestAnimationFrame(Stick)
  },
})
const onScroll = () => { Sync(); Schedule() }
</script>

<template>
  <div v-bind="attrs" ref="host" class="s-virtual-list" @scroll="onScroll">
    <div class="s-virtual-phantom" :style="{ height: `${range.total}px` }">
      <div class="s-virtual-window" :style="{ transform: `translateY(${range.top}px)` }">
        <div v-for="entry in visible" :key="String(entry.key)" class="s-virtual-item"
          :ref="element => SetItemRef(entry.key, element)">
          <slot :item="entry.item" :index="entry.index" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.s-virtual-list { width: 100%; height: 100%; min-height: 0; overflow: auto; }
.s-virtual-phantom { position: relative; width: 100%; }
.s-virtual-window { position: absolute; top: 0; left: 0; width: 100%; }
</style>
