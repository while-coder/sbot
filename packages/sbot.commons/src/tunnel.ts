/**
 * Tunnel 运行时状态类型。配置类型 TunnelConfig / TunnelProviderType
 * 在 settings.ts 中定义。
 */

import type { TunnelProviderType } from './settings.js'

/**
 * 单个 tunnel 的运行状态。GET /api/tunnel/status 返回这个数组，
 * 顺序与 settings.tunnel 配置数组一致。
 */
export interface TunnelStatus {
  id: string
  name?: string
  type: TunnelProviderType
  /** 配置中是否启用 */
  enabled: boolean
  /** 进程是否健康运行中 */
  running: boolean
  publicUrl?: string
  startedAt?: number
  /** 最近一次错误（启动失败 / 子进程退出等） */
  error?: string
  /** 最近日志，环形 buffer 200 行 */
  recentLogs: string[]
}
