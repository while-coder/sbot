import { computed } from 'vue'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { ListResourceManager } from '@/shared/resourceManager'

/** /api/channel-sessions 返回的会话行（仅取常用字段，其余宽松保留）。 */
export interface ChannelSession {
  id: number
  channelId: string
  sessionId: string
  sessionName?: string | null
  autoSessionName?: string | null
  agenda?: string | null
  profileId?: number | string | null
  [key: string]: unknown
}

/** 频道数据管理：频道会话列表（懒加载缓存）+ 频道显示名等便捷方法。 */
class ChannelManager extends ListResourceManager<ChannelSession> {
  constructor() {
    super(async () => (await apiFetch('/api/channel-sessions')).data || [])
  }

  /** 频道显示名：取 settings.channels 里的 name，缺省回退频道 id。 */
  channelName(channelId: string): string {
    const channels = store.settings.channels as Record<string, { name?: string }> | undefined
    return channels?.[channelId]?.name || channelId
  }

  /** 按数据库 id 查找频道会话。 */
  session(id: number): ChannelSession | undefined {
    return this.list.value.find(s => s.id === id)
  }

  /** profileId → 会话 的映射（一个 thread 即一个 profileId，供 saver thread 等关联场景）。 */
  readonly sessionByProfileId = computed(() => {
    const map = new Map<string, ChannelSession>()
    for (const s of this.list.value) {
      if (s.profileId != null) {
        const key = String(s.profileId)
        if (!map.has(key)) map.set(key, s)
      }
    }
    return map
  })
}

export const channelManager = new ChannelManager()
