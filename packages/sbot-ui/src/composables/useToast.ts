import { ref } from 'vue'

export type ToastType = 'success' | 'error'

interface ToastState {
  visible: boolean
  message: string
  type: ToastType
}

const state = ref<ToastState>({ visible: false, message: '', type: 'success' })
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function show(message: string, type: ToastType = 'success') {
    if (timer) clearTimeout(timer)
    state.value = { visible: true, message, type }
    timer = setTimeout(() => { state.value.visible = false }, 3000)
  }
  return { state, show }
}
