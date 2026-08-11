import { ref } from 'vue'

const MOBILE_BREAKPOINT = '(max-width: 768px)'
const mq = window.matchMedia(MOBILE_BREAKPOINT)
const isMobile = ref(mq.matches)

function handler(e: MediaQueryListEvent) {
  isMobile.value = e.matches
}
mq.addEventListener('change', handler)

export function useResponsive() {
  return { isMobile }
}
