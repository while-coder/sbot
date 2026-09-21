import { listen } from '@tauri-apps/api/event'
import { toggleTheme } from '../theme/theme'

/** 原生菜单里需要前端配合的动作（Rust 直接能做的——缩放/重载/打开目录——不经此桥） */
let bound = false

export function initMenuBridge(): void {
  if (bound) return
  bound = true
  void listen<{ action?: string }>('sbot://menu', (e) => {
    if (e.payload?.action === 'toggle-theme') toggleTheme()
  })
}
