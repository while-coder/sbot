import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type BackendPhase = 'starting' | 'reusing' | 'ready' | 'failed'

export interface BackendInfo {
  phase: BackendPhase
  port: number | null
  owned: boolean
  baseUrl: string
  message: string
  log: string | null
}

/** Rust 侧状态快照 + 事件订阅的双保险 store（无论事件与查询谁先到达都不丢状态） */
export const backend = reactive<BackendInfo>({
  phase: 'starting',
  port: null,
  owned: false,
  baseUrl: '',
  message: '正在启动…',
  log: null,
})

function applyStatus(p: Partial<BackendInfo> | null | undefined): void {
  if (!p) return
  if (p.phase) backend.phase = p.phase
  if (p.port != null) backend.port = p.port
  if (p.owned !== undefined) backend.owned = p.owned
  if (p.baseUrl) backend.baseUrl = p.baseUrl
  if (p.message !== undefined) backend.message = p.message
  if (p.log !== undefined) backend.log = p.log
}

let subscribed = false

export async function initBackendStore(): Promise<void> {
  if (!subscribed) {
    subscribed = true
    await listen<Partial<BackendInfo>>('sbot://status', (e) => applyStatus(e.payload))
  }
  try {
    applyStatus(await invoke<BackendInfo>('get_backend_info'))
  } catch {
    // 快照命令暂不可用时事件订阅仍在；仅在极早窗口可能出现
  }
}
