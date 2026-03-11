import { ref } from 'vue'

interface ToastState {
  visible: boolean
  message: string
  type: 'success' | 'error'
}

const state = ref<ToastState>({ visible: false, message: '', type: 'success' })
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function show(message: string, type: 'success' | 'error' = 'success') {
    if (timer) clearTimeout(timer)
    state.value = { visible: true, message, type }
    timer = setTimeout(() => { state.value.visible = false }, 3000)
  }

  return { state, show }
}
