import { ref } from 'vue'

export interface ConfirmOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  visible: boolean
  resolve: ((value: boolean) => void) | null
}

const state = ref<ConfirmState>({
  visible: false,
  message: '',
  resolve: null,
})

function open(opts: ConfirmOptions): Promise<boolean> {
  if (state.value.visible && state.value.resolve) {
    state.value.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    state.value = {
      visible: true,
      title: opts.title,
      message: opts.message ?? '',
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      danger: opts.danger,
      resolve,
    }
  })
}

function settle(value: boolean) {
  const r = state.value.resolve
  state.value.visible = false
  state.value.resolve = null
  if (r) r(value)
}

export function useConfirm() {
  function confirm(message: string, options?: Omit<ConfirmOptions, 'message'>): Promise<boolean>
  function confirm(options: ConfirmOptions): Promise<boolean>
  function confirm(arg: string | ConfirmOptions, options?: Omit<ConfirmOptions, 'message'>) {
    if (typeof arg === 'string') return open({ ...options, message: arg })
    return open(arg)
  }
  return {
    state,
    confirm,
    _accept: () => settle(true),
    _cancel: () => settle(false),
  }
}
