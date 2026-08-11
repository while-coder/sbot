import { apiFetch } from '@/shared/api'

/** /api/channel-sessions 返回的会话行（仅取下拉框需要的字段，其余宽松保留）。 */
export interface ChannelSession {
  id: number
  channelId: string
  sessionId: string
  sessionName?: string | null
  autoSessionName?: string | null
  agenda?: string | null
  [key: string]: unknown
}

// 模块级缓存：一个弹窗里可能同时渲染多个会话下拉框（如每个 trigger 一个），
// 共享同一次请求；inflight 合并并发首次加载。
let cache: ChannelSession[] | null = null
let inflight: Promise<ChannelSession[]> | null = null

/** 加载频道会话列表（带缓存）。force=true 时强制刷新。 */
export async function loadChannelSessions(force = false): Promise<ChannelSession[]> {
  if (cache && !force) return cache
  if (!inflight) {
    inflight = apiFetch('/api/channel-sessions')
      .then(r => { cache = (r.data || []) as ChannelSession[]; inflight = null; return cache! })
      .catch(e => { inflight = null; throw e })
  }
  return inflight
}

/** 已缓存的列表（未加载时为空数组），供组件初始渲染用。 */
export function cachedChannelSessions(): ChannelSession[] {
  return cache ?? []
}
