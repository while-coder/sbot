import { reactive } from "vue"

type ToastType = "info" | "success" | "warning" | "error"
interface ToastItem { id: number; type: ToastType; text: string }
// 确认弹窗可选项：confirmText/cancelText 定制按钮文案，danger 时确认钮显示为危险色
export interface ConfirmOptions { title: string; content: string; confirmText?: string; cancelText?: string; danger?: boolean }
interface ConfirmState extends ConfirmOptions {
  visible: boolean
  onOk?: () => unknown
  resolve?: (confirmed: boolean) => void
}
const toastItems = reactive<ToastItem[]>([])
const confirmState = reactive<ConfirmState>({ visible: false, title: "", content: "" })
let toastId = 0

// 全局飘字：fire-and-forget，3.5s 自动消失
export const toast = {
  show(type: ToastType, text: string) {
    const item = { id: ++toastId, type, text }
    toastItems.push(item)
    window.setTimeout(() => { const index = toastItems.findIndex(value => value.id === item.id); if (index >= 0) toastItems.splice(index, 1) }, 3500)
  }
}

// 确认弹窗：await 拿到用户选择；重复弹出时上一次未决的 Promise 以 false 收场。
// 两种签名：show(title, content, onOk?) 或 show(options, onOk?)，后者可定制按钮文案/danger
export const confirm = {
  show(options: ConfirmOptions | string, content?: string, onOk?: () => unknown): Promise<boolean> {
    confirmState.resolve?.(false)
    const normalized: ConfirmOptions = typeof options === "string" ? { title: options, content: content ?? "" } : options
    Object.assign(confirmState, { confirmText: undefined, cancelText: undefined, danger: undefined, visible: true, onOk }, normalized)
    return new Promise(resolve => { confirmState.resolve = resolve })
  }
}

// 长任务提示（文件下载等）：运行中不自动消失、文本可原地更新，任务结束由调用方 end() 消失。
// 与 toast 的区别是常驻；ratio 0~1 时附带进度条，null 则只显示文字。
export interface LoadingHandle {
  update(text: string, ratio?: number | null): void
  end(): void
}
interface LoadingItem { id: number; text: string; ratio: number | null }
const loadingItems = reactive<LoadingItem[]>([])
let loadingSeq = 0

export const loading = {
  show(text: string): LoadingHandle {
    const item = reactive({ id: ++loadingSeq, text, ratio: null as number | null })
    loadingItems.push(item)
    return {
      update(text: string, ratio: number | null = null) { item.text = text; item.ratio = ratio },
      end() { const index = loadingItems.indexOf(item); if (index >= 0) loadingItems.splice(index, 1) }
    }
  }
}

// 仅供 SMessageHost 内部渲染使用
export { toastItems, confirmState, loadingItems }
export type { ToastType, ToastItem, ConfirmState, LoadingItem }
