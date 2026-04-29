import { ref, onMounted, onBeforeUnmount, provide, inject, type Ref, type InjectionKey } from 'vue'

const COMPACT_KEY: InjectionKey<Ref<boolean>> = Symbol('chatui-compact')
const COMPACT_BREAKPOINT = 600

export function useCompactProvider(el: Ref<HTMLElement | null>) {
  const isCompact = ref(false)
  let ro: ResizeObserver | null = null

  onMounted(() => {
    if (!el.value) return
    ro = new ResizeObserver(([entry]) => {
      isCompact.value = entry.contentRect.width <= COMPACT_BREAKPOINT
    })
    ro.observe(el.value)
    isCompact.value = el.value.offsetWidth <= COMPACT_BREAKPOINT
  })

  onBeforeUnmount(() => { ro?.disconnect() })

  provide(COMPACT_KEY, isCompact)
  return isCompact
}

export function useCompact(): Ref<boolean> {
  return inject(COMPACT_KEY, ref(false))
}
