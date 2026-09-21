import { listen } from '@tauri-apps/api/event'
import { useToast } from '@sbot/ui'
import { toggleTheme } from '../theme/theme'

/** 原生菜单里需要前端配合的动作（Rust 直接能做的——缩放/重载/打开目录——不经此桥） */
let bound = false

export function initMenuBridge(): void {
  if (bound) return
  bound = true
  void listen<{ action?: string }>('sbot://menu', (e) => {
    if (e.payload?.action === 'toggle-theme') toggleTheme()
  })
  // Rust 侧动作失败（如服务未就绪时打开 Admin UI）→ 用户可见的错误提示
  const toast = useToast()
  void listen<{ message?: string; type?: 'success' | 'error' }>('sbot://toast', (e) => {
    if (e.payload?.message) toast.show(e.payload.message, e.payload.type ?? 'error')
  })
}
